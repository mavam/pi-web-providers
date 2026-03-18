import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  type ExtensionAPI,
  type ExtensionCommandContext,
  formatSize,
  getMarkdownTheme,
  keyHint,
  type Theme,
  truncateHead,
} from "@mariozechner/pi-coding-agent";
import {
  type Component,
  Editor,
  type EditorTheme,
  getEditorKeybindings,
  Key,
  Markdown,
  matchesKey,
  Text,
  type TUI,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { loadConfig, writeConfigFile } from "./config.js";
import {
  formatElapsed,
  formatErrorMessage,
  stripLocalExecutionOptions,
} from "./execution-policy.js";
import {
  cleanupContentStore,
  formatPrefetchStatusText,
  getPrefetchStatus,
  mergeSearchContentsPrefetchOptions,
  parseSearchContentsPrefetchOptions,
  resetContentStore,
  resolveContentsFromStore,
  startContentsPrefetch,
  stripSearchContentsPrefetchOptions,
} from "./prefetch-manager.js";
import {
  getProviderConfigManifest,
  type ProviderSettingDescriptor,
} from "./provider-config-manifests.js";
import {
  getEffectiveProviderConfig,
  getMappedProviderIdForCapability,
  resolveProviderChoice,
  resolveProviderForCapability,
  supportsProviderCapability,
} from "./provider-resolution.js";
import {
  executeOperationPlan,
  resolvePlanExecutionSupport,
} from "./provider-runtime.js";
import {
  getCompatibleProvidersForTool,
  PROVIDER_TOOL_META,
  type ProviderConfigUnion,
  type ProviderToolId,
} from "./provider-tools.js";
import { PROVIDER_MAP, PROVIDERS } from "./providers/index.js";
import type {
  ClaudeProviderConfig,
  CodexProviderConfig,
  ExaProviderConfig,
  GeminiProviderConfig,
  GenericSettingsConfig,
  JsonObject,
  ParallelProviderConfig,
  ProviderId,
  ProviderOperationPlan,
  ProviderOperationRequest,
  ProviderToolDetails,
  ProviderToolOutput,
  SearchPrefetchSettings,
  SearchResponse,
  SearchToolSettings,
  ValyuProviderConfig,
  WebProvidersConfig,
  WebSearchDetails,
} from "./types.js";
import { EXECUTION_CONTROL_KEYS, PROVIDER_IDS } from "./types.js";

const DEFAULT_MAX_RESULTS = 5;
const MAX_ALLOWED_RESULTS = 20;
const MAX_SEARCH_QUERIES = 10;
const RESEARCH_HEARTBEAT_MS = 15000;
type ProviderCapability = ProviderToolId;
const CAPABILITY_TOOL_NAMES: Record<ProviderCapability, string> = {
  search: "web_search",
  contents: "web_contents",
  answer: "web_answer",
  research: "web_research",
};
const MANAGED_TOOL_NAMES = Object.values(CAPABILITY_TOOL_NAMES);

export default function webProvidersExtension(pi: ExtensionAPI) {
  registerManagedTools(pi);

  pi.registerCommand("web-providers", {
    description: "Configure web search providers",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("web-providers requires interactive mode", "error");
        return;
      }

      await runWebProvidersConfig(pi, ctx);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    resetContentStore();
    await refreshManagedTools(pi, ctx.cwd, { addAvailable: true });
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    await cleanupContentStore();
    await refreshManagedTools(pi, ctx.cwd, { addAvailable: false });
  });
}

function registerManagedTools(
  pi: ExtensionAPI,
  providerIdsByCapability: Partial<
    Record<ProviderCapability, ProviderId[]>
  > = {},
): void {
  registerWebSearchTool(pi, providerIdsByCapability.search ?? PROVIDER_IDS);
  registerWebContentsTool(
    pi,
    providerIdsByCapability.contents ?? getProviderIdsForCapability("contents"),
  );
  registerWebAnswerTool(
    pi,
    providerIdsByCapability.answer ?? getProviderIdsForCapability("answer"),
  );
  registerWebResearchTool(
    pi,
    providerIdsByCapability.research ?? getProviderIdsForCapability("research"),
  );
}

function registerWebSearchTool(
  pi: ExtensionAPI,
  providerIds: readonly ProviderId[],
): void {
  const visibleProviderIds =
    providerIds.length > 0 ? providerIds : PROVIDER_IDS;

  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      `Find likely sources on the public web for up to ${MAX_SEARCH_QUERIES} queries in a single call and return titles, URLs, and snippets grouped by query. ` +
      `Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)} when needed.`,
    promptGuidelines: [
      "Prefer batching related searches into one web_search call instead of making multiple calls.",
    ],
    parameters: Type.Object({
      queries: Type.Array(Type.String({ minLength: 1 }), {
        minItems: 1,
        maxItems: MAX_SEARCH_QUERIES,
        description: `One or more search queries to run in one call (max ${MAX_SEARCH_QUERIES})`,
      }),
      maxResults: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: MAX_ALLOWED_RESULTS,
          description: `Maximum number of results to return (default: ${DEFAULT_MAX_RESULTS})`,
        }),
      ),
      options: jsonOptionsSchema(
        describeOptionsField("search", visibleProviderIds),
      ),
    }),

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      return executeSearchTool({
        config: await loadConfig(),
        ctx,
        signal,
        onUpdate,
        options: normalizeOptions(params.options),
        maxResults: params.maxResults,
        queries: params.queries,
      });
    },

    renderCall(args, theme) {
      return renderCallHeader(
        args as {
          queries?: string[];
          maxResults?: number;
        },
        theme,
      );
    },

    renderResult(result, state, theme) {
      return renderSearchToolResult(
        result,
        state.expanded,
        state.isPartial,
        theme,
      );
    },
  });
}

function registerWebContentsTool(
  pi: ExtensionAPI,
  providerIds: readonly ProviderId[],
): void {
  if (providerIds.length === 0) return;

  pi.registerTool({
    name: "web_contents",
    label: "Web Contents",
    description: "Read and extract the main contents of one or more web pages.",
    parameters: Type.Object({
      urls: Type.Array(Type.String({ minLength: 1 }), {
        minItems: 1,
        description: "One or more URLs to extract",
      }),
      options: jsonOptionsSchema(describeOptionsField("contents", providerIds)),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      return executeProviderTool({
        capability: "contents",
        config: await loadConfig(),
        ctx,
        signal,
        onUpdate,
        options: normalizeOptions(params.options),
        urls: params.urls,
      });
    },
    renderCall(args, theme) {
      return renderListCallHeader(
        "web_contents",
        Array.isArray((args as { urls?: string[] }).urls)
          ? ((args as { urls?: string[] }).urls ?? [])
          : [],
        theme,
      );
    },
    renderResult(result, state, theme) {
      return renderProviderToolResult(
        result,
        state.expanded,
        state.isPartial,
        "web_contents failed",
        theme,
      );
    },
  });
}

function registerWebAnswerTool(
  pi: ExtensionAPI,
  providerIds: readonly ProviderId[],
): void {
  if (providerIds.length === 0) return;

  pi.registerTool({
    name: "web_answer",
    label: "Web Answer",
    description: `Answer one or more questions using web-grounded evidence (up to ${MAX_SEARCH_QUERIES} per call).`,
    parameters: Type.Object({
      queries: Type.Array(Type.String({ minLength: 1 }), {
        minItems: 1,
        maxItems: MAX_SEARCH_QUERIES,
        description: `One or more questions to answer in one call (max ${MAX_SEARCH_QUERIES})`,
      }),
      options: jsonOptionsSchema(describeOptionsField("answer", providerIds)),
    }),
    promptGuidelines: [
      "Prefer batching related questions into one web_answer call instead of making multiple calls.",
    ],
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      return executeAnswerTool({
        config: await loadConfig(),
        ctx,
        signal,
        onUpdate,
        options: normalizeOptions(params.options),
        queries: params.queries,
      });
    },
    renderCall(args, theme) {
      return renderQuestionCallHeader(
        {
          queries: Array.isArray((args as { queries?: unknown }).queries)
            ? ((args as { queries?: string[] }).queries ?? [])
            : [],
        },
        theme,
      );
    },
    renderResult(result, state, theme) {
      return renderProviderToolResult(
        result,
        state.expanded,
        state.isPartial,
        "web_answer failed",
        theme,
        { markdownWhenExpanded: true },
      );
    },
  });
}

