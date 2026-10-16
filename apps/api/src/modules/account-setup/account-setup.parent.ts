import { z } from "zod/v4";
import { toInputJson } from "@/common/json";
import type { Credential, Prisma, WorkItem } from "@/generated/prisma/client";
import { workHash } from "@/modules/work-queue/work-queue.policy";
import { accountCredentialRevision, accountSetupSnapshot } from "./account-setup.snapshot";

interface AccountScope {
  signupUrl: string;
  tenantOrigin: string;
  credentialId: string;
  email: string;
  accountStatus: "unknown" | "absent_confirmed";
}

// One durable employer/email identity prevents a fresh request from replaying signup.
export function accountIdentity(tenantOrigin: string, email: string) {
  return `account-setup:${workHash({ tenantOrigin, email })}`;
}

export async function createAccountItem(
  tx: Prisma.TransactionClient,
  userId: string,
  input: {
    scope: AccountScope;
    identity: string;
    login: Pick<Credential, "id" | "scope" | "email" | "password">;
    mailboxConfirmed: boolean;
  },
) {
  const { scope, identity, login, mailboxConfirmed } = input;
  const id = crypto.randomUUID();
  const snapshot = accountSetupSnapshot({
    version: 2,
    revision: 1,
    operation: "signup",
    credentialRevision: accountCredentialRevision(login),
    purpose: "account_setup",
    workItemId: id,
    provider: "claude",
    ...scope,
    credentialId: login.id,
    maxSignupAttempts: 1,
    submissionAllowed: false,
  });
  return tx.workItem.create({
    data: {
      id,
      userId,
      kind: "pilot_task",
      intent: "account_setup",
      provider: "claude",
      source: "user",
      identity,
      title: "Set up employer account",
      company: new URL(scope.tenantOrigin).hostname,
      payload: toInputJson({
        snapshot,
        attempt: {
          signupAttempts: 0,
          begunAt: null,
          outcome: null,
          observedAt: null,
          phase: "checking",
          reason: null,
          questionId: null,
          browserSessionId: null,
          currentUrl: null,
          existingAccount: false,
          noAccountObserved: false,
          credentialPurpose: "signup",
          authenticatedAt: null,
          mailbox: mailboxConfirmed
            ? { email: scope.email, basis: "user_confirmed", confirmedAt: new Date() }
            : null,
          mailboxBlocked: false,
          verification: null,
        },
      }),
    },
  });
}

const waitingPayload = z.object({ waitingForAccount: z.uuid() });

/** The account an application is parked behind, or null. */
export function waitingAccountId(item: Pick<WorkItem, "kind" | "payload">): string | null {
  if (item.kind !== "application") return null;
  const parsed = waitingPayload.safeParse(item.payload);
  return parsed.success ? parsed.data.waitingForAccount : null;
}

/** Requeue every application that was waiting for this account to be created. */
export async function resumeWaitingApplications(
  tx: Prisma.TransactionClient,
  userId: string,
  accountItemId: string,
) {
  const parked = await tx.workItem.findMany({
    where: { userId, kind: "application", state: "needs_user" },
  });
  const waiting = parked.filter((item) => waitingAccountId(item) === accountItemId);
  for (const item of waiting)
    await tx.workItem.update({
      where: { id: item.id },
      data: {
        state: "queued",
        reason: null,
        payload: {},
        finishedAt: null,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
  return waiting.map((item) => item.id);
}
