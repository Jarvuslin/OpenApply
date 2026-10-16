import type { CryptoService } from "@/common/crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { CredentialService } from "./credential.service";
import { describe, expect, it } from "bun:test";

interface Row {
  id: string;
  userId: string;
  scope: string;
  email: string | null;
  password: string | null;
  apiKey: string | null;
}
type Key = { userId_scope: { userId: string; scope: string } };

const userId = "1b5e3f63-5b8e-4d0e-9f53-5d3c1d8a0001";

function fixture(rows: Row[] = [], mailboxes: { id: string; email: string }[] = []) {
  const user = { activeEmailAccountId: null as string | null };
  const find = ({ userId_scope: key }: Key) =>
    rows.find((row) => row.userId === key.userId && row.scope === key.scope);
  const credential = {
    findMany: async ({ where }: { where: { userId: string; scope: { in: string[] } } }) =>
      rows.filter((row) => row.userId === where.userId && where.scope.in.includes(row.scope)),
    findUnique: async ({ where }: { where: Key }) => find(where) ?? null,
    upsert: async ({
      where,
      create,
      update,
    }: {
      where: Key;
      create: Partial<Row>;
      update: Partial<Row>;
    }) => {
      const row = find(where);
      if (row) return Object.assign(row, update);
      const created = {
        id: crypto.randomUUID(),
        email: null,
        password: null,
        apiKey: null,
        ...create,
      } as Row;
      rows.push(created);
      return created;
    },
    deleteMany: async ({ where }: { where: { userId: string; scope: { in: string[] } } }) => {
      for (const row of [...rows])
        if (row.userId === where.userId && where.scope.in.includes(row.scope))
          rows.splice(rows.indexOf(row), 1);
    },
  };
  const db = {
    credential,
    emailAccount: {
      findFirst: async ({ where }: { where: { email: { equals: string } } }) =>
        mailboxes.find((mailbox) => mailbox.email === where.email.equals) ?? null,
    },
    user: {
      update: async ({ data }: { data: { activeEmailAccountId: string } }) =>
        Object.assign(user, data),
    },
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(db),
  };
  const secrets = {
    encryptFor: async (_user: string, _ctx: string, plain: string) => `enc:${plain}`,
    decryptFor: async (_user: string, _ctx: string, blob: string) => blob.replace("enc:", ""),
  } as unknown as CryptoService;
  return { svc: new CredentialService(db as unknown as PrismaClient, secrets), rows, user };
}

function row(scope: string, fields: Partial<Row>): Row {
  return {
    id: crypto.randomUUID(),
    userId,
    scope,
    email: null,
    password: null,
    apiKey: null,
    ...fields,
  };
}

describe("the one job login", () => {
  it("shows the login without secrets and only to the signed-in user", async () => {
    const f = fixture([
      row("default", { email: "me@example.test", password: "enc:pw" }),
      row("capsolver", { apiKey: "enc:key" }),
    ]);
    expect(await f.svc.login(userId, "session_user")).toEqual({
      email: "me@example.test",
      hasPassword: true,
      captchaProvider: "capsolver",
      hasCaptchaKey: true,
    });
    await expect(f.svc.login(userId, "agent")).rejects.toMatchObject({ status: 403 });
  });

  it("requires a password for a new or changed email and keeps it for the same email", async () => {
    const f = fixture();
    const login = { email: "Me@Example.test", captchaProvider: null };
    await expect(f.svc.saveLogin(userId, "session_user", login)).rejects.toMatchObject({
      status: 409,
    });
    await f.svc.saveLogin(userId, "session_user", { ...login, password: "first" });
    await f.svc.saveLogin(userId, "session_user", login);
    expect(f.rows).toEqual([
      expect.objectContaining({ email: "me@example.test", password: "enc:first" }),
    ]);
    await expect(
      f.svc.saveLogin(userId, "session_user", { email: "new@example.test", captchaProvider: null }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("keeps one captcha key and clears it with a null provider", async () => {
    const f = fixture([row("2captcha", { apiKey: "enc:old" })]);
    const login = { email: "me@example.test", password: "pw" };
    await f.svc.saveLogin(userId, "session_user", {
      ...login,
      captchaProvider: "capsolver",
      captchaApiKey: "new",
    });
    expect(f.rows.map((saved) => saved.scope).sort()).toEqual(["capsolver", "default"]);
    await f.svc.saveLogin(userId, "session_user", { ...login, captchaProvider: null });
    expect(f.rows.map((saved) => saved.scope)).toEqual(["default"]);
  });

  it("selects the checked mailbox that matches the login email", async () => {
    const f = fixture([], [{ id: "mailbox-1", email: "me@example.test" }]);
    await f.svc.saveLogin(userId, "session_user", {
      email: "me@example.test",
      password: "pw",
      captchaProvider: null,
    });
    expect(f.user.activeEmailAccountId).toBe("mailbox-1");
  });

  it("resolves the same login for every site, unchanged, or null when incomplete", async () => {
    const password = "  Fixture pass'\"#雪123  ";
    const f = fixture([row("default", { email: "me@example.test", password: `enc:${password}` })]);
    expect(await f.svc.resolveCredential(userId)).toMatchObject({
      email: "me@example.test",
      password,
    });
    expect(
      await fixture([row("default", { email: "me@example.test" })]).svc.resolveCredential(userId),
    ).toBeNull();
  });
});

describe("showing the saved password", () => {
  it("reveals it only to the signed-in owner", async () => {
    const f = fixture([row("default", { email: "me@example.test", password: "enc:secret" })]);
    expect(await f.svc.revealPassword(userId, "session_user")).toEqual({ password: "secret" });
    await expect(f.svc.revealPassword(userId, "agent")).rejects.toMatchObject({ status: 403 });
  });
});
