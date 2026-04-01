import { execSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import { z } from "zod";
import { supportsTool } from "./provider-tools.js";
import type {
  Claude,
  Cloudflare,
  Codex,
  Custom,
  CustomCommandConfig,
  Exa,
  ExecutionSettings,
  Gemini,
  Parallel,
  Perplexity,
  ProviderId,
  SearchSettings,
  Settings,
  Tool,
  Tools,
  Valyu,
  WebProviders,
} from "./types.js";
import { PROVIDER_IDS, TOOLS } from "./types.js";

const CONFIG_FILE_NAME = "web-providers.json";
const jsonObjectSchema = z.object({}).catchall(z.unknown());
const stringSchema = z.string();
const booleanSchema = z.boolean();
const positiveIntegerSchema = z.number().int().positive();
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const stringArraySchema = z.array(z.string());
const stringMapSchema = z.record(z.string(), z.string());
const nonEmptyStringArraySchema = z
  .array(z.string().refine((value) => value.trim().length > 0))
  .nonempty();
const executionSettingsSchema = z
  .object({
    requestTimeoutMs: positiveIntegerSchema.optional(),
    retryCount: nonNegativeIntegerSchema.optional(),
    retryDelayMs: positiveIntegerSchema.optional(),
    researchTimeoutMs: positiveIntegerSchema.optional(),
  })
  .strict();
const searchSettingsSchema = z
  .object({
    provider: z.enum(PROVIDER_IDS).optional(),
    maxUrls: positiveIntegerSchema.optional(),
    ttlMs: positiveIntegerSchema.optional(),
  })
  .strict();
const settingsSchema = executionSettingsSchema.extend({
  search: jsonObjectSchema.optional(),
});
const claudeOptionsSchema = z
  .object({
    model: stringSchema.optional(),
    effort: z.enum(["low", "medium", "high", "max"]).optional(),
    maxTurns: positiveIntegerSchema.optional(),
  })
  .strict();
const claudeProviderSchema = z
  .object({
    pathToClaudeCodeExecutable: stringSchema.optional(),
    options: claudeOptionsSchema.optional(),
    settings: executionSettingsSchema.optional(),
  })
  .strict();
const codexOptionsSchema = z
  .object({
    model: stringSchema.optional(),
    modelReasoningEffort: z
      .enum(["minimal", "low", "medium", "high", "xhigh"])
      .optional(),
    networkAccessEnabled: booleanSchema.optional(),
    webSearchMode: z.enum(["disabled", "cached", "live"]).optional(),
    webSearchEnabled: booleanSchema.optional(),
    additionalDirectories: stringArraySchema.optional(),
  })
  .strict();
const codexProviderSchema = z
  .object({
    codexPath: stringSchema.optional(),
    baseUrl: stringSchema.optional(),
    apiKey: stringSchema.optional(),
    env: stringMapSchema.optional(),
    config: jsonObjectSchema.optional(),
    options: codexOptionsSchema.optional(),
    settings: executionSettingsSchema.optional(),
  })
  .strict();
const cloudflareProviderSchema = z
  .object({
    apiToken: stringSchema.optional(),
    accountId: stringSchema.optional(),
    options: jsonObjectSchema.optional(),
    settings: executionSettingsSchema.optional(),
  })
  .strict();
const geminiOptionsSchema = z
  .object({
    apiVersion: stringSchema.optional(),
    searchModel: stringSchema.optional(),
    answerModel: stringSchema.optional(),
    researchAgent: stringSchema.optional(),
  })
  .strict();
const geminiProviderSchema = z
  .object({
    apiKey: stringSchema.optional(),
    options: geminiOptionsSchema.optional(),
    settings: executionSettingsSchema.optional(),
  })
  .strict();
const perplexityOptionsSchema = z
  .object({
    search: jsonObjectSchema.optional(),
    answer: jsonObjectSchema.optional(),
    research: jsonObjectSchema.optional(),
  })
  .strict();
const perplexityProviderSchema = z
  .object({
    apiKey: stringSchema.optional(),
    baseUrl: stringSchema.optional(),
    options: perplexityOptionsSchema.optional(),
    settings: executionSettingsSchema.optional(),
  })
  .strict();
const parallelOptionsSchema = z
  .object({
    search: jsonObjectSchema.optional(),
    extract: jsonObjectSchema.optional(),
  })
  .strict();
const parallelProviderSchema = z
  .object({
    apiKey: stringSchema.optional(),
    baseUrl: stringSchema.optional(),
    options: parallelOptionsSchema.optional(),
    settings: executionSettingsSchema.optional(),
  })
  .strict();
const simpleApiProviderSchema = z
  .object({
    apiKey: stringSchema.optional(),
    baseUrl: stringSchema.optional(),
    options: jsonObjectSchema.optional(),
    settings: executionSettingsSchema.optional(),
  })
  .strict();
const customCommandSchema = z
  .object({
    argv: nonEmptyStringArraySchema.optional(),
    cwd: stringSchema.optional(),
    env: stringMapSchema.optional(),
  })
  .strict();
const customProviderSchema = z
  .object({
    options: z
      .object({
        search: customCommandSchema.optional(),
        contents: customCommandSchema.optional(),
        answer: customCommandSchema.optional(),
        research: customCommandSchema.optional(),
      })
      .strict()
      .optional(),
    settings: executionSettingsSchema.optional(),
  })
  .strict();
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
      return emptyConfig();
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
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON in ${source}: ${(error as Error).message}`);
  }

  return normalizeConfig(raw, source);
}

export function parseProviderConfig(
  providerId: ProviderId,
  text: string,
  source = CONFIG_FILE_NAME,
): Claude | Codex | Custom | Exa | Gemini | Perplexity | Parallel | Valyu {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON in ${source}: ${(error as Error).message}`);
  }

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

