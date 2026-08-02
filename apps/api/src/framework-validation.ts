import type {
  FrameworkDependencyInstallRequest,
  FrameworkDependencyInstallResponse,
  FrameworkSmokeValidationRequest,
  FrameworkSmokeValidationResponse,
} from "@flawferret2/job-schemas";
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const outputLimit = 20_000;
const processBuffer = 1_000_000;
const installCommand = "pnpm install" as const;
const smokeCommand = "pnpm test:smoke" as const;

type CommandError = Error & {
  code?: number | string;
  stderr?: string;
  stdout?: string;
};

type CommandRunner = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    maxBuffer: number;
    timeout: number;
  },
) => Promise<{
  stderr: string;
  stdout: string;
}>;

type FrameworkSmokeValidationOptions = {
  canAccess?: (path: string) => Promise<void>;
  runner?: CommandRunner;
};

const truncateOutput = (value: string) => (value.length > outputLimit ? `${value.slice(0, outputLimit)}\n... truncated ...` : value);

const defaultRunner: CommandRunner = async (command, args, options) => {
  const { stderr, stdout } = await execFileAsync(command, args, options);

  return {
    stderr,
    stdout,
  };
};

const getExitCode = (error: unknown) => {
  const code = (error as CommandError).code;

  return typeof code === "number" ? code : 1;
};

export const installFrameworkDependencies = async (
  request: FrameworkDependencyInstallRequest,
  { canAccess = access, runner = defaultRunner }: FrameworkSmokeValidationOptions = {},
): Promise<FrameworkDependencyInstallResponse> => {
  const startedAt = Date.now();
  const targetDirectory = resolve(request.targetDirectory);

  try {
    await canAccess(join(targetDirectory, "package.json"));
  } catch {
    return {
      command: installCommand,
      durationMs: Date.now() - startedAt,
      exitCode: null,
      message: "No package.json was found in the target directory.",
      status: "skipped",
      stderr: "",
      stdout: "",
      targetDirectory,
    };
  }

  try {
    const result = await runner("pnpm", ["install"], {
      cwd: targetDirectory,
      maxBuffer: processBuffer,
      timeout: 180_000,
    });

    return {
      command: installCommand,
      durationMs: Date.now() - startedAt,
      exitCode: 0,
      message: "Framework dependencies installed.",
      status: "installed",
      stderr: truncateOutput(result.stderr),
      stdout: truncateOutput(result.stdout),
      targetDirectory,
    };
  } catch (error) {
    const commandError = error as CommandError;

    return {
      command: installCommand,
      durationMs: Date.now() - startedAt,
      exitCode: getExitCode(error),
      message: "Framework dependency installation failed.",
      status: "failed",
      stderr: truncateOutput(commandError.stderr ?? commandError.message),
      stdout: truncateOutput(commandError.stdout ?? ""),
      targetDirectory,
    };
  }
};

export const validateFrameworkSmokeTest = async (
  request: FrameworkSmokeValidationRequest,
  { canAccess = access, runner = defaultRunner }: FrameworkSmokeValidationOptions = {},
): Promise<FrameworkSmokeValidationResponse> => {
  const startedAt = Date.now();
  const targetDirectory = resolve(request.targetDirectory);

  try {
    await canAccess(join(targetDirectory, "node_modules"));
  } catch {
    return {
      command: smokeCommand,
      durationMs: Date.now() - startedAt,
      exitCode: null,
      message: "Dependencies are not installed yet. Run pnpm install before smoke validation.",
      status: "skipped",
      stderr: "",
      stdout: "",
      targetDirectory,
    };
  }

  try {
    const result = await runner("pnpm", ["test:smoke"], {
      cwd: targetDirectory,
      maxBuffer: processBuffer,
      timeout: 120_000,
    });

    return {
      command: smokeCommand,
      durationMs: Date.now() - startedAt,
      exitCode: 0,
      message: "Generated smoke test passed.",
      status: "passed",
      stderr: truncateOutput(result.stderr),
      stdout: truncateOutput(result.stdout),
      targetDirectory,
    };
  } catch (error) {
    const commandError = error as CommandError;

    return {
      command: smokeCommand,
      durationMs: Date.now() - startedAt,
      exitCode: getExitCode(error),
      message: "Generated smoke test failed.",
      status: "failed",
      stderr: truncateOutput(commandError.stderr ?? commandError.message),
      stdout: truncateOutput(commandError.stdout ?? ""),
      targetDirectory,
    };
  }
};
