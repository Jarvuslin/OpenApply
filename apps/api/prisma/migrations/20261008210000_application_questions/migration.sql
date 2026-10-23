-- CreateEnum
CREATE TYPE "question_source" AS ENUM ('greenhouse_public', 'public_probe', 'browser_dom', 'legacy');

-- CreateEnum
CREATE TYPE "question_coverage" AS ENUM ('complete', 'partial', 'requires_browser', 'blocked');

-- CreateEnum
CREATE TYPE "question_category" AS ENUM ('authorization', 'sponsorship', 'demographic', 'disability', 'veteran', 'contact', 'document', 'other');

-- CreateEnum
CREATE TYPE "question_requirement" AS ENUM ('required', 'optional', 'unknown');

-- CreateEnum
CREATE TYPE "question_visibility" AS ENUM ('visible', 'hidden', 'unknown');

-- CreateEnum
CREATE TYPE "question_authorship" AS ENUM ('session_user', 'agent', 'migration');

-- AlterTable
ALTER TABLE "pilot_questions" ADD COLUMN     "application_question_id" TEXT;

-- CreateTable
CREATE TABLE "job_question_collections" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "source" "question_source" NOT NULL,
    "source_url" TEXT NOT NULL,
    "coverage" "question_coverage" NOT NULL,
    "collector_version" TEXT NOT NULL,
    "authorship" "question_authorship" NOT NULL,
    "reason" TEXT,
    "definition_ids" JSONB NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_question_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_questions" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "collection_id" TEXT NOT NULL,
    "stable_key" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "definition_hash" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "category" "question_category" NOT NULL,
    "required" "question_requirement" NOT NULL,
    "visibility" "question_visibility" NOT NULL,
    "current" BOOLEAN NOT NULL DEFAULT true,
    "blocking" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_question_answers" (
    "id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "values" JSONB NOT NULL,
    "authorship" "question_authorship" NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_question_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_question_collections_user_id_job_id_idx" ON "job_question_collections"("user_id", "job_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_question_collections_user_id_request_id_key" ON "job_question_collections"("user_id", "request_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_question_collections_job_id_version_key" ON "job_question_collections"("job_id", "version");

-- CreateIndex
CREATE INDEX "application_questions_user_id_current_blocking_created_at_idx" ON "application_questions"("user_id", "current", "blocking", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "application_questions_job_id_stable_key_revision_key" ON "application_questions"("job_id", "stable_key", "revision");

-- CreateIndex
CREATE INDEX "application_question_answers_question_id_created_at_idx" ON "application_question_answers"("question_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "application_question_answers_user_id_request_id_key" ON "application_question_answers"("user_id", "request_id");

-- AddForeignKey
ALTER TABLE "job_question_collections" ADD CONSTRAINT "job_question_collections_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_question_collections" ADD CONSTRAINT "job_question_collections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_questions" ADD CONSTRAINT "application_questions_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_questions" ADD CONSTRAINT "application_questions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_questions" ADD CONSTRAINT "application_questions_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "job_question_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_question_answers" ADD CONSTRAINT "application_question_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "application_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_question_answers" ADD CONSTRAINT "application_question_answers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pilot_questions" ADD CONSTRAINT "pilot_questions_application_question_id_fkey" FOREIGN KEY ("application_question_id") REFERENCES "application_questions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "application_questions_one_current_revision" ON "application_questions" ("job_id", "stable_key") WHERE "current";
ALTER TABLE "application_question_answers" ADD CONSTRAINT "application_question_answers_human_confirmation" CHECK ("confirmed_at" IS NULL OR "authorship" = 'session_user');
CREATE INDEX "pilot_questions_application_question_id_idx" ON "pilot_questions" ("application_question_id");

-- Preserve ordinary job questions as observed legacy revisions; OTP and approval remain operational.
INSERT INTO "job_question_collections" (id, job_id, user_id, request_id, payload_hash, version, source, source_url, coverage, collector_version, authorship, reason, definition_ids, observed_at)
SELECT j.id, j.id, c.user_id, j.id, encode(sha256(convert_to('legacy:' || j.id, 'UTF8')), 'hex'), 1,
  'legacy', j.url, 'partial', 'legacy-backfill-v1', 'migration',
  'Historical operational questions are preserved without claiming a complete form or human-confirmed answers.',
  jsonb_agg(q.id ORDER BY q.created_at, q.id), MIN(q.created_at)
FROM pilot_questions q JOIN jobs j ON q.subject_type = 'job' AND q.subject_id = j.id
JOIN campaigns c ON c.campaign_id = j.campaign_id AND c.user_id = q.user_id
WHERE q.kind IN ('question', 'choice')
GROUP BY j.id, c.user_id;

INSERT INTO "application_questions" (id, job_id, user_id, collection_id, stable_key, revision, definition_hash, definition, category, required, visibility, current, blocking, created_at)
SELECT q.id, j.id, q.user_id, j.id, 'legacy:' || q.id, 1,
  encode(sha256(convert_to(q.prompt || q.options::text, 'UTF8')), 'hex'),
  jsonb_build_object('stableKey', 'legacy:' || q.id, 'prompt', LEFT(q.prompt, 4000),
    'required', 'unknown', 'visibility', 'unknown', 'condition', jsonb_build_object('state', 'unknown', 'rules', '[]'::jsonb), 'groupMode', 'all',
    'fields', jsonb_build_array(jsonb_build_object('key', 'legacy:' || q.id,
      'type', CASE WHEN q.kind = 'choice' AND jsonb_array_length(q.options) > 0 THEN 'single_choice' ELSE 'text' END,
      'options', COALESCE((SELECT jsonb_agg(jsonb_build_object('value', LEFT(value, 2000), 'label', LEFT(value, 2000))) FROM (SELECT value FROM jsonb_array_elements_text(q.options) LIMIT 200) o), '[]'::jsonb)))),
  'other', 'unknown', 'unknown', q.status IN ('open', 'answered') AND j.status NOT IN ('applied', 'skipped'),
  q.status IN ('open', 'answered') AND j.status NOT IN ('applied', 'skipped'), q.created_at
FROM pilot_questions q JOIN jobs j ON q.subject_type = 'job' AND q.subject_id = j.id
JOIN campaigns c ON c.campaign_id = j.campaign_id AND c.user_id = q.user_id
WHERE q.kind IN ('question', 'choice');

INSERT INTO "application_question_answers" (id, question_id, user_id, request_id, payload_hash, values, authorship, confirmed_at, created_at)
SELECT gen_random_uuid()::text, a.id, q.user_id, q.id,
  encode(sha256(convert_to('legacy-answer:' || q.id, 'UTF8')), 'hex'),
  jsonb_build_array(jsonb_build_object('fieldKey', 'legacy:' || q.id, 'value', LEFT(q.answer, 16000))),
  'migration', NULL, COALESCE(q.answered_at, q.created_at)
FROM pilot_questions q JOIN application_questions a ON a.id = q.id WHERE q.answer IS NOT NULL;

UPDATE pilot_questions q SET application_question_id = a.id FROM application_questions a WHERE a.id = q.id;