function emptyConfig(): WebProviders {
  return {};
}

function normalizeConfig(raw: unknown, source: string): WebProviders {
  if (!isPlainObject(raw)) {
    throw new Error(`Config in ${source} must be a JSON object.`);
  }

  const config: WebProviders = {};

  if (raw.tools !== undefined) {
    config.tools = parseToolProviderMapping(raw.tools, source, "tools");
  }

  if (raw.settings !== undefined) {
    config.settings = parseSettingsConfig(raw.settings, source);
  }

  if (raw.providers !== undefined) {
    if (!isPlainObject(raw.providers)) {
      throw new Error(`'providers' in ${source} must be a JSON object.`);
    }

    const providers = raw.providers;
    const unknownProviders = Object.keys(providers).filter(
      (key) => !PROVIDER_IDS.includes(key as ProviderId),
    );
    if (unknownProviders.length > 0) {
      throw new Error(
        `Unknown providers in ${source}: ${unknownProviders.join(", ")}.`,
      );
    }

    const normalizers = {
      claude: normalizeClaudeProvider,
      cloudflare: normalizeCloudflareProvider,
      codex: normalizeCodexProvider,
      custom: normalizeCustomProvider,
      exa: normalizeExaProvider,
      gemini: normalizeGeminiProvider,
      perplexity: normalizePerplexityProvider,
      parallel: normalizeParallelProvider,
      valyu: normalizeValyuProvider,
    } satisfies Record<ProviderId, (raw: unknown, source: string) => unknown>;

    config.providers = Object.fromEntries(
      PROVIDER_IDS.flatMap((providerId) =>
        providers[providerId] === undefined
          ? []
          : [
              [
                providerId,
                normalizers[providerId](providers[providerId], source),
              ],
            ],
      ),
    );
  }

  cleanupConfig(config);

  return config;
}

function normalizeClaudeProvider(raw: unknown, source: string): Claude {
  return parseProviderWithSchema(raw, source, "claude", claudeProviderSchema);
}

function normalizeCloudflareProvider(raw: unknown, source: string): Cloudflare {
  return parseProviderWithSchema(
    raw,
    source,
    "cloudflare",
    cloudflareProviderSchema,
  );
}

function normalizeCodexProvider(raw: unknown, source: string): Codex {
  return parseProviderWithSchema(raw, source, "codex", codexProviderSchema);
}

function normalizeExaProvider(raw: unknown, source: string): Exa {
  return parseProviderWithSchema(raw, source, "exa", simpleApiProviderSchema);
}

function normalizeValyuProvider(raw: unknown, source: string): Valyu {
  return parseProviderWithSchema(raw, source, "valyu", simpleApiProviderSchema);
}

function normalizeGeminiProvider(raw: unknown, source: string): Gemini {
  return parseProviderWithSchema(raw, source, "gemini", geminiProviderSchema);
}

function normalizePerplexityProvider(raw: unknown, source: string): Perplexity {
  return parseProviderWithSchema(
    raw,
    source,
    "perplexity",
    perplexityProviderSchema,
  );
}

function normalizeParallelProvider(raw: unknown, source: string): Parallel {
  return parseProviderWithSchema(
    raw,
    source,
    "parallel",
    parallelProviderSchema,
  );
}

function normalizeCustomProvider(raw: unknown, source: string): Custom {
  return parseProviderWithSchema(raw, source, "custom", customProviderSchema);
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
  } as unknown as Record<string, unknown>;
}

