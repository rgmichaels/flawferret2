import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import type { ClaimedLocalTestRun } from "@flawferret2/db";

const sanitizePathPart = (value: string) => value.replace(/[^A-Za-z0-9_.-]/g, "-");

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

const normalizeCommandPath = (value: string) => value.split(sep).join("/");

const getLocalTestRunLogDir = (logDir: string, runId: string) =>
  resolve(logDir, "local-test-runs", sanitizePathPart(runId));

export const buildLocalTestCommand = (run: ClaimedLocalTestRun, configPath = "/dev/null") => {
  const target = run.scenarioLine ? `${run.featurePath}:${run.scenarioLine}` : run.featurePath;

  return [
    "npx cucumber-js",
    `--config ${shellQuote(configPath)}`,
    "--require-module ts-node/register/transpile-only",
    "--require 'src/support/**/*.ts'",
    "--require 'src/steps/**/*.ts'",
    "--format progress-bar",
    "--format summary",
    shellQuote(target),
  ].join(" ");
};

export const prepareLocalTestCommand = async ({
  localPath,
  logDir,
  run,
}: {
  localPath: string;
  logDir: string;
  run: ClaimedLocalTestRun;
}) => {
  const runLogDir = getLocalTestRunLogDir(logDir, run.id);
  await mkdir(runLogDir, {
    recursive: true,
  });

  const configPath = join(runLogDir, "cucumber.local.cjs");
  await writeFile(configPath, "module.exports = { default: {} };\n");

  return buildLocalTestCommand(run, normalizeCommandPath(relative(localPath, configPath)));
};

export const runLocalTest = async ({
  command,
  localPath,
  logDir,
  runId,
  timeoutMs,
}: {
  command: string;
  localPath: string;
  logDir: string;
  runId: string;
  timeoutMs: number;
}) => {
  const runLogDir = getLocalTestRunLogDir(logDir, runId);
  await mkdir(runLogDir, {
    recursive: true,
  });

  const stdoutPath = join(runLogDir, "stdout.log");
  const stderrPath = join(runLogDir, "stderr.log");
  const stdoutStream = createWriteStream(stdoutPath, {
    flags: "a",
  });
  const stderrStream = createWriteStream(stderrPath, {
    flags: "a",
  });

  let error: string | null = null;
  let timedOut = false;
  const child = spawn(command, {
    cwd: localPath,
    detached: true,
    env: process.env,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk: Buffer) => {
    stdoutStream.write(chunk);
  });

  child.stderr.on("data", (chunk: Buffer) => {
    stderrStream.write(chunk);
  });

  const killProcessGroup = (signal: NodeJS.Signals) => {
    if (!child.pid) {
      return;
    }

    try {
      process.kill(-child.pid, signal);
    } catch {
      child.kill(signal);
    }
  };

  const exitCode = await new Promise<number | null>((resolveExit) => {
    let killTimeout: NodeJS.Timeout | null = null;
    const timeout = setTimeout(() => {
      timedOut = true;
      error = `Local test run timed out after ${timeoutMs}ms.`;
      killProcessGroup("SIGTERM");
      killTimeout = setTimeout(() => {
        killProcessGroup("SIGKILL");
      }, 5000);
      killTimeout.unref();
    }, timeoutMs);
    timeout.unref();

    child.on("error", (spawnError) => {
      clearTimeout(timeout);
      if (killTimeout) {
        clearTimeout(killTimeout);
      }
      error = spawnError.message;
      resolveExit(null);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (killTimeout) {
        clearTimeout(killTimeout);
      }
      resolveExit(code);
    });
  });

  await Promise.all([
    new Promise<void>((resolveStream) => stdoutStream.end(resolveStream)),
    new Promise<void>((resolveStream) => stderrStream.end(resolveStream)),
  ]);

  return {
    error,
    exitCode,
    ok: exitCode === 0 && !error && !timedOut,
    stderrPath,
    stdoutPath,
    timedOut,
  };
};
