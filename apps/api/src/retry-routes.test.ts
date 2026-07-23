import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, describe, it } from "node:test";
import { prisma, type Prisma } from "@flawferret2/db";
import type { FastifyInstance } from "fastify";
import { buildServer } from "./server.js";

let server: FastifyInstance;
const jobIds: string[] = [];
const repositoryIds: string[] = [];
const trackerIntegrationIds: string[] = [];

const createRepository = async (overrides: Partial<Prisma.RepositoryCreateInput> = {}) => {
  const suffix = randomUUID().slice(0, 8);
  const repository = await prisma.repository.create({
    data: {
      cloneUrl: `https://github.com/rgmichaels/test-${suffix}.git`,
      defaultBranch: "main",
      localPath: `/tmp/flawferret-test-${suffix}`,
      name: `test-${suffix}`,
      owner: "rgmichaels",
      validationCommand: "pnpm test",
      webUrl: `https://github.com/rgmichaels/test-${suffix}`,
      ...overrides,
    },
  });

  repositoryIds.push(repository.id);

  return repository;
};

const createJob = async ({
  metadata,
  runStatus = "FAILED",
  status,
}: {
  metadata?: Prisma.InputJsonValue;
  runStatus?: "FAILED" | "SUCCEEDED";
  status: "BLOCKED" | "COMPLETED" | "FAILED" | "NEEDS_REVIEW" | "PR_APPROVED" | "QUEUED" | "REVIEW" | "RETRY";
}) => {
  const repository = await createRepository();
  const job = await prisma.job.create({
    data: {
      jobType: "ADD_PLAYWRIGHT_TEST",
      payload: {
        acceptanceCriteria: "Adds useful coverage.",
        createDraftPr: true,
        featureArea: "Retry routes",
        goal: "Exercise retry route behavior.",
        repositoryId: repository.id,
        runAffectedTests: true,
        targetBranch: "main",
      },
      priority: "NORMAL",
      repositoryId: repository.id,
      runs: metadata
        ? {
            create: {
              metadata,
              status: runStatus,
              workerId: "test-worker",
            },
          }
        : undefined,
      status,
    },
  });

  jobIds.push(job.id);

  return job;
};

