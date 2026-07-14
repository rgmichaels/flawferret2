-- CreateEnum
CREATE TYPE "RepositoryProvider" AS ENUM ('GITHUB');

-- CreateTable
CREATE TABLE "repositories" (
    "id" UUID NOT NULL,
    "provider" "RepositoryProvider" NOT NULL DEFAULT 'GITHUB',
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "default_branch" TEXT NOT NULL DEFAULT 'main',
    "clone_url" TEXT NOT NULL,
    "web_url" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN "repository_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "repositories_provider_owner_name_key" ON "repositories"("provider", "owner", "name");

-- CreateIndex
CREATE INDEX "jobs_repository_id_idx" ON "jobs"("repository_id");

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
