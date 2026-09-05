import { defineProvider } from "../definition.js";

export const openaiProvider = defineProvider({
  id: "openai",
  label: "OpenAI",
  docsUrl: "https://platform.openai.com/docs/guides/deep-research",
  local: false,
  credentials: [
    {
      name: "api",
      environmentVariable: "OPENAI_API_KEY",
    },
  ],
  fields: ["credentials", "baseUrl", "options"],
  defaults: {
    search: {
      model: "gpt-4.1",
    },
    answer: {
      model: "gpt-4.1",
    },
    research: {
      model: "o4-mini-deep-research",
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
              "OpenAI model to use for web search (for example 'gpt-4.1').",
          },
          instructions: {
            type: "string",
            description:
              "Optional instructions that shape source selection and result style.",
          },
          searchContextSize: {
            anyOf: [
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
            ],
            description:
              "Amount of context OpenAI web search should retrieve per search.",
          },
          allowedDomains: {
            type: "array",
            items: {
              type: "string",
            },
            description: "Restrict OpenAI web search to these domains.",
          },
          userLocation: {
            type: "object",
            properties: {
              city: {
                type: "string",
                description: "User city hint.",
              },
              country: {
                type: "string",
                description: "Two-letter user country code.",
              },
              region: {
                type: "string",
                description: "User region hint.",
              },
              timezone: {
                type: "string",
                description: "IANA timezone hint.",
              },
            },
            description: "Approximate user location for OpenAI web search.",
          },
        },
        description: "OpenAI search options.",
      },
      promptGuidelines: [
        "Use OpenAI web search when an LLM-mediated search pass should identify likely sources from the live web.",
        "Use instructions to constrain source selection, freshness, geography, or output style only when the user explicitly needs that control.",
        "Use allowedDomains when the user asks to search only specific sites or primary-source domains.",
        "Use searchContextSize='high' only when the query needs richer source context; use 'low' for quick source discovery.",
        "Use userLocation for local, regional, or jurisdiction-specific searches.",
        "Prefer web_contents after OpenAI search when the task requires direct inspection of selected primary sources.",
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
              "OpenAI model to use for grounded answers (for example 'gpt-4.1').",
          },
          instructions: {
            type: "string",
            description:
              "Optional instructions that shape the answer structure, tone, and source selection.",
          },
          searchContextSize: {
            anyOf: [
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
            ],
            description:
              "Amount of context OpenAI web search should retrieve per search.",
          },
          allowedDomains: {
            type: "array",
            items: {
              type: "string",
            },
            description: "Restrict OpenAI web search to these domains.",
          },
          userLocation: {
            type: "object",
            properties: {
              city: {
                type: "string",
                description: "User city hint.",
              },
              country: {
                type: "string",
                description: "Two-letter user country code.",
              },
              region: {
                type: "string",
                description: "User region hint.",
              },
              timezone: {
                type: "string",
                description: "IANA timezone hint.",
              },
            },
            description: "Approximate user location for OpenAI web search.",
          },
        },
        description: "OpenAI answer options.",
      },
      retrySafe: false,
    },
    research: {
      options: {
        type: "object",
        properties: {
          model: {
            type: "string",
            description:
              "OpenAI deep research model to use (for example 'o4-mini-deep-research').",
          },
          instructions: {
            type: "string",
            description:
              "Optional instructions that shape the report structure, tone, and source selection.",
          },
          max_tool_calls: {
            type: "integer",
            minimum: 1,
            description:
              "Maximum number of built-in tool calls the model may make during the research run.",
          },
          searchContextSize: {
            anyOf: [
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
            ],
            description:
              "Amount of context OpenAI web search should retrieve per search.",
          },
          allowedDomains: {
            type: "array",
            items: {
              type: "string",
            },
            description: "Restrict OpenAI web search to these domains.",
          },
          userLocation: {
            type: "object",
            properties: {
              city: {
                type: "string",
                description: "User city hint.",
              },
              country: {
                type: "string",
                description: "Two-letter user country code.",
              },
              region: {
                type: "string",
                description: "User region hint.",
              },
              timezone: {
                type: "string",
                description: "IANA timezone hint.",
              },
            },
            description: "Approximate user location for OpenAI web search.",
          },
        },
        description: "OpenAI deep research options.",
      },
      retrySafe: false,
    },
  },
  load: async () => (await import("./adapter.js")).adapter,
});
