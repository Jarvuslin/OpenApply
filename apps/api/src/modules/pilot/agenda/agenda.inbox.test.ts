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
});

describe("AgendaService mail sync", () => {
  it("pulls mail once per refresh, throttled, before reading the inbox", async () => {
    const { svc, rec } = serviceWithRec();
    await svc.refresh("p1");
    expect(rec.inboxSyncs).toEqual([{ userId: "p1", staleMs: INBOX_SYNC_STALE_MS }]);
  });
});
