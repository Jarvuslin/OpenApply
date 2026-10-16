-- Null means no limit; each claimed queue run uses one.
ALTER TABLE "queue_policies" ADD COLUMN "runs_remaining" INTEGER;