function registerWebResearchTool(
  pi: ExtensionAPI,
  providerIds: readonly ProviderId[],
): void {
  if (providerIds.length === 0) return;

  pi.registerTool({
    name: "web_research",
    label: "Web Research",
    description:
      "Investigate a topic across web sources and produce a longer report.",
    parameters: Type.Object({
      input: Type.String({ description: "Research brief or question" }),
      options: jsonOptionsSchema(describeOptionsField("research", providerIds)),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      return executeProviderTool({
        capability: "research",
        config: await loadConfig(),
        ctx,
        signal,
        onUpdate,
        options: normalizeOptions(params.options),
        input: params.input,
      });
    },
    renderCall(args, theme) {
      return renderResearchCallHeader(
        {
          input: String((args as { input?: string }).input ?? ""),
        },
        theme,
      );
    },
    renderResult(result, state, theme) {
      return renderProviderToolResult(
        result,
        state.expanded,
        state.isPartial,
        "web_research failed",
        theme,
      );
    },
  });
}

async function runWebProvidersConfig(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const config = await loadConfig();
  const activeProvider = getInitialProviderSelection(config);

  await ctx.ui.custom(
    (tui, theme, _keybindings, done) =>
      new WebProvidersSettingsView(
        tui,
        theme,
        done,
        ctx,
        config,
        activeProvider,
      ),
  );

  await refreshManagedTools(pi, ctx.cwd, { addAvailable: true });
}

function getAvailableProviderIdsForCapability(
  config: WebProvidersConfig,
  cwd: string,
  capability: ProviderCapability,
): ProviderId[] {
  const providerId = getMappedProviderIdForCapability(config, capability);
  if (!providerId) {
    return [];
  }

  try {
    resolveProviderForCapability(config, cwd, capability);
    return [providerId];
  } catch {
    return [];
  }
}

function getAvailableManagedToolNames(
  config: WebProvidersConfig,
  cwd: string,
): string[] {
  return (Object.keys(CAPABILITY_TOOL_NAMES) as ProviderCapability[])
    .filter(
      (capability) =>
        getAvailableProviderIdsForCapability(config, cwd, capability).length >
        0,
    )
    .map((capability) => CAPABILITY_TOOL_NAMES[capability]);
}

function getSyncedActiveTools(
  config: WebProvidersConfig,
  cwd: string,
  activeToolNames: readonly string[],
  options: { addAvailable: boolean },
): Set<string> {
  const availableToolNames = new Set(getAvailableManagedToolNames(config, cwd));
  const nextActiveTools = new Set(activeToolNames);

  for (const toolName of MANAGED_TOOL_NAMES) {
    if (availableToolNames.has(toolName)) {
      if (options.addAvailable) {
        nextActiveTools.add(toolName);
      }
      continue;
    }

    nextActiveTools.delete(toolName);
  }

  return nextActiveTools;
}

async function refreshManagedTools(
  pi: ExtensionAPI,
  cwd: string,
  options: { addAvailable: boolean },
): Promise<void> {
  const config = await loadConfig();
  const nextActiveTools = getSyncedActiveTools(
    config,
    cwd,
    pi.getActiveTools(),
    options,
  );

  registerManagedTools(pi, {
    search: getAvailableProviderIdsForCapability(config, cwd, "search"),
    contents: getAvailableProviderIdsForCapability(config, cwd, "contents"),
    answer: getAvailableProviderIdsForCapability(config, cwd, "answer"),
    research: getAvailableProviderIdsForCapability(config, cwd, "research"),
  });

  await syncManagedToolAvailability(pi, nextActiveTools);
}

async function syncManagedToolAvailability(
  pi: ExtensionAPI,
  nextActiveTools: ReadonlySet<string>,
): Promise<void> {
  const activeTools = pi.getActiveTools();
  const changed =
    activeTools.length !== nextActiveTools.size ||
    activeTools.some((toolName) => !nextActiveTools.has(toolName));

  if (changed) {
    pi.setActiveTools(Array.from(nextActiveTools));
  }
}

function getProviderIdsForCapability(
  capability: ProviderCapability,
): ProviderId[] {
  return PROVIDERS.filter((provider) =>
    supportsProviderCapability(provider, capability),
  ).map((provider) => provider.id);
}

function jsonOptionsSchema(description: string) {
  return Type.Optional(
    Type.Object(
      {},
      {
        additionalProperties: true,
        description,
      },
    ),
  );
}

function describeOptionsField(
  capability: ProviderCapability,
  providerIds: readonly ProviderId[],
): string {
  const labels: Record<ProviderCapability, string> = {
    search: "Provider-specific search options.",
    contents: "Provider-specific extraction options.",
    answer: "Provider-specific answer options.",
    research: "Provider-specific research options.",
  };
  const supportedControls = getSupportedExecutionControlsForCapability(
    capability,
    providerIds,
  );

  let description = labels[capability];

  if (supportedControls.length > 0) {
    const qualifier =
      capability === "research"
        ? " Depending on provider, local execution controls may include: "
        : " Local execution controls: ";
    description += `${qualifier}${supportedControls.join(", ")}.`;
  }

  if (capability === "search") {
    description +=
      " Local orchestration options may include prefetch={ provider, maxUrls, ttlMs, contentsOptions }. Prefetch runs only when prefetch.provider is set.";
  }

  return description;
}

function getSupportedExecutionControlsForCapability(
  capability: ProviderCapability,
  providerIds: readonly ProviderId[],
): string[] {
  const supportedControls = new Set<string>();

  for (const providerId of providerIds) {
    const provider = PROVIDER_MAP[providerId];
    const plan = provider.buildPlan(
      createExecutionSupportProbeRequest(capability),
      provider.createTemplate() as never,
    );
    if (!plan) {
      continue;
    }

    const executionSupport = resolvePlanExecutionSupport(plan);
    for (const key of EXECUTION_CONTROL_KEYS) {
      if (executionSupport[key] === true) {
        supportedControls.add(key);
      }
    }
  }

  return EXECUTION_CONTROL_KEYS.filter((key) => supportedControls.has(key));
}

function createExecutionSupportProbeRequest(
  capability: ProviderCapability,
): ProviderOperationRequest {
  switch (capability) {
    case "search":
      return {
        capability,
        query: "Describe execution controls",
        maxResults: 1,
      };
    case "contents":
      return {
        capability,
        urls: ["https://example.com"],
      };
    case "answer":
      return {
        capability,
        query: "Describe execution controls",
      };
    case "research":
      return {
        capability,
        input: "Describe execution controls",
      };
  }
}

async function executeSearchTool({
  config,
  explicitProvider,
  ctx,
  signal,
  onUpdate,
  options,
  maxResults,
  queries,
  planOverrides,
}: {
  config: WebProvidersConfig;
  explicitProvider?: ProviderId;
  ctx: { cwd: string };
  signal: AbortSignal | null | undefined;
  onUpdate:
    | ((update: {
        content: Array<{ type: "text"; text: string }>;
        details: {};
      }) => void)
    | undefined;
  options: JsonObject | undefined;
  maxResults?: number;
  queries: string[];
  planOverrides?: ProviderOperationPlan<SearchResponse>[];
}) {
  await cleanupContentStore();

  const provider = resolveProviderChoice(config, ctx.cwd, explicitProvider);
  const providerConfig = getEffectiveProviderConfig(config, provider.id);
  if (!providerConfig) {
    throw new Error(`Provider '${provider.id}' is not configured.`);
  }

  const prefetchOptions = mergeSearchContentsPrefetchOptions(
    getSearchPrefetchDefaults(config),
    parseSearchContentsPrefetchOptions(options),
  );
  const providerOptions = stripSearchContentsPrefetchOptions(options);
  const searchQueries = resolveSearchQueries(queries);
  if (
    planOverrides !== undefined &&
    planOverrides.length !== searchQueries.length
  ) {
    throw new Error(
      "planOverrides length must match the number of search queries.",
    );
  }

  const progress = createToolProgressReporter("search", provider.id, onUpdate);
  const providerContext = {
    cwd: ctx.cwd,
    signal: signal ?? undefined,
  };
  const clampedMaxResults = clampResults(maxResults);

  let outcomes: SearchQueryOutcome[];
  try {
    const settled = await Promise.allSettled(
      searchQueries.map((searchQuery, index) =>
        executeSingleSearchQuery({
          provider,
          providerConfig: providerConfig as ProviderConfigUnion,
          query: searchQuery,
          maxResults: clampedMaxResults,
          options: providerOptions,
          providerContext,
          onProgress: createBatchProgressReporter(
            progress.report,
            searchQueries,
            index,
          ),
          planOverride: planOverrides?.[index],
        }),
      ),
    );
    outcomes = settled.map((result, index) =>
      result.status === "fulfilled"
        ? { query: searchQueries[index] ?? "", response: result.value }
        : {
            query: searchQueries[index] ?? "",
            error: formatErrorMessage(result.reason),
          },
    );
  } finally {
    progress.stop();
  }

  if (outcomes.every((outcome) => outcome.error !== undefined)) {
    throw buildSearchBatchError(outcomes);
  }

  const prefetch =
    prefetchOptions !== undefined && planOverrides === undefined
      ? await startContentsPrefetch({
          config,
          cwd: ctx.cwd,
          urls: collectSearchResultUrls(outcomes),
          options: prefetchOptions,
        })
      : undefined;

  const rendered = await truncateAndSave(
    formatSearchResponses(outcomes, prefetch),
    "web-search",
  );

  return {
    content: [{ type: "text" as const, text: rendered }],
    details: buildWebSearchDetails(provider.id, outcomes),
  };
}

type SearchQueryOutcome =
  | { query: string; response: SearchResponse; error?: undefined }
  | { query: string; error: string; response?: undefined };

function buildSearchBatchError(outcomes: SearchQueryOutcome[]): Error {
  const failed = outcomes.filter((outcome) => outcome.error !== undefined);
  if (failed.length === 1) {
    return new Error(failed[0]?.error ?? "web_search failed.");
  }

  const summary = failed
    .map(
      (outcome, index) =>
        `${index + 1}. ${formatQuotedPreview(outcome.query, 40)} — ${outcome.error}`,
    )
    .join("; ");
  return new Error(
    `All ${failed.length} web_search queries failed: ${summary}`,
  );
}

async function executeSingleSearchQuery({
  provider,
  providerConfig,
  query,
  maxResults,
  options,
  providerContext,
  onProgress,
  planOverride,
}: {
  provider: (typeof PROVIDERS)[number];
  providerConfig: ProviderConfigUnion;
  query: string;
  maxResults: number;
  options: JsonObject | undefined;
  providerContext: { cwd: string; signal?: AbortSignal };
  onProgress?: (message: string) => void;
  planOverride?: ProviderOperationPlan<SearchResponse>;
}): Promise<SearchResponse> {
  const plan =
    planOverride ??
    buildProviderPlan(provider, providerConfig, {
      capability: "search",
      query,
      maxResults,
      options: stripLocalExecutionOptions(options),
    });

  const result = await executeOperationPlan(plan, options, {
    ...providerContext,
    onProgress,
  });
  if (!isSearchResponse(result)) {
    throw new Error(`${provider.label} search returned an invalid result.`);
  }
  return result;
}

type AnswerQueryOutcome =
  | { query: string; response: ProviderToolOutput; error?: undefined }
  | { query: string; error: string; response?: undefined };

async function executeAnswerTool({
  config,
  explicitProvider,
  ctx,
  signal,
  onUpdate,
  options,
  queries,
  planOverrides,
}: {
  config: WebProvidersConfig;
  explicitProvider?: ProviderId;
  ctx: { cwd: string };
  signal: AbortSignal | null | undefined;
  onUpdate:
    | ((update: {
        content: Array<{ type: "text"; text: string }>;
        details: {};
      }) => void)
    | undefined;
  options: JsonObject | undefined;
  queries: string[];
  planOverrides?: ProviderOperationPlan<ProviderToolOutput>[];
}) {
  const provider = resolveProviderForCapability(
    config,
    ctx.cwd,
    "answer",
    explicitProvider,
  );
  const providerConfig = getEffectiveProviderConfig(config, provider.id);
  if (!providerConfig) {
    throw new Error(`Provider '${provider.id}' is not configured.`);
  }

  const answerQueries = resolveAnswerQueries(queries);
  if (
    planOverrides !== undefined &&
    planOverrides.length !== answerQueries.length
  ) {
    throw new Error(
      "planOverrides length must match the number of answer queries.",
    );
  }

  const progress = createToolProgressReporter("answer", provider.id, onUpdate);
  const providerContext = {
    cwd: ctx.cwd,
    signal: signal ?? undefined,
  };

  let outcomes: AnswerQueryOutcome[];
  try {
    const settled = await Promise.allSettled(
      answerQueries.map((answerQuery, index) =>
        executeProviderOperation({
          capability: "answer",
          config,
          provider,
          providerConfig: providerConfig as ProviderConfigUnion,
          ctx,
          signal,
          options,
          query: answerQuery,
          onProgress: createBatchProgressReporter(
            progress.report,
            answerQueries,
            index,
          ),
          planOverride: planOverrides?.[index],
        }),
      ),
    );
    outcomes = settled.map((result, index) =>
      result.status === "fulfilled"
        ? { query: answerQueries[index] ?? "", response: result.value }
        : {
            query: answerQueries[index] ?? "",
            error: formatErrorMessage(result.reason),
          },
    );
  } finally {
    progress.stop();
  }

  if (outcomes.every((outcome) => outcome.error !== undefined)) {
    throw buildAnswerBatchError(outcomes);
  }

  const text = await truncateAndSave(
    formatAnswerResponses(outcomes),
    "web-answer",
  );
  const details = buildWebAnswerDetails(provider.id, outcomes);

  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function buildAnswerBatchError(outcomes: AnswerQueryOutcome[]): Error {
  const failed = outcomes.filter((outcome) => outcome.error !== undefined);
  if (failed.length === 1) {
    return new Error(failed[0]?.error ?? "web_answer failed.");
  }

  const summary = failed
    .map(
      (outcome, index) =>
        `${index + 1}. ${formatQuotedPreview(outcome.query, 40)} — ${outcome.error}`,
    )
    .join("; ");
  return new Error(
    `All ${failed.length} web_answer queries failed: ${summary}`,
  );
}

function formatAnswerResponses(outcomes: AnswerQueryOutcome[]): string {
  return outcomes
    .map((outcome, index) =>
      formatAnswerOutcomeSection(outcome, index, outcomes.length),
    )
    .join("\n\n");
}

function formatAnswerOutcomeSection(
  outcome: AnswerQueryOutcome,
  index: number,
  total: number,
): string {
  const heading =
    total > 1
      ? `## Question ${index + 1}: ${formatAnswerHeading(outcome.query)}`
      : `## ${formatAnswerHeading(outcome.query)}`;
  const body = outcome.response
    ? outcome.response.text
    : `Answer failed: ${outcome.error ?? "Unknown error."}`;
  return `${heading}\n\n${body}`;
}

function buildWebAnswerDetails(
  provider: ProviderId,
  outcomes: AnswerQueryOutcome[],
): ProviderToolDetails {
  const successfulOutcomes = outcomes.filter(
    (
      outcome,
    ): outcome is Extract<
      AnswerQueryOutcome,
      { response: ProviderToolOutput }
    > => outcome.response !== undefined,
  );
  const summary =
    successfulOutcomes.length === 1 && outcomes.length === 1
      ? successfulOutcomes[0]?.response.summary
      : undefined;

  return {
    tool: "web_answer",
    provider,
    summary,
    itemCount:
      successfulOutcomes.length === 1
        ? successfulOutcomes[0]?.response.itemCount
        : undefined,
    queryCount: outcomes.length,
    failedQueryCount: outcomes.filter((outcome) => outcome.error !== undefined)
      .length,
  };
}

async function executeProviderOperation({
  capability,
  config,
  provider,
  providerConfig,
  ctx,
  signal,
  options,
  urls,
  query,
  input,
  onProgress,
  planOverride,
}: {
  capability: Exclude<ProviderCapability, "search">;
  config: WebProvidersConfig;
  provider: (typeof PROVIDERS)[number];
  providerConfig: ProviderConfigUnion;
  ctx: { cwd: string };
  signal: AbortSignal | null | undefined;
  options: JsonObject | undefined;
  urls?: string[];
  query?: string;
  input?: string;
  onProgress?: (message: string) => void;
  planOverride?: ProviderOperationPlan<ProviderToolOutput>;
}): Promise<ProviderToolOutput> {
  const plan =
    planOverride ??
    buildProviderPlan(
      provider,
      providerConfig,
      buildOperationRequest(capability, {
        urls,
        query,
        input,
        options: stripLocalExecutionOptions(options),
      }),
    );

  // Route contents requests through the local content store whenever we can
  // reuse an exact batch hit or at least one per-URL cache entry. Exact cache
  // hits are served immediately, and partial cache hits fetch only missing or
  // stale URLs.
  if (capability === "contents" && planOverride === undefined) {
    const resolved = await resolveContentsFromStore({
      urls: urls ?? [],
      providerId: provider.id,
      config,
      cwd: ctx.cwd,
      options,
      signal: signal ?? undefined,
      onProgress,
    });
    return resolved.output;
  }

  const result = await executeOperationPlan(plan, options, {
    cwd: ctx.cwd,
    signal: signal ?? undefined,
    onProgress,
  });
  if (isSearchResponse(result)) {
    throw new Error(
      `${provider.label} ${capability} returned an invalid result.`,
    );
  }
  return result;
}

async function executeProviderTool({
  capability,
  config,
  explicitProvider,
  ctx,
  signal,
  onUpdate,
  options,
  urls,
  query,
  input,
  planOverride,
}: {
  capability: Exclude<ProviderCapability, "search">;
  config: WebProvidersConfig;
  explicitProvider?: ProviderId;
  ctx: { cwd: string };
  signal: AbortSignal | null | undefined;
  onUpdate:
    | ((update: {
        content: Array<{ type: "text"; text: string }>;
        details: {};
      }) => void)
    | undefined;
  options: JsonObject | undefined;
  urls?: string[];
  query?: string;
  input?: string;
  planOverride?: ProviderOperationPlan<ProviderToolOutput>;
}) {
  await cleanupContentStore();

  const provider = resolveProviderForCapability(
    config,
    ctx.cwd,
    capability,
    explicitProvider,
  );
  const providerConfig = getEffectiveProviderConfig(config, provider.id);
  if (!providerConfig) {
    throw new Error(`Provider '${provider.id}' is not configured.`);
  }

  const progress = createToolProgressReporter(
    capability,
    provider.id,
    onUpdate,
  );

  let response: ProviderToolOutput;
  try {
    response = await executeProviderOperation({
      capability,
      config,
      provider,
      providerConfig: providerConfig as ProviderConfigUnion,
      ctx,
      signal,
      options,
      urls,
      query,
      input,
      onProgress: progress.report,
      planOverride,
    });
  } finally {
    progress.stop();
  }

  const details: ProviderToolDetails = {
    tool: `web_${capability}`,
    provider: response.provider,
    summary: response.summary,
    itemCount: response.itemCount,
  };
  const text = await truncateAndSave(response.text, capability);

  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function buildOperationRequest(
  capability: Exclude<ProviderCapability, "search">,
  args: {
    options: JsonObject | undefined;
    urls?: string[];
    query?: string;
    input?: string;
  },
): ProviderOperationRequest {
  if (capability === "contents") {
    return {
      capability,
      urls: args.urls ?? [],
      options: args.options,
    };
  }

  if (capability === "answer") {
    return {
      capability,
      query: args.query ?? "",
      options: args.options,
    };
  }

  return {
    capability,
    input: args.input ?? "",
    options: args.options,
  };
}

function buildProviderPlan(
  provider: (typeof PROVIDERS)[number],
  providerConfig: ProviderConfigUnion,
  request: ProviderOperationRequest,
) {
  const plan = provider.buildPlan(request, providerConfig as never);
  if (!plan) {
    throw new Error(
      `Provider '${provider.id}' could not build a plan for '${request.capability}'.`,
    );
  }
  return plan;
}

function isSearchResponse(
  value: SearchResponse | ProviderToolOutput,
): value is SearchResponse {
  return "results" in value;
}

function normalizeOptions(value: unknown): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

function createToolProgressReporter(
  capability: ProviderCapability,
  providerId: ProviderId,
  onUpdate:
    | ((update: {
        content: Array<{ type: "text"; text: string }>;
        details: {};
      }) => void)
    | undefined,
): {
  report?: (message: string) => void;
  stop: () => void;
} {
  if (!onUpdate) {
    return { report: undefined, stop: () => {} };
  }

  const emit = (message: string) =>
    onUpdate({
      content: [{ type: "text", text: message }],
      details: {},
    });

  const startedAt = Date.now();
  let lastUpdateAt = startedAt;
  let timer: ReturnType<typeof setInterval> | undefined;

  if (capability === "research") {
    timer = setInterval(() => {
      if (Date.now() - lastUpdateAt < RESEARCH_HEARTBEAT_MS) {
        return;
      }

      const elapsed = formatElapsed(Date.now() - startedAt);
      emit(`web_research still running via ${providerId} (${elapsed} elapsed)`);
      lastUpdateAt = Date.now();
    }, RESEARCH_HEARTBEAT_MS);
  }

  return {
    report: (message: string) => {
      lastUpdateAt = Date.now();
      emit(message);
    },
    stop: () => {
      if (timer) {
        clearInterval(timer);
      }
    },
  };
}

function renderListCallHeader(
  toolName: string,
  items: string[],
  theme: Theme,
  options: {
    singleItemFormatter?: (item: string) => string;
    multiItemFormatter?: (item: string) => string;
    suffix?: string;
    forceMultiline?: boolean;
  } = {},
): Component {
  return {
    invalidate() {},
    render(width) {
      const normalizedItems = items
        .map((item) => cleanSingleLine(item))
        .filter((item) => item.length > 0);
      const showItemsInline =
        normalizedItems.length === 1 && options.forceMultiline !== true;

      let header = theme.fg("toolTitle", theme.bold(toolName));
      if (showItemsInline) {
        const singleItem =
          options.singleItemFormatter?.(normalizedItems[0]) ??
          normalizedItems[0];
        header += ` ${theme.fg("accent", singleItem)}`;
      }
      if (options.suffix) {
        header += theme.fg("muted", options.suffix);
      }

      const lines: string[] = [];
      const headerLine = truncateToWidth(header.trimEnd(), width);
      lines.push(
        headerLine + " ".repeat(Math.max(0, width - visibleWidth(headerLine))),
      );

      if (normalizedItems.length > (showItemsInline ? 1 : 0)) {
        for (const item of normalizedItems) {
          const renderedItem =
            options.multiItemFormatter?.(item) ?? truncateInline(item, 120);
          const itemLine = truncateToWidth(
            `  ${theme.fg("accent", renderedItem)}`,
            width,
          );
          lines.push(
            itemLine + " ".repeat(Math.max(0, width - visibleWidth(itemLine))),
          );
        }
      }

      return lines;
    },
  };
}

function renderToolCallHeader(
  toolName: string,
  primary: string,
  details: string[],
  theme: Theme,
): Component {
  return renderListCallHeader(
    toolName,
    primary.trim().length > 0 ? [primary] : [],
    theme,
    {
      singleItemFormatter: (item) => item,
      suffix: details.length > 0 ? ` ${details.join(" ")}` : undefined,
    },
  );
}

function renderQuestionCallHeader(
  params: {
    queries: string[];
  },
  theme: Theme,
): Component {
  return renderListCallHeader(
    "web_answer",
    getAnswerQueriesForDisplay(params.queries),
    theme,
    {
      singleItemFormatter: (question) => formatQuotedPreview(question),
    },
  );
}

function renderResearchCallHeader(
  params: {
    input: string;
  },
  theme: Theme,
): Component {
  return renderListCallHeader("web_research", [params.input], theme, {
    forceMultiline: true,
  });
}

function renderSearchToolResult(
  result: {
    content?: Array<{ type: string; text?: string }>;
    details?: unknown;
    isError?: boolean;
  },
  expanded: boolean,
  isPartial: boolean,
  theme: Theme,
): Component | undefined {
  const text = extractTextContent(result.content);
  const isError = Boolean((result as { isError?: boolean }).isError);

  if (isPartial) {
    return renderSimpleText(text ?? "Working…", theme, "warning");
  }

  if (isError) {
    return renderBlockText(text ?? "web_search failed", theme, "error");
  }

  const details = result.details as WebSearchDetails | undefined;
  if (!details || expanded) {
    return renderMarkdownBlock(text ?? "");
  }

  return renderCollapsedSearchSummary(details, text, theme);
}

function renderProviderToolResult(
  result: {
    content?: Array<{ type: string; text?: string }>;
    details?: unknown;
    isError?: boolean;
  },
  expanded: boolean,
  isPartial: boolean,
  failureText: string,
  theme: Theme,
  options: {
    markdownWhenExpanded?: boolean;
  } = {},
): Component | undefined {
  const text = extractTextContent(result.content);

  if (isPartial) {
    return renderSimpleText(text ?? "Working…", theme, "warning");
  }

  if (result.isError) {
    return renderBlockText(text ?? failureText, theme, "error");
  }

  if (expanded) {
    return options.markdownWhenExpanded
      ? renderMarkdownBlock(text ?? "")
      : renderBlockText(text ?? "", theme, "toolOutput");
  }

  const details = result.details as ProviderToolDetails | undefined;
  const summary = renderCollapsedProviderToolSummary(details, text);
  let summaryText = theme.fg("success", summary);
  summaryText += theme.fg("muted", ` (${getExpandHint()})`);
  return new Text(summaryText, 0, 0);
}

function renderCollapsedProviderToolSummary(
  details: ProviderToolDetails | undefined,
  text: string | undefined,
): string {
  if (
    details?.tool === "web_answer" &&
    typeof details.queryCount === "number" &&
    details.queryCount > 1
  ) {
    const failureSuffix =
      details.failedQueryCount && details.failedQueryCount > 0
        ? `, ${details.failedQueryCount} failed`
        : "";
    return `${details.queryCount} questions via ${details.provider}${failureSuffix}`;
  }

  const baseSummary =
    getCompactProviderToolSummary(details) ??
    details?.summary ??
    getFirstLine(text) ??
    `${details?.tool ?? "tool"} output available`;

  if (!details?.provider) {
    return baseSummary;
  }

  return appendProviderSummary(baseSummary, details.provider);
}

function getCompactProviderToolSummary(
  details: ProviderToolDetails | undefined,
): string | undefined {
  if (!details) {
    return undefined;
  }

  if (
    details.tool === "web_contents" &&
    typeof details.itemCount === "number"
  ) {
    return `${details.itemCount} page${details.itemCount === 1 ? "" : "s"}`;
  }

  return undefined;
}

interface SettingsEntry {
  id: string;
  label: string;
  currentValue: string;
  description: string;
  kind: "action" | "cycle" | "text";
  values?: string[];
}

function getProviderSettings(
  providerId: ProviderId,
): readonly ProviderSettingDescriptor<ProviderConfigUnion>[] {
  return getProviderConfigManifest(providerId)
    .settings as readonly ProviderSettingDescriptor<ProviderConfigUnion>[];
}

function getEnabledCompatibleProvidersForTool(
  config: WebProvidersConfig,
  cwd: string,
  toolId: ProviderToolId,
): ProviderId[] {
  return getCompatibleProvidersForTool(toolId).filter((providerId) => {
    const providerConfig = config.providers?.[providerId] as
      | ProviderConfigUnion
      | undefined;
    if (providerConfig?.enabled !== true) {
      return false;
    }
    return PROVIDER_MAP[providerId].getStatus(
      providerConfig as never,
      cwd,
      toolId,
    ).available;
  });
}

function getSearchToolSettings(
  config: WebProvidersConfig,
): SearchToolSettings | undefined {
  return config.toolSettings?.search;
}

function getSearchPrefetchDefaults(
  config: WebProvidersConfig,
): SearchPrefetchSettings | undefined {
  return getSearchToolSettings(config)?.prefetch;
}

type GenericSettingId = keyof GenericSettingsConfig & string;

const GENERIC_SETTING_IDS: readonly GenericSettingId[] = [
  "requestTimeoutMs",
  "retryCount",
  "retryDelayMs",
  "researchPollIntervalMs",
  "researchTimeoutMs",
  "researchMaxConsecutivePollErrors",
] as const;

const GENERIC_SETTING_META: Record<
  GenericSettingId,
  {
    label: string;
    help: string;
    parse: (value: string) => number | undefined;
  }
> = {
  requestTimeoutMs: {
    label: "Request timeout (ms)",
    help: "Default maximum time to wait for a single provider request before failing that attempt. Applies to every provider unless overridden.",
    parse: (value) =>
      parseOptionalPositiveIntegerInput(
        value,
        "Request timeout must be a positive integer.",
      ),
  },
  retryCount: {
    label: "Retry count",
    help: "Default number of times transient provider failures should be retried. Applies to every provider unless overridden.",
    parse: (value) =>
      parseOptionalNonNegativeIntegerInput(
        value,
        "Retry count must be a non-negative integer.",
      ),
  },
  retryDelayMs: {
    label: "Retry delay (ms)",
    help: "Default initial delay before retrying failed requests. Later retries back off automatically. Applies to every provider unless overridden.",
    parse: (value) =>
      parseOptionalPositiveIntegerInput(
        value,
        "Retry delay must be a positive integer.",
      ),
  },
  researchPollIntervalMs: {
    label: "Research poll interval (ms)",
    help: "Default poll interval for long-running research jobs. Applies to research-capable providers unless overridden.",
    parse: (value) =>
      parseOptionalPositiveIntegerInput(
        value,
        "Research poll interval must be a positive integer.",
      ),
  },
  researchTimeoutMs: {
    label: "Research timeout (ms)",
    help: "Default maximum total time to wait for research before returning a resumable timeout error. Applies to research-capable providers unless overridden.",
    parse: (value) =>
      parseOptionalPositiveIntegerInput(
        value,
        "Research timeout must be a positive integer.",
      ),
  },
  researchMaxConsecutivePollErrors: {
    label: "Max poll errors",
    help: "Default number of consecutive poll failures to tolerate before stopping a local research run. Applies to research-capable providers unless overridden.",
    parse: (value) =>
      parseOptionalPositiveIntegerInput(
        value,
        "Max poll errors must be a positive integer.",
      ),
  },
};

function getGenericSettingValue(
  config: WebProvidersConfig,
  id: GenericSettingId,
): number | "mixed" | undefined {
  const explicitValue = config.genericSettings?.[id];
  if (typeof explicitValue === "number") {
    return explicitValue;
  }

  const values = new Set<number>();
  for (const providerId of PROVIDER_IDS) {
    const value = config.providers?.[providerId]?.policy?.[id];
    if (typeof value === "number") {
      values.add(value);
      if (values.size > 1) {
        return "mixed";
      }
    }
  }

  const [onlyValue] = values;
  return onlyValue;
}

function getGenericSettingDisplayValue(
  config: WebProvidersConfig,
  id: GenericSettingId,
): string {
  const value = getGenericSettingValue(config, id);
  if (value === "mixed") {
    return "mixed";
  }
  return summarizeStringValue(
    typeof value === "number" ? String(value) : undefined,
    false,
  );
}

function getGenericSettingRawValue(
  config: WebProvidersConfig,
  id: GenericSettingId,
): string {
  const value = getGenericSettingValue(config, id);
  return typeof value === "number" ? String(value) : "";
}

function ensureGenericSettings(
  config: WebProvidersConfig,
): GenericSettingsConfig {
  config.genericSettings = { ...(config.genericSettings ?? {}) };
  return config.genericSettings;
}

function cleanupGenericSettings(config: WebProvidersConfig): void {
  if (
    config.genericSettings &&
    Object.keys(config.genericSettings).length === 0
  ) {
    delete config.genericSettings;
  }
}

function stripGenericPolicyDuplicates(config: WebProvidersConfig): void {
  for (const providerId of PROVIDER_IDS) {
    const providerConfig = config.providers?.[providerId] as
      | ProviderConfigUnion
      | undefined;
    if (!providerConfig?.policy) {
      continue;
    }

    for (const key of GENERIC_SETTING_IDS) {
      if (providerConfig.policy[key] === config.genericSettings?.[key]) {
        delete providerConfig.policy[key];
      }
    }

    if (Object.keys(providerConfig.policy).length === 0) {
      delete providerConfig.policy;
    }
  }
}

class WebProvidersSettingsView implements Component {
  private config: WebProvidersConfig;
  private activeProvider: ProviderId;
  private activeSection: "provider" | "tools" | "generic" = "tools";
  private selection = {
    provider: 0,
    tools: 0,
    generic: 0,
  };
  private submenu: Component | undefined;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly done: (result: undefined) => void,
    private readonly ctx: ExtensionCommandContext,
    initialConfig: WebProvidersConfig,
    initialProvider: ProviderId,
  ) {
    this.config = structuredClone(initialConfig);
    this.activeProvider = initialProvider;
    this.selection.provider = Math.max(
      0,
      PROVIDERS.findIndex((provider) => provider.id === initialProvider),
    );
  }

  render(width: number): string[] {
    if (this.submenu) {
      return this.submenu.render(width);
    }

    const lines: string[] = [];
    const toolItems = this.buildToolSectionItems();
    lines.push(...this.renderSection(width, "Tools", "tools", toolItems));
    lines.push("");

    const providerItems = this.buildProviderSectionItems();
    lines.push(
      ...this.renderSection(width, "Providers", "provider", providerItems),
    );
    lines.push("");

    const genericItems = this.buildGenericSectionItems();
    lines.push(
      ...this.renderSection(width, "Generic Settings", "generic", genericItems),
    );

    const selected = this.getSelectedEntry();
    if (selected) {
      lines.push("");
      for (const line of wrapTextWithAnsi(
        selected.description,
        Math.max(10, width - 2),
      )) {
        lines.push(truncateToWidth(this.theme.fg("dim", line), width));
      }
    }

    lines.push("");
    lines.push(
      truncateToWidth(
        this.theme.fg(
          "dim",
          "↑↓ move · Tab/Shift+Tab switch section · Enter edit/open · Esc close",
        ),
        width,
      ),
    );

    return lines;
  }

  invalidate(): void {
    this.submenu?.invalidate();
  }

  handleInput(data: string): void {
    if (this.submenu) {
      this.submenu.handleInput?.(data);
      this.tui.requestRender();
      return;
    }

    const kb = getEditorKeybindings();
    const entries = this.getActiveSectionEntries();

    if (kb.matches(data, "selectUp")) {
      if (entries.length > 0) {
        this.moveSelection(-1);
      }
    } else if (kb.matches(data, "selectDown")) {
      if (entries.length > 0) {
        this.moveSelection(1);
      }
    } else if (matchesKey(data, Key.tab)) {
      this.moveSection(1);
    } else if (matchesKey(data, Key.shift("tab"))) {
      this.moveSection(-1);
    } else if (kb.matches(data, "selectConfirm") || data === " ") {
      void this.activateCurrentEntry();
    } else if (kb.matches(data, "selectCancel")) {
      this.done(undefined);
      return;
    }

    this.tui.requestRender();
  }

  private buildProviderSectionItems(): SettingsEntry[] {
    return PROVIDERS.map((provider) => {
      const providerConfig = this.config.providers?.[provider.id] as
        | ProviderConfigUnion
        | undefined;
      const status = provider.getStatus(providerConfig as never, this.ctx.cwd);
      const enabled = providerConfig?.enabled === true;
      return {
        id: `provider:${provider.id}`,
        label: provider.label,
        currentValue: enabled ? "on" : "off",
        description:
          provider.id === this.activeProvider
            ? `Press Enter to configure ${provider.label}'s provider-specific settings. Current status: ${status.summary}.`
            : `Move here and press Enter to configure ${provider.label}'s provider-specific settings. Current status: ${status.summary}.`,
        kind: "action",
      };
    });
  }

  private buildToolSectionItems(): SettingsEntry[] {
    return (Object.keys(CAPABILITY_TOOL_NAMES) as ProviderToolId[]).map(
      (toolId) => {
        const enabledCompatibleProviders = getEnabledCompatibleProvidersForTool(
          this.config,
          this.ctx.cwd,
          toolId,
        );
        const mappedProviderId = getMappedProviderIdForCapability(
          this.config,
          toolId,
        );
        const currentValue =
          mappedProviderId &&
          enabledCompatibleProviders.includes(mappedProviderId)
            ? PROVIDER_MAP[mappedProviderId].label
            : "off";
        const compatibleLabels = enabledCompatibleProviders.map(
          (providerId) => PROVIDER_MAP[providerId].label,
        );
        return {
          id: `tool:${toolId}`,
          label: PROVIDER_TOOL_META[toolId].label,
          currentValue,
          description:
            `Press Enter to configure web_${toolId}. ${PROVIDER_TOOL_META[toolId].help} Route web_${toolId} to one compatible provider or turn it off.` +
            (compatibleLabels.length > 0
              ? ` Enabled compatible providers: ${compatibleLabels.join(", ")}.`
              : ""),
          kind: "action",
        };
      },
    );
  }

  private buildGenericSectionItems(): SettingsEntry[] {
    return GENERIC_SETTING_IDS.map((id) => ({
      id: `generic:${id}`,
      label: GENERIC_SETTING_META[id].label,
      currentValue: getGenericSettingDisplayValue(this.config, id),
      description: GENERIC_SETTING_META[id].help,
      kind: "text",
    }));
  }

  private buildProviderItem(
    setting: ProviderSettingDescriptor<ProviderConfigUnion>,
    providerConfig: ProviderConfigUnion | undefined,
  ): SettingsEntry {
    if (setting.kind === "values") {
      return {
        id: setting.id,
        label: setting.label,
        currentValue: setting.getValue(providerConfig),
        values: setting.values,
        description: setting.help,
        kind: "cycle",
      };
    }

    const currentValue = setting.getValue(providerConfig);
    return {
      id: setting.id,
      label: setting.label,
      currentValue: summarizeStringValue(currentValue, setting.secret === true),
      description: setting.help,
      kind: "text",
    };
  }

  private getSectionEntries(
    section: "provider" | "tools" | "generic",
  ): SettingsEntry[] {
    if (section === "provider") return this.buildProviderSectionItems();
    if (section === "generic") return this.buildGenericSectionItems();
    return this.buildToolSectionItems();
  }

  private getActiveSectionEntries(): SettingsEntry[] {
    return this.getSectionEntries(this.activeSection);
  }

  private getSelectedEntry(): SettingsEntry | undefined {
    const entries = this.getActiveSectionEntries();
    return entries[this.selection[this.activeSection]];
  }

  private moveSection(direction: 1 | -1): void {
    const sections: Array<"provider" | "tools" | "generic"> = [
      "tools",
      "provider",
      "generic",
    ];
    const index = sections.indexOf(this.activeSection);
    for (let offset = 1; offset <= sections.length; offset++) {
      const next =
        sections[
          (index + offset * direction + sections.length) % sections.length
        ];
      if (this.getSectionEntries(next).length > 0) {
        this.activeSection = next;
        this.syncActiveProviderToSelection();
        return;
      }
    }
  }

  private moveSelection(direction: 1 | -1): void {
    const sections: Array<"provider" | "tools" | "generic"> = [
      "tools",
      "provider",
      "generic",
    ];
    const currentEntries = this.getActiveSectionEntries();
    const currentIndex = this.selection[this.activeSection];

    if (direction === -1 && currentIndex > 0) {
      this.selection[this.activeSection] = currentIndex - 1;
      this.syncActiveProviderToSelection();
      return;
    }

    if (direction === 1 && currentIndex < currentEntries.length - 1) {
      this.selection[this.activeSection] = currentIndex + 1;
      this.syncActiveProviderToSelection();
      return;
    }

    const startSectionIndex = sections.indexOf(this.activeSection);
    for (let offset = 1; offset <= sections.length; offset++) {
      const nextSection =
        sections[
          (startSectionIndex + offset * direction + sections.length) %
            sections.length
        ];
      const nextEntries = this.getSectionEntries(nextSection);
      if (nextEntries.length === 0) continue;

      this.activeSection = nextSection;
      this.selection[nextSection] =
        direction === 1 ? 0 : nextEntries.length - 1;
      this.syncActiveProviderToSelection();
      return;
    }
  }

  private syncActiveProviderToSelection(): void {
    if (this.activeSection !== "provider") {
      return;
    }
    const provider = PROVIDERS[this.selection.provider];
    if (!provider) {
      return;
    }
    this.activeProvider = provider.id;
  }

  private renderSection(
    width: number,
    title: string,
    section: "provider" | "tools" | "generic",
    entries: SettingsEntry[],
  ): string[] {
    const lines = [
      truncateToWidth(
        this.activeSection === section
          ? this.theme.fg("accent", this.theme.bold(title))
          : this.theme.bold(title),
        width,
      ),
    ];
    const labelWidth = Math.min(
      20,
      Math.max(...entries.map((entry) => entry.label.length), 0),
    );
    for (const [index, entry] of entries.entries()) {
      const selected =
        this.activeSection === section && this.selection[section] === index;
      const prefix = selected ? this.theme.fg("accent", "→ ") : "  ";
      const paddedLabel = entry.label.padEnd(labelWidth, " ");
      const label = selected
        ? this.theme.fg("accent", paddedLabel)
        : paddedLabel;
      if (entry.currentValue.trim().length === 0) {
        lines.push(truncateToWidth(`${prefix}${label}`, width));
        continue;
      }
      const value = selected
        ? this.theme.fg("accent", entry.currentValue)
        : this.theme.fg("muted", entry.currentValue);
      lines.push(truncateToWidth(`${prefix}${label}  ${value}`, width));
    }
    return lines;
  }

  private async activateCurrentEntry(): Promise<void> {
    const entry = this.getSelectedEntry();
    if (!entry) return;

    if (entry.id.startsWith("generic:")) {
      const settingId = entry.id.slice("generic:".length) as GenericSettingId;
      this.submenu = new TextValueSubmenu(
        this.tui,
        this.theme,
        entry.label,
        this.currentGenericSettingRawValue(settingId),
        entry.description,
        (selectedValue) => {
          this.submenu = undefined;
          if (selectedValue !== undefined) {
            void this.handleGenericSettingChange(settingId, selectedValue);
          }
          this.tui.requestRender();
        },
      );
      return;
    }

    if (entry.kind === "action" && entry.id.startsWith("tool:")) {
      const toolId = entry.id.slice("tool:".length) as ProviderToolId;
      this.submenu = new ToolSettingsSubmenu(
        this.tui,
        this.theme,
        toolId,
        this.ctx.cwd,
        () => this.config,
        async (mutate) => {
          await this.persist(mutate);
        },
        () => {
          this.submenu = undefined;
          this.tui.requestRender();
        },
      );
      return;
    }

    if (entry.kind === "action" && entry.id.startsWith("provider:")) {
      const providerId = entry.id.slice("provider:".length) as ProviderId;
      this.activeProvider = providerId;
      this.submenu = new ProviderSettingsSubmenu(
        this.tui,
        this.theme,
        providerId,
        () => this.currentProviderConfigFor(providerId),
        async (mutate) => {
          await this.persist((config) => {
            config.providers ??= {};
            const providerConfig = getEditableProviderConfig(
              providerId,
              config.providers?.[providerId] as ProviderConfigUnion | undefined,
            );
            mutate(providerConfig);
            config.providers[providerId] = providerConfig as never;
          });
        },
        () => {
          this.submenu = undefined;
          this.tui.requestRender();
        },
      );
      return;
    }
  }

  private currentGenericSettingRawValue(id: GenericSettingId): string {
    return getGenericSettingRawValue(this.config, id);
  }

  private async handleGenericSettingChange(
    id: GenericSettingId,
    value: string,
  ): Promise<void> {
    await this.persist((config) => {
      const parsed = GENERIC_SETTING_META[id].parse(value);
      const settings = ensureGenericSettings(config);
      if (parsed === undefined) {
        delete settings[id];
      } else {
        settings[id] = parsed;
      }
      cleanupGenericSettings(config);
      stripGenericPolicyDuplicates(config);
    });
  }

  private currentProviderConfigFor(
    providerId: ProviderId,
  ): ProviderConfigUnion | undefined {
    return this.config.providers?.[providerId] as
      | ProviderConfigUnion
      | undefined;
  }

  private async persist(
    mutate: (config: WebProvidersConfig) => void,
  ): Promise<void> {
    const nextConfig = structuredClone(this.config);
    try {
      mutate(nextConfig);
      cleanupGenericSettings(nextConfig);
      stripGenericPolicyDuplicates(nextConfig);
      await writeConfigFile(nextConfig);
      if (didContentsCacheInputsChange(this.config, nextConfig)) {
        resetContentStore();
      }
      this.config = nextConfig;
      this.tui.requestRender();
    } catch (error) {
      this.ctx.ui.notify((error as Error).message, "error");
    }
  }
}

class ToolSettingsSubmenu implements Component {
  private selection = 0;
  private submenu: Component | undefined;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly toolId: ProviderToolId,
    private readonly cwd: string,
    private readonly getConfig: () => WebProvidersConfig,
    private readonly persist: (
      mutate: (config: WebProvidersConfig) => void,
    ) => Promise<void>,
    private readonly done: () => void,
  ) {}

  render(width: number): string[] {
    if (this.submenu) {
      return this.submenu.render(width);
    }

    const entries = this.getEntries();
    const lines = [
      truncateToWidth(
        this.theme.fg("accent", PROVIDER_TOOL_META[this.toolId].label),
        width,
      ),
      "",
      ...this.renderEntries(width, entries),
    ];

    const selected = entries[this.selection];
    if (selected) {
      lines.push("");
      for (const line of wrapTextWithAnsi(
        selected.description,
        Math.max(10, width - 2),
      )) {
        lines.push(truncateToWidth(this.theme.fg("dim", line), width));
      }
    }

    lines.push("");
    lines.push(
      truncateToWidth(
        this.theme.fg("dim", "↑↓ move · Enter edit/toggle · Esc back"),
        width,
      ),
    );
    return lines;
  }

  invalidate(): void {
    this.submenu?.invalidate();
  }

  handleInput(data: string): void {
    if (this.submenu) {
      this.submenu.handleInput?.(data);
      this.tui.requestRender();
      return;
    }

    const kb = getEditorKeybindings();
    const entries = this.getEntries();

    if (kb.matches(data, "selectUp")) {
      if (this.selection > 0) {
        this.selection -= 1;
      }
    } else if (kb.matches(data, "selectDown")) {
      if (this.selection < entries.length - 1) {
        this.selection += 1;
      }
    } else if (kb.matches(data, "selectConfirm") || data === " ") {
      void this.activateCurrentEntry();
    } else if (kb.matches(data, "selectCancel")) {
      this.done();
      return;
    }

    this.tui.requestRender();
  }

  private getEntries(): SettingsEntry[] {
    const config = this.getConfig();
    const mappedProviderId = getMappedProviderIdForCapability(
      config,
      this.toolId,
    );
    const enabledProviderIds = getEnabledCompatibleProvidersForTool(
      config,
      this.cwd,
      this.toolId,
    );
    const providerValues = [
      "off",
      ...enabledProviderIds.map((providerId) => PROVIDER_MAP[providerId].label),
    ];
    const currentProviderValue =
      mappedProviderId && enabledProviderIds.includes(mappedProviderId)
        ? PROVIDER_MAP[mappedProviderId].label
        : "off";

    const entries: SettingsEntry[] = [
      {
        id: "provider",
        label: "Provider",
        currentValue: currentProviderValue,
        description: `Route web_${this.toolId} to one compatible enabled provider or turn it off.`,
        kind: "cycle",
        values: providerValues,
      },
    ];

    if (this.toolId === "search") {
      const prefetch = getSearchPrefetchDefaults(config);
      const prefetchProviderIds = getEnabledCompatibleProvidersForTool(
        config,
        this.cwd,
        "contents",
      );
      const prefetchValues = [
        "off",
        ...prefetchProviderIds.map(
          (providerId) => PROVIDER_MAP[providerId].label,
        ),
      ];
      const currentPrefetchProviderValue =
        prefetch?.provider && prefetchProviderIds.includes(prefetch.provider)
          ? PROVIDER_MAP[prefetch.provider].label
          : "off";

      entries.push(
        {
          id: "prefetchProvider",
          label: "Prefetch",
          currentValue: currentPrefetchProviderValue,
          description:
            "Optionally start background web_contents extraction after search using a contents-capable provider. Off means no prefetch.",
          kind: "cycle",
          values: prefetchValues,
        },
        {
          id: "prefetchMaxUrls",
          label: "Prefetch URLs",
          currentValue:
            prefetch?.maxUrls !== undefined
              ? String(prefetch.maxUrls)
              : "default",
          description:
            "Maximum number of search result URLs to prefetch. Leave blank to use the built-in default.",
          kind: "text",
        },
        {
          id: "prefetchTtlMs",
          label: "Prefetch TTL",
          currentValue:
            prefetch?.ttlMs !== undefined ? String(prefetch.ttlMs) : "default",
          description:
            "How long prefetched contents stay reusable in the local cache, in milliseconds. Leave blank to use the built-in default.",
          kind: "text",
        },
      );
    }

    return entries;
  }

  private renderEntries(width: number, entries: SettingsEntry[]): string[] {
    const labelWidth = Math.min(
      24,
      Math.max(...entries.map((entry) => entry.label.length), 0),
    );
    return entries.map((entry, index) => {
      const selected = this.selection === index;
      const prefix = selected ? this.theme.fg("accent", "→ ") : "  ";
      const paddedLabel = entry.label.padEnd(labelWidth, " ");
      const label = selected
        ? this.theme.fg("accent", paddedLabel)
        : paddedLabel;
      const value = selected
        ? this.theme.fg("accent", entry.currentValue)
        : this.theme.fg("muted", entry.currentValue);
      return truncateToWidth(`${prefix}${label}  ${value}`, width);
    });
  }

  private async activateCurrentEntry(): Promise<void> {
    const entry = this.getEntries()[this.selection];
    if (!entry) {
      return;
    }

    if (entry.kind === "cycle" && entry.values && entry.values.length > 0) {
      const currentIndex = entry.values.indexOf(entry.currentValue);
      const nextValue = entry.values[(currentIndex + 1) % entry.values.length];
      await this.handleChange(entry.id, nextValue);
      return;
    }

    if (entry.kind === "text") {
      const currentValue = this.getEntryRawValue(entry.id);
      this.submenu = new TextValueSubmenu(
        this.tui,
        this.theme,
        entry.label,
        currentValue,
        entry.description,
        (selectedValue) => {
          this.submenu = undefined;
          if (selectedValue !== undefined) {
            void this.handleChange(entry.id, selectedValue);
          }
          this.tui.requestRender();
        },
      );
    }
  }

  private getEntryRawValue(id: string): string {
    const prefetch = getSearchPrefetchDefaults(this.getConfig());
    switch (id) {
      case "prefetchMaxUrls":
        return prefetch?.maxUrls !== undefined ? String(prefetch.maxUrls) : "";
      case "prefetchTtlMs":
        return prefetch?.ttlMs !== undefined ? String(prefetch.ttlMs) : "";
      default:
        return "";
    }
  }

  private async handleChange(id: string, value: string): Promise<void> {
    await this.persist((config) => {
      switch (id) {
        case "provider":
          config.tools ??= {};
          config.tools[this.toolId] =
            value === "off"
              ? null
              : (getEnabledCompatibleProvidersForTool(
                  config,
                  this.cwd,
                  this.toolId,
                ).find(
                  (providerId) => PROVIDER_MAP[providerId].label === value,
                ) ?? null);
          return;
        case "prefetchProvider": {
          const providerId =
            value === "off"
              ? null
              : (getEnabledCompatibleProvidersForTool(
                  config,
                  this.cwd,
                  "contents",
                ).find(
                  (candidate) => PROVIDER_MAP[candidate].label === value,
                ) ?? null);
          ensureSearchToolSettings(config).prefetch ??= {};
          ensureSearchToolSettings(config).prefetch!.provider = providerId;
          return;
        }
        case "prefetchMaxUrls":
          ensureSearchToolSettings(config).prefetch ??= {};
          ensureSearchToolSettings(config).prefetch!.maxUrls =
            parseOptionalPositiveIntegerInput(
              value,
              "Prefetch URLs must be a positive integer.",
            );
          return;
        case "prefetchTtlMs":
          ensureSearchToolSettings(config).prefetch ??= {};
          ensureSearchToolSettings(config).prefetch!.ttlMs =
            parseOptionalPositiveIntegerInput(
              value,
              "Prefetch TTL must be a positive integer.",
            );
          return;
        default:
          throw new Error(`Unknown tool setting '${id}'.`);
      }
    });
  }
}

class ProviderSettingsSubmenu implements Component {
  private selection = 0;
  private submenu: Component | undefined;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly providerId: ProviderId,
    private readonly getProviderConfig: () => ProviderConfigUnion | undefined,
    private readonly persist: (
      mutate: (config: ProviderConfigUnion) => void,
    ) => Promise<void>,
    private readonly done: () => void,
  ) {}

  render(width: number): string[] {
    if (this.submenu) {
      return this.submenu.render(width);
    }

    const provider = PROVIDER_MAP[this.providerId];
    const providerConfig = this.getProviderConfig();
    const entries = this.getEntries();
    const lines = [
      truncateToWidth(this.theme.fg("accent", provider.label), width),
      "",
      ...this.renderEntries(width, entries),
    ];

    const selected = entries[this.selection];
    if (selected) {
      lines.push("");
      for (const line of wrapTextWithAnsi(
        selected.description,
        Math.max(10, width - 2),
      )) {
        lines.push(truncateToWidth(this.theme.fg("dim", line), width));
      }
    }

    const status = provider.getStatus(providerConfig as never, "");
    lines.push("");
    lines.push(
      truncateToWidth(this.theme.fg("dim", `Status: ${status.summary}`), width),
    );
    lines.push(
      truncateToWidth(
        this.theme.fg("dim", "↑↓ move · Enter edit/toggle · Esc back"),
        width,
      ),
    );
    return lines;
  }

  invalidate(): void {
    this.submenu?.invalidate();
  }

  handleInput(data: string): void {
    if (this.submenu) {
      this.submenu.handleInput?.(data);
      this.tui.requestRender();
      return;
    }

    const kb = getEditorKeybindings();
    const entries = this.getEntries();

    if (kb.matches(data, "selectUp")) {
      if (this.selection > 0) {
        this.selection -= 1;
      }
    } else if (kb.matches(data, "selectDown")) {
      if (this.selection < entries.length - 1) {
        this.selection += 1;
      }
    } else if (kb.matches(data, "selectConfirm") || data === " ") {
      void this.activateCurrentEntry();
    } else if (kb.matches(data, "selectCancel")) {
      this.done();
      return;
    }

    this.tui.requestRender();
  }

  private getEntries(): SettingsEntry[] {
    const providerConfig = this.getProviderConfig();
    return [
      {
        id: "providerEnabled",
        label: "Enabled",
        currentValue: providerConfig?.enabled === true ? "on" : "off",
        description:
          "Whether this provider is eligible for tool mappings and runtime use.",
        kind: "cycle",
        values: ["on", "off"],
      },
      ...getProviderSettings(this.providerId).map((setting) =>
        this.buildProviderItem(setting, providerConfig),
      ),
    ];
  }

  private buildProviderItem(
    setting: ProviderSettingDescriptor<ProviderConfigUnion>,
    providerConfig: ProviderConfigUnion | undefined,
  ): SettingsEntry {
    if (setting.kind === "values") {
      return {
        id: setting.id,
        label: setting.label,
        currentValue: setting.getValue(providerConfig),
        values: setting.values,
        description: setting.help,
        kind: "cycle",
      };
    }

    const currentValue = setting.getValue(providerConfig);
    return {
      id: setting.id,
      label: setting.label,
      currentValue: summarizeStringValue(currentValue, setting.secret === true),
      description: setting.help,
      kind: "text",
    };
  }

  private renderEntries(width: number, entries: SettingsEntry[]): string[] {
    const labelWidth = Math.min(
      24,
      Math.max(...entries.map((entry) => entry.label.length), 0),
    );
    return entries.map((entry, index) => {
      const selected = this.selection === index;
      const prefix = selected ? this.theme.fg("accent", "→ ") : "  ";
      const paddedLabel = entry.label.padEnd(labelWidth, " ");
      const label = selected
        ? this.theme.fg("accent", paddedLabel)
        : paddedLabel;
      const value = selected
        ? this.theme.fg("accent", entry.currentValue)
        : this.theme.fg("muted", entry.currentValue);
      return truncateToWidth(`${prefix}${label}  ${value}`, width);
    });
  }

  private async activateCurrentEntry(): Promise<void> {
    const entry = this.getEntries()[this.selection];
    if (!entry) return;

    if (entry.kind === "cycle" && entry.values && entry.values.length > 0) {
      const currentIndex = entry.values.indexOf(entry.currentValue);
      const nextValue = entry.values[(currentIndex + 1) % entry.values.length];
      await this.handleChange(entry.id, nextValue);
      return;
    }

    if (entry.kind === "text") {
      const currentValue = this.getEntryRawValue(entry.id) ?? "";
      this.submenu = new TextValueSubmenu(
        this.tui,
        this.theme,
        entry.label,
        currentValue,
        entry.description,
        (selectedValue) => {
          this.submenu = undefined;
          if (selectedValue !== undefined) {
            void this.handleChange(entry.id, selectedValue);
          }
          this.tui.requestRender();
        },
      );
    }
  }

  private getEntryRawValue(id: string): string | undefined {
    const providerConfig = this.getProviderConfig();
    const setting = getProviderSettings(this.providerId).find(
      (candidate) => candidate.id === id,
    );
    if (!setting || setting.kind !== "text") {
      return undefined;
    }
    return setting.getValue(providerConfig);
  }

  private async handleChange(id: string, value: string): Promise<void> {
    await this.persist((providerConfig) => {
      if (id === "providerEnabled") {
        providerConfig.enabled = value === "on";
        return;
      }

      const setting = getProviderSettings(this.providerId).find(
        (candidate) => candidate.id === id,
      );
      if (!setting) {
        throw new Error(`Unknown setting '${id}'.`);
      }
      setting.setValue(providerConfig, value);
    });
  }
}

