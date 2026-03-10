import { GoogleGenAI } from "@google/genai";
import { resolveConfigValue } from "../config.js";
import type {
  GeminiProviderConfig,
  JsonObject,
  ProviderContext,
  ProviderStatus,
  ProviderToolOutput,
  SearchResponse,
  WebProvider,
} from "../types.js";

const DEFAULT_SEARCH_MODEL = "gemini-2.5-flash";
const DEFAULT_CONTENTS_MODEL = "gemini-2.5-flash";
const DEFAULT_ANSWER_MODEL = "gemini-2.5-flash";
const DEFAULT_RESEARCH_AGENT = "deep-research-pro-preview-12-2025";
const DEFAULT_POLL_INTERVAL_MS = 3000;

export class GeminiProvider implements WebProvider<GeminiProviderConfig> {
  readonly id = "gemini";
  readonly label = "Gemini";
  readonly docsUrl = "https://github.com/googleapis/js-genai";

  createTemplate(): GeminiProviderConfig {
    return {
      enabled: false,
      tools: {
        search: true,
        contents: true,
        answer: true,
        research: true,
      },
      apiKey: "GOOGLE_API_KEY",
      defaults: {
        searchModel: DEFAULT_SEARCH_MODEL,
        contentsModel: DEFAULT_CONTENTS_MODEL,
        answerModel: DEFAULT_ANSWER_MODEL,
        researchAgent: DEFAULT_RESEARCH_AGENT,
      },
    };
  }

