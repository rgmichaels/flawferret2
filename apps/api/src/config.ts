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

const optionalUrl = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().url().optional());

const envSchema = z.object({
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  CODEX_COMMAND: z.string().trim().min(1).default("codex"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  FERRET_RUNNER_ENABLE_CODEX: envBoolean.default(false),
  FERRET_RUNNER_ENABLE_PR_CREATION: envBoolean.default(false),
  FERRET_RUNNER_VALIDATION_COMMAND: z.string().trim().optional(),
  SLACK_WEBHOOK_URL: optionalUrl,
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
});

export const config = envSchema.parse(process.env);
