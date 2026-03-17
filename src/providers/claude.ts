import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join } from "node:path";
import {
  query,
  type SDKMessage,
  type SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { createSilentForegroundPlan } from "../provider-plans.js";
import type {
  ClaudeProviderConfig,
  ProviderContext,
  ProviderOperationRequest,
  ProviderStatus,
  ProviderToolOutput,
  SearchResponse,
  WebProvider,
} from "../types.js";
import { trimSnippet } from "./shared.js";

const require = createRequire(import.meta.url);

const SEARCH_OUTPUT_SCHEMA = {
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

const ANSWER_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string" },
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          url: { type: "string" },
        },
        required: ["title", "url"],
      },
    },
  },
  required: ["answer", "sources"],
} as const;

interface ClaudeSearchOutput {
  sources: Array<{
    title: string;
    url: string;
    snippet: string;
  }>;
}

interface ClaudeAnswerOutput {
  answer: string;
  sources: Array<{
    title: string;
    url: string;
  }>;
}

export class ClaudeProvider implements WebProvider<ClaudeProviderConfig> {
  readonly id: "claude" = "claude";
  readonly label = "Claude";
  readonly docsUrl =
    "https://github.com/anthropics/claude-agent-sdk-typescript";
  readonly capabilities = ["search", "answer"] as const;

  createTemplate(): ClaudeProviderConfig {
    return {
      enabled: false,
    };
  }

  getStatus(
    config: ClaudeProviderConfig | undefined,
    _cwd: string,
  ): ProviderStatus {
    if (!config) {
      return { available: false, summary: "not configured" };
    }
    if (config.enabled === false) {
      return { available: false, summary: "disabled" };
    }
    const executablePath = resolveClaudeExecutablePath(config);
    if (executablePath && !existsSync(executablePath)) {
      return { available: false, summary: "missing Claude Code executable" };
    }
    const authStatus = getClaudeAuthStatus(executablePath);
    if (!authStatus.loggedIn) {
      return { available: false, summary: "missing Claude auth" };
    }
    return { available: true, summary: "enabled" };
  }