describe("retry routes", () => {
  before(async () => {
    server = await buildServer();
  });

  afterEach(async () => {
    await prisma.job.deleteMany({
      where: {
        id: {
          in: jobIds.splice(0),
        },
      },
    });
    await prisma.trackerIntegration.deleteMany({
      where: {
        id: {
          in: trackerIntegrationIds.splice(0),
        },
      },
    });
    await prisma.repository.deleteMany({
      where: {
        id: {
          in: repositoryIds.splice(0),
        },
      },
    });
  });

  after(async () => {
    await server.close();
    await prisma.$disconnect();
  });

  it("requeues blocked jobs for setup retry", async () => {
    const job = await createJob({
      status: "BLOCKED",
    });

    const response = await server.inject({
      method: "POST",
      url: `/jobs/${job.id}/requeue`,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().status, "QUEUED");

    const resetEvent = await prisma.jobEvent.findFirstOrThrow({
      where: {
        eventType: "JOB_RESET",
        jobId: job.id,
      },
    });

    assert.equal(resetEvent.message, "Job was requeued for setup retry.");
  });

  it("creates a dev sample Discover review job", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/dev/sample-review-job",
    });
    const body = response.json();

    jobIds.push(body.id);
    repositoryIds.push(body.repository.id);

    assert.equal(response.statusCode, 201);
    assert.equal(body.status, "NEEDS_REVIEW");
    assert.equal(body.priority, "HIGH");
    assert.equal(body.payload.acceptanceCriteria.includes("Source: Page discovery recommendation"), true);
    assert.equal(body.payload.acceptanceCriteria.includes("Suggested scenario:"), true);
    assert.equal(body.repository.name, "flawferret2-dev-sample");

    const event = await prisma.jobEvent.findFirstOrThrow({
      where: {
        eventType: "JOB_CREATED",
        jobId: body.id,
      },
    });

    assert.equal(event.message, "Dev sample Discover review job was created.");
    assert.equal((event.metadata as { devSample?: boolean }).devSample, true);
  });

  it("rejects requeue requests for non-retryable statuses", async () => {
    const job = await createJob({
      status: "COMPLETED",
    });

    const response = await server.inject({
      method: "POST",
      url: `/jobs/${job.id}/requeue`,
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.json().message, "Only blocked, failed, or retry jobs can be requeued.");
  });

  it("cancels queued jobs to remove them from active queue work", async () => {
    const job = await createJob({
      status: "QUEUED",
    });

    const response = await server.inject({
      method: "POST",
      url: `/jobs/${job.id}/cancel`,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().status, "CANCELED");

    const cancelEvent = await prisma.jobEvent.findFirstOrThrow({
      where: {
        eventType: "JOB_CANCELED",
        jobId: job.id,
      },
    });

    assert.equal(cancelEvent.message, "Job was removed from the active queue.");
    assert.deepEqual(cancelEvent.metadata, {
      previousStatus: "QUEUED",
      reviewAction: "canceled",
    });
  });

  it("updates repository configuration", async () => {
    const repository = await createRepository();

    const response = await server.inject({
      body: {
        defaultBranch: "develop",
        localPath: repository.localPath,
        name: repository.name,
        owner: repository.owner,
        provider: "GITHUB",
        validationCommand: "pnpm test:changed",
      },
      method: "PUT",
      url: `/repositories/${repository.id}`,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().defaultBranch, "develop");
    assert.equal(response.json().validationCommand, "pnpm test:changed");
  });

  it("deletes registered repositories while preserving job history", async () => {
    const job = await createJob({
      status: "QUEUED",
    });
    const repositoryId = job.repositoryId;

    const response = await server.inject({
      method: "DELETE",
      url: `/repositories/${repositoryId}`,
    });

    assert.equal(response.statusCode, 204);
    repositoryIds.splice(repositoryIds.indexOf(repositoryId ?? ""), 1);

    const retainedJob = await prisma.job.findUniqueOrThrow({
      where: {
        id: job.id,
      },
    });

    assert.equal(retainedJob.repositoryId, null);
  });

  it("saves tracker integrations without returning API tokens", async () => {
    const response = await server.inject({
      body: {
        apiToken: "jira-secret",
        baseUrl: "https://example.atlassian.net/",
        email: "qa@example.com",
        issueType: "Task",
        name: `QA Jira ${randomUUID().slice(0, 8)}`,
        projectKey: "IPCT",
        provider: "JIRA",
      },
      method: "POST",
      url: "/tracker-integrations",
    });
    const body = response.json();

    trackerIntegrationIds.push(body.id);

    assert.equal(response.statusCode, 201);
    assert.equal(body.baseUrl, "https://example.atlassian.net");
    assert.equal(body.hasApiToken, true);
    assert.equal("apiToken" in body, false);
  });

  it("updates tracker integrations while preserving blank API tokens", async () => {
    const integration = await prisma.trackerIntegration.create({
      data: {
        apiToken: "existing-token",
        baseUrl: "https://example.atlassian.net",
        email: "qa@example.com",
        issueType: "Task",
        name: `QA Jira ${randomUUID().slice(0, 8)}`,
        projectKey: "IPCT",
      },
    });
    trackerIntegrationIds.push(integration.id);

    const response = await server.inject({
      body: {
        apiToken: "",
        baseUrl: "https://example.atlassian.net",
        email: "qa-updated@example.com",
        issueType: "Bug",
        name: integration.name,
        projectKey: "IPCT",
        provider: "JIRA",
      },
      method: "PUT",
      url: `/tracker-integrations/${integration.id}`,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().email, "qa-updated@example.com");

    const savedIntegration = await prisma.trackerIntegration.findUniqueOrThrow({
      where: {
        id: integration.id,
      },
    });

    assert.equal(savedIntegration.apiToken, "existing-token");
  });

  it("tests tracker integrations against the saved Jira project", async () => {
    const originalFetch = globalThis.fetch;
    const integration = await prisma.trackerIntegration.create({
      data: {
        apiToken: "existing-token",
        baseUrl: "https://example.atlassian.net",
        email: "qa@example.com",
        issueType: "Task",
        name: `QA Jira ${randomUUID().slice(0, 8)}`,
        projectKey: "IPCT",
      },
    });
    trackerIntegrationIds.push(integration.id);
    const calls: Array<{ headers: unknown; url: string }> = [];

    globalThis.fetch = async (url, init) => {
      calls.push({
        headers: init?.headers,
        url: String(url),
      });

      if (String(url).endsWith("/rest/api/3/myself")) {
        return new Response(JSON.stringify({ accountId: "jira-user" }), {
          headers: {
            "Content-Type": "application/json",
          },
          status: 200,
        });
      }

      return new Response(JSON.stringify({ key: "IPCT", name: "IPCT Project" }), {
        headers: {
          "Content-Type": "application/json",
        },
        status: 200,
      });
    };

    try {
      const response = await server.inject({
        method: "POST",
        url: `/tracker-integrations/${integration.id}/test`,
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.json().ok, true);
      assert.equal(response.json().projectName, "IPCT Project");
      assert.equal(calls[0]?.url, "https://example.atlassian.net/rest/api/3/myself");
      assert.equal(calls[1]?.url, "https://example.atlassian.net/rest/api/3/project/IPCT");
      assert.match(String((calls[0]?.headers as Record<string, string>).Authorization), /^Basic /);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reports rejected Jira credentials before checking project access", async () => {
    const originalFetch = globalThis.fetch;
    const integration = await prisma.trackerIntegration.create({
      data: {
        apiToken: "bad-token",
        baseUrl: "https://example.atlassian.net",
        email: "qa@example.com",
        issueType: "Task",
        name: `QA Jira ${randomUUID().slice(0, 8)}`,
        projectKey: "IPCT",
      },
    });
    trackerIntegrationIds.push(integration.id);
    const calls: string[] = [];

    globalThis.fetch = async (url) => {
      calls.push(String(url));

      return new Response("Client must be authenticated to access this resource.", {
        status: 401,
      });
    };

    try {
      const response = await server.inject({
        method: "POST",
        url: `/tracker-integrations/${integration.id}/test`,
      });

      assert.equal(response.statusCode, 502);
      assert.equal(response.json().ok, false);
      assert.match(response.json().message, /credentials were rejected/i);
      assert.deepEqual(calls, ["https://example.atlassian.net/rest/api/3/myself"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("creates Jira tickets when reviewed jobs are approved for tracked repositories", async () => {
    const originalFetch = globalThis.fetch;
    const integration = await prisma.trackerIntegration.create({
      data: {
        apiToken: "jira-token",
        baseUrl: "https://example.atlassian.net",
        email: "qa@example.com",
        issueType: "Task",
        name: `QA Jira ${randomUUID().slice(0, 8)}`,
        projectKey: "IPCT",
      },
    });
    trackerIntegrationIds.push(integration.id);
    const repository = await createRepository({
      trackerIntegration: {
        connect: {
          id: integration.id,
        },
      },
    });
    const calls: string[] = [];

    globalThis.fetch = async (url) => {
      calls.push(String(url));

      return new Response(JSON.stringify({ id: "10001", key: "IPCT-99", self: "https://example.atlassian.net/rest/api/3/issue/10001" }), {
        headers: {
          "Content-Type": "application/json",
        },
        status: 201,
      });
    };

    try {
      const response = await server.inject({
        body: {
          jobType: "ADD_PLAYWRIGHT_TEST",
          payload: {
            acceptanceCriteria: "Assert the important behavior.",
            createDraftPr: true,
            featureArea: "Tracked queue",
            goal: "Add tracked coverage.",
            repositoryId: repository.id,
            runAffectedTests: true,
            targetBranch: "main",
          },
          priority: "NORMAL",
        },
        method: "POST",
        url: "/jobs",
      });
      const body = response.json();
      jobIds.push(body.id);

      assert.equal(response.statusCode, 201);
      assert.equal(body.status, "NEEDS_REVIEW");
      assert.equal(body.payload.jiraIssue, undefined);
      assert.deepEqual(calls.filter((url) => url.startsWith("https://example.atlassian.net")), []);

      const approvalResponse = await server.inject({
        body: {
          createJiraTicket: true,
        },
        method: "POST",
        url: `/jobs/${body.id}/approve-review`,
      });
      const approvedBody = approvalResponse.json();

      assert.equal(approvalResponse.statusCode, 200);
      assert.equal(approvedBody.status, "QUEUED");
      assert.equal(approvedBody.payload.jiraIssue.key, "IPCT-99");
      assert.equal(approvedBody.payload.jiraIssue.url, "https://example.atlassian.net/browse/IPCT-99");
      assert.deepEqual(calls.filter((url) => url.startsWith("https://example.atlassian.net")), [
        "https://example.atlassian.net/rest/api/3/issue",
      ]);

      const event = await prisma.jobEvent.findFirstOrThrow({
        where: {
          eventType: "JIRA_TICKET_CREATED",
          jobId: body.id,
        },
      });

      assert.equal(event.message, "Jira ticket IPCT-99 was created for this job.");
      assert.deepEqual(event.metadata, {
        key: "IPCT-99",
        projectKey: "IPCT",
        reviewAction: "jira_ticket_created",
        trackerIntegrationId: integration.id,
        url: "https://example.atlassian.net/browse/IPCT-99",
      });

      const approvalEvent = await prisma.jobEvent.findFirstOrThrow({
        where: {
          eventType: "JOB_APPROVED",
          jobId: body.id,
        },
      });

      assert.equal(approvalEvent.message, "Job was approved and moved to the active queue.");
      assert.deepEqual(approvalEvent.metadata, {
        createJiraTicket: true,
        jiraIssueKey: "IPCT-99",
        previousStatus: "NEEDS_REVIEW",
        reviewAction: "approved",
        targetBranch: "main",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("updates review requests before they enter the active queue", async () => {
    const job = await createJob({
      status: "NEEDS_REVIEW",
    });

    const response = await server.inject({
      body: {
        payload: {
          acceptanceCriteria: "Assert the edited behavior.",
          featureArea: "Edited review request",
          goal: "Use the edited goal.",
          targetBranch: "qa-review",
        },
        priority: "HIGH",
      },
      method: "PUT",
      url: `/jobs/${job.id}/review-request`,
    });
    const body = response.json();

    assert.equal(response.statusCode, 200);
    assert.equal(body.status, "NEEDS_REVIEW");
    assert.equal(body.priority, "HIGH");
    assert.equal(body.payload.featureArea, "Edited review request");
    assert.equal(body.payload.goal, "Use the edited goal.");
    assert.equal(body.payload.acceptanceCriteria, "Assert the edited behavior.");
    assert.equal(body.payload.targetBranch, "qa-review");

    const updateEvent = await prisma.jobEvent.findFirstOrThrow({
      where: {
        eventType: "JOB_UPDATED",
        jobId: job.id,
      },
    });

    assert.equal(
      updateEvent.message,
      "Review request was edited before approval: priority, acceptanceCriteria, featureArea, goal, targetBranch.",
    );
    assert.deepEqual(updateEvent.metadata, {
      changedFields: ["priority", "acceptanceCriteria", "featureArea", "goal", "targetBranch"],
      newPriority: "HIGH",
      newTargetBranch: "qa-review",
      previousPriority: "NORMAL",
      previousTargetBranch: "main",
      reviewAction: "edited",
    });
  });

  it("rejects review request edits after jobs leave review", async () => {
    const job = await createJob({
      status: "QUEUED",
    });

    const response = await server.inject({
      body: {
        payload: {
          acceptanceCriteria: "Assert the edited behavior.",
          featureArea: "Edited review request",
          goal: "Use the edited goal.",
          targetBranch: "qa-review",
        },
        priority: "HIGH",
      },
      method: "PUT",
      url: `/jobs/${job.id}/review-request`,
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.json().message, "Only jobs that need review can be edited.");
  });

  it("returns paginated jobs when requested", async () => {
    await createJob({
      status: "QUEUED",
    });
    await createJob({
      status: "QUEUED",
    });

    const response = await server.inject({
      method: "GET",
      url: "/jobs?includeCanceled=true&paginated=true&page=1&pageSize=1",
    });
    const body = response.json();

    assert.equal(response.statusCode, 200);
    assert.equal(body.jobs.length, 1);
    assert.equal(body.page, 1);
    assert.equal(body.pageSize, 1);
    assert.equal(body.total >= 2, true);
  });

  it("filters jobs before paginating", async () => {
    await createJob({
      status: "QUEUED",
    });
    await createJob({
      status: "COMPLETED",
    });

    const response = await server.inject({
      method: "GET",
      url: "/jobs?includeCanceled=true&paginated=true&status=COMPLETED&page=1&pageSize=10",
    });
    const body = response.json();

    assert.equal(response.statusCode, 200);
    assert.equal(body.jobs.every((job: { status: string }) => job.status === "COMPLETED"), true);
    assert.equal(body.total >= 1, true);
  });

  it("returns validation-attempt jobs to validation retry", async () => {
    const job = await createJob({
      metadata: {
        validation: {
          command: "pnpm test",
          error: "validation failed",
        },
      },
      status: "BLOCKED",
    });

    const response = await server.inject({
      method: "POST",
      url: `/jobs/${job.id}/retry-stage`,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().status, "VALIDATING");

    const run = await prisma.run.findFirstOrThrow({
      where: {
        jobId: job.id,
      },
    });

    assert.equal(run.status, "VALIDATING");
  });

  it("returns Codex-attempt jobs to Codex approval when retry feedback is supplied", async () => {
    const job = await createJob({
      metadata: {
        codex: {
          finalResponse: "Needs a more focused assertion.",
        },
        pullRequest: {
          prUrl: "https://github.com/rgmichaels/test/pull/1",
        },
        validation: {
          command: "pnpm test",
        },
      },
      status: "REVIEW",
    });

    const response = await server.inject({
      body: {
        feedback: "Assert the empty state text.",
      },
      method: "POST",
      url: `/jobs/${job.id}/retry-stage`,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().status, "READY_FOR_CODEX");

    const run = await prisma.run.findFirstOrThrow({
      where: {
        jobId: job.id,
      },
    });
    const metadata = run.metadata as Record<string, unknown>;

    assert.equal(run.status, "READY_FOR_CODEX");
    assert.equal("pullRequest" in metadata, false);
    assert.equal("validation" in metadata, false);
    assert.deepEqual((metadata.retryFeedback as Record<string, unknown>).feedback, "Assert the empty state text.");
  });

  it("reports local checkout cleanup failures in readiness", async () => {
    const job = await createJob({
      status: "COMPLETED",
    });
    await prisma.jobEvent.create({
      data: {
        eventType: "LOCAL_CHECKOUT_CLEANUP_FAILED",
        jobId: job.id,
        message: "Local checkout cleanup failed after PR merge.",
        metadata: {
          baseBranch: "main",
          error: "branch delete failed",
          headBranch: "flawferret/job-abc123",
          localPath: "/tmp/flawferret-test",
        },
      },
    });

    const response = await server.inject({
      method: "GET",
      url: "/readiness",
    });
    const body = response.json();

    assert.equal(response.statusCode, 200);
    assert.equal(body.cleanup.latestFailure.jobId, job.id);
    assert.equal(body.cleanup.latestFailure.error, "branch delete failed");
    assert.equal(body.cleanup.latestFailure.href, `/jobs/${job.id}`);
    assert.equal(body.counts.cleanupFailures >= 1, true);
  });
});
