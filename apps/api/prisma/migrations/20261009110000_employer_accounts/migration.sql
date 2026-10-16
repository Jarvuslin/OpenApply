CREATE TYPE "employer_account_mode" AS ENUM ('account_only', 'apply');
CREATE TYPE "employer_account_state" AS ENUM ('checking', 'signup_ready', 'signup_started', 'verification_pending', 'needs_user', 'authenticated', 'unknown', 'skipped');
CREATE TYPE "employer_account_reason" AS ENUM ('existing_account_credentials', 'password_entry', 'terms_confirmation', 'mailbox_identity', 'verification', 'captcha');

CREATE TABLE "employer_account_attempts" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "mode" "employer_account_mode" NOT NULL,
  "target_url" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "credential_id" TEXT,
  "campaign_id" TEXT,
  "job_id" TEXT,
  "chat_thread_id" TEXT,
  "state" "employer_account_state" NOT NULL DEFAULT 'checking',
  "needs_user_reason" "employer_account_reason",
  "question_id" TEXT,
  "browser_tab_id" TEXT,
  "current_url" TEXT,
  "existing_account" BOOLEAN NOT NULL DEFAULT false,
  "no_account_observed" BOOLEAN NOT NULL DEFAULT false,
  "signup_started_at" TIMESTAMP(3),
  "authenticated_at" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employer_account_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employer_account_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "employer_account_attempts_user_id_scope_email_key" ON "employer_account_attempts"("user_id", "scope", "email");
CREATE INDEX "employer_account_attempts_user_id_state_idx" ON "employer_account_attempts"("user_id", "state");
