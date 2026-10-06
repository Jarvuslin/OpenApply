ALTER TABLE "users" ADD COLUMN "country_code" TEXT;
ALTER TABLE "users" ADD COLUMN "job_preferences" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "users" ADD COLUMN "work_authorization" JSONB NOT NULL DEFAULT '[]';
