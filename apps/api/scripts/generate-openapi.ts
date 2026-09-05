import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { prisma } from "@flawferret2/db";
import { buildServer } from "../src/server.js";

// Renders the OpenAPI document that @fastify/swagger builds from the API's
// route schemas and writes it to disk, without binding to a port or needing
// a reachable database. Used by CI to publish static API docs — see
// .github/workflows/api-docs.yml.
const outputPath = resolve(process.cwd(), "openapi.json");

const server = await buildServer();
await server.ready();

const response = await server.inject({
  method: "GET",
  url: "/documentation/json",
});

if (response.statusCode !== 200) {
  throw new Error(`Expected /documentation/json to return 200, got ${response.statusCode}: ${response.body}`);
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(response.json(), null, 2)}\n`, "utf8");

console.log(`Wrote OpenAPI document to ${outputPath}`);

await server.close();
await prisma.$disconnect();
