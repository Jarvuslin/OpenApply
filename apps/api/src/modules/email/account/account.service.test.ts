import type { CryptoService } from "@/common/crypto";
import { EmailAccountService } from "./account.service";
import { createMailboxFixture } from "./fakes";
import { describe, expect, it } from "bun:test";

function fixture() {
  const state = createMailboxFixture();
  return { ...state, service: new EmailAccountService(state.prisma, {} as CryptoService) };
}

describe("saved mailbox accounts", () => {
  it("selects the first registered mailbox without claiming identity verification or message sync", async () => {
    const { service, accounts, messages, activeForUser } = fixture();

    const result = await service.registerConnectorAccount("user", {
      mailbox: " Applicant@Example.com ",
      runtimeProvider: "claude",
    });

    expect(result).toMatchObject({
      provider: "connector",
      email: "applicant@example.com",
      runtimeProvider: "claude",
      selected: true,
      identityVerified: false,
      lastSyncAt: null,
    });
    expect(result.lastCheckedAt).toBeInstanceOf(Date);
    expect(activeForUser.get("user")).toBe(result.id);
    expect(accounts.size).toBe(1);
    expect(messages.size).toBe(0);
    expect(await service.accountStatus("user")).toMatchObject({ connected: true, id: result.id });
  });

  it("stores explicit verification evidence and returns its latest value in account status and lists", async () => {
    const { service, accounts } = fixture();
    const input = { mailbox: "applicant@example.com", runtimeProvider: "claude" as const };

    for (const identityVerified of [false, true, false]) {
      const result = await service.registerConnectorAccount("user", { ...input, identityVerified });

      expect(result.identityVerified).toBe(identityVerified);
      expect(accounts.get(result.id)?.identityVerified).toBe(identityVerified);
      expect(await service.accountStatus("user")).toMatchObject({ identityVerified });
      expect(await service.listAccounts("user")).toMatchObject([{ identityVerified }]);
      expect(accounts.size).toBe(1);
    }
  });

  it("adds and selects a second mailbox while preserving both histories", async () => {
    const { service, seedMessage, messages, accounts, activeForUser } = fixture();
    const first = await service.registerConnectorAccount("user", {
      mailbox: "first@example.com",
      runtimeProvider: "claude",
    });
    seedMessage({ accountId: first.id, providerId: "same-provider-id", subject: "First inbox" });
    const second = await service.registerConnectorAccount("user", {
      mailbox: "second@example.com",
      runtimeProvider: "codex",
    });
    seedMessage({ accountId: second.id, providerId: "same-provider-id", subject: "Second inbox" });

    expect(second.selected).toBe(false);
    expect(activeForUser.get("user")).toBe(first.id);
    const result = await service.selectAccount("user", second.id);

    expect(result).toMatchObject({ connected: true, id: second.id, selected: true });
    expect(activeForUser.get("user")).toBe(second.id);
    expect(accounts.size).toBe(2);
    expect([...messages.values()].map(({ subject }) => subject)).toEqual([
      "First inbox",
      "Second inbox",
    ]);
    expect(
      (await service.listAccounts("user")).map(({ id, selected }) => ({ id, selected })),
    ).toEqual([
      { id: first.id, selected: false },
      { id: second.id, selected: true },
    ]);
  });

  it("rechecking without profile evidence clears old verification while preserving mailbox history", async () => {
    const { service, seedAccount, seedMessage, accounts, messages } = fixture();
    const lastSyncAt = new Date("2026-09-01T00:00:00.000Z");
    const existing = seedAccount(
      {
        userId: "user",
        email: "applicant@example.com",
        runtimeProvider: "claude",
        identityVerified: true,
        lastSyncAt,
        refreshFailedAt: new Date("2026-09-02T00:00:00.000Z"),
      },
      true,
    );
    seedMessage({ accountId: existing.id, providerId: "old-message" });

    const result = await service.registerConnectorAccount("user", {
      mailbox: "APPLICANT@example.com",
      runtimeProvider: "codex",
    });

    expect(result).toMatchObject({
      id: existing.id,
      runtimeProvider: "codex",
      lastSyncAt,
      needsReauth: false,
      identityVerified: false,
    });
    expect(result.lastCheckedAt).toBeInstanceOf(Date);
    expect(accounts.get(existing.id)?.identityVerified).toBe(false);
    expect(accounts.size).toBe(1);
    expect(messages.size).toBe(1);
  });

  it("does not choose an existing or newly added mailbox after the user has no selection", async () => {
    const { service, seedAccount, activeForUser } = fixture();
    seedAccount({ userId: "user", email: "saved@example.com" });

    const saved = await service.registerConnectorAccount("user", {
      mailbox: "saved@example.com",
      runtimeProvider: "claude",
    });
    const added = await service.registerConnectorAccount("user", {
      mailbox: "new@example.com",
      runtimeProvider: "codex",
    });

    expect(saved.selected).toBe(false);
    expect(added.selected).toBe(false);
    expect(activeForUser.get("user")).toBeUndefined();
    expect(await service.accountStatus("user")).toEqual({ connected: false, canSend: false });
  });

  it("removes only the named mailbox and its messages, preserving another user's account", async () => {
    const { service, seedAccount, seedMessage, accounts, messages, activeForUser } = fixture();
    const selected = seedAccount({ userId: "user", email: "selected@example.com" }, true);
    const removed = seedAccount({ userId: "user", email: "saved@example.com" });
    const foreign = seedAccount({ userId: "other-user", email: "other@example.com" }, true);
    for (const account of [selected, removed, foreign]) {
      seedMessage({ accountId: account.id, providerId: "message" });
    }

    expect(await service.disconnectAccount("user", removed.id)).toEqual({ disconnected: true });

    expect([...accounts.keys()]).toEqual([selected.id, foreign.id]);
    expect([...messages.values()].map(({ accountId }) => accountId)).toEqual([
      selected.id,
      foreign.id,
    ]);
    expect(activeForUser.get("user")).toBe(selected.id);
    expect(activeForUser.get("other-user")).toBe(foreign.id);
  });

  it("disconnecting without an ID removes only the selected mailbox and leaves selection empty", async () => {
    const { service, seedAccount, seedMessage, accounts, messages, activeForUser } = fixture();
    const selected = seedAccount({ userId: "user", email: "selected@example.com" }, true);
    const saved = seedAccount({ userId: "user", email: "saved@example.com" });
    for (const account of [selected, saved])
      seedMessage({ accountId: account.id, providerId: "message" });

    await service.disconnectAccount("user");
    await service.disconnectAccount("user");

    expect([...accounts.keys()]).toEqual([saved.id]);
    expect([...messages.values()].map(({ accountId }) => accountId)).toEqual([saved.id]);
    expect(activeForUser.get("user")).toBeNull();
    expect(await service.accountStatus("user")).toEqual({ connected: false, canSend: false });
  });

  it("rejects foreign and nonexistent IDs on selection and removal without changing any account", async () => {
    const { service, seedAccount, accounts, activeForUser } = fixture();
    const own = seedAccount({ userId: "user", email: "own@example.com" }, true);
    const foreign = seedAccount({ userId: "other-user", email: "other@example.com" }, true);

    for (const id of [foreign.id, "missing-account"]) {
      await expect(service.selectAccount("user", id)).rejects.toMatchObject({ status: 404 });
      await expect(service.disconnectAccount("user", id)).rejects.toMatchObject({ status: 404 });
    }

    expect(accounts.size).toBe(2);
    expect(activeForUser.get("user")).toBe(own.id);
    expect(activeForUser.get("other-user")).toBe(foreign.id);
  });

  it("returns only owned account status fields, never OAuth tokens or internal history", async () => {
    const { service, seedAccount } = fixture();
    const own = seedAccount(
      {
        userId: "user",
        email: "own@example.com",
        provider: "gmail",
        accessToken: "fake-access-secret",
        refreshToken: "fake-refresh-secret",
        historyId: "private-history-id",
      },
      true,
    );
    seedAccount({ userId: "other-user", email: "other@example.com" }, true);

    const list = await service.listAccounts("user");
    const status = await service.accountStatus("user");
    const selection = await service.selectAccount("user", own.id);

    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(own.id);
    const statusKeys = [
      "id",
      "provider",
      "email",
      "runtimeProvider",
      "identityVerified",
      "lastCheckedAt",
      "lastSyncAt",
      "canSend",
      "needsReauth",
      "selected",
    ];
    expect(Object.keys(list[0] ?? {}).sort()).toEqual([...statusKeys].sort());
    for (const result of [status, selection]) {
      expect(Object.keys(result).sort()).toEqual([...statusKeys, "connected"].sort());
    }
    expect(JSON.stringify([list, status, selection])).not.toContain("secret");
    expect(JSON.stringify([list, status, selection])).not.toContain("private-history-id");
  });

  it("rejects connector registration for the same OAuth mailbox but allows a different one", async () => {
    const { service, seedAccount, accounts, activeForUser } = fixture();
    const oauth = seedAccount(
      { userId: "user", email: "oauth@example.com", provider: "gmail" },
      true,
    );

    await expect(
      service.registerConnectorAccount("user", {
        mailbox: "OAUTH@example.com",
        runtimeProvider: "claude",
      }),
    ).rejects.toMatchObject({ status: 409 });
    const connector = await service.registerConnectorAccount("user", {
      mailbox: "connector@example.com",
      runtimeProvider: "codex",
    });

    expect(accounts.size).toBe(2);
    expect(connector.selected).toBe(false);
    expect(activeForUser.get("user")).toBe(oauth.id);
    expect(accounts.get(oauth.id)?.provider).toBe("gmail");
  });

  it("keeps the same email address isolated between OpenApply users", async () => {
    const { service, activeForUser } = fixture();
    const input = { mailbox: "shared@example.com", runtimeProvider: "claude" as const };

    const first = await service.registerConnectorAccount("first-user", input);
    const second = await service.registerConnectorAccount("second-user", input);

    expect(first.id).not.toBe(second.id);
    expect(first.selected).toBe(true);
    expect(second.selected).toBe(true);
    expect(activeForUser.get("first-user")).toBe(first.id);
    expect(activeForUser.get("second-user")).toBe(second.id);
    expect((await service.listAccounts("first-user")).map(({ id }) => id)).toEqual([first.id]);
  });
});
