ALTER TABLE "repositories"
DROP COLUMN IF EXISTS "jira_base_url",
DROP COLUMN IF EXISTS "jira_project_key",
DROP COLUMN IF EXISTS "jira_issue_type",
DROP COLUMN IF EXISTS "jira_email",
DROP COLUMN IF EXISTS "jira_api_token";
