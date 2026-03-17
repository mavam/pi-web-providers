import { GoogleGenAI } from "@google/genai";
import { resolveConfigValue } from "../config.js";
import {
  createDefaultLifecyclePolicy,
  DEFAULT_GEMINI_RESEARCH_MAX_CONSECUTIVE_POLL_ERRORS,
} from "../execution-policy-defaults.js";
import {
  createBackgroundResearchPlan,
  createSilentForegroundPlan,
} from "../provider-plans.js";
import type {
  GeminiProviderConfig,
  JsonObject,
  JsonValue,
  ProviderContentsMetadataEntry,
  ProviderContext,
  ProviderOperationRequest,
  ProviderResearchJob,
  ProviderResearchPollResult,
  ProviderStatus,
  ProviderToolOutput,
  SearchResponse,
  WebProvider,
} from "../types.js";

const DEFAULT_SEARCH_MODEL = "gemini-2.5-flash";
const DEFAULT_CONTENTS_MODEL = "gemini-2.5-flash";
const DEFAULT_ANSWER_MODEL = "gemini-2.5-flash";
const DEFAULT_RESEARCH_AGENT = "deep-research-pro-preview-12-2025";

export class GeminiProvider implements WebProvider<GeminiProviderConfig> {
  readonly id: "gemini" = "gemini";
  readonly label = "Gemini";
  readonly docsUrl = "https://github.com/googleapis/js-genai";
  readonly capabilities = ["search", "answer", "research"] as const;

  createTemplate(): GeminiProviderConfig {
    return {
      apiKey: "GOOGLE_API_KEY",
      native: {
        searchModel: DEFAULT_SEARCH_MODEL,
        answerModel: DEFAULT_ANSWER_MODEL,
        researchAgent: DEFAULT_RESEARCH_AGENT,
      },
      policy: createDefaultLifecyclePolicy({
        researchMaxConsecutivePollErrors:
          DEFAULT_GEMINI_RESEARCH_MAX_CONSECUTIVE_POLL_ERRORS,
      }),
    };
  }

