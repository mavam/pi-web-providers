import { defineProvider } from "../definition.js";

export const geminiProvider = defineProvider({
  id: "gemini",
  label: "Gemini",
  docsUrl: "https://github.com/googleapis/js-genai",
  local: false,
  credentials: [
    {
      name: "api",
      environmentVariable: "GOOGLE_API_KEY",
    },
  ],
  fields: ["credentials", "options"],
  defaults: {
    search: {
      model: "gemini-2.5-flash",
    },
    answer: {
      model: "gemini-2.5-flash",
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
            description:
              "Gemini model for search (for example 'gemini-2.5-flash').",
          },
          generation_config: {
            type: "object",
            properties: {
              temperature: {
                type: "number",
                description: "Sampling temperature.",
              },
              topP: {
                type: "number",
                description: "Top-p sampling value.",
              },
              topK: {
                type: "integer",
                minimum: 0,
                description: "Top-k sampling value.",
              },
              candidateCount: {
                type: "integer",
                minimum: 1,
                description: "Number of candidates to generate.",
              },
              maxOutputTokens: {
                type: "integer",
                minimum: 1,
                description: "Maximum output tokens.",
              },
              tool_choice: {
                anyOf: [
                  {
                    type: "string",
                    const: "auto",
                  },
                  {
                    type: "string",
                    const: "any",
                  },
                  {
                    type: "string",
                    const: "none",
                  },
                ],
                description: "Tool choice mode for Gemini search interactions.",
              },
            },
            description: "Gemini generation configuration.",
          },
        },
        description: "Gemini search options.",
      },
      promptGuidelines: [
        "Use Gemini search when a grounded model should perform web-backed source discovery and return likely sources.",
        "Change model only when the user requests a specific Gemini model or when project configuration requires it.",
        "Tune generation_config only for explicit output-control needs; avoid disabling tool use for search tasks.",
        "Prefer web_contents after Gemini search when selected sources need direct extraction or closer reading.",
      ],
      retrySafe: true,
    },
    answer: {
      options: {
        type: "object",
        properties: {
          model: {
            type: "string",
            description:
              "Gemini model for answers (for example 'gemini-2.5-flash').",
          },
          config: {
            type: "object",
            properties: {
              labels: {
                type: "object",
                patternProperties: {
                  "^.*$": {
                    type: "string",
                  },
                },
                description: "Request labels to attach to the Gemini call.",
              },
              temperature: {
                type: "number",
                description: "Sampling temperature.",
              },
              topP: {
                type: "number",
                description: "Top-p sampling value.",
              },
              topK: {
                type: "integer",
                minimum: 0,
                description: "Top-k sampling value.",
              },
              candidateCount: {
                type: "integer",
                minimum: 1,
                description: "Number of candidates to generate.",
              },
              maxOutputTokens: {
                type: "integer",
                minimum: 1,
                description: "Maximum output tokens.",
              },
            },
            description: "Gemini generate-content config overrides.",
          },
        },
        description: "Gemini answer options.",
      },
      retrySafe: false,
    },
    research: {
      options: {
        type: "object",
        properties: {
          agent_config: {
            type: "object",
            properties: {
              thinking_summaries: {
                anyOf: [
                  {
                    type: "string",
                    const: "auto",
                  },
                  {
                    type: "string",
                    const: "none",
                  },
                ],
                description:
                  "Whether to include thought summaries in the response.",
              },
            },
            additionalProperties: false,
            description:
              "Safe Gemini deep-research agent configuration. The provider adds the required type field.",
          },
        },
        additionalProperties: false,
        description: "Gemini research options.",
      },
      retrySafe: false,
    },
  },
  load: async () => (await import("./adapter.js")).adapter,
});
