import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { z } from "zod";

loadEnv({
  path: resolve(process.cwd(), "../../.env"),
});

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  WORKER_ID: z.string().optional(),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  WORKER_SIMULATED_WORK_MS: z.coerce.number().int().positive().default(10000),
  WORKER_VERSION: z.string().default("0.1.0"),
});

export const config = envSchema.parse(process.env);