function ensureSearchToolSettings(
  config: WebProvidersConfig,
): SearchToolSettings {
  config.toolSettings ??= {};
  config.toolSettings.search ??= {};
  return config.toolSettings.search;
}

function parseOptionalPositiveIntegerInput(
  value: string,
  errorMessage: string,
): number | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(errorMessage);
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(errorMessage);
  }
  return parsed;
}

function parseOptionalNonNegativeIntegerInput(
  value: string,
  errorMessage: string,
): number | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(errorMessage);
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(errorMessage);
  }
  return parsed;
}

class TextValueSubmenu implements Component {
  private readonly editor: Editor;

  constructor(
    tui: TUI,
    private readonly theme: Theme,
    private readonly title: string,
    initialValue: string,
    private readonly help: string,
    private readonly done: (selectedValue?: string) => void,
  ) {
    const editorTheme: EditorTheme = {
      borderColor: (text) => this.theme.fg("accent", text),
      selectList: {
        selectedPrefix: (text) => this.theme.fg("accent", text),
        selectedText: (text) => this.theme.fg("accent", text),
        description: (text) => this.theme.fg("muted", text),
        scrollInfo: (text) => this.theme.fg("dim", text),
        noMatch: (text) => this.theme.fg("warning", text),
      },
    };

    this.editor = new Editor(tui, editorTheme);
    this.editor.setText(initialValue);
    this.editor.onSubmit = (text) => {
      this.done(text.trim());
    };
  }

