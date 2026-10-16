import type { QuestionDefinition } from "@openapply/contracts/application-question";
import { questionFixture } from "@/modules/application-question/fakes";
import { describe, expect, it } from "bun:test";

function contactQuestion(key: string): QuestionDefinition {
  return {
    stableKey: key,
    prompt: "Preferred contact method?",
    required: "required",
    visibility: "visible",
    condition: { state: "unconditional", rules: [] },
    groupMode: "all",
    fields: [
      {
        key,
        type: "single_choice",
        options: [
          { value: `${key}-email`, label: "Email" },
          { value: `${key}-phone`, label: "Phone" },
        ],
      },
    ],
  };
}

describe("automatic reuse of saved answers", () => {
  it("answers the same question on the next job without asking again", async () => {
    const f = questionFixture();
    const first = (
      await f.questionsService.observe(
        f.userId,
        f.job.id,
        f.observe(0, [contactQuestion("contact-a")]),
        "agent",
      )
    ).questions[0];
    await f.questionsService.answer(
      f.userId,
      first.id,
      {
        ...f.answer(first, "contact-a-email"),
        saveToProfile: { consent: true as const, scope: "account" as const },
      },
      "session_user",
    );
    const job = { ...f.job, id: crypto.randomUUID(), key: crypto.randomUUID() };
    f.jobs.push(job);
    const next = (
      await f.questionsService.observe(
        f.userId,
        job.id,
        { ...f.observe(0, [contactQuestion("contact-b")]), sourceUrl: job.url },
        "agent",
      )
    ).questions[0];
    expect(next.answer?.confirmedAt).toBeInstanceOf(Date);
    expect(next.answer?.values).toEqual([{ fieldKey: "contact-b", value: "contact-b-email" }]);
    expect(next.blocking).toBe(false);
  });

  it("leaves country-bound questions for the person to confirm", async () => {
    const f = questionFixture();
    const source = (await f.questionsService.observe(f.userId, f.job.id, f.observe(), "agent"))
      .questions[0];
    await f.questionsService.answer(
      f.userId,
      source.id,
      {
        ...f.answer(source),
        saveToProfile: {
          consent: true as const,
          scope: "account" as const,
          countryCode: "CA",
          countryConfirmed: true as const,
        },
      },
      "session_user",
    );
    const job = { ...f.job, id: crypto.randomUUID(), key: crypto.randomUUID() };
    f.jobs.push(job);
    const next = (
      await f.questionsService.observe(
        f.userId,
        job.id,
        { ...f.observe(), sourceUrl: job.url },
        "agent",
      )
    ).questions[0];
    expect(next.answer?.confirmedAt ?? null).toBeNull();
  });
});
