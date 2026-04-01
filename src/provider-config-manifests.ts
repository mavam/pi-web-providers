import type {
  Claude,
  ClaudeOptions,
  Cloudflare,
  Codex,
  CodexOptions,
  Custom,
  CustomOptions,
  Exa,
  ExecutionSettings,
  Gemini,
  GeminiOptions,
  Parallel,
  ParallelOptions,
  Perplexity,
  ProviderId,
  Valyu,
} from "./types.js";

export interface ProviderTextSettingDescriptor<TConfig> {
  id: string;
  kind: "text";
  label: string;
  help: string;
  secret?: boolean;
  getValue: (config: TConfig | undefined) => string | undefined;
  setValue: (config: TConfig, value: string) => void;
}

export interface ProviderValuesSettingDescriptor<TConfig> {
  id: string;
  kind: "values";
  label: string;
  help: string;
  values: string[];
  getValue: (config: TConfig | undefined) => string;
  setValue: (config: TConfig, value: string) => void;
}

export type ProviderSettingDescriptor<TConfig> =
  | ProviderTextSettingDescriptor<TConfig>
  | ProviderValuesSettingDescriptor<TConfig>;

export const PROVIDER_CONFIG_MANIFESTS = {
  claude: {
    settings: [
      stringSetting<Claude>({
        id: "model",
        label: "Model",
        help: "Optional Claude model override. Leave empty to use the local default.",
        getValue: (config) => getClaudeOptions(config)?.model,
        setValue: (config, value) => {
          assignOptionalString(ensureClaudeOptions(config), "model", value);
          cleanupEmpty(config, "options");
        },
      }),
      valuesSetting<Claude>({
        id: "claudeEffort",
        label: "Effort",
        help: "How much effort Claude should use. 'default' uses the SDK default.",
        values: ["default", "low", "medium", "high", "max"],
        getValue: (config) => getClaudeOptions(config)?.effort ?? "default",
        setValue: (config, value) => {
          const options = ensureClaudeOptions(config);
          if (value === "default") {
            delete options.effort;
          } else {
            options.effort = value as ClaudeOptions["effort"];
          }
          cleanupEmpty(config, "options");
        },
      }),
      stringSetting<Claude>({
        id: "claudeMaxTurns",
        label: "Max turns",
        help: "Optional maximum number of Claude turns. Leave empty to use the SDK default.",
        getValue: (config) =>
          getIntegerString(getClaudeOptions(config)?.maxTurns),
        setValue: (config, value) => {
          assignOptionalInteger(
            ensureClaudeOptions(config) as Record<
              string,
              number | string | boolean | Record<string, unknown> | undefined
            >,
            "maxTurns",
            value,
            "Claude max turns must be a positive integer.",
          );
          cleanupEmpty(config, "options");
        },
      }),
      stringSetting<Claude>({
        id: "claudePathToExecutable",
        label: "Executable path",
        help: "Optional path to the Claude Code executable. Leave empty to use the bundled/default executable.",
        getValue: (config) => config?.pathToClaudeCodeExecutable,
        setValue: (config, value) => {
          assignOptionalString(
            config as Record<
              string,
              string | number | boolean | Record<string, unknown> | undefined
            >,
            "pathToClaudeCodeExecutable",
            value,
          );
        },
      }),
    ],
  },
  cloudflare: {
    settings: [
      stringSetting<Cloudflare>({
        id: "apiToken",
        label: "API token",
        help: "Cloudflare API token for Browser Rendering. The token needs the permission `Account | Browser Rendering | Edit`. You can use a literal value, an env var name like CLOUDFLARE_API_TOKEN, or !command.",
        secret: true,
        getValue: (config) => config?.apiToken,
        setValue: (config, value) => {
          assignOptionalString(
            config as Record<
              string,
              string | number | boolean | Record<string, unknown> | undefined
            >,
            "apiToken",
            value,
          );
        },
      }),
      stringSetting<Cloudflare>({
        id: "accountId",
        label: "Account ID",
        help: "Cloudflare account ID for the same account the token is scoped to. You can use a literal value, an env var name like CLOUDFLARE_ACCOUNT_ID, or !command.",
        getValue: (config) => config?.accountId,
        setValue: (config, value) => {
          assignOptionalString(
            config as Record<
              string,
              string | number | boolean | Record<string, unknown> | undefined
            >,
            "accountId",
            value,
          );
        },
      }),
      ...requestSettings<Cloudflare>(),
    ],
  },
  codex: {
    settings: [
      stringSetting<Codex>({
        id: "model",
        label: "Model",
        help: "Optional Codex model override. Leave empty to use the local default.",
        getValue: (config) => getCodexOptions(config)?.model,
        setValue: (config, value) => {
          assignOptionalString(
            ensureCodexOptions(config) as Record<
              string,
              string | number | boolean | Record<string, unknown> | undefined
            >,
            "model",
            value,
          );
          cleanupEmpty(config, "options");
        },
      }),
      valuesSetting<Codex>({
        id: "modelReasoningEffort",
        label: "Reasoning effort",
        help: "Reasoning depth for Codex. 'default' uses the SDK default.",
        values: ["default", "minimal", "low", "medium", "high", "xhigh"],
        getValue: (config) =>
          getCodexOptions(config)?.modelReasoningEffort ?? "default",
        setValue: (config, value) => {
          const options = ensureCodexOptions(config);
          if (value === "default") {
            delete options.modelReasoningEffort;
          } else {
            options.modelReasoningEffort =
              value as CodexOptions["modelReasoningEffort"];
          }
          cleanupEmpty(config, "options");
        },
      }),
      valuesSetting<Codex>({
        id: "webSearchMode",
        label: "Web search mode",
        help: "How Codex should source web results. 'default' currently behaves like 'live'.",
        values: ["default", "disabled", "cached", "live"],
        getValue: (config) =>
          getCodexOptions(config)?.webSearchMode ?? "default",
        setValue: (config, value) => {
          const options = ensureCodexOptions(config);
          if (value === "default") {
            delete options.webSearchMode;
          } else {
            options.webSearchMode = value as CodexOptions["webSearchMode"];
          }
          cleanupEmpty(config, "options");
        },
      }),
      valuesSetting<Codex>({
        id: "networkAccessEnabled",
        label: "Network access",
        help: "Allow Codex network access during search runs. 'default' currently behaves like 'true'.",
        values: ["default", "true", "false"],
        getValue: (config) =>
          getBooleanValue(getCodexOptions(config)?.networkAccessEnabled),
        setValue: (config, value) => {
          assignOptionalBoolean(
            ensureCodexOptions(config) as Record<string, unknown>,
            "networkAccessEnabled",
            value,
          );
          cleanupEmpty(config, "options");
        },
      }),
      valuesSetting<Codex>({
        id: "webSearchEnabled",
        label: "Web search",
        help: "Enable Codex web search. 'default' currently behaves like 'true'.",
        values: ["default", "true", "false"],
        getValue: (config) =>
          getBooleanValue(getCodexOptions(config)?.webSearchEnabled),
        setValue: (config, value) => {
          assignOptionalBoolean(
            ensureCodexOptions(config) as Record<string, unknown>,
            "webSearchEnabled",
            value,
          );
          cleanupEmpty(config, "options");
        },
      }),
      stringSetting<Codex>({
        id: "additionalDirectories",
        label: "Additional dirs",
        help: "Optional comma-separated directories that Codex may read in addition to the current working directory.",
        getValue: (config) =>
          getCodexOptions(config)?.additionalDirectories?.join(", "),
        setValue: (config, value) => {
          const options = ensureCodexOptions(config);
          const trimmed = value.trim();
          if (!trimmed) {
            delete options.additionalDirectories;
          } else {
            options.additionalDirectories = trimmed
              .split(",")
              .map((entry) => entry.trim())
              .filter((entry) => entry.length > 0);
          }
          cleanupEmpty(config, "options");
        },
      }),
    ],
  },
  custom: {
    settings: [
      stringSetting<Custom>({
        id: "customSearchArgv",
        label: "Search argv",
        help: `Optional JSON string array for the command to run for web_search, for example ["node","./scripts/codex-search.mjs"].`,
        getValue: (config) =>
          getCustomOptions(config)?.search?.argv
            ? JSON.stringify(getCustomOptions(config)?.search?.argv)
            : undefined,
        setValue: (config, value) => {
          setCustomArgv(config, "search", value);
        },
      }),
      stringSetting<Custom>({
        id: "customSearchCwd",
        label: "Search cwd",
        help: "Optional working directory for the web_search command. Relative paths resolve from the active project directory.",
        getValue: (config) => getCustomOptions(config)?.search?.cwd,
        setValue: (config, value) => {
          setCustomCwd(config, "search", value);
        },
      }),
      stringSetting<Custom>({
        id: "customSearchEnv",
        label: "Search env",
        help: "Optional JSON object of string environment variables for the web_search command. Values can be literal strings, env var names, or !command.",
        getValue: (config) =>
          formatCustomEnv(getCustomOptions(config)?.search?.env),
        setValue: (config, value) => {
          setCustomEnv(config, "search", value);
        },
      }),
      stringSetting<Custom>({
        id: "customContentsArgv",
        label: "Contents argv",
        help: "Optional JSON string array for the command to run for web_contents.",
        getValue: (config) =>
          getCustomOptions(config)?.contents?.argv
            ? JSON.stringify(getCustomOptions(config)?.contents?.argv)
            : undefined,
        setValue: (config, value) => {
          setCustomArgv(config, "contents", value);
        },
      }),
      stringSetting<Custom>({
        id: "customContentsCwd",
        label: "Contents cwd",
        help: "Optional working directory for the web_contents command. Relative paths resolve from the active project directory.",
        getValue: (config) => getCustomOptions(config)?.contents?.cwd,
        setValue: (config, value) => {
          setCustomCwd(config, "contents", value);
        },
      }),
      stringSetting<Custom>({
        id: "customContentsEnv",
        label: "Contents env",
        help: "Optional JSON object of string environment variables for the web_contents command. Values can be literal strings, env var names, or !command.",
        getValue: (config) =>
          formatCustomEnv(getCustomOptions(config)?.contents?.env),
        setValue: (config, value) => {
          setCustomEnv(config, "contents", value);
        },
      }),
      stringSetting<Custom>({
        id: "customAnswerArgv",
        label: "Answer argv",
        help: "Optional JSON string array for the command to run for web_answer.",
        getValue: (config) =>
          getCustomOptions(config)?.answer?.argv
            ? JSON.stringify(getCustomOptions(config)?.answer?.argv)
            : undefined,
        setValue: (config, value) => {
          setCustomArgv(config, "answer", value);
        },
      }),
      stringSetting<Custom>({
        id: "customAnswerCwd",
        label: "Answer cwd",
        help: "Optional working directory for the web_answer command. Relative paths resolve from the active project directory.",
        getValue: (config) => getCustomOptions(config)?.answer?.cwd,
        setValue: (config, value) => {
          setCustomCwd(config, "answer", value);
        },
      }),
      stringSetting<Custom>({
        id: "customAnswerEnv",
        label: "Answer env",
        help: "Optional JSON object of string environment variables for the web_answer command. Values can be literal strings, env var names, or !command.",
        getValue: (config) =>
          formatCustomEnv(getCustomOptions(config)?.answer?.env),
        setValue: (config, value) => {
          setCustomEnv(config, "answer", value);
        },
      }),
      stringSetting<Custom>({
        id: "customResearchArgv",
        label: "Research argv",
        help: "Optional JSON string array for the command to run for web_research.",
        getValue: (config) =>
          getCustomOptions(config)?.research?.argv
            ? JSON.stringify(getCustomOptions(config)?.research?.argv)
            : undefined,
        setValue: (config, value) => {
          setCustomArgv(config, "research", value);
        },
      }),
      stringSetting<Custom>({
        id: "customResearchCwd",
        label: "Research cwd",
        help: "Optional working directory for the web_research command. Relative paths resolve from the active project directory.",
        getValue: (config) => getCustomOptions(config)?.research?.cwd,
        setValue: (config, value) => {
          setCustomCwd(config, "research", value);
        },
      }),
      stringSetting<Custom>({
        id: "customResearchEnv",
        label: "Research env",
        help: "Optional JSON object of string environment variables for the web_research command. Values can be literal strings, env var names, or !command.",
        getValue: (config) =>
          formatCustomEnv(getCustomOptions(config)?.research?.env),
        setValue: (config, value) => {
          setCustomEnv(config, "research", value);
        },
      }),
      ...requestSettings<Custom>(),
    ],
  },
  exa: {
    settings: [
      apiKeySetting<Exa>(),
      baseUrlSetting<Exa>(),
      valuesSetting<Exa>({
        id: "exaSearchType",
        label: "Search type",
        help: "Exa search mode. 'default' uses the SDK default.",
        values: [
          "default",
          "keyword",
          "neural",
          "auto",
          "hybrid",
          "fast",
          "instant",
          "deep",
          "deep-reasoning",
          "deep-max",
        ],
        getValue: (config) =>
          readString(getExaOptions(config)?.type) ?? "default",
        setValue: (config, value) => {
          const options = ensureExaOptions(config);
          if (value === "default") {
            delete options.type;
          } else {
            options.type = value;
          }
          cleanupEmpty(config, "options");
        },
      }),
      valuesSetting<Exa>({
        id: "exaTextContents",
        label: "Text contents",
        help: "Whether Exa should include text contents in search results. 'default' uses the SDK default.",
        values: ["default", "true", "false"],
        getValue: (config) => {
          const contents = asJsonObject(getExaOptions(config)?.contents);
          return typeof contents?.text === "boolean"
            ? String(contents.text)
            : "default";
        },
        setValue: (config, value) => {
          const options = ensureExaOptions(config);
          const contents = asJsonObject(options.contents) ?? {};
          if (value === "default") {
            delete contents.text;
          } else {
            contents.text = value === "true";
          }
          if (Object.keys(contents).length === 0) {
            delete options.contents;
          } else {
            options.contents = contents;
          }
          cleanupEmpty(config, "options");
        },
      }),
    ],
  },
  gemini: {
    settings: [
      apiKeySetting<Gemini>(),
      valuesSetting<Gemini>({
        id: "geminiApiVersion",
        label: "API version",
        help: "Gemini API version. 'default' uses the SDK default beta endpoints.",
        values: ["default", "v1alpha", "v1beta", "v1"],
        getValue: (config) => getGeminiOptions(config)?.apiVersion ?? "default",
        setValue: (config, value) => {
          const options = ensureGeminiOptions(config);
          if (value === "default") {
            delete options.apiVersion;
          } else {
            options.apiVersion = value;
          }
          cleanupEmpty(config, "options");
        },
      }),
      stringSetting<Gemini>({
        id: "geminiSearchModel",
        label: "Search model",
        help: "Model used for Gemini search interactions.",
        getValue: (config) => getGeminiOptions(config)?.searchModel,
        setValue: (config, value) => {
          assignOptionalString(
            ensureGeminiOptions(config),
            "searchModel",
            value,
          );
          cleanupEmpty(config, "options");
        },
      }),
      stringSetting<Gemini>({
        id: "geminiAnswerModel",
        label: "Answer model",
        help: "Model used for grounded Gemini answers.",
        getValue: (config) => getGeminiOptions(config)?.answerModel,
        setValue: (config, value) => {
          assignOptionalString(
            ensureGeminiOptions(config),
            "answerModel",
            value,
          );
          cleanupEmpty(config, "options");
        },
      }),
      stringSetting<Gemini>({
        id: "geminiResearchAgent",
        label: "Research agent",
        help: "Agent used for Gemini deep research runs.",
        getValue: (config) => getGeminiOptions(config)?.researchAgent,
        setValue: (config, value) => {
          assignOptionalString(
            ensureGeminiOptions(config),
            "researchAgent",
            value,
          );
          cleanupEmpty(config, "options");
        },
      }),
    ],
  },
  perplexity: {
    settings: [apiKeySetting<Perplexity>(), baseUrlSetting<Perplexity>()],
  },
  parallel: {
    settings: [
      apiKeySetting<Parallel>(),
      baseUrlSetting<Parallel>(),
      valuesSetting<Parallel>({
        id: "parallelSearchMode",
        label: "Search mode",
        help: "Parallel search mode. 'default' uses the SDK default.",
        values: ["default", "agentic", "one-shot"],
        getValue: (config) =>
          readString(getParallelOptions(config)?.search?.mode) ?? "default",
        setValue: (config, value) => {
          const options = ensureParallelOptions(config);
          options.search = asJsonObject(options.search) ?? {};
          if (value === "default") {
            delete options.search.mode;
          } else {
            options.search.mode = value;
          }
          cleanupNestedObjects(config);
        },
      }),
      valuesSetting<Parallel>({
        id: "parallelExtractExcerpts",
        label: "Extract excerpts",
        help: "Include excerpts in Parallel extraction results. 'default' uses the SDK default.",
        values: ["default", "on", "off"],
        getValue: (config) => {
          const value = getParallelOptions(config)?.extract?.excerpts;
          return typeof value === "boolean"
            ? value
              ? "on"
              : "off"
            : "default";
        },
        setValue: (config, value) => {
          const options = ensureParallelOptions(config);
          options.extract = asJsonObject(options.extract) ?? {};
          if (value === "default") {
            delete options.extract.excerpts;
          } else {
            options.extract.excerpts = value === "on";
          }
          cleanupNestedObjects(config);
        },
      }),
      valuesSetting<Parallel>({
        id: "parallelExtractFullContent",
        label: "Extract full content",
        help: "Include full page content in Parallel extraction results. 'default' uses the SDK default.",
        values: ["default", "on", "off"],
        getValue: (config) => {
          const value = getParallelOptions(config)?.extract?.full_content;
          return typeof value === "boolean"
            ? value
              ? "on"
              : "off"
            : "default";
        },
        setValue: (config, value) => {
          const options = ensureParallelOptions(config);
          options.extract = asJsonObject(options.extract) ?? {};
          if (value === "default") {
            delete options.extract.full_content;
          } else {
            options.extract.full_content = value === "on";
          }
          cleanupNestedObjects(config);
        },
      }),
    ],
  },
  valyu: {
    settings: [
      apiKeySetting<Valyu>(),
      baseUrlSetting<Valyu>(),
      valuesSetting<Valyu>({
        id: "valyuSearchType",
        label: "Search type",
        help: "Valyu search type. 'default' uses the SDK default.",
        values: ["default", "all", "web", "proprietary", "news"],
        getValue: (config) =>
          readString(getValyuOptions(config)?.searchType) ?? "default",
        setValue: (config, value) => {
          const options = ensureValyuOptions(config);
          if (value === "default") {
            delete options.searchType;
          } else {
            options.searchType = value;
          }
          cleanupEmpty(config, "options");
        },
      }),
      valuesSetting<Valyu>({
        id: "valyuResponseLength",
        label: "Response length",
        help: "Valyu response length. 'default' uses the SDK default.",
        values: ["default", "short", "medium", "large", "max"],
        getValue: (config) =>
          readString(getValyuOptions(config)?.responseLength) ?? "default",
        setValue: (config, value) => {
          const options = ensureValyuOptions(config);
          if (value === "default") {
            delete options.responseLength;
          } else {
            options.responseLength = value;
          }
          cleanupEmpty(config, "options");
        },
      }),
    ],
  },
} as const;

