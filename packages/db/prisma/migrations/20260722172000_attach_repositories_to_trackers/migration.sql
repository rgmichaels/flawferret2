ALTER TABLE "repositories"
ADD COLUMN "tracker_integration_id" UUID;

CREATE INDEX "repositories_tracker_integration_id_idx" ON "repositories"("tracker_integration_id");

ALTER TABLE "repositories"
ADD CONSTRAINT "repositories_tracker_integration_id_fkey"
FOREIGN KEY ("tracker_integration_id")
REFERENCES "tracker_integrations"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
