import { INBOX_SYNC_STALE_MS } from "./agenda.service";
import { hasKind, service, serviceWithRec } from "./fakes";
import { describe, expect, it } from "bun:test";

describe("AgendaService answered questions", () => {
  const answered = {
    id: "E1",
    kind: "approval",
    prompt: "Send this reply?",
    subjectType: "email",
    subjectId: "em1",
    answer: "yes",
  };

  it("hands the worker the question, its subject and the answer", async () => {
    const agenda = await service({ answered: [answered] }).refresh("p1");
    const item = agenda.items.find((i) => i.kind === "question.answered");
    expect(item?.payload).toEqual({
      questionId: "E1",
      questionKind: "approval",
      subjectType: "email",
      subjectId: "em1",
      prompt: "Send this reply?",
      answer: "yes",
    });
  });

  it("drops a question once a claim has consumed it", async () => {
    const agenda = await service({
      answered: [answered],
      questionClaims: [{ subjectId: "E1" }],
    }).refresh("p1");
    expect(hasKind(agenda, "question.answered")).toBe(false);
  });
});

describe("AgendaService interviews", () => {
  const replyApp = (emailMessages: Record<string, unknown>[]) => ({
    id: "app1",
    company: "Acme",
    title: "Engineer",
    emailMessages,
  });
  const invite = {
    id: "em1",
    threadId: "t1",
    fromAddress: "dana@acme.test",
    subject: "Re: interview",
    receivedAt: new Date("2026-07-14T12:00:00.000Z"),
  };

  it("offers a reply to an interview email, unless one is drafted or approved", async () => {
    const agenda = await service({ interviewReplyApps: [replyApp([invite])] }).refresh("p1");
    const item = agenda.items.find((i) => i.kind === "interview.reply");
    expect(item?.payload).toMatchObject({ applicationId: "app1", emailMessageId: "em1" });

    const handled = await service({
      interviewReplyApps: [replyApp([invite])],
      interviewQuestions: [{ subjectId: "em1" }],
    }).refresh("p1");
    expect(hasKind(handled, "interview.reply")).toBe(false);

    const noEmail = await service({ interviewReplyApps: [replyApp([])] }).refresh("p1");
    expect(hasKind(noEmail, "interview.reply")).toBe(false);
  });

  it("preps with the campaign's resume, or none without a campaign", async () => {
    const resumeId = "3f0e1a9c-2b4d-4c8e-9f1a-5b6c7d8e9f0a";
    const app = { id: "app1", company: "Acme", title: "Engineer", url: "https://x/1" };
    const agenda = await service({
      interviewPrepApps: [{ ...app, campaign: { config: { resumeId } } }],
    }).refresh("p1");
    const item = agenda.items.find((i) => i.kind === "interview.prep");
    expect(item?.payload).toMatchObject({ applicationId: "app1", resumeId });

    const orphan = await service({
      interviewPrepApps: [{ ...app, campaign: null }],
    }).refresh("p1");
    expect(orphan.items.find((i) => i.kind === "interview.prep")?.payload).toMatchObject({
      resumeId: null,
    });
  });
});

describe("AgendaService mail and Upwork sync", () => {
  it("pulls mail once per refresh, throttled, before reading the inbox", async () => {
    const { svc, rec } = serviceWithRec();
    await svc.refresh("p1");
    expect(rec.inboxSyncs).toEqual([{ userId: "p1", staleMs: INBOX_SYNC_STALE_MS }]);
  });

  it("offers an Upwork pull only to Upwork users, and only once the mirror is stale", async () => {
    const hour = 60 * 60 * 1000;
    const first = await service({ upworkProfiles: 1 }).refresh("p1");
    expect(first.items.find((i) => i.kind === "upwork.syncInbox")?.title).toBe(
      "Pull the Upwork inbox",
    );

    const stale = await service({
      upworkProfiles: 1,
      upworkUnread: 3,
      upworkAccount: { lastSyncedAt: new Date(Date.now() - 7 * hour) },
    }).refresh("p1");
    const item = stale.items.find((i) => i.kind === "upwork.syncInbox");
    expect(item?.title).toBe("Refresh the Upwork inbox");
    expect(item?.payload).toMatchObject({ unreadCount: 3 });

    const quiet = [
      {},
      { upworkProfiles: 1, upworkAccount: { lastSyncedAt: new Date(Date.now() - hour) } },
      // An unconnected MCP only journals "not connected", so a recent try holds it back.
      {
        upworkProfiles: 1,
        upworkSyncClaim: { grantedAt: new Date(), releasedAt: new Date(), outcome: "done" },
      },
    ];
    for (const over of quiet) {
      expect(hasKind(await service(over).refresh("p1"), "upwork.syncInbox")).toBe(false);
    }
  });
});
