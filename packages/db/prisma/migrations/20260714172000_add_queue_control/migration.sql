-- CreateTable
CREATE TABLE "queue_controls" (
    "id" TEXT NOT NULL,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "paused_at" TIMESTAMP(3),
    "resumed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "queue_controls_pkey" PRIMARY KEY ("id")
);

-- SeedSingleton
INSERT INTO "queue_controls" ("id", "paused", "resumed_at", "updated_at")
VALUES ('default', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
