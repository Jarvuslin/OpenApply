CREATE TYPE "job_work_mode" AS ENUM ('remote', 'hybrid', 'onsite');
CREATE TYPE "job_employment_type" AS ENUM ('full_time', 'part_time', 'contract', 'internship', 'temporary');
CREATE TYPE "job_salary_period" AS ENUM ('year', 'hour', 'month');

ALTER TABLE "job_listings"
  ADD COLUMN "salary_min" DOUBLE PRECISION,
  ADD COLUMN "salary_max" DOUBLE PRECISION,
  ADD COLUMN "salary_currency" TEXT,
  ADD COLUMN "salary_period" "job_salary_period",
  ADD COLUMN "work_mode" "job_work_mode",
  ADD COLUMN "employment_kind" "job_employment_type",
  ADD COLUMN "company_logo_url" TEXT,
  ADD COLUMN "posted_at" TIMESTAMP(3),
  ADD COLUMN "listed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "saved_job_listings" (
  "user_id" TEXT NOT NULL,
  "listing_id" TEXT NOT NULL,
  "saved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "saved_job_listings_pkey" PRIMARY KEY ("user_id", "listing_id"),
  CONSTRAINT "saved_job_listings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "saved_job_listings_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "job_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "saved_job_listings_user_id_saved_at_idx" ON "saved_job_listings"("user_id", "saved_at");
CREATE INDEX "saved_job_listings_listing_id_idx" ON "saved_job_listings"("listing_id");
CREATE INDEX "job_listings_status_listed_at_idx" ON "job_listings"("status", "listed_at");
CREATE INDEX "job_listings_salary_currency_salary_period_salary_min_idx" ON "job_listings"("salary_currency", "salary_period", "salary_min");

UPDATE "job_listings" SET "employment_kind" = CASE regexp_replace(lower("employment_type"), '[[:space:]_-]', '', 'g')
  WHEN 'fulltime' THEN 'full_time' WHEN 'parttime' THEN 'part_time'
  WHEN 'contract' THEN 'contract' WHEN 'contractor' THEN 'contract'
  WHEN 'intern' THEN 'internship' WHEN 'internship' THEN 'internship'
  WHEN 'temp' THEN 'temporary' WHEN 'temporary' THEN 'temporary'
  ELSE NULL END::job_employment_type;
UPDATE "job_listings" SET "work_mode" = CASE
  WHEN "location" ~* '\mhybrid\M' THEN 'hybrid'
  WHEN "location" ~* '\mon[[:space:]-]?site\M' THEN 'onsite'
  WHEN "remote" OR "location" ~* '\mremote\M' THEN 'remote'
  ELSE NULL END::job_work_mode;
UPDATE "job_listings" j SET "posted_at" = p.posted_at
  FROM (SELECT listing_id, min(posted_at) AS posted_at FROM job_listing_sources GROUP BY listing_id) p
  WHERE j.id = p.listing_id;
UPDATE "job_listings" SET "listed_at" = coalesce("posted_at", "first_seen_at");

-- Match only explicit currency and pay period; ambiguous legacy salary strings stay unfilterable.
CREATE FUNCTION pg_temp.discover_salary(raw TEXT)
RETURNS TABLE (minimum DOUBLE PRECISION, maximum DOUBLE PRECISION, currency TEXT, period job_salary_period)
LANGUAGE plpgsql AS $$
DECLARE
  value TEXT;
  currencies TEXT[];
  amounts TEXT[];
  periods TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF raw IS NULL THEN RETURN; END IF;
  value := regexp_replace(raw, 'US\$', 'USD ', 'gi');
  value := regexp_replace(value, 'CA\$', 'CAD ', 'gi');
  value := regexp_replace(value, 'AU\$|A\$', 'AUD ', 'gi');
  value := regexp_replace(value, 'NZ\$', 'NZD ', 'gi');
  value := replace(replace(replace(value, '€', 'EUR '), '£', 'GBP '), '₹', 'INR ');
  SELECT array_agg(DISTINCT upper(m[1])) INTO currencies FROM regexp_matches(value, '\m(USD|CAD|AUD|NZD|EUR|GBP|INR|JPY|CHF)\M', 'gi') m;
  IF value ~* '\m(annual|annually|yearly|years?|yrs?)\M' THEN periods := array_append(periods, 'year'); END IF;
  IF value ~* '\m(hourly|hours?|hrs?)\M' THEN periods := array_append(periods, 'hour'); END IF;
  IF value ~* '\m(monthly|months?|mos?)\M' THEN periods := array_append(periods, 'month'); END IF;
  IF coalesce(cardinality(currencies), 0) <> 1 OR cardinality(periods) <> 1 THEN RETURN; END IF;
  value := regexp_replace(value, '\m(USD|CAD|AUD|NZD|EUR|GBP|INR|JPY|CHF)\M', '', 'gi');
  value := regexp_replace(value, '(\mper[[:space:]]+|/[[:space:]]*)?(annually|annual|yearly|years?|yrs?|hourly|hours?|hrs?|monthly|months?|mos?)\M', '', 'gi');
  value := replace(value, '$', '');
  amounts := regexp_match(value, '^[[:space:]]*((?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]+)?[[:space:]]*[kK]?)(?:[[:space:]]*(?:-|–|—|to)[[:space:]]*((?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]+)?[[:space:]]*[kK]?))?[[:space:]]*$', 'i');
  IF amounts IS NULL THEN RETURN; END IF;
  minimum := regexp_replace(amounts[1], '[,[:space:]Kk]', '', 'g')::DOUBLE PRECISION * CASE WHEN amounts[1] ~* 'k' THEN 1000 ELSE 1 END;
  maximum := CASE WHEN amounts[2] IS NULL THEN minimum ELSE regexp_replace(amounts[2], '[,[:space:]Kk]', '', 'g')::DOUBLE PRECISION * CASE WHEN amounts[2] ~* 'k' THEN 1000 ELSE 1 END END;
  IF minimum < 0 OR maximum < minimum OR maximum > 1000000000 THEN RETURN; END IF;
  currency := currencies[1];
  period := periods[1]::job_salary_period;
  RETURN NEXT;
END;
$$;
UPDATE "job_listings" j SET "salary_min" = n.minimum, "salary_max" = n.maximum,
  "salary_currency" = n.currency, "salary_period" = n.period
  FROM (SELECT id, salary.* FROM job_listings CROSS JOIN LATERAL pg_temp.discover_salary(salary) salary) n
  WHERE j.id = n.id;
DROP FUNCTION pg_temp.discover_salary(TEXT);
