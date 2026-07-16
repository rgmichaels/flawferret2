import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { z } from "zod";

loadEnv({
  path: resolve(process.cwd(), "../../.env"),
});

const envBoolean = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "true" || normalized === "1") {
    return true;
  }

  if (normalized === "false" || normalized === "0") {
    return false;
  }

  return value;
}, z.boolean());

const envSchema = z.object({
  CODEX_COMMAND: z.string().trim().min(1).default("codex"),
  CODEX_MODEL: z.string().trim().optional(),
  CODEX_TIMEOUT_MS: z.coerce.number().int().positive().default(20 * 60 * 1000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  FERRET_RUNNER_ENABLE_CODEX: envBoolean.default(false),
  FERRET_RUNNER_ENABLE_PR_CREATION: envBoolean.default(false),
  FERRET_RUNNER_LOG_DIR: z.string().trim().min(1).default(".flawferret-runs"),
  FERRET_RUNNER_VALIDATION_COMMAND: z.string().trim().optional(),
  WORKER_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  WORKER_ID: z.string().optional(),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  WORKER_SIMULATED_WORK_MS: z.coerce.number().int().positive().default(10000),
  WORKER_VERSION: z.string().default("0.1.0"),
});

export const config = envSchema.parse(process.env);
