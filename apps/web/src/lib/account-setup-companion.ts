import {
  type AccountSetupSnapshot,
  accountSetupSnapshotSchema,
} from "@openapply/contracts/account-setup";
import { z } from "zod/v4";
import { terminalRequest } from "./terminal-request";

const companionUrl = process.env.NEXT_PUBLIC_TERMINAL_URL ?? "http://localhost:4102";
const readinessSchema = z.object({
  ready: z.boolean(),
  modelFree: z.boolean(),
  modelRequests: z.number().int().nonnegative(),
  capabilities: z.object({ accountWorkerIsolationSupported: z.boolean() }),
  blockers: z.array(z.object({ code: z.string(), message: z.string() })),
});
const handoffSchema = z.object({
  available: z.boolean(),
  viewerUrl: z.url().nullable(),
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
});

export const ACCOUNT_SETUP_BUDGET = {
  maxRequests: 12,
  maxTokens: 120000,
  maxSubagents: 0,
  maxTurns: 12,
  maxWorkerTurns: 12,
  maxBudgetUsd: 2,
  maxSeconds: 180,
} as const;

export function getAccountSetupReadiness() {
  return terminalRequest(
    `${companionUrl}/queue/account-setup/readiness`,
    { method: "GET", cache: "no-store" },
    async (response) => {
      if (!response.ok) throw new Error("The companion could not report account setup readiness.");
      return readinessSchema.parse(await response.json());
    },
    { timeoutMs: 8000 },
  );
}

interface AccountSetupLaunchInput {
  apiToken: string;
  expectedOwnerId: string;
  connectionId: string;
  snapshot: AccountSetupSnapshot;
  approvalReference: string;
}

export function launchAccountSetup(input: AccountSetupLaunchInput) {
  const { apiToken } = input;
  return terminalRequest(
    `${companionUrl}/queue/account-setup/launch`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        expectedOwnerId: input.expectedOwnerId,
        connectionId: input.connectionId,
        approvalReference: input.approvalReference,
        snapshot: accountSetupSnapshotSchema.parse(input.snapshot),
        budget: ACCOUNT_SETUP_BUDGET,
        acceptObservedLimitOvershoot: true,
      }),
    },
    async (response) => {
      if (!response.ok)
        throw new Error(
          "This run was not acknowledged. Reload the account and Queue before authorizing another run.",
        );
      const status = z
        .object({ ownerId: z.uuid().nullable(), connected: z.boolean() })
        .parse(await response.json());
      if (status.ownerId !== input.expectedOwnerId || !status.connected)
        throw new Error("The companion connection changed. Reload before acting.");
    },
  );
}

export async function getAccountSetupHandoff(id: string, apiToken: string) {
  z.uuid().parse(id);
  return terminalRequest(
    `${companionUrl}/queue/accounts/${encodeURIComponent(id)}/handoff`,
    { method: "GET", headers: { authorization: `Bearer ${apiToken}` }, cache: "no-store" },
    async (response) => {
      if (!response.ok)
        throw new Error("This account browser is unavailable. Inspect the saved account state.");
      const result = handoffSchema.parse(await response.json());
      if (!result.available || !result.viewerUrl || !result.expiresAt) return null;
      const url = new URL(result.viewerUrl);
      if (
        url.protocol !== "http:" ||
        !["localhost", "127.0.0.1"].includes(url.hostname) ||
        url.port !== "6080" ||
        url.pathname !== "/vnc.html" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        Date.parse(result.expiresAt) <= Date.now()
      )
        throw new Error("The companion returned an invalid account browser link.");
      return { url: url.href, expiresAt: result.expiresAt };
    },
  );
}