export function getProviderConfigManifest(providerId: ProviderId) {
  return PROVIDER_CONFIG_MANIFESTS[providerId];
}

function stringSetting<TConfig>(
  setting: Omit<ProviderTextSettingDescriptor<TConfig>, "kind">,
): ProviderTextSettingDescriptor<TConfig> {
  return {
    kind: "text",
    ...setting,
  };
}

function valuesSetting<TConfig>(
  setting: Omit<ProviderValuesSettingDescriptor<TConfig>, "kind">,
): ProviderValuesSettingDescriptor<TConfig> {
  return {
    kind: "values",
    ...setting,
  };
}

function apiKeySetting<TConfig extends { apiKey?: string }>() {
  return stringSetting<TConfig>({
    id: "apiKey",
    label: "API key",
    help: "Provider API key. You can use a literal value, an env var name like EXA_API_KEY, or !command.",
    secret: true,
    getValue: (config) => config?.apiKey,
    setValue: (config, value) => {
      assignOptionalString(
        config as Record<
          string,
          string | number | boolean | Record<string, unknown> | undefined
        >,
        "apiKey",
        value,
      );
    },
  });
}

function baseUrlSetting<TConfig extends { baseUrl?: string }>() {
  return stringSetting<TConfig>({
    id: "baseUrl",
    label: "Base URL",
    help: "Optional API base URL override.",
    getValue: (config) => config?.baseUrl,
    setValue: (config, value) => {
      assignOptionalString(
        config as Record<
          string,
          string | number | boolean | Record<string, unknown> | undefined
        >,
        "baseUrl",
        value,
      );
    },
  });
}

