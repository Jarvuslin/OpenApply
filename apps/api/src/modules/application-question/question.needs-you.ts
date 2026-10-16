import {
  type NeedsYouQuery,
  needsYouCountSchema,
  needsYouListSchema,
} from "@openapply/contracts/application-question";
import { pageSlice, paginate } from "@openapply/contracts/pagination";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { pilotQuestionView } from "@/modules/pilot/question.view";
import { questionInclude, questionView } from "./question.store";

function openRows(userId: string, kind: NeedsYouQuery["kind"]) {
  return Prisma.sql`
    SELECT q.id, 'application' AS kind, q.created_at FROM application_questions q JOIN jobs j ON j.id = q.job_id
    WHERE q.user_id = ${userId} AND q.current = true AND q.blocking = true AND j.status NOT IN ('applied', 'skipped') AND ${kind} IN ('all', 'application')
    UNION ALL
    SELECT id, 'operational' AS kind, created_at FROM pilot_questions
    WHERE user_id = ${userId} AND application_question_id IS NULL AND status = 'open'
      AND (expires_at IS NULL OR expires_at > NOW()) AND ${kind} IN ('all', 'operational')
    UNION ALL
    SELECT c.id, 'collection' AS kind, c.observed_at AS created_at FROM job_question_collections c JOIN jobs j ON j.id = c.job_id
    WHERE j.status NOT IN ('applied', 'skipped') AND c.user_id = ${userId} AND c.coverage != 'complete' AND ${kind} IN ('all', 'collection')
      AND NOT EXISTS (SELECT 1 FROM job_question_collections newer WHERE newer.job_id = c.job_id AND newer.version > c.version)
  `;
}

export async function countNeedsYou(tx: Prisma.TransactionClient, userId: string) {
  const rows = await tx.$queryRaw<{ kind: string; total: bigint }[]>(
    Prisma.sql`SELECT kind, COUNT(*) AS total FROM (${openRows(userId, "all")}) AS attention GROUP BY kind`,
  );
  const application = Number(rows.find((row) => row.kind === "application")?.total ?? 0);
  const operational = Number(rows.find((row) => row.kind === "operational")?.total ?? 0);
  const collection = Number(rows.find((row) => row.kind === "collection")?.total ?? 0);
  return needsYouCountSchema.parse({
    application,
    operational,
    collection,
    total: application + operational + collection,
  });
}

export async function listNeedsYou(prisma: PrismaClient, userId: string, query: NeedsYouQuery) {
  return prisma.$transaction(
    async (tx) => {
      const { skip, take } = pageSlice(query);
      const rows = await tx.$queryRaw<{ id: string; kind: string }[]>(
        Prisma.sql`SELECT id, kind FROM (${openRows(userId, query.kind)}) AS attention WHERE (${query.target ?? null}::text IS NULL OR id = ${query.target ?? null}) ORDER BY created_at DESC, kind, id LIMIT ${take} OFFSET ${skip}`,
      );
      const counts = await countNeedsYou(tx, userId);
      const [questions, operational, collections] = await Promise.all([
        tx.applicationQuestion.findMany({
          where: {
            userId,
            id: { in: rows.filter((row) => row.kind === "application").map((row) => row.id) },
          },
          include: { ...questionInclude, job: true },
        }),
        tx.pilotQuestion.findMany({
          where: {
            userId,
            id: { in: rows.filter((row) => row.kind === "operational").map((row) => row.id) },
          },
        }),
        tx.jobQuestionCollection.findMany({
          where: {
            userId,
            id: { in: rows.filter((row) => row.kind === "collection").map((row) => row.id) },
          },
          include: { job: true },
        }),
      ]);
      const items = rows.map((row) => {
        if (row.kind === "application") {
          const question = questions.find((question) => question.id === row.id);
          if (!question)
            throw new Error("Question disappeared within a consistent attention snapshot.");
          return {
            kind: "application" as const,
            id: question.id,
            job: question.job,
            question: questionView(question),
          };
        }
        if (row.kind === "collection") {
          const collection = collections.find((collection) => collection.id === row.id);
          if (!collection)
            throw new Error("Collection disappeared within a consistent attention snapshot.");
          return {
            kind: "collection" as const,
            id: collection.id,
            job: collection.job,
            collection: { ...collection, verification: "observed" as const },
          };
        }
        const question = operational.find((question) => question.id === row.id);
        if (!question)
          throw new Error(
            "Operational question disappeared within a consistent attention snapshot.",
          );
        return {
          kind: "operational" as const,
          id: question.id,
          question: pilotQuestionView(question),
        };
      });
      let total = query.kind === "all" ? counts.total : counts[query.kind];
      if (query.target) {
        const [targetCount] = await tx.$queryRaw<{ total: bigint }[]>(
          Prisma.sql`SELECT COUNT(*) AS total FROM (${openRows(userId, query.kind)}) AS attention WHERE id = ${query.target}`,
        );
        total = Number(targetCount?.total ?? 0);
      }
      return needsYouListSchema.parse(paginate(items, query, total));
    },
    { isolationLevel: "RepeatableRead" },
  );
}
