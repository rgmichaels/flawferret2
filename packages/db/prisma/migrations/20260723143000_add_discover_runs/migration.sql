CREATE TABLE "discover_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "repository_id" UUID NOT NULL,
    "target_branch" TEXT NOT NULL,
    "page_url" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "related_coverage" JSONB NOT NULL,
    "visible_decisions" JSONB NOT NULL,
    "hidden_decisions" JSONB NOT NULL,
    "queued_titles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discover_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "discover_runs_repository_id_created_at_idx" ON "discover_runs"("repository_id", "created_at");
CREATE INDEX "discover_runs_created_at_idx" ON "discover_runs"("created_at");

ALTER TABLE "discover_runs" ADD CONSTRAINT "discover_runs_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