function requestSettings<TConfig extends { settings?: ExecutionSettings }>() {
  return [
    stringSetting<TConfig>({
      id: "requestTimeoutMs",
      label: "Request timeout (ms)",
      help: "Maximum time to wait for each command before failing that attempt for this provider. Leave empty to inherit the shared setting.",
      getValue: (config) =>
        getIntegerString(config?.settings?.requestTimeoutMs),
      setValue: (config, value) => {
        assignOptionalInteger(
          ensureSettings(config),
          "requestTimeoutMs",
          value,
          "Request timeout must be a positive integer.",
        );
        cleanupEmpty(config, "settings");
      },
    }),
    stringSetting<TConfig>({
      id: "retryCount",
      label: "Retry count",
      help: "How many times to retry transient command failures for this provider. Leave empty to inherit the shared setting.",
      getValue: (config) => getIntegerString(config?.settings?.retryCount),
      setValue: (config, value) => {
        assignOptionalInteger(
          ensureSettings(config),
          "retryCount",
          value,
          "Retry count must be a non-negative integer.",
          { allowZero: true },
        );
        cleanupEmpty(config, "settings");
      },
    }),
    stringSetting<TConfig>({
      id: "retryDelayMs",
      label: "Retry delay (ms)",
      help: "Initial delay before retrying command failures for this provider. Leave empty to inherit the shared setting.",
      getValue: (config) => getIntegerString(config?.settings?.retryDelayMs),
      setValue: (config, value) => {
        assignOptionalInteger(
          ensureSettings(config),
          "retryDelayMs",
          value,
          "Retry delay must be a positive integer.",
        );
        cleanupEmpty(config, "settings");
      },
    }),
    stringSetting<TConfig>({
      id: "researchTimeoutMs",
      label: "Research timeout (ms)",
      help: "Maximum total time to allow long-running web research for this provider before aborting it. Leave empty to inherit the shared setting.",
      getValue: (config) =>
        getIntegerString(config?.settings?.researchTimeoutMs),
      setValue: (config, value) => {
        assignOptionalInteger(
          ensureSettings(config),
          "researchTimeoutMs",
          value,
          "Research timeout must be a positive integer.",
        );
        cleanupEmpty(config, "settings");
      },
    }),
  ] as const;
}