  render(width: number): string[] {
    return [
      truncateToWidth(this.theme.fg("accent", this.title), width),
      "",
      ...this.editor.render(width),
      "",
      truncateToWidth(this.theme.fg("dim", this.help), width),
      truncateToWidth(
        this.theme.fg(
          "dim",
          "Enter to save · Shift+Enter for newline · Esc to cancel",
        ),
        width,
      ),
    ];
  }

  invalidate(): void {
    this.editor.invalidate();
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.done(undefined);
      return;
    }
    this.editor.handleInput(data);
  }
}

function getEditableProviderConfig(
  providerId: ProviderId,
  current: ProviderConfigUnion | undefined,
): ProviderConfigUnion {
  return structuredClone(
    current ?? PROVIDER_MAP[providerId].createTemplate(),
  ) as ProviderConfigUnion;
}

function getInitialProviderSelection(config: WebProvidersConfig): ProviderId {
  for (const capability of Object.keys(
    CAPABILITY_TOOL_NAMES,
  ) as ProviderCapability[]) {
    const providerId = getMappedProviderIdForCapability(config, capability);
    if (providerId) {
      return providerId;
    }
  }

  return "codex";
}

function didContentsCacheInputsChange(
  previous: WebProvidersConfig,
  next: WebProvidersConfig,
): boolean {
  return (
    stableStringify(getContentsCacheInputs(previous)) !==
    stableStringify(getContentsCacheInputs(next))
  );
}

