import { execFileSync } from "node:child_process";
import type { CredentialSource } from "./web-mux/public-types.js";

const commandValueCache = new Map<
  string,
  { value?: string; errorMessage?: string }
>();

export function resolveConfigValue(
  reference: string | CredentialSource | undefined,
): string | undefined {
  if (!reference) return undefined;
  if (typeof reference === "object") {
    if ("env" in reference) return process.env[reference.env];
    if ("value" in reference) return reference.value;

    const cacheKey = JSON.stringify(reference.command);
    const cached = commandValueCache.get(cacheKey);
    if (cached) {
      if (cached.errorMessage) {
        throw new Error(cached.errorMessage);
      }
      return cached.value;
    }

    try {
      const [program, ...args] = reference.command;
      const output = execFileSync(program, args, {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
      const value = output.length > 0 ? output : undefined;
      commandValueCache.set(cacheKey, { value });
      return value;
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & {
        status?: number;
        signal?: NodeJS.Signals;
      };
      const [program] = reference.command;
      const reason = failure.signal
        ? `signal ${failure.signal}`
        : `exit code ${failure.status ?? "unknown"}`;
      const errorMessage = `Credential command '${program}' failed with ${reason}.`;
      commandValueCache.set(cacheKey, { errorMessage });
      throw new Error(errorMessage, { cause: error });
    }
  }
  const envValue = process.env[reference];
  if (envValue !== undefined) {
    return envValue;
  }
  if (/^[A-Z][A-Z0-9_]*$/.test(reference)) {
    return undefined;
  }
  return reference;
}

export function resolveEnvMap(
  envMap: Record<string, string | CredentialSource> | undefined,
): Record<string, string> | undefined {
  if (!envMap) return undefined;
  const resolved = Object.fromEntries(
    Object.entries(envMap)
      .map(([key, value]) => [key, resolveConfigValue(value)])
      .filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
  );
  return Object.keys(resolved).length > 0 ? resolved : undefined;
}
