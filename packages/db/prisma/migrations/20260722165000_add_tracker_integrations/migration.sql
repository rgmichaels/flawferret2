CREATE TYPE "TrackerProvider" AS ENUM ('JIRA');

CREATE TABLE "tracker_integrations" (
    "id" UUID NOT NULL,
    "provider" "TrackerProvider" NOT NULL DEFAULT 'JIRA',
    "name" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "api_token" TEXT NOT NULL,
    "project_key" TEXT NOT NULL,
    "issue_type" TEXT NOT NULL DEFAULT 'Task',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tracker_integrations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tracker_integrations_provider_name_key" ON "tracker_integrations"("provider", "name");
