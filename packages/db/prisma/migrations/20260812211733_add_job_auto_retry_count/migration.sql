-- AlterEnum
ALTER TYPE "JobEventType" ADD VALUE 'PR_CHECKS_AUTO_RETRY_QUEUED';

-- AlterTable
ALTER TABLE "discover_runs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "framework_builds" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "auto_retry_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "local_test_runs" ALTER COLUMN "id" DROP DEFAULT;
