import type { ScanMessageInput } from "@openapply/contracts/email";
import type { PrismaClient } from "@/generated/prisma/client";
import { EmailService } from "./email.service";
import { describe, expect, it } from "bun:test";

function fixture(messageOwner = "user") {
  const applications = [
    { id: "owned-app", userId: "user", status: "applied" },
    { id: "foreign-app", userId: "other-user", status: "applied" },
  ];
  const writes: { kind: string; data: Record<string, unknown> }[] = [];
  const applicationQueries: Record<string, unknown>[] = [];
  const db = {
    emailMessage: {
      findFirst: async ({ where }: { where: { id: string; account: { userId: string } } }) =>
        where.id === "message" && where.account.userId === messageOwner
          ? { id: "message", subject: "Application update" }
          : null,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        writes.push({ kind: "message", data });
        const app = applications.find((entry) => entry.id === data.matchedAppId);
        return { id: "message", ...data, matchedApp: app ?? null };
      },
    },
    application: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        applicationQueries.push(where);
        return (
          applications.find((entry) => entry.id === where.id && entry.userId === where.userId) ??
          null
        );
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        writes.push({ kind: "application", data });
        return data;
      },
    },
    applicationEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        writes.push({ kind: "event", data });
        return data;
      },
    },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  };
  return {
    service: new EmailService(db as unknown as PrismaClient),
    writes,
    applicationQueries,
  };
}

describe("email scan application ownership", () => {
  for (const matchedAppId of ["foreign-app", "missing-app"]) {
    it(`rejects ${matchedAppId} before updating the message`, async () => {
      const { service, writes, applicationQueries } = fixture();

      await expect(
        service.scanMessage("user", "message", { matchedAppId, classification: "interviewing" }),
      ).rejects.toMatchObject({ status: 404 });

      expect(writes).toEqual([]);
      expect(applicationQueries).toEqual([{ id: matchedAppId, userId: "user" }]);
    });
  }

  it("rejects a foreign application on auto-rejection without applying any transition", async () => {
    const { service, writes } = fixture();

    await expect(
      service.scanMessage("user", "message", {
        matchedAppId: "foreign-app",
        classification: "rejected",
        confidence: 0.99,
        reviewStatus: "auto",
      }),
    ).rejects.toMatchObject({ status: 404 });

    expect(writes).toEqual([]);
  });

  it("returns the owned application and keeps interview messages queued for review", async () => {
    const { service, writes } = fixture();

    const result = await service.scanMessage("user", "message", {
      matchedAppId: "owned-app",
      classification: "interviewing",
      reviewStatus: "auto",
    });

    expect(result.matchedApp).toMatchObject({ id: "owned-app" });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      kind: "message",
      data: { matchedAppId: "owned-app", reviewStatus: "pending" },
    });
  });

  it("still applies an owned confident rejection with its event", async () => {
    const { service, writes } = fixture();

    await service.scanMessage("user", "message", {
      matchedAppId: "owned-app",
      classification: "rejected",
      confidence: 0.99,
      reviewStatus: "auto",
    });

    expect(writes.map(({ kind }) => kind)).toEqual(["message", "application", "event"]);
    expect(writes[0]).toMatchObject({
      data: { reviewStatus: "approved", appliedStatus: "rejected" },
    });
    expect(writes[1]).toMatchObject({ data: { status: "rejected" } });
  });

  it("allows clearing or omitting the match without an application lookup", async () => {
    for (const body of [{ matchedAppId: null }, {}] satisfies ScanMessageInput[]) {
      const { service, writes, applicationQueries } = fixture();

      await service.scanMessage("user", "message", body);

      expect(writes).toHaveLength(1);
      expect(applicationQueries).toEqual([]);
    }
  });

  it("does not scan a message belonging to another user", async () => {
    const { service, writes } = fixture("other-user");

    await expect(
      service.scanMessage("user", "message", { matchedAppId: "owned-app" }),
    ).rejects.toMatchObject({ status: 404 });

    expect(writes).toEqual([]);
  });
});

interface MailboxFilter {
  account: { userId: string; activeForUser?: { id: string } };
  accountId?: string;
}

function mailboxFixture(selectedId: string | null = "selected") {
  const rows = [
    { id: "selected-message", accountId: "selected", userId: "user" },
    { id: "saved-message", accountId: "saved", userId: "user" },
    { id: "foreign-message", accountId: "foreign", userId: "other-user" },
  ];
  const queries: MailboxFilter[] = [];
  function matching(where: MailboxFilter) {
    queries.push(where);
    return rows.filter(
      (row) =>
        row.userId === where.account.userId &&
        (!where.accountId || row.accountId === where.accountId) &&
        (!where.account.activeForUser ||
          (where.account.activeForUser.id === row.userId && row.accountId === selectedId)),
    );
  }
  const prisma = {
    emailMessage: {
      findMany: async ({ where }: { where: MailboxFilter }) => matching(where),
      count: async ({ where }: { where: MailboxFilter }) => matching(where).length,
    },
  } as unknown as PrismaClient;
  return { service: new EmailService(prisma), queries };
}

describe("email message mailbox boundaries", () => {
  it("lists and counts only the user's selected mailbox by default", async () => {
    const { service, queries } = mailboxFixture();

    const result = await service.listMessages("user", { page: 1, limit: 25 });
    const count = await service.countMessages("user", {});

    expect(result.items.map(({ id }) => id)).toEqual(["selected-message"]);
    expect(result.pagination.total).toBe(1);
    expect(count).toEqual({ count: 1 });
    expect(queries).toEqual(
      Array(3).fill({ account: { userId: "user", activeForUser: { id: "user" } } }),
    );
  });

  it("allows reading another saved mailbox without mixing it with the selected one", async () => {
    const { service, queries } = mailboxFixture();

    const result = await service.listMessages("user", { page: 1, limit: 25, accountId: "saved" });
    const count = await service.countMessages("user", { accountId: "saved" });

    expect(result.items.map(({ id }) => id)).toEqual(["saved-message"]);
    expect(count).toEqual({ count: 1 });
    expect(queries).toEqual(Array(3).fill({ account: { userId: "user" }, accountId: "saved" }));
  });

  it("returns no messages or count for a foreign mailbox ID", async () => {
    const { service } = mailboxFixture();

    const result = await service.listMessages("user", { page: 1, limit: 25, accountId: "foreign" });
    const count = await service.countMessages("user", { accountId: "foreign" });

    expect(result.items).toEqual([]);
    expect(result.pagination.total).toBe(0);
    expect(count).toEqual({ count: 0 });
  });

  it("returns an empty inbox when there is no selected mailbox", async () => {
    const { service } = mailboxFixture(null);

    const result = await service.listMessages("user", { page: 1, limit: 25 });
    const count = await service.countMessages("user", {});

    expect(result.items).toEqual([]);
    expect(result.pagination.total).toBe(0);
    expect(count).toEqual({ count: 0 });
  });
});
