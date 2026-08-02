CREATE TABLE "framework_builds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_name" TEXT NOT NULL,
    "package_name" TEXT NOT NULL,
    "destination_type" TEXT NOT NULL,
    "target_directory" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "target_branch" TEXT NOT NULL,
    "github_owner" TEXT,
    "github_repository" TEXT,
    "created_file_count" INTEGER NOT NULL DEFAULT 0,
    "overwritten_file_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_file_count" INTEGER NOT NULL DEFAULT 0,
    "total_file_count" INTEGER NOT NULL DEFAULT 0,
    "local_git_status" TEXT,
    "github_remote_status" TEXT,
    "github_pull_request_url" TEXT,
    "registered_repository_id" UUID,
    "request" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "framework_builds_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "framework_builds_created_at_idx" ON "framework_builds"("created_at");
CREATE INDEX "framework_builds_registered_repository_id_idx" ON "framework_builds"("registered_repository_id");

ALTER TABLE "framework_builds" ADD CONSTRAINT "framework_builds_registered_repository_id_fkey" FOREIGN KEY ("registered_repository_id") REFERENCES "repositories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
