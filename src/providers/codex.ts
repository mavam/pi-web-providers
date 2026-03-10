import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Codex, type ThreadEvent } from "@openai/codex-sdk";
import type {
  CodexProviderConfig,
  ProviderContext,
  ProviderStatus,
  SearchResponse,
  WebProvider,
} from "../types.js";
import { resolveConfigValue, resolveEnvMap } from "../config.js";
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
  readonly id = "codex";
  readonly label = "Codex";
  readonly docsUrl = "https://github.com/openai/codex/tree/main/sdk/typescript";

  createTemplate(): CodexProviderConfig {
    return {
      enabled: true,
      tools: {
        search: true,
      },
      defaults: {
        networkAccessEnabled: true,
        webSearchEnabled: true,
        webSearchMode: "live",
      },
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

  async search(
    query: string,
    maxResults: number,
    _options: Record<string, unknown> | undefined,
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

    const thread = codex.startThread({
      additionalDirectories: config.defaults?.additionalDirectories,
      approvalPolicy: "never",
      model: config.defaults?.model,
      modelReasoningEffort: config.defaults?.modelReasoningEffort,
      networkAccessEnabled: config.defaults?.networkAccessEnabled ?? true,
      sandboxMode: "read-only",
      skipGitRepoCheck: true,
      webSearchEnabled: config.defaults?.webSearchEnabled ?? true,
      webSearchMode: config.defaults?.webSearchMode ?? "live",
      workingDirectory: context.cwd,
    });

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
