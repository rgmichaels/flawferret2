import { defineConfig, env } from "prisma/config";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({
  path: resolve(process.cwd(), "../../.env"),
});

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
