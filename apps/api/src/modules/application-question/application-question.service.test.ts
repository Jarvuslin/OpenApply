import { questionDefinition, questionFixture } from "./fakes";
import { questionHash } from "./question.policy";
import { describe, expect, it } from "bun:test";

describe("canonical application questions", () => {
  it("serializes duplicate collections and rejects stale or altered requests", async () => {
    const f = questionFixture();
    const input = f.observe();
    const results = await Promise.all([
      f.questionsService.observe(f.userId, f.job.id, input, "agent"),
      f.questionsService.observe(f.userId, f.job.id, input, "agent"),
    ]);
    expect(results.map((result) => result.collectionVersion)).toEqual([1, 1]);
    expect(f.questionCollections).toHaveLength(1);
    expect(f.applicationQuestions).toHaveLength(1);
    expect(f.questionCollections[0].authorship).toBe("agent");
    await expect(
      f.questionsService.observe(f.userId, f.job.id, { ...input, reason: "changed" }, "agent"),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      f.questionsService.observe(f.userId, f.job.id, f.observe(), "agent"),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.applicationQuestions).toHaveLength(1);
    await expect(f.questionsService.get(crypto.randomUUID(), f.job.id)).rejects.toMatchObject({
      status: 404,
    });
  });
  it("preserves confirmed answers for identical definitions and invalidates changed revisions", async () => {
    const f = questionFixture();
    const first = await f.questionsService.observe(f.userId, f.job.id, f.observe(), "agent");
    const answer = f.answer(first.questions[0]);
    await expect(
      f.questionsService.answer(f.userId, first.questions[0].id, answer, "agent"),
    ).rejects.toMatchObject({ status: 403 });
    await f.questionsService.answer(f.userId, first.questions[0].id, answer, "session_user");
    await f.questionsService.answer(f.userId, first.questions[0].id, answer, "session_user");
    const reviewedTimestamp = f.job.updatedAt.getTime();
    const same = await f.questionsService.observe(f.userId, f.job.id, f.observe(1), "agent");
    expect(f.job.updatedAt.getTime()).toBe(reviewedTimestamp);
    expect(same.questions[0].id).toBe(first.questions[0].id);
    expect(same.questions[0].answer?.confirmedAt).toBeInstanceOf(Date);
    expect(same.questions[0].blocking).toBe(false);
    expect(f.questionAnswers).toHaveLength(1);
    const changed = questionDefinition();
    changed.prompt = "Are you authorized to work in the United States?";
    const next = await f.questionsService.observe(
      f.userId,
      f.job.id,
      f.observe(2, [changed]),
      "agent",
    );
    expect(f.job.updatedAt.getTime()).toBeGreaterThan(reviewedTimestamp);
    expect(next.questions[0].revision).toBe(2);
    expect(next.questions[0].answer).toBeNull();
    expect(next.questions[0].blocking).toBe(true);
    await expect(
      f.questionsService.answer(
        f.userId,
        first.questions[0].id,
        { ...answer, requestId: crypto.randomUUID() },
        "session_user",
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.questionAnswers).toHaveLength(1);
  });
  it("keeps partial observations from erasing history and rejects global field collisions", async () => {
    const f = questionFixture();
    await f.questionsService.observe(f.userId, f.job.id, f.observe(), "agent");
    const partial = await f.questionsService.observe(
      f.userId,
      f.job.id,
      { ...f.observe(1, []), coverage: "partial" },
      "agent",
    );
    expect(partial.questions).toHaveLength(1);
    const duplicate = questionDefinition("second");
    duplicate.fields[0].key = "authorization";
    await expect(
      f.questionsService.observe(
        f.userId,
        f.job.id,
        f.observe(2, [questionDefinition(), duplicate]),
        "agent",
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(f.applicationQuestions).toHaveLength(1);
    const unknown = questionDefinition();
    unknown.visibility = "unknown";
    const guarded = await f.questionsService.observe(
      f.userId,
      f.job.id,
      f.observe(2, [unknown]),
      "agent",
    );
    expect(guarded.latestCollection?.coverage).toBe("partial");
  });
  it("archives exact legacy duplicates while preserving every historical answer", async () => {
    const f = questionFixture();
    const collectionId = crypto.randomUUID();
    f.questionCollections.push({
      id: collectionId,
      userId: f.userId,
      jobId: f.job.id,
      version: 1,
      source: "legacy",
      sourceUrl: f.job.url,
      coverage: "partial",
      collectorVersion: "legacy-backfill-v1",
      reason: null,
      observedAt: new Date(),
    });
    for (let index = 0; index < 2; index++) {
      const id = crypto.randomUUID();
      const definition = questionDefinition(`legacy-${index}`);
      definition.prompt = questionDefinition().prompt;
      f.applicationQuestions.push({
        id,
        userId: f.userId,
        jobId: f.job.id,
        collectionId,
        stableKey: definition.stableKey,
        revision: 1,
        definition,
        definitionHash: questionHash(definition),
        category: "other",
        required: "unknown",
        visibility: "unknown",
        current: true,
        blocking: true,
        createdAt: new Date(),
      });
      f.questionAnswers.push({
        id: crypto.randomUUID(),
        questionId: id,
        userId: f.userId,
        values: [{ fieldKey: definition.fields[0].key, value: "yes" }],
        confirmedAt: null,
        authorship: "migration",
        createdAt: new Date(),
      });
      f.questions.push({ id: crypto.randomUUID(), userId: f.userId, applicationQuestionId: id });
    }
    const observed = await f.questionsService.observe(f.userId, f.job.id, f.observe(1), "agent");
    expect(observed.questions).toHaveLength(1);
    expect(observed.questions[0].answer).toBeNull();
    expect(f.questionAnswers).toHaveLength(2);
    expect(f.applicationQuestions.filter((row) => row.current)).toHaveLength(1);
    expect(f.questions.every((row) => row.applicationQuestionId === observed.questions[0].id)).toBe(
      true,
    );
  });
  it("parks queued work when confirmed parent answers activate a required child", async () => {
    const f = questionFixture();
    f.job.status = "approved";
    await f.queue.enqueue(f.userId, {
      jobIds: [f.job.id],
      idempotencyKey: crypto.randomUUID(),
      source: "user",
      provider: "codex",
    });
    const child = questionDefinition("explain");
    child.condition = {
      state: "known",
      rules: [{ fieldKey: "authorization", operator: "equals", values: ["no"] }],
    };
    const snapshot = await f.questionsService.observe(
      f.userId,
      f.job.id,
      f.observe(0, [questionDefinition(), child]),
      "agent",
    );
    const parent = snapshot.questions.find(
      (question) => question.definition.stableKey === "authorization",
    )!;
    await f.questionsService.answer(f.userId, parent.id, f.answer(parent, "yes"), "session_user");
    expect(f.workItems[0].state).toBe("queued");
    await f.questionsService.answer(f.userId, parent.id, f.answer(parent, "no"), "session_user");
    expect(f.workItems[0].state).toBe("needs_user");
    expect(await f.queue.claim(f.userId)).toBeNull();
    await expect(
      f.queue.control(f.userId, String(f.workItems[0].id), "resume"),
    ).rejects.toMatchObject({ status: 409 });
  });
});
