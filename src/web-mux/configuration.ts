import { readFile, writeFile, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ProviderConfig } from "../types.js";
import { WebMuxError } from "./errors.js";
import { PROVIDER_CATALOG } from "./catalog.js";
import { loadProvider } from "./provider-loader.js";
import {
  CAPABILITIES,
  PROVIDER_IDS,
  type Capability,
  type CredentialSource,
  type CustomCommand,
  type ExecutionConfig,
  type ProviderConfiguration,
  type ProviderId,
  type WebMuxConfig,
} from "./public-types.js";

export const CONFIG_SCHEMA_URL =
  "https://unpkg.com/web-mux@0.1.0/dist/config.schema.json";

export interface ConfigPathOptions {
  configPath?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
}

export function resolveConfigPath(options: ConfigPathOptions = {}): string {
  const env = options.env ?? process.env;
  if (options.configPath) return resolve(options.configPath);
  if (env.WEB_MUX_CONFIG) return resolve(env.WEB_MUX_CONFIG);

  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    const appData = env.APPDATA;
    if (appData) return join(appData, "web-mux", "config.json");
  }

  const xdg = env.XDG_CONFIG_HOME;
  if (xdg) return join(xdg, "web-mux", "config.json");
  return join(options.home ?? homedir(), ".config", "web-mux", "config.json");
}

export async function loadConfig(
  options: ConfigPathOptions = {},
): Promise<WebMuxConfig> {
  const path = resolveConfigPath(options);
  try {
    return parseConfig(await readFile(path, "utf8"), path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      if (options.configPath || (options.env ?? process.env).WEB_MUX_CONFIG) {
        throw new WebMuxError(
          "INVALID_CONFIG",
          `Configuration file not found: ${path}`,
          { cause: error },
        );
      }
      return {};
    }
    if (error instanceof WebMuxError) throw error;
    throw new WebMuxError(
      "INVALID_CONFIG",
      `Could not read ${path}: ${messageOf(error)}`,
      { cause: error },
    );
  }
}

export function loadConfigSync(options: ConfigPathOptions = {}): WebMuxConfig {
  const path = resolveConfigPath(options);
  try {
    return parseConfig(readFileSync(path, "utf8"), path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      if (options.configPath || (options.env ?? process.env).WEB_MUX_CONFIG) {
        throw new WebMuxError(
          "INVALID_CONFIG",
          `Configuration file not found: ${path}`,
          { cause: error },
        );
      }
      return {};
    }
    if (error instanceof WebMuxError) throw error;
    throw new WebMuxError(
      "INVALID_CONFIG",
      `Could not read ${path}: ${messageOf(error)}`,
      { cause: error },
    );
  }
}

export function parseConfig(
  text: string,
  source = "config.json",
): WebMuxConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new WebMuxError(
      "INVALID_CONFIG",
      `Invalid JSON in ${source}: ${messageOf(error)}`,
      { cause: error },
    );
  }
  return validateConfig(raw, source);
}

export function validateConfig(
  raw: unknown,
  source = "configuration",
): WebMuxConfig {
  const root = object(raw, source);
  exactKeys(root, ["$schema", "defaults", "execution", "providers"], source);
  const result: WebMuxConfig = {};

  if (root.$schema !== undefined)
    result.$schema = string(root.$schema, `${source}.$schema`);
  if (root.execution !== undefined)
    result.execution = execution(root.execution, `${source}.execution`);
  if (root.defaults !== undefined)
    result.defaults = defaults(root.defaults, `${source}.defaults`);
  if (root.providers !== undefined)
    result.providers = providers(root.providers, `${source}.providers`);
  return result;
}

export function createInitialConfig(): WebMuxConfig {
  return {
    $schema: CONFIG_SCHEMA_URL,
    defaults: {},
    execution: {
      timeoutMs: 30_000,
      retries: 0,
      retryDelayMs: 2_000,
      researchTimeoutMs: 1_800_000,
    },
    providers: {},
  };
}

