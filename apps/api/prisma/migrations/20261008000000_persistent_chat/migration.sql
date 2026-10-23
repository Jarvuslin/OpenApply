CREATE TYPE "chat_agent" AS ENUM ('assistant', 'search', 'resume', 'application', 'tracker');
CREATE TYPE "chat_provider" AS ENUM ('claude', 'codex');
CREATE TYPE "chat_role" AS ENUM ('user', 'assistant', 'system');
CREATE TYPE "chat_message_kind" AS ENUM ('text', 'activity', 'question', 'error');
CREATE TYPE "chat_run_status" AS ENUM ('queued', 'running', 'completed', 'failed', 'waiting', 'cancelled', 'interrupted');
CREATE TYPE "chat_origin" AS ENUM ('web');

CREATE TABLE "chat_threads" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "agent" "chat_agent" NOT NULL DEFAULT 'assistant',
  "provider" "chat_provider" NOT NULL DEFAULT 'claude',
  "provider_session_id" TEXT,
  "job_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "chat_threads_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "chat_threads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "chat_runs" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "thread_id" TEXT NOT NULL,
  "status" "chat_run_status" NOT NULL DEFAULT 'queued',
  "lease_token" TEXT,
  "lease_expires_at" TIMESTAMP(3),
  "cancellation_requested_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "error" TEXT,
  CONSTRAINT "chat_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "chat_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "chat_runs_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "chat_messages" (
  "id" TEXT NOT NULL,
  "thread_id" TEXT NOT NULL,
  "run_id" TEXT,
  "client_message_id" TEXT,
  "event_id" TEXT,
  "role" "chat_role" NOT NULL,
  "kind" "chat_message_kind" NOT NULL,
  "origin" "chat_origin" NOT NULL DEFAULT 'web',
  "content" TEXT NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "chat_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "chat_messages_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "chat_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "chat_threads_user_id_updated_at_idx" ON "chat_threads"("user_id", "updated_at");
CREATE INDEX "chat_runs_user_id_status_created_at_idx" ON "chat_runs"("user_id", "status", "created_at");
CREATE INDEX "chat_runs_thread_id_created_at_idx" ON "chat_runs"("thread_id", "created_at");
CREATE UNIQUE INDEX "chat_runs_one_running_per_user" ON "chat_runs"("user_id") WHERE "status" = 'running';
CREATE UNIQUE INDEX "chat_messages_thread_id_client_message_id_key" ON "chat_messages"("thread_id", "client_message_id");
CREATE UNIQUE INDEX "chat_messages_run_id_event_id_key" ON "chat_messages"("run_id", "event_id");
CREATE INDEX "chat_messages_thread_id_created_at_id_idx" ON "chat_messages"("thread_id", "created_at", "id");
