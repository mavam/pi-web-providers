import { Codex as CodexClient } from "@openai/codex-sdk";
import { type Static, Type } from "typebox";
import type { ProviderContext, SearchResponse } from "../contract.js";
import type { Codex } from "./types.js";
import { trimSnippet } from "../shared.js";

const codexOutputSchema = Type.Object(
  {
    sources: Type.Array(
      Type.Object(
        {
          title: Type.String(),
          url: Type.String(),
          snippet: Type.String(),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

type CodexOutput = Static<typeof codexOutputSchema>;

const codexImplementation = {
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
      apiKey: config.credentials?.api,
      config: config.config as never,
      env: Object.fromEntries(
        Object.entries({ ...context.env, ...config.env }).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
    });

    const thread = codex.startThread(
      buildCodexSearchThreadOptions(context.cwd, options),
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
      provider: "codex",
      results: parsed.sources.slice(0, maxResults).map((source) => ({
        title: source.title.trim(),
        url: source.url.trim(),
        snippet: trimSnippet(source.snippet),
      })),
    };
  },
};

function buildCodexSearchThreadOptions(
  cwd: string,
  options: Record<string, unknown> | undefined,
) {
  const callOptions = getCodexSearchCallOptions(options);
  return {
    approvalPolicy: "never" as const,
    model: callOptions.model,
    modelReasoningEffort: callOptions.modelReasoningEffort,
    networkAccessEnabled: true,
    sandboxMode: "read-only" as const,
    skipGitRepoCheck: true,
    webSearchEnabled: true,
    webSearchMode: callOptions.webSearchMode ?? "live",
    workingDirectory: cwd,
  };
}

function getCodexSearchCallOptions(
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

export const adapter = {
  async search(
    input: import("../contract.js").ProviderRequest<"search">,
    config: Codex,
    context: ProviderContext,
  ) {
    return await codexImplementation.search(
      input.query,
      input.maxResults,
      config,
      context,
      input.options,
    );
  },
};
