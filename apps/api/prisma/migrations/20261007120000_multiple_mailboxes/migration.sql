CREATE TYPE "email_runtime_provider" AS ENUM ('claude', 'codex');

ALTER TABLE "email_accounts"
  ADD COLUMN "last_checked_at" TIMESTAMP(3),
  ADD COLUMN "runtime_provider" "email_runtime_provider";

ALTER TABLE "users" ADD COLUMN "active_email_account_id" TEXT;

-- Existing IDs and message relations survive the change from one mailbox to many.
UPDATE "email_accounts" SET "email" = lower(trim("email"));
UPDATE "users" AS u SET "active_email_account_id" = a."id"
  FROM "email_accounts" AS a WHERE a."user_id" = u."id";

DROP INDEX "email_accounts_user_id_key";
CREATE UNIQUE INDEX "email_accounts_user_id_email_key" ON "email_accounts"("user_id", "email");
CREATE UNIQUE INDEX "users_active_email_account_id_key" ON "users"("active_email_account_id");
ALTER TABLE "users" ADD CONSTRAINT "users_active_email_account_id_fkey"
  FOREIGN KEY ("active_email_account_id") REFERENCES "email_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
