import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { CustomCommandConfig } from "./custom/types.js";
import type { ProviderContext } from "./contract.js";
import { WebfoxError } from "../errors.js";
import { cancelProcessGroup, killProcessGroup } from "../runtime/process.js";

/** Subprocess mechanics only; lifecycle and outward redaction belong to runtime. */
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
  context.signal?.throwIfAborted();
  if (!command.argv.length)
    throw new WebfoxError("INVALID_CONFIG", `${label} requires argv.`);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command.argv[0], command.argv.slice(1), {
      detached: process.platform !== "win32",
      cwd: resolve(context.cwd, command.cwd ?? "."),
      env: { ...context.env, ...command.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let progress = "";
    const abort = () => {
      cancelProcessGroup(child);
      reject(context.signal?.reason);
    };
    context.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > 16 * 1024 * 1024) {
        killProcessGroup(child, "SIGKILL");
        reject(
          new WebfoxError(
            "PROVIDER_FAILURE",
            `${label} output exceeded 16 MiB.`,
          ),
        );
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-64 * 1024);
      progress += chunk;
      // Buffer complete lines so split credential bytes never bypass redaction.
      const lines = progress.split(/\r?\n/);
      progress = lines.pop()!;
      for (const line of lines)
        if (line.trim()) context.onProgress?.(line.trim());
      if (progress.length > 64 * 1024) {
        progress = "";
        killProcessGroup(child, "SIGKILL");
        reject(
          new WebfoxError(
            "PROVIDER_FAILURE",
            `${label} progress line exceeded 64 KiB.`,
          ),
        );
      }
    });
    child.on("error", () =>
      reject(
        new WebfoxError(
          "PROVIDER_FAILURE",
          `${label} could not start. Check the command executable and working directory.`,
        ),
      ),
    );
    child.on("close", (code) => {
      context.signal?.removeEventListener("abort", abort);
      if (context.signal?.aborted) {
        reject(context.signal.reason);
        return;
      }
      if (progress.trim()) context.onProgress?.(progress.trim());
      if (code !== 0) {
        reject(
          new WebfoxError(
            "PROVIDER_FAILURE",
            `${label} failed (exit ${code}): ${stderr.trim()}`,
            { retryable: false },
          ),
        );
        return;
      }
      try {
        resolvePromise(JSON.parse(stdout) as TOutput);
      } catch {
        reject(
          new WebfoxError(
            "PROVIDER_FAILURE",
            `${label} must write one valid JSON object to stdout.`,
          ),
        );
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(`${JSON.stringify(payload)}\n`);
  });
}
