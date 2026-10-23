import { makePush } from "@/common/push/push.fake";
import type { PushPayload } from "@/common/push/push.service";
import type { PrismaClient } from "@/generated/prisma/client";
import { PilotQuestionService } from "./question.service";
import { describe, expect, it } from "bun:test";

type Row = Record<string, unknown>;

function makeService(over: Row = {}) {
  const rec = {
    created: null as Row | null,
    locks: 0,
    jobLookups: [] as Row[],
    pushes: [] as { userId: string; payload: PushPayload }[],
  };
  const question: Row = {
    id: "e1",
    userId: "p1",
    kind: "question",
    status: "open",
    subjectType: null,
    subjectId: null,
    prompt: "q",
    options: [],
    deepLink: null,
    answer: null,
    answeredAt: null,
    expiresAt: null,
    createdAt: new Date(),
    ...over,
  };
  const db = {
    $queryRaw: async () => {
      rec.locks++;
    },
    job: {
      findFirst: async (input: Row) => {
        rec.jobLookups.push(input);
        return null;
      },
    },
    pilotQuestion: {
      create: async (a: { data: Row }) => {
        rec.created = a.data;
        return { ...question, ...a.data };
      },
      findFirst: async () => question,
      updateManyAndReturn: async (a: { where: { status: string }; data: Row }) => {
        if (question.status !== a.where.status) return [];
        if (question.expiresAt instanceof Date && question.expiresAt <= new Date()) return [];
        Object.assign(question, a.data);
        return [question];
      },
    },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(db),
  };
  const svc = new PilotQuestionService(db as unknown as PrismaClient, makePush(rec.pushes));
  return { svc, rec, question };
}

describe("PilotQuestionService.createQuestion", () => {
  it("reserves account handoffs for the scoped account workflow", async () => {
    const { svc, rec } = makeService();
    await expect(
      svc.createQuestion("p1", {
        kind: "choice",
        prompt: "Account review",
        options: [],
        subjectType: "account_setup",
        subjectId: crypto.randomUUID(),
      }),
    ).rejects.toThrow("scoped account setup");
    expect(rec.created).toBeNull();
  });
  it("opens the question and pushes it, linking to its deep link", async () => {
    const { svc, rec } = makeService();
    const question = await svc.createQuestion("p1", {
      kind: "choice",
      prompt: "Which start date?",
      options: ["2 weeks", "immediately"],
      deepLink: "/pilot/questions/e1",
    });
    expect(question).toMatchObject({ status: "open", options: ["2 weeks", "immediately"] });
    expect(rec.created?.expiresAt).toBeNull();
    expect(rec.pushes[0]?.payload).toEqual({
      title: "OpenApply needs you",
      body: "Your agent needs an answer. Open OpenApply to reply.",
      url: "/pilot/questions/e1",
      tag: "question-e1",
    });
  });

  it("rejects an unowned job subject before creating a question", async () => {
    const { svc, rec } = makeService();
    const jobId = crypto.randomUUID();
    await expect(
      svc.createQuestion("p1", {
        kind: "question",
        prompt: "Unknown fact",
        options: [],
        subjectType: "job",
        subjectId: jobId,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(rec.locks).toBe(1);
    expect(rec.jobLookups).toEqual([
      { where: { id: jobId, campaign: { userId: "p1" } }, select: { id: true } },
    ]);
    expect(rec.created).toBeNull();
    expect(rec.pushes).toEqual([]);
  });

  it("expires an unanswered 2FA question after about five minutes", async () => {
    const { svc, rec } = makeService();
    await svc.createQuestion("p1", { kind: "two_factor", prompt: "Enter the code", options: [] });
    const expiresAt = rec.created?.expiresAt;
    if (!(expiresAt instanceof Date)) throw new Error("expected an expiry");
    const minutes = (expiresAt.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(4);
    expect(minutes).toBeLessThanOrEqual(5);
  });
});

describe("PilotQuestionService.answerQuestion", () => {
  it("keeps account credentials and handoff decisions out of generic question answers", async () => {
    const { svc, question } = makeService({ subjectType: "account_setup" });
    await expect(svc.answerQuestion("p1", "e1", { answer: "secret-or-done" })).rejects.toThrow(
      "secure account setup",
    );
    expect(question).toMatchObject({ status: "open", answer: null });
  });
  it("records the answer on an open question", async () => {
    const { svc } = makeService();
    const question = await svc.answerQuestion("p1", "e1", { answer: "2 weeks" });
    expect(question).toMatchObject({
      status: "answered",
      answer: "2 weeks",
      answeredAt: expect.any(Date),
    });
  });

  it("treats a repeated identical answer as idempotent and rejects replacement", async () => {
    const { svc, rec } = makeService();
    const answer = await svc.answerQuestion("p1", "e1", { answer: "2 weeks" });
    expect(await svc.answerQuestion("p1", "e1", { answer: "2 weeks" })).toEqual(answer);
    await expect(svc.answerQuestion("p1", "e1", { answer: "immediately" })).rejects.toMatchObject({
      status: 409,
    });
    expect(rec.locks).toBe(3);
  });

  it("refuses a question that expired, leaving it as it was", async () => {
    const { svc, question } = makeService({ status: "expired" });
    await expect(svc.answerQuestion("p1", "e1", { answer: "too late" })).rejects.toMatchObject({
      status: 409,
    });
    expect(question).toMatchObject({ status: "expired", answer: null });
  });
  it("refuses a time-expired question even before the cleanup job marks it expired", async () => {
    const { svc } = makeService({ expiresAt: new Date(Date.now() - 1) });
    await expect(svc.answerQuestion("p1", "e1", { answer: "too late" })).rejects.toMatchObject({
      status: 409,
    });
  });
});
