import { GoogleGenAI } from "@google/genai";

import { executeAsyncResearch } from "../../runtime/polling.js";
import type {
  ProviderContext,
  ResearchJob,
  ResearchPollResult,
  ToolOutput,
} from "../contract.js";
import type { Gemini } from "./types.js";

const DEFAULT_ANSWER_MODEL = "gemini-2.5-flash";
const DEFAULT_RESEARCH_AGENT = "deep-research-preview-04-2026";

export const geminiImplementation = {
  async answer(
    query: string,
    config: Gemini,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput> {
    const ai = this.createClient(config);
    const request = buildGeminiGenerateContentRequest({
      defaultModel: DEFAULT_ANSWER_MODEL,
      prompt: query,
      options,
      toolConfig: { googleSearch: {} },
    });

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
      provider: "gemini",
      text: lines.join("\n").trimEnd(),
      itemCount: sources.length,
    };
  },

  async research(
    input: string,
    config: Gemini,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput> {
    return await executeAsyncResearch({
      providerLabel: "Gemini",
      providerId: "gemini",
      context,
      start: (researchContext) =>
        this.startResearch(input, config, researchContext, options),
      poll: (id, researchContext) =>
        this.pollResearch(id, config, researchContext, options),
    });
  },

  async startResearch(
    input: string,
    config: Gemini,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ResearchJob> {
    const ai = this.createClient(config);
    const requestOptions = getGeminiResearchRequestOptions(options);
    const interaction = await ai.interactions.create(
      {
        ...requestOptions,
        input,
        agent: DEFAULT_RESEARCH_AGENT,
        background: true,
      },
      buildGeminiRequestOptions(context.signal, context.idempotencyKey),
    );

    return { id: interaction.id };
  },

  async pollResearch(
    id: string,
    config: Gemini,
    context: ProviderContext,
    _options?: Record<string, unknown>,
  ): Promise<ResearchPollResult> {
    const ai = this.createClient(config);
    const interaction = await ai.interactions.get(
      id,
      undefined,
      buildGeminiRequestOptions(context.signal),
    );

    const status = readNonEmptyString(interaction.status) ?? "unknown";

    if (status === "completed") {
      const text = formatInteractionSteps(readInteractionSteps(interaction));
      return {
        status: "completed",
        output: {
          provider: "gemini",
          text: text || "Gemini research completed without textual output.",
        },
      };
    }

    if (status === "failed") {
      return {
        status: "failed",
        error: "research failed",
      };
    }

    if (status === "cancelled") {
      return {
        status: "cancelled",
        error: "research was canceled",
      };
    }

    if (status === "incomplete") {
      return {
        status: "failed",
        error: "research ended incomplete",
      };
    }

    if (status === "requires_action") {
      return {
        status: "failed",
        error: describeGeminiRequiredAction(readInteractionSteps(interaction)),
      };
    }

    return status === "in_progress"
      ? { status: "in_progress" }
      : { status: "in_progress", statusText: status };
  },

  createClient(config: Gemini): GoogleGenAI {
    const apiKey = config.credentials?.api;
    if (!apiKey) {
      throw new Error("is missing an API key");
    }

    return new GoogleGenAI({
      httpOptions: { retryOptions: { attempts: 1 } },
      apiKey,
    });
  },
};

function buildGeminiRequestOptions(
  signal: AbortSignal | undefined,
  idempotencyKey?: string,
) {
  return {
    maxRetries: 0,
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

function readInteractionSteps(interaction: unknown): unknown {
  return typeof interaction === "object" && interaction !== null
    ? (interaction as { steps?: unknown }).steps
    : undefined;
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

function formatInteractionSteps(steps: unknown): string {
  const lines: string[] = [];

  if (!Array.isArray(steps)) {
    return "";
  }

  for (const step of steps) {
    if (
      typeof step !== "object" ||
      step === null ||
      !("type" in step) ||
      step.type !== "model_output" ||
      !("content" in step) ||
      !Array.isArray(step.content)
    ) {
      continue;
    }

    for (const part of step.content) {
      if (
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        const text = part.text.trim();
        if (text) {
          lines.push(text);
        }
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

function buildGeminiGenerateContentRequest({
  defaultModel,
  prompt,
  options,
  toolConfig,
}: {
  defaultModel: string;
  prompt: string;
  options: Record<string, unknown> | undefined;
  toolConfig: { googleSearch: {} };
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

function describeGeminiRequiredAction(steps: unknown): string {
  if (!Array.isArray(steps) || steps.length === 0) {
    return "research requires additional action";
  }

  // The interaction's steps start with the submitted input, so the step that
  // demands action is the most recent one.
  const lastStep = [...steps]
    .reverse()
    .find((value) => typeof value === "object" && value !== null) as
    | Record<string, unknown>
    | undefined;
  const type = readNonEmptyString(lastStep?.type);

  if (!type) {
    return "research requires additional action";
  }

  return `research requires additional action (${type})`;
}

function getGeminiResearchRequestOptions(
  options: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!isPlainObject(options)) {
    return {};
  }

  const unknownKeys = Object.keys(options).filter(
    (key) => key !== "agent_config",
  );
  if (unknownKeys.length > 0) {
    throw new Error(
      `Unsupported Gemini research options: ${unknownKeys.join(", ")}.`,
    );
  }

  const requestOptions: Record<string, unknown> = {};

  const agentConfig = getGeminiDeepResearchAgentConfig(options.agent_config);
  if (agentConfig) {
    requestOptions.agent_config = agentConfig;
  }

  return requestOptions;
}

function getGeminiDeepResearchAgentConfig(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  if (Object.keys(value).length === 0) {
    return undefined;
  }

  const unknownKeys = Object.keys(value).filter(
    (key) => key !== "thinking_summaries",
  );
  if (unknownKeys.length > 0) {
    throw new Error(
      `Unsupported Gemini agent_config options: ${unknownKeys.join(", ")}.`,
    );
  }

  const thinkingSummaries = readNonEmptyString(value.thinking_summaries);
  if (thinkingSummaries !== "auto" && thinkingSummaries !== "none") {
    throw new Error(
      "Gemini agent_config.thinking_summaries must be 'auto' or 'none'.",
    );
  }

  return {
    type: "deep-research",
    thinking_summaries: thinkingSummaries,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

export const adapter = {
  async answer(
    input: import("../contract.js").ProviderRequest<"answer">,
    config: Gemini,
    context: ProviderContext,
  ) {
    return await geminiImplementation.answer(
      input.query,
      config,
      context,
      input.options,
    );
  },
  async research(
    input: import("../contract.js").ProviderRequest<"research">,
    config: Gemini,
    context: ProviderContext,
  ) {
    return await geminiImplementation.research(
      input.input,
      config,
      context,
      input.options,
    );
  },
};
