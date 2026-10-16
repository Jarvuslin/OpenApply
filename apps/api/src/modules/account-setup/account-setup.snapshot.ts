import {
  type AccountSetupSnapshot,
  accountSetupContextSchema,
  accountSetupSnapshotSchema,
} from "@openapply/contracts/account-setup";
import { LOGIN_SCOPE } from "@openapply/contracts/credential";
import { z } from "zod/v4";
import { conflict, notFound, unauthorized } from "@/common/errors";
import type { Prisma, WorkItem } from "@/generated/prisma/client";
import { assertAutomationAllowed } from "@/modules/job-board/blocked-sites";
import { validatePublicLogoUrl } from "@/modules/job-listing/company-logo-http";
import { checkWorkLease, workHash } from "@/modules/work-queue/work-queue.policy";

const storedSchema = accountSetupContextSchema.extend({
  attempt: accountSetupContextSchema.shape.attempt.extend({
    begunAt: z.coerce.date().nullable(),
    observedAt: z.coerce.date().nullable(),
    authenticatedAt: z.coerce.date().nullable(),
    mailbox: accountSetupContextSchema.shape.attempt.shape.mailbox
      .unwrap()
      .extend({ confirmedAt: z.coerce.date() })
      .nullable(),
    verification: accountSetupContextSchema.shape.attempt.shape.verification
      .unwrap()
      .extend({ requestedAt: z.coerce.date() })
      .nullable(),
  }),
});