  buildPlan(request: ProviderOperationRequest, config: ClaudeProviderConfig) {
    switch (request.capability) {
      case "search":
        return createSilentForegroundPlan({
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
      case "answer":
        return createSilentForegroundPlan({
          config,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          execute: (context: ProviderContext) =>
            this.answer(request.query, request.options, config, context),
        });
      default:
        return null;
    }
  }

  async search(
    queryText: string,
    maxResults: number,
    options: Record<string, unknown> | undefined,
    config: ClaudeProviderConfig,
    context: ProviderContext,
  ): Promise<SearchResponse> {
    const output = parseClaudeSearchOutput(
      await this.runStructuredQuery<ClaudeSearchOutput>({
        prompt: [
          "You are performing web research for another coding agent.",
          "Use the WebSearch tool to search the public web.",
          "Return only a JSON object matching the provided schema.",
          "Do not include markdown fences or extra commentary.",
          `Return at most ${maxResults} sources.`,
          "Each snippet should be short, factual, and specific to the result.",
          "Prefer primary or official sources when they are available.",
          "",
          `User query: ${queryText}`,
        ].join("\n"),
        schema: SEARCH_OUTPUT_SCHEMA,
        tools: ["WebSearch"],
        config,
        context,
        options,
      }),
    );

    return {
      provider: this.id,
      results: output.sources.slice(0, maxResults).map((source) => ({
        title: source.title.trim(),
        url: source.url.trim(),
        snippet: trimSnippet(source.snippet),
      })),
    };
  }

  async answer(
    queryText: string,
    options: Record<string, unknown> | undefined,
    config: ClaudeProviderConfig,
    context: ProviderContext,
  ): Promise<ProviderToolOutput> {
    const output = parseClaudeAnswerOutput(
      await this.runStructuredQuery<ClaudeAnswerOutput>({
        prompt: [
          "Answer the user's question using current public web information.",
          "Use WebSearch to find relevant sources and WebFetch when you need to verify important details.",
          "Return only a JSON object matching the provided schema.",
          "Do not include markdown fences or extra commentary.",
          "Keep the answer concise but informative.",
          "Only cite sources you actually used.",
          "",
          `User query: ${queryText}`,
        ].join("\n"),
        schema: ANSWER_OUTPUT_SCHEMA,
        tools: ["WebSearch", "WebFetch"],
        config,
        context,
        options,
      }),
    );

    const lines: string[] = [];
    lines.push(output.answer.trim() || "No answer returned.");

    if (output.sources.length > 0) {
      lines.push("");
      lines.push("Sources:");
      for (const [index, source] of output.sources.entries()) {
        lines.push(`${index + 1}. ${source.title}`);
        lines.push(`   ${source.url}`);
      }
    }

    return {
      provider: this.id,
      text: lines.join("\n").trimEnd(),
      summary: `Answer via Claude with ${output.sources.length} source(s)`,
      itemCount: output.sources.length,
    };
  }

  private async runStructuredQuery<T>({
    prompt,
    schema,
    tools,
    config,
    context,
    options,
  }: {
    prompt: string;
    schema: Record<string, unknown>;
    tools: string[];
    config: ClaudeProviderConfig;
    context: ProviderContext;
    options: Record<string, unknown> | undefined;
  }): Promise<T> {
    const abortController = new AbortController();
    if (context.signal?.aborted) {
      abortController.abort(context.signal.reason);
    }
    const onAbort = () => {
      abortController.abort(context.signal?.reason);
    };
    context.signal?.addEventListener("abort", onAbort, { once: true });

    const stream = query({
      prompt,
      options: {
        abortController,
        allowedTools: tools,
        cwd: context.cwd,
        ...getClaudeRuntimeOptions(config, options),
        outputFormat: {
          type: "json_schema",
          schema,
        },
        pathToClaudeCodeExecutable: config.pathToClaudeCodeExecutable,
        persistSession: false,
        permissionMode: "dontAsk",
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append:
            "Use only the provided web tools. Always produce output that matches the requested JSON schema exactly.",
        },
        tools,
      },
    });

    const seenToolUseIds = new Set<string>();
    let finalResult: SDKResultMessage | undefined;

    try {
      for await (const message of stream) {
        handleProgressMessage(message, seenToolUseIds, context.onProgress);
        if (message.type === "result") {
          finalResult = message;
        }
      }
    } finally {
      context.signal?.removeEventListener("abort", onAbort);
      stream.close();
    }

    if (!finalResult) {
      throw new Error("Claude returned no result.");
    }
    if (finalResult.subtype !== "success") {
      throw new Error(
        finalResult.errors.join("\n") ||
          `Claude query failed (${finalResult.subtype}).`,
      );
    }

    return parseStructuredOutput<T>(finalResult);
  }
}

interface ClaudeAuthStatus {
  loggedIn: boolean;
}

interface CachedClaudeAuthStatus extends ClaudeAuthStatus {
  checkedAt: number;
}

const CLAUDE_AUTH_CACHE_TTL_MS = 5_000;

let defaultClaudeExecutablePath: string | undefined;
const claudeAuthStatusCache = new Map<string, CachedClaudeAuthStatus>();

function resolveClaudeExecutablePath(
  config: ClaudeProviderConfig,
): string | undefined {
  if (config.pathToClaudeCodeExecutable) {
    return config.pathToClaudeCodeExecutable;
  }
  if (defaultClaudeExecutablePath !== undefined) {
    return defaultClaudeExecutablePath;
  }
  try {
    const sdkEntryPath = require.resolve("@anthropic-ai/claude-agent-sdk");
    defaultClaudeExecutablePath = join(dirname(sdkEntryPath), "cli.js");
  } catch {
    defaultClaudeExecutablePath = undefined;
  }
  return defaultClaudeExecutablePath;
}

function getClaudeAuthStatus(
  executablePath: string | undefined,
): ClaudeAuthStatus {
  if (!executablePath) {
    return { loggedIn: false };
  }

  const cachedStatus = claudeAuthStatusCache.get(executablePath);
  if (
    cachedStatus &&
    Date.now() - cachedStatus.checkedAt < CLAUDE_AUTH_CACHE_TTL_MS
  ) {
    return { loggedIn: cachedStatus.loggedIn };
  }

  const [command, ...args] = getClaudeAuthCommand(executablePath);

  try {
    const stdout = execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return cacheClaudeAuthStatus(executablePath, parseClaudeAuthStatus(stdout));
  } catch (error) {
    const stdout = getExecOutput(
      (error as { stdout?: string | Buffer }).stdout,
    );
    if (stdout) {
      return cacheClaudeAuthStatus(
        executablePath,
        parseClaudeAuthStatus(stdout),
      );
    }
    return cacheClaudeAuthStatus(executablePath, { loggedIn: false });
  }
}

function cacheClaudeAuthStatus(
  executablePath: string,
  status: ClaudeAuthStatus,
): ClaudeAuthStatus {
  claudeAuthStatusCache.set(executablePath, {
    ...status,
    checkedAt: Date.now(),
  });
  return status;
}

export function resetClaudeProviderCachesForTests(): void {
  defaultClaudeExecutablePath = undefined;
  claudeAuthStatusCache.clear();
}

function getClaudeAuthCommand(executablePath: string): string[] {
  const extension = extname(executablePath);
  if (extension === ".js" || extension === ".cjs" || extension === ".mjs") {
    return [process.execPath, executablePath, "auth", "status", "--json"];
  }
  return [executablePath, "auth", "status", "--json"];
}

function getExecOutput(output: string | Buffer | undefined): string {
  if (typeof output === "string") {
    return output;
  }
  if (Buffer.isBuffer(output)) {
    return output.toString("utf8");
  }
  return "";
}

function parseClaudeAuthStatus(raw: string): ClaudeAuthStatus {
  try {
    const parsed = JSON.parse(raw) as { loggedIn?: unknown };
    return { loggedIn: parsed.loggedIn === true };
  } catch {
    return { loggedIn: false };
  }
}

function handleProgressMessage(
  message: SDKMessage,
  seenToolUseIds: Set<string>,
  onProgress: ((message: string) => void) | undefined,
): void {
  if (!onProgress || message.type !== "tool_progress") {
    return;
  }
  if (seenToolUseIds.has(message.tool_use_id)) {
    return;
  }

  seenToolUseIds.add(message.tool_use_id);
  onProgress(formatToolProgressMessage(message.tool_name));
}

function formatToolProgressMessage(toolName: string): string {
  if (toolName === "WebSearch") return "Searching via Claude";
  if (toolName === "WebFetch") return "Fetching via Claude";
  return `Claude: ${toolName}`;
}

function parseStructuredOutput<T>(result: SDKResultMessage): T {
  if (result.subtype !== "success") {
    throw new Error("Claude query did not succeed.");
  }

  if (result.structured_output !== undefined) {
    return result.structured_output as T;
  }

  if (!result.result.trim()) {
    throw new Error("Claude returned an empty response.");
  }

  try {
    return JSON.parse(result.result) as T;
  } catch {
    const match = result.result.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("Claude returned invalid JSON output.");
    }
    return JSON.parse(match[0]) as T;
  }
}

