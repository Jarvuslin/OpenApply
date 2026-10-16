import type {
  ApplicationPreparation,
  PreparationResultInput,
} from "@openapply/contracts/application-preparation";
import type { QuestionDefinition } from "@openapply/contracts/application-question";
import { questionDefinition } from "./fakes";
import { preparationFixture } from "./preparation-fakes";
import { describe, expect, it } from "bun:test";

function optionalDefinition(overrides: Partial<QuestionDefinition> = {}): QuestionDefinition {
  return {
    ...questionDefinition("website"),
    prompt: "Website",
    required: "optional",
    fields: [{ key: "website", type: "text", label: "Website", options: [] }],
    ...overrides,
  };
}

function omission(manifest: ApplicationPreparation): PreparationResultInput {
  const question = manifest.questions.find(
    (question) => question.definition.stableKey === "website",
  )!;
  return {
    requestId: crypto.randomUUID(),
    expectedCollectionVersion: manifest.collectionVersion,
    manifestHash: manifest.manifestHash,
    mode: "preview",
    sourceUrl: manifest.job.url,
    adapterVersion: "unit-native-preview-v1",
    status: "filled",
    fields: [{ questionId: question.id, fieldKey: "website", status: "omitted" }],
  };
}

describe("optional blank preparation observations", () => {
  it("records omission idempotently without inventing an answer or changing submission facts", async () => {
    const f = await preparationFixture([optionalDefinition()]);
    const before = await f.preparation.get(f.userId, f.job.id);
    const updatedAt = f.job.updatedAt.getTime();
    const workState = f.workItems[0].state;
    const input = omission(before);
    const saved = await f.preparation.result(f.userId, f.job.id, input, "agent");
    expect(saved.status).toBe("filled");
    expect(saved.verification).toBe("observed");
    expect(saved.submissionAllowed).toBe(false);
    expect((await f.preparation.result(f.userId, f.job.id, input, "agent")).id).toBe(saved.id);
    expect(f.preparationResults).toHaveLength(1);
    expect(f.questionAnswers).toHaveLength(0);
    expect(f.documentSelections).toHaveLength(0);
    expect(f.submissions).toHaveLength(0);
    expect(f.job.updatedAt.getTime()).toBe(updatedAt);
    expect(f.workItems[0].state).toBe(workState);
    expect(await f.preparation.get(f.userId, f.job.id)).toEqual(before);
  });

  it.each([
    "text",
    "email",
    "phone",
    "number",
    "date",
    "single_choice",
    "multi_choice",
    "boolean",
  ] as const)(
    "can record an observed blank optional %s field without submitting a value",
    async (type) => {
      const f = await preparationFixture([
        optionalDefinition({
          fields: [
            {
              key: "website",
              label: "Website",
              type,
              options: ["single_choice", "multi_choice"].includes(type)
                ? [{ value: "portfolio", label: "Portfolio" }]
                : [],
            },
          ],
        }),
      ]);
      const saved = await f.preparation.result(
        f.userId,
        f.job.id,
        omission(await f.preparation.get(f.userId, f.job.id)),
        "agent",
      );
      expect(saved.status).toBe("filled");
      expect(f.questionAnswers).toHaveLength(0);
    },
  );

  it("allows verified required readback plus omission but never substitutes omission for required evidence", async () => {
    const f = await preparationFixture([questionDefinition(), optionalDefinition()]);
    const required = f.snapshot.questions.find(
      (question) => question.definition.required === "required",
    )!;
    await f.questionsService.answer(f.userId, required.id, f.answer(required), "session_user");
    const input = omission(await f.preparation.get(f.userId, f.job.id));
    await expect(f.preparation.result(f.userId, f.job.id, input, "agent")).rejects.toMatchObject({
      status: 409,
    });
    input.fields.push({
      questionId: required.id,
      fieldKey: "authorization",
      status: "verified",
      value: "yes",
    });
    expect((await f.preparation.result(f.userId, f.job.id, input, "agent")).status).toBe("filled");
  });

  const unsupported: [string, Partial<QuestionDefinition>][] = [
    ["required all-group member", { required: "required" }],
    ["required any-group member", { required: "required", groupMode: "any" }],
    ["unknown requirement", { required: "unknown" }],
    ["hidden field", { visibility: "hidden" }],
    ["unknown visibility", { visibility: "unknown" }],
    ["unknown condition", { condition: { state: "unknown", rules: [] } }],
    [
      "known condition",
      {
        condition: {
          state: "known",
          rules: [{ fieldKey: "parent", operator: "equals", values: ["yes"] }],
        },
      },
    ],
    ["file upload", { fields: [{ key: "website", type: "file", options: [] }] }],
    ["unknown custom control", { fields: [{ key: "website", type: "unknown", options: [] }] }],
    [
      "choice without known options",
      { fields: [{ key: "website", type: "single_choice", options: [] }] },
    ],
    [
      "option with custom free text",
      {
        fields: [
          {
            key: "website",
            type: "single_choice",
            options: [{ label: "Other", value: "other", freeText: "optional" }],
          },
        ],
      },
    ],
    ["password", { prompt: "Optional password" }],
    ["verification code", { prompt: "Verification code" }],
    ["CAPTCHA", { prompt: "CAPTCHA verification" }],
  ];
  it.each(unsupported)(
    "rejects omission of a %s even for partial evidence",
    async (_name, overrides) => {
      const f = await preparationFixture([optionalDefinition(overrides)]);
      const input = omission(await f.preparation.get(f.userId, f.job.id));
      input.status = "partial";
      await expect(f.preparation.result(f.userId, f.job.id, input, "agent")).rejects.toMatchObject({
        status: 409,
      });
      expect(f.preparationResults).toHaveLength(0);
    },
  );

  it("refuses a confirmed optional answer and a stale manifest after that answer is supplied", async () => {
    const f = await preparationFixture([optionalDefinition()]);
    const previous = omission(await f.preparation.get(f.userId, f.job.id));
    const question = f.snapshot.questions[0];
    await f.questionsService.answer(
      f.userId,
      question.id,
      f.answer(question, "https://example.test"),
      "session_user",
    );
    for (const input of [previous, omission(await f.preparation.get(f.userId, f.job.id))])
      await expect(f.preparation.result(f.userId, f.job.id, input, "agent")).rejects.toMatchObject({
        status: 409,
      });
    expect(f.preparationResults).toHaveLength(0);
    expect(f.questionAnswers).toHaveLength(1);
  });

  const suppliedValues: {
    value: NonNullable<PreparationResultInput["fields"][number]["value"]>;
  }[] = ["", "browser default", false, 0, []].map((value) => ({ value }));
  it.each(suppliedValues)(
    "refuses supplied value %j rather than treating it as blank",
    async ({ value }) => {
      const f = await preparationFixture([optionalDefinition()]);
      const input = omission(await f.preparation.get(f.userId, f.job.id));
      input.fields[0].value = value;
      await expect(f.preparation.result(f.userId, f.job.id, input, "agent")).rejects.toMatchObject({
        status: 409,
      });
      expect(f.questionAnswers).toHaveLength(0);
    },
  );

  it("refuses any PDF identity on an omitted field", async () => {
    const f = await preparationFixture([optionalDefinition()]);
    const input = omission(await f.preparation.get(f.userId, f.job.id));
    input.fields[0].pdfSha256 = "a".repeat(64);
    await expect(f.preparation.result(f.userId, f.job.id, input, "agent")).rejects.toMatchObject({
      status: 409,
    });
  });
});