function getContentsCacheInputs(config: WebProvidersConfig): JsonObject {
  const providers: Record<string, unknown> = {};

  for (const provider of PROVIDERS) {
    if (!supportsProviderCapability(provider, "contents")) {
      continue;
    }
    providers[provider.id] =
      config.providers?.[
        provider.id as keyof NonNullable<WebProvidersConfig["providers"]>
      ] ?? null;
  }

  return { providers: providers as JsonObject };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringify(
          (value as Record<string, unknown>)[key],
        )}`,
    )
    .join(",")}}`;
}

function summarizeStringValue(
  value: string | undefined,
  secret: boolean,
): string {
  if (!value) return "unset";
  if (secret) {
    if (value.startsWith("!")) return "!command";
    if (/^[A-Z][A-Z0-9_]*$/.test(value)) return `env:${value}`;
    return "literal";
  }
  return truncateInline(value, 40);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampResults(value?: number): number {
  if (value === undefined) return DEFAULT_MAX_RESULTS;
  return Math.min(Math.max(Math.trunc(value), 1), MAX_ALLOWED_RESULTS);
}

function resolveSearchQueries(queries: string[]): string[] {
  if (queries.length === 0) {
    throw new Error("queries must contain at least one item.");
  }

  return queries.map((value, index) =>
    normalizeSearchQuery(value, `queries[${index}]`),
  );
}

function resolveAnswerQueries(queries: string[]): string[] {
  if (queries.length === 0) {
    throw new Error("queries must contain at least one item.");
  }

  return queries.map((value, index) =>
    normalizeSearchQuery(value, `queries[${index}]`),
  );
}

function normalizeSearchQuery(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return normalized;
}

function getSearchQueriesForDisplay(queries?: string[]): string[] {
  if (!Array.isArray(queries)) {
    return [];
  }

  return queries
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
}

function getAnswerQueriesForDisplay(queries: string[]): string[] {
  return getSearchQueriesForDisplay(queries);
}

function createBatchProgressReporter(
  report: ((message: string) => void) | undefined,
  queries: string[],
  index: number,
): ((message: string) => void) | undefined {
  if (!report) {
    return undefined;
  }

  if (queries.length <= 1) {
    return report;
  }

  const label = `${index + 1}/${queries.length}`;
  return (message: string) => {
    report(`${message} (${label})`);
  };
}

function buildWebSearchDetails(
  provider: ProviderId,
  outcomes: SearchQueryOutcome[],
): WebSearchDetails {
  return {
    tool: "web_search",
    provider,
    queryCount: outcomes.length,
    failedQueryCount: outcomes.filter((outcome) => outcome.error !== undefined)
      .length,
    resultCount: outcomes.reduce(
      (count, outcome) => count + (outcome.response?.results.length ?? 0),
      0,
    ),
  };
}

function extractTextContent(
  content: Array<{ type: string; text?: string }> | undefined,
): string | undefined {
  if (!content || content.length === 0) {
    return undefined;
  }
  const text = content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text?.trimEnd() ?? "")
    .join("\n")
    .trim();
  return text.length > 0 ? text : undefined;
}

