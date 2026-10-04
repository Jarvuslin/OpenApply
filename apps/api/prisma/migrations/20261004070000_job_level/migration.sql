CREATE TYPE "job_level" AS ENUM ('intern', 'entry', 'mid', 'senior', 'lead', 'executive', 'unknown');
ALTER TABLE "job_listings" ADD COLUMN "level" "job_level" NOT NULL DEFAULT 'unknown';
UPDATE "job_listings" SET "level" = (CASE
  WHEN title ~* '\m(intern|internship|co-op)\M' THEN 'intern'
  WHEN title ~* '\m(manager|director|head|vp|vice president|chief)\M' THEN 'executive'
  WHEN title ~* '\m(lead|staff|principal)\M' THEN 'lead'
  WHEN title ~* '\m(senior|sr)\M' THEN 'senior'
  WHEN title ~* '\m(intermediate|mid|engineer ii|developer ii)\M' THEN 'mid'
  WHEN title ~* '\m(junior|jr|entry|new grad|early career)\M' THEN 'entry'
  ELSE 'unknown' END)::"job_level";
