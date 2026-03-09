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
  getEffectiveProviderConfig,
  resolveProviderChoice,
  resolveProviderForCapability,
} from "./provider-resolution.js";
import {
  isProviderToolEnabled,
  PROVIDER_TOOL_META,
  PROVIDER_TOOLS,
  type ProviderConfigUnion,
  type ProviderToolId,
} from "./provider-tools.js";
import { PROVIDER_MAP, PROVIDERS } from "./providers/index.js";
import type {
  CodexProviderConfig,
  ExaProviderConfig,
  GeminiProviderConfig,
  JsonObject,
  ParallelProviderConfig,
  ProviderId,
  ProviderToolDetails,
  ProviderToolOutput,
  SearchResponse,
  ValyuProviderConfig,
  WebProvidersConfig,
  WebSearchDetails,
} from "./types.js";
import { PROVIDER_IDS } from "./types.js";

const DEFAULT_MAX_RESULTS = 5;
const MAX_ALLOWED_RESULTS = 20;
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
const WEB_SEARCH_PROMPT_GUIDELINES = [
  ...PROVIDER_OVERRIDE_GUIDELINES,
  "Use at most one web_search per question unless the first result is clearly insufficient or off-topic.",
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
      "Search the public web and return results with titles, URLs, and snippets. " +
      `Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)} when needed.`,
    promptSnippet: "Search once; answer from the sources.",
    promptGuidelines: WEB_SEARCH_PROMPT_GUIDELINES,
    parameters: Type.Object({
      query: Type.String({ description: "What to search for on the web" }),
      maxResults: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: MAX_ALLOWED_RESULTS,
          description: `Maximum number of results to return (default: ${DEFAULT_MAX_RESULTS})`,
        }),
      ),
      provider: providerEnum(
        visibleProviderIds,
        "Provider override. If omitted, uses the active configured provider or falls back to Codex for search when it is not explicitly disabled.",
      ),
    }),

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const config = await loadConfig();
      const provider = resolveProviderChoice(config, params.provider, ctx.cwd);
      const maxResults = clampResults(params.maxResults);
      const providerConfig = getEffectiveProviderConfig(config, provider.id);

      if (!providerConfig) {
        throw new Error(`Provider '${provider.id}' is not configured.`);
      }

      const response = await provider.search!(
        params.query,
        maxResults,
        providerConfig as never,
        {
          cwd: ctx.cwd,
          signal: signal ?? undefined,
          onProgress: (message) =>
            onUpdate?.({
              content: [{ type: "text", text: message }],
              details: {},
            }),
        },
      );

      const rendered = await truncateAndSave(
        formatSearchResponse(response),
        "web-search",
      );

      const details: WebSearchDetails = {
        tool: "web_search",
        query: params.query,
        provider: response.provider,
        resultCount: response.results.length,
      };

      return { content: [{ type: "text", text: rendered }], details };
    },

    renderCall(args, theme) {
      return renderCallHeader(
        args as { query?: string; provider?: ProviderId; maxResults?: number },
        theme,
      );
    },

    renderResult(result, { expanded, isPartial }, theme) {
      const text = extractTextContent(result.content);
      const isError = Boolean((result as { isError?: boolean }).isError);

      if (isPartial) {
        return renderSimpleText(text ?? "Searching…", theme, "warning");
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
    description:
      "Fetch extracted contents for one or more URLs using a configured provider.",
    parameters: Type.Object({
      urls: Type.Array(Type.String({ minLength: 1 }), {
        minItems: 1,
        description: "One or more URLs to extract",
      }),
      options: jsonOptionsSchema("Provider-specific extraction options."),
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
        invoke: (provider, providerConfig, context) =>
          provider.contents!(
            params.urls,
            normalizeOptions(params.options),
            providerConfig as never,
            context,
          ),
      });
    },
    renderCall(args, theme) {
      return renderToolCallHeader(
        "web_contents",
        `${Array.isArray((args as { urls?: unknown[] }).urls) ? ((args as { urls?: unknown[] }).urls?.length ?? 0) : 0} url(s)`,
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
    description: "Get a provider-generated answer grounded in web results.",
    parameters: Type.Object({
      query: Type.String({ description: "Question to answer" }),
      options: jsonOptionsSchema("Provider-specific answer options."),
      provider: providerEnum(
        providerIds,
        "Provider override. If omitted, uses the active configured provider that supports web answers.",
      ),
    }),
    promptGuidelines: PROVIDER_OVERRIDE_GUIDELINES,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      return executeProviderTool({
        capability: "answer",
        config: await loadConfig(),
        explicitProvider: params.provider,
        ctx,
        signal,
        onUpdate,
        invoke: (provider, providerConfig, context) =>
          provider.answer!(
            params.query,
            normalizeOptions(params.options),
            providerConfig as never,
            context,
          ),
      });
    },
    renderCall(args, theme) {
      return renderToolCallHeader(
        "web_answer",
        `"${cleanSingleLine(String((args as { query?: string }).query ?? "")).slice(0, 80)}"`,
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
        "web_answer failed",
        theme,
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
      "Run a longer-form research task using a provider that supports research.",
    parameters: Type.Object({
      input: Type.String({ description: "Research brief or question" }),
      options: jsonOptionsSchema("Provider-specific research options."),
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
        invoke: (provider, providerConfig, context) =>
          provider.research!(
            params.input,
            normalizeOptions(params.options),
            providerConfig as never,
            context,
          ),
      });
    },
    renderCall(args, theme) {
      return renderToolCallHeader(
        "web_research",
        `"${cleanSingleLine(String((args as { input?: string }).input ?? "")).slice(0, 80)}"`,
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

async function refreshManagedTools(
  pi: ExtensionAPI,
  cwd: string,
  options: { addAvailable: boolean },
): Promise<void> {
  const config = await loadConfig();

  registerManagedTools(pi, {
    search: getAvailableProviderIdsForCapability(config, cwd, "search"),
    contents: getAvailableProviderIdsForCapability(config, cwd, "contents"),
    answer: getAvailableProviderIdsForCapability(config, cwd, "answer"),
    research: getAvailableProviderIdsForCapability(config, cwd, "research"),
  });

  await syncManagedToolAvailability(pi, config, cwd, options);
}

async function syncManagedToolAvailability(
  pi: ExtensionAPI,
  config: WebProvidersConfig,
  cwd: string,
  options: { addAvailable: boolean },
): Promise<void> {
  const availableToolNames = new Set(getAvailableManagedToolNames(config, cwd));
  const activeTools = new Set(pi.getActiveTools());
  let changed = false;

  for (const toolName of MANAGED_TOOL_NAMES) {
    if (availableToolNames.has(toolName)) {
      if (options.addAvailable && !activeTools.has(toolName)) {
        activeTools.add(toolName);
        changed = true;
      }
      continue;
    }

    if (activeTools.delete(toolName)) {
      changed = true;
    }
  }

  if (changed) {
    pi.setActiveTools(Array.from(activeTools));
  }
}

function getProviderIdsForCapability(
  capability: ProviderCapability,
): ProviderId[] {
  return PROVIDERS.filter(
    (provider) => typeof provider[capability] === "function",
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

async function executeProviderTool({
  capability,
  config,
  explicitProvider,
  ctx,
  signal,
  onUpdate,
  invoke,
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
  invoke: (
    provider: (typeof PROVIDERS)[number],
    providerConfig: ProviderConfigUnion,
    context: {
      cwd: string;
      signal?: AbortSignal;
      onProgress?: (message: string) => void;
    },
  ) => Promise<ProviderToolOutput>;
}) {
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

  const response = await invoke(
    provider,
    providerConfig as ProviderConfigUnion,
    {
      cwd: ctx.cwd,
      signal: signal ?? undefined,
      onProgress: (message) =>
        onUpdate?.({
          content: [{ type: "text", text: message }],
          details: {},
        }),
    },
  );

  const details: ProviderToolDetails = {
    tool: `web_${capability}`,
    provider: response.provider,
    summary: response.summary,
    itemCount: response.itemCount,
  };

  return {
    content: [{ type: "text" as const, text: response.text }],
    details,
  };
}

function normalizeOptions(value: unknown): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
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
): Text {
  const text = extractTextContent(result.content);

  if (isPartial) {
    return renderSimpleText(text ?? "Working…", theme, "warning");
  }

  if (result.isError) {
    return renderBlockText(text ?? failureText, theme, "error");
  }

  if (expanded) {
    return renderBlockText(text ?? "", theme, "toolOutput");
  }

  const details = result.details as ProviderToolDetails | undefined;
  const summary =
    details?.summary ??
    getFirstLine(text) ??
    `${details?.tool ?? "tool"} output available`;
  let summaryText = theme.fg("success", summary);
  summaryText += theme.fg("muted", ` (${getExpandHint()})`);
  return new Text(summaryText, 0, 0);
}

interface ProviderMenuOption {
  key:
    | "apiKey"
    | "baseUrl"
    | "model"
    | "modelReasoningEffort"
    | "webSearchMode"
    | "networkAccessEnabled"
    | "webSearchEnabled"
    | "additionalDirectories"
    | "exaSearchType"
    | "exaTextContents"
    | "geminiApiVersion"
    | "geminiSearchModel"
    | "geminiAnswerModel"
    | "geminiResearchAgent"
    | "parallelSearchMode"
    | "parallelExtractExcerpts"
    | "parallelExtractFullContent"
    | "valyuSearchType"
    | "valyuResponseLength";
  label: string;
  help: string;
  kind: "text" | "values";
  values?: string[];
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

function buildProviderMenuOptions(
  providerId: ProviderId,
): ProviderMenuOption[] {
  const options: ProviderMenuOption[] = [];

  const pushText = (
    key:
      | "apiKey"
      | "baseUrl"
      | "model"
      | "additionalDirectories"
      | "geminiSearchModel"
      | "geminiAnswerModel"
      | "geminiResearchAgent",
    label: string,
    help: string,
  ) => {
    options.push({
      key,
      label,
      help,
      kind: "text",
    });
  };

  const pushValues = (
    key:
      | "modelReasoningEffort"
      | "webSearchMode"
      | "networkAccessEnabled"
      | "webSearchEnabled"
      | "exaSearchType"
      | "exaTextContents"
      | "geminiApiVersion"
      | "parallelSearchMode"
      | "parallelExtractExcerpts"
      | "parallelExtractFullContent"
      | "valyuSearchType"
      | "valyuResponseLength",
    label: string,
    help: string,
    values: string[],
  ) => {
    options.push({
      key,
      label,
      help,
      kind: "values",
      values,
    });
  };

  if (providerId === "codex") {
    pushText(
      "model",
      "Model",
      "Optional Codex model override. Leave empty to use the local default.",
    );
    pushValues(
      "modelReasoningEffort",
      "Reasoning effort",
      "Reasoning depth for Codex. 'default' uses the SDK default.",
      ["default", "minimal", "low", "medium", "high", "xhigh"],
    );
    pushValues(
      "webSearchMode",
      "Web search mode",
      "How Codex should source web results. 'default' currently behaves like 'live'.",
      ["default", "disabled", "cached", "live"],
    );
    pushValues(
      "networkAccessEnabled",
      "Network access",
      "Allow Codex network access during search runs. 'default' currently behaves like 'true'.",
      ["default", "true", "false"],
    );
    pushValues(
      "webSearchEnabled",
      "Web search",
      "Enable Codex web search. 'default' currently behaves like 'true'.",
      ["default", "true", "false"],
    );
    pushText(
      "additionalDirectories",
      "Additional dirs",
      "Optional comma-separated directories that Codex may read in addition to the current working directory.",
    );
    return options;
  }

  pushText(
    "apiKey",
    "API key",
    "Provider API key. You can use a literal value, an env var name like EXA_API_KEY, or !command.",
  );
  if (providerId !== "gemini") {
    pushText("baseUrl", "Base URL", "Optional API base URL override.");
  }

  if (providerId === "exa") {
    pushValues(
      "exaSearchType",
      "Search type",
      "Exa search mode. 'default' uses the SDK default.",
      [
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
    );
    pushValues(
      "exaTextContents",
      "Text contents",
      "Whether Exa should include text contents in search results. 'default' uses the SDK default.",
      ["default", "true", "false"],
    );
    return options;
  }

  if (providerId === "gemini") {
    pushValues(
      "geminiApiVersion",
      "API version",
      "Gemini API version. 'default' uses the SDK default beta endpoints.",
      ["default", "v1alpha", "v1beta", "v1"],
    );
    pushText(
      "geminiSearchModel",
      "Search model",
      "Model used for Gemini search interactions.",
    );
    pushText(
      "geminiAnswerModel",
      "Answer model",
      "Model used for grounded Gemini answers.",
    );
    pushText(
      "geminiResearchAgent",
      "Research agent",
      "Agent used for Gemini deep research runs.",
    );
    return options;
  }

  if (providerId === "parallel") {
    pushValues(
      "parallelSearchMode",
      "Search mode",
      "Parallel search mode. 'default' uses the SDK default.",
      ["default", "agentic", "one-shot"],
    );
    pushValues(
      "parallelExtractExcerpts",
      "Extract excerpts",
      "Include excerpts in Parallel extraction results. 'default' uses the SDK default.",
      ["default", "on", "off"],
    );
    pushValues(
      "parallelExtractFullContent",
      "Extract full content",
      "Include full page content in Parallel extraction results. 'default' uses the SDK default.",
      ["default", "on", "off"],
    );
    return options;
  }

  pushValues(
    "valyuSearchType",
    "Search type",
    "Valyu search type. 'default' uses the SDK default.",
    ["default", "all", "web", "proprietary", "news"],
  );
  pushValues(
    "valyuResponseLength",
    "Response length",
    "Valyu response length. 'default' uses the SDK default.",
    ["default", "short", "medium", "large", "max"],
  );

  return options;
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
      ...this.renderSection(width, "Provider config", "config", configItems),
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
    return buildProviderMenuOptions(this.activeProvider).map((option) =>
      this.buildProviderItem(option, providerConfig),
    );
  }

  private buildProviderItem(
    option: ProviderMenuOption,
    providerConfig: ProviderConfigUnion | undefined,
  ): SettingsEntry {
    if (option.kind === "values") {
      return {
        id: option.key,
        label: option.label,
        currentValue: getProviderChoiceValue(
          this.activeProvider,
          providerConfig,
          option.key as
            | "modelReasoningEffort"
            | "webSearchMode"
            | "networkAccessEnabled"
            | "webSearchEnabled"
            | "exaSearchType"
            | "exaTextContents"
            | "geminiApiVersion"
            | "parallelSearchMode"
            | "parallelExtractExcerpts"
            | "parallelExtractFullContent"
            | "valyuSearchType"
            | "valyuResponseLength",
        ),
        values: option.values,
        description: option.help,
        kind: "cycle",
      };
    }

    if (option.kind === "text") {
      const key = option.key as ProviderMenuOption["key"];
      const currentValue =
        key === "model" || key === "additionalDirectories"
          ? getCodexTextSettingValue(
              providerConfig as CodexProviderConfig | undefined,
              key,
            )
          : key === "geminiSearchModel" ||
              key === "geminiAnswerModel" ||
              key === "geminiResearchAgent"
            ? getGeminiTextSettingValue(
                providerConfig as GeminiProviderConfig | undefined,
                key,
              )
            : getProviderStringValue(
                providerConfig,
                key as "apiKey" | "baseUrl",
              );
      const secret = key === "apiKey";
      return {
        id: key,
        label: option.label,
        currentValue: summarizeStringValue(currentValue, secret),
        description: option.help,
        kind: "text",
      };
    }

    throw new Error(`Unsupported provider menu option: ${option.key}`);
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
    if (id === "apiKey" || id === "baseUrl") {
      return getProviderStringValue(providerConfig, id);
    }
    if (id === "model" || id === "additionalDirectories") {
      return getCodexTextSettingValue(
        providerConfig as CodexProviderConfig | undefined,
        id,
      );
    }
    if (
      id === "geminiSearchModel" ||
      id === "geminiAnswerModel" ||
      id === "geminiResearchAgent"
    ) {
      return getGeminiTextSettingValue(
        providerConfig as GeminiProviderConfig | undefined,
        id,
      );
    }
    return undefined;
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
      ) as Record<string, JsonObject | string | boolean | undefined>;

      if (id.startsWith("tool:")) {
        const toolId = id.slice("tool:".length) as ProviderToolId;
        const typedProviderConfig =
          providerConfig as unknown as ProviderConfigUnion;
        const tools = (typedProviderConfig.tools ?? {}) as Partial<
          Record<ProviderToolId, boolean>
        >;
        tools[toolId] = value === "on";
        typedProviderConfig.tools = tools as typeof typedProviderConfig.tools;
        config.providers[this.activeProvider] = typedProviderConfig as never;
        return;
      }

      if (id === "apiKey" || id === "baseUrl") {
        assignOptionalString(providerConfig, id, value);
      } else if (
        this.activeProvider === "codex" &&
        applyCodexSettingChange(
          providerConfig as unknown as CodexProviderConfig,
          id,
          value,
        )
      ) {
        // handled above
      } else if (
        this.activeProvider === "exa" &&
        applyExaSettingChange(
          providerConfig as unknown as ExaProviderConfig,
          id,
          value,
        )
      ) {
        // handled above
      } else if (
        this.activeProvider === "gemini" &&
        applyGeminiSettingChange(
          providerConfig as unknown as GeminiProviderConfig,
          id,
          value,
        )
      ) {
        // handled above
      } else if (
        this.activeProvider === "parallel" &&
        applyParallelSettingChange(
          providerConfig as unknown as ParallelProviderConfig,
          id,
          value,
        )
      ) {
        // handled above
      } else if (
        this.activeProvider === "valyu" &&
        applyValyuSettingChange(
          providerConfig as unknown as ValyuProviderConfig,
          id,
          value,
        )
      ) {
        // handled above
      } else {
        throw new Error(`Unknown setting '${id}'.`);
      }
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

function getProviderStringValue(
  config: ProviderConfigUnion | undefined,
  key: "apiKey" | "baseUrl",
): string | undefined {
  if (!config) return undefined;
  const value = (config as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function getProviderChoiceValue(
  providerId: ProviderId,
  config: ProviderConfigUnion | undefined,
  key:
    | "modelReasoningEffort"
    | "webSearchMode"
    | "networkAccessEnabled"
    | "webSearchEnabled"
    | "exaSearchType"
    | "exaTextContents"
    | "geminiApiVersion"
    | "parallelSearchMode"
    | "parallelExtractExcerpts"
    | "parallelExtractFullContent"
    | "valyuSearchType"
    | "valyuResponseLength",
): string {
  if (providerId === "codex") {
    const defaults = (config as CodexProviderConfig | undefined)?.defaults;
    if (key === "networkAccessEnabled" || key === "webSearchEnabled") {
      const value = defaults?.[key];
      return typeof value === "boolean" ? String(value) : "default";
    }
    if (key === "modelReasoningEffort" || key === "webSearchMode") {
      const value = defaults?.[key];
      return typeof value === "string" ? value : "default";
    }
  }

  if (providerId === "exa") {
    const defaults = (config as ExaProviderConfig | undefined)?.defaults as
      | Record<string, unknown>
      | undefined;
    if (key === "exaSearchType") {
      return typeof defaults?.type === "string" ? defaults.type : "default";
    }
    if (key === "exaTextContents") {
      const contents = isJsonObject(defaults?.contents)
        ? defaults.contents
        : undefined;
      return typeof contents?.text === "boolean"
        ? String(contents.text)
        : "default";
    }
  }

  if (providerId === "valyu") {
    const defaults = (config as ValyuProviderConfig | undefined)?.defaults as
      | Record<string, unknown>
      | undefined;
    if (key === "valyuSearchType") {
      return typeof defaults?.searchType === "string"
        ? defaults.searchType
        : "default";
    }
    if (key === "valyuResponseLength") {
      return typeof defaults?.responseLength === "string"
        ? defaults.responseLength
        : "default";
    }
  }

  if (providerId === "gemini") {
    const defaults = (config as GeminiProviderConfig | undefined)?.defaults;
    if (key === "geminiApiVersion") {
      return typeof defaults?.apiVersion === "string"
        ? defaults.apiVersion
        : "default";
    }
  }

  if (providerId === "parallel") {
    const defaults = (config as ParallelProviderConfig | undefined)?.defaults;
    const search = isJsonObject(defaults?.search) ? defaults.search : undefined;
    const extract = isJsonObject(defaults?.extract)
      ? defaults.extract
      : undefined;
    if (key === "parallelSearchMode") {
      return typeof search?.mode === "string" ? search.mode : "default";
    }
    if (key === "parallelExtractExcerpts") {
      if (extract?.excerpts === undefined) return "default";
      return extract.excerpts ? "on" : "off";
    }
    if (key === "parallelExtractFullContent") {
      if (extract?.full_content === undefined) return "default";
      return extract.full_content ? "on" : "off";
    }
  }

  throw new Error(`Unsupported choice setting '${key}' for '${providerId}'.`);
}

function getCodexTextSettingValue(
  config: CodexProviderConfig | undefined,
  key: "model" | "additionalDirectories",
): string | undefined {
  const defaults = config?.defaults;
  if (!defaults) return undefined;
  if (key === "additionalDirectories") {
    return defaults.additionalDirectories?.join(", ");
  }
  return defaults.model;
}

function getGeminiTextSettingValue(
  config: GeminiProviderConfig | undefined,
  key: "geminiSearchModel" | "geminiAnswerModel" | "geminiResearchAgent",
): string | undefined {
  const defaults = config?.defaults;
  if (!defaults) return undefined;
  if (key === "geminiSearchModel") return defaults.searchModel;
  if (key === "geminiAnswerModel") return defaults.answerModel;
  return defaults.researchAgent;
}

function assignOptionalString(
  target: Record<string, JsonObject | string | boolean | undefined>,
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

function applyCodexSettingChange(
  target: CodexProviderConfig,
  key: string,
  value: string,
): boolean {
  target.defaults ??= {};

  switch (key) {
    case "model":
      assignOptionalString(
        target.defaults as Record<
          string,
          JsonObject | string | boolean | undefined
        >,
        "model",
        value,
      );
      cleanupCodexDefaults(target);
      return true;
    case "additionalDirectories": {
      const trimmed = value.trim();
      if (!trimmed) {
        delete target.defaults.additionalDirectories;
      } else {
        target.defaults.additionalDirectories = trimmed
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);
      }
      cleanupCodexDefaults(target);
      return true;
    }
    case "modelReasoningEffort":
    case "webSearchMode":
      if (value === "default") {
        delete target.defaults[key];
      } else {
        target.defaults[key] = value as never;
      }
      cleanupCodexDefaults(target);
      return true;
    case "networkAccessEnabled":
    case "webSearchEnabled":
      if (value === "default") {
        delete target.defaults[key];
      } else {
        target.defaults[key] = value === "true";
      }
      cleanupCodexDefaults(target);
      return true;
    default:
      return false;
  }
}

function applyExaSettingChange(
  target: ExaProviderConfig,
  key: string,
  value: string,
): boolean {
  target.defaults = isJsonObject(target.defaults) ? { ...target.defaults } : {};

  switch (key) {
    case "exaSearchType":
      if (value === "default") {
        delete target.defaults.type;
      } else {
        target.defaults.type = value;
      }
      cleanupGenericDefaults(target);
      return true;
    case "exaTextContents": {
      const contents = isJsonObject(target.defaults.contents)
        ? { ...target.defaults.contents }
        : {};
      if (value === "default") {
        delete contents.text;
      } else {
        contents.text = value === "true";
      }
      if (Object.keys(contents).length === 0) {
        delete target.defaults.contents;
      } else {
        target.defaults.contents = contents;
      }
      cleanupGenericDefaults(target);
      return true;
    }
    default:
      return false;
  }
}

function applyValyuSettingChange(
  target: ValyuProviderConfig,
  key: string,
  value: string,
): boolean {
  target.defaults = isJsonObject(target.defaults) ? { ...target.defaults } : {};

  switch (key) {
    case "valyuSearchType":
      if (value === "default") {
        delete target.defaults.searchType;
      } else {
        target.defaults.searchType = value;
      }
      cleanupGenericDefaults(target);
      return true;
    case "valyuResponseLength":
      if (value === "default") {
        delete target.defaults.responseLength;
      } else {
        target.defaults.responseLength = value;
      }
      cleanupGenericDefaults(target);
      return true;
    default:
      return false;
  }
}

function applyGeminiSettingChange(
  target: GeminiProviderConfig,
  key: string,
  value: string,
): boolean {
  target.defaults ??= {};

  switch (key) {
    case "geminiApiVersion":
      if (value === "default") {
        delete target.defaults.apiVersion;
      } else {
        target.defaults.apiVersion = value;
      }
      cleanupGeminiDefaults(target);
      return true;
    case "geminiSearchModel":
      assignOptionalString(
        target.defaults as Record<
          string,
          JsonObject | string | boolean | undefined
        >,
        "searchModel",
        value,
      );
      cleanupGeminiDefaults(target);
      return true;
    case "geminiAnswerModel":
      assignOptionalString(
        target.defaults as Record<
          string,
          JsonObject | string | boolean | undefined
        >,
        "answerModel",
        value,
      );
      cleanupGeminiDefaults(target);
      return true;
    case "geminiResearchAgent":
      assignOptionalString(
        target.defaults as Record<
          string,
          JsonObject | string | boolean | undefined
        >,
        "researchAgent",
        value,
      );
      cleanupGeminiDefaults(target);
      return true;
    default:
      return false;
  }
}

function applyParallelSettingChange(
  target: ParallelProviderConfig,
  key: string,
  value: string,
): boolean {
  target.defaults ??= {};
  target.defaults.search = isJsonObject(target.defaults.search)
    ? { ...target.defaults.search }
    : {};
  target.defaults.extract = isJsonObject(target.defaults.extract)
    ? { ...target.defaults.extract }
    : {};

  switch (key) {
    case "parallelSearchMode":
      if (value === "default") {
        delete target.defaults.search.mode;
      } else {
        target.defaults.search.mode = value;
      }
      cleanupParallelDefaults(target);
      return true;
    case "parallelExtractExcerpts":
      if (value === "default") {
        delete target.defaults.extract.excerpts;
      } else {
        target.defaults.extract.excerpts = value === "on";
      }
      cleanupParallelDefaults(target);
      return true;
    case "parallelExtractFullContent":
      if (value === "default") {
        delete target.defaults.extract.full_content;
      } else {
        target.defaults.extract.full_content = value === "on";
      }
      cleanupParallelDefaults(target);
      return true;
    default:
      return false;
  }
}

function cleanupCodexDefaults(target: CodexProviderConfig): void {
  if (target.defaults && Object.keys(target.defaults).length === 0) {
    delete target.defaults;
  }
}

function cleanupGenericDefaults(
  target: ExaProviderConfig | ValyuProviderConfig,
): void {
  if (target.defaults && Object.keys(target.defaults).length === 0) {
    delete target.defaults;
  }
}

function cleanupGeminiDefaults(target: GeminiProviderConfig): void {
  if (target.defaults && Object.keys(target.defaults).length === 0) {
    delete target.defaults;
  }
}

function cleanupParallelDefaults(target: ParallelProviderConfig): void {
  if (
    target.defaults?.search &&
    Object.keys(target.defaults.search).length === 0
  ) {
    delete target.defaults.search;
  }
  if (
    target.defaults?.extract &&
    Object.keys(target.defaults.extract).length === 0
  ) {
    delete target.defaults.extract;
  }
  if (target.defaults && Object.keys(target.defaults).length === 0) {
    delete target.defaults;
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampResults(value?: number): number {
  if (value === undefined) return DEFAULT_MAX_RESULTS;
  return Math.min(Math.max(Math.trunc(value), 1), MAX_ALLOWED_RESULTS);
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
  params: { query?: string; provider?: ProviderId; maxResults?: number },
  theme: Theme,
): Component {
  return {
    invalidate() {},
    render(width) {
      let header = theme.fg("toolTitle", theme.bold("web_search"));
      const query = cleanSingleLine(String(params.query ?? "")).trim();
      if (query.length > 0) {
        header += ` ${theme.fg("accent", `"${query.slice(0, 80)}"`)} `;
      }

      const lines: string[] = [];
      const headerLine = truncateToWidth(header.trimEnd(), width);
      lines.push(
        headerLine + " ".repeat(Math.max(0, width - visibleWidth(headerLine))),
      );

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
  const base = getFirstLine(text) ?? `${count} via ${details.provider}`;
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
  extractTextContent,
  getAvailableManagedToolNames,
  getAvailableProviderIdsForCapability,
  renderCallHeader,
  renderCollapsedSearchSummary,
};
