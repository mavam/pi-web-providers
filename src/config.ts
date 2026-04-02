import { execSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import { supportsTool } from "./provider-tools.js";
import type {
  Claude,
  Cloudflare,
  Codex,
  Custom,
  CustomCommandConfig,
  Exa,
  Firecrawl,
  Gemini,
  Linkup,
  Parallel,
  Perplexity,
  ProviderId,
  SearchSettings,
  Settings,
  Tavily,
  Tool,
  Tools,
  Valyu,
  WebProviders,
} from "./types.js";
import { PROVIDER_IDS, TOOLS } from "./types.js";

const CONFIG_FILE_NAME = "web-providers.json";
const commandValueCache = new Map<
  string,
  { value?: string; errorMessage?: string }
>();

export function getConfigPath(): string {
  return join(getAgentDir(), CONFIG_FILE_NAME);
}

export function createDefaultConfig(): WebProviders {
  return {
    tools: {
      search: "codex",
    },
  };
}

export async function loadConfig(): Promise<WebProviders> {
  return readConfigFile(getConfigPath());
}

export async function readConfigFile(path: string): Promise<WebProviders> {
  try {
    const content = await readFile(path, "utf-8");
    return parseConfig(content, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export async function writeConfigFile(config: WebProviders): Promise<string> {
  const path = getConfigPath();
  await mkdir(dirname(path), { recursive: true });
  const cleaned = structuredClone(config);
  cleanupConfig(cleaned);
  await writeFile(path, serializeConfig(cleaned), "utf-8");
  return path;
}

export function parseConfig(
  text: string,
  source = CONFIG_FILE_NAME,
): WebProviders {
  return normalizeConfig(parseJson(text, source), source);
}

export function parseProviderConfig(
  providerId: ProviderId,
  text: string,
  source = CONFIG_FILE_NAME,
):
  | Claude
  | Codex
  | Cloudflare
  | Custom
  | Exa
  | Firecrawl
  | Gemini
  | Linkup
  | Perplexity
  | Parallel
  | Tavily
  | Valyu {
  const raw = parseJson(text, source);
  if (!isPlainObject(raw)) {
    throw new Error(`Provider config in ${source} must be a JSON object.`);
  }

  const wrapper = normalizeConfig(
    {
      providers: {
        [providerId]: raw,
      },
    },
    source,
  );

  const parsed = wrapper.providers?.[providerId];
  if (!parsed) {
    throw new Error(`Failed to parse provider '${providerId}' in ${source}.`);
  }
  return parsed;
}

export function serializeConfig(config: WebProviders): string {
  return `${JSON.stringify(toPublicConfig(config), null, 2)}\n`;
}

export function resolveConfigValue(
  reference: string | undefined,
): string | undefined {
  if (!reference) return undefined;
  if (reference.startsWith("!")) {
    const cached = commandValueCache.get(reference);
    if (cached) {
      if (cached.errorMessage) {
        throw new Error(cached.errorMessage);
      }
      return cached.value;
    }

    try {
      const output = execSync(reference.slice(1), {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
      const value = output.length > 0 ? output : undefined;
      commandValueCache.set(reference, { value });
      return value;
    } catch (error) {
      const errorMessage = (error as Error).message;
      commandValueCache.set(reference, { errorMessage });
      throw error;
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
  envMap: Record<string, string> | undefined,
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

function parseJson(text: string, source: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON in ${source}: ${(error as Error).message}`);
  }
}

function normalizeConfig(raw: unknown, source: string): WebProviders {
  const configObject = requireObject(
    raw,
    `Config in ${source} must be a JSON object.`,
  );
  const config: WebProviders = {};

  if (configObject.tools !== undefined) {
    config.tools = parseToolProviderMapping(
      configObject.tools,
      source,
      "tools",
    );
  }

  if (configObject.settings !== undefined) {
    config.settings = parseSettingsConfig(configObject.settings, source);
  }

  if (configObject.providers !== undefined) {
    const providers = requireObject(
      configObject.providers,
      `'providers' in ${source} must be a JSON object.`,
    );
    const unknownProviders = Object.keys(providers).filter(
      (key) => !PROVIDER_IDS.includes(key as ProviderId),
    );
    if (unknownProviders.length > 0) {
      throw new Error(
        `Unknown providers in ${source}: ${unknownProviders.join(", ")}.`,
      );
    }

    config.providers = Object.fromEntries(
      PROVIDER_IDS.flatMap((providerId) => {
        const value = providers[providerId];
        return value === undefined
          ? []
          : [[providerId, normalizeProvider(providerId, value, source)]];
      }),
    );
  }

  cleanupConfig(config);
  return config;
}

function normalizeProvider(
  providerId: ProviderId,
  raw: unknown,
  source: string,
):
  | Claude
  | Cloudflare
  | Codex
  | Custom
  | Exa
  | Firecrawl
  | Gemini
  | Linkup
  | Parallel
  | Perplexity
  | Tavily
  | Valyu {
  switch (providerId) {
    case "claude":
      return parseProviderWithShape<Claude>(raw, source, providerId, {
        pathToClaudeCodeExecutable: readOptionalString,
        options: readOptionalObject,
        settings: parseOptionalExecutionSettings,
      });
    case "cloudflare":
      return parseProviderWithShape<Cloudflare>(raw, source, providerId, {
        apiToken: readOptionalString,
        accountId: readOptionalString,
        options: readOptionalObject,
        settings: parseOptionalExecutionSettings,
      });
    case "codex":
      return parseProviderWithShape<Codex>(raw, source, providerId, {
        codexPath: readOptionalString,
        baseUrl: readOptionalString,
        apiKey: readOptionalString,
        env: readOptionalStringMap,
        config: readOptionalObject,
        options: readOptionalObject,
        settings: parseOptionalExecutionSettings,
      });
    case "exa":
    case "valyu":
      return parseProviderWithShape<Exa | Valyu>(raw, source, providerId, {
        apiKey: readOptionalString,
        baseUrl: readOptionalString,
        options: readOptionalObject,
        settings: parseOptionalExecutionSettings,
      });
    case "gemini":
      return parseProviderWithShape<Gemini>(raw, source, providerId, {
        apiKey: readOptionalString,
        options: readOptionalObject,
        settings: parseOptionalExecutionSettings,
      });
    case "firecrawl":
    case "linkup":
    case "parallel":
    case "perplexity":
    case "tavily":
      return parseProviderWithShape<
        Firecrawl | Linkup | Parallel | Perplexity | Tavily
      >(raw, source, providerId, {
        apiKey: readOptionalString,
        baseUrl: readOptionalString,
        options: readOptionalObject,
        settings: parseOptionalExecutionSettings,
      });
    case "custom":
      return parseProviderWithShape<Custom>(raw, source, providerId, {
        options: parseOptionalCustomProviderOptions,
        settings: parseOptionalExecutionSettings,
      });
  }
}

function parseProviderWithShape<T>(
  raw: unknown,
  source: string,
  providerId: ProviderId,
  shape: Record<
    string,
    (value: unknown, source: string, field: string) => unknown
  >,
): T {
  const provider = parseProviderObject(raw, source, providerId);
  const allowedKeys = Object.keys(shape);
  const unknownKeys = Object.keys(provider).filter(
    (key) => !allowedKeys.includes(key),
  );
  if (unknownKeys.length > 0) {
    throw new Error(
      `'providers.${providerId}' in ${source} must be a valid provider config.`,
    );
  }

  return Object.fromEntries(
    Object.entries(shape).map(([key, parser]) => [
      key,
      parser(provider[key], source, `providers.${providerId}.${key}`),
    ]),
  ) as T;
}

function parseProviderObject(
  raw: unknown,
  source: string,
  providerId: ProviderId,
): Record<string, unknown> {
  const provider = requireObject(
    raw,
    `'providers.${providerId}' in ${source} must be a JSON object.`,
  );
  if (provider.tools !== undefined) {
    throw new Error(
      `'providers.${providerId}.tools' in ${source} is no longer supported. Use top-level 'tools' mappings instead.`,
    );
  }
  if (provider.enabled !== undefined) {
    throw new Error(
      `'providers.${providerId}.enabled' in ${source} is no longer supported. Providers are always on; use top-level 'tools' mappings to route or disable capabilities.`,
    );
  }
  return provider;
}

function parseSettingsConfig(value: unknown, source: string): Settings {
  return parseExecutionSettings(value, source, "settings", true);
}

function parseOptionalExecutionSettings(
  value: unknown,
  source: string,
  field: string,
): Settings | undefined {
  return value === undefined
    ? undefined
    : parseExecutionSettings(value, source, field, false);
}

function parseExecutionSettings(
  value: unknown,
  source: string,
  field: string,
  allowSearch: boolean,
): Settings {
  const settings = requireObject(
    value,
    `'${field}' in ${source} must be a JSON object.`,
  );
  const unknownKeys = Object.keys(settings).filter(
    (key) =>
      key !== "requestTimeoutMs" &&
      key !== "retryCount" &&
      key !== "retryDelayMs" &&
      key !== "researchTimeoutMs" &&
      (!allowSearch || key !== "search"),
  );
  if (unknownKeys.length > 0) {
    throw new Error(`'${field}' in ${source} must be a JSON object.`);
  }

  const parsed: Settings = {
    requestTimeoutMs: parseOptionalPositiveInteger(
      settings.requestTimeoutMs,
      source,
      `${field}.requestTimeoutMs`,
    ),
    retryCount: parseOptionalNonNegativeInteger(
      settings.retryCount,
      source,
      `${field}.retryCount`,
    ),
    retryDelayMs: parseOptionalPositiveInteger(
      settings.retryDelayMs,
      source,
      `${field}.retryDelayMs`,
    ),
    researchTimeoutMs: parseOptionalPositiveInteger(
      settings.researchTimeoutMs,
      source,
      `${field}.researchTimeoutMs`,
    ),
    ...(allowSearch && settings.search !== undefined
      ? {
          search: parseSearchSettings(
            settings.search,
            source,
            `${field}.search`,
          ),
        }
      : {}),
  };

  return Object.values(parsed).some((entry) => entry !== undefined)
    ? parsed
    : {};
}

function parseToolProviderMapping(
  value: unknown,
  source: string,
  field: string,
): Tools {
  const mapping = requireObject(
    value,
    `'${field}' in ${source} must be a JSON object.`,
  );
  const parsed: Tools = {};

  for (const [key, entry] of Object.entries(mapping)) {
    if (!TOOLS.includes(key as Tool)) {
      throw new Error(`Unknown tools in ${source}: ${key}.`);
    }
    parsed[key as Tool] = parseToolProviderMappingEntry(
      key as Tool,
      entry,
      source,
      `${field}.${key}`,
    );
  }

  return parsed;
}

function parseToolProviderMappingEntry(
  tool: Tool,
  value: unknown,
  source: string,
  field: string,
): ProviderId {
  const providerId = parseLiteral(value, source, field, PROVIDER_IDS);
  if (!supportsTool(providerId, tool)) {
    throw new Error(
      `'${field}' in ${source} must name a provider that supports '${tool}'.`,
    );
  }
  return providerId;
}

function parseSearchSettings(
  value: unknown,
  source: string,
  field: string,
): SearchSettings {
  const settings = requireObject(
    value,
    `'${field}' in ${source} must be a JSON object.`,
  );
  const unknownFields = Object.keys(settings).filter(
    (key) => key !== "provider" && key !== "maxUrls" && key !== "ttlMs",
  );
  if (unknownFields.length > 0) {
    throw new Error(
      `Unknown search settings in ${source}: ${unknownFields.join(", ")}.`,
    );
  }

  const provider = parseOptionalLiteral(
    settings.provider,
    source,
    `${field}.provider`,
    PROVIDER_IDS,
  );
  if (provider !== undefined && !supportsTool(provider, "contents")) {
    throw new Error(
      `'${field}.provider' in ${source} must name a provider that supports 'contents'.`,
    );
  }

  return {
    provider,
    maxUrls: parseOptionalPositiveInteger(
      settings.maxUrls,
      source,
      `${field}.maxUrls`,
    ),
    ttlMs: parseOptionalPositiveInteger(
      settings.ttlMs,
      source,
      `${field}.ttlMs`,
    ),
  };
}

function parseOptionalCustomProviderOptions(
  value: unknown,
  source: string,
  field: string,
): Custom["options"] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const options = requireObject(
    value,
    `'${field}' in ${source} must be a JSON object.`,
  );
  const unknownKeys = Object.keys(options).filter(
    (key) =>
      key !== "search" &&
      key !== "contents" &&
      key !== "answer" &&
      key !== "research",
  );
  if (unknownKeys.length > 0) {
    throw new Error(`'${field}' in ${source} must be a valid provider config.`);
  }

  return {
    search: parseOptionalCustomCommandConfig(
      options.search,
      source,
      `${field}.search`,
    ),
    contents: parseOptionalCustomCommandConfig(
      options.contents,
      source,
      `${field}.contents`,
    ),
    answer: parseOptionalCustomCommandConfig(
      options.answer,
      source,
      `${field}.answer`,
    ),
    research: parseOptionalCustomCommandConfig(
      options.research,
      source,
      `${field}.research`,
    ),
  };
}

function parseOptionalCustomCommandConfig(
  value: unknown,
  source: string,
  field: string,
): CustomCommandConfig | undefined {
  if (value === undefined) {
    return undefined;
  }
  const command = requireObject(
    value,
    `'${field}' in ${source} must be a JSON object.`,
  );
  const unknownKeys = Object.keys(command).filter(
    (key) => key !== "argv" && key !== "cwd" && key !== "env",
  );
  if (unknownKeys.length > 0) {
    throw new Error(`'${field}' in ${source} must be a valid provider config.`);
  }

  return {
    argv: readOptionalNonEmptyStringArray(
      command.argv,
      source,
      `${field}.argv`,
    ),
    cwd: readOptionalString(command.cwd, source, `${field}.cwd`),
    env: readOptionalStringMap(command.env, source, `${field}.env`),
  };
}

function toPublicConfig(config: WebProviders): Record<string, unknown> {
  const providers = config.providers
    ? Object.fromEntries(
        Object.entries(config.providers).flatMap(([providerId, provider]) =>
          provider ? [[providerId, toPublicProviderConfig(provider)]] : [],
        ),
      )
    : undefined;

  return {
    ...(config.tools ? { tools: config.tools } : {}),
    ...(config.settings ? { settings: config.settings } : {}),
    ...(providers && Object.keys(providers).length > 0 ? { providers } : {}),
  };
}

function toPublicProviderConfig(
  provider:
    | Claude
    | Cloudflare
    | Codex
    | Custom
    | Exa
    | Firecrawl
    | Gemini
    | Linkup
    | Parallel
    | Perplexity
    | Tavily
    | Valyu,
): Record<string, unknown> {
  return {
    ...("pathToClaudeCodeExecutable" in provider &&
    provider.pathToClaudeCodeExecutable !== undefined
      ? {
          pathToClaudeCodeExecutable: provider.pathToClaudeCodeExecutable,
        }
      : {}),
    ...("codexPath" in provider && provider.codexPath !== undefined
      ? { codexPath: provider.codexPath }
      : {}),
    ...("baseUrl" in provider && provider.baseUrl !== undefined
      ? { baseUrl: provider.baseUrl }
      : {}),
    ...("apiKey" in provider && provider.apiKey !== undefined
      ? { apiKey: provider.apiKey }
      : {}),
    ...("apiToken" in provider && provider.apiToken !== undefined
      ? { apiToken: provider.apiToken }
      : {}),
    ...("accountId" in provider && provider.accountId !== undefined
      ? { accountId: provider.accountId }
      : {}),
    ...("env" in provider && provider.env !== undefined
      ? { env: provider.env }
      : {}),
    ...("config" in provider && provider.config !== undefined
      ? { config: provider.config }
      : {}),
    ...(provider.options ? { options: provider.options } : {}),
    ...(provider.settings ? { settings: provider.settings } : {}),
  };
}

function readOptionalString(
  value: unknown,
  source: string,
  field: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`'${field}' in ${source} must be a string.`);
  }
  return value;
}

function readOptionalObject(
  value: unknown,
  source: string,
  field: string,
): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireObject(value, `'${field}' in ${source} must be a JSON object.`);
}

function readOptionalStringMap(
  value: unknown,
  source: string,
  field: string,
): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  const map = requireObject(
    value,
    `'${field}' in ${source} must be a JSON object.`,
  );
  for (const [key, entry] of Object.entries(map)) {
    if (typeof entry !== "string") {
      throw new Error(`'${field}.${key}' in ${source} must be a string.`);
    }
  }
  return map as Record<string, string>;
}

function readOptionalNonEmptyStringArray(
  value: unknown,
  source: string,
  field: string,
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some(
      (entry) => typeof entry !== "string" || entry.trim().length === 0,
    )
  ) {
    throw new Error(
      `'${field}' in ${source} must be a non-empty array of non-empty strings.`,
    );
  }
  return value;
}

function parseOptionalPositiveInteger(
  value: unknown,
  source: string,
  field: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`'${field}' in ${source} must be a positive integer.`);
  }
  return value;
}

function parseOptionalNonNegativeInteger(
  value: unknown,
  source: string,
  field: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`'${field}' in ${source} must be a non-negative integer.`);
  }
  return value;
}

function parseOptionalLiteral<T extends readonly string[]>(
  value: unknown,
  source: string,
  field: string,
  allowed: T,
): T[number] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(
      `'${field}' in ${source} must be one of: ${allowed.join(", ")}.`,
    );
  }
  return value as T[number];
}

function parseLiteral<T extends readonly string[]>(
  value: unknown,
  source: string,
  field: string,
  allowed: T,
): T[number] {
  const parsed = parseOptionalLiteral(value, source, field, allowed);
  if (parsed === undefined) {
    throw new Error(
      `'${field}' in ${source} must be one of: ${allowed.join(", ")}.`,
    );
  }
  return parsed;
}

function cleanupConfig(config: WebProviders): void {
  if (config.settings) {
    if (
      config.settings.search &&
      Object.keys(config.settings.search).length === 0
    ) {
      delete config.settings.search;
    }

    if (Object.keys(config.settings).length === 0) {
      delete config.settings;
    }
  }

  if (config.providers) {
    for (const providerId of Object.keys(config.providers) as ProviderId[]) {
      const provider = config.providers[providerId] as
        | Record<string, unknown>
        | undefined;
      if (!provider) {
        delete config.providers[providerId];
        continue;
      }
      cleanupNestedEmptyObjects(provider);
      if (Object.keys(provider).length === 0) {
        delete config.providers[providerId];
      }
    }

    if (Object.keys(config.providers).length === 0) {
      delete config.providers;
    }
  }

  if (config.tools && Object.keys(config.tools).length === 0) {
    delete config.tools;
  }
}

function cleanupNestedEmptyObjects(value: Record<string, unknown>): void {
  for (const [key, entry] of Object.entries(value)) {
    if (Array.isArray(entry)) {
      if (entry.length === 0) {
        delete value[key];
      }
      continue;
    }

    if (isPlainObject(entry)) {
      cleanupNestedEmptyObjects(entry);
      if (Object.keys(entry).length === 0) {
        delete value[key];
      }
      continue;
    }

    if (entry === undefined) {
      delete value[key];
    }
  }
}

function requireObject(
  value: unknown,
  message: string,
): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new Error(message);
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
