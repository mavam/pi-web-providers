import { defineProvider } from "../definition.js";

export const codexProvider = defineProvider({
  id: "codex",
  label: "Codex",
  docsUrl: "https://github.com/openai/codex/tree/main/sdk/typescript",
  local: true,
  credentials: [
    {
      name: "api",
      environmentVariable: "OPENAI_API_KEY",
      optional: true,
    },
  ],
  fields: ["credentials", "baseUrl", "options", "codexPath", "env", "config"],
  defaults: {
    search: {
      webSearchMode: "live",
    },
  },
  credentialDefaults: {},
  capabilities: {
    search: {
      options: {
        type: "object",
        properties: {
          model: {
            type: "string",
            description: "Codex model override.",
          },
          modelReasoningEffort: {
            anyOf: [
              {
                type: "string",
                const: "minimal",
              },
              {
                type: "string",
                const: "low",
              },
              {
                type: "string",
                const: "medium",
              },
              {
                type: "string",
                const: "high",
              },
              { type: "string", const: "xhigh" },
              { type: "string", const: "max" },
              { type: "string", const: "ultra" },
              { type: "string", const: "persistent" },
            ],
            description:
              "Reasoning depth for Codex. Available levels depend on the selected model.",
          },
          webSearchMode: {
            anyOf: [
              {
                type: "string",
                const: "disabled",
              },
              {
                type: "string",
                const: "cached",
              },
              {
                type: "string",
                const: "live",
              },
            ],
            description:
              "How Codex should source web results. Use 'live' for current information, 'cached' when freshness is less important, and 'disabled' only when web access should not be used.",
          },
        },
        description: "Codex search options.",
      },
      promptGuidelines: [
        "Use Codex search when the local Codex SDK should perform web-backed source discovery, especially for coding or developer-oriented investigations.",
        "Use webSearchMode='live' for current information and 'cached' when freshness is less important; do not set 'disabled' for normal web_search calls.",
        "Increase modelReasoningEffort only for difficult or ambiguous searches where deeper reasoning is worth the extra latency.",
      ],
      retrySafe: true,
    },
  },
  load: async () => (await import("./adapter.js")).adapter,
});
