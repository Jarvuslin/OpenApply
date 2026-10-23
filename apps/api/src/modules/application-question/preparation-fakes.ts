import type {
  ApplicationQuestionView,
  QuestionDefinition,
} from "@openapply/contracts/application-question";
import { resumeDataSchema } from "@openapply/contracts/resume";
import type { ResumeArtifactService } from "@/modules/resume/resume-artifact.service";
import { sha256 } from "@/modules/resume/resume-artifact-store";
import { ApplicationPreparationService } from "./application-preparation.service";
import { questionDefinition, questionFixture } from "./fakes";

export function fileDefinition(): QuestionDefinition {
  return {
    ...questionDefinition("resume"),
    prompt: "Resume",
    fields: [{ key: "resume", type: "file", label: "Resume", options: [] }],
  };
}
export async function preparationFixture(definitions = [fileDefinition()]) {
  const f = questionFixture();
  const bytes = Buffer.from("%PDF-unit-fixture-not-acceptance");
  const content = resumeDataSchema.parse({ basics: { name: "Synthetic Unit Fixture" } });
  const resume = {
    id: crypto.randomUUID(),
    userId: f.userId,
    label: "Original",
    version: 1,
    content,
    sourceFilename: null,
    updatedAt: new Date(),
  };
  f.resumes.push(resume);
  const artifact = {
    revision: "a".repeat(64),
    resumeId: resume.id,
    variantId: null,
    contentSha256: sha256(content),
    pdfSha256: sha256(bytes),
    sizeBytes: bytes.length,
    source: { version: 1, filename: null, sha256: null, contentSha256: sha256(content) },
    job: { url: null },
  };
  const reads: unknown[][] = [];
  const state = { corrupt: false };
  const artifacts = {
    get: async (...args: unknown[]) => {
      reads.push(args);
      if (state.corrupt || args[3] !== artifact.revision)
        throw new Error("Fixture artifact integrity failure");
      return artifact;
    },
    file: async () =>
      new Response(bytes, {
        headers: {
          "content-type": "application/pdf",
          "x-content-sha256": artifact.pdfSha256,
          "content-length": String(bytes.length),
        },
      }),
  } as unknown as ResumeArtifactService;
  f.artifactReader.get = async (...args: unknown[]) =>
    artifacts.get(
      args[0] as string,
      args[1] as string,
      args[2] as string | undefined,
      args[3] as string,
    );
  f.job.status = "approved";
  await f.queue.enqueue(f.userId, {
    jobIds: [f.job.id],
    idempotencyKey: crypto.randomUUID(),
    source: "user",
    provider: "codex",
  });
  const snapshot = await f.questionsService.observe(
    f.userId,
    f.job.id,
    f.observe(0, definitions),
    "agent",
  );
  const service = new ApplicationPreparationService(f.db, artifacts);
  const select = (question: ApplicationQuestionView = snapshot.questions[0]) => ({
    requestId: crypto.randomUUID(),
    jobId: f.job.id,
    expectedCollectionVersion: snapshot.collectionVersion,
    expectedRevision: question.revision,
    expectedDefinitionHash: question.definitionHash,
    fieldKey: question.definition.fields.find((field) => field.type === "file")?.key ?? "resume",
    resumeId: resume.id,
    artifactRevision: artifact.revision,
    expectedSelectionId: null,
    confirmed: true as const,
  });
  return {
    ...f,
    preparation: service,
    resume,
    artifact,
    artifacts,
    reads,
    bytes,
    integrity: state,
    snapshot,
    select,
  };
}