  getStatus(config: GeminiProviderConfig | undefined): ProviderStatus {
    if (!config) {
      return { available: false, summary: "not configured" };
    }
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      return { available: false, summary: "missing apiKey" };
    }
    return { available: true, summary: "enabled" };
  }

  buildPlan(request: ProviderOperationRequest, config: GeminiProviderConfig) {
    const planConfig = {
      policy: getGeminiExecutionPolicyDefaults(config),
    };

    switch (request.capability) {
      case "search":
        return createSilentForegroundPlan({
          config: planConfig,
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
      case "contents":
        return createSilentForegroundPlan({
          config: planConfig,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          execute: (context: ProviderContext) =>
            this.contents(request.urls, request.options, config, context),
        });
      case "answer":
        return createSilentForegroundPlan({
          config: planConfig,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          execute: (context: ProviderContext) =>
            this.answer(request.query, request.options, config, context),
        });
      case "research":
        return createBackgroundResearchPlan({
          config: planConfig,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          traits: {
            executionSupport: {
              requestTimeoutMs: true,
              retryCount: true,
              retryDelayMs: true,
              pollIntervalMs: true,
              timeoutMs: true,
              maxConsecutivePollErrors: true,
              resumeId: true,
            },
            researchLifecycle: {
              supportsStartRetries: true,
              supportsRequestTimeouts: true,
            },
          },
          start: (context: ProviderContext) =>
            this.startResearch(request.input, request.options, config, context),
          poll: (id: string, context: ProviderContext) =>
            this.pollResearch(id, request.options, config, context),
        });
      default:
        return null;
    }
  }

  async search(
    query: string,
    maxResults: number,
    options: Record<string, unknown> | undefined,
    config: GeminiProviderConfig,
    context: ProviderContext,
  ): Promise<SearchResponse> {
    const ai = this.createClient(config);
    const native = getGeminiNativeConfig(config);
    const request = buildGeminiSearchRequest(
      query,
      native?.searchModel ?? DEFAULT_SEARCH_MODEL,
      options,
    );

    context.onProgress?.(`Searching Gemini for: ${query}`);
    const interaction = await createSearchInteraction(
      ai,
      request,
      context.signal,
    );

    const results = await Promise.all(
      extractGoogleSearchResults(interaction.outputs)
        .slice(0, maxResults)
        .map(async (result) => {
          const resolvedUrl = await resolveGoogleSearchUrl(
            result.url,
            context.signal,
          );
          return {
            title: result.title ?? resolvedUrl ?? result.url ?? "Untitled",
            url: resolvedUrl ?? result.url ?? "",
            snippet: "",
          };
        }),
    );

    return {
      provider: this.id,
      results,
    };
  }

  async contents(
    urls: string[],
    options: JsonObject | undefined,
    config: GeminiProviderConfig,
    context: ProviderContext,
  ): Promise<ProviderToolOutput> {
    const ai = this.createClient(config);

    context.onProgress?.(
      `Fetching contents from Gemini for ${urls.length} URL(s)`,
    );

    const urlList = urls.map((url) => `- ${url}`).join("\n");
    const defaultModel = DEFAULT_CONTENTS_MODEL;
    const structuredPrompt =
      `Extract the main textual content from each of the following URLs. ` +
      `For every successfully retrieved URL, return exactly one block in this format:\n` +
      `[[[URL]]]\n<resolved URL>\n[[[TITLE]]]\n<title>\n[[[BODY]]]\n<cleaned body text>\n[[[END]]]\n\n` +
      `Only include successfully retrieved URLs. Preserve headings, paragraphs, and lists in BODY, ` +
      `but remove navigation, ads, and boilerplate. Do not add any text outside these blocks.\n\n${urlList}`;

    const structuredResponse = await requestGeminiContentsExtraction({
      ai,
      defaultModel,
      prompt: structuredPrompt,
      options,
      signal: context.signal,
    });

    let text = structuredResponse.text;
    let metadata = structuredResponse.metadata;
    let contentsEntries = buildGeminiContentsEntries(text, urls, metadata);
    const hasReadyEntries = contentsEntries.some(
      (entry) => entry.status !== "failed",
    );

    if (
      shouldFallbackToLegacyGeminiContentsPrompt(
        text,
        metadata,
        hasReadyEntries,
      )
    ) {
      const fallbackResponse = await requestGeminiContentsExtraction({
        ai,
        defaultModel,
        prompt:
          `Extract the main textual content from each of the following URLs. ` +
          `For each URL, return the page title followed by the cleaned body text. ` +
          `Preserve the original structure (headings, paragraphs, lists) but remove ` +
          `navigation, ads, and boilerplate.\n\n${urlList}`,
        options,
        signal: context.signal,
      });

      text = fallbackResponse.text;
      metadata = fallbackResponse.metadata;
      contentsEntries = buildGeminiContentsEntries(text, urls, metadata);
    }

    if (shouldRetryEmptyGeminiContentsResponse(text, metadata)) {
      throw new Error(
        "Gemini returned an empty URL Context response. Retrying may succeed.",
      );
    }
    const lines: string[] = [];

    const successfulEntries = contentsEntries.filter(
      (entry) => entry.status !== "failed",
    );
    if (successfulEntries.length > 0) {
      lines.push(renderGeminiContentsEntries(successfulEntries));
    } else if (text) {
      lines.push(text);
    }

    const retrievalFailures = metadata.filter(
      (entry) =>
        entry.status !== "URL_RETRIEVAL_STATUS_SUCCESS" &&
        entry.status !== undefined,
    );
    if (retrievalFailures.length > 0) {
      if (lines.length > 0) {
        lines.push("");
      }
      lines.push("Retrieval issues:");
      for (const failure of retrievalFailures) {
        lines.push(`- ${failure.url}: ${failure.status}`);
      }
    }

    const contentFailures = getGeminiContentFailures(
      contentsEntries,
      retrievalFailures,
    );
    if (contentFailures.length > 0) {
      if (lines.length > 0) {
        lines.push("");
      }
      lines.push("Content issues:");
      for (const failure of contentFailures) {
        lines.push(`- ${failure.url}: ${failure.body}`);
      }
    }

    const successCount = successfulEntries.length;

    return {
      provider: this.id,
      text: lines.join("\n").trimEnd() || "No contents extracted.",
      summary: `${successCount} of ${urls.length} URL(s) extracted via Gemini`,
      itemCount: successCount,
      metadata: {
        contentsEntries: contentsEntries as unknown as JsonValue,
      },
    };
  }

  async answer(
    query: string,
    options: Record<string, unknown> | undefined,
    config: GeminiProviderConfig,
    context: ProviderContext,
  ): Promise<ProviderToolOutput> {
    const ai = this.createClient(config);
    const native = getGeminiNativeConfig(config);
    const request = buildGeminiGenerateContentRequest({
      defaultModel: native?.answerModel ?? DEFAULT_ANSWER_MODEL,
      prompt: query,
      options,
      toolConfig: { googleSearch: {} },
    });

    context.onProgress?.(`Getting Gemini answer for: ${query}`);
    const response = await ai.models.generateContent({
      model: request.model,
      contents: request.contents,
      config: addAbortSignalToGeminiConfig(request.config, context.signal),
    });

    const lines: string[] = [];
    lines.push(response.text?.trim() || "No answer returned.");

    const sources = extractGroundingSources(
      response.candidates?.[0]?.groundingMetadata?.groundingChunks,
    );
    if (sources.length > 0) {
      lines.push("");
      lines.push("Sources:");
      for (const [index, source] of sources.entries()) {
        lines.push(`${index + 1}. ${source.title}`);
        if (source.url) {
          lines.push(`   ${source.url}`);
        }
      }
    }

    return {
      provider: this.id,
      text: lines.join("\n").trimEnd(),
      summary: `Answer via Gemini with ${sources.length} source(s)`,
      itemCount: sources.length,
    };
  }

  async startResearch(
    input: string,
    options: JsonObject | undefined,
    config: GeminiProviderConfig,
    context: ProviderContext,
  ): Promise<ProviderResearchJob> {
    const ai = this.createClient(config);
    const requestOptions = getGeminiResearchRequestOptions(options);
    const interaction = await ai.interactions.create(
      {
        ...requestOptions,
        input,
        agent:
          getGeminiNativeConfig(config)?.researchAgent ??
          DEFAULT_RESEARCH_AGENT,
        background: true,
      },
      buildGeminiRequestOptions(context.signal, context.idempotencyKey),
    );

    return { id: interaction.id };
  }

  async pollResearch(
    id: string,
    _options: JsonObject | undefined,
    config: GeminiProviderConfig,
    context: ProviderContext,
  ): Promise<ProviderResearchPollResult> {
    const ai = this.createClient(config);
    const interaction = await runWithoutGeminiInteractionsWarning(() =>
      ai.interactions.get(
        id,
        undefined,
        buildGeminiRequestOptions(context.signal),
      ),
    );

    if (interaction.status === "completed") {
      const text = formatInteractionOutputs(interaction.outputs);
      return {
        status: "completed",
        output: {
          provider: this.id,
          text: text || "Gemini research completed without textual output.",
          summary: "Research via Gemini",
        },
      };
    }

    if (interaction.status === "failed") {
      return {
        status: "failed",
        error: "Gemini research failed.",
      };
    }

    if (interaction.status === "cancelled") {
      return {
        status: "cancelled",
        error: "Gemini research cancelled.",
      };
    }

    return { status: "in_progress" };
  }

  private createClient(config: GeminiProviderConfig): GoogleGenAI {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("Gemini is missing an API key.");
    }

    return new GoogleGenAI({
      apiKey,
      apiVersion: getGeminiNativeConfig(config)?.apiVersion,
    });
  }
}

