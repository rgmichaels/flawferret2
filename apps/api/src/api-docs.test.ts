import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@flawferret2/db";
import type { FastifyInstance } from "fastify";
import { buildServer } from "./server.js";

let server: FastifyInstance;

describe("api documentation", () => {
  before(async () => {
    server = await buildServer();
  });

  after(async () => {
    await server.close();
    await prisma.$disconnect();
  });

  it("exposes an OpenAPI document for Swagger UI", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/documentation/json",
    });

    assert.equal(response.statusCode, 200);
    const document = response.json<{
      info: {
        title: string;
      };
      openapi: string;
      paths: Record<string, unknown>;
      tags: Array<{
        name: string;
      }>;
    }>();

    assert.equal(document.info.title, "FlawFerret 2 API");
    assert.ok(document.openapi.startsWith("3."));
    assert.ok(document.paths["/health"]);
    assert.ok(document.paths["/frameworks/create"]);
    assert.ok(document.tags.some((tag) => tag.name === "Frameworks"));
  });
});
