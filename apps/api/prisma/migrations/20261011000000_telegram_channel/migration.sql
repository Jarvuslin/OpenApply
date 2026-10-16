-- CreateEnum
CREATE TYPE "intake_decision" AS ENUM ('pending', 'apply_now', 'queue', 'skip');

-- CreateEnum
CREATE TYPE "runtime_state" AS ENUM ('ready', 'busy', 'blocked', 'stopped');

-- CreateEnum
CREATE TYPE "runtime_blocking_code" AS ENUM ('model_approval_required', 'budget_exhausted', 'provider_unavailable', 'browser_unavailable', 'runtime_error');

-- CreateEnum
CREATE TYPE "checkpoint_decision" AS ENUM ('approve', 'skip');

-- CreateEnum
CREATE TYPE "telegram_update_state" AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "telegram_action_kind" AS ENUM ('answer', 'apply_now', 'queue', 'skip', 'approve', 'decline', 'exclude_company', 'undo');

-- CreateEnum
CREATE TYPE "telegram_action_state" AS ENUM ('pending', 'processing', 'completed', 'revoked', 'expired');

-- CreateEnum
CREATE TYPE "telegram_delivery_state" AS ENUM ('pending', 'sending', 'sent', 'failed', 'unknown', 'cancelled');

-- CreateEnum
CREATE TYPE "telegram_template_kind" AS ENUM ('help', 'paired', 'status', 'intake', 'question', 'approval', 'rule', 'digest', 'action_done', 'web_required');

-- CreateEnum
CREATE TYPE "telegram_delivery_failure" AS ENUM ('disabled', 'rejected', 'rate_limited', 'transport_unknown', 'dispatch_interrupted', 'revoked', 'invalid_template');

-- AlterEnum
ALTER TYPE "question_authorship" ADD VALUE 'telegram_user';

-- Confirmed provenance includes only the two server-verified human channels.
ALTER TABLE application_question_answers DROP CONSTRAINT application_question_answers_human_confirmation;
ALTER TABLE application_question_answers ADD CONSTRAINT application_question_answers_human_confirmation CHECK (confirmed_at IS NULL OR authorship::text IN ('session_user','telegram_user'));
ALTER TABLE application_question_answers DROP CONSTRAINT application_question_answers_reuse_confirmed;
ALTER TABLE application_question_answers ADD CONSTRAINT application_question_answers_reuse_confirmed CHECK (used_bank_revision_id IS NULL OR (authorship::text IN ('session_user','telegram_user') AND confirmed_at IS NOT NULL));
ALTER TABLE application_document_selections DROP CONSTRAINT application_document_selections_human_selection;
ALTER TABLE application_document_selections ADD CONSTRAINT application_document_selections_human_selection CHECK (authorship::text IN ('session_user','telegram_user'));

-- AlterEnum
ALTER TYPE "work_intent" ADD VALUE 'intake_prepare';

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "human_approval_required" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "intake_decision_required" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "pilot_questions" ADD COLUMN     "approval" JSONB,
ADD COLUMN     "approval_attempt_id" TEXT,
ADD COLUMN     "approval_authorship" "question_authorship",
ADD COLUMN     "approval_checkpoint_hash" TEXT,
ADD COLUMN     "approval_checkpoint_id" TEXT,
ADD COLUMN     "approval_consumed_at" TIMESTAMP(3),
ADD COLUMN     "approval_decision" "checkpoint_decision",
ADD COLUMN     "approval_job_updated_at" TIMESTAMP(3),
ADD COLUMN     "approval_payload_hash" TEXT,
ADD COLUMN     "approval_request_id" TEXT;

