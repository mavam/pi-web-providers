import type { IndexedContentsResponse } from "../../contents.js";
import { WEB_MUX_ERROR_CODES, type SerializedError } from "../../domain.js";
import type { Custom } from "./types.js";
import type {
  ProviderContext,
  ProviderRequest,
  SearchResponse,
  ToolOutput,
} from "../contract.js";

import { runCliJsonCommand } from "../cli-json.js";
import { WebMuxError } from "../../errors.js";

async function run(
  request: ProviderRequest,
  config: Custom,
  context: ProviderContext,
): Promise<Record<string, unknown>> {
  const command = config.commands?.[request.capability];
  if (!command)
    throw new WebMuxError(
      "PROVIDER_UNAVAILABLE",
      `Configure a custom ${request.capability} command.`,
    );
  const { capability, options, ...input } = request;
  const output = await runCliJsonCommand({
    command,
    payload: {
      schemaVersion: 1,
      capability,
      input,
      options: options ?? {},
      cwd: context.cwd,
    },
    context,
    label: `Custom ${capability}`,
  });
  return object(output, "Custom output must be a JSON object.");
}
export const adapter = {
  async search(
    request: ProviderRequest<"search">,
    config: Custom,
    context: ProviderContext,
  ): Promise<SearchResponse> {
    const output = await run(request, config, context);
    if (!Array.isArray(output.results))
      invalid("Custom search output requires a results array.");
    return {
      provider: "custom",
      results: output.results.map((entry) => {
        const result = object(entry, "Search results must be objects.");
        return {
          title: string(result.title, "title"),
          url: string(result.url, "url"),
          snippet: string(result.snippet, "snippet"),
          ...(typeof result.score === "number" ? { score: result.score } : {}),
          ...(result.metadata
            ? {
                metadata: object(result.metadata, "metadata must be an object"),
              }
            : {}),
        };
      }),
    };
  },
  async contents(
    request: ProviderRequest<"contents">,
    config: Custom,
    context: ProviderContext,
  ): Promise<IndexedContentsResponse> {
    const output = await run(request, config, context);
    if (!Array.isArray(output.answers))
      invalid("Custom contents output requires an answers array.");
    return {
      provider: "custom",
      answers: output.answers.map((entry) => {
        const answer = object(entry, "Contents answers must be objects.");
        if (!Number.isInteger(answer.inputIndex))
          invalid(
            "Every custom contents answer requires inputIndex (the zero-based requested URL index).",
          );
        const error =
          answer.error === undefined ? undefined : parseError(answer.error);
        if (
          answer.content === undefined &&
          answer.summary === undefined &&
          error === undefined
        )
          invalid("Contents answers require content, summary, or error.");
        return {
          inputIndex: answer.inputIndex as number,
          url: string(answer.url, "url"),
          ...(answer.content === undefined
            ? {}
            : { content: string(answer.content, "content") }),
          ...(answer.summary === undefined ? {} : { summary: answer.summary }),
          ...(answer.metadata
            ? {
                metadata: object(answer.metadata, "metadata must be an object"),
              }
            : {}),
          ...(error ? { error } : {}),
        };
      }),
    };
  },
  async answer(
    request: ProviderRequest<"answer">,
    config: Custom,
    context: ProviderContext,
  ): Promise<ToolOutput> {
    return textOutput(await run(request, config, context));
  },
  async research(
    request: ProviderRequest<"research">,
    config: Custom,
    context: ProviderContext,
  ): Promise<ToolOutput> {
    return textOutput(await run(request, config, context));
  },
};
function textOutput(output: Record<string, unknown>): ToolOutput {
  return {
    provider: "custom",
    text: string(output.text, "text"),
    ...(typeof output.itemCount === "number" &&
    Number.isSafeInteger(output.itemCount) &&
    output.itemCount >= 0
      ? { itemCount: output.itemCount }
      : {}),
    ...(output.metadata
      ? { metadata: object(output.metadata, "metadata must be an object") }
      : {}),
  };
}
function parseError(value: unknown): SerializedError {
  const error = object(
    value,
    "Custom contents errors must be structured objects with code and message.",
  );
  if (!WEB_MUX_ERROR_CODES.includes(error.code as SerializedError["code"]))
    invalid("Custom contents error has an unknown code.");
  return {
    code: error.code as SerializedError["code"],
    message: string(error.message, "error.message"),
    ...(typeof error.retryable === "boolean"
      ? { retryable: error.retryable }
      : {}),
  };
}
function object(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid(message);
  return value as Record<string, unknown>;
}
function string(value: unknown, name: string): string {
  if (typeof value !== "string")
    invalid(`Custom output field ${name} must be a string.`);
  return value;
}
function invalid(message: string): never {
  throw new WebMuxError("PROVIDER_FAILURE", message, { retryable: false });
}
