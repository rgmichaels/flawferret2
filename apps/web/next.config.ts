import type { NextConfig } from "next";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  transpilePackages: ["@flawferret2/job-schemas"],
  turbopack: {
    root: join(appDir, "../.."),
  },
};

export default nextConfig;
