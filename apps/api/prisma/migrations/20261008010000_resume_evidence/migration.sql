CREATE TYPE "resume_evidence_status" AS ENUM ('supported', 'unverified', 'retracted');

CREATE TABLE "resume_evidence" (
    "id" TEXT NOT NULL,
    "resume_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" "resume_evidence_status" NOT NULL DEFAULT 'unverified',
    "statement" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "source" JSONB NOT NULL,
    "review" JSONB NOT NULL,
    "verification" JSONB NOT NULL,
    "optional_question" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "resume_evidence_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "resume_evidence_resume_id_status_updated_at_idx" ON "resume_evidence"("resume_id", "status", "updated_at");
ALTER TABLE "resume_evidence" ADD CONSTRAINT "resume_evidence_resume_id_fkey" FOREIGN KEY ("resume_id") REFERENCES "resumes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