function buildGeminiRequestOptions(
  signal: AbortSignal | undefined,
  idempotencyKey?: string,
) {
  if (!signal && !idempotencyKey) {
    return undefined;
  }

  return {
    ...(signal ? { signal } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
}

function addAbortSignalToGeminiConfig(
  config: Record<string, unknown> | undefined,
  signal: AbortSignal | undefined,
): Record<string, unknown> | undefined {
  if (!signal) {
    return config;
  }

  return {
    ...(config ?? {}),
    abortSignal: signal,
  };
}

function extractGoogleSearchResults(
  outputs: unknown,
): Array<{ title?: string; url?: string; rendered_content?: string }> {
  const results: Array<{
    title?: string;
    url?: string;
    rendered_content?: string;
  }> = [];

  if (!Array.isArray(outputs)) {
    return results;
  }

  for (const output of outputs) {
    if (typeof output !== "object" || output === null) {
      continue;
    }

    const content = output as { type?: unknown; result?: unknown };
    if (content.type !== "google_search_result") {
      continue;
    }

    const items = Array.isArray(content.result) ? content.result : [];
    for (const item of items) {
      if (typeof item !== "object" || item === null) {
        continue;
      }

      const record = item as Record<string, unknown>;
      results.push({
        title: typeof record.title === "string" ? record.title : undefined,
        url: typeof record.url === "string" ? record.url : undefined,
        rendered_content:
          typeof record.rendered_content === "string"
            ? record.rendered_content
            : undefined,
      });
    }
  }

  return results;
}

function extractGroundingSources(
  chunks: unknown,
): Array<{ title: string; url: string }> {
  const seen = new Set<string>();
  const sources: Array<{ title: string; url: string }> = [];
  const maxSources = 5;

  if (!Array.isArray(chunks)) {
    return sources;
  }

  for (const chunk of chunks) {
    const web =
      typeof chunk === "object" &&
      chunk !== null &&
      "web" in chunk &&
      typeof chunk.web === "object" &&
      chunk.web !== null
        ? (chunk.web as Record<string, unknown>)
        : undefined;
    if (!web) continue;

    const rawUrl = typeof web.uri === "string" ? web.uri : "";
    const title = formatGroundingSourceTitle(
      typeof web.title === "string" ? web.title : rawUrl,
      rawUrl,
    );
    const url = formatGroundingSourceUrl(rawUrl);
    const key = [title.toLowerCase(), url.toLowerCase()].join("::");
    if (seen.has(key)) continue;
    seen.add(key);

    sources.push({
      title,
      url,
    });

    if (sources.length >= maxSources) {
      break;
    }
  }

  return sources;
}

function extractUrlContextMetadata(
  candidates: unknown,
): Array<{ url: string; status: string | undefined }> {
  const results: Array<{ url: string; status: string | undefined }> = [];

  if (!Array.isArray(candidates)) {
    return results;
  }

  for (const candidate of candidates) {
    if (typeof candidate !== "object" || candidate === null) {
      continue;
    }

    const metadata = (candidate as Record<string, unknown>)
      .urlContextMetadata as
      | { urlMetadata?: Array<Record<string, unknown>> }
      | undefined;
    if (!metadata?.urlMetadata || !Array.isArray(metadata.urlMetadata)) {
      continue;
    }

    for (const entry of metadata.urlMetadata) {
      if (typeof entry !== "object" || entry === null) {
        continue;
      }

      results.push({
        url:
          typeof entry.retrievedUrl === "string"
            ? entry.retrievedUrl
            : "unknown",
        status:
          typeof entry.urlRetrievalStatus === "string"
            ? entry.urlRetrievalStatus
            : undefined,
      });
    }
  }

  return results;
}

async function requestGeminiContentsExtraction({
  ai,
  defaultModel,
  prompt,
  options,
  signal,
}: {
  ai: GoogleGenAI;
  defaultModel: string;
  prompt: string;
  options: JsonObject | undefined;
  signal: AbortSignal | undefined;
}): Promise<{
  text: string;
  metadata: Array<{ url: string; status: string | undefined }>;
}> {
  const request = buildGeminiGenerateContentRequest({
    defaultModel,
    prompt,
    options,
    toolConfig: { urlContext: {} },
  });
  const response = await ai.models.generateContent({
    model: request.model,
    contents: [request.contents],
    config: addAbortSignalToGeminiConfig(request.config, signal),
  });

  return {
    text: response.text?.trim() || "",
    metadata: extractUrlContextMetadata(response.candidates),
  };
}

function shouldFallbackToLegacyGeminiContentsPrompt(
  text: string,
  metadata: Array<{ url: string; status: string | undefined }>,
  hasReadyEntries: boolean,
): boolean {
  if (hasReadyEntries) {
    return false;
  }

  if (text.trim().length === 0) {
    return true;
  }

  return metadata.some(
    (entry) =>
      entry.status === undefined ||
      entry.status === "URL_RETRIEVAL_STATUS_SUCCESS",
  );
}

function shouldRetryEmptyGeminiContentsResponse(
  text: string,
  metadata: Array<{ url: string; status: string | undefined }>,
): boolean {
  if (text.trim().length > 0) {
    return false;
  }

  if (metadata.length === 0) {
    return true;
  }

  return metadata.some(
    (entry) =>
      entry.status === undefined ||
      entry.status === "URL_RETRIEVAL_STATUS_SUCCESS",
  );
}

function buildGeminiContentsEntries(
  text: string,
  urls: string[],
  metadata: Array<{ url: string; status: string | undefined }>,
): ProviderContentsMetadataEntry[] {
  const parsedEntries = parseGeminiContentsBlocks(text);
  const orderedReadyEntries = orderGeminiContentsEntries(parsedEntries, urls);
  const readyEntries =
    orderedReadyEntries.length > 0
      ? orderedReadyEntries.map((entry) => ({
          ...entry,
          summary: "1 content result via Gemini",
          status: "ready" as const,
        }))
      : buildFallbackGeminiContentsEntries(text, urls, metadata);

  const retrievalFailureEntries =
    metadata.flatMap<ProviderContentsMetadataEntry>((entry) =>
      entry.status !== undefined &&
      entry.status !== "URL_RETRIEVAL_STATUS_SUCCESS" &&
      !hasGeminiContentsEntryForUrl(readyEntries, entry.url)
        ? [
            {
              url: entry.url,
              title: entry.url,
              body: entry.status,
              status: "failed",
            },
          ]
        : [],
    );
  const formatFailureEntries = metadata.flatMap<ProviderContentsMetadataEntry>(
    (entry) =>
      isGeminiMetadataSuccess(entry) &&
      !hasGeminiContentsEntryForUrl(readyEntries, entry.url)
        ? [
            {
              url: entry.url,
              title: entry.url,
              body: "Gemini returned content for this URL in an unexpected format.",
              status: "failed",
            },
          ]
        : [],
  );

  return [...readyEntries, ...retrievalFailureEntries, ...formatFailureEntries];
}

function parseGeminiContentsBlocks(
  text: string,
): Array<{ url: string; title?: string; body: string }> {
  const normalized = text.replace(/\r\n/g, "\n");
  const blocks: Array<{ url: string; title?: string; body: string }> = [];
  const pattern =
    /\[\[\[URL\]\]\]\s*\n([^\n]+)\n\[\[\[TITLE\]\]\]\s*\n([^\n]*)\n\[\[\[BODY\]\]\]\s*\n([\s\S]*?)\n\[\[\[END\]\]\]/g;

  for (const match of normalized.matchAll(pattern)) {
    const url = match[1]?.trim();
    const title = match[2]?.trim();
    const body = match[3]?.trim();
    if (!url || !body) {
      continue;
    }

    blocks.push({
      url,
      ...(title ? { title } : {}),
      body,
    });
  }

  return blocks;
}

function orderGeminiContentsEntries<T extends { url: string }>(
  entries: T[],
  urls: string[],
): T[] {
  if (entries.length <= 1) {
    return entries;
  }

  const entriesByUrl = new Map<string, T[]>();
  for (const entry of entries) {
    const key = normalizeGeminiUrl(entry.url);
    const bucket = entriesByUrl.get(key);
    if (bucket) {
      bucket.push(entry);
    } else {
      entriesByUrl.set(key, [entry]);
    }
  }

  const ordered: T[] = [];
  for (const url of urls) {
    const key = normalizeGeminiUrl(url);
    const bucket = entriesByUrl.get(key);
    const next = bucket?.shift();
    if (next) {
      ordered.push(next);
    }
    if (bucket && bucket.length === 0) {
      entriesByUrl.delete(key);
    }
  }

  for (const bucket of entriesByUrl.values()) {
    ordered.push(...bucket);
  }

  return ordered;
}

function buildFallbackGeminiContentsEntries(
  text: string,
  urls: string[],
  metadata: Array<{ url: string; status: string | undefined }>,
): ProviderContentsMetadataEntry[] {
  if (!text) {
    return [];
  }

  const successfulMetadata = metadata.filter(
    (entry) =>
      entry.status === "URL_RETRIEVAL_STATUS_SUCCESS" ||
      entry.status === undefined,
  );
  const fallbackUrl =
    successfulMetadata.length === 1
      ? successfulMetadata[0]?.url
      : urls.length === 1 && metadata.length === 0
        ? urls[0]
        : undefined;

  if (!fallbackUrl) {
    return [];
  }

  return [
    {
      url: fallbackUrl,
      title: extractGeminiContentsTitle(text),
      body: text,
      summary: "1 content result via Gemini",
      status: "ready",
    },
  ];
}

function extractGeminiContentsTitle(text: string): string | undefined {
  const firstLine = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    return undefined;
  }

  return firstLine.replace(/^#+\s*/, "").trim() || undefined;
}

function isGeminiMetadataSuccess(entry: {
  status: string | undefined;
}): boolean {
  return (
    entry.status === "URL_RETRIEVAL_STATUS_SUCCESS" ||
    entry.status === undefined
  );
}

function getGeminiContentFailures(
  entries: ProviderContentsMetadataEntry[],
  retrievalFailures: Array<{ url: string; status: string | undefined }>,
): ProviderContentsMetadataEntry[] {
  const retrievalFailureUrls = new Set(
    retrievalFailures.map((entry) => normalizeGeminiUrl(entry.url)),
  );
  return entries.filter(
    (entry) =>
      entry.status === "failed" &&
      !retrievalFailureUrls.has(normalizeGeminiUrl(entry.url)),
  );
}

function hasGeminiContentsEntryForUrl(
  entries: ProviderContentsMetadataEntry[],
  url: string,
): boolean {
  const normalized = normalizeGeminiUrl(url);
  return entries.some((entry) => normalizeGeminiUrl(entry.url) === normalized);
}

function normalizeGeminiUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

function renderGeminiContentsEntries(
  entries: ProviderContentsMetadataEntry[],
): string {
  return entries
    .map((entry, index) => {
      const heading = entry.title ?? entry.url;
      const lines = [`${index + 1}. ${heading}`];
      if (entry.url && entry.url !== heading) {
        lines.push(`   ${entry.url}`);
      }
      for (const line of entry.body.trim().split("\n")) {
        lines.push(`   ${line}`);
      }
      return lines.join("\n");
    })
    .join("\n\n")
    .trim();
}

function formatInteractionOutputs(outputs: unknown): string {
  const lines: string[] = [];

  if (!Array.isArray(outputs)) {
    return "";
  }

  for (const output of outputs) {
    if (
      typeof output === "object" &&
      output !== null &&
      "type" in output &&
      output.type === "text" &&
      "text" in output &&
      typeof output.text === "string"
    ) {
      const text = output.text.trim();
      if (text) {
        lines.push(text);
      }
    }
  }

  return lines.join("\n\n").trim();
}

function formatGroundingSourceTitle(
  title: string | undefined,
  url: string,
): string {
  const trimmedTitle = title?.trim();
  if (trimmedTitle) {
    return trimmedTitle;
  }

  if (url) {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  return "Untitled";
}

function formatGroundingSourceUrl(url: string): string {
  if (!url) {
    return "";
  }

  if (isGoogleGroundingRedirect(url)) {
    return "";
  }

  return url;
}

function isGoogleGroundingRedirect(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === "vertexaisearch.cloud.google.com" &&
      parsed.pathname.startsWith("/grounding-api-redirect/")
    );
  } catch {
    return false;
  }
}

async function createSearchInteraction(
  ai: GoogleGenAI,
  request: {
    model: string;
    input: string;
    tools: Array<{ type: "google_search" }>;
    generation_config?: Record<string, unknown>;
  },
  signal: AbortSignal | undefined,
) {
  const forcedRequest = {
    ...request,
    ...(request.generation_config
      ? {
          generation_config: {
            ...request.generation_config,
            tool_choice: "any" as const,
          },
        }
      : {
          generation_config: {
            tool_choice: "any" as const,
          },
        }),
  };

  try {
    return await runWithoutGeminiInteractionsWarning(() =>
      ai.interactions.create(forcedRequest, buildGeminiRequestOptions(signal)),
    );
  } catch (error) {
    if (!isBuiltInToolChoiceError(error)) {
      throw error;
    }

    const fallbackGenerationConfig = stripToolChoice(request.generation_config);
    return runWithoutGeminiInteractionsWarning(() =>
      ai.interactions.create(
        {
          ...request,
          ...(fallbackGenerationConfig
            ? { generation_config: fallbackGenerationConfig }
            : {}),
        },
        buildGeminiRequestOptions(signal),
      ),
    );
  }
}

// TODO: Remove this suppression when @google/genai provides a way to silence
// the experimental-interactions warning natively.
const GEMINI_INTERACTIONS_WARNING =
  /GoogleGenAI\.interactions: Interactions usage is experimental and may change in future versions\.?/;
let geminiWarningSuppressionDepth = 0;
let originalGeminiConsoleWarn: typeof console.warn | undefined;
let originalGeminiStderrWrite: typeof process.stderr.write | undefined;

async function runWithoutGeminiInteractionsWarning<T>(
  operation: () => Promise<T>,
): Promise<T> {
  installGeminiWarningSuppression();
  try {
    return await operation();
  } finally {
    uninstallGeminiWarningSuppression();
  }
}

function installGeminiWarningSuppression(): void {
  geminiWarningSuppressionDepth += 1;
  if (geminiWarningSuppressionDepth !== 1) {
    return;
  }

  originalGeminiConsoleWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    if (matchesGeminiInteractionsWarning(args)) {
      return;
    }
    originalGeminiConsoleWarn?.(...args);
  };

  originalGeminiStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown, ...args: unknown[]) => {
    if (matchesGeminiInteractionsWarning([chunk])) {
      const callback = args.find(
        (arg): arg is (error?: Error | null) => void =>
          typeof arg === "function",
      );
      callback?.(null);
      return true;
    }
    return (
      originalGeminiStderrWrite?.(
        chunk as never,
        ...(args as Parameters<typeof process.stderr.write>[1][]),
      ) ?? true
    );
  }) as typeof process.stderr.write;
}

