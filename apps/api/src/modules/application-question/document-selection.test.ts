import { fileDefinition, preparationFixture } from "./preparation-fakes";
import { hasJobQuestionBlockers } from "./question.resume";
import { describe, expect, it } from "bun:test";

describe("explicit resume document selections", () => {
  for (const prompt of ["Resume PDF *", "Resume PDF *"])
    it(`accepts the exact reviewed ATS resume label ${prompt}`, async () => {
      const definition = fileDefinition();
      definition.prompt = prompt;
      definition.fields[0].label = prompt;
      const f = await preparationFixture([definition]);
      expect(
        (
          await f.preparation.selectDocument(
            f.userId,
            f.snapshot.questions[0].id,
            f.select(),
            "session_user",
          )
        ).available,
      ).toBe(true);
    });
  it("resolves a parked file blocker without a lease, deduplicates selection, and downloads verified bytes", async () => {
    const f = await preparationFixture();
    const question = f.snapshot.questions[0];
    const input = f.select();
    expect(f.workItems[0].state).toBe("needs_user");
    const selected = await f.preparation.selectDocument(
      f.userId,
      question.id,
      input,
      "session_user",
    );
    const repeated = await f.preparation.selectDocument(
      f.userId,
      question.id,
      input,
      "session_user",
    );
    expect(repeated.id).toBe(selected.id);
    expect(f.documentSelections).toHaveLength(1);
    expect(f.questionAnswers).toHaveLength(0);
    expect(f.workItems[0].state).toBe("queued");
    const manifest = await f.preparation.get(f.userId, f.job.id);
    expect(manifest.documentFields[0].selection?.pdfSha256).toBe(f.artifact.pdfSha256);
    expect(manifest.questions[0].blocking).toBe(false);
    expect(manifest.submissionAllowed).toBe(false);
    expect(
      Buffer.from(await (await f.preparation.file(f.userId, selected.id)).arrayBuffer()),
    ).toEqual(f.bytes);
    await expect(
      f.preparation.selectDocument(
        f.userId,
        question.id,
        { ...input, artifactRevision: "b".repeat(64) },
        "session_user",
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("enforces human, owner, revision and compare-and-swap selection authority", async () => {
    const f = await preparationFixture();
    const id = f.snapshot.questions[0].id;
    const input = f.select();
    await expect(f.preparation.selectDocument(f.userId, id, input, "agent")).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      f.preparation.selectDocument(crypto.randomUUID(), id, input, "session_user"),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      f.preparation.selectDocument(f.userId, id, { ...input, expectedRevision: 2 }, "session_user"),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      f.preparation.selectDocument(
        f.userId,
        id,
        { ...input, resumeId: crypto.randomUUID() },
        "session_user",
      ),
    ).rejects.toMatchObject({ status: 404 });
    const attempts = await Promise.allSettled([
      f.preparation.selectDocument(f.userId, id, input, "session_user"),
      f.preparation.selectDocument(
        f.userId,
        id,
        { ...input, requestId: crypto.randomUUID() },
        "session_user",
      ),
    ]);
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(f.documentSelections).toHaveLength(1);
  });
  for (const prompt of ["Cover letter", "Supporting documents", "Resume and cover letter"])
    it(`does not turn ${prompt} into a resume upload`, async () => {
      const definition = fileDefinition();
      definition.prompt = prompt;
      definition.fields[0].label = prompt;
      const f = await preparationFixture([definition]);
      await expect(
        f.preparation.selectDocument(
          f.userId,
          f.snapshot.questions[0].id,
          f.select(),
          "session_user",
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect((await f.preparation.get(f.userId, f.job.id)).documentFields[0].purpose).toBe(
        "unsupported",
      );
    });
  it("combines selected files and confirmed values without accepting a filename as an answer", async () => {
    const definition = fileDefinition();
    definition.prompt = "Application documents";
    definition.fields.push({ key: "note", label: "Explanation", type: "text", options: [] });
    const f = await preparationFixture([definition]);
    const question = f.snapshot.questions[0];
    await expect(
      f.questionsService.answer(
        f.userId,
        question.id,
        {
          ...f.answer(question),
          values: [
            { fieldKey: "resume", value: "resume.pdf" },
            { fieldKey: "note", value: "Confirmed explanation" },
          ],
        },
        "session_user",
      ),
    ).rejects.toMatchObject({ status: 400 });
    await f.preparation.selectDocument(f.userId, question.id, f.select(), "session_user");
    expect(f.workItems[0].state).toBe("needs_user");
    await f.questionsService.answer(
      f.userId,
      question.id,
      { ...f.answer(question), values: [{ fieldKey: "note", value: "Confirmed explanation" }] },
      "session_user",
    );
    expect(f.workItems[0].state).toBe("queued");
    expect(f.questionAnswers).toHaveLength(1);
  });
  it("keeps any-alternative groups satisfied by text without forcing a file", async () => {
    const definition = fileDefinition();
    definition.groupMode = "any";
    definition.fields.push({ key: "text", label: "Resume text", type: "text", options: [] });
    const f = await preparationFixture([definition]);
    const question = f.snapshot.questions[0];
    await f.questionsService.answer(
      f.userId,
      question.id,
      {
        ...f.answer(question),
        values: [{ fieldKey: "text", value: "Human-confirmed resume text" }],
      },
      "session_user",
    );
    expect(f.workItems[0].state).toBe("queued");
    expect(f.documentSelections).toHaveLength(0);
  });
  it("invalidates replaced or deleted sources and changed question revisions before download or claim", async () => {
    const f = await preparationFixture();
    const selected = await f.preparation.selectDocument(
      f.userId,
      f.snapshot.questions[0].id,
      f.select(),
      "session_user",
    );
    f.resume.version++;
    expect(await hasJobQuestionBlockers(f.db, f.userId, f.job.id)).toBe(true);
    expect(
      (await f.preparation.get(f.userId, f.job.id)).documentFields[0].selection?.available,
    ).toBe(false);
    await expect(f.preparation.file(f.userId, selected.id)).rejects.toMatchObject({ status: 409 });
    f.resumes.splice(0);
    await expect(f.preparation.file(f.userId, selected.id)).rejects.toMatchObject({ status: 409 });
    const definition = fileDefinition();
    definition.prompt = "Upload your resume";
    const next = await f.questionsService.observe(
      f.userId,
      f.job.id,
      f.observe(1, [definition]),
      "agent",
    );
    expect(next.questions[0].revision).toBe(2);
    expect(next.questions[0].blocking).toBe(true);
    await expect(f.preparation.file(f.userId, selected.id)).rejects.toMatchObject({ status: 409 });
  });
  it("resumes despite partial coverage and refuses ambiguous or already submitted preparation", async () => {
    const f = await preparationFixture();
    f.questionCollections[0].coverage = "partial";
    await f.preparation.selectDocument(
      f.userId,
      f.snapshot.questions[0].id,
      f.select(),
      "session_user",
    );
    expect(f.workItems[0].state).toBe("queued");
    f.submissions.push({
      id: crypto.randomUUID(),
      userId: f.userId,
      jobId: f.job.id,
      canonicalUrl: f.job.url,
      startedAt: new Date(),
    });
    await expect(f.preparation.get(f.userId, f.job.id)).rejects.toMatchObject({ status: 409 });
  });
});
