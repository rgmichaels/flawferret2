import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ValidationResult =
  | {
      ok: true;
      metadata: {
        changedFiles: string[];
        changedFileCount: number;
        command: string | null;
        exitCode: number | null;
        logPath: string | null;
        stderrPath: string | null;
      };
    }
  | {
      ok: false;
      message: string;
      metadata: {
        changedFiles: string[];
        changedFileCount: number;
        command: string | null;
        error?: string;
        exitCode: number | null;
        logPath: string | null;
        stderrPath: string | null;
      };
    };

const sanitizePathPart = (value: string) => value.replace(/[^A-Za-z0-9_.-]/g, "-");

const parseChangedFiles = (status: string) =>
  status
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const renamedPath = line.match(/^R\s+(.+?)\s+->\s+(.+)$/);

      if (renamedPath) {
        return renamedPath[2];
      }

      return line.slice(3).trim();
    })
    .filter(Boolean);

const getChangedFiles = async (localPath: string) => {
  const { stdout } = await execFileAsync("git", ["-C", localPath, "status", "--short"], {
    maxBuffer: 1024 * 1024,
  });

  return parseChangedFiles(stdout);
};

const runValidationCommand = async ({
  command,
  jobId,
  localPath,
  logDir,
  runId,
}: {
  command: string;
  jobId: string;
  localPath: string;
  logDir: string;
  runId: string;
}) => {
  const runLogDir = resolve(logDir, sanitizePathPart(jobId), sanitizePathPart(runId));
  await mkdir(runLogDir, {
    recursive: true,
  });

  const logPath = join(runLogDir, "validation.stdout.log");
  const stderrPath = join(runLogDir, "validation.stderr.log");
  const stdoutStream = createWriteStream(logPath, {
    flags: "a",
  });
  const stderrStream = createWriteStream(stderrPath, {
    flags: "a",
  });

  let error: string | null = null;
  const child = spawn(command, {
    cwd: localPath,
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

  const exitCode = await new Promise<number | null>((resolveExit) => {
    child.on("error", (spawnError) => {
      error = spawnError.message;
      resolveExit(null);
    });
    child.on("close", (code) => {
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
    logPath,
    stderrPath,
  };
};

export const validateGeneratedWork = async ({
  command,
  jobId,
  localPath,
  logDir,
  runId,
}: {
  command?: string;
  jobId: string;
  localPath: string;
  logDir: string;
  runId: string;
}): Promise<ValidationResult> => {
  const changedFiles = await getChangedFiles(localPath);
  const changedFileCount = changedFiles.length;
  const commandToRun = command && command.length > 0 ? command : null;

  if (changedFileCount === 0) {
    return {
      ok: false,
      message: "Validation failed because Codex did not leave any changed files.",
      metadata: {
        changedFileCount,
        changedFiles,
        command: commandToRun,
        exitCode: null,
        logPath: null,
        stderrPath: null,
      },
    };
  }

  if (!commandToRun) {
    return {
      ok: true,
      metadata: {
        changedFileCount,
        changedFiles,
        command: null,
        exitCode: null,
        logPath: null,
        stderrPath: null,
      },
    };
  }

  const commandResult = await runValidationCommand({
    command: commandToRun,
    jobId,
    localPath,
    logDir,
    runId,
  });

  if (commandResult.exitCode !== 0 || commandResult.error) {
    return {
      ok: false,
      message: commandResult.error ?? "Validation command exited unsuccessfully.",
      metadata: {
        changedFileCount,
        changedFiles,
        command: commandToRun,
        error: commandResult.error ?? undefined,
        exitCode: commandResult.exitCode,
        logPath: commandResult.logPath,
        stderrPath: commandResult.stderrPath,
      },
    };
  }

  return {
    ok: true,
    metadata: {
      changedFileCount,
      changedFiles,
      command: commandToRun,
      exitCode: commandResult.exitCode,
      logPath: commandResult.logPath,
      stderrPath: commandResult.stderrPath,
    },
  };
};
