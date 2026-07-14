-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('STARTED', 'CODEX_RUNNING', 'VALIDATING', 'PUSHING', 'PR_CREATED', 'SUCCEEDED', 'FAILED');

-- AlterEnum
ALTER TYPE "JobEventType" ADD VALUE 'RUN_STARTED';

-- CreateTable
CREATE TABLE "runs" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'STARTED',
    "worker_id" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "runs_job_id_created_at_idx" ON "runs"("job_id", "created_at");

-- CreateIndex
CREATE INDEX "runs_status_idx" ON "runs"("status");

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
