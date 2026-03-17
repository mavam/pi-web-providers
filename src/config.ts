import { execSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import {
  createDefaultLifecyclePolicy,
  createDefaultRequestPolicy,
  DEFAULT_GEMINI_RESEARCH_MAX_CONSECUTIVE_POLL_ERRORS,
} from "./execution-policy-defaults.js";
import { type ProviderToolId, supportsProviderTool } from "./provider-tools.js";
import type {
  ClaudeProviderConfig,
  CodexProviderConfig,
  ExaProviderConfig,
  ExecutionPolicyDefaults,
  GeminiProviderConfig,
  JsonObject,
  ParallelProviderConfig,
  PerplexityProviderConfig,
  ProviderId,
  ValyuProviderConfig,
  WebProvidersConfig,
} from "./types.js";

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
        policy: createDefaultRequestPolicy(),
      },
      codex: {
        enabled: true,
        tools: {
          search: true,
        },
        native: {
          networkAccessEnabled: true,
          webSearchEnabled: true,
          webSearchMode: "live",
        },
        policy: createDefaultRequestPolicy(),
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
        native: {
          type: "auto",
          contents: {
            text: true,
          },
        },
        policy: createDefaultLifecyclePolicy(),
      },
      gemini: {
        enabled: false,
        tools: {
          search: true,
          answer: true,
          research: true,
        },
        apiKey: "GOOGLE_API_KEY",
        native: {
          searchModel: "gemini-2.5-flash",
          answerModel: "gemini-2.5-flash",
          researchAgent: "deep-research-pro-preview-12-2025",
        },
        policy: createDefaultLifecyclePolicy({
          researchMaxConsecutivePollErrors:
            DEFAULT_GEMINI_RESEARCH_MAX_CONSECUTIVE_POLL_ERRORS,
        }),
      },
      perplexity: {
        enabled: false,
        tools: {
          search: true,
          answer: true,
          research: true,
        },
        apiKey: "PERPLEXITY_API_KEY",
        native: {
          answer: {
            model: "sonar",
          },
          research: {
            model: "sonar-deep-research",
          },
        },
        policy: createDefaultRequestPolicy(),
      },
      parallel: {
        enabled: false,
        tools: {
          search: true,
          contents: true,
        },
        apiKey: "PARALLEL_API_KEY",
        native: {
          search: {
            mode: "agentic",
          },
          extract: {
            excerpts: true,
            full_content: false,
          },
        },
        policy: createDefaultRequestPolicy(),
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
        native: {
          searchType: "all",
          responseLength: "short",
        },
        policy: createDefaultLifecyclePolicy(),
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
  | PerplexityProviderConfig
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
        key !== "perplexity" &&
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
  const native = parseOptionalJsonObject(
    getProviderNativeSource(provider),
    source,
    provider.native !== undefined
      ? "providers.claude.native"
      : "providers.claude.defaults",
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
    native:
      native === undefined
        ? undefined
        : {
            model: parseOptionalString(
              native.model,
              source,
              "providers.claude.native.model",
            ),
            effort: parseOptionalLiteral(
              native.effort,
              source,
              "providers.claude.native.effort",
              ["low", "medium", "high", "max"] as const,
            ),
            maxTurns: parseOptionalInteger(
              native.maxTurns,
              source,
              "providers.claude.native.maxTurns",
            ),
          },
    policy: parseOptionalExecutionPolicy(
      getProviderPolicySource(provider),
      source,
      provider.policy !== undefined
        ? "providers.claude.policy"
        : "providers.claude.defaults",
    ),
  };
}