function renderCallHeader(
  params: {
    queries?: string[];
    maxResults?: number;
  },
  theme: Theme,
): Component {
  const maxResultsSuffix =
    params.maxResults !== undefined && params.maxResults !== DEFAULT_MAX_RESULTS
      ? ` (max ${params.maxResults})`
      : undefined;

  return renderListCallHeader(
    "web_search",
    getSearchQueriesForDisplay(params.queries),
    theme,
    {
      singleItemFormatter: (query) => formatQuotedPreview(query),
      suffix: maxResultsSuffix,
    },
  );
}

function renderMarkdownBlock(text: string): Markdown | Text {
  if (!text) {
    return new Text("", 0, 0);
  }
  return new Markdown(`\n${text}`, 0, 0, getMarkdownTheme());
}

function renderBlockText(
  text: string,
  theme: Pick<Theme, "fg">,
  color: "toolOutput" | "error",
): Text {
  if (!text) {
    return new Text("", 0, 0);
  }
  const rendered = text
    .split("\n")
    .map((line) => theme.fg(color, line))
    .join("\n");
  return new Text(`\n${rendered}`, 0, 0);
}

function renderSimpleText(
  text: string,
  theme: Pick<Theme, "fg">,
  color: "warning" | "muted" | "success",
): Text {
  return new Text(theme.fg(color, text), 0, 0);
}