-- AlterTable
ALTER TABLE "work_items" ADD COLUMN     "priority_requested_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "job_intakes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "job_id" TEXT,
    "canonical_url" TEXT NOT NULL,
    "original_url" TEXT NOT NULL,
    "provider" "chat_provider",
    "authorship" "question_authorship" NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "decision" "intake_decision" NOT NULL DEFAULT 'pending',
    "reason" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_intakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_intake_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "intake_id" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_intake_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_rules" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "company_key" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_rule_changes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "previous_active" BOOLEAN NOT NULL,
    "next_active" BOOLEAN NOT NULL,
    "authorship" "question_authorship" NOT NULL,
    "response" JSONB NOT NULL,
    "undone_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_rule_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runtime_presence" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "runtime_id" TEXT NOT NULL,
    "state" "runtime_state" NOT NULL,
    "execution_available" BOOLEAN NOT NULL,
    "blocking_code" "runtime_blocking_code",
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "runtime_presence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_links" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "sender_id" TEXT,
    "chat_id" TEXT,
    "linked_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_settings" (
    "user_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "digest_enabled" BOOLEAN NOT NULL DEFAULT false,
    "digest_hour" INTEGER NOT NULL DEFAULT 17,
    "time_zone" TEXT NOT NULL DEFAULT 'UTC',
    "quiet_hours" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "telegram_setting_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_setting_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_pairings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_pairings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_updates" (
    "id" TEXT NOT NULL,
    "update_id" TEXT NOT NULL,
    "callback_hash" TEXT,
    "user_id" TEXT,
    "link_id" TEXT,
    "generation" INTEGER,
    "request_id" TEXT NOT NULL,
    "intent" JSONB NOT NULL,
    "state" "telegram_update_state" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "processing_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_actions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "link_id" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "event_key" TEXT NOT NULL,
    "kind" "telegram_action_kind" NOT NULL,
    "target_id" TEXT NOT NULL,
    "expected_revision" INTEGER,
    "expected_hash" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "request_id" TEXT NOT NULL,
    "state" "telegram_action_state" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_deliveries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "link_id" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "event_key" TEXT NOT NULL,
    "template" "telegram_template_kind" NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "state" "telegram_delivery_state" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sending_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "message_id" TEXT,
    "failure_code" "telegram_delivery_failure",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "job_intakes_job_id_key" ON "job_intakes"("job_id");

-- CreateIndex
CREATE INDEX "job_intakes_user_id_created_at_idx" ON "job_intakes"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "job_intakes_user_id_canonical_url_key" ON "job_intakes"("user_id", "canonical_url");

-- CreateIndex
CREATE INDEX "job_intake_requests_intake_id_idx" ON "job_intake_requests"("intake_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_intake_requests_user_id_request_id_key" ON "job_intake_requests"("user_id", "request_id");

-- CreateIndex
CREATE UNIQUE INDEX "application_rules_user_id_company_key_key" ON "application_rules"("user_id", "company_key");

-- CreateIndex
CREATE INDEX "application_rule_changes_rule_id_idx" ON "application_rule_changes"("rule_id");

-- CreateIndex
CREATE UNIQUE INDEX "application_rule_changes_user_id_request_id_key" ON "application_rule_changes"("user_id", "request_id");

-- CreateIndex
CREATE UNIQUE INDEX "application_rule_changes_user_id_revision_key" ON "application_rule_changes"("user_id", "revision");

-- CreateIndex
CREATE INDEX "runtime_presence_user_id_last_seen_at_idx" ON "runtime_presence"("user_id", "last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "runtime_presence_user_id_runtime_id_key" ON "runtime_presence"("user_id", "runtime_id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_links_sender_id_key" ON "telegram_links"("sender_id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_links_chat_id_key" ON "telegram_links"("chat_id");

-- CreateIndex
CREATE INDEX "telegram_links_user_id_active_idx" ON "telegram_links"("user_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_setting_requests_user_id_request_id_key" ON "telegram_setting_requests"("user_id", "request_id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_pairings_code_hash_key" ON "telegram_pairings"("code_hash");

-- CreateIndex
CREATE INDEX "telegram_pairings_user_id_expires_at_idx" ON "telegram_pairings"("user_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_pairings_user_id_request_id_key" ON "telegram_pairings"("user_id", "request_id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_updates_update_id_key" ON "telegram_updates"("update_id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_updates_callback_hash_key" ON "telegram_updates"("callback_hash");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_updates_request_id_key" ON "telegram_updates"("request_id");

-- CreateIndex
CREATE INDEX "telegram_updates_state_created_at_idx" ON "telegram_updates"("state", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_actions_request_id_key" ON "telegram_actions"("request_id");

-- CreateIndex
CREATE INDEX "telegram_actions_user_id_state_idx" ON "telegram_actions"("user_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_actions_link_id_generation_event_key_key" ON "telegram_actions"("link_id", "generation", "event_key");

-- CreateIndex
CREATE INDEX "telegram_deliveries_state_available_at_idx" ON "telegram_deliveries"("state", "available_at");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_deliveries_link_id_generation_event_key_key" ON "telegram_deliveries"("link_id", "generation", "event_key");

-- CreateIndex
CREATE INDEX "pilot_questions_approval_attempt_id_approval_checkpoint_id_idx" ON "pilot_questions"("approval_attempt_id", "approval_checkpoint_id");

-- CreateIndex
CREATE UNIQUE INDEX "pilot_questions_user_id_approval_request_id_key" ON "pilot_questions"("user_id", "approval_request_id");

-- AddForeignKey
ALTER TABLE "job_intakes" ADD CONSTRAINT "job_intakes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_intakes" ADD CONSTRAINT "job_intakes_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_intake_requests" ADD CONSTRAINT "job_intake_requests_intake_id_fkey" FOREIGN KEY ("intake_id") REFERENCES "job_intakes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_rules" ADD CONSTRAINT "application_rules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_rule_changes" ADD CONSTRAINT "application_rule_changes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runtime_presence" ADD CONSTRAINT "runtime_presence_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_settings" ADD CONSTRAINT "telegram_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_setting_requests" ADD CONSTRAINT "telegram_setting_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_pairings" ADD CONSTRAINT "telegram_pairings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_updates" ADD CONSTRAINT "telegram_updates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_updates" ADD CONSTRAINT "telegram_updates_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "telegram_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_actions" ADD CONSTRAINT "telegram_actions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_actions" ADD CONSTRAINT "telegram_actions_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "telegram_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_deliveries" ADD CONSTRAINT "telegram_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_deliveries" ADD CONSTRAINT "telegram_deliveries_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "telegram_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every existing account receives explicit disabled notification settings.
INSERT INTO telegram_settings (user_id, revision, digest_enabled, digest_hour, time_zone, quiet_hours, updated_at)
SELECT id, 1, false, 17, 'UTC', NULL, CURRENT_TIMESTAMP FROM users;

CREATE UNIQUE INDEX telegram_links_one_active_user ON telegram_links(user_id) WHERE active = true;
CREATE UNIQUE INDEX telegram_links_owned_id ON telegram_links(user_id,id);
CREATE UNIQUE INDEX job_intakes_owned_id ON job_intakes(user_id,id);
CREATE UNIQUE INDEX application_rules_owned_id ON application_rules(user_id,id);
ALTER TABLE job_intake_requests ADD CONSTRAINT job_intake_requests_owner_fkey FOREIGN KEY (user_id,intake_id) REFERENCES job_intakes(user_id,id) ON DELETE CASCADE;
ALTER TABLE application_rule_changes ADD CONSTRAINT application_rule_changes_owner_fkey FOREIGN KEY (user_id,rule_id) REFERENCES application_rules(user_id,id) ON DELETE CASCADE;
ALTER TABLE telegram_actions ADD CONSTRAINT telegram_actions_owner_fkey FOREIGN KEY (user_id,link_id) REFERENCES telegram_links(user_id,id) ON DELETE CASCADE;
ALTER TABLE telegram_deliveries ADD CONSTRAINT telegram_deliveries_owner_fkey FOREIGN KEY (user_id,link_id) REFERENCES telegram_links(user_id,id) ON DELETE CASCADE;
ALTER TABLE telegram_updates ADD CONSTRAINT telegram_updates_owner_fkey FOREIGN KEY (user_id,link_id) REFERENCES telegram_links(user_id,id) ON DELETE CASCADE;

ALTER TABLE job_intakes ADD CONSTRAINT job_intakes_human_revision CHECK (revision >= 1 AND authorship::text IN ('session_user','telegram_user'));
ALTER TABLE application_rules ADD CONSTRAINT application_rules_key_revision CHECK (revision >= 1 AND length(company_key) BETWEEN 1 AND 200 AND length(company) BETWEEN 1 AND 200);
ALTER TABLE application_rule_changes ADD CONSTRAINT application_rule_changes_human_revision CHECK (revision >= 1 AND authorship::text IN ('session_user','telegram_user'));
ALTER TABLE runtime_presence ADD CONSTRAINT runtime_presence_available CHECK (NOT execution_available OR (state IN ('ready','busy') AND blocking_code IS NULL));
ALTER TABLE telegram_links ADD CONSTRAINT telegram_links_binding CHECK (generation >= 1 AND ((active AND sender_id ~ '^[1-9][0-9]*$' AND chat_id ~ '^[1-9][0-9]*$' AND linked_at IS NOT NULL AND sender_id IS NOT NULL AND chat_id IS NOT NULL) OR (NOT active AND sender_id IS NULL AND chat_id IS NULL)));
ALTER TABLE telegram_settings ADD CONSTRAINT telegram_settings_bounds CHECK (revision >= 1 AND digest_hour BETWEEN 0 AND 23 AND length(time_zone) BETWEEN 1 AND 100);
ALTER TABLE telegram_pairings ADD CONSTRAINT telegram_pairings_expiry CHECK (expires_at > created_at AND code_hash ~ '^[a-f0-9]{64}$');
ALTER TABLE telegram_actions ADD CONSTRAINT telegram_actions_bounds CHECK (generation >= 1 AND expires_at > created_at AND (expected_revision IS NULL OR expected_revision >= 0));
ALTER TABLE telegram_updates ADD CONSTRAINT telegram_updates_bounds CHECK (attempts BETWEEN 0 AND 3 AND (generation IS NULL OR generation >= 1));
ALTER TABLE telegram_deliveries ADD CONSTRAINT telegram_deliveries_bounds CHECK (attempts BETWEEN 0 AND 3 AND generation >= 1);
ALTER TABLE pilot_questions ADD CONSTRAINT pilot_questions_checkpoint_binding CHECK (
  (approval_attempt_id IS NULL AND approval IS NULL AND approval_checkpoint_id IS NULL AND approval_checkpoint_hash IS NULL AND approval_job_updated_at IS NULL AND approval_decision IS NULL AND approval_authorship IS NULL AND approval_request_id IS NULL AND approval_payload_hash IS NULL AND approval_consumed_at IS NULL)
  OR
  (approval_attempt_id IS NOT NULL AND approval IS NOT NULL AND kind = 'approval' AND subject_type = 'job' AND subject_id IS NOT NULL AND approval_checkpoint_id IS NOT NULL AND approval_checkpoint_hash IS NOT NULL AND approval_checkpoint_hash ~ '^[a-f0-9]{64}$' AND approval_job_updated_at IS NOT NULL AND expires_at IS NOT NULL
    AND ((approval_decision IS NULL AND approval_authorship IS NULL AND approval_request_id IS NULL AND approval_payload_hash IS NULL AND approval_consumed_at IS NULL) OR (approval_decision IS NOT NULL AND status = 'answered' AND approval_authorship::text IN ('session_user','telegram_user') AND approval_authorship IS NOT NULL AND approval_request_id IS NOT NULL AND approval_payload_hash IS NOT NULL AND approval_payload_hash ~ '^[a-f0-9]{64}$'))
    AND (approval_consumed_at IS NULL OR (approval_decision IS NOT NULL AND approval_decision = 'approve')))
);

-- All existing posting/answer/document mutation paths advance jobs.updated_at.
CREATE FUNCTION invalidate_changed_checkpoint_approval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE pilot_questions SET status = 'cancelled' WHERE subject_type = 'job' AND subject_id = OLD.id AND approval_attempt_id IS NOT NULL AND status = 'open';
    RETURN OLD;
  END IF;
  IF NEW.updated_at IS DISTINCT FROM OLD.updated_at THEN
    UPDATE pilot_questions SET status = 'cancelled' WHERE subject_type = 'job' AND subject_id = NEW.id AND approval_attempt_id IS NOT NULL AND status = 'open' AND approval_job_updated_at IS DISTINCT FROM NEW.updated_at;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER jobs_checkpoint_approval_invalidation AFTER UPDATE OR DELETE ON jobs FOR EACH ROW EXECUTE FUNCTION invalidate_changed_checkpoint_approval();