function normalizeCodexProvider(
  raw: unknown,
  source: string,
): CodexProviderConfig {
  const provider = parseProviderObject(raw, source, "codex");
  const native = parseOptionalJsonObject(
    getProviderNativeSource(provider),
    source,
    provider.native !== undefined
      ? "providers.codex.native"
      : "providers.codex.defaults",
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
    native:
      native === undefined
        ? undefined
        : {
            model: parseOptionalString(
              native.model,
              source,
              "providers.codex.native.model",
            ),
            modelReasoningEffort: parseOptionalLiteral(
              native.modelReasoningEffort,
              source,
              "providers.codex.native.modelReasoningEffort",
              ["minimal", "low", "medium", "high", "xhigh"] as const,
            ),
            networkAccessEnabled: parseOptionalBoolean(
              native.networkAccessEnabled,
              source,
              "providers.codex.native.networkAccessEnabled",
            ),
            webSearchMode: parseOptionalLiteral(
              native.webSearchMode,
              source,
              "providers.codex.native.webSearchMode",
              ["disabled", "cached", "live"] as const,
            ),
            webSearchEnabled: parseOptionalBoolean(
              native.webSearchEnabled,
              source,
              "providers.codex.native.webSearchEnabled",
            ),
            additionalDirectories: parseOptionalStringArray(
              native.additionalDirectories,
              source,
              "providers.codex.native.additionalDirectories",
            ),
          },
    policy: parseOptionalExecutionPolicy(
      getProviderPolicySource(provider),
      source,
      provider.policy !== undefined
        ? "providers.codex.policy"
        : "providers.codex.defaults",
    ),
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
    native: parseOptionalJsonObject(
      stripPolicyFields(getProviderNativeSource(provider)),
      source,
      provider.native !== undefined
        ? "providers.exa.native"
        : "providers.exa.defaults",
    ),
    policy: parseOptionalExecutionPolicy(
      getProviderPolicySource(provider),
      source,
      provider.policy !== undefined
        ? "providers.exa.policy"
        : "providers.exa.defaults",
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
    native: parseOptionalJsonObject(
      stripPolicyFields(getProviderNativeSource(provider)),
      source,
      provider.native !== undefined
        ? "providers.valyu.native"
        : "providers.valyu.defaults",
    ),
    policy: parseOptionalExecutionPolicy(
      getProviderPolicySource(provider),
      source,
      provider.policy !== undefined
        ? "providers.valyu.policy"
        : "providers.valyu.defaults",
    ),
  };
}

function normalizeGeminiProvider(
  raw: unknown,
  source: string,
): GeminiProviderConfig {
  const provider = parseProviderObject(raw, source, "gemini");
  const native = parseOptionalJsonObject(
    stripPolicyFields(getProviderNativeSource(provider)),
    source,
    provider.native !== undefined
      ? "providers.gemini.native"
      : "providers.gemini.defaults",
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
    native:
      native === undefined
        ? undefined
        : {
            apiVersion: parseOptionalString(
              native.apiVersion,
              source,
              "providers.gemini.native.apiVersion",
            ),
            searchModel: parseOptionalString(
              native.searchModel,
              source,
              "providers.gemini.native.searchModel",
            ),
            answerModel: parseOptionalString(
              native.answerModel,
              source,
              "providers.gemini.native.answerModel",
            ),
            researchAgent: parseOptionalString(
              native.researchAgent,
              source,
              "providers.gemini.native.researchAgent",
            ),
          },
    policy: parseOptionalExecutionPolicy(
      getProviderPolicySource(provider),
      source,
      provider.policy !== undefined
        ? "providers.gemini.policy"
        : "providers.gemini.defaults",
    ),
  };
}

function normalizePerplexityProvider(
  raw: unknown,
  source: string,
): PerplexityProviderConfig {
  const provider = parseProviderObject(raw, source, "perplexity");
  const native = parseOptionalJsonObject(
    stripPolicyFields(getProviderNativeSource(provider)),
    source,
    provider.native !== undefined
      ? "providers.perplexity.native"
      : "providers.perplexity.defaults",
  );

  return {
    enabled: parseOptionalBoolean(
      provider.enabled,
      source,
      "providers.perplexity.enabled",
    ),
    tools: parseOptionalProviderTools(
      "perplexity",
      provider.tools,
      source,
      "providers.perplexity.tools",
    ) as PerplexityProviderConfig["tools"],
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
    native:
      native === undefined
        ? undefined
        : {
            search: parseOptionalJsonObject(
              native.search,
              source,
              "providers.perplexity.native.search",
            ),
            answer: parseOptionalJsonObject(
              native.answer,
              source,
              "providers.perplexity.native.answer",
            ),
            research: parseOptionalJsonObject(
              native.research,
              source,
              "providers.perplexity.native.research",
            ),
          },
    policy: parseOptionalExecutionPolicy(
      getProviderPolicySource(provider),
      source,
      provider.policy !== undefined
        ? "providers.perplexity.policy"
        : "providers.perplexity.defaults",
    ),
  };
}

function normalizeParallelProvider(
  raw: unknown,
  source: string,
): ParallelProviderConfig {
  const provider = parseProviderObject(raw, source, "parallel");
  const native = parseOptionalJsonObject(
    stripPolicyFields(getProviderNativeSource(provider)),
    source,
    provider.native !== undefined
      ? "providers.parallel.native"
      : "providers.parallel.defaults",
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
    native:
      native === undefined
        ? undefined
        : {
            search: parseOptionalJsonObject(
              native.search,
              source,
              "providers.parallel.native.search",
            ),
            extract: parseOptionalJsonObject(
              native.extract,
              source,
              "providers.parallel.native.extract",
            ),
          },
    policy: parseOptionalExecutionPolicy(
      getProviderPolicySource(provider),
      source,
      provider.policy !== undefined
        ? "providers.parallel.policy"
        : "providers.parallel.defaults",
    ),
  };
}

function getProviderNativeSource(provider: JsonObject): unknown {
  return provider.native ?? provider.defaults;
}

function getProviderPolicySource(provider: JsonObject): unknown {
  return provider.policy ?? provider.defaults;
}

function stripPolicyFields(value: unknown): JsonObject | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const {
    requestTimeoutMs: _requestTimeoutMs,
    retryCount: _retryCount,
    retryDelayMs: _retryDelayMs,
    researchPollIntervalMs: _researchPollIntervalMs,
    researchTimeoutMs: _researchTimeoutMs,
    researchMaxConsecutivePollErrors: _researchMaxConsecutivePollErrors,
    ...native
  } = value;

  return Object.keys(native).length > 0 ? native : undefined;
}

