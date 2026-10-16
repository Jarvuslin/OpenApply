CREATE TYPE "preparation_mode" AS ENUM ('preview', 'worker');
CREATE TYPE "preparation_status" AS ENUM ('filled', 'partial', 'blocked');

CREATE TABLE "application_document_selections" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "job_id" TEXT NOT NULL,
  "question_id" TEXT NOT NULL,
  "field_key" TEXT NOT NULL,
  "question_revision" INTEGER NOT NULL,
  "definition_hash" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "payload_hash" TEXT NOT NULL,
  "current" BOOLEAN NOT NULL DEFAULT true,
  "resume_id" TEXT NOT NULL,
  "variant_id" TEXT,
  "artifact_revision" TEXT NOT NULL,
  "pdf_sha256" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "source_snapshot" JSONB NOT NULL,
  "authorship" "question_authorship" NOT NULL,
  "confirmed_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "application_document_selections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "application_document_selections_human_selection" CHECK ("authorship" = 'session_user'),
  CONSTRAINT "application_document_selections_valid_revision_size" CHECK ("question_revision" > 0 AND "size_bytes" > 0 AND "size_bytes" <= 10000000)
);
CREATE UNIQUE INDEX "application_document_selections_user_id_request_id_key" ON "application_document_selections"("user_id", "request_id");
CREATE UNIQUE INDEX "application_document_selections_one_current" ON "application_document_selections"("question_id", "field_key") WHERE "current";
CREATE INDEX "application_document_selections_user_id_job_id_current_idx" ON "application_document_selections"("user_id", "job_id", "current");
ALTER TABLE "application_document_selections" ADD CONSTRAINT "application_document_selections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "application_document_selections" ADD CONSTRAINT "application_document_selections_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "application_document_selections" ADD CONSTRAINT "application_document_selections_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "application_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "application_preparation_results" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "job_id" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "payload_hash" TEXT NOT NULL,
  "collection_version" INTEGER NOT NULL,
  "manifest_hash" TEXT NOT NULL,
  "mode" "preparation_mode" NOT NULL,
  "status" "preparation_status" NOT NULL,
  "authorship" "question_authorship" NOT NULL,
  "observation" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "application_preparation_results_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "application_preparation_results_valid_version" CHECK ("collection_version" > 0)
);
CREATE UNIQUE INDEX "application_preparation_results_user_id_request_id_key" ON "application_preparation_results"("user_id", "request_id");
CREATE INDEX "application_preparation_results_user_id_job_id_created_at_idx" ON "application_preparation_results"("user_id", "job_id", "created_at");
ALTER TABLE "application_preparation_results" ADD CONSTRAINT "application_preparation_results_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "application_preparation_results" ADD CONSTRAINT "application_preparation_results_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- No file name or historical upload implies human consent to a current form field; intentionally no backfill.
