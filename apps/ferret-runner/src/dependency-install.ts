import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

export const DEFAULT_PNPM_INSTALL_COMMAND = "pnpm install --frozen-lockfile";

export type InstallCommandResolution =
  | {
      command: string;
      source: "environment" | "lockfile" | "repository";
    }
  | {
      command: null;
      reason: string;
      source: "none";
    };

export type DependencyInstallResult = {
  command: string;
  error: string | null;
  exitCode: number | null;
  logPath: string;
  ok: boolean;
  stderrPath: string;
  timedOut: boolean;
};

const sanitizePathPart = (value: string) => value.replace(/[^A-Za-z0-9_.-]/g, "-");

const getOptionalCommand = (value: string | null | undefined) => {
  const trimmed = value?.trim();

  return trimmed && trimmed.length > 0 ? trimmed : null;
};

const fileExists = async (path: string) => {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
};

// Precedence: Repository.installCommand, then FERRET_RUNNER_INSTALL_COMMAND, then a
// pnpm install when the worktree has a pnpm lockfile; otherwise the step is skipped.
export const resolveInstallCommand = async ({
  environmentCommand,
  repositoryCommand,
  worktreePath,
}: {
  environmentCommand?: string | null;
  repositoryCommand?: string | null;
  worktreePath: string;
}): Promise<InstallCommandResolution> => {
  const repositoryInstallCommand = getOptionalCommand(repositoryCommand);

  if (repositoryInstallCommand) {
    return { command: repositoryInstallCommand, source: "repository" };
  }

  const environmentInstallCommand = getOptionalCommand(environmentCommand);

  if (environmentInstallCommand) {
    return { command: environmentInstallCommand, source: "environment" };
  }

  if (await fileExists(join(worktreePath, "pnpm-lock.yaml"))) {
    return { command: DEFAULT_PNPM_INSTALL_COMMAND, source: "lockfile" };
  }

  return {
    command: null,
    reason: "No install command is configured and the worktree has no pnpm-lock.yaml.",
    source: "none",
  };
};

export const runDependencyInstall = async ({
  command,
  jobId,
  logDir,
  runId,
  timeoutMs,
  worktreePath,
}: {
  command: string;
  jobId: string;
  logDir: string;
  runId: string;
  timeoutMs: number;
  worktreePath: string;
}): Promise<DependencyInstallResult> => {
  const runLogDir = resolve(logDir, sanitizePathPart(jobId), sanitizePathPart(runId));
  await mkdir(runLogDir, {
    recursive: true,
  });

  const logPath = join(runLogDir, "install.stdout.log");
  const stderrPath = join(runLogDir, "install.stderr.log");
  const stdoutStream = createWriteStream(logPath, {
    flags: "a",
  });
  const stderrStream = createWriteStream(stderrPath, {
    flags: "a",
  });

  let error: string | null = null;
  let timedOut = false;
  const child = spawn(command, {
    cwd: worktreePath,
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
      error = `Dependency install timed out after ${timeoutMs}ms.`;
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
    command,
    error,
    exitCode,
    logPath,
    ok: exitCode === 0 && !error && !timedOut,
    stderrPath,
    timedOut,
  };
};
