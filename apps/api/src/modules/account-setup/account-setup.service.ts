import {
  type AccountSetupContinue,
  type AccountSetupObservation,
  accountSetupContextSchema,
  accountSetupContinueSchema,
  accountSetupObserveSchema,
  accountSetupSaveCredentialsSchema,
  type EnqueueAccountSetup,
  enqueueAccountSetupSchema,
  type RequestAccountSetup,
  requestAccountSetupSchema,
} from "@openapply/contracts/account-setup";
import { LOGIN_SCOPE } from "@openapply/contracts/credential";
import { needsYouChannel, workQueueChannel } from "@openapply/contracts/sse";
import { singleton } from "tsyringe";
import { CryptoService, SECRET_CONTEXTS } from "@/common/crypto";
import { conflict, forbidden, notFound } from "@/common/errors";
import { toInputJson } from "@/common/json";
import type { AuthKind } from "@/common/middleware/auth-resolution";
import { publish } from "@/common/sse";
import { type Prisma, PrismaClient, type WorkItem } from "@/generated/prisma/client";
import { lockWorkUser } from "@/modules/work-queue/work-queue.admission";
import { checkWorkLease, workHash } from "@/modules/work-queue/work-queue.policy";
import { workItemView } from "@/modules/work-queue/work-queue.view";
import { askAccountQuestion } from "./account-setup.attention";
import { assertNoLegacyAccount } from "./account-setup.legacy";
import {
  accountIdentity,
  createAccountItem,
  resumeWaitingApplications,
} from "./account-setup.parent";
import {
  accountCredentialRevision,
  accountSetupCredential,
  accountSetupSnapshot,
  accountSetupUrls,
  exactAccountCredential,
  storedAccountSetup,
  validateAccountSetup,
} from "./account-setup.snapshot";

// Revision 1 sends the signup; each continuation adds one, so this allows four automatic passes.
const AUTO_CONTINUE_REVISIONS = 5;

