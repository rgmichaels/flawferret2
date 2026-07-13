import { prisma } from "@flawferret2/db";
import { config } from "./config.js";
import { buildServer } from "./server.js";

const server = await buildServer();

const shutdown = async (): Promise<void> => {
  server.log.info("Shutting down FlawFerret2 API");
  await server.close();
  await prisma.$disconnect();
};

process.on("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});

await server.listen({
  host: config.API_HOST,
  port: config.API_PORT,
});
