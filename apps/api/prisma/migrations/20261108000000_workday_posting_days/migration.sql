-- Workday's "Posted 3 Days Ago" was dated at the time of the fetch; a posting date is only that day.
UPDATE "job_listings" l
SET "posted_at" = date_trunc('day', l."posted_at"), "listed_at" = date_trunc('day', l."posted_at")
WHERE l."posted_at" <> date_trunc('day', l."posted_at")
  AND EXISTS (
    SELECT 1 FROM "job_listing_sources" s
    WHERE s."listing_id" = l."id" AND s."board" = 'workday' AND s."posted_at" = l."posted_at");

UPDATE "job_listing_sources"
SET "posted_at" = date_trunc('day', "posted_at")
WHERE "board" = 'workday' AND "posted_at" <> date_trunc('day', "posted_at");
