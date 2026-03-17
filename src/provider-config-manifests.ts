import type {
  ClaudeProviderConfig,
  ClaudeProviderNativeConfig,
  CodexProviderConfig,
  CodexProviderNativeConfig,
  CustomCliProviderConfig,
  CustomCliProviderNativeConfig,
  ExaProviderConfig,
  ExecutionPolicyDefaults,
  GeminiProviderConfig,
  GeminiProviderNativeConfig,
  JsonObject,
  ParallelProviderConfig,
  ParallelProviderNativeConfig,
  PerplexityProviderConfig,
  ProviderId,
  ValyuProviderConfig,
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
      stringSetting<ClaudeProviderConfig>({
        id: "model",
        label: "Model",
        help: "Optional Claude model override. Leave empty to use the local default.",
        getValue: (config) => getClaudeNative(config)?.model,
        setValue: (config, value) => {
          assignOptionalString(ensureClaudeNative(config), "model", value);
          cleanupEmpty(config, "native");
        },
      }),
      valuesSetting<ClaudeProviderConfig>({
        id: "claudeEffort",
        label: "Effort",
        help: "How much effort Claude should use. 'default' uses the SDK default.",
        values: ["default", "low", "medium", "high", "max"],
        getValue: (config) => getClaudeNative(config)?.effort ?? "default",
        setValue: (config, value) => {
          const native = ensureClaudeNative(config);
          if (value === "default") {
            delete native.effort;
          } else {
            native.effort = value as ClaudeProviderNativeConfig["effort"];
          }
          cleanupEmpty(config, "native");
        },
      }),
      integerSetting<ClaudeProviderConfig>({
        id: "claudeMaxTurns",
        label: "Max turns",
        help: "Optional maximum number of Claude turns. Leave empty to use the SDK default.",
        minimum: 1,
        errorMessage: "Claude max turns must be a positive integer.",
        getValue: (config) =>
          getIntegerString(getClaudeNative(config)?.maxTurns),
        setValue: (config, value) => {
          assignOptionalInteger(
            ensureClaudeNative(config) as Record<
              string,
              number | string | boolean | JsonObject | undefined
            >,
            "maxTurns",
            value,
            "Claude max turns must be a positive integer.",
          );
          cleanupEmpty(config, "native");
        },
      }),
      stringSetting<ClaudeProviderConfig>({
        id: "claudePathToExecutable",
        label: "Executable path",
        help: "Optional path to the Claude Code executable. Leave empty to use the bundled/default executable.",
        getValue: (config) => config?.pathToClaudeCodeExecutable,
        setValue: (config, value) => {
          assignOptionalString(
            config as Record<
              string,
              string | number | boolean | JsonObject | undefined
            >,
            "pathToClaudeCodeExecutable",
            value,
          );
        },
      }),
    ],
  },
  codex: {
    settings: [
      stringSetting<CodexProviderConfig>({
        id: "model",
        label: "Model",
        help: "Optional Codex model override. Leave empty to use the local default.",
        getValue: (config) => getCodexNative(config)?.model,
        setValue: (config, value) => {
          assignOptionalString(
            ensureCodexNative(config) as Record<
              string,
              string | number | boolean | JsonObject | undefined
            >,
            "model",
            value,
          );
          cleanupEmpty(config, "native");
        },
      }),
      valuesSetting<CodexProviderConfig>({
        id: "modelReasoningEffort",
        label: "Reasoning effort",
        help: "Reasoning depth for Codex. 'default' uses the SDK default.",
        values: ["default", "minimal", "low", "medium", "high", "xhigh"],
        getValue: (config) =>
          getCodexNative(config)?.modelReasoningEffort ?? "default",
        setValue: (config, value) => {
          const native = ensureCodexNative(config);
          if (value === "default") {
            delete native.modelReasoningEffort;
          } else {
            native.modelReasoningEffort =
              value as CodexProviderNativeConfig["modelReasoningEffort"];
          }
          cleanupEmpty(config, "native");
        },
      }),
      valuesSetting<CodexProviderConfig>({
        id: "webSearchMode",
        label: "Web search mode",
        help: "How Codex should source web results. 'default' currently behaves like 'live'.",
        values: ["default", "disabled", "cached", "live"],
        getValue: (config) =>
          getCodexNative(config)?.webSearchMode ?? "default",
        setValue: (config, value) => {
          const native = ensureCodexNative(config);
          if (value === "default") {
            delete native.webSearchMode;
          } else {
            native.webSearchMode =
              value as CodexProviderNativeConfig["webSearchMode"];
          }
          cleanupEmpty(config, "native");
        },
      }),
      valuesSetting<CodexProviderConfig>({
        id: "networkAccessEnabled",
        label: "Network access",
        help: "Allow Codex network access during search runs. 'default' currently behaves like 'true'.",
        values: ["default", "true", "false"],
        getValue: (config) =>
          getBooleanValue(getCodexNative(config)?.networkAccessEnabled),
        setValue: (config, value) => {
          assignOptionalBoolean(
            ensureCodexNative(config) as Record<string, unknown>,
            "networkAccessEnabled",
            value,
          );
          cleanupEmpty(config, "native");
        },
      }),
      valuesSetting<CodexProviderConfig>({
        id: "webSearchEnabled",
        label: "Web search",
        help: "Enable Codex web search. 'default' currently behaves like 'true'.",
        values: ["default", "true", "false"],
        getValue: (config) =>
          getBooleanValue(getCodexNative(config)?.webSearchEnabled),
        setValue: (config, value) => {
          assignOptionalBoolean(
            ensureCodexNative(config) as Record<string, unknown>,
            "webSearchEnabled",
            value,
          );
          cleanupEmpty(config, "native");
        },
      }),
      stringSetting<CodexProviderConfig>({
        id: "additionalDirectories",
        label: "Additional dirs",
        help: "Optional comma-separated directories that Codex may read in addition to the current working directory.",
        getValue: (config) =>
          getCodexNative(config)?.additionalDirectories?.join(", "),
        setValue: (config, value) => {
          const native = ensureCodexNative(config);
          const trimmed = value.trim();
          if (!trimmed) {
            delete native.additionalDirectories;
          } else {
            native.additionalDirectories = trimmed
              .split(",")
              .map((entry) => entry.trim())
              .filter((entry) => entry.length > 0);
          }
          cleanupEmpty(config, "native");
        },
      }),
    ],
  },
  "custom-cli": {
    settings: [
      jsonArraySetting<CustomCliProviderConfig>({
        id: "customCliSearchArgv",
        label: "Search argv",
        help: `Optional JSON string array for the command to run for web_search, for example ["node","./scripts/codex-search.mjs"].`,
        getValue: (config) =>
          getCustomCliNative(config)?.search?.argv
            ? JSON.stringify(getCustomCliNative(config)?.search?.argv)
            : undefined,
        setValue: (config, value) => {
          setCustomCliArgv(config, "search", value);
        },
      }),
      jsonArraySetting<CustomCliProviderConfig>({
        id: "customCliContentsArgv",
        label: "Contents argv",
        help: "Optional JSON string array for the command to run for web_contents.",
        getValue: (config) =>
          getCustomCliNative(config)?.contents?.argv
            ? JSON.stringify(getCustomCliNative(config)?.contents?.argv)
            : undefined,
        setValue: (config, value) => {
          setCustomCliArgv(config, "contents", value);
        },
      }),
      jsonArraySetting<CustomCliProviderConfig>({
        id: "customCliAnswerArgv",
        label: "Answer argv",
        help: "Optional JSON string array for the command to run for web_answer.",
        getValue: (config) =>
          getCustomCliNative(config)?.answer?.argv
            ? JSON.stringify(getCustomCliNative(config)?.answer?.argv)
            : undefined,
        setValue: (config, value) => {
          setCustomCliArgv(config, "answer", value);
        },
      }),
      jsonArraySetting<CustomCliProviderConfig>({
        id: "customCliResearchArgv",
        label: "Research argv",
        help: "Optional JSON string array for the command to run for web_research.",
        getValue: (config) =>
          getCustomCliNative(config)?.research?.argv
            ? JSON.stringify(getCustomCliNative(config)?.research?.argv)
            : undefined,
        setValue: (config, value) => {
          setCustomCliArgv(config, "research", value);
        },
      }),
      ...lifecyclePolicySettings<CustomCliProviderConfig>(),
    ],
  },
  exa: {
    settings: [
      apiKeySetting<ExaProviderConfig>(),
      baseUrlSetting<ExaProviderConfig>(),
      valuesSetting<ExaProviderConfig>({
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
          readString(getExaNative(config)?.type) ?? "default",
        setValue: (config, value) => {
          const native = ensureExaNative(config);
          if (value === "default") {
            delete native.type;
          } else {
            native.type = value;
          }
          cleanupEmpty(config, "native");
        },
      }),
      valuesSetting<ExaProviderConfig>({
        id: "exaTextContents",
        label: "Text contents",
        help: "Whether Exa should include text contents in search results. 'default' uses the SDK default.",
        values: ["default", "true", "false"],
        getValue: (config) => {
          const contents = asJsonObject(getExaNative(config)?.contents);
          return typeof contents?.text === "boolean"
            ? String(contents.text)
            : "default";
        },
        setValue: (config, value) => {
          const native = ensureExaNative(config);
          const contents = asJsonObject(native.contents) ?? {};
          if (value === "default") {
            delete contents.text;
          } else {
            contents.text = value === "true";
          }
          if (Object.keys(contents).length === 0) {
            delete native.contents;
          } else {
            native.contents = contents;
          }
          cleanupEmpty(config, "native");
        },
      }),
      ...lifecyclePolicySettings<ExaProviderConfig>(),
    ],
  },
  gemini: {
    settings: [
      apiKeySetting<GeminiProviderConfig>(),
      valuesSetting<GeminiProviderConfig>({
        id: "geminiApiVersion",
        label: "API version",
        help: "Gemini API version. 'default' uses the SDK default beta endpoints.",
        values: ["default", "v1alpha", "v1beta", "v1"],
        getValue: (config) => getGeminiNative(config)?.apiVersion ?? "default",
        setValue: (config, value) => {
          const native = ensureGeminiNative(config);
          if (value === "default") {
            delete native.apiVersion;
          } else {
            native.apiVersion = value;
          }
          cleanupEmpty(config, "native");
        },
      }),
      stringSetting<GeminiProviderConfig>({
        id: "geminiSearchModel",
        label: "Search model",
        help: "Model used for Gemini search interactions.",
        getValue: (config) => getGeminiNative(config)?.searchModel,
        setValue: (config, value) => {
          assignOptionalString(
            ensureGeminiNative(config),
            "searchModel",
            value,
          );
          cleanupEmpty(config, "native");
        },
      }),
      stringSetting<GeminiProviderConfig>({
        id: "geminiAnswerModel",
        label: "Answer model",
        help: "Model used for grounded Gemini answers.",
        getValue: (config) => getGeminiNative(config)?.answerModel,
        setValue: (config, value) => {
          assignOptionalString(
            ensureGeminiNative(config),
            "answerModel",
            value,
          );
          cleanupEmpty(config, "native");
        },
      }),
      stringSetting<GeminiProviderConfig>({
        id: "geminiResearchAgent",
        label: "Research agent",
        help: "Agent used for Gemini deep research runs.",
        getValue: (config) => getGeminiNative(config)?.researchAgent,
        setValue: (config, value) => {
          assignOptionalString(
            ensureGeminiNative(config),
            "researchAgent",
            value,
          );
          cleanupEmpty(config, "native");
        },
      }),
      ...lifecyclePolicySettings<GeminiProviderConfig>(),
    ],
  },
  perplexity: {
    settings: [
      apiKeySetting<PerplexityProviderConfig>(),
      baseUrlSetting<PerplexityProviderConfig>(),
    ],
  },
  parallel: {
    settings: [
      apiKeySetting<ParallelProviderConfig>(),
      baseUrlSetting<ParallelProviderConfig>(),
      valuesSetting<ParallelProviderConfig>({
        id: "parallelSearchMode",
        label: "Search mode",
        help: "Parallel search mode. 'default' uses the SDK default.",
        values: ["default", "agentic", "one-shot"],
        getValue: (config) =>
          readString(getParallelNative(config)?.search?.mode) ?? "default",
        setValue: (config, value) => {
          const native = ensureParallelNative(config);
          native.search = asJsonObject(native.search) ?? {};
          if (value === "default") {
            delete native.search.mode;
          } else {
            native.search.mode = value;
          }
          cleanupNestedObjects(config);
        },
      }),
      valuesSetting<ParallelProviderConfig>({
        id: "parallelExtractExcerpts",
        label: "Extract excerpts",
        help: "Include excerpts in Parallel extraction results. 'default' uses the SDK default.",
        values: ["default", "on", "off"],
        getValue: (config) =>
          getOnOffValue(
            readBoolean(getParallelNative(config)?.extract?.excerpts),
          ),
        setValue: (config, value) => {
          const native = ensureParallelNative(config);
          native.extract = asJsonObject(native.extract) ?? {};
          if (value === "default") {
            delete native.extract.excerpts;
          } else {
            native.extract.excerpts = value === "on";
          }
          cleanupNestedObjects(config);
        },
      }),
      valuesSetting<ParallelProviderConfig>({
        id: "parallelExtractFullContent",
        label: "Extract full content",
        help: "Include full page content in Parallel extraction results. 'default' uses the SDK default.",
        values: ["default", "on", "off"],
        getValue: (config) =>
          getOnOffValue(
            readBoolean(getParallelNative(config)?.extract?.full_content),
          ),
        setValue: (config, value) => {
          const native = ensureParallelNative(config);
          native.extract = asJsonObject(native.extract) ?? {};
          if (value === "default") {
            delete native.extract.full_content;
          } else {
            native.extract.full_content = value === "on";
          }
          cleanupNestedObjects(config);
        },
      }),
    ],
  },
  valyu: {
    settings: [
      apiKeySetting<ValyuProviderConfig>(),
      baseUrlSetting<ValyuProviderConfig>(),
      valuesSetting<ValyuProviderConfig>({
        id: "valyuSearchType",
        label: "Search type",
        help: "Valyu search type. 'default' uses the SDK default.",
        values: ["default", "all", "web", "proprietary", "news"],
        getValue: (config) =>
          readString(getValyuNative(config)?.searchType) ?? "default",
        setValue: (config, value) => {
          const native = ensureValyuNative(config);
          if (value === "default") {
            delete native.searchType;
          } else {
            native.searchType = value;
          }
          cleanupEmpty(config, "native");
        },
      }),
      valuesSetting<ValyuProviderConfig>({
        id: "valyuResponseLength",
        label: "Response length",
        help: "Valyu response length. 'default' uses the SDK default.",
        values: ["default", "short", "medium", "large", "max"],
        getValue: (config) =>
          readString(getValyuNative(config)?.responseLength) ?? "default",
        setValue: (config, value) => {
          const native = ensureValyuNative(config);
          if (value === "default") {
            delete native.responseLength;
          } else {
            native.responseLength = value;
          }
          cleanupEmpty(config, "native");
        },
      }),
      ...lifecyclePolicySettings<ValyuProviderConfig>(),
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

function jsonArraySetting<TConfig>(
  setting: Omit<ProviderTextSettingDescriptor<TConfig>, "kind">,
): ProviderTextSettingDescriptor<TConfig> {
  return {
    kind: "text",
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
          string | number | boolean | JsonObject | undefined
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
          string | number | boolean | JsonObject | undefined
        >,
        "baseUrl",
        value,
      );
    },
  });
}

