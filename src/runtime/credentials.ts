import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { Capability, ProviderId } from "../domain.js";
import type {
  CredentialSource,
  ProviderConfiguration,
} from "../configuration/types.js";
import type { ProviderDefinition } from "../providers/definition.js";
import type { ProviderConfigMap } from "../providers/contract.js";
import { WebMuxError } from "../errors.js";
import { OutwardBoundary } from "./outward.js";
import { cancelProcessGroup, killProcessGroup } from "./process.js";

/** Client-scoped environment and cache. Inspection never uses this resolver. */
export class CredentialResolver {
  private readonly cache = new Map<string, string>();
  constructor(
    private readonly cwd: string,
    private readonly env: Record<string, string | undefined>,
  ) {}

  async prepare(
    definition: ProviderDefinition,
    stored: ProviderConfiguration | undefined,
    capability: Capability,
    signal: AbortSignal,
    outward: OutwardBoundary,
  ): Promise<ProviderConfigMap[ProviderId]> {
    const {
      credentials: sources,
      env: envSources,
      commands,
      options: _options,
      accountId,
      ...settings
    } = stored ?? {};
    const credentials: Record<string, string> = {};
    for (const requirement of definition.credentials) {
      if (
        requirement.capabilities &&
        !requirement.capabilities.includes(capability)
      )
        continue;
      const source = sources?.[requirement.name] ?? {
        env: requirement.environmentVariable,
      };
      const value = await this.resolve(source, signal, outward);
      if (!value && !requirement.optional) {
        throw new WebMuxError(
          "PROVIDER_UNAVAILABLE",
          `${definition.label} ${capability} needs a credential. Set ${"env" in source ? source.env : `providers.${definition.id}.credentials.${requirement.name}`} and try again.`,
        );
      }
      if (value) credentials[requirement.name] = value;
    }
    const extra: Record<string, string> = {};
    for (const [key, fallback] of Object.entries(
      definition.credentialDefaults,
    )) {
      const value = await this.resolve(
        key === "accountId" ? (accountId ?? fallback) : fallback,
        signal,
        outward,
      );
      if (!value)
        throw new WebMuxError(
          "PROVIDER_UNAVAILABLE",
          `${definition.label} requires ${key}. Set ${"env" in fallback ? fallback.env : key} and try again.`,
        );
      extra[key] = value;
    }
    const env = await this.resolveMap(envSources, signal, outward);
    const command = commands?.[capability];
    if (definition.fields.includes("commands") && !command)
      throw new WebMuxError(
        "PROVIDER_UNAVAILABLE",
        `Configure providers.${definition.id}.commands.${capability}.argv before executing ${capability}.`,
      );
    const resolvedCommands = command
      ? {
          [capability]: {
            ...command,
            cwd: resolve(this.cwd, command.cwd ?? "."),
            env: await this.resolveMap(command.env, signal, outward),
          },
        }
      : undefined;
    // Only resolved strings cross into adapters. Provider option defaults are
    // planned separately; adapters never see stored configuration or sources.
    return {
      ...settings,
      ...extra,
      credentials,
      env,
      ...(resolvedCommands ? { commands: resolvedCommands } : {}),
    } as ProviderConfigMap[ProviderId];
  }

  private async resolveMap(
    sources: Record<string, CredentialSource> | undefined,
    signal: AbortSignal,
    outward: OutwardBoundary,
  ): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const [key, source] of Object.entries(sources ?? {})) {
      const value = await this.resolve(source, signal, outward);
      if (value !== undefined) result[key] = value;
    }
    return result;
  }

  private async resolve(
    source: CredentialSource,
    signal: AbortSignal,
    outward: OutwardBoundary,
  ): Promise<string | undefined> {
    signal.throwIfAborted();
    let value: string | undefined;
    if ("value" in source) value = source.value;
    else if ("env" in source) value = this.env[source.env];
    else {
      const key = JSON.stringify(source.command);
      value = this.cache.get(key);
      if (value === undefined) {
        value = await credentialCommand(
          source.command,
          this.cwd,
          this.env,
          signal,
        );
        this.cache.set(key, value);
      }
    }
    if (value) outward.addSecret(value);
    return value;
  }
}

function credentialCommand(
  argv: string[],
  cwd: string,
  env: Record<string, string | undefined>,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolvePromise, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    const abort = () => {
      cancelProcessGroup(child);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      if (Buffer.byteLength(output) > 64 * 1024) {
        killProcessGroup(child, "SIGKILL");
        reject(
          new WebMuxError(
            "INVALID_CONFIG",
            "Credential command output exceeded 64 KiB. Return only the credential.",
          ),
        );
      }
    });
    child.on("error", () =>
      reject(
        new WebMuxError(
          "INVALID_CONFIG",
          "Could not start credential command. Check its executable and working directory.",
        ),
      ),
    );
    child.on("close", (code) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(signal.reason);
      else if (code !== 0)
        reject(
          new WebMuxError(
            "INVALID_CONFIG",
            `Credential command failed (exit ${code}). Check the command outside web-mux.`,
          ),
        );
      else resolvePromise(output.trim());
    });
  });
}
