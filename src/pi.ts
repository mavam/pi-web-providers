import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type TObject, type TSchema } from "typebox";
import { createWebMux } from "./index.js";
import { loadConfig } from "./web-mux/configuration.js";
import { renderTextDocument } from "./web-mux/client.js";
import type {
  Capability,
  ProviderId,
  WebMuxClient,
  WebMuxConfig,
} from "./web-mux/public-types.js";

export default async function webMuxExtension(pi: ExtensionAPI): Promise<void> {
  const config = await loadConfig();
  const client = createWebMux({ config });

  await registerSearch(pi, client, config);
  await registerContents(pi, client, config);
  await registerAnswer(pi, client, config);
  await registerResearch(pi, client, config);
}

async function registerSearch(
  pi: ExtensionAPI,
  client: WebMuxClient,
  config: WebMuxConfig,
): Promise<void> {
  const provider = boundProvider(config, "search");
  if (!provider) return;
  const options = await optionsField(client, provider, "search");
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the public web for up to ten queries and return titles, URLs, and snippets grouped by query.",
    parameters: Type.Object(
      {
        queries: Type.Array(Type.String({ minLength: 1 }), {
          minItems: 1,
          maxItems: 10,
        }),
        maxResults: Type.Optional(Type.Integer({ minimum: 1 })),
        ...options,
      },
      { additionalProperties: false },
    ),
    async execute(_id, params, signal, onUpdate, ctx) {
      const result = await createWebMux({ config, cwd: ctx.cwd }).search({
        provider,
        queries: params.queries,
        maxResults: params.maxResults,
        options: params.options as Record<string, unknown> | undefined,
        signal: signal ?? undefined,
        onProgress: progress(onUpdate),
      });
      return toolResult(result);
    },
  });
}

async function registerContents(
  pi: ExtensionAPI,
  client: WebMuxClient,
  config: WebMuxConfig,
): Promise<void> {
  const provider = boundProvider(config, "contents");
  if (!provider) return;
  const options = await optionsField(client, provider, "contents");
  pi.registerTool({
    name: "web_contents",
    label: "Web Contents",
    description:
      "Fetch and extract the main contents of one or more web pages.",
    parameters: Type.Object(
      {
        urls: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
        ...options,
      },
      { additionalProperties: false },
    ),
    async execute(_id, params, signal, onUpdate, ctx) {
      const result = await createWebMux({ config, cwd: ctx.cwd }).contents({
        provider,
        urls: params.urls,
        options: params.options as Record<string, unknown> | undefined,
        signal: signal ?? undefined,
        onProgress: progress(onUpdate),
      });
      return toolResult(result);
    },
  });
}

async function registerAnswer(
  pi: ExtensionAPI,
  client: WebMuxClient,
  config: WebMuxConfig,
): Promise<void> {
  const provider = boundProvider(config, "answer");
  if (!provider) return;
  const options = await optionsField(client, provider, "answer");
  pi.registerTool({
    name: "web_answer",
    label: "Web Answer",
    description:
      "Answer up to ten factual questions using web-grounded evidence.",
    parameters: Type.Object(
      {
        queries: Type.Array(Type.String({ minLength: 1 }), {
          minItems: 1,
          maxItems: 10,
        }),
        ...options,
      },
      { additionalProperties: false },
    ),
    async execute(_id, params, signal, onUpdate, ctx) {
      const result = await createWebMux({ config, cwd: ctx.cwd }).answer({
        provider,
        queries: params.queries,
        options: params.options as Record<string, unknown> | undefined,
        signal: signal ?? undefined,
        onProgress: progress(onUpdate),
      });
      return toolResult(result);
    },
  });
}

async function registerResearch(
  pi: ExtensionAPI,
  client: WebMuxClient,
  config: WebMuxConfig,
): Promise<void> {
  const provider = boundProvider(config, "research");
  if (!provider) return;
  const options = await optionsField(client, provider, "research");
  pi.registerTool({
    name: "web_research",
    label: "Web Research",
    description:
      "Run a foreground multi-step web research request and return the final report.",
    parameters: Type.Object(
      {
        input: Type.String({ minLength: 1 }),
        ...options,
      },
      { additionalProperties: false },
    ),
    async execute(_id, params, signal, onUpdate, ctx) {
      const result = await createWebMux({ config, cwd: ctx.cwd }).research({
        provider,
        input: params.input,
        options: params.options as Record<string, unknown> | undefined,
        signal: signal ?? undefined,
        onProgress: progress(onUpdate),
      });
      return toolResult(result);
    },
  });
}

function boundProvider(
  config: WebMuxConfig,
  capability: Capability,
): ProviderId | undefined {
  return config.defaults?.[capability]?.provider;
}

async function optionsField(
  client: WebMuxClient,
  provider: ProviderId,
  capability: Capability,
): Promise<{ options?: TSchema }> {
  const schema = await client.getProviderOptionSchema(provider, capability);
  return schema ? { options: Type.Optional(schema as unknown as TObject) } : {};
}

function progress(onUpdate: ((update: any) => void) | undefined) {
  return (event: { message: string }) =>
    onUpdate?.({
      content: [{ type: "text", text: event.message }],
      details: {},
    });
}

function toolResult(result: any) {
  return {
    content: [{ type: "text" as const, text: renderTextDocument(result) }],
    details: result,
    isError: result.status === "partial",
  };
}
