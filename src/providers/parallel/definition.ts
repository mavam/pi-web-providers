import { defineProvider } from "../definition.js";

const fetchPolicy = {
  type: "object",
  properties: {
    max_age_seconds: {
      type: "number",
      minimum: 600,
      description: "Cache age threshold for live fetching, in seconds.",
    },
    timeout_seconds: {
      type: "number",
      exclusiveMinimum: 0,
      description: "Live fetch timeout in seconds.",
    },
    disable_cache_fallback: {
      type: "boolean",
      description: "Fail instead of falling back to stale content.",
    },
  },
};
const excerptSettings = {
  type: "object",
  properties: {
    max_chars_per_result: { type: "integer", minimum: 0 },
  },
};
const sourcePolicy = {
  type: "object",
  properties: {
    include_domains: {
      type: "array",
      maxItems: 200,
      items: { type: "string" },
    },
    exclude_domains: {
      type: "array",
      maxItems: 200,
      items: { type: "string" },
    },
    after_date: {
      type: "string",
      description: "Earliest publication date (YYYY-MM-DD).",
    },
  },
  description:
    "Source constraints; include and exclude lists may contain at most 200 domains combined.",
};
const commonProperties = {
  objective: {
    type: "string",
    description: "Underlying question or goal guiding retrieval.",
  },
  max_chars_total: {
    type: "integer",
    minimum: 1,
    description: "Total excerpt character budget.",
  },
  client_model: { type: "string", description: "Model consuming the results." },
  session_id: {
    type: "string",
    description: "Session ID for related search and extraction calls.",
  },
};

export const parallelProvider = defineProvider({
  id: "parallel",
  label: "Parallel",
  docsUrl: "https://github.com/parallel-web/parallel-sdk-typescript",
  local: false,
  credentials: [
    {
      name: "api",
      environmentVariable: "PARALLEL_API_KEY",
    },
  ],
  fields: ["credentials", "baseUrl", "options"],
  defaults: {
    search: {
      mode: "advanced",
    },
    contents: {
      excerpts: false,
      full_content: true,
    },
  },
  credentialDefaults: {},
  capabilities: {
    search: {
      options: {
        type: "object",
        properties: {
          ...commonProperties,
          advanced_settings: {
            type: "object",
            properties: {
              excerpt_settings: excerptSettings,
              fetch_policy: fetchPolicy,
              source_policy: sourcePolicy,
              location: {
                type: "string",
                description: "Two-letter country code.",
              },
            },
            description:
              "Advanced retrieval settings. Result count comes from maxResults.",
          },
          mode: {
            anyOf: [
              {
                type: "string",
                const: "advanced",
              },
              {
                type: "string",
                const: "basic",
              },
              { type: "string", const: "turbo" },
              { type: "string", const: "fast" },
            ],
            description:
              "Parallel search mode. Use 'advanced' for higher quality, 'basic' for lower latency, or 'turbo' for the fastest responses.",
          },
        },
        description: "Parallel search options.",
      },
      promptGuidelines: [
        "Use Parallel mode='advanced' for exploratory, ambiguous, or multi-hop source discovery where the provider should plan the search.",
        "Use Parallel mode='basic' for direct factual lookups and simple source finding where low latency is preferred.",
        "Use Parallel mode='turbo' only when fastest responses matter more than recall or depth.",
        "Prefer web_contents with Parallel extraction when a URL set is already known and the task needs full page content rather than more source discovery.",
      ],
      retrySafe: true,
    },
    contents: {
      options: {
        type: "object",
        properties: {
          ...commonProperties,
          advanced_settings: {
            type: "object",
            properties: {
              excerpt_settings: excerptSettings,
              fetch_policy: fetchPolicy,
            },
            description: "Advanced extraction settings.",
          },
          excerpts: {
            type: "boolean",
            description: "Include excerpts in extraction results.",
          },
          full_content: {
            type: "boolean",
            description: "Include full page content in extraction results.",
          },
        },
        description: "Parallel extract options.",
      },
      retrySafe: true,
    },
  },
  load: async () => (await import("./adapter.js")).adapter,
});