function parseOptionalExecutionPolicy(
  value: unknown,
  source: string,
  field: string,
): ExecutionPolicyDefaults | undefined {
  if (value === undefined) {
    return undefined;
  }

  const policy = parseOptionalJsonObject(value, source, field);
  if (!policy) {
    return undefined;
  }

  const parsed: ExecutionPolicyDefaults = {
    requestTimeoutMs: parseOptionalInteger(
      policy.requestTimeoutMs,
      source,
      `${field}.requestTimeoutMs`,
    ),
    retryCount: parseOptionalNonNegativeInteger(
      policy.retryCount,
      source,
      `${field}.retryCount`,
    ),
    retryDelayMs: parseOptionalInteger(
      policy.retryDelayMs,
      source,
      `${field}.retryDelayMs`,
    ),
    researchPollIntervalMs: parseOptionalInteger(
      policy.researchPollIntervalMs,
      source,
      `${field}.researchPollIntervalMs`,
    ),
    researchTimeoutMs: parseOptionalInteger(
      policy.researchTimeoutMs,
      source,
      `${field}.researchTimeoutMs`,
    ),
    researchMaxConsecutivePollErrors: parseOptionalInteger(
      policy.researchMaxConsecutivePollErrors,
      source,
      `${field}.researchMaxConsecutivePollErrors`,
    ),
  };

  return Object.values(parsed).some((entry) => entry !== undefined)
    ? parsed
    : undefined;
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
    if (!supportsProviderTool(providerId, key as ProviderToolId)) {
      throw new Error(`Unknown tools for ${providerId} in ${source}: ${key}.`);
    }
    parsed[key as ProviderToolId] = parseBoolean(
      entry,
      source,
      `${field}.${key}`,
    );
  }

  return parsed;
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

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
