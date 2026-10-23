-- CreateTable
CREATE TABLE "job_board_probes" (
    "key" TEXT NOT NULL,
    "checked_at" TIMESTAMP(3) NOT NULL,
    "board_key" TEXT,

    CONSTRAINT "job_board_probes_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "job_board_probes_checked_at_idx" ON "job_board_probes"("checked_at");
