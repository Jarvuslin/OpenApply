-- Historical production scores stay unchanged. Evaluations begin empty; no inferred provenance.
CREATE TYPE "scoring_evaluation_origin" AS ENUM ('historical', 'simulated', 'local_inference');
CREATE TYPE "scoring_evaluation_slot" AS ENUM ('baseline', 'candidate');
CREATE TYPE "scoring_evaluation_status" AS ENUM ('completed', 'failed', 'budget_stopped', 'rejected');
CREATE TYPE "scoring_evaluation_cohort" AS ENUM ('owned', 'historical_synthetic', 'authored');
CREATE TYPE "scoring_evaluation_model" AS ENUM ('sonnet', 'haiku');
CREATE TYPE "scoring_evaluation_failure" AS ENUM ('invalid_output', 'missing_usage', 'budget_requests', 'budget_tokens', 'budget_time', 'output_limit', 'provider_error', 'cancelled', 'model_mismatch', 'unsafe_tool_use');
CREATE TABLE "scoring_evaluation_runs" (
  "id" TEXT NOT NULL PRIMARY KEY, "user_id" TEXT NOT NULL, "request_id" TEXT NOT NULL,
  "payload_hash" TEXT NOT NULL, "name" TEXT NOT NULL, "cohort" "scoring_evaluation_cohort" NOT NULL,
  "case_count" INTEGER NOT NULL, "escalation_band" INTEGER NOT NULL, "policy_version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scoring_evaluation_runs_bounds" CHECK ("case_count" BETWEEN 1 AND 20 AND "escalation_band" BETWEEN 0 AND 20 AND "policy_version" = 1)
);
CREATE UNIQUE INDEX "scoring_evaluation_runs_user_id_request_id_key" ON "scoring_evaluation_runs"("user_id", "request_id");
CREATE UNIQUE INDEX "scoring_evaluation_runs_id_user_id_key" ON "scoring_evaluation_runs"("id", "user_id");
CREATE INDEX "scoring_evaluation_runs_user_id_created_at_idx" ON "scoring_evaluation_runs"("user_id", "created_at");
ALTER TABLE "scoring_evaluation_runs" ADD CONSTRAINT "scoring_evaluation_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "scoring_evaluation_cases" (
  "id" TEXT NOT NULL PRIMARY KEY, "user_id" TEXT NOT NULL, "run_id" TEXT NOT NULL, "ordinal" INTEGER NOT NULL,
  "job_id" TEXT NOT NULL, "campaign_id" TEXT NOT NULL, "job_key" TEXT NOT NULL, "context_hash" TEXT NOT NULL,
  "context" JSONB NOT NULL, "historical_reference" JSONB, "eligibility" JSONB, "facts_confirmed_at" TIMESTAMP(3),
  CONSTRAINT "scoring_evaluation_cases_bounds" CHECK ("ordinal" BETWEEN 0 AND 19),
  CONSTRAINT "scoring_evaluation_cases_blind_input" CHECK (COALESCE("context"->'cachedAssessment' = 'null'::jsonb, false))
);
ALTER TABLE "scoring_evaluation_cases" ALTER COLUMN "eligibility" SET NOT NULL;
CREATE UNIQUE INDEX "scoring_evaluation_cases_id_user_id_key" ON "scoring_evaluation_cases"("id", "user_id");
CREATE UNIQUE INDEX "scoring_evaluation_cases_run_id_ordinal_key" ON "scoring_evaluation_cases"("run_id", "ordinal");
CREATE UNIQUE INDEX "scoring_evaluation_cases_run_id_job_id_key" ON "scoring_evaluation_cases"("run_id", "job_id");
CREATE INDEX "scoring_evaluation_cases_user_id_run_id_idx" ON "scoring_evaluation_cases"("user_id", "run_id");
ALTER TABLE "scoring_evaluation_cases" ADD CONSTRAINT "scoring_evaluation_cases_run_id_user_id_fkey" FOREIGN KEY ("run_id", "user_id") REFERENCES "scoring_evaluation_runs"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "scoring_evaluation_results" (
  "id" TEXT NOT NULL PRIMARY KEY, "user_id" TEXT NOT NULL, "case_id" TEXT NOT NULL, "request_id" TEXT NOT NULL,
  "payload_hash" TEXT NOT NULL, "slot" "scoring_evaluation_slot" NOT NULL, "origin" "scoring_evaluation_origin" NOT NULL,
  "requested_model" "scoring_evaluation_model" NOT NULL, "actual_models" JSONB NOT NULL, "model_version" TEXT,
  "status" "scoring_evaluation_status" NOT NULL, "failure_code" "scoring_evaluation_failure", "judgments" JSONB, "assessment" JSONB,
  "telemetry" JSONB NOT NULL, "request_identity_hashes" JSONB NOT NULL, "validation_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scoring_evaluation_results_model_slot" CHECK (("slot" = 'baseline' AND "requested_model" = 'sonnet') OR ("slot" = 'candidate' AND "requested_model" = 'haiku')),
  CONSTRAINT "scoring_evaluation_results_outcome" CHECK (("status" = 'completed' AND "assessment" IS NOT NULL AND "assessment" <> 'null'::jsonb AND "failure_code" IS NULL) OR ("status" <> 'completed' AND "assessment" IS NULL AND "failure_code" IS NOT NULL)),
  CONSTRAINT "scoring_evaluation_results_historical_slot" CHECK ("origin" <> 'historical' OR "slot" = 'baseline')
);
CREATE UNIQUE INDEX "scoring_evaluation_results_user_id_request_id_key" ON "scoring_evaluation_results"("user_id", "request_id");
CREATE UNIQUE INDEX "scoring_evaluation_results_case_id_slot_key" ON "scoring_evaluation_results"("case_id", "slot");
CREATE INDEX "scoring_evaluation_results_user_id_case_id_idx" ON "scoring_evaluation_results"("user_id", "case_id");
ALTER TABLE "scoring_evaluation_results" ADD CONSTRAINT "scoring_evaluation_results_case_id_user_id_fkey" FOREIGN KEY ("case_id", "user_id") REFERENCES "scoring_evaluation_cases"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;
