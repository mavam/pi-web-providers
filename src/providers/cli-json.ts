import { spawn } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import { resolveEnvMap } from "../config-values.js";
import type { CustomCommandConfig, ProviderContext } from "../types.js";

export async function runCliJsonCommand<TOutput>({
  command,
  payload,
  context,
  label,
}: {
  command: CustomCommandConfig;
  payload: Record<string, unknown>;
  context: ProviderContext;
  label: string;
}): Promise<TOutput> {
  const argv = normalizeArgv(command);
  const cwd = resolveCommandCwd(command.cwd, context.cwd);
  const env = {
    ...process.env,
    ...(resolveEnvMap(command.env) ?? {}),
  };

  return await new Promise<TOutput>((resolvePromise, rejectPromise) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let abortTimer: ReturnType<typeof setTimeout> | undefined;

    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const rejectOnce = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (abortTimer) {
        clearTimeout(abortTimer);
      }
      context.signal?.removeEventListener("abort", onAbort);
      rejectPromise(error);
    };

    const resolveOnce = (value: TOutput) => {
      if (settled) {
        return;
      }
      settled = true;
      if (abortTimer) {
        clearTimeout(abortTimer);
      }
      context.signal?.removeEventListener("abort", onAbort);
      resolvePromise(value);
    };

    const onAbort = () => {
      child.kill("SIGTERM");
      abortTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, 1000);
    };

    if (context.signal?.aborted) {
      onAbort();
    } else {
      context.signal?.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      rejectOnce(
        new Error(
          `${label} failed to start: ${error.message || String(error)}`,
        ),
      );
    });

    child.on("close", (code, signal) => {
      if (context.signal?.aborted) {
        rejectOnce(new Error(`${label} was aborted.`));
        return;
      }

      if (code !== 0) {
        const detail = stderr.trim() || `exit code ${code ?? "unknown"}`;
        rejectOnce(
          new Error(
            signal
              ? `${label} exited via signal ${signal}: ${detail}`
              : `${label} failed with exit code ${code}: ${detail}`,
          ),
        );
        return;
      }

      const trimmed = stdout.trim();
      if (!trimmed) {
        rejectOnce(new Error(`${label} did not write JSON to stdout.`));
        return;
      }

      try {
        resolveOnce(JSON.parse(trimmed) as TOutput);
      } catch (error) {
        rejectOnce(
          new Error(
            `${label} returned invalid JSON: ${(error as Error).message}`,
          ),
        );
      }
    });

    child.stdin.on("error", () => {
      // Ignore EPIPE and other shutdown races; close/exit handlers report them.
    });
    child.stdin.end(`${JSON.stringify(payload)}\n`);
  });
}

function normalizeArgv(command: CustomCommandConfig): string[] {
  const argv = command.argv?.filter((entry) => entry.trim().length > 0) ?? [];
  if (argv.length === 0) {
    throw new Error("command is missing argv");
  }
  return argv;
}

function resolveCommandCwd(
  commandCwd: string | undefined,
  fallbackCwd: string,
): string {
  if (!commandCwd || commandCwd.trim().length === 0) {
    return fallbackCwd;
  }

  return isAbsolute(commandCwd) ? commandCwd : resolve(fallbackCwd, commandCwd);
}
