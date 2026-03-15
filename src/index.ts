import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  type ExtensionAPI,
  type ExtensionCommandContext,
  formatSize,
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
  canResolveContentsFromStore,
  formatPrefetchStatusText,
  getPrefetchStatus,
  parseSearchContentsPrefetchOptions,
  resolveContentsFromStore,
  startContentsPrefetch,
  stripSearchContentsPrefetchOptions,
  tryServeContentsFromStore,
} from "./prefetch-manager.js";
import {
  getProviderConfigManifest,
  type ProviderSettingDescriptor,
} from "./provider-config-manifests.js";
import {
  getEffectiveProviderConfig,
  resolveProviderChoice,
  resolveProviderForCapability,
  supportsProviderCapability,
} from "./provider-resolution.js";
import {
  executeOperationPlan,
  resolvePlanExecutionSupport,
} from "./provider-runtime.js";
import {
  isProviderToolEnabled,
  PROVIDER_TOOL_META,
  PROVIDER_TOOLS,
  type ProviderConfigUnion,
  type ProviderToolId,
} from "./provider-tools.js";
import { PROVIDER_MAP, PROVIDERS } from "./providers/index.js";
import type {
  ClaudeProviderConfig,
  CodexProviderConfig,
  ExaProviderConfig,
  GeminiProviderConfig,
  JsonObject,
  ParallelProviderConfig,
  ProviderId,
  ProviderOperationPlan,
  ProviderOperationRequest,
  ProviderToolDetails,
  ProviderToolOutput,
  SearchResponse,
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
const PROVIDER_OVERRIDE_GUIDELINES = [
  "Do not set provider unless the user asks for one.",
];

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
    await refreshManagedTools(pi, ctx.cwd, { addAvailable: true });
  });

  pi.on("before_agent_start", async (_event, ctx) => {
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
      ...PROVIDER_OVERRIDE_GUIDELINES,
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
      provider: providerEnum(
        visibleProviderIds,
        "Provider override. If omitted, uses the active configured provider or falls back to Codex for search when it is not explicitly disabled.",
      ),
    }),

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      return executeSearchTool({
        config: await loadConfig(),
        explicitProvider: params.provider,
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
          provider?: ProviderId;
          maxResults?: number;
        },
        theme,
      );
    },

    renderResult(result, { expanded, isPartial }, theme) {
      const text = extractTextContent(result.content);
      const isError = Boolean((result as { isError?: boolean }).isError);

      if (isPartial) {
        return undefined;
      }

      if (isError) {
        return renderBlockText(text ?? "web_search failed", theme, "error");
      }

      const details = result.details as WebSearchDetails | undefined;
      if (!details) {
        return renderBlockText(text ?? "", theme, "toolOutput");
      }

      if (expanded) {
        return renderBlockText(text ?? "", theme, "toolOutput");
      }

      return renderCollapsedSearchSummary(details, text, theme);
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
      provider: providerEnum(
        providerIds,
        "Provider override. If omitted, uses the active configured provider that supports web contents.",
      ),
    }),
    promptGuidelines: PROVIDER_OVERRIDE_GUIDELINES,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      return executeProviderTool({
        capability: "contents",
        config: await loadConfig(),
        explicitProvider: params.provider,
        ctx,
        signal,
        onUpdate,
        options: normalizeOptions(params.options),
        urls: params.urls,
      });
    },
    renderCall(args, theme) {
      const urls: string[] = Array.isArray((args as { urls?: string[] }).urls)
        ? ((args as { urls?: string[] }).urls ?? [])
        : [];
      const provider = String(
        (args as { provider?: string }).provider ?? "auto",
      );
      return {
        invalidate() {},
        render(width: number) {
          const lines: string[] = [];
          const header = theme.fg("toolTitle", theme.bold("web_contents"));
          const headerLine = truncateToWidth(header.trimEnd(), width);
          lines.push(
            headerLine +
              " ".repeat(Math.max(0, width - visibleWidth(headerLine))),
          );
          for (const url of urls) {
            const urlLine = truncateToWidth(
              `  ${theme.fg("accent", url)}`,
              width,
            );
            lines.push(
              urlLine + " ".repeat(Math.max(0, width - visibleWidth(urlLine))),
            );
          }
          const detailLine = truncateToWidth(
            `  ${theme.fg("muted", `provider=${provider}`)}`,
            width,
          );
          lines.push(
            detailLine +
              " ".repeat(Math.max(0, width - visibleWidth(detailLine))),
          );
          return lines;
        },
      };
    },
    renderResult(result, state, theme) {
      return renderProviderToolResult(
        result,
        state.expanded,
        state.isPartial,
        "web_contents failed",
        theme,
        { hidePartial: true },
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
      provider: providerEnum(
        providerIds,
        "Provider override. If omitted, uses the active configured provider that supports web answers.",
      ),
    }),
    promptGuidelines: [
      ...PROVIDER_OVERRIDE_GUIDELINES,
      "Prefer batching related questions into one web_answer call instead of making multiple calls.",
    ],
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      return executeAnswerTool({
        config: await loadConfig(),
        explicitProvider: params.provider,
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
          provider: (args as { provider?: ProviderId }).provider,
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
        { hidePartial: true },
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
      provider: providerEnum(
        providerIds,
        "Provider override. If omitted, uses the active configured provider that supports research.",
      ),
    }),
    promptGuidelines: PROVIDER_OVERRIDE_GUIDELINES,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      return executeProviderTool({
        capability: "research",
        config: await loadConfig(),
        explicitProvider: params.provider,
        ctx,
        signal,
        onUpdate,
        options: normalizeOptions(params.options),
        input: params.input,
      });
    },
    renderCall(args, theme) {
      return renderToolCallHeader(
        "web_research",
        formatQuotedPreview(String((args as { input?: string }).input ?? "")),
        [
          `provider=${String((args as { provider?: string }).provider ?? "auto")}`,
        ],
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
  const activeProvider = await getPreferredProvider(ctx.cwd);

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
  const providerIds: ProviderId[] = [];

  for (const providerId of getProviderIdsForCapability(capability)) {
    try {
      resolveProviderForCapability(config, providerId, cwd, capability);
      providerIds.push(providerId);
    } catch {
      // Exclude unavailable or disabled providers from the visible override list.
    }
  }

  return providerIds;
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

function providerEnum(providerIds: readonly ProviderId[], description: string) {
  if (providerIds.length === 1) {
    return Type.Optional(Type.Literal(providerIds[0], { description }));
  }
  return Type.Optional(
    Type.Union(
      providerIds.map((id) => Type.Literal(id)),
      { description },
    ),
  );
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
      " Local orchestration options may include prefetch={ enabled, maxUrls, provider, ttlMs, contentsOptions }.";
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
  explicitProvider: ProviderId | undefined;
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
  const provider = resolveProviderChoice(config, explicitProvider, ctx.cwd);
  const providerConfig = getEffectiveProviderConfig(config, provider.id);
  if (!providerConfig) {
    throw new Error(`Provider '${provider.id}' is not configured.`);
  }

  const prefetchOptions = parseSearchContentsPrefetchOptions(options);
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
    prefetchOptions?.enabled === true && planOverrides === undefined
      ? await startContentsPrefetch({
          config,
          cwd: ctx.cwd,
          urls: collectSearchResultUrls(outcomes),
          searchProviderId: provider.id,
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
  explicitProvider: ProviderId | undefined;
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
    explicitProvider,
    ctx.cwd,
    "answer",
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
  if (outcomes.length === 1) {
    return formatSingleAnswerOutcome(outcomes[0]);
  }

  return outcomes
    .map((outcome, index) => {
      const section = outcome.response
        ? outcome.response.text
        : `Answer failed: ${outcome.error ?? "Unknown error."}`;
      return `Question ${index + 1}: ${formatQuotedPreview(outcome.query)}\n${section}`;
    })
    .join("\n\n");
}

function formatSingleAnswerOutcome(
  outcome: AnswerQueryOutcome | undefined,
): string {
  if (outcome?.response) {
    return outcome.response.text;
  }
  return `Answer failed: ${outcome?.error ?? "Unknown error."}`;
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

  // Route through the content store only when the entire request can already
  // be satisfied from an exact prefetched batch or from per-URL cached entries.
  // Partial cache hits intentionally fall back to the provider's native batched
  // contents endpoint to avoid fanning out into one request per missing URL.
  if (capability === "contents" && planOverride === undefined) {
    const useStore = await canResolveContentsFromStore({
      urls: urls ?? [],
      providerId: provider.id,
      options,
    });
    if (useStore) {
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
  explicitProvider: ProviderId | undefined;
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
  // For contents: try to serve entirely from the local store before resolving
  // a provider.  This lets pure cache hits succeed even when the provider that
  // originally fetched the pages is later disabled or unavailable.
  if (
    capability === "contents" &&
    planOverride === undefined &&
    (urls?.length ?? 0) > 0
  ) {
    const cached = await tryServeContentsFromStore({
      urls: urls ?? [],
      explicitProvider,
      config,
      cwd: ctx.cwd,
      options,
      signal: signal ?? undefined,
    });
    if (cached) {
      const text = await truncateAndSave(cached.text, capability);
      return {
        content: [{ type: "text" as const, text }],
        details: {
          tool: "web_contents",
          provider: cached.provider,
          summary: cached.summary,
          itemCount: cached.itemCount,
        } as ProviderToolDetails,
      };
    }
  }

  const provider = resolveProviderForCapability(
    config,
    explicitProvider,
    ctx.cwd,
    capability,
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

function renderToolCallHeader(
  toolName: string,
  primary: string,
  details: string[],
  theme: Theme,
): Component {
  return {
    invalidate() {},
    render(width) {
      let header = theme.fg("toolTitle", theme.bold(toolName));
      if (primary.trim().length > 0) {
        header += ` ${theme.fg("accent", primary)}`;
      }

      const lines: string[] = [];
      const headerLine = truncateToWidth(header.trimEnd(), width);
      lines.push(
        headerLine + " ".repeat(Math.max(0, width - visibleWidth(headerLine))),
      );

      if (details.length > 0) {
        const detailLine = truncateToWidth(
          `  ${theme.fg("muted", details.join(" "))}`,
          width,
        );
        lines.push(
          detailLine +
            " ".repeat(Math.max(0, width - visibleWidth(detailLine))),
        );
      }

      return lines;
    },
  };
}

function renderQuestionCallHeader(
  params: {
    queries: string[];
    provider?: ProviderId;
  },
  theme: Theme,
): Component {
  return {
    invalidate() {},
    render(width) {
      const header = theme.fg("toolTitle", theme.bold("web_answer"));
      const questions = getAnswerQueriesForDisplay(params.queries);
      const lines: string[] = [];
      const headerLine = truncateToWidth(header, width);
      lines.push(
        headerLine + " ".repeat(Math.max(0, width - visibleWidth(headerLine))),
      );

      for (const question of questions) {
        const questionLine = truncateToWidth(
          `  ${theme.fg("accent", truncateInline(cleanSingleLine(question), 120))}`,
          width,
        );
        lines.push(
          questionLine +
            " ".repeat(Math.max(0, width - visibleWidth(questionLine))),
        );
      }

      const detailLine = truncateToWidth(
        `  ${theme.fg("muted", `provider=${params.provider ?? "auto"}`)}`,
        width,
      );
      lines.push(
        detailLine + " ".repeat(Math.max(0, width - visibleWidth(detailLine))),
      );
      return lines;
    },
  };
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
  options: { hidePartial?: boolean } = {},
): Text | undefined {
  const text = extractTextContent(result.content);

  if (isPartial) {
    if (options.hidePartial === true) {
      return undefined;
    }
    return renderSimpleText(text ?? "Working…", theme, "warning");
  }

  if (result.isError) {
    return renderBlockText(text ?? failureText, theme, "error");
  }

  if (expanded) {
    return renderBlockText(text ?? "", theme, "toolOutput");
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

  return (
    details?.summary ??
    getFirstLine(text) ??
    `${details?.tool ?? "tool"} output available`
  );
}

interface ProviderToolMenuOption {
  key: ProviderToolId;
  label: string;
  help: string;
}

interface SettingsEntry {
  id: string;
  label: string;
  currentValue: string;
  description: string;
  kind: "cycle" | "text";
  values?: string[];
}

function buildProviderToolMenuOptions(
  providerId: ProviderId,
): ProviderToolMenuOption[] {
  return PROVIDER_TOOLS[providerId].map((toolId) => ({
    key: toolId,
    label: PROVIDER_TOOL_META[toolId].label,
    help: PROVIDER_TOOL_META[toolId].help,
  }));
}

function getProviderSettings(
  providerId: ProviderId,
): readonly ProviderSettingDescriptor<ProviderConfigUnion>[] {
  return getProviderConfigManifest(providerId)
    .settings as readonly ProviderSettingDescriptor<ProviderConfigUnion>[];
}

class WebProvidersSettingsView implements Component {
  private config: WebProvidersConfig;
  private activeProvider: ProviderId;
  private activeSection: "provider" | "tools" | "config" = "provider";
  private selection = {
    provider: 0,
    tools: 0,
    config: 0,
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
  }

  render(width: number): string[] {
    if (this.submenu) {
      return this.submenu.render(width);
    }

    const lines: string[] = [];
    const providerItems = this.buildProviderSectionItems();
    lines.push(
      ...this.renderSection(width, "Provider", "provider", providerItems),
    );
    lines.push("");

    const toolItems = this.buildToolSectionItems();
    lines.push(...this.renderSection(width, "Tools", "tools", toolItems));
    lines.push("");

    const configItems = this.buildConfigSectionItems();
    lines.push(
      ...this.renderSection(
        width,
        "Provider config & policy",
        "config",
        configItems,
      ),
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
          "↑↓ move · Tab/Shift+Tab switch section · Enter edit/toggle · Esc close",
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
    return [
      {
        id: "provider",
        label: "Engine",
        currentValue: PROVIDER_MAP[this.activeProvider].label,
        description: "Active web provider. Enter cycles through providers.",
        kind: "cycle",
        values: PROVIDERS.map((provider) => provider.label),
      },
    ];
  }

  private buildToolSectionItems(): SettingsEntry[] {
    const providerConfig = this.currentProviderConfig();
    return buildProviderToolMenuOptions(this.activeProvider).map((option) => ({
      id: `tool:${option.key}`,
      label: option.label,
      currentValue: isProviderToolEnabled(
        this.activeProvider,
        providerConfig,
        option.key,
      )
        ? "on"
        : "off",
      description: option.help,
      kind: "cycle",
      values: ["on", "off"],
    }));
  }

  private buildConfigSectionItems(): SettingsEntry[] {
    const providerConfig = this.currentProviderConfig();
    return getProviderSettings(this.activeProvider).map((setting) =>
      this.buildProviderItem(setting, providerConfig),
    );
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

  private currentProviderConfig(): ProviderConfigUnion | undefined {
    return this.config.providers?.[this.activeProvider] as
      | ProviderConfigUnion
      | undefined;
  }

  private getSectionEntries(
    section: "provider" | "tools" | "config",
  ): SettingsEntry[] {
    if (section === "provider") return this.buildProviderSectionItems();
    if (section === "tools") return this.buildToolSectionItems();
    return this.buildConfigSectionItems();
  }

  private getActiveSectionEntries(): SettingsEntry[] {
    return this.getSectionEntries(this.activeSection);
  }

  private getSelectedEntry(): SettingsEntry | undefined {
    const entries = this.getActiveSectionEntries();
    return entries[this.selection[this.activeSection]];
  }

  private moveSection(direction: 1 | -1): void {
    const sections: Array<"provider" | "tools" | "config"> = [
      "provider",
      "tools",
      "config",
    ];
    const index = sections.indexOf(this.activeSection);
    for (let offset = 1; offset <= sections.length; offset++) {
      const next =
        sections[
          (index + offset * direction + sections.length) % sections.length
        ];
      if (this.getSectionEntries(next).length > 0) {
        this.activeSection = next;
        return;
      }
    }
  }

  private moveSelection(direction: 1 | -1): void {
    const sections: Array<"provider" | "tools" | "config"> = [
      "provider",
      "tools",
      "config",
    ];
    const currentEntries = this.getActiveSectionEntries();
    const currentIndex = this.selection[this.activeSection];

    if (direction === -1 && currentIndex > 0) {
      this.selection[this.activeSection] = currentIndex - 1;
      return;
    }

    if (direction === 1 && currentIndex < currentEntries.length - 1) {
      this.selection[this.activeSection] = currentIndex + 1;
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
      return;
    }
  }

  private renderSection(
    width: number,
    title: string,
    section: "provider" | "tools" | "config",
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
      return;
    }
  }

  private getEntryRawValue(id: string): string | undefined {
    const providerConfig = this.currentProviderConfig();
    const setting = getProviderSettings(this.activeProvider).find(
      (candidate) => candidate.id === id,
    );
    if (!setting || setting.kind !== "text") {
      return undefined;
    }
    return setting.getValue(providerConfig);
  }

  private async handleChange(id: string, value: string): Promise<void> {
    if (id === "provider") {
      const nextProvider = PROVIDERS.find(
        (provider) => provider.label === value,
      )?.id;
      if (!nextProvider || nextProvider === this.activeProvider) {
        return;
      }
      this.activeProvider = nextProvider;
      await this.persist((config) => {
        setActiveProvider(config, nextProvider);
      });
      this.selection.tools = 0;
      this.selection.config = 0;
      return;
    }

    await this.persist((config) => {
      config.providers ??= {};
      const providerConfig = getEditableProviderConfig(
        this.activeProvider,
        config.providers?.[this.activeProvider] as
          | ProviderConfigUnion
          | undefined,
      );

      if (id.startsWith("tool:")) {
        const toolId = id.slice("tool:".length) as ProviderToolId;
        const tools = (providerConfig.tools ?? {}) as Partial<
          Record<ProviderToolId, boolean>
        >;
        tools[toolId] = value === "on";
        providerConfig.tools = tools as typeof providerConfig.tools;
        config.providers[this.activeProvider] = providerConfig as never;
        return;
      }

      const setting = getProviderSettings(this.activeProvider).find(
        (candidate) => candidate.id === id,
      );
      if (!setting) {
        throw new Error(`Unknown setting '${id}'.`);
      }
      setting.setValue(providerConfig, value);
      config.providers[this.activeProvider] = providerConfig as never;
    });
  }

  private async persist(
    mutate: (config: WebProvidersConfig) => void,
  ): Promise<void> {
    const nextConfig = structuredClone(this.config);
    try {
      mutate(nextConfig);
      await writeConfigFile(nextConfig);
      this.config = nextConfig;
      this.tui.requestRender();
    } catch (error) {
      this.ctx.ui.notify((error as Error).message, "error");
    }
  }
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

function setActiveProvider(
  config: WebProvidersConfig,
  providerId: ProviderId,
): void {
  const currentProviders = config.providers ?? {};
  const candidateIds = new Set<ProviderId>([providerId]);

  for (const id of Object.keys(currentProviders) as ProviderId[]) {
    candidateIds.add(id);
  }

  config.providers ??= {};
  for (const id of candidateIds) {
    const providerConfig = getEditableProviderConfig(
      id,
      config.providers?.[id] as ProviderConfigUnion | undefined,
    ) as Record<string, JsonObject | string | boolean | undefined>;
    providerConfig.enabled = id === providerId;
    config.providers[id] = providerConfig as never;
  }
}

function getResolvedProviderChoice(
  effective: WebProvidersConfig,
  cwd: string,
): ProviderId | undefined {
  try {
    return resolveProviderChoice(effective, undefined, cwd).id;
  } catch {
    return undefined;
  }
}

async function getPreferredProvider(cwd: string): Promise<ProviderId> {
  const current = await loadConfig();
  return getResolvedProviderChoice(current, cwd) ?? "codex";
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
    provider?: ProviderId;
    maxResults?: number;
  },
  theme: Theme,
): Component {
  return {
    invalidate() {},
    render(width) {
      let header = theme.fg("toolTitle", theme.bold("web_search"));
      const queries = getSearchQueriesForDisplay(params.queries);
      const showExpandedQueries = queries.length > 1;
      if (queries.length === 1) {
        header += ` ${theme.fg("accent", formatQuotedPreview(queries[0]))} `;
      }

      const lines: string[] = [];
      const headerLine = truncateToWidth(header.trimEnd(), width);
      lines.push(
        headerLine + " ".repeat(Math.max(0, width - visibleWidth(headerLine))),
      );

      if (showExpandedQueries) {
        for (const query of queries) {
          const queryLine = truncateToWidth(
            `  ${theme.fg("accent", truncateInline(cleanSingleLine(query), 120))}`,
            width,
          );
          lines.push(
            queryLine +
              " ".repeat(Math.max(0, width - visibleWidth(queryLine))),
          );
        }
      }

      const detailParts = [
        `provider=${params.provider ?? "auto"}`,
        `maxResults=${params.maxResults ?? DEFAULT_MAX_RESULTS}`,
      ];
      const details = truncateToWidth(
        `  ${theme.fg("muted", detailParts.join(" "))}`,
        width,
      );
      lines.push(
        details + " ".repeat(Math.max(0, width - visibleWidth(details))),
      );
      return lines;
    },
  };
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
  text: string | undefined,
  theme: Pick<Theme, "fg">,
): Text {
  const count = `${details.resultCount} result${details.resultCount === 1 ? "" : "s"}`;
  const queryCount = details.queryCount;
  const failureSuffix =
    details.failedQueryCount > 0 ? `, ${details.failedQueryCount} failed` : "";
  const base =
    queryCount > 1
      ? `${queryCount} queries, ${count} via ${details.provider}${failureSuffix}`
      : (getFirstLine(text) ?? `${count} via ${details.provider}`);
  let summary = theme.fg("success", base);
  summary += theme.fg("muted", ` (${getExpandHint()})`);
  return new Text(summary, 0, 0);
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
  const body =
    outcomes.length === 1
      ? formatSingleSearchOutcome(outcomes[0])
      : outcomes
          .map((outcome, index) => {
            const section = outcome.response
              ? formatSearchResponse(outcome.response)
              : `Search failed: ${outcome.error ?? "Unknown error."}`;
            return `Query ${index + 1}: ${formatQuotedPreview(outcome.query)}\n${section}`;
          })
          .join("\n\n");

  if (!prefetch) {
    return body;
  }

  return `${body}\n\nBackground contents prefetch started via ${prefetch.provider} for ${prefetch.urlCount} URL(s). Prefetch id: ${prefetch.prefetchId}`;
}

function formatSingleSearchOutcome(
  outcome: SearchQueryOutcome | undefined,
): string {
  if (outcome?.response) {
    return formatSearchResponse(outcome.response);
  }
  return `Search failed: ${outcome?.error ?? "Unknown error."}`;
}

function collectSearchResultUrls(outcomes: SearchQueryOutcome[]): string[] {
  return outcomes.flatMap(
    (outcome) => outcome.response?.results.map((result) => result.url) ?? [],
  );
}

function formatSearchResponse(response: SearchResponse): string {
  if (response.results.length === 0) {
    return "No results found.";
  }

  const lines: string[] = [];
  for (const [index, result] of response.results.entries()) {
    lines.push(`${index + 1}. ${result.title}`);
    lines.push(`   ${result.url}`);
    if (result.snippet) {
      lines.push(`   ${result.snippet}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
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
  executeAnswerTool,
  executeProviderTool,
  executeSearchTool,
  extractTextContent,
  getAvailableManagedToolNames,
  describeOptionsField,
  getAvailableProviderIdsForCapability,
  getSyncedActiveTools,
  renderCallHeader,
  renderQuestionCallHeader,
  renderCollapsedSearchSummary,
};
