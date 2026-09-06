import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  truncateHead,
  withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { Type, type TObject, type TProperties } from "typebox";
import { WebCall, renderWebResult, type UrlStatus } from "./pi-render.js";
import {
  CAPABILITIES,
  createWebfox as createWebClient,
  type Capability,
  type ProgressEvent,
  type WebfoxClient as WebClient,
} from "./index.js";
import { renderTextDocument } from "./render.js";

export default function webExtension(pi: ExtensionAPI): void {
  const clients = new Map<string, WebClient>();
  const clientFor = (cwd: string) => {
    let client = clients.get(cwd);
    if (!client) {
      client = createWebClient({ cwd });
      clients.set(cwd, client);
    }
    return client;
  };
  const initial = clientFor(process.cwd());
  const selected = CAPABILITIES.filter(
    (capability) => initial.inspectCapability(capability).provider,
  );
  if (!selected.length)
    pi.on("session_start", (_event, context) => {
      if (context.hasUI)
        context.ui.notify(
          "Web registered no tools. Select a default provider in the shared configuration, then restart pi.",
          "warning",
        );
    });
  for (const capability of selected) {
    const inspection = initial.inspectCapability(capability);
    const provider = inspection.provider!;
    const fields: TProperties =
      capability === "contents"
        ? { urls: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }) }
        : capability === "research"
          ? { input: Type.String({ minLength: 1 }) }
          : {
              queries: Type.Array(Type.String({ minLength: 1 }), {
                minItems: 1,
                maxItems: 10,
              }),
              ...(capability === "search"
                ? { maxResults: Type.Optional(Type.Integer({ minimum: 1 })) }
                : {}),
            };
    pi.registerTool({
      name: `web_${capability}`,
      label: `Web ${capability[0].toUpperCase()}${capability.slice(1)}`,
      description: `${descriptions[capability]} Output is truncated to 2000 lines or 50 KiB; full results are saved to a file when truncated.`,
      parameters: Type.Object(
        {
          ...fields,
          ...(inspection.optionSchema
            ? {
                options: Type.Optional(
                  inspection.optionSchema as unknown as TObject,
                ),
              }
            : {}),
        },
        { additionalProperties: false },
      ),
      renderCall(args, theme, context) {
        const call =
          context.lastComponent instanceof WebCall
            ? context.lastComponent
            : new WebCall(capability);
        call.update(args, theme, context.expanded);
        return call;
      },
      renderResult(result, options, theme, context) {
        return renderWebResult(result, options, theme, context.isError);
      },
      async execute(_id, values, signal, onUpdate, ctx) {
        const params = values as {
          queries?: string[];
          urls?: string[];
          input?: string;
          maxResults?: number;
          options?: Record<string, unknown>;
        };
        const client = clientFor(ctx.cwd);
        const urlStatuses: UrlStatus[] = [];
        const request = {
          provider,
          signal: signal ?? ctx.signal,
          options: params.options as Record<string, unknown> | undefined,
          onProgress: (event: ProgressEvent) => {
            if (capability === "contents") {
              if (
                event.inputIndex === undefined ||
                event.input === undefined ||
                !event.state
              )
                return;
              urlStatuses[event.inputIndex] = {
                url: event.input,
                state: event.state,
              };
              onUpdate?.({
                content: [{ type: "text", text: event.message }],
                details: {
                  webContentsStatus: true,
                  urls: urlStatuses.filter(Boolean).map((row) => ({ ...row })),
                },
              });
            } else
              onUpdate?.({
                content: [{ type: "text", text: event.message }],
                details: {},
              });
          },
        };
        const result =
          capability === "search"
            ? await client.search({
                ...request,
                queries: params.queries!,
                maxResults: params.maxResults,
              })
            : capability === "answer"
              ? await client.answer({ ...request, queries: params.queries! })
              : capability === "contents"
                ? await client.contents({ ...request, urls: params.urls! })
                : await client.research({ ...request, input: params.input! });
        const text = renderTextDocument(result);
        const truncated = truncateHead(text);
        let body = truncated.content;
        let fullOutputPath: string | undefined;
        if (truncated.truncated) {
          fullOutputPath = join(
            await mkdtemp(join(tmpdir(), "web-")),
            "result.json",
          );
          await withFileMutationQueue(fullOutputPath, () =>
            writeFile(fullOutputPath!, JSON.stringify(result), { mode: 0o600 }),
          );
          body += `\n\nFull results: ${fullOutputPath}`;
        }
        // Preserve partial results, and mark the tool error through Pi's event
        // API instead of the ignored isError property on execute return values.
        return {
          content: [{ type: "text" as const, text: body }],
          details: {
            webProviderResult: true,
            status: result.status,
            ...(capability === "contents"
              ? {
                  webContentsStatus: true,
                  urls: result.results.map((entry) => ({
                    url: entry.input,
                    state: entry.ok
                      ? "done"
                      : entry.error.code === "CANCELLED"
                        ? "cancelled"
                        : "failed",
                  })),
                }
              : {}),
            ...(fullOutputPath ? { fullOutputPath } : { result }),
          },
        };
      },
    });
  }
  pi.on("tool_result", (event) => {
    if (
      event.details &&
      typeof event.details === "object" &&
      "webProviderResult" in event.details &&
      event.details.webProviderResult === true &&
      "status" in event.details &&
      event.details.status === "partial"
    )
      return { isError: true };
  });
}
const descriptions: Record<Capability, string> = {
  search:
    "Search up to ten queries and return titles, URLs, and snippets in input order.",
  contents: "Fetch and extract readable contents from web URLs.",
  answer: "Answer up to ten questions using web-grounded evidence.",
  research:
    "Run foreground multi-step web research and return the final report.",
};
