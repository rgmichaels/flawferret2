CREATE TYPE "LocalTestRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'PASSED', 'FAILED', 'CANCELED');

CREATE TYPE "LocalTestRunScope" AS ENUM ('FEATURE', 'SCENARIO');

CREATE TABLE "local_test_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "repository_id" UUID NOT NULL,
    "scope" "LocalTestRunScope" NOT NULL DEFAULT 'FEATURE',
    "status" "LocalTestRunStatus" NOT NULL DEFAULT 'QUEUED',
    "feature_path" TEXT NOT NULL,
    "scenario_line" INTEGER,
    "command" TEXT,
    "exit_code" INTEGER,
    "stdout_path" TEXT,
    "stderr_path" TEXT,
    "error" TEXT,
    "worker_id" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "local_test_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "local_test_runs_status_created_at_idx" ON "local_test_runs"("status", "created_at");

CREATE INDEX "local_test_runs_repository_id_feature_path_created_at_idx" ON "local_test_runs"("repository_id", "feature_path", "created_at");

ALTER TABLE "local_test_runs" ADD CONSTRAINT "local_test_runs_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
