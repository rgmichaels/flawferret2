-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('ADD_PLAYWRIGHT_TEST');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('DRAFT', 'QUEUED', 'CLAIMED', 'RUNNING', 'VALIDATING', 'REVIEW', 'COMPLETED', 'FAILED', 'BLOCKED', 'RETRY');

-- CreateEnum
CREATE TYPE "JobPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "WorkerStatus" AS ENUM ('IDLE', 'BUSY', 'OFFLINE', 'ERROR');

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL,
    "job_type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "priority" "JobPriority" NOT NULL DEFAULT 'NORMAL',
    "payload" JSONB NOT NULL,
    "claimed_by" TEXT,
    "claimed_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workers" (
    "id" UUID NOT NULL,
    "hostname" TEXT NOT NULL,
    "status" "WorkerStatus" NOT NULL DEFAULT 'IDLE',
    "current_job" TEXT,
    "last_heartbeat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" TEXT NOT NULL,

    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jobs_status_priority_created_at_idx" ON "jobs"("status", "priority", "created_at");

-- CreateIndex
CREATE INDEX "workers_status_idx" ON "workers"("status");