function lifecyclePolicySettings<
  TConfig extends { policy?: ExecutionPolicyDefaults },
>() {
  return [
    integerSetting<TConfig>({
      id: "researchPollIntervalMs",
      label: "Research poll interval (ms)",
      help: "How often to poll long-running research jobs for updates for this provider. Leave empty to inherit the generic setting.",
      minimum: 1,
      errorMessage: "Research poll interval must be a positive integer.",
      getValue: (config) =>
        getIntegerString(config?.policy?.researchPollIntervalMs),
      setValue: (config, value) => {
        assignOptionalInteger(
          ensurePolicy(config),
          "researchPollIntervalMs",
          value,
          "Research poll interval must be a positive integer.",
        );
        cleanupEmpty(config, "policy");
      },
    }),
    integerSetting<TConfig>({
      id: "researchTimeoutMs",
      label: "Research timeout (ms)",
      help: "Maximum total time to wait for research before returning a resumable timeout error for this provider. Leave empty to inherit the generic setting.",
      minimum: 1,
      errorMessage: "Research timeout must be a positive integer.",
      getValue: (config) => getIntegerString(config?.policy?.researchTimeoutMs),
      setValue: (config, value) => {
        assignOptionalInteger(
          ensurePolicy(config),
          "researchTimeoutMs",
          value,
          "Research timeout must be a positive integer.",
        );
        cleanupEmpty(config, "policy");
      },
    }),
    integerSetting<TConfig>({
      id: "researchMaxConsecutivePollErrors",
      label: "Max poll errors",
      help: "How many consecutive poll failures to tolerate before stopping the local research run for this provider. Leave empty to inherit the generic setting.",
      minimum: 1,
      errorMessage: "Max poll errors must be a positive integer.",
      getValue: (config) =>
        getIntegerString(config?.policy?.researchMaxConsecutivePollErrors),
      setValue: (config, value) => {
        assignOptionalInteger(
          ensurePolicy(config),
          "researchMaxConsecutivePollErrors",
          value,
          "Max poll errors must be a positive integer.",
        );
        cleanupEmpty(config, "policy");
      },
    }),
  ] as const;
}

