-- AlterTable
ALTER TABLE "users" ADD COLUMN "education_history" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "work_history" JSONB NOT NULL DEFAULT '[]';
