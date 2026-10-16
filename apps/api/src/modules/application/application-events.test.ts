import type { ApplicationStatus } from "@openapply/contracts/application";
import { type WorkspaceEvent, workspaceChannel } from "@openapply/contracts/sse";
import { publish, subscribe } from "@/common/sse/server";
import type { PrismaClient } from "@/generated/prisma/client";
import { EmailService } from "@/modules/email/email.service";
import { ApplicationService } from "./application.service";
import { describe, expect, it } from "bun:test";

function fixture() {
  const userId = crypto.randomUUID();
  const application = { id: crypto.randomUUID(), userId, status: "applied" as ApplicationStatus };
  const message = {
    id: crypto.randomUUID(),
    subject: "Application update",
    matchedAppId: application.id,
    classification: "interviewing",
    appliedStatus: null,
  };
  const state = { failTransaction: false, failDelete: false, commits: 0, deletes: 0 };
  const db = {
    application: {
      findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
        where.id === application.id && where.userId === userId ? { ...application } : null,
      update: async ({ data }: { data: { status: ApplicationStatus } }) => {
        application.status = data.status;
        return { ...application };
      },
      delete: async () => {
        if (state.failDelete) throw new Error("Delete failed");
        state.deletes++;
        return application;
      },
    },
    applicationEvent: { create: async () => ({ id: crypto.randomUUID() }) },
    emailMessage: {
      findFirst: async ({ where }: { where: { id: string; account: { userId: string } } }) =>
        where.id === message.id && where.account.userId === userId ? { ...message } : null,
      update: async () => ({ ...message }),
    },
    $transaction: async (operations: Promise<unknown>[]) => {
      if (state.failTransaction) throw new Error("Commit failed");
      const result = await Promise.all(operations);
      state.commits++;
      return result;
    },
  } as unknown as PrismaClient;
  return {
    userId,
    application,
    message,
    state,
    applications: new ApplicationService(db),
    emails: new EmailService(db),
  };
}

async function eventsDuring(
  userId: string,
  work: () => Promise<unknown>,
): Promise<WorkspaceEvent[]> {
  const stream = subscribe(workspaceChannel, { userId }) as AsyncGenerator<unknown, void>;
  await stream.next();
  try {
    await work();
    // FIFO sentinel proves absence without waiting on an idle stream or racing a timer.
    publish(workspaceChannel, { userId }, { type: "campaign.updated", campaignId: "sentinel" });
    const events: WorkspaceEvent[] = [];
    for (;;) {
      const frame = (await stream.next()).value as { data: WorkspaceEvent };
      if (frame.data.type === "campaign.updated" && frame.data.campaignId === "sentinel")
        return events;
      events.push(frame.data);
    }
  } finally {
    await stream.return();
  }
}

describe("application changes reach the workspace feed", () => {
  it("publishes a manual status change after its transaction commits", async () => {
    const f = fixture();
    const events = await eventsDuring(f.userId, () =>
      f.applications.transitionStatus(f.userId, f.application.id, { toStatus: "offer" }),
    );
    expect(f.state.commits).toBe(1);
    expect(events).toEqual([{ type: "application.updated", id: f.application.id }]);
  });

  it("publishes successful individual deletion because analytics totals changed", async () => {
    const f = fixture();
    const events = await eventsDuring(f.userId, () =>
      f.applications.remove(f.userId, f.application.id),
    );
    expect(f.state.deletes).toBe(1);
    expect(events).toEqual([{ type: "application.updated", id: f.application.id }]);
  });

  it("publishes the application's automatic rejection from a classified email", async () => {
    const f = fixture();
    const events = await eventsDuring(f.userId, () =>
      f.emails.scanMessage(f.userId, f.message.id, {
        matchedAppId: f.application.id,
        classification: "rejected",
        confidence: 0.99,
        reviewStatus: "auto",
      }),
    );
    expect(f.state.commits).toBe(1);
    expect(events).toEqual([{ type: "application.updated", id: f.application.id }]);
  });

  it("publishes an approved email verdict's application status change", async () => {
    const f = fixture();
    const events = await eventsDuring(f.userId, () =>
      f.emails.approveMessage(f.userId, f.message.id, {}),
    );
    expect(f.application.status).toBe("interviewing");
    expect(events).toEqual([{ type: "application.updated", id: f.application.id }]);
  });

  it("does not refresh analytics for a no-op status, ordinary scan or denied mail", async () => {
    const f = fixture();
    const events = await eventsDuring(f.userId, async () => {
      await f.applications.transitionStatus(f.userId, f.application.id, { toStatus: "applied" });
      await f.emails.scanMessage(f.userId, f.message.id, {
        matchedAppId: f.application.id,
        classification: "interviewing",
        reviewStatus: "auto",
      });
      await f.emails.denyMessage(f.userId, f.message.id);
    });
    expect(events).toEqual([]);
  });

  it("publishes an approved same-status verdict because it appends analytics history", async () => {
    const f = fixture();
    f.application.status = "interviewing";
    const events = await eventsDuring(f.userId, () =>
      f.emails.approveMessage(f.userId, f.message.id, { toStatus: "interviewing" }),
    );
    expect(f.state.commits).toBe(1);
    expect(events).toEqual([{ type: "application.updated", id: f.application.id }]);
  });

  it("never announces a failed status transaction or deletion", async () => {
    const f = fixture();
    f.state.failTransaction = true;
    f.state.failDelete = true;
    const events = await eventsDuring(f.userId, async () => {
      await expect(
        f.applications.transitionStatus(f.userId, f.application.id, { toStatus: "offer" }),
      ).rejects.toThrow("Commit failed");
      await expect(f.applications.remove(f.userId, f.application.id)).rejects.toThrow(
        "Delete failed",
      );
      await expect(f.emails.approveMessage(f.userId, f.message.id, {})).rejects.toThrow(
        "Commit failed",
      );
      await expect(
        f.emails.scanMessage(f.userId, f.message.id, {
          matchedAppId: f.application.id,
          classification: "rejected",
          confidence: 0.99,
          reviewStatus: "auto",
        }),
      ).rejects.toThrow("Commit failed");
    });
    expect(events).toEqual([]);
  });

  it("keeps application changes on the owning user's workspace topic", async () => {
    const f = fixture();
    const events = await eventsDuring(crypto.randomUUID(), () =>
      f.applications.transitionStatus(f.userId, f.application.id, { toStatus: "offer" }),
    );
    expect(events).toEqual([]);
  });
});
