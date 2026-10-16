import type {
  ApplicationPreparation,
  PreparationResultInput,
} from "@openapply/contracts/application-preparation";
import { questionDefinition } from "./fakes";
import { fileDefinition, preparationFixture } from "./preparation-fakes";
import { describe, expect, it } from "bun:test";

function result(manifest: ApplicationPreparation): PreparationResultInput {
  return {
    requestId: crypto.randomUUID(),
    expectedCollectionVersion: manifest.collectionVersion,
    manifestHash: manifest.manifestHash,
    mode: manifest.mode,
    sourceUrl: manifest.job.url,
    adapterVersion: "unit-preview-v1",
    status: "filled",
    fields: manifest.questions.flatMap((question) => [
      ...(question.answer?.values.map((value) => ({
        questionId: question.id,
        fieldKey: value.fieldKey,
        status: "verified" as const,
        value: value.value,
      })) ?? []),
      ...manifest.documentFields
        .filter((field) => field.questionId === question.id && field.selection?.available)
        .map((field) => ({
          questionId: question.id,
          fieldKey: field.fieldKey,
          status: "verified" as const,
          pdfSha256: field.selection?.pdfSha256,
        })),
    ]),
  };
}
describe("model-free preparation evidence", () => {
  it("stores observed readback once without promoting factual answers or coverage", async () => {
    const f = await preparationFixture();
    await f.preparation.selectDocument(
      f.userId,
      f.snapshot.questions[0].id,
      f.select(),
      "session_user",
    );
    const manifest = await f.preparation.get(f.userId, f.job.id);
    const input = result(manifest);
    const saved = await f.preparation.result(f.userId, f.job.id, input, "agent");
    expect(saved.verification).toBe("observed");
    expect(saved.submissionAllowed).toBe(false);
    expect((await f.preparation.result(f.userId, f.job.id, input, "agent")).id).toBe(saved.id);
    expect(f.preparationResults).toHaveLength(1);
    expect(f.questionAnswers).toHaveLength(0);
    expect(f.submissions).toHaveLength(0);
    await expect(
      f.preparation.result(f.userId, f.job.id, { ...input, reason: "changed" }, "agent"),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("requires complete exact readbacks and rejects missing, wrong, duplicate or invented fields", async () => {
    const f = await preparationFixture([fileDefinition(), questionDefinition()]);
    const file = f.snapshot.questions.find((question) => question.category === "document")!;
    const text = f.snapshot.questions.find((question) => question.category === "authorization")!;
    await f.preparation.selectDocument(f.userId, file.id, f.select(file), "session_user");
    await f.questionsService.answer(f.userId, text.id, f.answer(text), "session_user");
    const input = result(await f.preparation.get(f.userId, f.job.id));
    for (const fields of [
      [],
      input.fields.slice(0, 1),
      [...input.fields, input.fields[0]],
      input.fields.map((field) => ({ ...field, questionId: crypto.randomUUID() })),
      input.fields.map((field) => (field.value ? { ...field, value: "no" } : field)),
    ])
      await expect(
        f.preparation.result(
          f.userId,
          f.job.id,
          { ...input, requestId: crypto.randomUUID(), fields },
          "agent",
        ),
      ).rejects.toMatchObject({ status: 409 });
    const withoutValue = input.fields.map((field) => ({ ...field, value: undefined }));
    await expect(
      f.preparation.result(f.userId, f.job.id, { ...input, fields: withoutValue }, "agent"),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.preparationResults).toHaveLength(0);
    await f.preparation.result(f.userId, f.job.id, input, "agent");
    expect(f.preparationResults).toHaveLength(1);
  });
  it("refuses stale manifests, wrong job source URLs and unconfirmed historical answers", async () => {
    const f = await preparationFixture([questionDefinition()]);
    const question = f.snapshot.questions[0];
    f.questionAnswers.push({
      id: crypto.randomUUID(),
      questionId: question.id,
      userId: f.userId,
      values: [{ fieldKey: "authorization", value: "yes" }],
      authorship: "migration",
      confirmedAt: null,
      createdAt: new Date(),
    });
    expect((await f.preparation.get(f.userId, f.job.id)).questions[0].answer).toBeNull();
    await f.questionsService.answer(f.userId, question.id, f.answer(question), "session_user");
    const input = result(await f.preparation.get(f.userId, f.job.id));
    await expect(
      f.preparation.result(
        f.userId,
        f.job.id,
        { ...input, sourceUrl: "https://other.example.test/role" },
        "agent",
      ),
    ).rejects.toMatchObject({ status: 400 });
    await f.questionsService.answer(
      f.userId,
      question.id,
      f.answer(question, "no"),
      "session_user",
    );
    await expect(f.preparation.result(f.userId, f.job.id, input, "agent")).rejects.toMatchObject({
      status: 409,
    });
  });
  it("requires the exact active application lease for worker-mode form mutations", async () => {
    const f = await preparationFixture();
    await f.preparation.selectDocument(
      f.userId,
      f.snapshot.questions[0].id,
      f.select(),
      "session_user",
    );
    await expect(f.preparation.get(f.userId, f.job.id, { mode: "worker" })).rejects.toMatchObject({
      status: 409,
    });
    const claim = await f.queue.claim(f.userId);
    expect(claim).not.toBeNull();
    const work = f.workItems[0];
    const id = String(work.id);
    const lease = String(work.leaseToken);
    const manifest = await f.preparation.get(f.userId, f.job.id, { mode: "worker" }, id, lease);
    expect(manifest.mode).toBe("worker");
    await expect(
      f.preparation.result(f.userId, f.job.id, result(manifest), "agent", id, crypto.randomUUID()),
    ).rejects.toMatchObject({ status: 409 });
    f.workItems[0].pauseRequestedAt = new Date();
    await expect(
      f.preparation.get(f.userId, f.job.id, { mode: "worker" }, id, lease),
    ).rejects.toMatchObject({ status: 409 });
    expect((await f.preparation.get(f.userId, f.job.id)).mode).toBe("preview");
  });
  it("detects corrupted artifact bytes before download and refuses old successful readback", async () => {
    const f = await preparationFixture();
    const selected = await f.preparation.selectDocument(
      f.userId,
      f.snapshot.questions[0].id,
      f.select(),
      "session_user",
    );
    const input = result(await f.preparation.get(f.userId, f.job.id));
    f.integrity.corrupt = true;
    const changed = await f.preparation.get(f.userId, f.job.id);
    expect(changed.documentFields[0].selection?.available).toBe(false);
    expect(changed.questions[0].blocking).toBe(true);
    await expect(f.preparation.file(f.userId, selected.id)).rejects.toThrow("integrity");
    await expect(f.preparation.result(f.userId, f.job.id, input, "agent")).rejects.toMatchObject({
      status: 409,
    });
  });
});