function assignOptionalString(
  target: Record<
    string,
    string | number | boolean | Record<string, unknown> | undefined
  >,
  key: string,
  value: string,
): void {
  const trimmed = value.trim();
  if (!trimmed) {
    delete target[key];
  } else {
    target[key] = trimmed;
  }
}

function assignOptionalInteger(
  target: Record<
    string,
    string | number | boolean | Record<string, unknown> | undefined
  >,
  key: string,
  value: string,
  errorMessage: string,
  options?: { allowZero?: boolean },
): void {
  const trimmed = value.trim();
  if (!trimmed) {
    delete target[key];
    return;
  }

  const parsed = Number(trimmed);
  const minimum = options?.allowZero ? 0 : 1;
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(errorMessage);
  }

  target[key] = parsed;
}

function assignOptionalBoolean(
  target: Record<string, unknown>,
  key: string,
  value: string,
): void {
  if (value === "default") {
    delete target[key];
  } else {
    target[key] = value === "true";
  }
}

function getIntegerString(value: number | undefined): string | undefined {
  return typeof value === "number" ? String(value) : undefined;
}

function getBooleanValue(value: boolean | undefined): string {
  return typeof value === "boolean" ? String(value) : "default";
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asJsonObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function ensureSettings<TConfig extends { settings?: ExecutionSettings }>(
  config: TConfig,
): Record<
  string,
  string | number | boolean | Record<string, unknown> | undefined
> {
  config.settings = { ...(config.settings ?? {}) };
  return config.settings as Record<
    string,
    string | number | boolean | Record<string, unknown> | undefined
  >;
}

function cleanupEmpty<TConfig extends object>(
  config: TConfig,
  key: "options" | "settings",
): void {
  const value = asJsonObject((config as Record<string, unknown>)[key]);
  if (value && Object.keys(value).length === 0) {
    delete (config as Record<string, unknown>)[key];
  }
}

function cleanupNestedObjects(config: Parallel): void {
  const options = config.options;
  if (!options) {
    return;
  }
  if (options.search && Object.keys(options.search).length === 0) {
    delete options.search;
  }
  if (options.extract && Object.keys(options.extract).length === 0) {
    delete options.extract;
  }
  cleanupEmpty(config, "options");
}

function getClaudeOptions(config: Claude | undefined) {
  return config?.options;
}

function ensureClaudeOptions(
  config: Claude,
): Record<
  string,
  string | number | boolean | Record<string, unknown> | undefined
> {
  config.options = { ...(config.options ?? {}) };
  return config.options as Record<
    string,
    string | number | boolean | Record<string, unknown> | undefined
  >;
}

function getCodexOptions(config: Codex | undefined) {
  return config?.options;
}

function ensureCodexOptions(config: Codex): CodexOptions {
  config.options = { ...(config.options ?? {}) };
  return config.options;
}

function getGeminiOptions(config: Gemini | undefined) {
  return config?.options;
}

function ensureGeminiOptions(
  config: Gemini,
): Record<
  string,
  string | number | boolean | Record<string, unknown> | undefined
> {
  config.options = { ...(config.options ?? {}) };
  return config.options as Record<
    string,
    string | number | boolean | Record<string, unknown> | undefined
  >;
}

function getCustomOptions(config: Custom | undefined) {
  return config?.options;
}

function ensureCustomOptions(config: Custom): CustomOptions {
  const options = getCustomOptions(config);
  config.options = {
    ...(options?.search ? { search: { ...options.search } } : {}),
    ...(options?.contents ? { contents: { ...options.contents } } : {}),
    ...(options?.answer ? { answer: { ...options.answer } } : {}),
    ...(options?.research ? { research: { ...options.research } } : {}),
  };
  return config.options;
}

function formatCustomEnv(
  env: Record<string, string> | undefined,
): string | undefined {
  return env ? JSON.stringify(env) : undefined;
}

function setCustomArgv(
  config: Custom,
  capability: keyof CustomOptions,
  value: string,
): void {
  const trimmed = value.trim();
  const options = ensureCustomOptions(config);
  if (!trimmed) {
    delete options[capability];
    cleanupCustomOptions(config);
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(
      `Custom ${capability} argv must be a JSON string array: ${(error as Error).message}`,
    );
  }

  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.some(
      (entry) => typeof entry !== "string" || entry.trim().length === 0,
    )
  ) {
    throw new Error(
      `Custom ${capability} argv must be a non-empty JSON string array.`,
    );
  }

  options[capability] = {
    ...(options[capability] ?? {}),
    argv: parsed,
  };
  cleanupCustomOptions(config);
}