function parseProviderWithSchema<T>(
  raw: unknown,
  source: string,
  providerId: ProviderId,
  schema: z.ZodType<T>,
): T {
  const provider = parseProviderObject(raw, source, providerId);
  rejectLegacyProviderToolFields(provider, source, providerId);
  rejectRemovedProviderEnabledField(provider, source, providerId);

  const parsed = schema.safeParse(provider);
  if (!parsed.success) {
    const argvIssue = parsed.error.issues.find((issue) =>
      issue.path.includes("argv"),
    );
    if (argvIssue) {
      const commandField = argvIssue.path.slice(0, -1).join(".");
      throw new Error(
        `'providers.${providerId}.${commandField}' in ${source} must be a non-empty array of non-empty strings.`,
      );
    }
    throw new Error(
      `'providers.${providerId}' in ${source} must be a valid provider config.`,
    );
  }

  return parsed.data;
}

function toPublicProviderConfig(
  provider:
    | Claude
    | Cloudflare
    | Codex
    | Custom
    | Exa
    | Gemini
    | Perplexity
    | Parallel
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
  } as unknown as Record<string, unknown>;
}

function parseSettingsConfig(value: unknown, source: string): Settings {
  const parsed = parseWithSchema(
    value,
    settingsSchema,
    source,
    "settings",
    "must be a JSON object.",
  );

  const settings: Settings = {
    requestTimeoutMs: parsed.requestTimeoutMs,
    retryCount: parsed.retryCount,
    retryDelayMs: parsed.retryDelayMs,
    researchTimeoutMs: parsed.researchTimeoutMs,
    search:
      parsed.search !== undefined
        ? parseSearchSettings(parsed.search, source, "settings.search")
        : undefined,
  };

  return Object.values(settings).some((entry) => entry !== undefined)
    ? settings
    : {};
}

function parseProviderObject(
  raw: unknown,
  source: string,
  field: string,
): Record<string, unknown> {
  return parseWithSchema(
    raw,
    jsonObjectSchema,
    source,
    `providers.${field}`,
    "must be a JSON object.",
  );
}

function parseToolProviderMapping(
  value: unknown,
  source: string,
  field: string,
): Tools {
  if (!isPlainObject(value)) {
    throw new Error(`'${field}' in ${source} must be a JSON object.`);
  }

  const parsed: Tools = {};
  for (const [key, entry] of Object.entries(value)) {
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
  const raw = parseWithSchema(
    value,
    jsonObjectSchema,
    source,
    field,
    "must be a JSON object.",
  );

  const unknownFields = Object.keys(raw).filter(
    (key) => key !== "provider" && key !== "maxUrls" && key !== "ttlMs",
  );
  if (unknownFields.length > 0) {
    throw new Error(
      `Unknown search settings in ${source}: ${unknownFields.join(", ")}.`,
    );
  }

  const parsed = parseWithSchema(
    raw,
    searchSettingsSchema,
    source,
    field,
    "must be a JSON object.",
  );

  if (
    parsed.provider !== undefined &&
    !supportsTool(parsed.provider, "contents")
  ) {
    throw new Error(
      `'${field}.provider' in ${source} must name a provider that supports 'contents'.`,
    );
  }

  return parsed;
}

function rejectLegacyProviderToolFields(
  provider: Record<string, unknown>,
  source: string,
  providerId: ProviderId,
): void {
  if (provider.tools !== undefined) {
    throw new Error(
      `'providers.${providerId}.tools' in ${source} is no longer supported. Use top-level 'tools' mappings instead.`,
    );
  }
}

function rejectRemovedProviderEnabledField(
  provider: Record<string, unknown>,
  source: string,
  providerId: ProviderId,
): void {
  if (provider.enabled !== undefined) {
    throw new Error(
      `'providers.${providerId}.enabled' in ${source} is no longer supported. Providers are always on; use top-level 'tools' mappings to route or disable capabilities.`,
    );
  }
}

function parseOptionalWithSchema<T>(
  value: unknown,
  schema: z.ZodType<T>,
  source: string,
  field: string,
  errorMessage: string,
): T | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`'${field}' in ${source} ${errorMessage}`);
  }
  return parsed.data;
}

function parseWithSchema<T>(
  value: unknown,
  schema: z.ZodType<T>,
  source: string,
  field: string,
  errorMessage: string,
): T {
  const parsed = parseOptionalWithSchema(
    value,
    schema,
    source,
    field,
    errorMessage,
  );
  if (parsed === undefined) {
    throw new Error(`'${field}' in ${source} ${errorMessage}`);
  }
  return parsed;
}

function parseOptionalLiteral<T extends readonly string[]>(
  value: unknown,
  source: string,
  field: string,
  allowed: T,
): T[number] | undefined {
  if (value === undefined) return undefined;
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
