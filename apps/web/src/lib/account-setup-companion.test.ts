import { accountDetailFixture } from "@/components/features/account-setup/fakes";
import {
  ACCOUNT_SETUP_BUDGET,
  getAccountSetupHandoff,
  getAccountSetupReadiness,
  launchAccountSetup,
} from "./account-setup-companion";
import { afterEach, expect, test } from "bun:test";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockTransport(reply: unknown, status = 200) {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = Object.assign(
    async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return Response.json(reply, { status });
    },
    { preconnect: originalFetch.preconnect },
  ) as typeof fetch;
  return requests;
}

test("readiness only queries the model-free endpoint and cannot start a run", async () => {
  const requests = mockTransport({
    ready: false,
    modelFree: true,
    modelRequests: 0,
    capabilities: { accountWorkerIsolationSupported: false },
    blockers: [{ code: "not_ready", message: "Unavailable" }],
  });
  expect((await getAccountSetupReadiness()).ready).toBe(false);
  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toEndWith("/queue/account-setup/readiness");
  expect(requests[0]?.init?.method).toBe("GET");
  expect(requests[0]?.init?.body).toBeUndefined();
});

test("launch sends the exact snapshot and finite approval while keeping the terminal token out of the body", async () => {
  const ownerId = "31234567-89ab-4cde-8f01-234567890abc";
  const requests = mockTransport({ ownerId, connected: true });
  const snapshot = accountDetailFixture().context.snapshot;
  await launchAccountSetup({
    apiToken: "synthetic-terminal-token",
    expectedOwnerId: ownerId,
    connectionId: "41234567-89ab-4cde-8f01-234567890abc",
    snapshot,
    approvalReference: "synthetic-human-action",
  });
  expect(requests).toHaveLength(1);
  const body = JSON.parse(String(requests[0]?.init?.body));
  expect(body.snapshot).toEqual(snapshot);
  expect(body.budget).toEqual(ACCOUNT_SETUP_BUDGET);
  expect(body.acceptObservedLimitOvershoot).toBe(true);
  expect(body).not.toHaveProperty("apiToken");
  expect(body).not.toHaveProperty("password");
  expect(requests[0]?.init?.headers).toMatchObject({
    authorization: "Bearer synthetic-terminal-token",
  });
});

test("launch rejects credential-bearing snapshots before making any request", async () => {
  const requests = mockTransport({});
  const snapshot = {
    ...accountDetailFixture().context.snapshot,
    password: "synthetic-not-a-secret",
  };
  expect(() =>
    launchAccountSetup({
      apiToken: "fixture",
      expectedOwnerId: "31234567-89ab-4cde-8f01-234567890abc",
      connectionId: "41234567-89ab-4cde-8f01-234567890abc",
      snapshot,
      approvalReference: "fixture",
    }),
  ).toThrow();
  expect(requests).toHaveLength(0);
});

test("ambiguous launch failure never automatically retries", async () => {
  let count = 0;
  globalThis.fetch = Object.assign(
    async () => {
      count++;
      throw new Error("synthetic lost acknowledgement");
    },
    { preconnect: originalFetch.preconnect },
  ) as typeof fetch;
  await expect(
    launchAccountSetup({
      apiToken: "fixture",
      expectedOwnerId: "31234567-89ab-4cde-8f01-234567890abc",
      connectionId: "41234567-89ab-4cde-8f01-234567890abc",
      snapshot: accountDetailFixture().context.snapshot,
      approvalReference: "fixture",
    }),
  ).rejects.toThrow();
  expect(count).toBe(1);
});

test("handoff validates the exact loopback viewer and a current expiry", async () => {
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const requests = mockTransport({
    available: true,
    viewerUrl: "http://localhost:6080/vnc.html",
    expiresAt,
  });
  expect(await getAccountSetupHandoff(accountDetailFixture().item.id, "fixture")).toEqual({
    url: "http://localhost:6080/vnc.html",
    expiresAt,
  });
  expect(requests[0]?.init?.cache).toBe("no-store");
  for (const viewerUrl of [
    "https://attacker.example/vnc.html",
    "http://localhost:6080/vnc.html?password=secret",
    "http://localhost:4102/vnc.html",
  ]) {
    mockTransport({ available: true, viewerUrl, expiresAt });
    await expect(getAccountSetupHandoff(accountDetailFixture().item.id, "fixture")).rejects.toThrow(
      "invalid account browser link",
    );
  }
  mockTransport({
    available: true,
    viewerUrl: "http://localhost:6080/vnc.html",
    expiresAt: new Date(0).toISOString(),
  });
  await expect(getAccountSetupHandoff(accountDetailFixture().item.id, "fixture")).rejects.toThrow();
});
