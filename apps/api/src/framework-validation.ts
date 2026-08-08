import type {
  FrameworkDependencyInstallRequest,
  FrameworkDependencyInstallResponse,
  FrameworkOpenFolderRequest,
  FrameworkOpenFolderResponse,
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
const installCommand = "pnpm install && pnpm exec playwright install chromium" as const;
const openFolderCommand = "open" as const;
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

const getInstallFailureMessage = (stdout = "", stderr = "") => {
  const output = `${stdout}\n${stderr}`;

  if (output.includes("ERR_PNPM_IGNORED_BUILDS") || output.includes("pnpm approve-builds")) {
    return "Dependency install needs pnpm build approval. Retry Install to approve pending build scripts and continue.";
  }

  return "Framework dependency installation failed.";
};

const needsBuildApproval = (stdout = "", stderr = "") => {
  const output = `${stdout}\n${stderr}`;

  return output.includes("ERR_PNPM_IGNORED_BUILDS") || output.includes("pnpm approve-builds");
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
    const outputs: Array<{ stderr: string; stdout: string }> = [];

    try {
      outputs.push(
        await runner("pnpm", ["install"], {
          cwd: targetDirectory,
          maxBuffer: processBuffer,
          timeout: 180_000,
        }),
      );
    } catch (error) {
      const commandError = error as CommandError;

      if (!needsBuildApproval(commandError.stdout, commandError.stderr)) {
        throw error;
      }

      outputs.push({
        stderr: commandError.stderr ?? commandError.message,
        stdout: commandError.stdout ?? "",
      });
      outputs.push(
        await runner("pnpm", ["approve-builds", "--all"], {
          cwd: targetDirectory,
          maxBuffer: processBuffer,
          timeout: 60_000,
        }),
      );
      outputs.push(
        await runner("pnpm", ["install"], {
          cwd: targetDirectory,
          maxBuffer: processBuffer,
          timeout: 180_000,
        }),
      );
    }

    outputs.push(
      await runner("pnpm", ["exec", "playwright", "install", "chromium"], {
        cwd: targetDirectory,
        maxBuffer: processBuffer,
        timeout: 180_000,
      }),
    );

    return {
      command: installCommand,
      durationMs: Date.now() - startedAt,
      exitCode: 0,
      message: "Framework dependencies and Chromium browser installed.",
      status: "installed",
      stderr: truncateOutput(outputs.map((output) => output.stderr).filter(Boolean).join("\n")),
      stdout: truncateOutput(outputs.map((output) => output.stdout).filter(Boolean).join("\n")),
      targetDirectory,
    };
  } catch (error) {
    const commandError = error as CommandError;

    return {
      command: installCommand,
      durationMs: Date.now() - startedAt,
      exitCode: getExitCode(error),
      message: getInstallFailureMessage(commandError.stdout, commandError.stderr),
      status: "failed",
      stderr: truncateOutput(commandError.stderr ?? commandError.message),
      stdout: truncateOutput(commandError.stdout ?? ""),
      targetDirectory,
    };
  }
};

export const openFrameworkFolder = async (
  request: FrameworkOpenFolderRequest,
  { canAccess = access, runner = defaultRunner }: FrameworkSmokeValidationOptions = {},
): Promise<FrameworkOpenFolderResponse> => {
  const startedAt = Date.now();
  const targetDirectory = resolve(request.targetDirectory);

  try {
    await canAccess(targetDirectory);
  } catch {
    return {
      command: openFolderCommand,
      durationMs: Date.now() - startedAt,
      message: "Target directory does not exist yet.",
      status: "skipped",
      targetDirectory,
    };
  }

  try {
    await runner("open", [targetDirectory], {
      cwd: targetDirectory,
      maxBuffer: processBuffer,
      timeout: 30_000,
    });

    return {
      command: openFolderCommand,
      durationMs: Date.now() - startedAt,
      message: "Generated framework folder opened.",
      status: "opened",
      targetDirectory,
    };
  } catch (error) {
    return {
      command: openFolderCommand,
      durationMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : "Unable to open generated framework folder.",
      status: "failed",
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
