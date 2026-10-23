ALTER TABLE "job_listings" ADD COLUMN "countries" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "applications"
  ADD COLUMN "listing_id" TEXT,
  ADD COLUMN "listing_key" TEXT,
  ADD COLUMN "listing_url" TEXT;

CREATE INDEX "job_listings_countries_idx" ON "job_listings" USING GIN ("countries");
CREATE INDEX "job_listings_status_posted_at_idx" ON "job_listings"("status", "posted_at");
CREATE INDEX "job_listings_status_first_seen_at_idx" ON "job_listings"("status", "first_seen_at");
CREATE INDEX "applications_user_id_listing_id_idx" ON "applications"("user_id", "listing_id");
CREATE INDEX "applications_listing_id_idx" ON "applications"("listing_id");
CREATE INDEX "applications_listing_key_idx" ON "applications"("listing_key");
CREATE INDEX "applications_listing_url_idx" ON "applications"("listing_url");

ALTER TABLE "applications" ADD CONSTRAINT "applications_listing_id_fkey"
  FOREIGN KEY ("listing_id") REFERENCES "job_listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- updated_at from the Greenhouse feed is not evidence of a publication date.
UPDATE "job_listing_sources"
SET "posted_at" = NULL
WHERE "board" = 'greenhouse';

UPDATE "job_listings" AS l
SET "posted_at" = (
  SELECT MIN(s."posted_at") FROM "job_listing_sources" AS s WHERE s."listing_id" = l."id"
), "listed_at" = COALESCE((
  SELECT MIN(s."posted_at") FROM "job_listing_sources" AS s WHERE s."listing_id" = l."id"
), l."first_seen_at")
WHERE EXISTS (
  SELECT 1 FROM "job_listing_sources" AS s WHERE s."listing_id" = l."id" AND s."board" = 'greenhouse'
);
