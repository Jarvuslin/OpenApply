import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resumeDataSchema } from "@openapply/contracts/resume";
import { db } from "../src/common/database/prisma.client";
import { RESUME_TEMPLATE } from "../src/common/pdf/canonical-template";
import { renderResumeArtifact } from "../src/common/pdf/render";
import { env } from "../src/env";
import { ApplicationPreparationService } from "../src/modules/application-question/application-preparation.service";
import { ApplicationQuestionService } from "../src/modules/application-question/application-question.service";
import { ResumeArtifactService } from "../src/modules/resume/resume-artifact.service";
import { ResumeArtifactStore, sha256 } from "../src/modules/resume/resume-artifact-store";
import { definition, fixture, observation, uuid } from "./question-regression-fixtures";

export const questions = new ApplicationQuestionService(db);
export const artifacts = new ResumeArtifactService(db);
export const preparation = new ApplicationPreparationService(db, artifacts);
const content = resumeDataSchema.parse({
  basics: { name: "Questions Fixture", email: "documents@questions.example.test" },
  summary: "Synthetic applicant used only for deterministic software verification.",
  skills: [{ group: "Fixture skills", items: ["TypeScript", "Automated testing"] }],
});
let compiled: ReturnType<typeof renderResumeArtifact> | undefined;
export async function ownedArtifact(userId: string) {
  compiled ??= renderResumeArtifact(content, {
    executable: process.env.OPENAPPLY_TECTONIC_PATH,
    onlyCached: true,
    timeoutMs: 60000,
  });
  const result = await compiled;
  const filename = `${uuid()}.pdf`;
  const sourceDirectory = path.resolve(env.STORAGE_ROOT, "resumes");
  await mkdir(sourceDirectory, { recursive: true });
  await writeFile(path.join(sourceDirectory, filename), result.pdf, { flag: "wx" });
  const resume = await db.resume.create({
    data: {
      userId,
      label: "Synthetic canonical resume",
      content,
      sourceFilename: filename,
      sourceMimeType: "application/pdf",
      sourceSizeBytes: result.pdf.length,
    },
  });
  const store = new ResumeArtifactStore(path.resolve(env.STORAGE_ROOT, "resume-artifacts"));
  const artifact = await store.create(
    {
      userId,
      resumeId: resume.id,
      variantId: null,
      content,
      template: RESUME_TEMPLATE,
      document: { jobUrl: null, diffNotes: null, audit: null },
      source: {
        version: resume.version,
        filename,
        sha256: sha256(result.pdf),
        content,
        contentSha256: sha256(content),
      },
      job: { url: null, description: null, sha256: null },
    },
    async () => result,
  );
  return { resume, artifact, bytes: result.pdf };
}

export function fileDefinition(prompt = "Resume", key = "resume") {
  return {
    ...definition(`fields:${key}`, prompt),
    fields: [{ key, label: prompt, type: "file" as const, options: [] }],
  };
}

export async function documentFixture(
  label: string,
  options: {
    email?: string;
    password?: string;
    prompt?: string;
    url?: string;
  } = {},
) {
  const f = await fixture(label, options);
  if (options.url)
    f.job = await db.job.update({ where: { id: f.job.id }, data: { url: options.url } });
  const owned = await ownedArtifact(f.user.id);
  await questions.observe(
    f.user.id,
    f.job.id,
    observation(f, [fileDefinition(options.prompt)]),
    "agent",
  );
  const snapshot = await questions.get(f.user.id, f.job.id);
  const question = snapshot.questions[0];
  assert.ok(question);
  const input = {
    requestId: uuid(),
    jobId: f.job.id,
    expectedCollectionVersion: snapshot.collectionVersion,
    expectedRevision: question.revision,
    expectedDefinitionHash: question.definitionHash,
    fieldKey: "resume",
    resumeId: owned.resume.id,
    artifactRevision: owned.artifact.revision,
    expectedSelectionId: null,
    confirmed: true as const,
  };
  return { ...f, ...owned, question, input };
}
