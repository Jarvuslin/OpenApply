CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "domain" TEXT,
    "name" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "companies_key_key" ON "companies"("key");
CREATE INDEX "companies_aliases_idx" ON "companies" USING GIN ("aliases");

CREATE TABLE "company_boards" (
    "board_key" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,

    CONSTRAINT "company_boards_pkey" PRIMARY KEY ("board_key")
);
CREATE INDEX "company_boards_company_id_idx" ON "company_boards"("company_id");
ALTER TABLE "company_boards" ADD CONSTRAINT "company_boards_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Two openings with one title at one company and city are now separate listings.
DROP INDEX "job_listings_dedupe_key_key";
CREATE INDEX "job_listings_dedupe_key_idx" ON "job_listings"("dedupe_key");
ALTER TABLE "job_listings" ADD COLUMN "company_id" TEXT,
ADD COLUMN "match_key" TEXT,
ADD COLUMN "source_rank" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "job_listings_company_id_match_key_idx" ON "job_listings"("company_id", "match_key");
ALTER TABLE "job_listings" ADD CONSTRAINT "job_listings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "job_listing_sources" ADD COLUMN "board_key" TEXT,
ADD COLUMN "external_id" TEXT,
ADD COLUMN "requisition_id" TEXT,
ADD COLUMN "rank" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "job_listing_sources_board_key_external_id_idx" ON "job_listing_sources"("board_key", "external_id");
CREATE INDEX "job_listing_sources_requisition_id_idx" ON "job_listing_sources"("requisition_id");