function integerSetting<TConfig>(
  setting: Omit<ProviderTextSettingDescriptor<TConfig>, "kind"> & {
    minimum: number;
    errorMessage: string;
  },
): ProviderTextSettingDescriptor<TConfig> {
  const { minimum: _minimum, errorMessage: _errorMessage, ...rest } = setting;
  return {
    kind: "text",
    ...rest,
  };
}

function assignOptionalString(
  target: Record<string, string | number | boolean | JsonObject | undefined>,
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
  target: Record<string, string | number | boolean | JsonObject | undefined>,
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

function getOnOffValue(value: boolean | undefined): string {
  if (value === undefined) {
    return "default";
  }
  return value ? "on" : "off";
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asJsonObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function ensurePolicy<TConfig extends { policy?: ExecutionPolicyDefaults }>(
  config: TConfig,
): Record<string, string | number | boolean | JsonObject | undefined> {
  config.policy = { ...(config.policy ?? {}) };
  return config.policy as Record<
    string,
    string | number | boolean | JsonObject | undefined
  >;
}

function cleanupEmpty<TConfig extends object>(
  config: TConfig,
  key: "native" | "policy",
): void {
  const value = asJsonObject((config as Record<string, unknown>)[key]);
  if (value && Object.keys(value).length === 0) {
    delete (config as Record<string, unknown>)[key];
  }
}

function cleanupNestedObjects(config: ParallelProviderConfig): void {
  const native = config.native;
  if (!native) {
    return;
  }
  if (native.search && Object.keys(native.search).length === 0) {
    delete native.search;
  }
  if (native.extract && Object.keys(native.extract).length === 0) {
    delete native.extract;
  }
  cleanupEmpty(config, "native");
}

function getClaudeNative(config: ClaudeProviderConfig | undefined) {
  return config?.native ?? config?.defaults;
}

function ensureClaudeNative(
  config: ClaudeProviderConfig,
): Record<string, string | number | boolean | JsonObject | undefined> {
  config.native = { ...(config.native ?? config.defaults ?? {}) };
  delete config.defaults;
  return config.native as Record<
    string,
    string | number | boolean | JsonObject | undefined
  >;
}

function getCodexNative(config: CodexProviderConfig | undefined) {
  return config?.native ?? config?.defaults;
}

function ensureCodexNative(
  config: CodexProviderConfig,
): CodexProviderNativeConfig {
  config.native = { ...(config.native ?? config.defaults ?? {}) };
  delete config.defaults;
  return config.native;
}

function getGeminiNative(config: GeminiProviderConfig | undefined) {
  return config?.native ?? config?.defaults;
}

function ensureGeminiNative(
  config: GeminiProviderConfig,
): Record<string, string | number | boolean | JsonObject | undefined> {
  config.native = { ...(config.native ?? config.defaults ?? {}) };
  delete config.defaults;
  return config.native as Record<
    string,
    string | number | boolean | JsonObject | undefined
  >;
}

function getCustomCliNative(config: CustomCliProviderConfig | undefined) {
  return config?.native ?? config?.defaults;
}

function ensureCustomCliNative(
  config: CustomCliProviderConfig,
): CustomCliProviderNativeConfig {
  const native = getCustomCliNative(config);
  config.native = {
    ...(native?.search ? { search: { ...native.search } } : {}),
    ...(native?.contents ? { contents: { ...native.contents } } : {}),
    ...(native?.answer ? { answer: { ...native.answer } } : {}),
    ...(native?.research ? { research: { ...native.research } } : {}),
  };
  delete config.defaults;
  return config.native;
}

function setCustomCliArgv(
  config: CustomCliProviderConfig,
  capability: keyof CustomCliProviderNativeConfig,
  value: string,
): void {
  const trimmed = value.trim();
  const native = ensureCustomCliNative(config);
  if (!trimmed) {
    delete native[capability];
    cleanupCustomCliNative(config);
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(
      `Custom CLI ${capability} argv must be a JSON string array: ${(error as Error).message}`,
    );
  }

  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (entry) => typeof entry !== "string" || entry.trim().length === 0,
    )
  ) {
    throw new Error(
      `Custom CLI ${capability} argv must be a non-empty JSON string array.`,
    );
  }

  native[capability] = {
    ...(native[capability] ?? {}),
    argv: parsed,
  };
  cleanupCustomCliNative(config);
}