function getClaudeRuntimeOptions(
  config: ClaudeProviderConfig,
  options: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const native = config.native ?? config.defaults;
  const model = readNonEmptyString(options?.model) ?? native?.model;
  const effort = readEnum(options?.effort, ["low", "medium", "high", "max"]);
  const maxTurns = readPositiveInteger(options?.maxTurns);
  const maxThinkingTokens = readNonNegativeInteger(options?.maxThinkingTokens);
  const maxBudgetUsd = readPositiveNumber(options?.maxBudgetUsd);
  const thinking = isPlainObject(options?.thinking)
    ? options?.thinking
    : undefined;

  return {
    ...(model ? { model } : {}),
    ...((effort ?? native?.effort) ? { effort: effort ?? native?.effort } : {}),
    ...((maxTurns ?? native?.maxTurns)
      ? { maxTurns: maxTurns ?? native?.maxTurns }
      : {}),
    ...(maxThinkingTokens !== undefined ? { maxThinkingTokens } : {}),
    ...(maxBudgetUsd !== undefined ? { maxBudgetUsd } : {}),
    ...(thinking ? { thinking } : {}),
  };
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function readNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function readPositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseClaudeSearchOutput(value: unknown): ClaudeSearchOutput {
  const sources = readArray(value, "sources").map((entry) => ({
    title: readString(entry, "title"),
    url: readString(entry, "url"),
    snippet: readString(entry, "snippet"),
  }));
  return { sources };
}

function parseClaudeAnswerOutput(value: unknown): ClaudeAnswerOutput {
  return {
    answer: readString(value, "answer"),
    sources: readArray(value, "sources").map((entry) => ({
      title: readString(entry, "title"),
      url: readString(entry, "url"),
    })),
  };
}

function readArray(value: unknown, key: string): unknown[] {
  if (typeof value !== "object" || value === null || !(key in value)) {
    throw new Error(`Claude output is missing '${key}'.`);
  }
  const entry = (value as Record<string, unknown>)[key];
  if (!Array.isArray(entry)) {
    throw new Error(`Claude output field '${key}' must be an array.`);
  }
  return entry;
}

function readString(value: unknown, key: string): string {
  if (typeof value !== "object" || value === null || !(key in value)) {
    throw new Error(`Claude output is missing '${key}'.`);
  }
  const entry = (value as Record<string, unknown>)[key];
  if (typeof entry !== "string") {
    throw new Error(`Claude output field '${key}' must be a string.`);
  }
  return entry;
}
