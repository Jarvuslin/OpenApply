-- Chat is removed. Its threads, runs and messages go; the two enums queue work still uses are
-- renamed for what they type now.

-- Queue rows that came from chat keep running as migrated work.
UPDATE "work_items" SET "source" = 'migration' WHERE "source" = 'chat';
CREATE TYPE "work_source_new" AS ENUM ('user', 'campaign', 'mvp', 'discovery', 'pilot', 'migration');
ALTER TABLE "work_items" ALTER COLUMN "source" TYPE "work_source_new" USING ("source"::text::"work_source_new");
ALTER TYPE "work_source" RENAME TO "work_source_old";
ALTER TYPE "work_source_new" RENAME TO "work_source";
DROP TYPE "work_source_old";

ALTER TYPE "chat_provider" RENAME TO "agent_provider";
ALTER TYPE "chat_message_kind" RENAME TO "agent_event_kind";

-- A chat message cannot be cited any more. The statement stays, unverified, under a new revision
-- so tailored resumes that cited the old revision see it as stale.
UPDATE "resume_evidence"
SET
  "source" = jsonb_build_object('kind', 'unverified', 'note', left("source"->>'quote', 2000)),
  "status" = CASE WHEN "status" = 'retracted' THEN 'retracted'::"resume_evidence_status" ELSE 'unverified'::"resume_evidence_status" END,
  "verification" = "verification" || jsonb_build_object(
    'sourceSha256', NULL, 'sourceRecord', 'Unverified optional detail', 'sourceUrl', NULL, 'authorLogin', NULL),
  "revision" = "revision" + 1,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "source"->>'kind' = 'chat'
  OR ("source"->>'kind' = 'github' AND "source"->'attribution'->>'kind' = 'chat');

-- Tailored resumes keep evidence snapshots that the variant detail response still validates.
UPDATE "resume_variants" AS v
SET "rewrites" = jsonb_set(v."rewrites", '{additionalEvidence}', (
  SELECT jsonb_agg(
    CASE
      WHEN e->'source'->>'kind' = 'chat'
        OR (e->'source'->>'kind' = 'github' AND e->'source'->'attribution'->>'kind' = 'chat')
      THEN e || jsonb_build_object(
        'source', jsonb_build_object('kind', 'unverified', 'note', left(e->'source'->>'quote', 2000)),
        'status', CASE WHEN e->>'status' = 'retracted' THEN 'retracted' ELSE 'unverified' END)
      ELSE e
    END ORDER BY t.ord)
  FROM jsonb_array_elements(v."rewrites"->'additionalEvidence') WITH ORDINALITY AS t(e, ord)
))
WHERE jsonb_typeof(v."rewrites"->'additionalEvidence') = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v."rewrites"->'additionalEvidence') AS e
    WHERE e->'source'->>'kind' = 'chat'
      OR (e->'source'->>'kind' = 'github' AND e->'source'->'attribution'->>'kind' = 'chat'));

DELETE FROM "pilot_questions" WHERE "subject_type" = 'chat';

ALTER TABLE "employer_account_attempts" DROP COLUMN "chat_thread_id";

DROP TABLE "chat_messages";
DROP TABLE "chat_runs";
DROP TABLE "chat_threads";

DROP TYPE "chat_agent";
DROP TYPE "chat_role";
DROP TYPE "chat_run_status";
DROP TYPE "chat_origin";