function uninstallGeminiWarningSuppression(): void {
  geminiWarningSuppressionDepth = Math.max(
    0,
    geminiWarningSuppressionDepth - 1,
  );
  if (geminiWarningSuppressionDepth !== 0) {
    return;
  }

  if (originalGeminiConsoleWarn) {
    console.warn = originalGeminiConsoleWarn;
    originalGeminiConsoleWarn = undefined;
  }
  if (originalGeminiStderrWrite) {
    process.stderr.write = originalGeminiStderrWrite;
    originalGeminiStderrWrite = undefined;
  }
}

function matchesGeminiInteractionsWarning(parts: unknown[]): boolean {
  const text = parts
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (part instanceof Uint8Array) {
        return Buffer.from(part).toString("utf8");
      }
      return "";
    })
    .join(" ");

  return GEMINI_INTERACTIONS_WARNING.test(text);
}

function isBuiltInToolChoiceError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes(
      "Function calling config is set without function_declarations",
    );
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message.includes(
      "Function calling config is set without function_declarations",
    );
  }

  return false;
}

async function resolveGoogleSearchUrl(
  url: string | undefined,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  if (!url) {
    return undefined;
  }

  if (!isGoogleGroundingRedirect(url)) {
    return url;
  }

  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      signal,
    });
    return response.headers.get("location") || url;
  } catch {
    return url;
  }
}

