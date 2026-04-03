import type { TObject } from "@sinclair/typebox";
import { type Static, Type } from "@sinclair/typebox";
import type { Tool } from "./types.js";
import { PROVIDER_IDS } from "./types.js";

export type ProviderOptions = Record<string, unknown>;

const runtimeOptionFields = {
  requestTimeoutMs: Type.Optional(
    Type.Integer({
      minimum: 1,
      description:
        "Maximum time in milliseconds to wait for a single provider request.",
    }),
  ),
  retryCount: Type.Optional(
    Type.Integer({
      minimum: 0,
      description: "Number of times to retry transient failures.",
    }),
  ),
  retryDelayMs: Type.Optional(
    Type.Integer({
      minimum: 1,
      description:
        "Initial delay in milliseconds before retrying. Later retries back off automatically.",
    }),
  ),
};

export const runtimeOptionsSchema = Type.Object(runtimeOptionFields, {
  additionalProperties: false,
  description: "Local runtime controls for this tool call.",
});
export type RuntimeOptions = Static<typeof runtimeOptionsSchema>;

export const searchPrefetchOptionsSchema = Type.Object(
  {
    provider: Type.Optional(
      Type.Union([...PROVIDER_IDS.map((id) => Type.Literal(id)), Type.Null()], {
        description:
          "Contents-capable provider to prefetch search result URLs. Set to enable prefetch.",
      }),
    ),
    maxUrls: Type.Optional(
      Type.Integer({
        minimum: 1,
        description: "Maximum number of search result URLs to prefetch.",
      }),
    ),
    ttlMs: Type.Optional(
      Type.Integer({
        minimum: 1,
        description:
          "How long prefetched contents stay reusable in the local cache, in milliseconds.",
      }),
    ),
  },
  {
    additionalProperties: false,
    description:
      "Background contents prefetch for search result URLs. Only runs when provider is set.",
  },
);
export type SearchPrefetchOptions = Static<typeof searchPrefetchOptionsSchema>;

export const searchRuntimeOptionsSchema = Type.Object(
  {
    ...runtimeOptionFields,
    prefetch: Type.Optional(searchPrefetchOptionsSchema),
  },
  {
    additionalProperties: false,
    description: "Local runtime controls for search.",
  },
);
export type SearchRuntimeOptions = Static<typeof searchRuntimeOptionsSchema>;

export interface ToolRuntimeOptionsMap {
  search: SearchRuntimeOptions;
  contents: RuntimeOptions;
  answer: RuntimeOptions;
  research: never;
}

export type RuntimeOptionsFor<TTool extends Tool> =
  ToolRuntimeOptionsMap[TTool];

type ToolOptionsBase<TProviderOptions extends ProviderOptions> = {
  provider?: TProviderOptions;
};

export type ToolOptionsFor<
  TTool extends Tool,
  TProviderOptions extends ProviderOptions = ProviderOptions,
> = ToolRuntimeOptionsMap[TTool] extends never
  ? ToolOptionsBase<TProviderOptions>
  : ToolOptionsBase<TProviderOptions> & {
      runtime?: ToolRuntimeOptionsMap[TTool];
    };

export function buildToolOptionsSchema(
  capability: Tool,
  providerSchema?: TObject,
) {
  const properties: Record<string, ReturnType<typeof Type.Optional>> = {};

  const runtimeSchema = getRuntimeOptionsSchema(capability);
  if (runtimeSchema) {
    properties.runtime = Type.Optional(runtimeSchema);
  }

  if (providerSchema) {
    properties.provider = Type.Optional(providerSchema);
  }

  return Type.Object(properties, {
    additionalProperties: false,
    description:
      "Options for this tool call split into provider-facing settings and local runtime controls.",
  });
}

function getRuntimeOptionsSchema(capability: Tool) {
  switch (capability) {
    case "search":
      return searchRuntimeOptionsSchema;
    case "contents":
    case "answer":
      return runtimeOptionsSchema;
    default:
      return undefined;
  }
}
