import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { installFrameworkDependencies, openFrameworkFolder, validateFrameworkSmokeTest } from "./framework-validation.js";

describe("framework dependency install", () => {
  it("skips installation when package.json is missing", async () => {
    const result = await installFrameworkDependencies(
      {
        targetDirectory: "/tmp/generated-framework",
      },
      {
        canAccess: async () => {
          throw new Error("missing");
        },
      },
    );

    assert.equal(result.status, "skipped");
    assert.equal(result.exitCode, null);
    assert.match(result.message, /package\.json/);
  });

  it("runs pnpm install from the target directory", async () => {
    const targetDirectory = "/tmp/generated-framework";
    const calls: Array<{ args: string[]; command: string; cwd: string }> = [];
    const result = await installFrameworkDependencies(
      {
        targetDirectory,
      },
      {
        canAccess: async (path) => {
          assert.equal(path, join(resolve(targetDirectory), "package.json"));
        },
        runner: async (command, args, options) => {
          calls.push({ args, command, cwd: options.cwd });

          return {
            stderr: "",
            stdout: args.includes("chromium") ? "chromium installed" : "dependencies installed",
          };
        },
      },
    );

    assert.equal(result.status, "installed");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "dependencies installed\nchromium installed");
    assert.match(result.message, /Chromium browser installed/);
    assert.deepEqual(calls, [
      {
        args: ["install"],
        command: "pnpm",
        cwd: resolve(targetDirectory),
      },
      {
        args: ["exec", "playwright", "install", "chromium"],
        command: "pnpm",
        cwd: resolve(targetDirectory),
      },
    ]);
  });

  it("captures failing dependency installation output", async () => {
    const error = new Error("failed") as Error & {
      code: number;
      stderr: string;
      stdout: string;
    };
    error.code = 1;
    error.stderr = "install failed";
    error.stdout = "resolving packages";
    const result = await installFrameworkDependencies(
      {
        targetDirectory: "/tmp/generated-framework",
      },
      {
        canAccess: async () => {},
        runner: async () => {
          throw error;
        },
      },
    );

    assert.equal(result.status, "failed");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, "install failed");
    assert.equal(result.stdout, "resolving packages");
  });

  it("approves pnpm build scripts and retries installation", async () => {
    const error = new Error("failed") as Error & {
      code: number;
      stderr: string;
      stdout: string;
    };
    error.code = 1;
    error.stderr = "";
    error.stdout = '[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.28.1\nRun "pnpm approve-builds"';
    const calls: Array<{ args: string[]; command: string }> = [];
    const result = await installFrameworkDependencies(
      {
        targetDirectory: "/tmp/generated-framework",
      },
      {
        canAccess: async () => {},
        runner: async (command, args) => {
          calls.push({ args, command });

          if (calls.length === 1) {
            throw error;
          }

          return {
            stderr: "",
            stdout: args.join(" "),
          };
        },
      },
    );

    assert.equal(result.status, "installed");
    assert.equal(result.exitCode, 0);
    assert.match(result.message, /Chromium browser installed/);
    assert.deepEqual(calls, [
      {
        args: ["install"],
        command: "pnpm",
      },
      {
        args: ["approve-builds", "--all"],
        command: "pnpm",
      },
      {
        args: ["install"],
        command: "pnpm",
      },
      {
        args: ["exec", "playwright", "install", "chromium"],
        command: "pnpm",
      },
    ]);
  });
});

describe("framework folder opener", () => {
  it("skips opening when the target directory is missing", async () => {
    const result = await openFrameworkFolder(
      {
        targetDirectory: "/tmp/generated-framework",
      },
      {
        canAccess: async () => {
          throw new Error("missing");
        },
      },
    );

    assert.equal(result.status, "skipped");
    assert.match(result.message, /does not exist/);
  });

  it("opens the target directory", async () => {
    const targetDirectory = "/tmp/generated-framework";
    const calls: Array<{ args: string[]; command: string; cwd: string }> = [];
    const result = await openFrameworkFolder(
      {
        targetDirectory,
      },
      {
        canAccess: async (path) => {
          assert.equal(path, resolve(targetDirectory));
        },
        runner: async (command, args, options) => {
          calls.push({ args, command, cwd: options.cwd });

          return {
            stderr: "",
            stdout: "",
          };
        },
      },
    );

    assert.equal(result.status, "opened");
    assert.deepEqual(calls, [
      {
        args: [resolve(targetDirectory)],
        command: "open",
        cwd: resolve(targetDirectory),
      },
    ]);
  });

  it("captures open command failures", async () => {
    const result = await openFrameworkFolder(
      {
        targetDirectory: "/tmp/generated-framework",
      },
      {
        canAccess: async () => {},
        runner: async () => {
          throw new Error("open failed");
        },
      },
    );

    assert.equal(result.status, "failed");
    assert.equal(result.message, "open failed");
  });
});