function buildGeminiSearchRequest(
  query: string,
  defaultModel: string,
  options: Record<string, unknown> | undefined,
): {
  model: string;
  input: string;
  tools: Array<{ type: "google_search" }>;
  generation_config?: Record<string, unknown>;
} {
  return {
    model: readNonEmptyString(options?.model) ?? defaultModel,
    input: query,
    tools: [{ type: "google_search" }],
    ...(isPlainObject(options?.generation_config)
      ? { generation_config: options.generation_config }
      : {}),
  };
}

function buildGeminiGenerateContentRequest({
  defaultModel,
  prompt,
  options,
  toolConfig,
}: {
  defaultModel: string;
  prompt: string;
  options: Record<string, unknown> | undefined;
  toolConfig: { urlContext: {} } | { googleSearch: {} };
}): {
  model: string;
  contents: string;
  config: Record<string, unknown>;
} {
  const requestOptions = isPlainObject(options) ? options : {};
  const explicitConfig = isPlainObject(requestOptions.config)
    ? requestOptions.config
    : {};

  return {
    model: readNonEmptyString(requestOptions.model) ?? defaultModel,
    contents: prompt,
    config: {
      ...explicitConfig,
      tools: [toolConfig],
    },
  };
}

function getGeminiResearchRequestOptions(
  options: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!isPlainObject(options)) {
    return {};
  }

  return { ...options };
}

function stripToolChoice(
  generationConfig: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!generationConfig || !Object.hasOwn(generationConfig, "tool_choice")) {
    return generationConfig;
  }

  const { tool_choice: _ignored, ...rest } = generationConfig;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getGeminiNativeConfig(config: GeminiProviderConfig) {
  return config.native ?? config.defaults;
}

function getGeminiExecutionPolicyDefaults(config: GeminiProviderConfig) {
  if (config.policy) {
    return config.policy;
  }

  return {
    requestTimeoutMs: config.defaults?.requestTimeoutMs,
    retryCount: config.defaults?.retryCount,
    retryDelayMs: config.defaults?.retryDelayMs,
    researchPollIntervalMs: config.defaults?.researchPollIntervalMs,
    researchTimeoutMs: config.defaults?.researchTimeoutMs,
    researchMaxConsecutivePollErrors:
      config.defaults?.researchMaxConsecutivePollErrors,
  };
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}
