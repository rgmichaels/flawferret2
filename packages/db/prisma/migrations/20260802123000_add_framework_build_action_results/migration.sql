ALTER TABLE "framework_builds"
ADD COLUMN "install_status" TEXT,
ADD COLUMN "install_result" JSONB,
ADD COLUMN "open_folder_status" TEXT,
ADD COLUMN "open_folder_result" JSONB,
ADD COLUMN "smoke_validation_status" TEXT,
ADD COLUMN "smoke_validation_result" JSONB;
