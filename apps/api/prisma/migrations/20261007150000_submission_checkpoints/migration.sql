CREATE TABLE "submission_attempts" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "job_id" TEXT,
  "original_url" TEXT NOT NULL,
  "canonical_url" TEXT,
  "legacy_outcome_unknown" BOOLEAN NOT NULL DEFAULT false,
  "checkpoint_id" TEXT,
  "checkpoint" JSONB,
  "checkpoint_hash" TEXT,
  "started_at" TIMESTAMP(3),
  "receipt" JSONB,
  "receipt_hash" TEXT,
  "receipt_stored_at" TIMESTAMP(3),
  "recorded_at" TIMESTAMP(3),
  "application_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "submission_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "submission_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "submission_attempts_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "submission_attempts_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "submission_attempts_job_id_key" ON "submission_attempts"("job_id");
CREATE UNIQUE INDEX "submission_attempts_checkpoint_id_key" ON "submission_attempts"("checkpoint_id");
CREATE UNIQUE INDEX "submission_attempts_application_id_key" ON "submission_attempts"("application_id");
CREATE UNIQUE INDEX "submission_attempts_user_id_canonical_url_key" ON "submission_attempts"("user_id", "canonical_url");
CREATE INDEX "submission_attempts_user_id_legacy_outcome_unknown_id_idx" ON "submission_attempts"("user_id", "legacy_outcome_unknown", "id");

-- Existing in-flight work has an unknown outcome. Do not invent a checkpoint, begin or receipt.
-- Raw URLs are retained; the API's shared reader canonicalizes every legacy reservation.
INSERT INTO "submission_attempts" ("id", "user_id", "job_id", "original_url", "legacy_outcome_unknown", "updated_at")
SELECT gen_random_uuid()::text, c."user_id", j."id", j."url", true, CURRENT_TIMESTAMP
FROM "jobs" j JOIN "campaigns" c ON c."campaign_id" = j."campaign_id"
WHERE j."status" = 'applying';