function renderCollapsedSearchSummary(
  details: WebSearchDetails,
  _text: string | undefined,
  theme: Pick<Theme, "fg">,
): Text {
  const count = `${details.resultCount} result${details.resultCount === 1 ? "" : "s"}`;
  const failureSuffix =
    details.failedQueryCount > 0 ? `, ${details.failedQueryCount} failed` : "";
  const base =
    details.queryCount > 1
      ? `${details.queryCount} queries, ${count} via ${details.provider}${failureSuffix}`
      : `${count} via ${details.provider}${failureSuffix}`;
  let summary = theme.fg("success", base);
  summary += theme.fg("muted", ` (${getExpandHint()})`);
  return new Text(summary, 0, 0);
}

function appendProviderSummary(summary: string, provider: ProviderId): string {
  const providerSuffix = `via ${provider}`;
  return summary.toLowerCase().includes(providerSuffix)
    ? summary
    : `${summary} ${providerSuffix}`;
}

function getFirstLine(text: string | undefined): string | undefined {
  if (!text) {
    return undefined;
  }
  const firstLine = text.split("\n", 1)[0]?.trim();
  return firstLine && firstLine.length > 0 ? firstLine : undefined;
}

function getExpandHint(): string {
  try {
    return keyHint("expandTools", "to expand");
  } catch {
    return "to expand";
  }
}

function cleanSingleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function formatQuotedPreview(text: string, maxLength = 80): string {
  return `"${truncateInline(cleanSingleLine(text), maxLength)}"`;
}

function formatSearchResponses(
  outcomes: SearchQueryOutcome[],
  prefetch?: { prefetchId: string; provider: ProviderId; urlCount: number },
): string {
  const body = outcomes
    .map((outcome, index) =>
      formatSearchOutcomeSection(outcome, index, outcomes.length),
    )
    .join("\n\n");

  if (!prefetch) {
    return body;
  }

  return `${body}\n\n---\n\nBackground contents prefetch started via ${prefetch.provider} for ${prefetch.urlCount} URL(s). Prefetch id: ${prefetch.prefetchId}`;
}

function formatSearchOutcomeSection(
  outcome: SearchQueryOutcome,
  index: number,
  total: number,
): string {
  const heading =
    total > 1
      ? `## Query ${index + 1}: ${formatSearchHeading(outcome.query)}`
      : `## ${formatSearchHeading(outcome.query)}`;
  const body = outcome.response
    ? formatSearchResponseMarkdown(outcome.response)
    : `Search failed: ${outcome.error ?? "Unknown error."}`;
  return `${heading}\n\n${body}`;
}

function formatSearchHeading(query: string): string {
  return `"${escapeMarkdownText(cleanSingleLine(query))}"`;
}

function formatAnswerHeading(query: string): string {
  return `"${escapeMarkdownText(cleanSingleLine(query))}"`;
}

function collectSearchResultUrls(outcomes: SearchQueryOutcome[]): string[] {
  return outcomes.flatMap(
    (outcome) => outcome.response?.results.map((result) => result.url) ?? [],
  );
}

function formatSearchResponseMarkdown(response: SearchResponse): string {
  if (response.results.length === 0) {
    return "No results found.";
  }

  return response.results
    .map((result, index) => {
      const lines = [
        `${index + 1}. ${formatMarkdownLink(result.title, result.url)}`,
      ];
      if (result.snippet) {
        lines.push(`   ${escapeMarkdownText(cleanSingleLine(result.snippet))}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

function formatMarkdownLink(label: string, url: string): string {
  return `[${escapeMarkdownLinkLabel(label)}](<${url}>)`;
}

function escapeMarkdownLinkLabel(text: string): string {
  return cleanSingleLine(text).replaceAll("\\", "\\\\").replaceAll("]", "\\]");
}

function escapeMarkdownText(text: string): string {
  return text
    .replaceAll("\\", "\\\\")
    .replaceAll("*", "\\*")
    .replaceAll("_", "\\_")
    .replaceAll("`", "\\`")
    .replaceAll("#", "\\#")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
}

async function truncateAndSave(text: string, prefix: string): Promise<string> {
  const truncation = truncateHead(text, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  if (!truncation.truncated) return truncation.content;

  const dir = join(tmpdir(), `pi-web-providers-${prefix}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  const fullPath = join(dir, "output.txt");
  await writeFile(fullPath, text, "utf-8");

  return (
    truncation.content +
    `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines ` +
    `(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). ` +
    `Full output saved to: ${fullPath}]`
  );
}

function renderExpandableText(
  result: { content?: Array<{ type: string; text?: string }> },
  expanded: boolean,
  theme: Theme,
): Text {
  const text = result.content?.find((part) => part.type === "text")?.text ?? "";
  if (!expanded) {
    return new Text(theme.fg("success", "✓ Done"), 0, 0);
  }
  const body = text
    .split("\n")
    .map((line) => theme.fg("toolOutput", line))
    .join("\n");
  return new Text(`\n${body}`, 0, 0);
}

function truncateInline(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

export const __test__ = {
  didContentsCacheInputsChange,
  executeAnswerTool,
  executeProviderTool,
  executeSearchTool,
  extractTextContent,
  getAvailableManagedToolNames,
  getEnabledCompatibleProvidersForTool,
  describeOptionsField,
  getAvailableProviderIdsForCapability,
  getSyncedActiveTools,
  renderCallHeader,
  renderQuestionCallHeader,
  renderResearchCallHeader,
  renderToolCallHeader,
  renderCollapsedSearchSummary,
  renderCollapsedProviderToolSummary,
  renderSearchToolResult,
  renderProviderToolResult,
  formatSearchResponses,
  formatAnswerResponses,
};
