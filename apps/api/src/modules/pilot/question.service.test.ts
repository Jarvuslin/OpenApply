import { makePush } from "@/common/push/push.fake";
import type { PushPayload } from "@/common/push/push.service";
import type { PrismaClient } from "@/generated/prisma/client";
import { PilotQuestionService } from "./question.service";
import { describe, expect, it } from "bun:test";

type Row = Record<string, unknown>;

function makeService(over: Row = {}) {
  const rec = {
    created: null as Row | null,
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
    pilotQuestion: {
      create: async (a: { data: Row }) => {
        rec.created = a.data;
        return { ...question, ...a.data };
      },
      findFirst: async () => question,
      updateManyAndReturn: async (a: { where: { status: string }; data: Row }) => {
        if (question.status !== a.where.status) return [];
        Object.assign(question, a.data);
        return [question];
      },
    },
  };
  const svc = new PilotQuestionService(db as unknown as PrismaClient, makePush(rec.pushes));
  return { svc, rec, question };
}

describe("PilotQuestionService.createQuestion", () => {
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
      body: "Which start date?",
      url: "/pilot/questions/e1",
      tag: "question-e1",
    });
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
  it("records the answer on an open question", async () => {
    const { svc } = makeService();
    const question = await svc.answerQuestion("p1", "e1", { answer: "2 weeks" });
    expect(question).toMatchObject({
      status: "answered",
      answer: "2 weeks",
      answeredAt: expect.any(Date),
    });
  });

  it("refuses a question that expired, leaving it as it was", async () => {
    const { svc, question } = makeService({ status: "expired" });
    await expect(svc.answerQuestion("p1", "e1", { answer: "too late" })).rejects.toMatchObject({
      status: 409,
    });
    expect(question).toMatchObject({ status: "expired", answer: null });
  });
});