describe("framework smoke validation", () => {
  it("skips validation when dependencies are not installed", async () => {
    const result = await validateFrameworkSmokeTest(
      {
        targetDirectory: "/tmp/generated-framework",
      },
      {
        canAccess: async () => {
          throw new Error("missing");
        },
      },
    );

    assert.equal(result.status, "skipped");
    assert.equal(result.exitCode, null);
    assert.match(result.message, /pnpm install/);
  });

  it("runs the generated smoke test from the target directory", async () => {
    const targetDirectory = "/tmp/generated-framework";
    const calls: Array<{ args: string[]; command: string; cwd: string }> = [];
    const result = await validateFrameworkSmokeTest(
      {
        targetDirectory,
      },
      {
        canAccess: async (path) => {
          assert.equal(path, join(resolve(targetDirectory), "node_modules"));
        },
        runner: async (command, args, options) => {
          calls.push({ args, command, cwd: options.cwd });

          return {
            stderr: "",
            stdout: "smoke passed",
          };
        },
      },
    );

    assert.equal(result.status, "passed");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "smoke passed");
    assert.deepEqual(calls, [
      {
        args: ["test:smoke"],
        command: "pnpm",
        cwd: resolve(targetDirectory),
      },
    ]);
  });

  it("captures failing smoke test output", async () => {
    const error = new Error("failed") as Error & {
      code: number;
      stderr: string;
      stdout: string;
    };
    error.code = 1;
    error.stderr = "assertion failed";
    error.stdout = "running smoke";
    const result = await validateFrameworkSmokeTest(
      {
        targetDirectory: "/tmp/generated-framework",
      },
      {
        canAccess: async () => {},
        runner: async () => {
          throw error;
        },
      },
    );

    assert.equal(result.status, "failed");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, "assertion failed");
    assert.equal(result.stdout, "running smoke");
  });

  it("names the scenario in the message when a single scenario passes", async () => {
    const report = JSON.stringify([
      {
        elements: [
          {
            keyword: "Scenario",
            name: "Configured base URL loads successfully",
            steps: [{ result: { status: "passed" } }, { result: { status: "passed" } }],
          },
        ],
      },
    ]);
    const result = await validateFrameworkSmokeTest(
      {
        targetDirectory: "/tmp/generated-framework",
      },
      {
        canAccess: async () => {},
        readReportFile: async () => report,
        runner: async () => ({ stderr: "", stdout: "smoke passed" }),
      },
    );

    assert.equal(result.status, "passed");
    assert.equal(result.message, '"Configured base URL loads successfully" passed.');
    assert.deepEqual(result.scenarios, [{ name: "Configured base URL loads successfully", status: "passed" }]);
  });

  it("names all scenarios when multiple scenarios all pass", async () => {
    const report = JSON.stringify([
      {
        elements: [
          { keyword: "Scenario", name: "A", steps: [{ result: { status: "passed" } }] },
          { keyword: "Scenario", name: "B", steps: [{ result: { status: "passed" } }] },
          { keyword: "Scenario", name: "C", steps: [{ result: { status: "passed" } }] },
        ],
      },
    ]);
    const result = await validateFrameworkSmokeTest(
      {
        targetDirectory: "/tmp/generated-framework",
      },
      {
        canAccess: async () => {},
        readReportFile: async () => report,
        runner: async () => ({ stderr: "", stdout: "smoke passed" }),
      },
    );

    assert.equal(result.status, "passed");
    assert.equal(result.message, 'All 3 scenarios passed: "A", "B", "C".');
    assert.equal(result.scenarios?.length, 3);
  });

  it("identifies the failing scenario(s) by name when some scenarios fail", async () => {
    const report = JSON.stringify([
      {
        elements: [
          { keyword: "Scenario", name: "A", steps: [{ result: { status: "passed" } }] },
          { keyword: "Scenario", name: "B", steps: [{ result: { status: "failed" } }] },
          { keyword: "Scenario", name: "C", steps: [{ result: { status: "passed" } }] },
        ],
      },
    ]);
    const error = new Error("failed") as Error & {
      code: number;
      stderr: string;
      stdout: string;
    };
    error.code = 1;
    error.stderr = "assertion failed";
    error.stdout = "running smoke";
    const result = await validateFrameworkSmokeTest(
      {
        targetDirectory: "/tmp/generated-framework",
      },
      {
        canAccess: async () => {},
        readReportFile: async () => report,
        runner: async () => {
          throw error;
        },
      },
    );

    assert.equal(result.status, "failed");
    assert.equal(result.message, '1 of 3 scenarios failed: "B".');
    assert.deepEqual(result.scenarios, [
      { name: "A", status: "passed" },
      { name: "B", status: "failed" },
      { name: "C", status: "passed" },
    ]);
  });

  it("falls back to the generic message when the report is missing or unparsable", async () => {
    const result = await validateFrameworkSmokeTest(
      {
        targetDirectory: "/tmp/generated-framework",
      },
      {
        canAccess: async () => {},
        readReportFile: async () => {
          throw new Error("ENOENT");
        },
        runner: async () => ({ stderr: "", stdout: "smoke passed" }),
      },
    );

    assert.equal(result.status, "passed");
    assert.equal(result.message, "Generated smoke test passed.");
    assert.deepEqual(result.scenarios, []);
  });

  it("deletes any report on disk before invoking the smoke runner, so it is called before the runner regardless of outcome", async () => {
    const targetDirectory = "/tmp/generated-framework";
    const reportPath = join(resolve(targetDirectory), "reports", "cucumber-report.json");
    const calls: string[] = [];
    let runnerCalled = false;
    await validateFrameworkSmokeTest(
      {
        targetDirectory,
      },
      {
        canAccess: async () => {},
        deleteReportFile: async (path) => {
          calls.push(path);
          assert.equal(runnerCalled, false, "report must be deleted before the runner executes");
        },
        runner: async () => {
          runnerCalled = true;

          return { stderr: "", stdout: "smoke passed" };
        },
      },
    );

    assert.deepEqual(calls, [reportPath]);
  });

  it("falls back to the generic message when a stale report from a prior run is actually on disk and the current run fails before Cucumber runs", async () => {
    const targetDirectory = await mkdtemp(join(tmpdir(), "framework-smoke-stale-report-"));

    try {
      const reportDirectory = join(targetDirectory, "reports");
      await mkdir(reportDirectory, { recursive: true });
      await writeFile(
        join(reportDirectory, "cucumber-report.json"),
        JSON.stringify([
          {
            elements: [
              {
                keyword: "Scenario",
                name: "Configured base URL loads successfully",
                steps: [{ result: { status: "passed" } }],
              },
            ],
          },
        ]),
        "utf8",
      );

      const error = new Error("failed") as Error & {
        code: number;
        stderr: string;
        stdout: string;
      };
      error.code = 1;
      error.stderr = "SyntaxError: Unexpected token in generated step file";
      error.stdout = "";

      const result = await validateFrameworkSmokeTest(
        {
          targetDirectory,
        },
        {
          canAccess: async () => {},
          runner: async () => {
            throw error;
          },
        },
      );

      assert.equal(result.status, "failed");
      assert.equal(result.exitCode, 1);
      assert.equal(result.message, "Generated smoke test failed.");
      assert.deepEqual(result.scenarios, []);
    } finally {
      await rm(targetDirectory, { force: true, recursive: true });
    }
  });

  it("returns a structured failure instead of throwing when deleting the stale report fails for a non-missing-file reason", async () => {
    let runnerCalled = false;
    const result = await validateFrameworkSmokeTest(
      {
        targetDirectory: "/tmp/generated-framework",
      },
      {
        canAccess: async () => {},
        deleteReportFile: async () => {
          const error = new Error("EACCES: permission denied") as Error & { code: string };
          error.code = "EACCES";
          throw error;
        },
        runner: async () => {
          runnerCalled = true;

          return { stderr: "", stdout: "smoke passed" };
        },
      },
    );

    assert.equal(runnerCalled, false, "the smoke runner must not execute when the prior report cannot be cleared");
    assert.equal(result.status, "failed");
    assert.equal(result.exitCode, null);
    assert.match(result.message, /Unable to clear the previous smoke test report/);
    assert.match(result.message, /EACCES/);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.equal(result.scenarios, undefined);
  });

  it("falls back to the generic message when the report is malformed JSON without affecting pass/fail", async () => {
    const error = new Error("failed") as Error & {
      code: number;
      stderr: string;
      stdout: string;
    };
    error.code = 1;
    error.stderr = "assertion failed";
    error.stdout = "running smoke";
    const result = await validateFrameworkSmokeTest(
      {
        targetDirectory: "/tmp/generated-framework",
      },
      {
        canAccess: async () => {},
        readReportFile: async () => "not json",
        runner: async () => {
          throw error;
        },
      },
    );

    assert.equal(result.status, "failed");
    assert.equal(result.exitCode, 1);
    assert.equal(result.message, "Generated smoke test failed.");
    assert.deepEqual(result.scenarios, []);
  });
});
