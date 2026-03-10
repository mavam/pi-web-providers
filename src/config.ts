import { execSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import {
  PROVIDER_TOOLS,
  type ProviderToolId,
  supportsProviderTool,
} from "./provider-tools.js";
import type {
  ClaudeProviderConfig,
  CodexProviderConfig,
  ExaProviderConfig,
  GeminiProviderConfig,
  JsonObject,
  ParallelProviderConfig,
  ProviderId,
  ValyuProviderConfig,
  WebProvidersConfig,
} from "./types.js";

const LEGACY_TOOL_ALIASES: Partial<
  Record<ProviderId, Partial<Record<string, ProviderToolId | null>>>
> = {
  exa: {
    websetsPreview: null,
  },
  valyu: {
    deepResearch: "research",
  },
};

const CONFIG_FILE_NAME = "web-providers.json";
const VERSION = 1 as const;
const commandValueCache = new Map<
  string,
  { value?: string; errorMessage?: string }
>();

export function getConfigPath(): string {
  return join(getAgentDir(), CONFIG_FILE_NAME);
}

export function createDefaultConfig(): WebProvidersConfig {
  return {
    version: VERSION,
    providers: {
      claude: {
        enabled: false,
        tools: {
          search: true,
          answer: true,
        },
      },
      codex: {
        enabled: true,
        tools: {
          search: true,
        },
        defaults: {
          networkAccessEnabled: true,
          webSearchEnabled: true,
          webSearchMode: "live",
        },
      },
      exa: {
        enabled: false,
        tools: {
          search: true,
          contents: true,
          answer: true,
          research: true,
        },
        apiKey: "EXA_API_KEY",
        defaults: {
          type: "auto",
          contents: {
            text: true,
          },
        },
      },
      gemini: {
        enabled: false,
        tools: {
          search: true,
          contents: true,
          answer: true,
          research: true,
        },
        apiKey: "GOOGLE_API_KEY",
        defaults: {
          searchModel: "gemini-2.5-flash",
          contentsModel: "gemini-2.5-flash",
          answerModel: "gemini-2.5-flash",
          researchAgent: "deep-research-pro-preview-12-2025",
        },
      },
      parallel: {
        enabled: false,
        tools: {
          search: true,
          contents: true,
        },
        apiKey: "PARALLEL_API_KEY",
        defaults: {
          search: {
            mode: "agentic",
          },
          extract: {
            excerpts: true,
            full_content: false,
          },
        },
      },
      valyu: {
        enabled: false,
        tools: {
          search: true,
          contents: true,
          answer: true,
          research: true,
        },
        apiKey: "VALYU_API_KEY",
        defaults: {
          searchType: "all",
          responseLength: "short",
        },
      },
    },
  };
}

export async function loadConfig(): Promise<WebProvidersConfig> {
  return readConfigFile(getConfigPath());
}

export async function readConfigFile(
  path: string,
): Promise<WebProvidersConfig> {
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

export async function writeConfigFile(
  config: WebProvidersConfig,
): Promise<string> {
  const path = getConfigPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serializeConfig(config), "utf-8");
  return path;
}

export function parseConfig(
  text: string,
  source = CONFIG_FILE_NAME,
): WebProvidersConfig {
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
):
  | ClaudeProviderConfig
  | CodexProviderConfig
  | ExaProviderConfig
  | GeminiProviderConfig
  | ParallelProviderConfig
  | ValyuProviderConfig {
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
      version: VERSION,
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

export function serializeConfig(config: WebProvidersConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
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

function emptyConfig(): WebProvidersConfig {
  return { version: VERSION };
}

function normalizeConfig(raw: unknown, source: string): WebProvidersConfig {
  if (!isPlainObject(raw)) {
    throw new Error(`Config in ${source} must be a JSON object.`);
  }

  const version = raw.version ?? VERSION;
  if (version !== VERSION) {
    throw new Error(
      `Unsupported config version '${String(version)}' in ${source}. Expected ${VERSION}.`,
    );
  }

  const config: WebProvidersConfig = { version: VERSION };

  if (raw.providers !== undefined) {
    if (!isPlainObject(raw.providers)) {
      throw new Error(`'providers' in ${source} must be a JSON object.`);
    }

    config.providers = {};
    if (raw.providers.claude !== undefined) {
      config.providers.claude = normalizeClaudeProvider(
        raw.providers.claude,
        source,
      );
    }
    if (raw.providers.codex !== undefined) {
      config.providers.codex = normalizeCodexProvider(
        raw.providers.codex,
        source,
      );
    }
    if (raw.providers.exa !== undefined) {
      config.providers.exa = normalizeExaProvider(raw.providers.exa, source);
    }
    if (raw.providers.gemini !== undefined) {
      config.providers.gemini = normalizeGeminiProvider(
        raw.providers.gemini,
        source,
      );
    }
    if (raw.providers.parallel !== undefined) {
      config.providers.parallel = normalizeParallelProvider(
        raw.providers.parallel,
        source,
      );
    }
    if (raw.providers.valyu !== undefined) {
      config.providers.valyu = normalizeValyuProvider(
        raw.providers.valyu,
        source,
      );
    }

    const unknownProviders = Object.keys(raw.providers).filter(
      (key) =>
        key !== "claude" &&
        key !== "codex" &&
        key !== "exa" &&
        key !== "gemini" &&
        key !== "parallel" &&
        key !== "valyu",
    );
    if (unknownProviders.length > 0) {
      throw new Error(
        `Unknown providers in ${source}: ${unknownProviders.join(", ")}.`,
      );
    }
  }

  return config;
}

function normalizeClaudeProvider(
  raw: unknown,
  source: string,
): ClaudeProviderConfig {
  const provider = parseProviderObject(raw, source, "claude");
  const defaults = parseOptionalJsonObject(
    provider.defaults,
    source,
    "providers.claude.defaults",
  );

  return {
    enabled: parseOptionalBoolean(
      provider.enabled,
      source,
      "providers.claude.enabled",
    ),
    tools: parseOptionalProviderTools(
      "claude",
      provider.tools,
      source,
      "providers.claude.tools",
    ) as ClaudeProviderConfig["tools"],
    pathToClaudeCodeExecutable: parseOptionalString(
      provider.pathToClaudeCodeExecutable,
      source,
      "providers.claude.pathToClaudeCodeExecutable",
    ),
    defaults:
      defaults === undefined
        ? undefined
        : {
            model: parseOptionalString(
              defaults.model,
              source,
              "providers.claude.defaults.model",
            ),
            effort: parseOptionalLiteral(
              defaults.effort,
              source,
              "providers.claude.defaults.effort",
              ["low", "medium", "high", "max"] as const,
            ),
            maxTurns: parseOptionalInteger(
              defaults.maxTurns,
              source,
              "providers.claude.defaults.maxTurns",
            ),
          },
  };
}

function normalizeCodexProvider(
  raw: unknown,
  source: string,
): CodexProviderConfig {
  const provider = parseProviderObject(raw, source, "codex");
  const defaults = parseOptionalJsonObject(
    provider.defaults,
    source,
    "providers.codex.defaults",
  );
  return {
    enabled: parseOptionalBoolean(
      provider.enabled,
      source,
      "providers.codex.enabled",
    ),
    tools: parseOptionalProviderTools(
      "codex",
      provider.tools,
      source,
      "providers.codex.tools",
    ) as CodexProviderConfig["tools"],
    codexPath: parseOptionalString(
      provider.codexPath,
      source,
      "providers.codex.codexPath",
    ),
    baseUrl: parseOptionalString(
      provider.baseUrl,
      source,
      "providers.codex.baseUrl",
    ),
    apiKey: parseOptionalString(
      provider.apiKey,
      source,
      "providers.codex.apiKey",
    ),
    env: parseOptionalStringMap(provider.env, source, "providers.codex.env"),
    config: parseOptionalJsonObject(
      provider.config,
      source,
      "providers.codex.config",
    ),
    defaults:
      defaults === undefined
        ? undefined
        : {
            model: parseOptionalString(
              defaults.model,
              source,
              "providers.codex.defaults.model",
            ),
            modelReasoningEffort: parseOptionalLiteral(
              defaults.modelReasoningEffort,
              source,
              "providers.codex.defaults.modelReasoningEffort",
              ["minimal", "low", "medium", "high", "xhigh"] as const,
            ),
            networkAccessEnabled: parseOptionalBoolean(
              defaults.networkAccessEnabled,
              source,
              "providers.codex.defaults.networkAccessEnabled",
            ),
            webSearchMode: parseOptionalLiteral(
              defaults.webSearchMode,
              source,
              "providers.codex.defaults.webSearchMode",
              ["disabled", "cached", "live"] as const,
            ),
            webSearchEnabled: parseOptionalBoolean(
              defaults.webSearchEnabled,
              source,
              "providers.codex.defaults.webSearchEnabled",
            ),
            additionalDirectories: parseOptionalStringArray(
              defaults.additionalDirectories,
              source,
              "providers.codex.defaults.additionalDirectories",
            ),
          },
  };
}

function normalizeExaProvider(raw: unknown, source: string): ExaProviderConfig {
  const provider = parseProviderObject(raw, source, "exa");
  return {
    enabled: parseOptionalBoolean(
      provider.enabled,
      source,
      "providers.exa.enabled",
    ),
    tools: parseOptionalProviderTools(
      "exa",
      provider.tools,
      source,
      "providers.exa.tools",
    ) as ExaProviderConfig["tools"],
    apiKey: parseOptionalString(
      provider.apiKey,
      source,
      "providers.exa.apiKey",
    ),
    baseUrl: parseOptionalString(
      provider.baseUrl,
      source,
      "providers.exa.baseUrl",
    ),
    defaults: parseOptionalJsonObject(
      provider.defaults,
      source,
      "providers.exa.defaults",
    ),
  };
}

function normalizeValyuProvider(
  raw: unknown,
  source: string,
): ValyuProviderConfig {
  const provider = parseProviderObject(raw, source, "valyu");
  return {
    enabled: parseOptionalBoolean(
      provider.enabled,
      source,
      "providers.valyu.enabled",
    ),
    tools: parseOptionalProviderTools(
      "valyu",
      provider.tools,
      source,
      "providers.valyu.tools",
    ) as ValyuProviderConfig["tools"],
    apiKey: parseOptionalString(
      provider.apiKey,
      source,
      "providers.valyu.apiKey",
    ),
    baseUrl: parseOptionalString(
      provider.baseUrl,
      source,
      "providers.valyu.baseUrl",
    ),
    defaults: parseOptionalJsonObject(
      provider.defaults,
      source,
      "providers.valyu.defaults",
    ),
  };
}

function normalizeGeminiProvider(
  raw: unknown,
  source: string,
): GeminiProviderConfig {
  const provider = parseProviderObject(raw, source, "gemini");
  const defaults = parseOptionalJsonObject(
    provider.defaults,
    source,
    "providers.gemini.defaults",
  );

  return {
    enabled: parseOptionalBoolean(
      provider.enabled,
      source,
      "providers.gemini.enabled",
    ),
    tools: parseOptionalProviderTools(
      "gemini",
      provider.tools,
      source,
      "providers.gemini.tools",
    ) as GeminiProviderConfig["tools"],
    apiKey: parseOptionalString(
      provider.apiKey,
      source,
      "providers.gemini.apiKey",
    ),
    defaults:
      defaults === undefined
        ? undefined
        : {
            apiVersion: parseOptionalString(
              defaults.apiVersion,
              source,
              "providers.gemini.defaults.apiVersion",
            ),
            searchModel: parseOptionalString(
              defaults.searchModel,
              source,
              "providers.gemini.defaults.searchModel",
            ),
            contentsModel: parseOptionalString(
              defaults.contentsModel,
              source,
              "providers.gemini.defaults.contentsModel",
            ),
            answerModel: parseOptionalString(
              defaults.answerModel,
              source,
              "providers.gemini.defaults.answerModel",
            ),
            researchAgent: parseOptionalString(
              defaults.researchAgent,
              source,
              "providers.gemini.defaults.researchAgent",
            ),
          },
  };
}

function normalizeParallelProvider(
  raw: unknown,
  source: string,
): ParallelProviderConfig {
  const provider = parseProviderObject(raw, source, "parallel");
  const defaults = parseOptionalJsonObject(
    provider.defaults,
    source,
    "providers.parallel.defaults",
  );

  return {
    enabled: parseOptionalBoolean(
      provider.enabled,
      source,
      "providers.parallel.enabled",
    ),
    tools: parseOptionalProviderTools(
      "parallel",
      provider.tools,
      source,
      "providers.parallel.tools",
    ) as ParallelProviderConfig["tools"],
    apiKey: parseOptionalString(
      provider.apiKey,
      source,
      "providers.parallel.apiKey",
    ),
    baseUrl: parseOptionalString(
      provider.baseUrl,
      source,
      "providers.parallel.baseUrl",
    ),
    defaults:
      defaults === undefined
        ? undefined
        : {
            search: parseOptionalJsonObject(
              defaults.search,
              source,
              "providers.parallel.defaults.search",
            ),
            extract: parseOptionalJsonObject(
              defaults.extract,
              source,
              "providers.parallel.defaults.extract",
            ),
          },
  };
}

function parseProviderObject(
  raw: unknown,
  source: string,
  field: string,
): JsonObject {
  if (!isPlainObject(raw)) {
    throw new Error(`'providers.${field}' in ${source} must be a JSON object.`);
  }
  return raw;
}

function parseOptionalJsonObject(
  value: unknown,
  source: string,
  field: string,
): JsonObject | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    throw new Error(`'${field}' in ${source} must be a JSON object.`);
  }
  return value;
}

function parseOptionalProviderTools(
  providerId: ProviderId,
  value: unknown,
  source: string,
  field: string,
): Partial<Record<ProviderToolId, boolean>> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    throw new Error(`'${field}' in ${source} must be a JSON object.`);
  }

  const parsed: Partial<Record<ProviderToolId, boolean>> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = normalizeProviderToolKey(providerId, key);
    if (normalizedKey === null) {
      continue;
    }
    if (!supportsProviderTool(providerId, normalizedKey)) {
      throw new Error(`Unknown tools for ${providerId} in ${source}: ${key}.`);
    }
    parsed[normalizedKey] = parseBoolean(entry, source, `${field}.${key}`);
  }

  const unknownTools = Object.keys(value).filter((toolId) => {
    const normalizedKey = normalizeProviderToolKey(providerId, toolId);
    return (
      normalizedKey !== null &&
      !PROVIDER_TOOLS[providerId].includes(normalizedKey)
    );
  });
  if (unknownTools.length > 0) {
    throw new Error(
      `Unknown tools for ${providerId} in ${source}: ${unknownTools.join(", ")}.`,
    );
  }

  return parsed;
}

