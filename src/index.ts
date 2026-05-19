import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  formatSize,
  getMarkdownTheme,
  type Theme,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import {
  Box,
  type Component,
  Editor,
  type EditorTheme,
  getKeybindings,
  Key,
  Markdown,
  matchesKey,
  Text,
  type TUI,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { type TObject, Type } from "typebox";
import { loadConfig, writeConfigFile } from "./config.js";
import { type ContentsResponse, renderContentsAnswers } from "./contents.js";
import { formatElapsed, formatErrorMessage } from "./execution-policy.js";
import {
  CAPABILITY_TOOL_NAMES,
  getAvailableManagedToolNames,
  getAvailableProviderIdsForCapability,
  getProviderStatusForTool,
  getSyncedActiveTools,
  MANAGED_TOOL_NAMES,
  refreshManagedTools as refreshManagedToolsAvailability,
  refreshManagedToolsOnStartup as refreshManagedToolsOnStartupAvailability,
  type ManagedToolRegistration,
} from "./managed-tools.js";
import { buildToolOptionsSchema, type ToolOptionsFor } from "./options.js";
import {
  cleanupContentStore,
  DEFAULT_CONTENT_TTL_MS,
  DEFAULT_PREFETCH_MAX_URLS,
  mergeSearchContentsPrefetchOptions,
  resetContentStore,
  resolveContentsFromStore,
  startContentsPrefetch,
} from "./prefetch-manager.js";
import {
  getProviderConfigManifest,
  type ProviderSettingDescriptor,
} from "./provider-config-manifests.js";
import {
  formatProviderCapabilityStatus,
  getEffectiveProviderConfig,
  getEffectiveSharedSettings,
  getMappedProviderIdForTool,
  getProviderCapabilityStatus,
  getProviderSetupState,
  isProviderCapabilityReady,
  resolveProviderForTool,
  resolveSearchProvider,
  supportsTool,
} from "./provider-resolution.js";
import {
  executeProviderExecution,
  executeProviderRequest,
  type ProviderExecution,
} from "./provider-runtime.js";
import {
  getCompatibleProviders,
  getProviderTools,
  TOOL_INFO,
} from "./provider-tools.js";
import {
  PROVIDER_IDS,
  PROVIDER_LIST,
  PROVIDERS_BY_ID,
} from "./providers/index.js";
import {
  buildCollapsedProviderToolSummary as buildDisplayCollapsedProviderToolSummary,
  buildCollapsedProviderToolSummaryParts as buildDisplayCollapsedProviderToolSummaryParts,
  buildProgressDisplay as buildDisplayProgress,
  buildProviderToolDisplay as buildDisplayProviderToolDisplay,
  buildSearchSummaryParts as buildDisplaySearchSummaryParts,
  buildSearchToolDisplay as buildDisplaySearchToolDisplay,
} from "./tool-display.js";
import {
  type ActiveWebResearchTask,
  cancelWebResearchTask,
  dispatchWebResearch as dispatchWebResearchLifecycle,
  formatWebResearchResultMessage,
  getActiveWebResearchRequests,
  getWebResearchTaskSnapshots,
  loadWebResearchHistory,
  loadWebResearchPreview,
  waitForPendingResearchTasks,
} from "./web-research-lifecycle.js";
import { WebResearchManagerView } from "./web-research-view.js";
import type {
  Claude,
  Codex,
  Exa,
  ExecutionSettings,
  Gemini,
  Parallel,
  ProviderConfig,
  ProviderId,
  ProviderRequest,
  SearchResponse,
  SearchSettings,
  Settings,
  Tool,
  ToolDetails,
  ToolDisplayDetails,
  ToolOutput,
  Valyu,
  WebProviders,
  WebResearchRequest,
  WebResearchResult,
  WebSearchDetails,
} from "./types.js";

const DEFAULT_MAX_RESULTS = 5;
const MAX_ALLOWED_RESULTS = 20;
const MAX_SEARCH_QUERIES = 10;
const RESEARCH_HEARTBEAT_MS = 15000;
const WEB_RESEARCH_RESULT_MESSAGE_TYPE = "web-research-result";
const WEB_RESEARCH_WIDGET_KEY = "web-research-jobs";

type ToolUpdateCallback =
  | ((update: {
      content: Array<{ type: "text"; text: string }>;
      details: {};
      display?: ToolDisplayDetails;
    }) => void)
  | undefined;

type ProgressCallback =
  | ((message: string, display?: ToolDisplayDetails) => void)
  | undefined;

interface ToolExecutionContext {
  cwd: string;
  signal?: AbortSignal;
  progress?: (message: string) => void;
}

interface SearchToolRequest {
  queries: string[];
  maxResults?: number;
  options?: ToolOptionsFor<"search">;
}

interface AnswerToolRequest {
  queries: string[];
  options?: ToolOptionsFor<"answer">;
}

interface ProviderToolRequest<TCapability extends Exclude<Tool, "search">> {
  capability: TCapability;
  options?: ToolOptionsFor<TCapability>;
  urls?: string[];
  query?: string;
  input?: string;
}

interface ResearchToolRequest {
  input: string;
  options?: ToolOptionsFor<"research">;
}

const DEFAULT_SUMMARY_SYMBOLS = {
  success: "✔",
  failure: "✘",
};

type SummarySymbols = typeof DEFAULT_SUMMARY_SYMBOLS;

export default function webProvidersExtension(pi: ExtensionAPI) {
  const activeWebResearchRequests = new Map<string, ActiveWebResearchTask>();
  let latestWidgetContext: Pick<ExtensionContext, "hasUI" | "ui"> | undefined;
  let webResearchWidgetTimer: ReturnType<typeof setInterval> | undefined;

  const stopWebResearchWidgetTimer = (): void => {
    if (webResearchWidgetTimer) {
      clearInterval(webResearchWidgetTimer);
      webResearchWidgetTimer = undefined;
    }
  };

  const ensureWebResearchWidgetTimer = (): void => {
    if (webResearchWidgetTimer || activeWebResearchRequests.size === 0) {
      return;
    }
    webResearchWidgetTimer = setInterval(() => {
      updateWebResearchWidget();
    }, 1000);
  };

  const updateWebResearchWidget = (
    ctx?: Pick<ExtensionContext, "hasUI" | "ui">,
  ): void => {
    const widgetContext = ctx ?? latestWidgetContext;
    if (!widgetContext) {
      return;
    }

    latestWidgetContext = widgetContext;
    if (!widgetContext.hasUI) {
      stopWebResearchWidgetTimer();
      return;
    }

    if (activeWebResearchRequests.size === 0) {
      stopWebResearchWidgetTimer();
      widgetContext.ui.setWidget(WEB_RESEARCH_WIDGET_KEY, undefined);
      return;
    }

    ensureWebResearchWidgetTimer();
    widgetContext.ui.setWidget(
      WEB_RESEARCH_WIDGET_KEY,
      buildWebResearchWidgetLines(
        getActiveWebResearchRequests(activeWebResearchRequests),
        widgetContext.ui.theme,
      ),
    );
  };

  if ("registerMessageRenderer" in pi) {
    pi.registerMessageRenderer(
      WEB_RESEARCH_RESULT_MESSAGE_TYPE,
      (message, state, theme) =>
        renderWebResearchResultMessage(message, state, theme),
    );
  }

  pi.registerCommand("web-providers", {
    description: "Configure web search providers",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("web-providers requires interactive mode", "error");
        return;
      }

      await runWebProvidersConfig(
        pi,
        { activeWebResearchRequests, updateWebResearchWidget },
        ctx,
      );
    },
  });

  pi.registerCommand("web-research", {
    description: "Manage web research jobs",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("web-research requires interactive mode", "error");
        return;
      }

      let timer: ReturnType<typeof setInterval> | undefined;
      try {
        await ctx.ui.custom((tui, theme, _keybindings, done) => {
          const view = new WebResearchManagerView(
            tui,
            theme,
            done,
            ctx.cwd,
            activeWebResearchRequests,
            () => updateWebResearchWidget(ctx),
          );
          timer = setInterval(() => view.refresh(), 1000);
          return view;
        });
      } finally {
        if (timer) clearInterval(timer);
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    latestWidgetContext = ctx;
    resetContentStore();
    updateWebResearchWidget(ctx);
    await refreshManagedToolsOnStartup(
      pi,
      { activeWebResearchRequests, updateWebResearchWidget },
      ctx.cwd,
      { addAvailable: true },
    );
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    latestWidgetContext = ctx;
    await cleanupContentStore();
    updateWebResearchWidget(ctx);
    await refreshManagedToolsOnStartup(
      pi,
      { activeWebResearchRequests, updateWebResearchWidget },
      ctx.cwd,
      { addAvailable: false },
    );
  });

  pi.on("session_shutdown", async () => {
    stopWebResearchWidgetTimer();
    latestWidgetContext?.ui.setWidget(WEB_RESEARCH_WIDGET_KEY, undefined);
  });
}

function registerManagedTools(
  pi: ExtensionAPI,
  webResearchLifecycle: {
    activeWebResearchRequests: Map<string, ActiveWebResearchTask>;
    updateWebResearchWidget: (
      ctx?: Pick<ExtensionContext, "hasUI" | "ui">,
    ) => void;
  },
  providerIdsByCapability: ManagedToolRegistration = {},
): void {
  registerWebSearchTool(pi, providerIdsByCapability.search ?? []);
  registerWebContentsTool(pi, providerIdsByCapability.contents ?? []);
  registerWebAnswerTool(pi, providerIdsByCapability.answer ?? []);
  registerWebResearchTool(
    pi,
    webResearchLifecycle,
    providerIdsByCapability.research ?? [],
  );
}

