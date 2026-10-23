CREATE TABLE "dropped_jobs" (
    "board_key" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "classifier_version" INTEGER NOT NULL,
    "dropped_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dropped_jobs_pkey" PRIMARY KEY ("board_key","job_id")
);
