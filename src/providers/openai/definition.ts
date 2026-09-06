import { defineProvider } from "../definition.js";

const controls = {
  model: {
    type: "string",
    description:
      "OpenAI model override. Tool and reasoning support depends on the model.",
  },
  instructions: {
    type: "string",
    description: "Instructions for the answer and source selection.",
  },
  reasoning: {
    type: "object",
    properties: {
      effort: {
        type: "string",
        enum: ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
        description:
          "Use a level supported by the model; some levels do not support web search.",
      },
    },
    description: "Model reasoning controls.",
  },
  max_output_tokens: {
    type: "integer",
    minimum: 1,
    description: "Maximum generated tokens, including reasoning.",
  },
  searchContextSize: {
    type: "string",
    enum: ["low", "medium", "high"],
    description: "Amount of web search context.",
  },
  allowedDomains: {
    type: "array",
    maxItems: 100,
    items: { type: "string" },
    description: "Restrict search to these domains.",
  },
  externalWebAccess: {
    type: "boolean",
    description: "Allow live fetching; false uses cached/indexed content only.",
  },
};
const userLocation = {
  type: "object",
  properties: {
    city: { type: "string" },
    country: { type: "string" },
    region: { type: "string" },
    timezone: { type: "string" },
  },
  description: "Approximate location. Not supported by deep research models.",
};

export const openaiProvider = defineProvider({
  id: "openai",
  label: "OpenAI",
  docsUrl: "https://developers.openai.com/api/docs/guides/tools-web-search",
  local: false,
  credentials: [{ name: "api", environmentVariable: "OPENAI_API_KEY" }],
  fields: ["credentials", "baseUrl", "options"],
  defaults: {
    search: { model: "gpt-4.1" },
    answer: { model: "gpt-4.1" },
    research: { model: "o4-mini-deep-research" },
  },
  credentialDefaults: {},
  capabilities: {
    search: {
      options: {
        type: "object",
        properties: { ...controls, userLocation },
        description: "OpenAI search options.",
      },
      promptGuidelines: [
        "Use OpenAI web search for model-mediated source discovery.",
        "Use instructions for explicit source-selection needs and allowedDomains for domain restrictions.",
        "Use searchContextSize='high' only when richer context is needed. Set externalWebAccess=false only when cached results are acceptable.",
        "Reasoning levels depend on the model; gpt-5 minimal reasoning does not support web search. Do not send reasoning for models that do not support it.",
        "Prefer web_contents to inspect selected primary sources.",
      ],
      retrySafe: true,
    },
    answer: {
      options: {
        type: "object",
        properties: { ...controls, userLocation },
        description: "OpenAI answer options.",
      },
      retrySafe: false,
    },
    research: {
      options: {
        type: "object",
        properties: {
          ...controls,
          max_tool_calls: {
            type: "integer",
            minimum: 1,
            description: "Maximum built-in tool calls during research.",
          },
        },
        description:
          "OpenAI research options. Deep research models do not support userLocation.",
      },
      retrySafe: false,
    },
  },
  load: async () => (await import("./adapter.js")).adapter,
});
