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
      components?: {
        schemas?: Record<
          string,
          {
            properties?: Record<string, unknown>;
            required?: string[];
            type?: string;
          }
        >;
      };
      info: {
        title: string;
      };
      openapi: string;
      paths: Record<
        string,
        Record<
          string,
          {
            parameters?: Array<{
              in: string;
              name: string;
              required?: boolean;
              schema?: {
                enum?: string[];
                $ref?: string;
                type?: string;
              };
            }>;
            requestBody?: {
              content?: Record<
                string,
                {
                  schema?: {
                    $ref?: string;
                  };
                }
              >;
            };
            responses?: Record<
              string,
              {
                content?: Record<
                  string,
                  {
                    schema?: {
                      $ref?: string;
                    };
                  }
                >;
              }
            >;
          }
        >
      >;
      tags: Array<{
        name: string;
      }>;
    }>();

    assert.equal(document.info.title, "FlawFerret 2 API");
    assert.ok(document.openapi.startsWith("3."));
    [
      "/health",
      "/readiness",
      "/repositories",
      "/repositories/{id}/features",
      "/repositories/{id}/features/local-test-runs",
      "/jobs",
      "/jobs/{id}",
      "/jobs/{id}/approve-review",
      "/discover/runs",
      "/tracker-integrations",
      "/frameworks/create",
      "/frameworks/builds/{id}",
    ].forEach((path) => {
      assert.ok(document.paths[path], `Expected ${path} in OpenAPI paths`);
    });
    ["System", "Jobs", "Repositories", "Features", "Discovery", "Frameworks", "Integrations"].forEach((tagName) => {
      assert.ok(document.tags.some((tag) => tag.name === tagName), `Expected ${tagName} tag`);
    });

    const schemas = document.components?.schemas ?? {};
    [
      "CreateJobRequest",
      "JobResponse",
      "CreateRepositoryRequest",
      "RepositoryResponse",
      "CreateFrameworkRequest",
      "CreateFrameworkResponse",
      "DiscoverTestRecommendationsRequest",
      "DiscoverRunResponse",
      "CucumberFeatureCatalogResponse",
      "LocalTestRunResponse",
      "ReadinessResponse",
      "TrackerIntegrationResponse",
    ].forEach((schemaName) => {
      assert.ok(schemas[schemaName], `Expected ${schemaName} component schema`);
    });

    assert.equal(schemas.CreateJobRequest?.type, "object");
    assert.ok(schemas.CreateJobRequest?.properties?.payload);
    assert.ok(schemas.RepositoryResponse?.properties?.owner);

    assert.equal(
      document.paths["/jobs"]?.post?.requestBody?.content?.["application/json"]?.schema?.$ref,
      "#/components/schemas/CreateJobRequest",
    );
    assert.equal(
      document.paths["/jobs"]?.post?.responses?.["201"]?.content?.["application/json"]?.schema?.$ref,
      "#/components/schemas/JobResponse",
    );
    assert.equal(
      document.paths["/frameworks/create"]?.post?.requestBody?.content?.["application/json"]?.schema?.$ref,
      "#/components/schemas/CreateFrameworkRequest",
    );
    assert.equal(
      document.paths["/repositories"]?.post?.requestBody?.content?.["application/json"]?.schema?.$ref,
      "#/components/schemas/CreateRepositoryRequest",
    );

    assert.ok(
      document.paths["/jobs"]?.get?.parameters?.some(
        (parameter) => parameter.in === "query" && parameter.name === "status",
      ),
      "Expected jobs status query parameter",
    );
    assert.ok(
      document.paths["/jobs"]?.get?.parameters?.some(
        (parameter) => parameter.in === "query" && parameter.name === "pageSize",
      ),
      "Expected jobs pageSize query parameter",
    );
    assert.ok(
      document.paths["/repositories/{id}/features/detail"]?.get?.parameters?.some(
        (parameter) => parameter.in === "path" && parameter.name === "id" && parameter.required,
      ),
      "Expected feature detail repository id path parameter",
    );
    assert.ok(
      document.paths["/repositories/{id}/features/detail"]?.get?.parameters?.some(
        (parameter) => parameter.in === "query" && parameter.name === "path" && parameter.required,
      ),
      "Expected feature detail path query parameter",
    );
    assert.ok(
      document.paths["/repositories/{id}/features/local-test-runs"]?.get?.parameters?.some(
        (parameter) => parameter.in === "query" && parameter.name === "scenarioLine",
      ),
      "Expected local test run scenarioLine query parameter",
    );
  });
});
