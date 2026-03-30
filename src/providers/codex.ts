import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Codex as CodexClient } from "@openai/codex-sdk";
import { z } from "zod";
import { resolveConfigValue, resolveEnvMap } from "../config.js";
import type {
  Codex,
  ProviderAdapter,
  ProviderCapabilityStatus,
  ProviderContext,
  ProviderRequest,
  SearchResponse,
} from "../types.js";
import { buildProviderPlan } from "./framework.js";
import { trimSnippet } from "./shared.js";

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          url: { type: "string" },
          snippet: { type: "string" },
        },
        required: ["title", "url", "snippet"],
      },
    },
  },
  required: ["sources"],
} as const;

const codexOutputSchema = z.object({
  sources: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      snippet: z.string(),
    }),
  ),
});

type CodexOutput = z.infer<typeof codexOutputSchema>;

type CodexAdapter = ProviderAdapter<Codex> & {
  search(
    query: string,
    maxResults: number,
    config: Codex,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse>;
};

export const codexAdapter: CodexAdapter = {
  id: "codex",
  label: "Codex",
  docsUrl: "https://github.com/openai/codex/tree/main/sdk/typescript",
  tools: ["search"] as const,

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
    if (!hasCodexCredentials(effectiveConfig)) {
      return { state: "missing_auth" };
    }
    return { state: "ready" };
  },

  buildPlan(request: ProviderRequest, config: Codex) {
    return buildProviderPlan({
      request,
      config,
      providerId: codexAdapter.id,
      providerLabel: codexAdapter.label,
      handlers: {
        search: {
          deliveryMode: "silent-foreground",
          execute: (
            searchRequest,
            providerConfig: Codex,
            context: ProviderContext,
          ) =>
            codexAdapter.search(
              searchRequest.query,
              searchRequest.maxResults,
              providerConfig,
              context,
              searchRequest.options,
            ),
        },
      },
    });
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
      outputSchema: OUTPUT_SCHEMA,
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

function hasCodexCredentials(config: Codex): boolean {
  if (hasConfiguredReference(config.apiKey)) {
    return true;
  }

  if (
    hasConfiguredReference(config.env?.CODEX_API_KEY) ||
    hasConfiguredReference(config.env?.OPENAI_API_KEY)
  ) {
    return true;
  }

  if (!config.env) {
    const inheritedKey =
      process.env.CODEX_API_KEY ?? process.env.OPENAI_API_KEY;
    if (typeof inheritedKey === "string" && inheritedKey.trim().length > 0) {
      return true;
    }
  }

  return existsSync(join(homedir(), ".codex", "auth.json"));
}

function hasConfiguredReference(reference: string | undefined): boolean {
  if (!reference) {
    return false;
  }
  if (reference.startsWith("!")) {
    return reference.slice(1).trim().length > 0;
  }
  const envValue = process.env[reference];
  if (typeof envValue === "string") {
    return envValue.trim().length > 0;
  }
  if (/^[A-Z][A-Z0-9_]*$/.test(reference)) {
    return false;
  }
  return reference.trim().length > 0;
}

function parseOutput(raw: string): CodexOutput {
  const json = extractJsonObject(raw);
  const parsed = codexOutputSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("returned invalid JSON output");
  }
  return parsed.data;
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
