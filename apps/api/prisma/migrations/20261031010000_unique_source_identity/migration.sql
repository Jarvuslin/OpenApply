-- The backfill merged duplicate source rows, so one board id now names one source.
DROP INDEX "job_listing_sources_board_key_external_id_idx";
CREATE UNIQUE INDEX "job_listing_sources_board_key_external_id_key" ON "job_listing_sources"("board_key", "external_id");