function setCustomCwd(
  config: Custom,
  capability: keyof CustomOptions,
  value: string,
): void {
  const options = ensureCustomOptions(config);
  const command = { ...(options[capability] ?? {}) };
  assignOptionalString(
    command as Record<
      string,
      string | number | boolean | Record<string, unknown> | undefined
    >,
    "cwd",
    value,
  );
  options[capability] = command;
  cleanupCustomOptions(config);
}

function setCustomEnv(
  config: Custom,
  capability: keyof CustomOptions,
  value: string,
): void {
  const trimmed = value.trim();
  const options = ensureCustomOptions(config);
  const command = { ...(options[capability] ?? {}) };

  if (!trimmed) {
    delete command.env;
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(
        `Custom ${capability} env must be a JSON object of strings: ${(error as Error).message}`,
      );
    }

    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      Object.values(parsed).some((entry) => typeof entry !== "string")
    ) {
      throw new Error(
        `Custom ${capability} env must be a JSON object of strings.`,
      );
    }

    command.env = parsed as Record<string, string>;
  }

  options[capability] = command;
  cleanupCustomOptions(config);
}

function cleanupCustomOptions(config: Custom): void {
  const options = config.options;
  if (!options) {
    return;
  }

  for (const capability of [
    "search",
    "contents",
    "answer",
    "research",
  ] as const) {
    const entry = options[capability];
    if (!entry) {
      continue;
    }

    if (
      entry.argv === undefined &&
      entry.cwd === undefined &&
      (entry.env === undefined || Object.keys(entry.env).length === 0)
    ) {
      delete options[capability];
    }
  }

  cleanupEmpty(config, "options");
}

function getParallelOptions(config: Parallel | undefined) {
  return config?.options;
}

function ensureParallelOptions(config: Parallel): ParallelOptions {
  const search = asJsonObject(config.options?.search);
  const extract = asJsonObject(config.options?.extract);
  config.options = {
    ...(search ? { search } : {}),
    ...(extract ? { extract } : {}),
  };
  return config.options;
}

function getExaOptions(config: Exa | undefined) {
  return config?.options;
}

function ensureExaOptions(config: Exa): Record<string, unknown> {
  config.options = { ...(config.options ?? {}) };
  return config.options;
}

function getValyuOptions(config: Valyu | undefined) {
  return config?.options;
}

function ensureValyuOptions(config: Valyu): Record<string, unknown> {
  config.options = { ...(config.options ?? {}) };
  return config.options;
}
