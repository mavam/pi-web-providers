import { execSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import {
  createDefaultExecutionSettings,
  DEFAULT_GEMINI_RESEARCH_MAX_CONSECUTIVE_POLL_ERRORS,
} from "./execution-policy-defaults.js";
import { supportsTool } from "./provider-tools.js";
import type {
  Claude,
  Codex,
  CustomCommandConfig,
  Custom,
  Exa,
  ExecutionSettings,
  Gemini,
  Parallel,
  Perplexity,
  Tavily,
  Tool,
  ProviderId,
  SearchSettings,
  Settings,
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
      contents: null,
      answer: null,
      research: null,
    },
    settings: createDefaultExecutionSettings(),
    providers: {
      claude: {
        enabled: false,
      },
      codex: {
        enabled: true,
        options: {
          networkAccessEnabled: true,
          webSearchEnabled: true,
          webSearchMode: "live",
        },
      },
      custom: {
        enabled: false,
      },
      exa: {
        enabled: false,
        apiKey: "EXA_API_KEY",
        options: {
          type: "auto",
          contents: {
            text: true,
          },
        },
      },
      gemini: {
        enabled: false,
        apiKey: "GOOGLE_API_KEY",
        options: {
          searchModel: "gemini-2.5-flash",
          answerModel: "gemini-2.5-flash",
          researchAgent: "deep-research-pro-preview-12-2025",
        },
        settings: {
          researchMaxConsecutivePollErrors:
            DEFAULT_GEMINI_RESEARCH_MAX_CONSECUTIVE_POLL_ERRORS,
        },
      },
      perplexity: {
        enabled: false,
        apiKey: "PERPLEXITY_API_KEY",
        options: {
          answer: {
            model: "sonar",
          },
          research: {
            model: "sonar-deep-research",
          },
        },
      },
      parallel: {
        enabled: false,
        apiKey: "PARALLEL_API_KEY",
        options: {
          search: {
            mode: "agentic",
          },
          extract: {
            excerpts: true,
            full_content: false,
          },
        },
      },
      tavily: {
        enabled: false,
        apiKey: "TAVILY_API_KEY",
      },
      valyu: {
        enabled: false,
        apiKey: "VALYU_API_KEY",
        options: {
          searchType: "all",
          responseLength: "short",
        },
      },
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
  await writeFile(path, serializeConfig(config), "utf-8");
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
):
  | Claude
  | Codex
  | Custom
  | Exa
  | Gemini
  | Perplexity
  | Parallel
  | Tavily
  | Valyu {
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
    if (raw.providers.custom !== undefined) {
      config.providers.custom = normalizeCustomProvider(
        raw.providers.custom,
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
    if (raw.providers.perplexity !== undefined) {
      config.providers.perplexity = normalizePerplexityProvider(
        raw.providers.perplexity,
        source,
      );
    }
    if (raw.providers.parallel !== undefined) {
      config.providers.parallel = normalizeParallelProvider(
        raw.providers.parallel,
        source,
      );
    }
    if (raw.providers.tavily !== undefined) {
      config.providers.tavily = normalizeTavilyProvider(
        raw.providers.tavily,
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
        key !== "custom" &&
        key !== "exa" &&
        key !== "gemini" &&
        key !== "perplexity" &&
        key !== "parallel" &&
        key !== "tavily" &&
        key !== "valyu",
    );
    if (unknownProviders.length > 0) {
      throw new Error(
        `Unknown providers in ${source}: ${unknownProviders.join(", ")}.`,
      );
    }
  }

  if (config.providers) {
    for (const providerId of Object.keys(config.providers) as ProviderId[]) {
      const provider = config.providers[providerId];
      if (provider && provider.enabled === undefined) {
        provider.enabled = inferProviderEnabled(config, providerId);
      }
    }
  }

  return config;
}

function normalizeClaudeProvider(raw: unknown, source: string): Claude {
  const provider = parseProviderObject(raw, source, "claude");
  rejectLegacyProviderToolFields(provider, source, "claude");
  const options = parseOptionalJsonObject(
    provider.options,
    source,
    "providers.claude.options",
  );

  return {
    enabled: parseOptionalBoolean(
      provider.enabled,
      source,
      "providers.claude.enabled",
    ),
    pathToClaudeCodeExecutable: parseOptionalString(
      provider.pathToClaudeCodeExecutable,
      source,
      "providers.claude.pathToClaudeCodeExecutable",
    ),
    options:
      options === undefined
        ? undefined
        : {
            model: parseOptionalString(
              options.model,
              source,
              "providers.claude.options.model",
            ),
            effort: parseOptionalLiteral(
              options.effort,
              source,
              "providers.claude.options.effort",
              ["low", "medium", "high", "max"] as const,
            ),
            maxTurns: parseOptionalInteger(
              options.maxTurns,
              source,
              "providers.claude.options.maxTurns",
            ),
          },
    settings: parseOptionalExecutionPolicy(
      provider.settings,
      source,
      "providers.claude.settings",
    ),
  };
}

function normalizeCodexProvider(raw: unknown, source: string): Codex {
  const provider = parseProviderObject(raw, source, "codex");
  rejectLegacyProviderToolFields(provider, source, "codex");
  const options = parseOptionalJsonObject(
    provider.options,
    source,
    "providers.codex.options",
  );
  return {
    enabled: parseOptionalBoolean(
      provider.enabled,
      source,
      "providers.codex.enabled",
    ),
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
    options:
      options === undefined
        ? undefined
        : {
            model: parseOptionalString(
              options.model,
              source,
              "providers.codex.options.model",
            ),
            modelReasoningEffort: parseOptionalLiteral(
              options.modelReasoningEffort,
              source,
              "providers.codex.options.modelReasoningEffort",
              ["minimal", "low", "medium", "high", "xhigh"] as const,
            ),
            networkAccessEnabled: parseOptionalBoolean(
              options.networkAccessEnabled,
              source,
              "providers.codex.options.networkAccessEnabled",
            ),
            webSearchMode: parseOptionalLiteral(
              options.webSearchMode,
              source,
              "providers.codex.options.webSearchMode",
              ["disabled", "cached", "live"] as const,
            ),
            webSearchEnabled: parseOptionalBoolean(
              options.webSearchEnabled,
              source,
              "providers.codex.options.webSearchEnabled",
            ),
            additionalDirectories: parseOptionalStringArray(
              options.additionalDirectories,
              source,
              "providers.codex.options.additionalDirectories",
            ),
          },
    settings: parseOptionalExecutionPolicy(
      provider.settings,
      source,
      "providers.codex.settings",
    ),
  };
}

function normalizeExaProvider(raw: unknown, source: string): Exa {
  const provider = parseProviderObject(raw, source, "exa");
  rejectLegacyProviderToolFields(provider, source, "exa");
  return {
    enabled: parseOptionalBoolean(
      provider.enabled,
      source,
      "providers.exa.enabled",
    ),
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
    options: parseOptionalJsonObject(
      provider.options,
      source,
      "providers.exa.options",
    ),
    settings: parseOptionalExecutionPolicy(
      provider.settings,
      source,
      "providers.exa.settings",
    ),
  };
}

function normalizeValyuProvider(raw: unknown, source: string): Valyu {
  const provider = parseProviderObject(raw, source, "valyu");
  rejectLegacyProviderToolFields(provider, source, "valyu");
  return {
    enabled: parseOptionalBoolean(
      provider.enabled,
      source,
      "providers.valyu.enabled",
    ),
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
    options: parseOptionalJsonObject(
      provider.options,
      source,
      "providers.valyu.options",
    ),
    settings: parseOptionalExecutionPolicy(
      provider.settings,
      source,
      "providers.valyu.settings",
    ),
  };
}

function normalizeGeminiProvider(raw: unknown, source: string): Gemini {
  const provider = parseProviderObject(raw, source, "gemini");
  rejectLegacyProviderToolFields(provider, source, "gemini");
  const options = parseOptionalJsonObject(
    provider.options,
    source,
    "providers.gemini.options",
  );

  return {
    enabled: parseOptionalBoolean(
      provider.enabled,
      source,
      "providers.gemini.enabled",
    ),
    apiKey: parseOptionalString(
      provider.apiKey,
      source,
      "providers.gemini.apiKey",
    ),
    options:
      options === undefined
        ? undefined
        : {
            apiVersion: parseOptionalString(
              options.apiVersion,
              source,
              "providers.gemini.options.apiVersion",
            ),
            searchModel: parseOptionalString(
              options.searchModel,
              source,
              "providers.gemini.options.searchModel",
            ),
            answerModel: parseOptionalString(
              options.answerModel,
              source,
              "providers.gemini.options.answerModel",
            ),
            researchAgent: parseOptionalString(
              options.researchAgent,
              source,
              "providers.gemini.options.researchAgent",
            ),
          },
    settings: parseOptionalExecutionPolicy(
      provider.settings,
      source,
      "providers.gemini.settings",
    ),
  };
}

function normalizePerplexityProvider(raw: unknown, source: string): Perplexity {
  const provider = parseProviderObject(raw, source, "perplexity");
  rejectLegacyProviderToolFields(provider, source, "perplexity");
  const options = parseOptionalJsonObject(
    provider.options,
    source,
    "providers.perplexity.options",
  );

  return {
    enabled: parseOptionalBoolean(
      provider.enabled,
      source,
      "providers.perplexity.enabled",
    ),
    apiKey: parseOptionalString(
      provider.apiKey,
      source,
      "providers.perplexity.apiKey",
    ),
    baseUrl: parseOptionalString(
      provider.baseUrl,
      source,
      "providers.perplexity.baseUrl",
    ),
    options:
      options === undefined
        ? undefined
        : {
            search: parseOptionalJsonObject(
              options.search,
              source,
              "providers.perplexity.options.search",
            ),
            answer: parseOptionalJsonObject(
              options.answer,
              source,
              "providers.perplexity.options.answer",
            ),
            research: parseOptionalJsonObject(
              options.research,
              source,
              "providers.perplexity.options.research",
            ),
          },
    settings: parseOptionalExecutionPolicy(
      provider.settings,
      source,
      "providers.perplexity.settings",
    ),
  };
}

function normalizeParallelProvider(raw: unknown, source: string): Parallel {
  const provider = parseProviderObject(raw, source, "parallel");
  rejectLegacyProviderToolFields(provider, source, "parallel");
  const options = parseOptionalJsonObject(
    provider.options,
    source,
    "providers.parallel.options",
  );

  return {
    enabled: parseOptionalBoolean(
      provider.enabled,
      source,
      "providers.parallel.enabled",
    ),
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
    options:
      options === undefined
        ? undefined
        : {
            search: parseOptionalJsonObject(
              options.search,
              source,
              "providers.parallel.options.search",
            ),
            extract: parseOptionalJsonObject(
              options.extract,
              source,
              "providers.parallel.options.extract",
            ),
          },
    settings: parseOptionalExecutionPolicy(
      provider.settings,
      source,
      "providers.parallel.settings",
    ),
  };
}

function normalizeTavilyProvider(raw: unknown, source: string): Tavily {
  const provider = parseProviderObject(raw, source, "tavily");
  rejectLegacyProviderToolFields(provider, source, "tavily");
  const options = parseOptionalJsonObject(
    provider.options,
    source,
    "providers.tavily.options",
  );

  return {
    enabled: parseOptionalBoolean(
      provider.enabled,
      source,
      "providers.tavily.enabled",
    ),
    apiKey: parseOptionalString(
      provider.apiKey,
      source,
      "providers.tavily.apiKey",
    ),
    baseUrl: parseOptionalString(
      provider.baseUrl,
      source,
      "providers.tavily.baseUrl",
    ),
    options:
      options === undefined
        ? undefined
        : {
            search: parseOptionalJsonObject(
              options.search,
              source,
              "providers.tavily.options.search",
            ),
            extract: parseOptionalJsonObject(
              options.extract,
              source,
              "providers.tavily.options.extract",
            ),
            research: parseOptionalJsonObject(
              options.research,
              source,
              "providers.tavily.options.research",
            ),
          },
    settings: parseOptionalExecutionPolicy(
      provider.settings,
      source,
      "providers.tavily.settings",
    ),
  };
}

function normalizeCustomProvider(raw: unknown, source: string): Custom {
  const provider = parseProviderObject(raw, source, "custom");
  rejectLegacyProviderToolFields(provider, source, "custom");
  const options = parseOptionalJsonObject(
    provider.options,
    source,
    "providers.custom.options",
  );

  return {
    enabled: parseOptionalBoolean(
      provider.enabled,
      source,
      "providers.custom.enabled",
    ),
    options:
      options === undefined
        ? undefined
        : {
            search: parseOptionalCustomCommand(
              options.search,
              source,
              "providers.custom.options.search",
            ),
            contents: parseOptionalCustomCommand(
              options.contents,
              source,
              "providers.custom.options.contents",
            ),
            answer: parseOptionalCustomCommand(
              options.answer,
              source,
              "providers.custom.options.answer",
            ),
            research: parseOptionalCustomCommand(
              options.research,
              source,
              "providers.custom.options.research",
            ),
          },
    settings: parseOptionalExecutionPolicy(
      provider.settings,
      source,
      "providers.custom.settings",
    ),
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
  } as unknown as Record<string, unknown>;
}

function toPublicProviderConfig(
  provider:
    | Claude
    | Codex
    | Custom
    | Exa
    | Gemini
    | Perplexity
    | Parallel
    | Tavily
    | Valyu,
): Record<string, unknown> {
  return {
    ...(provider.enabled !== undefined ? { enabled: provider.enabled } : {}),
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

function parseOptionalExecutionPolicy(
  value: unknown,
  source: string,
  field: string,
): ExecutionSettings | undefined {
  if (value === undefined) {
    return undefined;
  }

  const settings = parseOptionalJsonObject(value, source, field);
  if (!settings) {
    return undefined;
  }

  const parsed: ExecutionSettings = {
    requestTimeoutMs: parseOptionalInteger(
      settings.requestTimeoutMs,
      source,
      `${field}.requestTimeoutMs`,
    ),
    retryCount: parseOptionalNonNegativeInteger(
      settings.retryCount,
      source,
      `${field}.retryCount`,
    ),
    retryDelayMs: parseOptionalInteger(
      settings.retryDelayMs,
      source,
      `${field}.retryDelayMs`,
    ),
    researchPollIntervalMs: parseOptionalInteger(
      settings.researchPollIntervalMs,
      source,
      `${field}.researchPollIntervalMs`,
    ),
    researchTimeoutMs: parseOptionalInteger(
      settings.researchTimeoutMs,
      source,
      `${field}.researchTimeoutMs`,
    ),
    researchMaxConsecutivePollErrors: parseOptionalInteger(
      settings.researchMaxConsecutivePollErrors,
      source,
      `${field}.researchMaxConsecutivePollErrors`,
    ),
  };

  return Object.values(parsed).some((entry) => entry !== undefined)
    ? parsed
    : undefined;
}

function parseSettingsConfig(value: unknown, source: string): Settings {
  if (!isPlainObject(value)) {
    throw new Error(`'settings' in ${source} must be a JSON object.`);
  }

  const parsed: Settings = {
    requestTimeoutMs: parseOptionalInteger(
      value.requestTimeoutMs,
      source,
      "settings.requestTimeoutMs",
    ),
    retryCount: parseOptionalNonNegativeInteger(
      value.retryCount,
      source,
      "settings.retryCount",
    ),
    retryDelayMs: parseOptionalInteger(
      value.retryDelayMs,
      source,
      "settings.retryDelayMs",
    ),
    researchPollIntervalMs: parseOptionalInteger(
      value.researchPollIntervalMs,
      source,
      "settings.researchPollIntervalMs",
    ),
    researchTimeoutMs: parseOptionalInteger(
      value.researchTimeoutMs,
      source,
      "settings.researchTimeoutMs",
    ),
    researchMaxConsecutivePollErrors: parseOptionalInteger(
      value.researchMaxConsecutivePollErrors,
      source,
      "settings.researchMaxConsecutivePollErrors",
    ),
    search:
      value.search !== undefined
        ? parseSearchSettings(value.search, source, "settings.search")
        : undefined,
  };

  return Object.values(parsed).some((entry) => entry !== undefined)
    ? parsed
    : {};
}

function parseProviderObject(
  raw: unknown,
  source: string,
  field: string,
): Record<string, unknown> {
  if (!isPlainObject(raw)) {
    throw new Error(`'providers.${field}' in ${source} must be a JSON object.`);
  }
  return raw;
}

function parseOptionalJsonObject(
  value: unknown,
  source: string,
  field: string,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    throw new Error(`'${field}' in ${source} must be a JSON object.`);
  }
  return value;
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
): ProviderId | null {
  if (value === null) {
    return null;
  }
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
  if (!isPlainObject(value)) {
    throw new Error(`'${field}' in ${source} must be a JSON object.`);
  }

  const parsed: SearchSettings = {
    provider: parseOptionalToolProviderId(
      value.provider,
      source,
      `${field}.provider`,
      "contents",
    ),
    maxUrls: parseOptionalInteger(value.maxUrls, source, `${field}.maxUrls`),
    ttlMs: parseOptionalInteger(value.ttlMs, source, `${field}.ttlMs`),
  };

  const unknownFields = Object.keys(value).filter(
    (key) => key !== "provider" && key !== "maxUrls" && key !== "ttlMs",
  );
  if (unknownFields.length > 0) {
    throw new Error(
      `Unknown search settings in ${source}: ${unknownFields.join(", ")}.`,
    );
  }

  return parsed;
}

function parseOptionalToolProviderId(
  value: unknown,
  source: string,
  field: string,
  tool: Tool,
): ProviderId | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const providerId = parseLiteral(value, source, field, PROVIDER_IDS);
  if (!supportsTool(providerId, tool)) {
    throw new Error(
      `'${field}' in ${source} must name a provider that supports '${tool}'.`,
    );
  }
  return providerId;
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

function inferProviderEnabled(
  config: WebProviders,
  providerId: ProviderId,
): boolean {
  return (
    Object.values(config.tools ?? {}) as Array<ProviderId | null | undefined>
  ).some((mappedProviderId) => mappedProviderId === providerId);
}

function parseOptionalCustomCommand(
  value: unknown,
  source: string,
  field: string,
): CustomCommandConfig | undefined {
  const config = parseOptionalJsonObject(value, source, field);
  if (!config) {
    return undefined;
  }

  const argv = parseOptionalStringArray(config.argv, source, `${field}.argv`);
  if (
    argv !== undefined &&
    (argv.length === 0 || argv.some((entry) => entry.trim().length === 0))
  ) {
    throw new Error(
      `'${field}.argv' in ${source} must be a non-empty array of non-empty strings.`,
    );
  }

  return {
    argv,
    cwd: parseOptionalString(config.cwd, source, `${field}.cwd`),
    env: parseOptionalStringMap(config.env, source, `${field}.env`),
  };
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

function parseOptionalNonNegativeInteger(
  value: unknown,
  source: string,
  field: string,
): number | undefined {
  if (value === undefined) return undefined;
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