export async function writeConfig(
  config: WebMuxConfig,
  options: ConfigPathOptions & { force?: boolean } = {},
): Promise<string> {
  const path = resolveConfigPath(options);
  if (!options.force) {
    try {
      await readFile(path, "utf8");
      throw new WebMuxError(
        "INVALID_CONFIG",
        `Refusing to replace existing configuration: ${path}`,
      );
    } catch (error) {
      if (error instanceof WebMuxError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return path;
}

export function redactConfig(config: WebMuxConfig): unknown {
  const clone = structuredClone(config) as WebMuxConfig;
  for (const provider of Object.values(clone.providers ?? {})) {
    if (!provider) continue;
    if (provider.credentials) {
      provider.credentials = Object.fromEntries(
        Object.entries(provider.credentials).map(([name, source]) => [
          name,
          redactSource(source),
        ]),
      );
    }
    if (provider.accountId)
      provider.accountId = redactSource(provider.accountId);
    if (provider.env) {
      provider.env = Object.fromEntries(
        Object.entries(provider.env).map(([name, source]) => [
          name,
          redactSource(source),
        ]),
      );
    }
    for (const command of Object.values(provider.commands ?? {})) {
      if (!command?.env) continue;
      command.env = Object.fromEntries(
        Object.entries(command.env).map(([name, source]) => [
          name,
          redactSource(source),
        ]),
      );
    }
  }
  return clone;
}

function redactSource(source: CredentialSource): CredentialSource {
  if ("env" in source) return source;
  if ("command" in source) return { command: ["<redacted>"] };
  return { value: "<redacted>" };
}

export async function buildRuntimeProviderConfig(
  config: WebMuxConfig,
  id: ProviderId,
): Promise<ProviderConfig> {
  const definition = await loadProvider(id);
  const base = structuredClone(definition.config.createTemplate()) as Record<
    string,
    unknown
  >;
  const configured = config.providers?.[id];
  if (configured) {
    for (const key of [
      "credentials",
      "baseUrl",
      "accountId",
      "codexPath",
      "pathToClaudeCodeExecutable",
      "env",
      "config",
    ] as const) {
      if (configured[key] !== undefined)
        base[key] = structuredClone(configured[key]);
    }
    if (id === "custom" && configured.commands) {
      base.options = structuredClone(configured.commands);
    }
  }

  const execution = config.execution;
  if (execution) {
    base.settings = {
      ...(execution.timeoutMs === undefined
        ? {}
        : { requestTimeoutMs: execution.timeoutMs }),
      ...(execution.retries === undefined
        ? {}
        : { retryCount: execution.retries }),
      ...(execution.retryDelayMs === undefined
        ? {}
        : { retryDelayMs: execution.retryDelayMs }),
      ...(execution.researchTimeoutMs === undefined
        ? {}
        : { researchTimeoutMs: execution.researchTimeoutMs }),
    };
  }
  return base as ProviderConfig;
}

export function configuredOptions(
  config: WebMuxConfig,
  provider: ProviderId,
  capability: Capability,
): Record<string, unknown> {
  return mergeOptionObjects(
    config.defaults?.[capability]?.options,
    config.providers?.[provider]?.options?.[capability],
  );
}

function execution(value: unknown, path: string): ExecutionConfig {
  const input = object(value, path);
  exactKeys(
    input,
    ["timeoutMs", "retries", "retryDelayMs", "researchTimeoutMs"],
    path,
  );
  return {
    ...(input.timeoutMs === undefined
      ? {}
      : { timeoutMs: positiveInteger(input.timeoutMs, `${path}.timeoutMs`) }),
    ...(input.retries === undefined
      ? {}
      : { retries: nonNegativeInteger(input.retries, `${path}.retries`) }),
    ...(input.retryDelayMs === undefined
      ? {}
      : {
          retryDelayMs: nonNegativeInteger(
            input.retryDelayMs,
            `${path}.retryDelayMs`,
          ),
        }),
    ...(input.researchTimeoutMs === undefined
      ? {}
      : {
          researchTimeoutMs: positiveInteger(
            input.researchTimeoutMs,
            `${path}.researchTimeoutMs`,
          ),
        }),
  };
}

function defaults(value: unknown, path: string): WebMuxConfig["defaults"] {
  const input = object(value, path);
  exactKeys(input, [...CAPABILITIES], path);
  return Object.fromEntries(
    CAPABILITIES.flatMap((capability) => {
      const raw = input[capability];
      if (raw === undefined) return [];
      const entry = object(raw, `${path}.${capability}`);
      exactKeys(
        entry,
        capability === "search"
          ? ["provider", "options", "maxResults"]
          : ["provider", "options"],
        `${path}.${capability}`,
      );
      const parsed = {
        ...(entry.provider === undefined
          ? {}
          : {
              provider: providerId(
                entry.provider,
                `${path}.${capability}.provider`,
              ),
            }),
        ...(entry.options === undefined
          ? {}
          : {
              options: object(entry.options, `${path}.${capability}.options`),
            }),
        ...(entry.maxResults === undefined
          ? {}
          : {
              maxResults: positiveInteger(
                entry.maxResults,
                `${path}.${capability}.maxResults`,
              ),
            }),
      };
      return [[capability, parsed]];
    }),
  ) as WebMuxConfig["defaults"];
}

function providers(value: unknown, path: string): WebMuxConfig["providers"] {
  const input = object(value, path);
  exactKeys(input, [...PROVIDER_IDS], path);
  return Object.fromEntries(
    PROVIDER_IDS.flatMap((id) => {
      const raw = input[id];
      return raw === undefined
        ? []
        : [[id, providerConfig(raw, id, `${path}.${id}`)]];
    }),
  ) as WebMuxConfig["providers"];
}

function providerConfig(
  value: unknown,
  id: ProviderId,
  path: string,
): ProviderConfiguration {
  const input = object(value, path);
  const standard = ["credentials", "baseUrl", "options"];
  const fields: Partial<Record<ProviderId, string[]>> = {
    claude: ["pathToClaudeCodeExecutable", "options"],
    cloudflare: ["credentials", "accountId", "options"],
    codex: ["credentials", "baseUrl", "options", "codexPath", "env", "config"],
    custom: ["commands", "options"],
    gemini: ["credentials", "options"],
  };
  exactKeys(input, fields[id] ?? standard, path);
  const result: ProviderConfiguration = {};
  if (input.credentials !== undefined)
    result.credentials = sourceRecord(input.credentials, `${path}.credentials`);
  if (input.baseUrl !== undefined)
    result.baseUrl = string(input.baseUrl, `${path}.baseUrl`);
  if (input.accountId !== undefined)
    result.accountId = credentialSource(input.accountId, `${path}.accountId`);
  if (input.codexPath !== undefined)
    result.codexPath = string(input.codexPath, `${path}.codexPath`);
  if (input.pathToClaudeCodeExecutable !== undefined)
    result.pathToClaudeCodeExecutable = string(
      input.pathToClaudeCodeExecutable,
      `${path}.pathToClaudeCodeExecutable`,
    );
  if (input.env !== undefined)
    result.env = sourceRecord(input.env, `${path}.env`);
  if (input.config !== undefined)
    result.config = object(input.config, `${path}.config`);
  if (input.options !== undefined)
    result.options = capabilityOptions(input.options, `${path}.options`);
  if (input.commands !== undefined) {
    if (id !== "custom")
      fail(`${path}.commands is only supported by the custom provider`);
    result.commands = commands(input.commands, `${path}.commands`);
  }
  return result;
}

function capabilityOptions(
  value: unknown,
  path: string,
): ProviderConfiguration["options"] {
  const input = object(value, path);
  exactKeys(input, [...CAPABILITIES], path);
  return Object.fromEntries(
    CAPABILITIES.flatMap((capability) =>
      input[capability] === undefined
        ? []
        : [[capability, object(input[capability], `${path}.${capability}`)]],
    ),
  );
}

function commands(
  value: unknown,
  path: string,
): ProviderConfiguration["commands"] {
  const input = object(value, path);
  exactKeys(input, [...CAPABILITIES], path);
  return Object.fromEntries(
    CAPABILITIES.flatMap((capability) => {
      if (input[capability] === undefined) return [];
      const raw = object(input[capability], `${path}.${capability}`);
      exactKeys(raw, ["argv", "cwd", "env"], `${path}.${capability}`);
      if (
        !Array.isArray(raw.argv) ||
        raw.argv.length === 0 ||
        raw.argv.some((part) => typeof part !== "string" || part.length === 0)
      ) {
        fail(
          `${path}.${capability}.argv must be a non-empty array of non-empty strings`,
        );
      }
      const command: CustomCommand = {
        argv: raw.argv as [string, ...string[]],
      };
      if (raw.cwd !== undefined)
        command.cwd = string(raw.cwd, `${path}.${capability}.cwd`);
      if (raw.env !== undefined)
        command.env = sourceRecord(raw.env, `${path}.${capability}.env`);
      return [[capability, command]];
    }),
  );
}

function sourceRecord(
  value: unknown,
  path: string,
): Record<string, CredentialSource> {
  const input = object(value, path);
  return Object.fromEntries(
    Object.entries(input).map(([key, source]) => [
      key,
      credentialSource(source, `${path}.${key}`),
    ]),
  );
}

function credentialSource(value: unknown, path: string): CredentialSource {
  const input = object(value, path);
  exactKeys(input, ["env", "command", "value"], path);
  const keys = ["env", "command", "value"].filter(
    (key) => input[key] !== undefined,
  );
  if (keys.length !== 1)
    fail(`${path} must contain exactly one of 'env', 'command', or 'value'`);
  if (input.env !== undefined) return { env: string(input.env, `${path}.env`) };
  if (input.value !== undefined)
    return { value: string(input.value, `${path}.value`) };
  if (
    !Array.isArray(input.command) ||
    input.command.length === 0 ||
    input.command.some((part) => typeof part !== "string" || part.length === 0)
  ) {
    fail(`${path}.command must be a non-empty array of non-empty strings`);
  }
  return { command: input.command as [string, ...string[]] };
}

function providerId(value: unknown, path: string): ProviderId {
  const id = string(value, path);
  if (!PROVIDER_IDS.includes(id as ProviderId))
    fail(`${path} must be one of: ${PROVIDER_IDS.join(", ")}`);
  return id as ProviderId;
}

function object(value: unknown, path: string): Record<string, any> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail(`${path} must be a JSON object`);
  return value as Record<string, any>;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0)
    fail(`${path} must be a non-empty string`);
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  const parsed = nonNegativeInteger(value, path);
  if (parsed === 0) fail(`${path} must be greater than zero`);
  return parsed;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
    fail(`${path} must be a non-negative integer`);
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0)
    fail(
      `Unknown ${unknown.length === 1 ? "field" : "fields"} in ${path}: ${unknown.join(", ")}`,
    );
}

function mergeOptionObjects(
  ...values: Array<Record<string, unknown> | undefined>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const value of values) {
    for (const [key, entry] of Object.entries(value ?? {})) {
      result[key] =
        isPlainObject(result[key]) && isPlainObject(entry)
          ? mergeOptionObjects(result[key], entry)
          : structuredClone(entry);
    }
  }
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new WebMuxError("INVALID_CONFIG", message);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function compatibleProviderIds(capability: Capability): ProviderId[] {
  return PROVIDER_CATALOG.filter((provider) =>
    provider.capabilities.includes(capability),
  ).map((provider) => provider.id);
}