  getStatus(config: GeminiProviderConfig | undefined): ProviderStatus {
    if (!config) {
      return { available: false, summary: "not configured" };
    }
    if (config.enabled === false) {
      return { available: false, summary: "disabled" };
    }
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      return { available: false, summary: "missing apiKey" };
    }
    return { available: true, summary: "enabled" };
  }

  async search(
    query: string,
    maxResults: number,
    _options: Record<string, unknown> | undefined,
    config: GeminiProviderConfig,
    context: ProviderContext,
  ): Promise<SearchResponse> {
    const ai = this.createClient(config);
    const model = config.defaults?.searchModel ?? DEFAULT_SEARCH_MODEL;

    context.onProgress?.(`Searching Gemini for: ${query}`);
    const interaction = await createSearchInteraction(ai, model, query);

    const results = await Promise.all(
      extractGoogleSearchResults(interaction.outputs)
        .slice(0, maxResults)
        .map(async (result) => {
          const resolvedUrl = await resolveGoogleSearchUrl(result.url);
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
    const model = config.defaults?.contentsModel ?? DEFAULT_CONTENTS_MODEL;

    context.onProgress?.(
      `Fetching contents from Gemini for ${urls.length} URL(s)`,
    );

    const urlList = urls.map((url) => `- ${url}`).join("\n");
    const response = await ai.models.generateContent({
      model,
      contents: [
        `Extract the main textual content from each of the following URLs. ` +
          `For each URL, return the page title followed by the cleaned body text. ` +
          `Preserve the original structure (headings, paragraphs, lists) but remove ` +
          `navigation, ads, and boilerplate.\n\n${urlList}`,
      ],
      config: {
        ...(options ?? {}),
        tools: [{ urlContext: {} }],
      },
    });

    const text = response.text?.trim() || "";
    const metadata = extractUrlContextMetadata(response.candidates);
    const lines: string[] = [];

    if (text) {
      lines.push(text);
    }

    if (metadata.length > 0) {
      const failures = metadata.filter(
        (entry) =>
          entry.status !== "URL_RETRIEVAL_STATUS_SUCCESS" &&
          entry.status !== undefined,
      );
      if (failures.length > 0) {
        lines.push("");
        lines.push("Retrieval issues:");
        for (const failure of failures) {
          lines.push(`- ${failure.url}: ${failure.status}`);
        }
      }
    }

    const successCount = metadata.filter(
      (entry) =>
        entry.status === "URL_RETRIEVAL_STATUS_SUCCESS" ||
        entry.status === undefined,
    ).length;

    return {
      provider: this.id,
      text: lines.join("\n").trimEnd() || "No contents extracted.",
      summary: `${successCount} of ${urls.length} URL(s) extracted via Gemini`,
      itemCount: successCount,
    };
  }

  async answer(
    query: string,
    options: Record<string, unknown> | undefined,
    config: GeminiProviderConfig,
    context: ProviderContext,
  ): Promise<ProviderToolOutput> {
    const ai = this.createClient(config);
    const model = config.defaults?.answerModel ?? DEFAULT_ANSWER_MODEL;

    context.onProgress?.(`Getting Gemini answer for: ${query}`);
    const response = await ai.models.generateContent({
      model,
      contents: query,
      config: {
        ...(options ?? {}),
        tools: [{ googleSearch: {} }],
      },
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

  async research(
    input: string,
    options: Record<string, unknown> | undefined,
    config: GeminiProviderConfig,
    context: ProviderContext,
  ): Promise<ProviderToolOutput> {
    const ai = this.createClient(config);
    const agent = config.defaults?.researchAgent ?? DEFAULT_RESEARCH_AGENT;
    const pollIntervalMs = getPollInterval(options);
    const requestOptions = stripPollIntervalOption(options);
    const startedAt = Date.now();
    let lastStatus: string | undefined;

    context.onProgress?.("Starting Gemini deep research");
    const initialInteraction = await ai.interactions.create({
      ...requestOptions,
      input,
      agent,
      background: true,
    });

    context.onProgress?.(`Gemini research started: ${initialInteraction.id}`);

    while (true) {
      if (context.signal?.aborted) {
        throw new Error("Gemini research aborted.");
      }

      const interaction = await ai.interactions.get(initialInteraction.id);
      const now = Date.now();
      if (interaction.status !== lastStatus) {
        context.onProgress?.(
          `Gemini research status: ${interaction.status} (${formatElapsed(now - startedAt)} elapsed)`,
        );
        lastStatus = interaction.status;
      }

      if (interaction.status === "completed") {
        const text = formatInteractionOutputs(interaction.outputs);
        return {
          provider: this.id,
          text: text || "Gemini research completed without textual output.",
          summary: "Research via Gemini",
        };
      }

      if (
        interaction.status === "failed" ||
        interaction.status === "cancelled"
      ) {
        throw new Error(`Gemini research ${interaction.status}.`);
      }

      await sleep(pollIntervalMs, context.signal);
    }
  }

  private createClient(config: GeminiProviderConfig): GoogleGenAI {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("Gemini is missing an API key.");
    }

    return new GoogleGenAI({
      apiKey,
      apiVersion: config.defaults?.apiVersion,
    });
  }
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
  model: string,
  query: string,
) {
  const request = {
    model,
    input: query,
    tools: [{ type: "google_search" as const }],
  };

  try {
    return await ai.interactions.create({
      ...request,
      generation_config: {
        tool_choice: "any",
      },
    });
  } catch (error) {
    if (!isBuiltInToolChoiceError(error)) {
      throw error;
    }

    return ai.interactions.create(request);
  }
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
    });
    return response.headers.get("location") || url;
  } catch {
    return url;
  }
}

async function sleep(
  ms: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (signal?.aborted) {
    throw new Error("Operation aborted.");
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("Operation aborted."));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${totalSeconds}s`;
}

function getPollInterval(options: Record<string, unknown> | undefined): number {
  const raw = options?.pollIntervalMs;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 1000) {
    return Math.trunc(raw);
  }
  return DEFAULT_POLL_INTERVAL_MS;
}

function stripPollIntervalOption(
  options: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!options || !Object.hasOwn(options, "pollIntervalMs")) {
    return options;
  }

  const { pollIntervalMs: _ignored, ...rest } = options;
  return rest;
}
