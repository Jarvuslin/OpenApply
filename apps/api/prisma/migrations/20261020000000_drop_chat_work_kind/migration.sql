-- Chat is retired and no runner accepts chat work. Chat threads, runs and messages stay;
-- only their queue rows go. work_events rows cascade with their work item.

-- Both checks compare "kind" to work_kind literals, so they cannot survive the type swap.
ALTER TABLE "work_items" DROP CONSTRAINT "work_items_kind_link";
ALTER TABLE "work_executions" DROP CONSTRAINT "work_execution_application_scope";

-- Items first: work_items.current_execution_id references work_executions with NO ACTION.
DELETE FROM "work_items" WHERE "kind" = 'chat';
DELETE FROM "work_executions" WHERE "kind" = 'chat';

-- DropForeignKey
ALTER TABLE "work_items" DROP CONSTRAINT "work_items_chat_run_id_fkey";

-- DropIndex
DROP INDEX "work_items_chat_run_id_key";

-- AlterTable
ALTER TABLE "work_items" DROP COLUMN "chat_run_id";

-- AlterEnum
CREATE TYPE "work_kind_new" AS ENUM ('application', 'pilot_task');
ALTER TABLE "work_items" ALTER COLUMN "kind" TYPE "work_kind_new" USING ("kind"::text::"work_kind_new");
ALTER TABLE "work_executions" ALTER COLUMN "kind" TYPE "work_kind_new" USING ("kind"::text::"work_kind_new");
ALTER TYPE "work_kind" RENAME TO "work_kind_old";
ALTER TYPE "work_kind_new" RENAME TO "work_kind";
DROP TYPE "work_kind_old";

ALTER TABLE "work_items" ADD CONSTRAINT "work_items_kind_link" CHECK (
  ("kind" = 'application' AND "job_id" IS NOT NULL)
  OR ("kind" = 'pilot_task' AND "job_id" IS NULL AND "intent" IS NOT NULL)
);
ALTER TABLE "work_executions" ADD CONSTRAINT "work_execution_application_scope" CHECK ("kind" <> 'application' OR
  ("job_id" IS NOT NULL AND "canonical_url" IS NOT NULL AND "company_key" IS NOT NULL AND "domain_key" IS NOT NULL));
