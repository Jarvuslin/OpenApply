import type { prismaFixture } from "@/common/testing/prisma-fakes";

export function collectReadyJob(
  fixture: ReturnType<typeof prismaFixture>,
  userId: string,
  job: { id: string; url: string },
) {
  const collectionId = crypto.randomUUID();
  const questionId = crypto.randomUUID();
  fixture.questionCollections.push({
    id: collectionId,
    userId,
    jobId: job.id,
    version: 1,
    coverage: "complete",
    source: "browser_dom",
    sourceUrl: job.url,
    collectorVersion: "synthetic-ready-v1",
    authorship: "session_user",
    observedAt: new Date(),
    definitionIds: [questionId],
  });
  fixture.applicationQuestions.push({
    id: questionId,
    userId,
    jobId: job.id,
    collectionId,
    stableKey: "fields:optional_note",
    revision: 1,
    definitionHash: "a".repeat(64),
    definition: {
      stableKey: "fields:optional_note",
      prompt: "Optional note",
      required: "optional",
      visibility: "visible",
      condition: { state: "unconditional", rules: [] },
      groupMode: "all",
      fields: [{ key: "optional_note", label: "Optional note", type: "text", options: [] }],
    },
    current: true,
    blocking: false,
    createdAt: new Date(),
  });
}
