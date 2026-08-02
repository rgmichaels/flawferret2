import assert from "node:assert/strict";
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
            stdout: "dependencies installed",
          };
        },
      },
    );

    assert.equal(result.status, "installed");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "dependencies installed");
    assert.deepEqual(calls, [
      {
        args: ["install"],
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
});
