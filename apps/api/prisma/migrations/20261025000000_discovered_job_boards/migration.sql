-- CreateTable
CREATE TABLE "discovered_job_boards" (
    "key" TEXT NOT NULL,
    "provider" "ats_provider" NOT NULL,
    "slug" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discovered_job_boards_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "discovered_job_boards_last_seen_at_idx" ON "discovered_job_boards"("last_seen_at");
