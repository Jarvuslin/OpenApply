-- AlterTable
ALTER TABLE "users" ADD COLUMN "gpa" DOUBLE PRECISION,
ADD COLUMN "gpa_scale" DOUBLE PRECISION NOT NULL DEFAULT 4,
ADD COLUMN "transcript_filename" TEXT,
ADD COLUMN "transcript_original_name" TEXT;
