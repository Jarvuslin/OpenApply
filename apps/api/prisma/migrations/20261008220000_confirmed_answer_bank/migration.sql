-- CreateEnum
CREATE TYPE "answer_bank_scope" AS ENUM ('account', 'employer');

-- CreateEnum
CREATE TYPE "answer_bank_action" AS ENUM ('save', 'revoke');

-- AlterTable
ALTER TABLE "application_question_answers" ADD COLUMN     "reuse_context" JSONB,
ADD COLUMN     "used_bank_revision_id" TEXT;

-- CreateTable
CREATE TABLE "answer_bank_entries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "identity_hash" TEXT NOT NULL,
    "current_revision" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "answer_bank_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "answer_bank_revisions" (
    "id" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "action" "answer_bank_action" NOT NULL,
    "request_id" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "source_answer_id" TEXT,
    "source_snapshot" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "normalizer_version" TEXT NOT NULL,
    "scope" "answer_bank_scope" NOT NULL,
    "category" "question_category" NOT NULL,
    "country_code" TEXT,
    "employer_key" TEXT,
    "role_key" TEXT,
    "consented_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "answer_bank_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "answer_bank_entries_user_id_active_updated_at_idx" ON "answer_bank_entries"("user_id", "active", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "answer_bank_entries_user_id_identity_hash_key" ON "answer_bank_entries"("user_id", "identity_hash");

-- CreateIndex
CREATE INDEX "answer_bank_revisions_user_id_fingerprint_idx" ON "answer_bank_revisions"("user_id", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "answer_bank_revisions_entry_id_revision_key" ON "answer_bank_revisions"("entry_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "answer_bank_revisions_user_id_request_id_key" ON "answer_bank_revisions"("user_id", "request_id");

-- AddForeignKey
ALTER TABLE "answer_bank_entries" ADD CONSTRAINT "answer_bank_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_bank_revisions" ADD CONSTRAINT "answer_bank_revisions_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "answer_bank_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_bank_revisions" ADD CONSTRAINT "answer_bank_revisions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_bank_revisions" ADD CONSTRAINT "answer_bank_revisions_source_answer_id_fkey" FOREIGN KEY ("source_answer_id") REFERENCES "application_question_answers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_question_answers" ADD CONSTRAINT "application_question_answers_used_bank_revision_id_fkey" FOREIGN KEY ("used_bank_revision_id") REFERENCES "answer_bank_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Existing profile defaults and historical answers carry no reuse consent: intentionally no data import.
ALTER TABLE "application_question_answers" ADD CONSTRAINT "application_question_answers_reuse_confirmed" CHECK ("used_bank_revision_id" IS NULL OR ("authorship" = 'session_user' AND "confirmed_at" IS NOT NULL));
ALTER TABLE "answer_bank_revisions" ADD CONSTRAINT "answer_bank_revisions_positive_revision" CHECK ("revision" > 0);
ALTER TABLE "answer_bank_entries" ADD CONSTRAINT "answer_bank_entries_positive_revision" CHECK ("current_revision" > 0);
