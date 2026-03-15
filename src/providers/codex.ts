import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Codex, type ThreadEvent } from "@openai/codex-sdk";
import { resolveConfigValue, resolveEnvMap } from "../config.js";
import { createDefaultRequestPolicy } from "../execution-policy-defaults.js";
import { createSingleOperationPlan } from "../provider-plans.js";
import type {
  CodexProviderConfig,
  ProviderContext,
  ProviderOperationRequest,
  ProviderStatus,
  SearchResponse,
  WebProvider,
} from "../types.js";
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

interface CodexOutput {
  sources: Array<{
    title: string;
    url: string;
    snippet: string;
  }>;
}

export class CodexProvider implements WebProvider<CodexProviderConfig> {
  readonly id: "codex" = "codex";
  readonly label = "Codex";
  readonly docsUrl = "https://github.com/openai/codex/tree/main/sdk/typescript";
  readonly capabilities = ["search"] as const;

  createTemplate(): CodexProviderConfig {
    return {
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
    };
  }

  getStatus(
    config: CodexProviderConfig | undefined,
    _cwd: string,
  ): ProviderStatus {
    if (!config) {
      return { available: false, summary: "not configured" };
    }
    if (config.enabled === false) {
      return { available: false, summary: "disabled" };
    }
    try {
      new Codex({
        codexPathOverride: config.codexPath,
        config: config.config as never,
      });
    } catch (error) {
      return {
        available: false,
        summary: (error as Error).message,
      };
    }
    if (!hasCodexCredentials(config)) {
      return { available: false, summary: "missing Codex auth" };
    }
    return { available: true, summary: "enabled" };
  }

  buildPlan(request: ProviderOperationRequest, config: CodexProviderConfig) {
    if (request.capability !== "search") {
      return null;
    }

    return createSingleOperationPlan({
      config,
      capability: request.capability,
      providerId: this.id,
      providerLabel: this.label,
      execute: (context: ProviderContext) =>
        this.search(
          request.query,
          request.maxResults,
          request.options,
          config,
          context,
        ),
    });
  }

  async search(
    query: string,
    maxResults: number,
    options: Record<string, unknown> | undefined,
    config: CodexProviderConfig,
    context: ProviderContext,
  ): Promise<SearchResponse> {
    const codex = new Codex({
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
    const seenQueries = new Set<string>();

    for await (const event of streamed.events) {
      handleProgressEvent(event, seenQueries, context.onProgress);
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
      provider: this.id,
      results: parsed.sources.slice(0, maxResults).map((source) => ({
        title: source.title.trim(),
        url: source.url.trim(),
        snippet: trimSnippet(source.snippet),
      })),
    };
  }
}

function buildCodexSearchThreadOptions(
  config: CodexProviderConfig,
  cwd: string,
  options: Record<string, unknown> | undefined,
) {
  const runtimeOptions = getCodexSearchRuntimeOptions(options);
  const native = config.native ?? config.defaults;

  return {
    additionalDirectories: native?.additionalDirectories,
    approvalPolicy: "never" as const,
    model: runtimeOptions.model ?? native?.model,
    modelReasoningEffort:
      runtimeOptions.modelReasoningEffort ?? native?.modelReasoningEffort,
    networkAccessEnabled: native?.networkAccessEnabled ?? true,
    sandboxMode: "read-only" as const,
    skipGitRepoCheck: true,
    webSearchEnabled: native?.webSearchEnabled ?? true,
    webSearchMode:
      runtimeOptions.webSearchMode ?? native?.webSearchMode ?? "live",
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

function hasCodexCredentials(config: CodexProviderConfig): boolean {
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

function handleProgressEvent(
  event: ThreadEvent,
  seenQueries: Set<string>,
  onProgress: ((message: string) => void) | undefined,
): void {
  if (!onProgress) return;

  if (
    event.type === "item.completed" &&
    event.item.type === "web_search" &&
    !seenQueries.has(event.item.query)
  ) {
    seenQueries.add(event.item.query);
    onProgress(`Codex web search ${seenQueries.size}: ${event.item.query}`);
  }
}

function parseOutput(raw: string): CodexOutput {
  if (!raw.trim()) {
    throw new Error("Codex returned an empty response.");
  }

  try {
    return JSON.parse(raw) as CodexOutput;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("Codex returned invalid JSON output.");
    }
    return JSON.parse(match[0]) as CodexOutput;
  }
}