@singleton()
export class AccountSetupService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly crypto: CryptoService,
  ) {}

  async enqueue(userId: string, raw: EnqueueAccountSetup, authorship: AuthKind = "agent") {
    this.human(authorship);
    const input = enqueueAccountSetupSchema.parse(raw);
    const scope = {
      ...accountSetupUrls(input.signupUrl, input.tenantOrigin),
      credentialId: input.credentialId,
      email: input.email.trim().toLowerCase(),
      accountStatus: input.accountStatus,
    };
    if (
      input.mailboxConfirmation &&
      input.mailboxConfirmation.email.trim().toLowerCase() !== scope.email
    )
      throw conflict("Confirm the exact account verification mailbox.");
    const result = await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      const payloadHash = workHash({
        operation: "account-setup-v2",
        ...scope,
        mailboxConfirmation: input.mailboxConfirmation ?? null,
      });
      const prior = await tx.workRequest.findUnique({
        where: {
          userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey },
        },
      });
      if (prior) {
        if (prior.payloadHash !== payloadHash)
          throw conflict("Account setup request was used with different details.");
        const item = await tx.workItem.findFirst({ where: { id: prior.itemIds[0], userId } });
        if (!item) throw notFound("Account setup work no longer exists.");
        return {
          item: await workItemView(tx, userId, item),
          snapshot: storedAccountSetup(item).snapshot,
        };
      }
      const identity = accountIdentity(scope.tenantOrigin, scope.email);
      const previous = await tx.workItem.findUnique({
        where: { userId_identity: { userId, identity } },
      });
      if (previous)
        throw conflict(
          "Account setup already exists for this tenant and email; inspect its outcome, never retry signup.",
        );
      await assertNoLegacyAccount(tx, userId, scope.tenantOrigin, scope.email);
      const login = await tx.credential.findFirst({ where: { id: input.credentialId, userId } });
      if (!login) throw notFound("Exact owned account credential not found.");
      if (login.scope !== LOGIN_SCOPE || !login.password)
        throw conflict("Save your job login with a password on the Queue page first.");
      if (login.email?.trim().toLowerCase() !== scope.email)
        throw conflict("The account email must match your job login email.");
      const item = await createAccountItem(tx, userId, {
        scope,
        identity,
        login,
        mailboxConfirmed: !!input.mailboxConfirmation,
      });
      await tx.workRequest.create({
        data: { userId, idempotencyKey: input.idempotencyKey, payloadHash, itemIds: [item.id] },
      });
      return {
        item: await workItemView(tx, userId, item),
        snapshot: storedAccountSetup(item).snapshot,
      };
    });
    publish(workQueueChannel, { userId }, { type: "work-queue.changed", itemId: result.item.id });
    return result;
  }

  /** A leased application hit a signup wall: create the account with the job login and park it. */
  async requestForApplication(
    userId: string,
    applicationId: string,
    leaseToken: string | undefined,
    raw: RequestAccountSetup,
  ) {
    const input = requestAccountSetupSchema.parse(raw);
    const urls = accountSetupUrls(input.signupUrl, input.tenantOrigin);
    const result = await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      const parent = await tx.workItem.findFirst({
        where: { id: applicationId, userId, kind: "application" },
      });
      if (!parent) throw notFound("Owned application work not found.");
      checkWorkLease(parent, leaseToken ?? "");
      const login = await tx.credential.findUnique({
        where: { userId_scope: { userId, scope: LOGIN_SCOPE } },
      });
      if (!login?.email?.trim() || !login.password)
        throw conflict("Save your job login on the Queue page first.");
      const email = login.email.trim().toLowerCase();
      const identity = accountIdentity(urls.tenantOrigin, email);
      let account = await tx.workItem.findUnique({
        where: { userId_identity: { userId, identity } },
      });
      // An account step that stopped before sending any signup holds nothing; start it fresh.
      if (
        account &&
        ["needs_user", "failed", "cancelled"].includes(account.state) &&
        storedAccountSetup(account).attempt.signupAttempts === 0
      ) {
        await tx.pilotQuestion.updateMany({
          where: { userId, subjectType: "account_setup", subjectId: account.id, status: "open" },
          data: { status: "cancelled" },
        });
        await tx.workItem.delete({ where: { id: account.id } });
        account = null;
      }
      if (!account) {
        await assertNoLegacyAccount(tx, userId, urls.tenantOrigin, email);
        const mailbox = await tx.user.findUnique({
          where: { id: userId },
          select: { activeEmailAccount: { select: { email: true } } },
        });
        account = await createAccountItem(tx, userId, {
          scope: { ...urls, credentialId: login.id, email, accountStatus: "unknown" },
          identity,
          login,
          mailboxConfirmed: mailbox?.activeEmailAccount?.email.trim().toLowerCase() === email,
        });
      }
      const { attempt } = storedAccountSetup(account);
      if (attempt.phase !== "authenticated")
        await tx.workItem.update({
          where: { id: parent.id },
          data: {
            payload: { waitingForAccount: account.id },
            reason: `Creating your account on ${new URL(urls.tenantOrigin).hostname}`,
          },
        });
      return { accountWorkItemId: account.id, phase: attempt.phase };
    });
    publish(workQueueChannel, { userId }, { type: "work-queue.changed" });
    return result;
  }

  plan(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      const item = await tx.workItem.findFirst({ where: { id, userId } });
      if (!item) throw notFound("Owned account setup not found.");
      return (await validateAccountSetup(tx, userId, item)).snapshot;
    });
  }

  private async withCapability<T>(
    authorization: string | undefined,
    operation: (
      tx: Prisma.TransactionClient,
      item: WorkItem,
      context: ReturnType<typeof storedAccountSetup>,
    ) => Promise<T>,
  ) {
    const capability = accountSetupCredential(authorization);
    let userId: string | null = null;
    const result = await this.prisma.$transaction(async (tx) => {
      const owner = await tx.workItem.findUnique({
        where: { id: capability.workItemId },
        select: { userId: true },
      });
      if (!owner) throw notFound("Account setup capability not found.");
      userId = owner.userId;
      await lockWorkUser(tx, owner.userId);
      const item = await tx.workItem.findFirst({
        where: { id: capability.workItemId, userId: owner.userId },
      });
      if (!item) throw notFound("Account setup work no longer exists.");
      const context = await validateAccountSetup(tx, owner.userId, item, capability.leaseToken);
      const result = await operation(tx, item, context);
      const current = await tx.workItem.findFirst({ where: { id: item.id, userId: owner.userId } });
      if (!current) throw notFound("Account setup work no longer exists.");
      const final = await validateAccountSetup(tx, owner.userId, current, capability.leaseToken);
      if (
        final.snapshot.snapshotHash !== context.snapshot.snapshotHash ||
        current.currentExecutionId !== item.currentExecutionId
      )
        throw conflict("Account setup scope changed during this operation.");
      return result;
    });
    if (userId) {
      publish(needsYouChannel, { userId }, { type: "needs-you.changed" });
      publish(
        workQueueChannel,
        { userId },
        { type: "work-queue.changed", itemId: capability.workItemId },
      );
    }
    return result;
  }

  context(authorization: string | undefined) {
    return this.withCapability(authorization, async (_tx, _item, context) =>
      accountSetupContextSchema.parse(context),
    );
  }

  credential(authorization: string | undefined) {
    return this.withCapability(authorization, async (tx, item, context) => {
      if (
        ["needs_user", "authenticated", "unknown", "skipped"].includes(context.attempt.phase) ||
        ((context.attempt.existingAccount || context.snapshot.operation === "inspect") &&
          context.attempt.credentialPurpose === "signup")
      )
        throw conflict("This account phase does not authorize credential use.");
      const credential = await exactAccountCredential(tx, item.userId, context.snapshot);
      const password = await this.crypto.decryptFor(
        item.userId,
        SECRET_CONTEXTS.credentialPassword,
        credential.password!,
      );
      if (!password.trim()) throw conflict("The exact account credential has no usable secret.");
      return { credentialId: credential.id, email: context.snapshot.email, password };
    });
  }

  begin(authorization: string | undefined) {
    return this.withCapability(authorization, async (tx, item, context) => {
      if (context.attempt.signupAttempts !== 0 || context.snapshot.operation !== "signup")
        throw conflict("The single signup attempt is already consumed or sealed; never retry.");
      if (context.attempt.phase !== "signup_ready" || context.attempt.existingAccount)
        throw conflict("Inspect a signup form and resolve user handoffs before beginning signup.");
      const saved = {
        ...context,
        attempt: {
          ...context.attempt,
          signupAttempts: 1 as const,
          begunAt: new Date(),
          phase: "signup_started" as const,
        },
      };
      await tx.workItem.update({ where: { id: item.id }, data: { payload: toInputJson(saved) } });
      return accountSetupContextSchema.parse(saved);
    });
  }

  private human(authorship: AuthKind) {
    if (authorship !== "session_user")
      throw forbidden(
        "Use your signed-in OpenApply session for account credential and handoff decisions.",
      );
  }

  async detail(userId: string, id: string) {
    const item = await this.prisma.workItem.findFirst({ where: { id, userId } });
    if (!item) throw notFound("Owned account setup not found.");
    return {
      item: await workItemView(this.prisma, userId, item),
      context: storedAccountSetup(item),
    };
  }

  observe(authorization: string | undefined, raw: AccountSetupObservation) {
    const input = accountSetupObserveSchema.parse(raw);
    return this.withCapability(authorization, async (tx, item, context) => {
      const current = accountSetupUrls(input.currentUrl, context.snapshot.tenantOrigin);
      const execution = await tx.workExecution.findFirst({
        where: {
          id: item.currentExecutionId!,
          userId: item.userId,
          browserSessionId: input.browserSessionId,
        },
      });
      if (!execution) throw conflict("The observation does not belong to this account browser.");
      if (["authenticated", "skipped", "needs_user", "unknown"].includes(context.attempt.phase))
        throw conflict(
          "This account requires its current human continuation before further observations.",
        );
      const attempt = {
        ...context.attempt,
        currentUrl: current.signupUrl,
        browserSessionId: input.browserSessionId,
      };
      switch (input.event) {
        case "signup_form":
        case "no_account":
          if (
            attempt.signupAttempts ||
            attempt.existingAccount ||
            context.snapshot.operation !== "signup"
          )
            throw conflict("A prior signup or existing account cannot begin again.");
          attempt.phase = "signup_ready";
          if (input.event === "no_account") attempt.noAccountObserved = true;
          break;
        case "existing_account":
        case "credentials_rejected":
          attempt.existingAccount = true;
          attempt.noAccountObserved = false;
          if (input.event === "credentials_rejected" || attempt.credentialPurpose === "signup") {
            attempt.phase = "needs_user";
            attempt.reason = "existing_account_credentials";
          } else attempt.phase = "checking";
          break;
        case "authenticated":
          attempt.phase = "authenticated";
          attempt.reason = null;
          attempt.authenticatedAt = new Date();
          attempt.credentialPurpose = "authenticated";
          attempt.outcome = "created";
          attempt.observedAt = new Date();
          if (attempt.questionId)
            await tx.pilotQuestion.updateMany({
              where: { id: attempt.questionId, userId: item.userId, status: "open" },
              data: { status: "cancelled" },
            });
          attempt.questionId = null;
          await resumeWaitingApplications(tx, item.userId, item.id);
          break;
        case "needs_user":
          attempt.phase = "needs_user";
          attempt.reason = input.reason;
          break;
        case "unknown":
          attempt.phase = "unknown";
          attempt.reason = "verification";
          attempt.outcome = "ambiguous";
          attempt.observedAt = new Date();
          break;
        case "verification_pending": {
          const requested = new Date(input.requestedAt);
          if (
            input.recipient.toLowerCase() !== context.snapshot.email ||
            requested > new Date() ||
            !attempt.begunAt ||
            requested < attempt.begunAt
          )
            throw conflict(
              "Verification must match this signup recipient and actual request time.",
            );
          attempt.verification = {
            requestedAt: requested,
            recipient: context.snapshot.email,
            tenantOrigin: context.snapshot.tenantOrigin,
            senderDomains: input.senderDomains,
          };
          attempt.phase = "verification_pending";
          if (!attempt.mailbox || attempt.mailboxBlocked) {
            attempt.phase = "needs_user";
            attempt.reason = "mailbox_identity";
          }
          break;
        }
        case "mailbox_status":
          if (
            input.status !== "provider_verified" ||
            input.email.toLowerCase() !== context.snapshot.email
          ) {
            attempt.mailboxBlocked = true;
            attempt.mailbox = null;
            attempt.phase = "needs_user";
            attempt.reason = "mailbox_identity";
          } else {
            attempt.mailboxBlocked = false;
            attempt.mailbox = {
              email: context.snapshot.email,
              basis: "provider_verified",
              confirmedAt: new Date(),
            };
          }
          break;
      }
      const saved = { ...context, attempt };
      if (["needs_user", "unknown", "verification_pending"].includes(attempt.phase))
        await askAccountQuestion(tx, item, saved);
      await tx.workItem.update({ where: { id: item.id }, data: { payload: toInputJson(saved) } });
      return accountSetupContextSchema.parse(saved);
    });
  }

  async continue(userId: string, id: string, raw: AccountSetupContinue, authorship: AuthKind) {
    this.human(authorship);
    const input = accountSetupContinueSchema.parse(raw);
    return this.advance(userId, id, input);
  }

  /** A sent signup waiting on its verification email gets a few more passes without a person. */
  async autoContinue(userId: string) {
    const parked = await this.prisma.workItem.findMany({
      where: { userId, intent: "account_setup", state: "needs_user" },
    });
    for (const item of parked) {
      const { snapshot, attempt } = storedAccountSetup(item);
      const waitingOnEmail =
        attempt.reason === "verification" || attempt.phase === "verification_pending";
      if (
        !waitingOnEmail ||
        attempt.signupAttempts !== 1 ||
        attempt.existingAccount ||
        attempt.mailboxBlocked ||
        snapshot.revision >= AUTO_CONTINUE_REVISIONS
      )
        continue;
      // A step that changed meanwhile is left for the next poll.
      await this.advance(userId, item.id, {
        expectedRevision: snapshot.revision,
        action: "continue",
      }).catch(() => undefined);
    }
  }

  async saveCredentials(
    userId: string,
    id: string,
    raw: { expectedRevision: number; password: string },
    authorship: AuthKind,
  ) {
    this.human(authorship);
    const input = accountSetupSaveCredentialsSchema.parse(raw);
    const password = await this.crypto.encryptFor(
      userId,
      SECRET_CONTEXTS.credentialPassword,
      input.password,
    );
    return this.advance(
      userId,
      id,
      { expectedRevision: input.expectedRevision, action: "continue" },
      password,
    );
  }

  private async advance(
    userId: string,
    id: string,
    input: AccountSetupContinue,
    password?: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await lockWorkUser(tx, userId);
      const item = await tx.workItem.findFirst({ where: { id, userId } });
      if (!item) throw notFound("Owned account setup not found.");
      const context = storedAccountSetup(item);
      if (
        context.snapshot.revision !== input.expectedRevision ||
        item.state !== "needs_user" ||
        !["needs_user", "unknown", "verification_pending"].includes(context.attempt.phase)
      )
        throw conflict(
          "Wait for the account worker to park, then review the current account revision.",
        );
      const question = context.attempt.questionId
        ? await tx.pilotQuestion.findFirst({
            where: {
              id: context.attempt.questionId,
              userId,
              subjectType: "account_setup",
              subjectId: id,
              status: "open",
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
          })
        : null;
      if (!question && input.action !== "skip")
        throw conflict("The account handoff is no longer open.");
      if (password && context.attempt.reason !== "existing_account_credentials")
        throw conflict("This account is not asking for an existing password.");
      if (
        input.action !== "skip" &&
        context.attempt.reason === "existing_account_credentials" &&
        !password
      )
        throw conflict("Save the correct existing password securely or skip.");
      if (input.mailboxConfirmation) {
        if (
          input.mailboxConfirmation.email.toLowerCase() !== context.snapshot.email ||
          context.attempt.mailboxBlocked
        )
          throw conflict(
            "A known mailbox mismatch or authorization failure must be resolved through the provider first.",
          );
        context.attempt.mailbox = {
          email: context.snapshot.email,
          basis: "user_confirmed",
          confirmedAt: new Date(),
        };
      }
      let answer = "Continue inspection";
      if (input.action === "skip") answer = "Skip";
      else if (password) answer = "Credentials saved securely";
      if (question)
        await tx.pilotQuestion.update({
          where: { id: question.id },
          data: {
            status: "answered",
            answer,
            answeredAt: new Date(),
          },
        });
      if (input.action === "skip") {
        context.attempt.phase = "skipped";
        context.attempt.reason = null;
        await tx.workItem.update({
          where: { id },
          data: { state: "skipped", reason: null, payload: toInputJson(context) },
        });
        return;
      }
      let credential = await exactAccountCredential(tx, userId, context.snapshot);
      if (password) {
        credential = await tx.credential.update({
          where: { id: credential.id },
          data: { password },
        });
        context.attempt.credentialPurpose = "existing";
        context.attempt.existingAccount = true;
      }
      const { snapshotHash: _hash, ...scope } = context.snapshot;
      const operation =
        scope.operation === "signup" &&
        context.attempt.signupAttempts === 0 &&
        !context.attempt.existingAccount &&
        context.attempt.phase !== "unknown"
          ? "signup"
          : "inspect";
      context.snapshot = accountSetupSnapshot({
        ...scope,
        revision: scope.revision + 1,
        operation,
        credentialRevision: accountCredentialRevision(credential),
      });
      context.attempt.phase = "checking";
      context.attempt.reason = null;
      context.attempt.questionId = null;
      context.attempt.outcome = null;
      context.attempt.observedAt = null;
      await tx.workItem.update({
        where: { id },
        data: {
          payload: toInputJson(context),
          state: "queued",
          reason: null,
          currentExecutionId: null,
          workerSlot: null,
          leaseToken: null,
          leaseExpiresAt: null,
          startedAt: null,
          finishedAt: null,
          cancellationRequestedAt: null,
          pauseRequestedAt: null,
        },
      });
    });
    publish(needsYouChannel, { userId }, { type: "needs-you.changed" });
    publish(workQueueChannel, { userId }, { type: "work-queue.changed", itemId: id });
    return this.detail(userId, id);
  }
}
