-- CreateEnum
CREATE TYPE "work_kind" AS ENUM ('application', 'chat', 'pilot_task');

-- CreateEnum
CREATE TYPE "work_state" AS ENUM ('queued', 'preparing', 'ready', 'filling', 'needs_user', 'submitted', 'skipped', 'failed', 'paused', 'stopping', 'cancelled', 'completed');

-- CreateEnum
CREATE TYPE "work_source" AS ENUM ('user', 'campaign', 'mvp', 'discovery', 'pilot', 'chat', 'migration');

-- CreateEnum
CREATE TYPE "work_intent" AS ENUM ('campaign_start', 'campaign_resume', 'campaign_rescan', 'campaign_retry_failed', 'search', 'inbox', 'unavailable');

-- CreateTable
CREATE TABLE "work_items" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "work_kind" NOT NULL,
    "state" "work_state" NOT NULL DEFAULT 'queued',
    "source" "work_source" NOT NULL,
    "provider" "chat_provider" NOT NULL DEFAULT 'claude',
    "identity" TEXT NOT NULL,
    "job_id" TEXT,
    "job_key" TEXT,
    "campaign_id" TEXT,
    "chat_run_id" TEXT,
    "application_id" TEXT,
    "intent" "work_intent",
    "payload" JSONB NOT NULL DEFAULT '{}',
    "title" TEXT NOT NULL,
    "company" TEXT,
    "reason" TEXT,
    "lease_token" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "heartbeat_at" TIMESTAMP(3),
    "cancellation_requested_at" TIMESTAMP(3),
    "pause_requested_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "work_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "item_ids" TEXT[],
    "response" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_events" (
    "id" TEXT NOT NULL,
    "work_item_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "kind" "chat_message_kind" NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "work_items_job_id_key" ON "work_items"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_items_chat_run_id_key" ON "work_items"("chat_run_id");

-- CreateIndex
CREATE INDEX "work_items_user_id_state_created_at_idx" ON "work_items"("user_id", "state", "created_at");

-- CreateIndex
CREATE INDEX "work_items_campaign_id_idx" ON "work_items"("campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_items_user_id_identity_key" ON "work_items"("user_id", "identity");

-- CreateIndex
CREATE UNIQUE INDEX "work_requests_user_id_idempotency_key_key" ON "work_requests"("user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "work_events_work_item_id_created_at_idx" ON "work_events"("work_item_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "work_events_work_item_id_event_id_key" ON "work_events"("work_item_id", "event_id");

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("campaign_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_chat_run_id_fkey" FOREIGN KEY ("chat_run_id") REFERENCES "chat_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_requests" ADD CONSTRAINT "work_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_events" ADD CONSTRAINT "work_events_work_item_id_fkey" FOREIGN KEY ("work_item_id") REFERENCES "work_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One browser-owning lease per profile across every entry point and API process.
CREATE UNIQUE INDEX work_items_one_active_user ON work_items(user_id)
WHERE state IN ('preparing', 'ready', 'filling', 'stopping');
ALTER TABLE work_items ADD CONSTRAINT work_items_kind_link CHECK (
  (kind = 'application' AND job_id IS NOT NULL AND chat_run_id IS NULL)
  OR (kind = 'chat' AND chat_run_id IS NOT NULL AND job_id IS NULL)
  OR (kind = 'pilot_task' AND job_id IS NULL AND chat_run_id IS NULL AND intent IS NOT NULL)
);

-- Existing queued chats retain their message history. Interrupted execution is parked.
INSERT INTO work_items (id,user_id,kind,state,source,provider,identity,chat_run_id,title,payload,reason,updated_at)
SELECT gen_random_uuid()::text,r.user_id,'chat',
  CASE WHEN r.status = 'queued' THEN 'queued' ELSE 'needs_user' END::work_state,
  'migration',t.provider,'chat:' || r.id,r.id,t.title,jsonb_build_object('threadId',t.id),
  CASE WHEN r.status = 'queued' THEN NULL ELSE 'Execution predates the common queue. Inspect prior activity before resuming.' END,
  CURRENT_TIMESTAMP
FROM chat_runs r JOIN chat_threads t ON t.id = r.thread_id
WHERE r.status IN ('queued','running','waiting','interrupted');
UPDATE chat_runs SET status='interrupted',lease_token=NULL,lease_expires_at=NULL,
 error='Execution moved to the common queue. Inspect prior activity before resuming.'
WHERE status='running';

-- Do not infer safe retry from legacy URL strings or old applying timestamps.
INSERT INTO work_items (id,user_id,kind,state,source,identity,job_id,job_key,campaign_id,title,company,reason,updated_at)
SELECT gen_random_uuid()::text,c.user_id,'application','needs_user','migration','application:' || j.id,
 j.id,j.key,j.campaign_id,j.title,j.company,
 'Existing application work was parked at queue cutover. Review its submission history before explicitly resuming.',CURRENT_TIMESTAMP
FROM jobs j JOIN campaigns c ON c.campaign_id=j.campaign_id
WHERE j.status IN ('queued','approved','applying','needs_user');
UPDATE pilot_claims SET released_at=CURRENT_TIMESTAMP,outcome='abandoned' WHERE released_at IS NULL;
UPDATE pilot_questions q SET subject_id=j.id
FROM jobs j JOIN campaigns c ON c.campaign_id=j.campaign_id
WHERE q.user_id=c.user_id AND q.subject_type='job' AND q.subject_id=j.campaign_id || ':' || j.key;
