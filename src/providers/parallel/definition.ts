import { defineProvider } from "../definition.js";

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
              {
                type: "string",
                const: "turbo",
              },
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
