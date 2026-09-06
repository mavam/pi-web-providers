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
    answer: {
      model: "gemini-2.5-flash",
    },
  },
  credentialDefaults: {},
  capabilities: {
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
              thinkingConfig: {
                type: "object",
                properties: {
                  thinkingLevel: {
                    type: "string",
                    enum: ["MINIMAL", "LOW", "MEDIUM", "HIGH"],
                    description: "Model-specific thinking depth.",
                  },
                  thinkingBudget: {
                    type: "integer",
                    minimum: -1,
                    description:
                      "Legacy thinking budget; -1 automatic, 0 disabled. Not supported by newer models that require thinkingLevel.",
                  },
                  includeThoughts: {
                    type: "boolean",
                    description: "Include available thought summaries.",
                  },
                },
                description:
                  "Generate-content thinking settings; choose controls supported by the selected model.",
              },
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