function normalizeProviderToolKey(
  providerId: ProviderId,
  key: string,
): ProviderToolId | null {
  const alias = LEGACY_TOOL_ALIASES[providerId]?.[key];
  if (alias !== undefined) {
    return alias;
  }
  return key as ProviderToolId;
}

function parseOptionalStringMap(
  value: unknown,
  source: string,
  field: string,
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    throw new Error(
      `'${field}' in ${source} must be a JSON object of strings.`,
    );
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      parseString(entry, source, `${field}.${key}`),
    ]),
  );
}

function parseOptionalStringArray(
  value: unknown,
  source: string,
  field: string,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`'${field}' in ${source} must be an array of strings.`);
  }
  return value.map((entry, index) =>
    parseString(entry, source, `${field}[${index}]`),
  );
}

function parseOptionalBoolean(
  value: unknown,
  source: string,
  field: string,
): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(`'${field}' in ${source} must be a boolean.`);
  }
  return value;
}

function parseBoolean(value: unknown, source: string, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`'${field}' in ${source} must be a boolean.`);
  }
  return value;
}

function parseOptionalString(
  value: unknown,
  source: string,
  field: string,
): string | undefined {
  if (value === undefined) return undefined;
  return parseString(value, source, field);
}

function parseString(value: unknown, source: string, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`'${field}' in ${source} must be a string.`);
  }
  return value;
}

function parseOptionalInteger(
  value: unknown,
  source: string,
  field: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`'${field}' in ${source} must be a positive integer.`);
  }
  return value;
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

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