function cleanupCustomCliNative(config: CustomCliProviderConfig): void {
  const native = config.native;
  if (!native) {
    return;
  }

  for (const capability of [
    "search",
    "contents",
    "answer",
    "research",
  ] as const) {
    const entry = native[capability];
    if (!entry) {
      continue;
    }

    if (
      entry.argv === undefined &&
      entry.cwd === undefined &&
      (entry.env === undefined || Object.keys(entry.env).length === 0)
    ) {
      delete native[capability];
    }
  }

  cleanupEmpty(config, "native");
}

function getParallelNative(config: ParallelProviderConfig | undefined) {
  return config?.native ?? config?.defaults;
}

function ensureParallelNative(
  config: ParallelProviderConfig,
): ParallelProviderNativeConfig {
  const search = asJsonObject(config.native?.search ?? config.defaults?.search);
  const extract = asJsonObject(
    config.native?.extract ?? config.defaults?.extract,
  );
  config.native = {
    ...(search ? { search } : {}),
    ...(extract ? { extract } : {}),
  };
  delete config.defaults;
  return config.native;
}

function getExaNative(config: ExaProviderConfig | undefined) {
  return config?.native ?? config?.defaults;
}

function ensureExaNative(config: ExaProviderConfig): JsonObject {
  config.native = { ...(config.native ?? config.defaults ?? {}) };
  delete config.defaults;
  return config.native;
}

function getValyuNative(config: ValyuProviderConfig | undefined) {
  return config?.native ?? config?.defaults;
}

function ensureValyuNative(config: ValyuProviderConfig): JsonObject {
  config.native = { ...(config.native ?? config.defaults ?? {}) };
  delete config.defaults;
  return config.native;
}