export function accountSetupUrls(signupUrl: string, tenantOrigin: string) {
  const signup = validatePublicLogoUrl(signupUrl);
  const tenant = validatePublicLogoUrl(tenantOrigin);
  if (!signup || !tenant) throw conflict("Account setup requires public HTTPS URLs.");
  const url = new URL(signup),
    origin = new URL(tenant);
  if (url.hostname.endsWith(".") || origin.hostname.endsWith("."))
    throw conflict("Account setup does not support trailing-dot host aliases.");
  if (url.origin !== origin.origin || origin.pathname !== "/" || origin.search || origin.hash)
    throw conflict("Account setup must stay on the exact approved tenant origin.");
  assertAutomationAllowed(signup);
  // The account browser opens only a Workday site's own pages, so a job or apply link becomes its site root.
  if (/^[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com$/.test(url.hostname)) {
    const parts = url.pathname.split("/").filter(Boolean);
    const site = /^[a-z]{2}-[A-Z]{2}$/.test(parts[0] ?? "") ? parts.slice(0, 2) : parts.slice(0, 1);
    if (site.length > 0) {
      url.pathname = `/${site.join("/")}`;
      url.search = "";
    }
  }
  if (
    url.hash ||
    [...url.searchParams.keys()].some((key) => /password|token|secret|otp|code/i.test(key))
  )
    throw conflict("Account URLs cannot contain credentials or verification secrets.");
  return { signupUrl: url.href, tenantOrigin: origin.origin };
}

export function accountSetupSnapshot(value: Omit<AccountSetupSnapshot, "snapshotHash">) {
  const scope = accountSetupSnapshotSchema.omit({ snapshotHash: true }).parse(value);
  const urls = accountSetupUrls(scope.signupUrl, scope.tenantOrigin);
  if (
    scope.signupUrl !== urls.signupUrl ||
    scope.tenantOrigin !== urls.tenantOrigin ||
    scope.email !== scope.email.trim().toLowerCase()
  )
    throw conflict("Account setup snapshot must use normalized URLs and email.");
  return accountSetupSnapshotSchema.parse({ ...scope, snapshotHash: workHash(scope) });
}

export function storedAccountSetup(
  item: Pick<
    WorkItem,
    "id" | "kind" | "intent" | "payload" | "provider" | "jobId" | "campaignId" | "applicationId"
  >,
) {
  const parsed = storedSchema.safeParse(item.payload);
  if (!parsed.success || item.kind !== "pilot_task" || item.intent !== "account_setup")
    throw conflict("Unsupported account setup payload.");
  const { snapshot, attempt } = parsed.data;
  const { snapshotHash, ...scope } = snapshot;
  if (
    snapshot.workItemId !== item.id ||
    item.provider !== "claude" ||
    item.jobId ||
    item.campaignId ||
    item.applicationId ||
    accountSetupSnapshot(scope).snapshotHash !== snapshotHash
  )
    throw conflict("The immutable account setup scope does not match this work item.");
  if (
    (attempt.signupAttempts === 0) !== (attempt.begunAt === null) ||
    (attempt.outcome === null) !== (attempt.observedAt === null) ||
    (attempt.outcome === "created" &&
      (attempt.phase !== "authenticated" || !attempt.authenticatedAt))
  )
    throw conflict("Invalid durable account signup attempt state.");
  return parsed.data;
}

export function accountSetupCredential(authorization: string | undefined) {
  const match = /^Bearer account\.([a-f0-9-]{36})\.([a-f0-9-]{36})$/i.exec(authorization ?? "");
  const workItemId = z.uuid().safeParse(match?.[1]),
    leaseToken = z.uuid().safeParse(match?.[2]);
  if (!workItemId.success || !leaseToken.success)
    throw unauthorized("An exact account setup capability is required.");
  return { workItemId: workItemId.data, leaseToken: leaseToken.data };
}

export async function exactAccountCredential(
  tx: Prisma.TransactionClient,
  userId: string,
  snapshot: Pick<AccountSetupSnapshot, "credentialId" | "email" | "tenantOrigin">,
) {
  const credential = await tx.credential.findFirst({
    where: { id: snapshot.credentialId, userId },
    select: { id: true, email: true, password: true, scope: true },
  });
  if (!credential) throw notFound("Exact owned account credential not found.");
  if (credential.scope !== LOGIN_SCOPE)
    throw conflict("Account setup requires your saved job login.");
  if (credential.email?.trim().toLowerCase() !== snapshot.email || !credential.password)
    throw conflict("The exact account credential email or stored secret is unavailable.");
  return credential;
}

export function accountCredentialRevision(credential: {
  id: string;
  scope: string;
  email: string | null;
  password: string | null;
}) {
  return workHash({
    id: credential.id,
    scope: credential.scope,
    email: credential.email,
    password: credential.password,
  });
}

export async function validateAccountSetup(
  tx: Prisma.TransactionClient,
  userId: string,
  item: WorkItem,
  leaseToken?: string,
) {
  const context = storedAccountSetup(item);
  if (
    item.userId !== userId ||
    item.cancellationRequestedAt ||
    item.pauseRequestedAt ||
    item.finishedAt
  )
    throw conflict("This account setup has stopped and cannot execute again.");
  if (leaseToken) {
    checkWorkLease(item, leaseToken);
    if (
      item.state !== "preparing" ||
      !item.currentExecutionId ||
      item.attempts !== context.snapshot.revision
    )
      throw conflict("Account setup requires its current approved execution revision.");
    const execution = await tx.workExecution.findFirst({
      where: {
        id: item.currentExecutionId,
        userId,
        workItemId: item.id,
        kind: "pilot_task",
        jobId: null,
        finishedAt: null,
        releasedAt: null,
      },
    });
    if (!execution) throw conflict("Account setup execution has ended.");
  } else if (
    item.state !== "queued" ||
    item.attempts !== context.snapshot.revision - 1 ||
    item.currentExecutionId ||
    context.attempt.phase !== "checking" ||
    (context.attempt.signupAttempts === 1 && context.snapshot.operation !== "inspect") ||
    (context.snapshot.revision === 1 &&
      (context.attempt.signupAttempts !== 0 ||
        context.attempt.outcome ||
        (await tx.workExecution.findFirst({ where: { userId, workItemId: item.id } }))))
  ) {
    throw conflict(
      "Only a fresh approved account revision can be claimed; no retry or resume without human continuation.",
    );
  }
  const credential = await exactAccountCredential(tx, userId, context.snapshot);
  if (accountCredentialRevision(credential) !== context.snapshot.credentialRevision)
    throw conflict(
      "The pinned account credential changed. A new human-approved revision is required.",
    );
  return context;
}