function registerWebSearchTool(
  pi: ExtensionAPI,
  providerIds: readonly ProviderId[],
): void {
  if (providerIds.length !== 1) return;

  const selectedProviderId = providerIds[0];
  const maxAllowedResults = getSearchMaxResultsLimit(selectedProviderId);

  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      `Find likely sources on the public web for up to ${MAX_SEARCH_QUERIES} queries in a single call and return titles, URLs, and snippets grouped by query. ` +
      `Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)} when needed.`,
    promptGuidelines: buildPromptGuidelines("search", selectedProviderId, [
      "Batch related searches when grouped comparison matters; use separate sibling web_search calls when independent results should surface as soon as they are ready.",
    ]),
    parameters: Type.Object(
      {
        queries: Type.Array(Type.String({ minLength: 1 }), {
          minItems: 1,
          maxItems: MAX_SEARCH_QUERIES,
          description: `One or more search queries to run in one call (max ${MAX_SEARCH_QUERIES})`,
        }),
        maxResults: Type.Optional(
          Type.Integer({
            minimum: 1,
            maximum: maxAllowedResults,
            description: `Maximum number of results to return (default: ${DEFAULT_MAX_RESULTS})`,
          }),
        ),
        ...optionalField(
          "options",
          buildStructuredOptionsSchema("search", selectedProviderId),
        ),
      },
      { additionalProperties: false },
    ),

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      return executeSearchTool({
        config: await loadConfig(),
        request: {
          queries: params.queries,
          maxResults: params.maxResults,
          options: (params as SearchToolRequest).options,
        },
        context: {
          cwd: ctx.cwd,
          signal: signal ?? undefined,
          progress: createProgressEmitter(onUpdate),
        },
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
  if (providerIds.length !== 1) return;

  const selectedProviderId = providerIds[0];

  pi.registerTool({
    name: "web_contents",
    label: "Web Contents",
    description:
      "Read and extract the main contents of one or more web pages. Batch related pages together, or use separate sibling calls when each page can be acted on independently.",
    parameters: Type.Object(
      {
        urls: Type.Array(Type.String({ minLength: 1 }), {
          minItems: 1,
          description: "One or more URLs to extract",
        }),
        ...optionalField(
          "options",
          buildStructuredOptionsSchema("contents", selectedProviderId),
        ),
      },
      { additionalProperties: false },
    ),
    promptGuidelines: buildPromptGuidelines("contents", selectedProviderId, []),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      return executeProviderTool({
        config: await loadConfig(),
        request: {
          capability: "contents",
          urls: params.urls,
          options: (params as ProviderToolRequest<"contents">).options,
        },
        context: {
          cwd: ctx.cwd,
          signal: signal ?? undefined,
          progress: createProgressEmitter(onUpdate),
        },
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
        { markdownWhenExpanded: true },
      );
    },
  });
}

function registerWebAnswerTool(
  pi: ExtensionAPI,
  providerIds: readonly ProviderId[],
): void {
  if (providerIds.length !== 1) return;

  const selectedProviderId = providerIds[0];

  pi.registerTool({
    name: "web_answer",
    label: "Web Answer",
    description: `Answer one or more simple factual questions using web-grounded evidence (up to ${MAX_SEARCH_QUERIES} per call). Prefer web_search plus web_contents when source selection matters, and web_research for multi-step investigations.`,
    parameters: Type.Object(
      {
        queries: Type.Array(Type.String({ minLength: 1 }), {
          minItems: 1,
          maxItems: MAX_SEARCH_QUERIES,
          description: `One or more simple factual questions to answer in one call (max ${MAX_SEARCH_QUERIES})`,
        }),
        ...optionalField(
          "options",
          buildStructuredOptionsSchema("answer", selectedProviderId),
        ),
      },
      { additionalProperties: false },
    ),
    promptGuidelines: buildPromptGuidelines("answer", selectedProviderId, [
      "Use web_answer as a quick grounded-answer shortcut for simple factual questions, not as a replacement for inspecting sources or doing deeper research.",
      "Prefer web_search plus web_contents when source selection matters or primary sources need direct inspection; prefer web_research for open-ended, controversial, or multi-step investigations.",
      "Batch related questions when the answers belong together; use separate sibling web_answer calls when earlier independent answers can unblock the next step.",
    ]),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      return executeAnswerTool({
        config: await loadConfig(),
        request: {
          queries: params.queries,
          options: (params as AnswerToolRequest).options,
        },
        context: {
          cwd: ctx.cwd,
          signal: signal ?? undefined,
          progress: createProgressEmitter(onUpdate),
        },
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
  webResearchLifecycle: {
    activeWebResearchRequests: Map<string, ActiveWebResearchTask>;
    updateWebResearchWidget: (
      ctx?: Pick<ExtensionContext, "hasUI" | "ui">,
    ) => void;
  },
  providerIds: readonly ProviderId[],
): void {
  if (providerIds.length !== 1) return;

  const selectedProviderId = providerIds[0];

  pi.registerTool({
    name: "web_research",
    label: "Web Research",
    description:
      "Start a long-running web research job. Returns immediately with a dispatch notice; the final report is saved to a file and posted later as a custom message.",
    parameters: Type.Object(
      {
        input: Type.String({ description: "Research brief or question" }),
        ...optionalField(
          "options",
          buildStructuredOptionsSchema("research", selectedProviderId),
        ),
      },
      { additionalProperties: false },
    ),
    promptGuidelines: buildPromptGuidelines("research", selectedProviderId, [
      "Use this tool for deep investigations that can finish asynchronously.",
      "Pass only input unless the user explicitly requests provider options.",
      "Do not expect the final report in the same turn; tell the user that web research has started and wait for the completion message with the saved report path.",
    ]),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return dispatchWebResearch({
        pi,
        activeWebResearchRequests:
          webResearchLifecycle.activeWebResearchRequests,
        updateWebResearchWidget: webResearchLifecycle.updateWebResearchWidget,
        config: await loadConfig(),
        request: {
          input: params.input,
          options: (params as ResearchToolRequest).options,
        },
        context: ctx,
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
      return renderWebResearchDispatchResult(result, state.expanded, theme);
    },
  });
}

async function runWebProvidersConfig(
  pi: ExtensionAPI,
  webResearchLifecycle: {
    activeWebResearchRequests: Map<string, ActiveWebResearchTask>;
    updateWebResearchWidget: (
      ctx?: Pick<ExtensionContext, "hasUI" | "ui">,
    ) => void;
  },
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

  await refreshManagedTools(pi, webResearchLifecycle, ctx.cwd, {
    addAvailable: true,
  });
}

async function refreshManagedTools(
  pi: ExtensionAPI,
  webResearchLifecycle: {
    activeWebResearchRequests: Map<string, ActiveWebResearchTask>;
    updateWebResearchWidget: (
      ctx?: Pick<ExtensionContext, "hasUI" | "ui">,
    ) => void;
  },
  cwd: string,
  options: { addAvailable: boolean },
): Promise<void> {
  await refreshManagedToolsAvailability(
    pi,
    (providerIdsByCapability) =>
      registerManagedTools(pi, webResearchLifecycle, providerIdsByCapability),
    cwd,
    options,
  );
}

async function refreshManagedToolsOnStartup(
  pi: ExtensionAPI,
  webResearchLifecycle: {
    activeWebResearchRequests: Map<string, ActiveWebResearchTask>;
    updateWebResearchWidget: (
      ctx?: Pick<ExtensionContext, "hasUI" | "ui">,
    ) => void;
  },
  cwd: string,
  options: { addAvailable: boolean },
): Promise<void> {
  await refreshManagedToolsOnStartupAvailability(
    pi,
    (providerIdsByCapability) =>
      registerManagedTools(pi, webResearchLifecycle, providerIdsByCapability),
    cwd,
    options,
  );
}

function getSearchMaxResultsLimit(providerId: ProviderId): number {
  const capabilities = PROVIDERS_BY_ID[providerId].capabilities as Partial<
    Record<Tool, { limits?: { maxResults?: number } }>
  >;
  return capabilities.search?.limits?.maxResults ?? MAX_ALLOWED_RESULTS;
}

function buildPromptGuidelines(
  capability: Tool,
  providerId: ProviderId,
  baseGuidelines: readonly string[],
): string[] {
  return [
    ...baseGuidelines,
    ...getProviderCapabilityPromptGuidelines(capability, providerId),
  ];
}

function getProviderCapabilityPromptGuidelines(
  capability: Tool,
  providerId: ProviderId,
): readonly string[] {
  const capabilities = PROVIDERS_BY_ID[providerId].capabilities as Partial<
    Record<Tool, { promptGuidelines?: readonly string[] }>
  >;
  return capabilities[capability]?.promptGuidelines ?? [];
}

function optionalField(
  name: string,
  schema: ReturnType<typeof Type.Optional> | undefined,
): Record<string, ReturnType<typeof Type.Optional>> {
  return schema ? { [name]: schema } : {};
}

function buildStructuredOptionsSchema(
  capability: Tool,
  providerId: ProviderId | undefined,
) {
  const providerSchema = resolveProviderOptionsSchema(capability, providerId);
  const schema = buildToolOptionsSchema(capability, providerSchema);
  return schema ? Type.Optional(schema) : undefined;
}

function resolveProviderOptionsSchema(
  capability: Tool,
  providerId: ProviderId | undefined,
) {
  if (!providerId) {
    return undefined;
  }
  const provider = PROVIDERS_BY_ID[providerId];
  return (
    provider.capabilities as Partial<Record<Tool, { options?: TObject }>>
  )[capability]?.options;
}

async function executeSearchTool({
  config,
  request,
  context,
}: {
  config: WebProviders;
  request: SearchToolRequest;
  context: ToolExecutionContext;
}) {
  return executeSearchToolInternal({
    config,
    ctx: { cwd: context.cwd },
    signal: context.signal,
    progress: context.progress,
    providerOptions: request.options,
    maxResults: request.maxResults,
    queries: request.queries,
  });
}

async function executeSearchToolInternal({
  config,
  explicitProvider,
  ctx,
  signal,
  progress,
  providerOptions,
  maxResults,
  queries,
  executionOverrides,
}: {
  config: WebProviders;
  explicitProvider?: ProviderId;
  ctx: { cwd: string };
  signal: AbortSignal | null | undefined;
  progress?: ProgressCallback;
  providerOptions: Record<string, unknown> | undefined;
  maxResults?: number;
  queries: string[];
  executionOverrides?: ProviderExecution<"search">[];
}) {
  await cleanupContentStore();

  const provider = resolveSearchProvider(config, ctx.cwd, explicitProvider);
  const providerConfig = getEffectiveProviderConfig(config, provider.id);

  const prefetchOptions = mergeSearchContentsPrefetchOptions(
    getSearchPrefetchDefaults(config),
    undefined,
  );
  const searchQueries = resolveSearchQueries(queries);
  if (
    executionOverrides !== undefined &&
    executionOverrides.length !== searchQueries.length
  ) {
    throw new Error(
      "executionOverrides length must match the number of search queries.",
    );
  }

  const progressReporter = createToolProgressReporter(
    "search",
    provider.id,
    progress,
  );
  const batchProgress =
    searchQueries.length > 1
      ? createBatchCompletionReporter(
          "Searching",
          provider.id,
          provider.label,
          searchQueries.length,
          progressReporter.report,
        )
      : undefined;
  const providerContext = {
    cwd: ctx.cwd,
    signal: signal ?? undefined,
  };
  const clampedMaxResults = clampResults(
    maxResults,
    getSearchMaxResultsLimit(provider.id),
  );

  let outcomes: SearchQueryOutcome[];
  try {
    batchProgress?.start();
    const settled = await Promise.allSettled(
      searchQueries.map((searchQuery, index) =>
        executeSingleSearchQuery({
          provider,
          providerConfig,
          query: searchQuery,
          maxResults: clampedMaxResults,
          options: providerOptions,
          providerContext,
          onProgress:
            searchQueries.length > 1 ? undefined : progressReporter.report,
          executionOverride: executionOverrides?.[index],
        }).then(
          (value) => {
            batchProgress?.markCompleted();
            return value;
          },
          (error) => {
            batchProgress?.markFailed();
            throw error;
          },
        ),
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
    progressReporter.stop();
  }

  if (outcomes.every((outcome) => outcome.error !== undefined)) {
    throw buildSearchBatchError(outcomes, provider.label);
  }

  const prefetch =
    prefetchOptions !== undefined && executionOverrides === undefined
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

  const details = buildWebSearchDetails(provider.id, outcomes);
  return {
    content: [{ type: "text" as const, text: rendered }],
    details,
    display: buildSearchToolDisplay(details),
  };
}

async function executeRawProviderRequest({
  capability,
  config,
  explicitProvider,
  ctx,
  signal,
  options,
  maxResults,
  urls,
  query,
  input,
}: {
  capability: Tool;
  config: WebProviders;
  explicitProvider: ProviderId;
  ctx: { cwd: string };
  signal: AbortSignal | null | undefined;
  options: Record<string, unknown> | undefined;
  maxResults?: number;
  urls?: string[];
  query?: string;
  input?: string;
}): Promise<SearchResponse | ContentsResponse | ToolOutput> {
  if (capability === "search") {
    const provider = resolveSearchProvider(config, ctx.cwd, explicitProvider);
    const providerConfig = getEffectiveProviderConfig(config, provider.id);

    return executeSingleSearchQuery({
      provider,
      providerConfig,
      query: query ?? "",
      maxResults: clampResults(
        maxResults,
        getSearchMaxResultsLimit(provider.id),
      ),
      options,
      providerContext: {
        cwd: ctx.cwd,
        signal: signal ?? undefined,
      },
    });
  }

  const provider = resolveProviderForTool(
    config,
    ctx.cwd,
    capability,
    explicitProvider,
  );
  const providerConfig = getEffectiveProviderConfig(config, provider.id);

  if (capability === "contents") {
    return executeProviderOperation({
      capability,
      config,
      provider,
      providerConfig,
      ctx,
      signal,
      options,
      urls,
    });
  }

  if (capability === "answer") {
    return executeProviderOperation({
      capability,
      config,
      provider,
      providerConfig,
      ctx,
      signal,
      options,
      query,
    });
  }

  return executeProviderOperation({
    capability,
    config,
    provider,
    providerConfig,
    ctx,
    signal,
    options,
    input,
  });
}

type SearchQueryOutcome =
  | { query: string; response: SearchResponse; error?: undefined }
  | { query: string; error: string; response?: undefined };

function buildSearchBatchError(
  outcomes: SearchQueryOutcome[],
  providerLabel: string,
): Error {
  const failed = outcomes.filter((outcome) => outcome.error !== undefined);
  if (failed.length === 1) {
    return new Error(
      formatProviderCapabilityFailure(
        providerLabel,
        "search",
        failed[0]?.error ?? "",
      ),
    );
  }

  const summary = failed
    .map(
      (outcome, index) =>
        `${index + 1}. ${formatQuotedPreview(outcome.query, 40)} — ${outcome.error}`,
    )
    .join("; ");
  return new Error(
    `${providerLabel} search failed for ${failed.length} queries: ${summary}`,
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
  executionOverride,
}: {
  provider: (typeof PROVIDER_LIST)[number];
  providerConfig: ProviderConfig;
  query: string;
  maxResults: number;
  options: Record<string, unknown> | undefined;
  providerContext: { cwd: string; signal?: AbortSignal };
  onProgress?: (message: string) => void;
  executionOverride?: ProviderExecution<"search">;
}): Promise<SearchResponse> {
  const request: ProviderRequest<"search"> = {
    capability: "search",
    query,
    maxResults,
    options,
  };

  onProgress?.(`Searching via ${provider.label}: ${query}`);
  const result = executionOverride
    ? await executeProviderExecution(executionOverride, {
        ...providerContext,
        onProgress,
      })
    : await executeProviderRequest(provider, providerConfig, request, {
        ...providerContext,
        onProgress,
      });
  if (!isSearchResponse(result)) {
    throw new Error(`${provider.label} search returned an invalid result.`);
  }
  return result;
}

type AnswerQueryOutcome =
  | { query: string; response: ToolOutput; error?: undefined }
  | { query: string; error: string; response?: undefined };

async function executeAnswerTool({
  config,
  request,
  context,
}: {
  config: WebProviders;
  request: AnswerToolRequest;
  context: ToolExecutionContext;
}) {
  return executeAnswerToolInternal({
    config,
    ctx: { cwd: context.cwd },
    signal: context.signal,
    progress: context.progress,
    providerOptions: request.options,
    queries: request.queries,
  });
}

async function executeAnswerToolInternal({
  config,
  explicitProvider,
  ctx,
  signal,
  progress,
  providerOptions,
  queries,
  executionOverrides,
}: {
  config: WebProviders;
  explicitProvider?: ProviderId;
  ctx: { cwd: string };
  signal: AbortSignal | null | undefined;
  progress?: ProgressCallback;
  providerOptions: Record<string, unknown> | undefined;
  queries: string[];
  executionOverrides?: ProviderExecution<"answer">[];
}) {
  const provider = resolveProviderForTool(
    config,
    ctx.cwd,
    "answer",
    explicitProvider,
  );
  const providerConfig = getEffectiveProviderConfig(config, provider.id);

  const answerQueries = resolveAnswerQueries(queries);
  if (
    executionOverrides !== undefined &&
    executionOverrides.length !== answerQueries.length
  ) {
    throw new Error(
      "executionOverrides length must match the number of answer queries.",
    );
  }

  const progressReporter = createToolProgressReporter(
    "answer",
    provider.id,
    progress,
  );
  const batchProgress =
    answerQueries.length > 1
      ? createBatchCompletionReporter(
          "Answering",
          provider.id,
          provider.label,
          answerQueries.length,
          progressReporter.report,
        )
      : undefined;
  let outcomes: AnswerQueryOutcome[];
  try {
    batchProgress?.start();
    const settled = await Promise.allSettled(
      answerQueries.map((answerQuery, index) =>
        executeProviderOperation({
          capability: "answer",
          config,
          provider,
          providerConfig,
          ctx,
          signal,
          options: providerOptions,
          query: answerQuery,
          onProgress:
            answerQueries.length > 1 ? undefined : progressReporter.report,
          executionOverride: executionOverrides?.[index],
        }).then(
          (value) => {
            batchProgress?.markCompleted();
            return value;
          },
          (error) => {
            batchProgress?.markFailed();
            throw error;
          },
        ),
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
    progressReporter.stop();
  }

  if (outcomes.every((outcome) => outcome.error !== undefined)) {
    throw buildAnswerBatchError(outcomes, provider.label);
  }

  const text = await truncateAndSave(
    formatAnswerResponses(outcomes),
    "web-answer",
  );
  const details = buildWebAnswerDetails(provider.id, outcomes);

  return {
    content: [{ type: "text" as const, text }],
    details,
    display: buildProviderToolDisplay({
      capability: "answer",
      providerId: provider.id,
      details,
      text,
    }),
  };
}

function buildAnswerBatchError(
  outcomes: AnswerQueryOutcome[],
  providerLabel: string,
): Error {
  const failed = outcomes.filter((outcome) => outcome.error !== undefined);
  if (failed.length === 1) {
    return new Error(
      formatProviderCapabilityFailure(
        providerLabel,
        "answer",
        failed[0]?.error ?? "",
      ),
    );
  }

  const summary = failed
    .map(
      (outcome, index) =>
        `${index + 1}. ${formatQuotedPreview(outcome.query, 40)} — ${outcome.error}`,
    )
    .join("; ");
  return new Error(
    `${providerLabel} answer failed for ${failed.length} questions: ${summary}`,
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
  const body = outcome.response
    ? outcome.response.text
    : `Answer failed: ${outcome.error ?? "Unknown error."}`;
  if (total === 1) {
    return body;
  }
  const heading = `## Question ${index + 1}: ${formatAnswerHeading(outcome.query)}`;
  return `${heading}\n\n${body}`;
}

function buildWebAnswerDetails(
  provider: ProviderId,
  outcomes: AnswerQueryOutcome[],
): ToolDetails {
  const successfulOutcomes = outcomes.filter(
    (
      outcome,
    ): outcome is Extract<AnswerQueryOutcome, { response: ToolOutput }> =>
      outcome.response !== undefined,
  );

  return {
    tool: "web_answer",
    provider,
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
  onProgress,
  executionOverride,
}: {
  capability: "contents";
  config: WebProviders;
  provider: (typeof PROVIDER_LIST)[number];
  providerConfig: ProviderConfig;
  ctx: { cwd: string };
  signal: AbortSignal | null | undefined;
  options: Record<string, unknown> | undefined;
  urls?: string[];
  onProgress?: ProgressCallback;
  executionOverride?: ProviderExecution<"contents">;
}): Promise<ContentsResponse>;
async function executeProviderOperation({
  capability,
  config,
  provider,
  providerConfig,
  ctx,
  signal,
  options,
  query,
  input,
  onProgress,
  executionOverride,
}: {
  capability: Exclude<Tool, "search" | "contents">;
  config: WebProviders;
  provider: (typeof PROVIDER_LIST)[number];
  providerConfig: ProviderConfig;
  ctx: { cwd: string };
  signal: AbortSignal | null | undefined;
  options: Record<string, unknown> | undefined;
  query?: string;
  input?: string;
  onProgress?: ProgressCallback;
  executionOverride?: ProviderExecution<Exclude<Tool, "search" | "contents">>;
}): Promise<ToolOutput>;
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
  executionOverride,
}: {
  capability: Exclude<Tool, "search">;
  config: WebProviders;
  provider: (typeof PROVIDER_LIST)[number];
  providerConfig: ProviderConfig;
  ctx: { cwd: string };
  signal: AbortSignal | null | undefined;
  options: Record<string, unknown> | undefined;
  urls?: string[];
  query?: string;
  input?: string;
  onProgress?: ProgressCallback;
  executionOverride?: ProviderExecution<Exclude<Tool, "search">>;
}): Promise<ContentsResponse | ToolOutput> {
  const request = buildOperationRequest(capability, {
    urls,
    query,
    input,
    options,
  });

  // Route contents requests through the local in-memory cache whenever we can
  // reuse an exact batch hit or at least one per-URL cache entry. Exact cache
  // hits are served immediately, and partial cache hits fetch only missing or
  // stale URLs.
  if (capability === "contents" && executionOverride === undefined) {
    return await resolveContentsFromStore({
      urls: urls ?? [],
      providerId: provider.id,
      config,
      cwd: ctx.cwd,
      options,
      signal: signal ?? undefined,
      onProgress,
    });
  }

  if (capability === "contents") {
    const urlCount = (urls ?? []).length;
    onProgress?.(
      `Fetching contents via ${provider.label} for ${urlCount} URL(s)`,
      buildProgressDisplay(
        provider.id,
        urlCount === 1 ? "Fetching page" : `Fetching ${urlCount} pages`,
      ),
    );
  } else if (capability === "answer") {
    onProgress?.(
      `Answering via ${provider.label}`,
      buildProgressDisplay(provider.id, "Answering"),
    );
  } else if (capability === "research") {
    onProgress?.(
      `Researching via ${provider.label}`,
      buildProgressDisplay(provider.id, "Researching"),
    );
  }

  const result = executionOverride
    ? await executeProviderExecution(executionOverride, {
        cwd: ctx.cwd,
        signal: signal ?? undefined,
        onProgress,
      })
    : await executeProviderRequest(provider, providerConfig, request, {
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
  config,
  request,
  context,
}: {
  config: WebProviders;
  request: ProviderToolRequest<Exclude<Tool, "search">>;
  context: ToolExecutionContext;
}) {
  return executeProviderToolInternal({
    capability: request.capability,
    config,
    ctx: { cwd: context.cwd },
    signal: context.signal,
    progress: context.progress,
    providerOptions: request.options,
    urls: request.urls,
    query: request.query,
    input: request.input,
  });
}

async function executeProviderToolInternal({
  capability,
  config,
  explicitProvider,
  ctx,
  signal,
  progress,
  providerOptions,
  urls,
  query,
  input,
  executionOverride,
  executionOverrides,
}: {
  capability: Exclude<Tool, "search">;
  config: WebProviders;
  explicitProvider?: ProviderId;
  ctx: { cwd: string };
  signal: AbortSignal | null | undefined;
  progress?: ProgressCallback;
  providerOptions: Record<string, unknown> | undefined;
  urls?: string[];
  query?: string;
  input?: string;
  executionOverride?: ProviderExecution<Exclude<Tool, "search">>;
  executionOverrides?: ProviderExecution<"contents">[];
}) {
  await cleanupContentStore();

  const provider = resolveProviderForTool(
    config,
    ctx.cwd,
    capability,
    explicitProvider,
  );
  const providerConfig = getEffectiveProviderConfig(config, provider.id);

  const progressReporter = createToolProgressReporter(
    capability,
    provider.id,
    progress,
  );

  let response: ContentsResponse | ToolOutput;
  try {
    if (capability === "contents") {
      response =
        executionOverrides !== undefined ||
        (executionOverride === undefined && (urls?.length ?? 0) > 1)
          ? await executeBatchedContentsTool({
              config,
              provider,
              providerConfig,
              ctx,
              signal,
              options: providerOptions,
              urls: urls ?? [],
              progressReport: progressReporter.report,
              executionOverrides,
            })
          : await executeProviderOperation({
              capability,
              config,
              provider,
              providerConfig,
              ctx,
              signal,
              options: providerOptions,
              urls,
              onProgress: progressReporter.report,
              executionOverride: executionOverride as
                | ProviderExecution<"contents">
                | undefined,
            });
    } else {
      response = await executeProviderOperation({
        capability,
        config,
        provider,
        providerConfig,
        ctx,
        signal,
        options: providerOptions,
        query,
        input,
        onProgress: progressReporter.report,
        executionOverride: executionOverride as
          | ProviderExecution<Exclude<Tool, "search" | "contents">>
          | undefined,
      });
    }
  } finally {
    progressReporter.stop();
  }

  const rendered = await truncateAndSaveWithMetadata(
    isContentsResponse(response)
      ? formatContentsResponse(response)
      : response.text,
    capability,
  );
  const details: ToolDetails = isContentsResponse(response)
    ? {
        tool: "web_contents",
        provider: response.provider,
        itemCount: response.answers.length,
      }
    : capability === "answer"
      ? {
          tool: "web_answer",
          provider: response.provider,
          itemCount: response.itemCount,
          queryCount: 1,
          failedQueryCount: 0,
        }
      : {
          tool: "web_research",
          provider: response.provider,
        };

  return {
    content: [{ type: "text" as const, text: rendered.text }],
    details,
    display: buildProviderToolDisplay({
      capability,
      providerId: response.provider,
      details,
      text: rendered.text,
      outputBytes: capability === "contents" ? rendered.totalBytes : undefined,
      outputTruncated:
        capability === "contents" ? rendered.truncated : undefined,
      failedItemCount: isContentsResponse(response)
        ? response.answers.filter((answer) => answer.error !== undefined).length
        : undefined,
    }),
  };
}

async function dispatchWebResearch({
  pi,
  activeWebResearchRequests,
  updateWebResearchWidget,
  config,
  request,
  context,
}: {
  pi: Pick<ExtensionAPI, "sendMessage">;
  activeWebResearchRequests: Map<string, ActiveWebResearchTask>;
  updateWebResearchWidget: (
    ctx?: Pick<ExtensionContext, "hasUI" | "ui">,
  ) => void;
  config: WebProviders;
  request: ResearchToolRequest;
  context: Pick<ExtensionContext, "cwd" | "hasUI" | "ui">;
}) {
  return dispatchWebResearchInternal({
    pi,
    activeWebResearchRequests,
    updateWebResearchWidget,
    config,
    ctx: context,
    providerOptions: request.options,
    input: request.input,
  });
}

async function dispatchWebResearchInternal({
  pi,
  activeWebResearchRequests,
  updateWebResearchWidget,
  config,
  explicitProvider,
  ctx,
  providerOptions,
  input,
  executionOverride,
}: {
  pi: Pick<ExtensionAPI, "sendMessage">;
  activeWebResearchRequests: Map<string, ActiveWebResearchTask>;
  updateWebResearchWidget: (
    ctx?: Pick<ExtensionContext, "hasUI" | "ui">,
  ) => void;
  config: WebProviders;
  explicitProvider?: ProviderId;
  ctx: Pick<ExtensionContext, "cwd" | "hasUI" | "ui">;
  providerOptions: Record<string, unknown> | undefined;
  input: string;
  executionOverride?: ProviderExecution<"research">;
}) {
  return dispatchWebResearchLifecycle({
    activeWebResearchRequests,
    config,
    explicitProvider,
    ctx: { cwd: ctx.cwd },
    options: providerOptions,
    input,
    executionOverride,
    executeResearch: async ({
      config,
      provider,
      providerConfig,
      ctx,
      signal,
      options,
      input,
      onProgress,
      executionOverride,
    }) =>
      executeProviderOperation({
        capability: "research",
        config,
        provider,
        providerConfig,
        ctx,
        signal,
        options,
        input,
        onProgress,
        executionOverride,
      }),
    deliverResult: (message) => pi.sendMessage(message),
    onJobsChanged: () => updateWebResearchWidget(ctx),
    resultMessageType: WEB_RESEARCH_RESULT_MESSAGE_TYPE,
  });
}

function buildWebResearchWidgetLines(
  requests: WebResearchRequest[],
  theme: Pick<Theme, "fg">,
  now = Date.now(),
): string[] {
  const lines = [theme.fg("accent", "Research jobs:")];

  for (const request of requests
    .slice()
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
    .slice(0, 3)) {
    const providerLabel =
      PROVIDERS_BY_ID[request.provider]?.label ?? request.provider;
    const elapsed = formatCompactElapsed(now - Date.parse(request.startedAt));
    const icon = getWebResearchWidgetIcon(request, now);
    const progress = request.progress ? `${request.progress} · ` : "";
    lines.push(
      `${icon}${providerLabel} ${theme.fg("muted", `(${elapsed}): `)}${theme.fg("muted", progress)}${truncateInline(cleanSingleLine(request.input), 70)}`,
    );
  }

  if (requests.length > 3) {
    lines.push(theme.fg("muted", `+${requests.length - 3} more`));
  }

  return lines;
}

function getWebResearchWidgetIcon(
  request: WebResearchRequest,
  _now: number,
): string {
  if (request.progress === "poll retrying after transient errors") {
    return "⟳ ";
  }

  if (request.progress === "queued" || request.progress === "cancelling") {
    return "◌ ";
  }

  if (request.progress === "starting") {
    return "◔ ";
  }

  if (request.progress?.startsWith("started:")) {
    return "◑ ";
  }

  return "● ";
}

function formatCompactElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return `${minutes}m${seconds}s`;
  }

  return `${totalSeconds}s`;
}

async function executeBatchedContentsTool({
  config,
  provider,
  providerConfig,
  ctx,
  signal,
  options,
  urls,
  progressReport,
  executionOverrides,
}: {
  config: WebProviders;
  provider: (typeof PROVIDER_LIST)[number];
  providerConfig: ProviderConfig;
  ctx: { cwd: string };
  signal: AbortSignal | null | undefined;
  options: Record<string, unknown> | undefined;
  urls: string[];
  progressReport: ProgressCallback;
  executionOverrides?: ProviderExecution<"contents">[];
}): Promise<ContentsResponse> {
  if (
    executionOverrides !== undefined &&
    executionOverrides.length !== urls.length
  ) {
    throw new Error(
      "executionOverrides length must match the number of contents URLs.",
    );
  }

  const batchProgress = createBatchCompletionReporter(
    "Fetching contents",
    provider.id,
    provider.label,
    urls.length,
    progressReport,
  );
  batchProgress.start();

  const settled = await Promise.allSettled(
    urls.map((url, index) =>
      executeProviderOperation({
        capability: "contents",
        config,
        provider,
        providerConfig,
        ctx,
        signal,
        options,
        urls: [url],
        onProgress: undefined,
        executionOverride: executionOverrides?.[index],
      }).then(
        (value) => {
          batchProgress.markCompleted();
          return value;
        },
        (error) => {
          batchProgress.markFailed();
          throw error;
        },
      ),
    ),
  );

  const successful = settled
    .map((result, index) => {
      if (result.status !== "fulfilled") {
        return undefined;
      }
      return {
        url: urls[index] ?? "",
        response: result.value,
      };
    })
    .filter(
      (
        value,
      ): value is {
        url: string;
        response: ContentsResponse;
      } => value !== undefined,
    );
  const failures = settled
    .map((result, index) =>
      result.status === "rejected"
        ? {
            url: urls[index] ?? "",
            error: formatErrorMessage(result.reason),
          }
        : undefined,
    )
    .filter(
      (value): value is { url: string; error: string } => value !== undefined,
    );

  if (successful.length === 0 && failures.length > 0) {
    throw new Error(
      failures.length === 1
        ? formatProviderCapabilityFailure(
            provider.label,
            "contents",
            failures[0]?.error ?? "",
          )
        : `${provider.label} fetch failed for ${failures.length} pages: ${failures
            .map(
              (failure, index) =>
                `${index + 1}. ${failure.url} — ${failure.error}`,
            )
            .join("; ")}`,
    );
  }

  const answersByUrl = new Map<string, ContentsResponse["answers"][number]>();
  for (const entry of successful) {
    answersByUrl.set(
      entry.url,
      entry.response.answers[0] ?? {
        url: entry.url,
        error: "No content returned for this URL.",
      },
    );
  }
  for (const failure of failures) {
    answersByUrl.set(failure.url, {
      url: failure.url,
      error: failure.error,
    });
  }

  return {
    provider: successful[0]?.response.provider ?? provider.id,
    answers: urls.map((url) => {
      return (
        answersByUrl.get(url) ?? {
          url,
          error: "No content returned for this URL.",
        }
      );
    }),
  };
}

function buildOperationRequest(
  capability: Exclude<Tool, "search">,
  args: {
    options: Record<string, unknown> | undefined;
    urls?: string[];
    query?: string;
    input?: string;
  },
): ProviderRequest {
  // Provider options are passed directly — no stripping needed since
  // global execution controls are already separated at the tool boundary.
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

function isSearchResponse(
  value: SearchResponse | ContentsResponse | ToolOutput,
): value is SearchResponse {
  return "results" in value;
}

function isContentsResponse(
  value: ContentsResponse | ToolOutput,
): value is ContentsResponse {
  return "answers" in value;
}

function formatContentsResponse(response: ContentsResponse): string {
  return renderContentsAnswers(response.answers);
}

function createProgressEmitter(onUpdate: ToolUpdateCallback): ProgressCallback {
  if (!onUpdate) {
    return undefined;
  }

  return (message: string, display?: ToolDisplayDetails) => {
    onUpdate({
      content: [{ type: "text", text: message }],
      details: {},
      display,
    });
  };
}

function createToolProgressReporter(
  capability: Tool,
  providerId: ProviderId,
  progress: ProgressCallback,
): {
  report?: (message: string) => void;
  stop: () => void;
} {
  if (!progress) {
    return { report: undefined, stop: () => {} };
  }

  const emit = (message: string, display?: ToolDisplayDetails) =>
    progress(message, display);

  const startedAt = Date.now();
  let lastUpdateAt = startedAt;
  let timer: ReturnType<typeof setInterval> | undefined;

  if (capability === "research") {
    timer = setInterval(() => {
      if (Date.now() - lastUpdateAt < RESEARCH_HEARTBEAT_MS) {
        return;
      }

      const providerLabel = PROVIDERS_BY_ID[providerId]?.label ?? providerId;
      const elapsed = formatElapsed(Date.now() - startedAt);
      emit(
        `Researching via ${providerLabel} (${elapsed} elapsed)`,
        buildProgressDisplay(providerId, `Researching ${elapsed}`),
      );
      lastUpdateAt = Date.now();
    }, RESEARCH_HEARTBEAT_MS);
  }

  return {
    report: (message: string, display?: ToolDisplayDetails) => {
      lastUpdateAt = Date.now();
      emit(message, display);
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
  suffix?: string,
  options: { quoteSingleItem?: boolean; forceMultiline?: boolean } = {},
): Component {
  return {
    invalidate() {},
    render(width) {
      const normalizedItems = items
        .map((item) => cleanSingleLine(item))
        .filter((item) => item.length > 0);

      const toolTitle = theme.fg("toolTitle", theme.bold(toolName));
      const mutedSuffix = suffix ? theme.fg("muted", suffix) : "";

      if (!options.forceMultiline && normalizedItems.length === 1) {
        const singleItem = options.quoteSingleItem
          ? formatQuotedPreview(normalizedItems[0], 80)
          : truncateInline(normalizedItems[0], 120);
        const inline = `${toolTitle} ${theme.fg("accent", singleItem)}${mutedSuffix}`;
        const line = truncateToWidth(inline.trimEnd(), width);
        return [line + " ".repeat(Math.max(0, width - visibleWidth(line)))];
      }

      let header = toolTitle;
      if (mutedSuffix) {
        header += mutedSuffix;
      }

      const lines: string[] = [];
      const headerLine = truncateToWidth(header.trimEnd(), width);
      lines.push(
        headerLine + " ".repeat(Math.max(0, width - visibleWidth(headerLine))),
      );

      for (const item of normalizedItems) {
        const itemLines = options.forceMultiline
          ? wrapTextWithAnsi(
              theme.fg("accent", item),
              Math.max(1, width - 2),
            ).map((line) => `  ${line}`)
          : [
              truncateToWidth(
                `  ${theme.fg("accent", truncateInline(item, 120))}`,
                width,
              ),
            ];
        for (const itemLine of itemLines) {
          const line = truncateToWidth(itemLine, width);
          lines.push(
            line + " ".repeat(Math.max(0, width - visibleWidth(line))),
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
    details.length > 0 ? ` ${details.join(" ")}` : undefined,
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
    undefined,
    { quoteSingleItem: true },
  );
}

function renderResearchCallHeader(
  params: {
    input: string;
  },
  theme: Theme,
): Component {
  return renderListCallHeader(
    "web_research",
    [params.input],
    theme,
    undefined,
    { quoteSingleItem: true },
  );
}

type WebToolResult = {
  content?: Array<{ type: string; text?: string }>;
  details?: unknown;
  display?: ToolDisplayDetails;
  isError?: boolean;
};

interface WebToolRenderConfig<TDetails> {
  capability: Tool;
  failureText: string;
  getDetails(details: unknown): TDetails | undefined;
  getCollapsedSummary(
    details: TDetails | undefined,
    text: string | undefined,
  ): SummaryParts;
  renderExpanded(
    details: TDetails | undefined,
    text: string | undefined,
  ): Component;
  preferDisplaySummary?: boolean;
}

function renderWebToolResult<TDetails>(
  result: WebToolResult,
  state: { expanded: boolean; isPartial?: boolean },
  theme: Theme,
  config: WebToolRenderConfig<TDetails>,
  symbols: SummarySymbols = DEFAULT_SUMMARY_SYMBOLS,
): Component {
  const text = extractTextContent(result.content);

  if (state.isPartial) {
    return renderToolProgress(result.display, text, theme);
  }

  if (result.isError) {
    return renderFailureText(
      buildFailureSummary({
        text,
        details: result.details as ToolDetails | WebSearchDetails | undefined,
        capability: config.capability,
        fallback: config.failureText,
      }),
      theme,
      symbols,
    );
  }

  const details = config.getDetails(result.details);
  if (state.expanded) {
    return config.renderExpanded(details, text);
  }

  const summary =
    config.preferDisplaySummary === false
      ? config.getCollapsedSummary(details, text)
      : (getDisplaySummaryParts(result.display) ??
        config.getCollapsedSummary(details, text));
  return renderCollapsedSummary(summary, theme, symbols);
}

function renderSearchToolResult(
  result: WebToolResult,
  expanded: boolean,
  isPartial: boolean,
  theme: Theme,
  symbols: SummarySymbols = DEFAULT_SUMMARY_SYMBOLS,
): Component {
  return renderWebToolResult(
    result,
    { expanded, isPartial },
    theme,
    {
      capability: "search",
      failureText: "web_search failed",
      getDetails: (details) => details as WebSearchDetails | undefined,
      getCollapsedSummary: (details, text) =>
        details
          ? buildSearchSummaryParts(details)
          : { success: getFirstLine(text) ?? "web_search output available" },
      renderExpanded: (_details, text) => renderMarkdownBlock(text ?? ""),
    },
    symbols,
  );
}

function renderWebResearchDispatchResult(
  result: WebToolResult,
  expanded: boolean,
  theme: Theme,
  symbols: SummarySymbols = DEFAULT_SUMMARY_SYMBOLS,
): Component {
  return renderWebToolResult(
    result,
    { expanded },
    theme,
    {
      capability: "research",
      failureText: "web_research failed",
      getDetails: (details) =>
        isWebResearchRequest(details) ? details : undefined,
      getCollapsedSummary: () => ({ success: "started" }),
      renderExpanded: (details, text) =>
        renderMarkdownBlock(
          details
            ? renderWebResearchRequestMarkdown(details)
            : (text ?? "Started web research."),
        ),
      preferDisplaySummary: false,
    },
    symbols,
  );
}

function renderWebResearchResultMessage(
  message: {
    content: string | Array<{ type: string; text?: string }>;
    details?: unknown;
  },
  { expanded }: { expanded: boolean },
  theme: Theme,
  symbols: SummarySymbols = DEFAULT_SUMMARY_SYMBOLS,
): Component {
  const text =
    typeof message.content === "string"
      ? message.content
      : extractTextContent(message.content);
  const details = isWebResearchResult(message.details)
    ? message.details
    : undefined;
  const isSuccess = details?.status === "completed";
  const isCancelled = details?.status === "cancelled";
  const accent: "success" | "warning" | "error" = isSuccess
    ? "success"
    : isCancelled
      ? "warning"
      : "error";
  const box = new Box(1, 1, (value) => theme.bg("customMessageBg", value));

  if (!expanded) {
    const summary = details
      ? buildWebResearchResultSummaryLine(details, theme, symbols)
      : theme.fg(accent, "Web research update");
    box.addChild(
      new Text(`${summary}${theme.fg("muted", ` (${getExpandHint()})`)}`, 0, 0),
    );
    return box;
  }

  box.addChild(
    details
      ? renderMarkdownBlock(renderWebResearchResultMarkdown(details))
      : isSuccess
        ? renderMarkdownBlock(text ?? "")
        : renderBlockText(
            text ?? "",
            theme,
            isCancelled ? "toolOutput" : "error",
          ),
  );
  return box;
}

function renderWebResearchRequestMarkdown(request: WebResearchRequest): string {
  return [
    "### Web research",
    "",
    `**Brief:** ${request.input}`,
    "",
    "**Status:** running  ",
    `**Elapsed:** ${formatSummaryElapsed(Date.now() - Date.parse(request.startedAt))}  `,
    `**Artifact:** \`${request.outputPath}\``,
  ].join("\n");
}

function renderWebResearchResultMarkdown(result: WebResearchResult): string {
  const status = result.status === "completed" ? "completed" : result.status;
  return [
    "### Web research",
    "",
    `**Brief:** ${result.input}`,
    "",
    `**Status:** ${status}  `,
    `**Duration:** ${formatSummaryElapsed(result.elapsedMs)}  `,
    `**Artifact:** \`${result.outputPath}\``,
    ...(result.error ? ["", `**Error:** ${result.error}`] : []),
  ].join("\n");
}

function buildWebResearchResultSummaryLine(
  result: WebResearchResult,
  theme: Pick<Theme, "fg">,
  symbols: SummarySymbols,
): string {
  const providerLabel =
    PROVIDERS_BY_ID[result.provider]?.label ?? result.provider;

  if (result.status === "completed") {
    return renderSuccessSummary(
      `${formatSummaryElapsed(result.elapsedMs)} · ${basename(result.outputPath)}`,
      theme,
      symbols,
    );
  }

  const statusText =
    result.status === "cancelled"
      ? `${providerLabel} research canceled after ${formatSummaryElapsed(result.elapsedMs)}`
      : `${providerLabel} research failed after ${formatSummaryElapsed(result.elapsedMs)}`;
  const errorSuffix = result.error
    ? `: ${normalizeProviderFailureDetail(providerLabel, result.error)}`
    : "";
  return renderFailureSummary(`${statusText}${errorSuffix}`, theme, symbols);
}

function isWebResearchRequest(details: unknown): details is WebResearchRequest {
  return (
    typeof details === "object" &&
    details !== null &&
    "tool" in details &&
    (details as { tool?: unknown }).tool === "web_research" &&
    "startedAt" in details &&
    "outputPath" in details &&
    !("status" in details)
  );
}

function isWebResearchResult(details: unknown): details is WebResearchResult {
  return (
    typeof details === "object" &&
    details !== null &&
    "tool" in details &&
    (details as { tool?: unknown }).tool === "web_research" &&
    "status" in details &&
    "completedAt" in details
  );
}

function renderProviderToolResult(
  result: WebToolResult,
  expanded: boolean,
  isPartial: boolean,
  failureText: string,
  theme: Theme,
  options: {
    markdownWhenExpanded?: boolean;
    symbols?: SummarySymbols;
  } = {},
): Component {
  return renderWebToolResult(
    result,
    { expanded, isPartial },
    theme,
    {
      capability: toolFromFailureText(failureText),
      failureText,
      getDetails: (details) => details as ToolDetails | undefined,
      getCollapsedSummary: buildCollapsedProviderToolSummary,
      renderExpanded: (_details, text) =>
        options.markdownWhenExpanded
          ? renderMarkdownBlock(text ?? "")
          : renderBlockText(text ?? "", theme, "toolOutput"),
    },
    options.symbols,
  );
}

function renderCollapsedProviderToolSummary(
  details: ToolDetails | undefined,
  text: string | undefined,
): string {
  return buildDisplayCollapsedProviderToolSummary(details, text);
}

function buildCollapsedProviderToolSummary(
  details: ToolDetails | undefined,
  text: string | undefined,
): SummaryParts {
  return buildDisplayCollapsedProviderToolSummaryParts(details, text);
}

function renderCollapsedSummary(
  summary: SummaryParts,
  theme: Pick<Theme, "fg">,
  symbols: SummarySymbols = DEFAULT_SUMMARY_SYMBOLS,
): Text {
  let rendered = renderSummary(summary, theme, symbols);
  rendered += theme.fg("muted", ` (${getExpandHint()})`);
  return new Text(rendered, 0, 0);
}

function getDisplaySummaryParts(
  display: ToolDisplayDetails | undefined,
): SummaryParts | undefined {
  return display?.outcome;
}

function buildSearchToolDisplay(details: WebSearchDetails): ToolDisplayDetails {
  return buildDisplaySearchToolDisplay(details);
}

function buildProgressDisplay(
  providerId: ProviderId,
  action: string,
): ToolDisplayDetails {
  return buildDisplayProgress(providerId, action);
}

function buildProviderToolDisplay({
  capability,
  providerId,
  details,
  text,
  outputBytes,
  outputTruncated,
  failedItemCount,
}: {
  capability: Exclude<Tool, "search">;
  providerId: ProviderId;
  details: ToolDetails;
  text: string | undefined;
  outputBytes?: number;
  outputTruncated?: boolean;
  failedItemCount?: number;
}): ToolDisplayDetails {
  return buildDisplayProviderToolDisplay({
    capability,
    providerId,
    details,
    text,
    outputBytes,
    outputTruncated,
    failedItemCount,
  });
}

interface SettingsEntry {
  id: string;
  label: string;
  currentValue: string;
  description: string;
  kind: "action" | "cycle" | "text";
  values?: string[];
  preserveValueStyle?: boolean;
}

function getProviderSettings(
  providerId: ProviderId,
): readonly ProviderSettingDescriptor<ProviderConfig>[] {
  return getProviderConfigManifest(providerId)
    .settings as readonly ProviderSettingDescriptor<ProviderConfig>[];
}

function buildManifestSettingsEntry(
  setting: ProviderSettingDescriptor<ProviderConfig>,
  providerConfig: ProviderConfig | undefined,
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

  return {
    id: setting.id,
    label: setting.label,
    currentValue: summarizeStringValue(
      setting.getValue(providerConfig),
      setting.secret === true,
    ),
    description: setting.help,
    kind: "text",
  };
}

function renderEntryList(
  width: number,
  theme: Theme,
  entries: SettingsEntry[],
  selection: number,
): string[] {
  const labelWidth = Math.min(
    24,
    Math.max(...entries.map((entry) => entry.label.length), 0),
  );
  return entries.map((entry, index) => {
    const selected = selection === index;
    const prefix = selected ? theme.fg("accent", "→ ") : "  ";
    const paddedLabel = entry.label.padEnd(labelWidth, " ");
    const label = selected ? theme.fg("accent", paddedLabel) : paddedLabel;
    const value = selected
      ? theme.fg("accent", entry.currentValue)
      : theme.fg("muted", entry.currentValue);
    return truncateToWidth(`${prefix}${label}  ${value}`, width);
  });
}

function renderSelectedEntryDescription(
  width: number,
  theme: Theme,
  entry: SettingsEntry | undefined,
): string[] {
  if (!entry) {
    return [];
  }

  return wrapTextWithAnsi(entry.description, Math.max(10, width - 2)).map(
    (line) => truncateToWidth(theme.fg("dim", line), width),
  );
}

function formatProviderCapabilityChecks(
  providerId: ProviderId,
  theme: Theme,
): string {
  return (["search", "contents", "answer", "research"] as const)
    .map((tool) =>
      supportsTool(PROVIDERS_BY_ID[providerId], tool)
        ? theme.fg("success", "✔")
        : " ",
    )
    .join(" ");
}

function resolveProviderSelectionValue(
  providerIds: ProviderId[],
  value: string,
): ProviderId | undefined {
  return providerIds.find(
    (candidate) => PROVIDERS_BY_ID[candidate].label === value,
  );
}

function getReadyCompatibleProvidersForTool(
  config: WebProviders,
  cwd: string,
  toolId: Tool,
): ProviderId[] {
  return sortProviderIdsForSettings(
    getCompatibleProviders(toolId).filter((providerId) =>
      isProviderCapabilityReady(
        getProviderCapabilityStatus(config, cwd, providerId, toolId),
      ),
    ),
  );
}

function sortProviderIdsForSettings(
  providerIds: readonly ProviderId[],
): ProviderId[] {
  const displayOrder = new Map(
    PROVIDER_LIST.map((provider, index) => [provider.id, index] as const),
  );
  return [...providerIds].sort(
    (left, right) =>
      (displayOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (displayOrder.get(right) ?? Number.MAX_SAFE_INTEGER),
  );
}

function getSearchSettings(config: WebProviders): SearchSettings | undefined {
  return config.settings?.search;
}

function getSearchPrefetchDefaults(
  config: WebProviders,
): SearchSettings | undefined {
  return getSearchSettings(config);
}

function getEffectiveSearchPrefetchDefaults(config: WebProviders): {
  provider?: ProviderId;
  maxUrls: number;
  ttlMs: number;
} {
  const settings = getSearchSettings(config);
  return {
    provider: settings?.provider,
    maxUrls: settings?.maxUrls ?? DEFAULT_PREFETCH_MAX_URLS,
    ttlMs: settings?.ttlMs ?? DEFAULT_CONTENT_TTL_MS,
  };
}

const SETTING_IDS = [
  "requestTimeoutMs",
  "retryCount",
  "retryDelayMs",
  "researchTimeoutMs",
] as const satisfies readonly (keyof ExecutionSettings)[];

type SettingId = (typeof SETTING_IDS)[number];
const SETTING_META: Record<
  SettingId,
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
  researchTimeoutMs: {
    label: "Research timeout (ms)",
    help: "Default maximum total time to allow long-running web research before aborting it. Applies to every provider unless overridden.",
    parse: (value) =>
      parseOptionalPositiveIntegerInput(
        value,
        "Research timeout must be a positive integer.",
      ),
  },
};

function getSharedSettingValue(config: WebProviders, id: SettingId): number {
  return getEffectiveSharedSettings(config)[id] as number;
}

function getSharedSettingDisplayValue(
  config: WebProviders,
  id: SettingId,
): string {
  return String(getSharedSettingValue(config, id));
}

function getSharedSettingRawValue(config: WebProviders, id: SettingId): string {
  const value = config.settings?.[id];
  return typeof value === "number" ? String(value) : "";
}

function ensureSettings(config: WebProviders): Settings {
  config.settings = { ...(config.settings ?? {}) };
  return config.settings;
}

function cleanupSettings(config: WebProviders): void {
  if (
    config.settings?.search &&
    Object.keys(config.settings.search).length === 0
  ) {
    delete config.settings.search;
  }
  if (config.settings && Object.keys(config.settings).length === 0) {
    delete config.settings;
  }
}

function stripDuplicatePolicyOverrides(config: WebProviders): void {
  for (const providerId of PROVIDER_IDS) {
    const providerConfig = config.providers?.[providerId] as
      | ProviderConfig
      | undefined;
    if (!providerConfig?.settings) {
      continue;
    }

    for (const key of SETTING_IDS) {
      if (providerConfig.settings[key] === config.settings?.[key]) {
        delete providerConfig.settings[key];
      }
    }

    if (Object.keys(providerConfig.settings).length === 0) {
      delete providerConfig.settings;
    }
  }
}

class WebProvidersSettingsView implements Component {
  private config: WebProviders;
  private activeProvider: ProviderId;
  private activeSection: "provider" | "tools" | "settings" = "tools";
  private selection = {
    provider: 0,
    tools: 0,
    settings: 0,
  };
  private submenu: Component | undefined;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly done: (result: undefined) => void,
    private readonly ctx: ExtensionCommandContext,
    initialConfig: WebProviders,
    initialProvider: ProviderId,
  ) {
    this.config = structuredClone(initialConfig);
    this.activeProvider = initialProvider;
    this.selection.provider = Math.max(
      0,
      PROVIDER_LIST.findIndex((provider) => provider.id === initialProvider),
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

    const settingsItems = this.buildSettingsSectionItems();
    lines.push(
      ...this.renderSection(width, "Settings", "settings", settingsItems),
    );

    const selected = this.getSelectedEntry();
    if (selected) {
      lines.push("");
      lines.push(
        ...renderSelectedEntryDescription(width, this.theme, selected),
      );
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

    const kb = getKeybindings();
    const entries = this.getActiveSectionEntries();

    if (kb.matches(data, "tui.select.up")) {
      if (entries.length > 0) {
        this.moveSelection(-1);
      }
    } else if (kb.matches(data, "tui.select.down")) {
      if (entries.length > 0) {
        this.moveSelection(1);
      }
    } else if (matchesKey(data, Key.tab)) {
      this.moveSection(1);
    } else if (matchesKey(data, Key.shift("tab"))) {
      this.moveSection(-1);
    } else if (kb.matches(data, "tui.select.confirm") || data === " ") {
      void this.activateCurrentEntry();
    } else if (kb.matches(data, "tui.select.cancel")) {
      this.done(undefined);
      return;
    }

    this.tui.requestRender();
  }

  private buildProviderSectionItems(): SettingsEntry[] {
    return PROVIDER_LIST.map((provider) => {
      const setupState = getProviderSetupState(this.config, provider.id);
      const statusSummary = getProviderReadinessSummary(
        this.config,
        this.ctx.cwd,
        provider.id,
      );
      return {
        id: `provider:${provider.id}`,
        label: provider.label,
        currentValue: `${formatProviderCapabilityChecks(provider.id, this.theme)}  ${this.theme.fg("muted", formatProviderSetupState(setupState))}`,
        description:
          provider.id === this.activeProvider
            ? `Press Enter to configure ${provider.label}'s provider-specific settings. ${statusSummary}`
            : `Move here and press Enter to configure ${provider.label}'s provider-specific settings. ${statusSummary}`,
        kind: "action",
        preserveValueStyle: true,
      };
    });
  }

  private buildToolSectionItems(): SettingsEntry[] {
    return (Object.keys(CAPABILITY_TOOL_NAMES) as Tool[]).map((toolId) => {
      const readyCompatibleProviders = getReadyCompatibleProvidersForTool(
        this.config,
        this.ctx.cwd,
        toolId,
      );
      const mappedProviderId = getMappedProviderIdForTool(this.config, toolId);
      const currentValue =
        mappedProviderId && readyCompatibleProviders.includes(mappedProviderId)
          ? PROVIDERS_BY_ID[mappedProviderId].label
          : "off";
      const compatibleLabels = readyCompatibleProviders.map(
        (providerId) => PROVIDERS_BY_ID[providerId].label,
      );
      return {
        id: `tool:${toolId}`,
        label: TOOL_INFO[toolId].label,
        currentValue,
        description:
          `Press Enter to configure web_${toolId}. ${TOOL_INFO[toolId].help} Route web_${toolId} to one compatible provider or turn it off.` +
          (compatibleLabels.length > 0
            ? ` Ready compatible providers: ${compatibleLabels.join(", ")}.`
            : ""),
        kind: "action",
      };
    });
  }

  private buildSettingsSectionItems(): SettingsEntry[] {
    return [
      ...SETTING_IDS.map((id) => ({
        id: `settings:${id}`,
        label: SETTING_META[id].label,
        currentValue: getSharedSettingDisplayValue(this.config, id),
        description: SETTING_META[id].help,
        kind: "text" as const,
      })),
    ];
  }

  private getSectionEntries(
    section: "provider" | "tools" | "settings",
  ): SettingsEntry[] {
    if (section === "provider") return this.buildProviderSectionItems();
    if (section === "settings") return this.buildSettingsSectionItems();
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
    const sections: Array<"provider" | "tools" | "settings"> = [
      "tools",
      "provider",
      "settings",
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
    const sections: Array<"provider" | "tools" | "settings"> = [
      "tools",
      "provider",
      "settings",
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
    const provider = PROVIDER_LIST[this.selection.provider];
    if (!provider) {
      return;
    }
    this.activeProvider = provider.id;
  }

  private renderSection(
    width: number,
    title: string,
    section: "provider" | "tools" | "settings",
    entries: SettingsEntry[],
  ): string[] {
    const labelWidth = Math.min(
      Math.max(...entries.map((entry) => entry.label.length), 0),
      Math.max(20, Math.floor(width * 0.45)),
    );
    const lines = [
      truncateToWidth(
        this.activeSection === section
          ? this.theme.fg("accent", this.theme.bold(title))
          : this.theme.bold(title),
        width,
      ),
    ];
    if (section === "provider") {
      lines.push(
        truncateToWidth(
          this.theme.fg(
            "dim",
            `  ${"Provider".padEnd(labelWidth, " ")}  S C A R  Status`,
          ),
          width,
        ),
      );
    }
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
      const value = entry.preserveValueStyle
        ? entry.currentValue
        : selected
          ? this.theme.fg("accent", entry.currentValue)
          : this.theme.fg("muted", entry.currentValue);
      lines.push(truncateToWidth(`${prefix}${label}  ${value}`, width));
    }
    if (section === "provider") {
      lines.push(
        truncateToWidth(
          this.theme.fg("dim", "  S=Search  C=Contents  A=Answer  R=Research"),
          width,
        ),
      );
    }
    return lines;
  }

  private async activateCurrentEntry(): Promise<void> {
    const entry = this.getSelectedEntry();
    if (!entry) return;

    if (entry.id.startsWith("settings:")) {
      const settingId = entry.id.slice("settings:".length) as SettingId;
      this.submenu = new TextValueSubmenu(
        this.tui,
        this.theme,
        entry.label,
        this.currentSharedSettingRawValue(settingId),
        entry.description,
        (selectedValue) => {
          this.submenu = undefined;
          if (selectedValue !== undefined) {
            void this.handleSharedSettingChange(settingId, selectedValue);
          }
          this.tui.requestRender();
        },
      );
      return;
    }

    if (entry.kind === "action" && entry.id.startsWith("tool:")) {
      const toolId = entry.id.slice("tool:".length) as Tool;
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
              config.providers?.[providerId],
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

  private currentSharedSettingRawValue(id: SettingId): string {
    return getSharedSettingRawValue(this.config, id);
  }

  private async handleSharedSettingChange(
    id: SettingId,
    value: string,
  ): Promise<void> {
    await this.persist((config) => {
      const parsed = SETTING_META[id].parse(value);
      const settings = ensureSettings(config);
      if (parsed === undefined) {
        delete settings[id];
      } else {
        settings[id] = parsed;
      }
      cleanupSettings(config);
      stripDuplicatePolicyOverrides(config);
    });
  }

  private currentProviderConfigFor(
    providerId: ProviderId,
  ): ProviderConfig | undefined {
    return this.config.providers?.[providerId];
  }

  private async persist(mutate: (config: WebProviders) => void): Promise<void> {
    const nextConfig = structuredClone(this.config);
    try {
      mutate(nextConfig);
      cleanupSettings(nextConfig);
      stripDuplicatePolicyOverrides(nextConfig);
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
    private readonly toolId: Tool,
    private readonly cwd: string,
    private readonly getConfig: () => WebProviders,
    private readonly persist: (
      mutate: (config: WebProviders) => void,
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
        this.theme.fg("accent", TOOL_INFO[this.toolId].label),
        width,
      ),
      "",
      ...renderEntryList(width, this.theme, entries, this.selection),
    ];

    const selected = entries[this.selection];
    if (selected) {
      lines.push("");
      lines.push(
        ...renderSelectedEntryDescription(width, this.theme, selected),
      );
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

    const kb = getKeybindings();
    const entries = this.getEntries();

    if (kb.matches(data, "tui.select.up")) {
      if (this.selection > 0) {
        this.selection -= 1;
      }
    } else if (kb.matches(data, "tui.select.down")) {
      if (this.selection < entries.length - 1) {
        this.selection += 1;
      }
    } else if (kb.matches(data, "tui.select.confirm") || data === " ") {
      void this.activateCurrentEntry();
    } else if (kb.matches(data, "tui.select.cancel")) {
      this.done();
      return;
    }

    this.tui.requestRender();
  }

  private getEntries(): SettingsEntry[] {
    const config = this.getConfig();
    const mappedProviderId = getMappedProviderIdForTool(config, this.toolId);
    const readyProviderIds = getReadyCompatibleProvidersForTool(
      config,
      this.cwd,
      this.toolId,
    );
    const providerValues = [
      "off",
      ...readyProviderIds.map(
        (providerId) => PROVIDERS_BY_ID[providerId].label,
      ),
    ];
    const currentProviderValue =
      mappedProviderId && readyProviderIds.includes(mappedProviderId)
        ? PROVIDERS_BY_ID[mappedProviderId].label
        : "off";

    const entries: SettingsEntry[] = [
      {
        id: "provider",
        label: "Provider",
        currentValue: currentProviderValue,
        description: `Route web_${this.toolId} to one compatible ready provider or turn it off.`,
        kind: "cycle",
        values: providerValues,
      },
    ];

    if (this.toolId === "search") {
      const prefetch = getSearchPrefetchDefaults(config);
      const effectivePrefetch = getEffectiveSearchPrefetchDefaults(config);
      const prefetchProviderIds = getReadyCompatibleProvidersForTool(
        config,
        this.cwd,
        "contents",
      );
      const prefetchValues = [
        "off",
        ...prefetchProviderIds.map(
          (providerId) => PROVIDERS_BY_ID[providerId].label,
        ),
      ];
      const currentPrefetchProviderValue =
        prefetch?.provider && prefetchProviderIds.includes(prefetch.provider)
          ? PROVIDERS_BY_ID[prefetch.provider].label
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
          currentValue: String(effectivePrefetch.maxUrls),
          description:
            "Maximum number of search result URLs to prefetch. Leave blank to use the built-in default.",
          kind: "text",
        },
        {
          id: "prefetchTtlMs",
          label: "Prefetch TTL",
          currentValue: String(effectivePrefetch.ttlMs),
          description:
            "How long prefetched contents stay reusable in the local cache, in milliseconds. Leave blank to use the built-in default.",
          kind: "text",
        },
      );
    }

    return entries;
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
          if (value === "off") {
            delete config.tools?.[this.toolId];
          } else {
            config.tools ??= {};
            const providerId = resolveProviderSelectionValue(
              getReadyCompatibleProvidersForTool(config, this.cwd, this.toolId),
              value,
            );
            if (!providerId) {
              throw new Error(`Unknown provider '${value}'.`);
            }
            config.tools[this.toolId] = providerId;
          }
          return;
        case "prefetchProvider": {
          const searchSettings = ensureSearchSettings(config);
          if (value === "off") {
            delete searchSettings.provider;
            return;
          }
          const providerId = resolveProviderSelectionValue(
            getReadyCompatibleProvidersForTool(config, this.cwd, "contents"),
            value,
          );
          if (!providerId) {
            throw new Error(`Unknown provider '${value}'.`);
          }
          searchSettings.provider = providerId;
          return;
        }
        case "prefetchMaxUrls":
          ensureSearchSettings(config).maxUrls =
            parseOptionalPositiveIntegerInput(
              value,
              "Prefetch URLs must be a positive integer.",
            );
          return;
        case "prefetchTtlMs":
          ensureSearchSettings(config).ttlMs =
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
    private readonly getProviderConfig: () => ProviderConfig | undefined,
    private readonly persist: (
      mutate: (config: ProviderConfig) => void,
    ) => Promise<void>,
    private readonly done: () => void,
  ) {}

  render(width: number): string[] {
    if (this.submenu) {
      return this.submenu.render(width);
    }

    const provider = PROVIDERS_BY_ID[this.providerId];
    const providerConfig = this.getProviderConfig();
    const entries = this.getEntries();
    const lines = [
      truncateToWidth(this.theme.fg("accent", provider.label), width),
      "",
      ...renderEntryList(width, this.theme, entries, this.selection),
    ];

    const selected = entries[this.selection];
    if (selected) {
      lines.push("");
      lines.push(
        ...renderSelectedEntryDescription(width, this.theme, selected),
      );
    }

    const status = getProviderReadinessSummaryForProviderConfig(
      this.providerId,
      providerConfig,
    );
    lines.push("");
    lines.push(
      truncateToWidth(this.theme.fg("dim", `Status: ${status}`), width),
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

    const kb = getKeybindings();
    const entries = this.getEntries();

    if (kb.matches(data, "tui.select.up")) {
      if (this.selection > 0) {
        this.selection -= 1;
      }
    } else if (kb.matches(data, "tui.select.down")) {
      if (this.selection < entries.length - 1) {
        this.selection += 1;
      }
    } else if (kb.matches(data, "tui.select.confirm") || data === " ") {
      void this.activateCurrentEntry();
    } else if (kb.matches(data, "tui.select.cancel")) {
      this.done();
      return;
    }

    this.tui.requestRender();
  }

  private getEntries(): SettingsEntry[] {
    const providerConfig = this.getProviderConfig();
    return getProviderSettings(this.providerId).map((setting) =>
      buildManifestSettingsEntry(setting, providerConfig),
    );
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

function ensureSearchSettings(config: WebProviders): SearchSettings {
  config.settings ??= {};
  config.settings.search ??= {};
  return config.settings.search;
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
  _providerId: ProviderId,
  current: ProviderConfig | undefined,
): ProviderConfig {
  return structuredClone((current ?? {}) as ProviderConfig);
}

function getInitialProviderSelection(config: WebProviders): ProviderId {
  for (const capability of Object.keys(CAPABILITY_TOOL_NAMES) as Tool[]) {
    const providerId = getMappedProviderIdForTool(config, capability);
    if (providerId) {
      return providerId;
    }
  }

  return "codex";
}

function didContentsCacheInputsChange(
  previous: WebProviders,
  next: WebProviders,
): boolean {
  return (
    stableStringify(getContentsCacheInputs(previous)) !==
    stableStringify(getContentsCacheInputs(next))
  );
}

function getContentsCacheInputs(config: WebProviders): Record<string, unknown> {
  const providers: Record<string, unknown> = {};

  for (const provider of PROVIDER_LIST) {
    if (!supportsTool(provider, "contents")) {
      continue;
    }

    providers[provider.id] = getEffectiveProviderConfig(config, provider.id);
  }

  return { providers: providers as Record<string, unknown> };
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

function formatProviderSetupState(
  state: "builtin" | "configured" | "none",
): string {
  switch (state) {
    case "builtin":
      return "builtin";
    case "configured":
      return "configured";
    case "none":
      return "—";
  }
}

function getProviderReadinessSummary(
  config: WebProviders,
  cwd: string,
  providerId: ProviderId,
): string {
  const tools = getProviderTools(providerId);
  const statuses = tools.map((tool) =>
    getProviderCapabilityStatus(config, cwd, providerId, tool),
  );
  if (statuses.some((status) => status.state === "ready")) {
    return "Ready";
  }
  return formatProviderCapabilityStatus(statuses[0], providerId, tools[0]);
}

function getProviderReadinessSummaryForProviderConfig(
  providerId: ProviderId,
  providerConfig: ProviderConfig | undefined,
): string {
  const status = PROVIDERS_BY_ID[providerId].getCapabilityStatus(
    (providerConfig ??
      PROVIDERS_BY_ID[providerId].config.createTemplate()) as never,
    "",
  );
  return formatProviderCapabilityStatus(status, providerId);
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

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampResults(value?: number, maximum = MAX_ALLOWED_RESULTS): number {
  if (value === undefined) return Math.min(DEFAULT_MAX_RESULTS, maximum);
  return Math.min(Math.max(Math.trunc(value), 1), maximum);
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

function createBatchCompletionReporter(
  verb: string,
  providerId: ProviderId,
  providerLabel: string,
  total: number,
  report: ProgressCallback,
): {
  start: () => void;
  markCompleted: () => void;
  markFailed: () => void;
} {
  if (!report) {
    return {
      start: () => {},
      markCompleted: () => {},
      markFailed: () => {},
    };
  }

  let completedCount = 0;
  let failedCount = 0;

  const emit = () => {
    let message = `${verb} via ${providerLabel}: ${completedCount}/${total} completed`;
    if (failedCount > 0) {
      message += `, ${failedCount} failed`;
    }
    const action =
      verb === "Fetching contents"
        ? `Fetching ${completedCount}/${total} pages`
        : `${verb} ${completedCount}/${total}`;
    report(message, buildProgressDisplay(providerId, action));
  };

  return {
    start: emit,
    markCompleted: () => {
      completedCount += 1;
      emit();
    },
    markFailed: () => {
      failedCount += 1;
      emit();
    },
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
    maxResultsSuffix,
    { quoteSingleItem: true },
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

interface SummaryParts {
  success: string;
  failure?: string;
}

function renderSummary(
  summary: SummaryParts,
  theme: Pick<Theme, "fg">,
  symbols: SummarySymbols,
): string {
  let rendered = renderSuccessSummary(summary.success, theme, symbols);
  if (summary.failure) {
    rendered += `, ${renderFailureSummary(summary.failure, theme, symbols)}`;
  }
  return rendered;
}

function renderSuccessSummary(
  text: string,
  theme: Pick<Theme, "fg">,
  symbols: SummarySymbols,
): string {
  return theme.fg("success", prefixWithSymbol(text, symbols.success));
}

function renderFailureSummary(
  text: string,
  theme: Pick<Theme, "fg">,
  symbols: SummarySymbols,
): string {
  return theme.fg("error", prefixWithSymbol(text, symbols.failure));
}

function renderFailureText(
  text: string,
  theme: Pick<Theme, "fg">,
  symbols: SummarySymbols,
): Text {
  return new Text(renderFailureSummary(text, theme, symbols), 0, 0);
}

function prefixWithSymbol(text: string, symbol: string | null): string {
  return symbol ? `${symbol} ${text}` : text;
}

function renderToolProgress(
  display: ToolDisplayDetails | undefined,
  fallbackText: string | undefined,
  theme: Pick<Theme, "fg">,
): Text {
  const progress = display?.progress;
  const providerLabel = display?.provider?.label;
  if (!progress || !providerLabel) {
    return renderSimpleText(fallbackText ?? "Working…", theme, "warning");
  }

  return new Text(
    `${theme.fg("warning", progress.action)} ${theme.fg("muted", `via ${providerLabel}`)}`,
    0,
    0,
  );
}

function renderCollapsedSearchSummary(
  details: WebSearchDetails,
  text: string | undefined,
  theme: Pick<Theme, "fg">,
  symbols: SummarySymbols = DEFAULT_SUMMARY_SYMBOLS,
): Text {
  const queryCount =
    typeof details?.queryCount === "number"
      ? details.queryCount
      : inferSearchQueryCount(text);
  const resultCount =
    typeof details?.resultCount === "number"
      ? details.resultCount
      : inferSearchResultCount(text);
  const failedQueryCount =
    typeof details?.failedQueryCount === "number"
      ? details.failedQueryCount
      : inferSearchFailureCount(text);
  const summary = buildSearchSummaryParts({
    queryCount,
    resultCount,
    failedQueryCount,
  });

  let rendered = renderSummary(summary, theme, symbols);
  rendered += theme.fg("muted", ` (${getExpandHint()})`);
  return new Text(rendered, 0, 0);
}

function buildSearchSummaryParts(options: {
  queryCount?: number;
  resultCount?: number;
  failedQueryCount?: number;
}): SummaryParts {
  return buildDisplaySearchSummaryParts(options);
}

function inferSearchQueryCount(text: string | undefined): number | undefined {
  if (!text) {
    return undefined;
  }

  const headingMatches = text.match(/^(?:##\s+)?Query\s+\d+:/gm);
  if (headingMatches && headingMatches.length > 0) {
    return headingMatches.length;
  }

  return undefined;
}

function inferSearchResultCount(text: string | undefined): number | undefined {
  if (!text) {
    return undefined;
  }

  const resultMatches = text.match(/^\d+\.\s+/gm);
  return resultMatches?.length;
}

function inferSearchFailureCount(text: string | undefined): number | undefined {
  if (!text) {
    return undefined;
  }

  const failureMatches = text.match(/^Search failed:/gm);
  return failureMatches?.length;
}

function buildFailureSummary({
  text,
  details,
  capability,
  fallback,
}: {
  text: string | undefined;
  details: ToolDetails | WebSearchDetails | undefined;
  capability: Tool;
  fallback: string;
}): string {
  const detail = stripTrailingSentencePunctuation(getFirstLine(text) ?? "");
  const providerLabel =
    details?.provider !== undefined
      ? (PROVIDERS_BY_ID[details.provider]?.label ?? details.provider)
      : undefined;

  if (!providerLabel) {
    return detail || fallback;
  }

  return formatProviderCapabilityFailure(providerLabel, capability, detail);
}

function formatProviderCapabilityFailure(
  providerLabel: string,
  capability: Tool,
  detail: string,
): string {
  const action = getFailureAction(capability);
  const base = `${providerLabel} ${action} failed`;
  if (!detail || detail === base) {
    return base;
  }

  if (detail.toLowerCase().startsWith(base.toLowerCase())) {
    return detail;
  }

  const normalizedDetail = normalizeProviderFailureDetail(
    providerLabel,
    detail,
  );

  return `${base}: ${normalizedDetail}`;
}

function normalizeProviderFailureDetail(
  providerLabel: string,
  detail: string,
): string {
  const normalized = stripTrailingSentencePunctuation(detail);
  const providerPrefix = `${providerLabel}:`;
  return normalized.toLowerCase().startsWith(providerPrefix.toLowerCase())
    ? normalized.slice(providerPrefix.length).trim()
    : normalized;
}

function getFailureAction(capability: Tool): string {
  switch (capability) {
    case "contents":
      return "fetch";
    case "search":
    case "answer":
    case "research":
      return capability;
  }
}

function toolFromFailureText(text: string): Tool {
  if (text.startsWith("web_contents")) {
    return "contents";
  }
  if (text.startsWith("web_answer")) {
    return "answer";
  }
  if (text.startsWith("web_research")) {
    return "research";
  }
  return "search";
}

function stripTrailingSentencePunctuation(text: string): string {
  return text.trim().replace(/[.\s]+$/u, "");
}

function formatSummaryElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0 && seconds === 0) {
    return `${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
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
    const keys = getKeybindings().getKeys("app.tools.expand");
    if (keys.length > 0) {
      return `${keys.join("/")} to expand`;
    }
  } catch {
    // Fall through to the default pi binding.
  }
  return "ctrl+o to expand";
}

function cleanSingleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function formatQuotedPreview(text: string, maxLength = 80): string {
  return `"${truncateInline(cleanSingleLine(text), maxLength)}"`;
}

function formatSearchResponses(
  outcomes: SearchQueryOutcome[],
  prefetch?: { provider: ProviderId; urlCount: number },
): string {
  const body = outcomes
    .map((outcome, index) =>
      formatSearchOutcomeSection(outcome, index, outcomes.length),
    )
    .join("\n\n");

  if (!prefetch) {
    return body;
  }

  return `${body}\n\n---\n\nBackground contents prefetch started via ${prefetch.provider} for ${prefetch.urlCount} URL(s).`;
}

function formatSearchOutcomeSection(
  outcome: SearchQueryOutcome,
  index: number,
  total: number,
): string {
  const body = outcome.response
    ? formatSearchResponseMarkdown(outcome.response)
    : `Search failed: ${outcome.error ?? "Unknown error."}`;
  if (total === 1) {
    return body;
  }
  const heading = `## Query ${index + 1}: ${formatSearchHeading(outcome.query)}`;
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
  return (await truncateAndSaveWithMetadata(text, prefix)).text;
}

async function truncateAndSaveWithMetadata(
  text: string,
  prefix: string,
): Promise<{ text: string; totalBytes: number; truncated: boolean }> {
  const totalBytes = Buffer.byteLength(text, "utf-8");
  const truncation = truncateHead(text, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  if (!truncation.truncated) {
    return {
      text: truncation.content,
      totalBytes,
      truncated: false,
    };
  }

  const dir = join(tmpdir(), `pi-web-providers-${prefix}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  const fullPath = join(dir, "output.txt");
  await writeFile(fullPath, text, "utf-8");

  return {
    text:
      truncation.content +
      `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines ` +
      `(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). ` +
      `Full output saved to: ${fullPath}]`,
    totalBytes,
    truncated: true,
  };
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
  loadConfig,
  didContentsCacheInputsChange,
  dispatchWebResearch: ({
    pi,
    activeWebResearchRequests,
    updateWebResearchWidget,
    config,
    explicitProvider,
    ctx,
    options,
    input,
    executionOverride,
  }: {
    pi: Pick<ExtensionAPI, "sendMessage">;
    activeWebResearchRequests: Map<string, ActiveWebResearchTask>;
    updateWebResearchWidget: (
      ctx?: Pick<ExtensionContext, "hasUI" | "ui">,
    ) => void;
    config: WebProviders;
    explicitProvider?: ProviderId;
    ctx: Pick<ExtensionContext, "cwd" | "hasUI" | "ui">;
    options: Record<string, unknown> | undefined;
    input: string;
    executionOverride?: ProviderExecution<"research">;
  }) =>
    dispatchWebResearchInternal({
      pi,
      activeWebResearchRequests,
      updateWebResearchWidget,
      config,
      explicitProvider,
      ctx,
      providerOptions: options,
      input,
      executionOverride,
    }),
  executeAnswerTool: ({
    config,
    explicitProvider,
    ctx,
    signal,
    onUpdate,
    options,
    queries,
    executionOverrides,
  }: {
    config: WebProviders;
    explicitProvider?: ProviderId;
    ctx: { cwd: string };
    signal: AbortSignal | null | undefined;
    onUpdate: ToolUpdateCallback;
    options: Record<string, unknown> | undefined;
    queries: string[];
    executionOverrides?: ProviderExecution<"answer">[];
  }) =>
    executeAnswerToolInternal({
      config,
      explicitProvider,
      ctx,
      signal,
      progress: createProgressEmitter(onUpdate),
      providerOptions: options,
      queries,
      executionOverrides,
    }),
  executeRawProviderRequest,
  executeProviderTool: ({
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
    executionOverride,
    executionOverrides,
  }: {
    capability: Exclude<Tool, "search">;
    config: WebProviders;
    explicitProvider?: ProviderId;
    ctx: { cwd: string };
    signal: AbortSignal | null | undefined;
    onUpdate: ToolUpdateCallback;
    options: Record<string, unknown> | undefined;
    urls?: string[];
    query?: string;
    input?: string;
    executionOverride?: ProviderExecution<Exclude<Tool, "search">>;
    executionOverrides?: ProviderExecution<"contents">[];
  }) =>
    executeProviderToolInternal({
      capability,
      config,
      explicitProvider,
      ctx,
      signal,
      progress: createProgressEmitter(onUpdate),
      providerOptions: options,
      urls,
      query,
      input,
      executionOverride,
      executionOverrides,
    }),
  executeSearchTool: ({
    config,
    explicitProvider,
    ctx,
    signal,
    onUpdate,
    options,
    maxResults,
    queries,
    executionOverrides,
  }: {
    config: WebProviders;
    explicitProvider?: ProviderId;
    ctx: { cwd: string };
    signal: AbortSignal | null | undefined;
    onUpdate: ToolUpdateCallback;
    options: Record<string, unknown> | undefined;
    maxResults?: number;
    queries: string[];
    executionOverrides?: ProviderExecution<"search">[];
  }) =>
    executeSearchToolInternal({
      config,
      explicitProvider,
      ctx,
      signal,
      progress: createProgressEmitter(onUpdate),
      providerOptions: options,
      maxResults,
      queries,
      executionOverrides,
    }),
  extractTextContent,
  formatWebResearchResultMessage,
  getActiveWebResearchRequests,
  getWebResearchTaskSnapshots,
  cancelWebResearchTask,
  loadWebResearchHistory,
  loadWebResearchPreview,
  getAvailableManagedToolNames,
  getReadyCompatibleProvidersForTool,
  getEnabledCompatibleProvidersForTool: getReadyCompatibleProvidersForTool,
  buildStructuredOptionsSchema,
  getAvailableProviderIdsForCapability,
  getProviderStatusForTool,
  getSyncedActiveTools,
  renderCallHeader,
  renderQuestionCallHeader,
  renderResearchCallHeader,
  renderToolCallHeader,
  renderCollapsedSearchSummary,
  renderCollapsedProviderToolSummary,
  renderSearchToolResult,
  renderProviderToolResult,
  renderWebResearchDispatchResult,
  renderWebResearchResultMessage,
  waitForPendingResearchTasks,
  formatSearchResponses,
  formatAnswerResponses,
};
