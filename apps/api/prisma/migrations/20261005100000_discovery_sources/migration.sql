CREATE TYPE "ats_provider" AS ENUM ('ashby', 'greenhouse', 'lever', 'smartrecruiters', 'workable');
CREATE TYPE "discovery_provider" AS ENUM ('apify', 'serpapi');
DELETE FROM "job_boards" WHERE lower("domain") ~ '(^|\.)(linkedin|indeed|glassdoor|ziprecruiter|upwork|joinhandshake|wellfound)\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$';
ALTER TABLE "job_listing_sources"
 ADD COLUMN "apply_url" TEXT,
 ADD COLUMN "attribution_url" TEXT,
 ADD COLUMN "resolution_confidence" DOUBLE PRECISION,
 ADD COLUMN "posted_at" TIMESTAMP(3);
UPDATE "job_listing_sources" SET "apply_url" = "url", "attribution_url" = "url", "resolution_confidence" = 1
WHERE "url" ~ '^https://(jobs\.ashbyhq\.com|boards\.greenhouse\.io|job-boards\.greenhouse\.io|jobs\.lever\.co|jobs\.smartrecruiters\.com|apply\.workable\.com)/';
CREATE TABLE "company_ats_boards" (
 "company_key" TEXT PRIMARY KEY, "provider" "ats_provider" NOT NULL, "slug" TEXT NOT NULL,
 "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "job_source_connections" (
 "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "provider" "discovery_provider" NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT false,
 "encrypted_key" TEXT NOT NULL, "config" JSONB NOT NULL DEFAULT '{}',
 PRIMARY KEY ("user_id", "provider")
);
