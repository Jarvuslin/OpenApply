CREATE TABLE "queue_policies" (
 "user_id" TEXT PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
 "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" >= 1),
 "max_concurrent_workers" INTEGER NOT NULL DEFAULT 1 CHECK ("max_concurrent_workers" BETWEEN 1 AND 3),
 "daily_application_cap" INTEGER NOT NULL DEFAULT 10 CHECK ("daily_application_cap" BETWEEN 1 AND 500),
 "company_application_cap" INTEGER NOT NULL DEFAULT 3 CHECK ("company_application_cap" BETWEEN 1 AND 100),
 "company_window_days" INTEGER NOT NULL DEFAULT 7 CHECK ("company_window_days" BETWEEN 1 AND 90),
 "domain_delay_seconds" INTEGER NOT NULL DEFAULT 30 CHECK ("domain_delay_seconds" BETWEEN 1 AND 3600),
 "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "queue_policies" ("user_id") SELECT "id" FROM "users";

CREATE TABLE "work_executions" (
 "id" TEXT PRIMARY KEY,
 "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
 "work_item_id" TEXT NOT NULL,
 "job_id" TEXT,
 "kind" "work_kind" NOT NULL,
 "runtime_id" TEXT NOT NULL, "worker_id" TEXT NOT NULL,
 "browser_session_id" TEXT NOT NULL UNIQUE,
 "slot" INTEGER NOT NULL CHECK ("slot" BETWEEN 1 AND 3),
 "policy_revision" INTEGER NOT NULL CHECK ("policy_revision" >= 1),
 "canonical_url" TEXT, "company_key" TEXT, "domain_key" TEXT,
 "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "finished_at" TIMESTAMP(3), "released_at" TIMESTAMP(3), "consumed_at" TIMESTAMP(3),
 "submission_attempt_id" TEXT,
 CONSTRAINT "work_execution_application_scope" CHECK ("kind" <> 'application' OR
   ("job_id" IS NOT NULL AND "canonical_url" IS NOT NULL AND "company_key" IS NOT NULL AND "domain_key" IS NOT NULL)),
 CONSTRAINT "work_execution_reservation_state" CHECK (NOT ("released_at" IS NOT NULL AND "consumed_at" IS NOT NULL))
);
CREATE INDEX "work_executions_user_id_started_at_idx" ON "work_executions"("user_id","started_at");
CREATE INDEX "work_executions_user_id_company_key_idx" ON "work_executions"("user_id","company_key");
CREATE INDEX "work_executions_work_item_id_idx" ON "work_executions"("work_item_id");
CREATE UNIQUE INDEX "work_executions_user_id_id_key" ON "work_executions"("user_id","id");
CREATE UNIQUE INDEX "work_executions_live_worker" ON "work_executions"("user_id","runtime_id","worker_id") WHERE "finished_at" IS NULL;
CREATE UNIQUE INDEX "work_executions_live_slot" ON "work_executions"("user_id","slot") WHERE "finished_at" IS NULL;
CREATE UNIQUE INDEX "work_executions_live_item" ON "work_executions"("work_item_id") WHERE "finished_at" IS NULL;

CREATE TABLE "work_domain_gates" (
 "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
 "domain_key" TEXT NOT NULL,
 "next_start_at" TIMESTAMP(3) NOT NULL,
 PRIMARY KEY ("user_id","domain_key")
);
ALTER TABLE "work_items" ADD COLUMN "current_execution_id" TEXT;
ALTER TABLE "work_items" ADD COLUMN "worker_slot" INTEGER;
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_owned_execution_fk" FOREIGN KEY ("user_id","current_execution_id") REFERENCES "work_executions"("user_id","id") ON DELETE NO ACTION;
-- Existing leases have no isolated browser owner. Park them explicitly; preserve every
-- submission attempt/checkpoint/receipt and require new approval before another execution.
UPDATE "work_items" SET
 "state" = CASE WHEN "kind" = 'application' THEN 'needs_user'::work_state ELSE 'failed'::work_state END,
 "reason" = 'Concurrency cutover revoked a legacy browser lease. Inspect preserved submission evidence before explicitly continuing.',
 "lease_token" = NULL, "lease_expires_at" = NULL, "finished_at" = CURRENT_TIMESTAMP,
 "updated_at" = CURRENT_TIMESTAMP
WHERE "state" IN ('preparing','ready','filling','stopping');
DROP INDEX "work_items_one_active_user";
CREATE UNIQUE INDEX "work_items_live_slot" ON "work_items"("user_id","worker_slot")
 WHERE "state" IN ('preparing','ready','filling','stopping');
ALTER TABLE "work_items" ADD CONSTRAINT "work_item_owned_slot" CHECK (
 ("worker_slot" IS NULL OR "worker_slot" BETWEEN 1 AND 3) AND
 ("state" NOT IN ('preparing','ready','filling','stopping') OR
   ("worker_slot" IS NOT NULL AND "current_execution_id" IS NOT NULL)));
ALTER TABLE "application_document_selections" ADD COLUMN "invalidated_at" TIMESTAMP(3);
ALTER TABLE "application_document_selections" ADD COLUMN "invalid_reason" TEXT;
