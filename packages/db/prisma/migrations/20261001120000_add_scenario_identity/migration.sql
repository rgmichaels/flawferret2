-- AlterTable
ALTER TABLE "repositories" ADD COLUMN     "scenario_id_namespace" TEXT,
ADD COLUMN     "scenario_id_pattern" TEXT;

-- AlterTable
ALTER TABLE "local_test_runs" ADD COLUMN     "scenario_id" TEXT;

-- CreateTable
CREATE TABLE "scenarios" (
    "id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "scenario_id" TEXT NOT NULL,
    "last_seen_path" TEXT NOT NULL,
    "last_seen_line" INTEGER NOT NULL,
    "last_seen_name" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "id_source" TEXT NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "missing_since" TIMESTAMP(3),

    CONSTRAINT "scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scenarios_repository_id_last_seen_at_idx" ON "scenarios"("repository_id", "last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "scenarios_repository_id_scenario_id_key" ON "scenarios"("repository_id", "scenario_id");

-- CreateIndex
CREATE INDEX "local_test_runs_repository_id_scenario_id_created_at_idx" ON "local_test_runs"("repository_id", "scenario_id", "created_at");

-- AddForeignKey
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

