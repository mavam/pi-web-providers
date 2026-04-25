import { Codex as CodexClient } from "@openai/codex-sdk";
import { type Static, type TObject, Type } from "typebox";
import { resolveConfigValue, resolveEnvMap } from "../config-values.js";
import type {
  Codex,
  ProviderAdapter,
  ProviderCapabilityStatus,
  ProviderContext,
  SearchResponse,
  Tool,
} from "../types.js";
import { trimSnippet } from "./shared.js";

const codexOutputSchema = Type.Object({
  sources: Type.Array(
    Type.Object({
      title: Type.String(),
      url: Type.String(),
      snippet: Type.String(),
    }),
  ),
});

type CodexOutput = Static<typeof codexOutputSchema>;

type CodexAdapter = ProviderAdapter<"codex"> & {
  search(
    query: string,
    maxResults: number,
    config: Codex,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse>;
};

const codexSearchOptionsSchema = Type.Object(
  {
    model: Type.Optional(Type.String({ description: "Codex model override." })),
    modelReasoningEffort: Type.Optional(
      Type.Union(
        [
          Type.Literal("minimal"),
          Type.Literal("low"),
          Type.Literal("medium"),
          Type.Literal("high"),
          Type.Literal("xhigh"),
        ],
        { description: "Reasoning depth for Codex." },
      ),
    ),
    webSearchMode: Type.Optional(
      Type.Union(
        [
          Type.Literal("disabled"),
          Type.Literal("cached"),
          Type.Literal("live"),
        ],
        { description: "How Codex should source web results." },
      ),
    ),
  },
  { description: "Codex search options." },
);

export const codexAdapter: CodexAdapter = {
  id: "codex",
  label: "Codex",
  docsUrl: "https://github.com/openai/codex/tree/main/sdk/typescript",

  getToolOptionsSchema(capability: Tool): TObject | undefined {
    switch (capability) {
      case "search":
        return codexSearchOptionsSchema;
      default:
        return undefined;
    }
  },

  createTemplate(): Codex {
    return {
      options: {
        networkAccessEnabled: true,
        webSearchEnabled: true,
        webSearchMode: "live",
      },
    };
  },

  getCapabilityStatus(
    config: Codex | undefined,
    _cwd: string,
  ): ProviderCapabilityStatus {
    const effectiveConfig = config ?? codexAdapter.createTemplate();
    try {
      new CodexClient({
        codexPathOverride: effectiveConfig.codexPath,
        config: effectiveConfig.config as never,
      });
    } catch (error) {
      return {
        state: "invalid_config",
        detail: (error as Error).message,
      };
    }
    return { state: "ready" };
  },

  async search(
    query: string,
    maxResults: number,
    config: Codex,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const codex = new CodexClient({
      codexPathOverride: config.codexPath,
      baseUrl: config.baseUrl,
      apiKey: resolveConfigValue(config.apiKey),
      config: config.config as never,
      env: resolveEnvMap(config.env),
    });

    const thread = codex.startThread(
      buildCodexSearchThreadOptions(config, context.cwd, options),
    );

    const prompt = [
      "You are performing web research for another coding agent.",
      "Search the public web and return only a JSON object matching the provided schema.",
      "Do not include markdown fences or extra commentary.",
      `Return at most ${maxResults} sources.`,
      "Prefer primary or official sources when they are available.",
      "Each snippet should be short and specific.",
      "",
      `User query: ${query}`,
    ].join("\n");

    const streamed = await thread.runStreamed(prompt, {
      outputSchema: codexOutputSchema,
      signal: context.signal,
    });

    let finalResponse = "";

    for await (const event of streamed.events) {
      if (
        event.type === "item.completed" &&
        event.item.type === "agent_message"
      ) {
        finalResponse = event.item.text;
      }
      if (event.type === "turn.failed") {
        throw new Error(event.error.message);
      }
    }

    const parsed = parseOutput(finalResponse);

    return {
      provider: codexAdapter.id,
      results: parsed.sources.slice(0, maxResults).map((source) => ({
        title: source.title.trim(),
        url: source.url.trim(),
        snippet: trimSnippet(source.snippet),
      })),
    };
  },
};

function buildCodexSearchThreadOptions(
  config: Codex,
  cwd: string,
  options: Record<string, unknown> | undefined,
) {
  const runtimeOptions = getCodexSearchRuntimeOptions(options);
  const providerOptions = config.options;

  return {
    additionalDirectories: providerOptions?.additionalDirectories,
    approvalPolicy: "never" as const,
    model: runtimeOptions.model ?? providerOptions?.model,
    modelReasoningEffort:
      runtimeOptions.modelReasoningEffort ??
      providerOptions?.modelReasoningEffort,
    networkAccessEnabled: providerOptions?.networkAccessEnabled ?? true,
    sandboxMode: "read-only" as const,
    skipGitRepoCheck: true,
    webSearchEnabled: providerOptions?.webSearchEnabled ?? true,
    webSearchMode:
      runtimeOptions.webSearchMode ?? providerOptions?.webSearchMode ?? "live",
    workingDirectory: cwd,
  };
}

function getCodexSearchRuntimeOptions(
  options: Record<string, unknown> | undefined,
): {
  model?: string;
  modelReasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  webSearchMode?: "disabled" | "cached" | "live";
} {
  if (!options) {
    return {};
  }

  const model = readNonEmptyString(options.model);
  const modelReasoningEffort = readEnum(options.modelReasoningEffort, [
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
  ]);
  const webSearchMode = readEnum(options.webSearchMode, [
    "disabled",
    "cached",
    "live",
  ]);

  return {
    ...(model ? { model } : {}),
    ...(modelReasoningEffort ? { modelReasoningEffort } : {}),
    ...(webSearchMode ? { webSearchMode } : {}),
  };
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function readEnum<const TValue extends string>(
  value: unknown,
  values: readonly TValue[],
): TValue | undefined {
  return typeof value === "string" && values.includes(value as TValue)
    ? (value as TValue)
    : undefined;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOutput(raw: string): CodexOutput {
  const json = extractJsonObject(raw);
  if (
    !isJsonObject(json) ||
    !Array.isArray(json.sources) ||
    json.sources.some(
      (source) =>
        !isJsonObject(source) ||
        typeof source.title !== "string" ||
        typeof source.url !== "string" ||
        typeof source.snippet !== "string",
    )
  ) {
    throw new Error("returned invalid JSON output");
  }
  return json as CodexOutput;
}

function extractJsonObject(raw: string): unknown {
  if (!raw.trim()) {
    throw new Error("returned an empty response");
  }

  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("returned invalid JSON output");
    }
    try {
      return JSON.parse(match[0]);
    } catch {
      throw new Error("returned invalid JSON output");
    }
  }
}
