import type { QuestionDefinition } from "@openapply/contracts/application-question";
import { questionDefinition, questionFixture } from "@/modules/application-question/fakes";
import { AnswerBankService } from "./answer-bank.service";
import { describe, expect, it } from "bun:test";

async function savedSource(definition: QuestionDefinition = questionDefinition()) {
  const f = questionFixture();
  const bank = new AnswerBankService(f.db);
  const source = (
    await f.questionsService.observe(f.userId, f.job.id, f.observe(0, [definition]), "agent")
  ).questions[0];
  await f.questionsService.answer(
    f.userId,
    source.id,
    {
      ...f.answer(source),
      saveToProfile: {
        consent: true,
        scope: "employer",
        countryCode: "CA",
        countryConfirmed: true,
      },
    },
    "session_user",
  );
  const list = async () =>
    (await bank.list(f.userId, { page: 1, limit: 25, status: "active" })).items[0];
  const targetJob = { ...f.job, id: crypto.randomUUID(), key: crypto.randomUUID() };
  f.jobs.push(targetJob);
  const target = (
    await f.questionsService.observe(f.userId, targetJob.id, f.observe(0, [definition]), "agent")
  ).questions[0];
  const matches = () =>
    bank.matches(
      f.userId,
      target.id,
      {
        expectedRevision: target.revision,
        expectedDefinitionHash: target.definitionHash,
        countryCode: "CA",
        countryConfirmed: true,
      },
      "session_user",
    );
  return { ...f, source, target, list, matches };
}

describe("saved source freshness", () => {
  it("accepts JSONB key order and preserves the job version on an equivalent new confirmation", async () => {
    const f = await savedSource();
    f.questionAnswers[0].values = [{ value: "yes", fieldKey: "authorization" }];
    expect((await f.list()).available).toBe(true);
    expect((await f.matches()).matches).toHaveLength(1);
    const reviewedAt = f.job.updatedAt.getTime();
    await f.questionsService.answer(f.userId, f.source.id, f.answer(f.source), "session_user");
    expect(f.job.updatedAt.getTime()).toBe(reviewedAt);
    // Same facts still require renewed source consent after the source answer revision changes.
    expect((await f.list()).available).toBe(false);
  });
  it("rechecks a changed source employer when a previously loaded saved draft is confirmed", async () => {
    const f = await savedSource();
    const match = (await f.matches()).matches[0];
    expect(match).toBeDefined();
    f.job.company = "Different employer";
    expect((await f.list()).unavailableReason).toContain("source employer");
    expect((await f.matches()).matches).toEqual([]);
    await expect(
      f.questionsService.answer(
        f.userId,
        f.target.id,
        {
          ...f.answer(f.target),
          useSavedAnswer: {
            entryId: match.entryId,
            revision: match.revision,
            countryCode: "CA",
            countryConfirmed: true,
          },
        },
        "session_user",
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.questionAnswers).toHaveLength(1);
  });
  it("invalidates prose saved for a different source role but allows normalized whitespace", async () => {
    const definition = questionDefinition();
    definition.prompt = "Would this role suit your career plans?";
    const f = await savedSource(definition);
    f.job.title = "  Engineer  ";
    f.job.company = " Fixture  ";
    expect((await f.list()).available).toBe(true);
    f.job.title = "Manager";
    expect((await f.list()).available).toBe(false);
    expect((await f.matches()).matches).toEqual([]);
  });
  it("rejects changed source evidence while retaining the saved snapshot for history", async () => {
    const f = await savedSource();
    f.questionAnswers[0].values = [{ fieldKey: "authorization", value: "no" }];
    const saved = await f.list();
    expect(saved.available).toBe(false);
    expect(saved.sourceValues).toEqual([{ fieldKey: "authorization", value: "yes" }]);
    expect(saved.unavailableReason).toContain("evidence changed");
  });
});
