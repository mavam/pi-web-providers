import { defineProvider } from "../definition.js";

const toolControl = {
  anyOf: [
    { type: "boolean" },
    {
      type: "object",
      properties: {
        enabled: { type: "boolean" },
        max_calls: {
          type: "integer",
          minimum: 0,
          description: "Lower the tool's call limit; 0 disables it.",
        },
      },
      additionalProperties: false,
    },
  ],
};

export const valyuProvider = defineProvider({
  id: "valyu",
  label: "Valyu",
  docsUrl: "https://docs.valyu.ai/sdk/typescript-sdk",
  local: false,
  credentials: [
    {
      name: "api",
      environmentVariable: "VALYU_API_KEY",
    },
  ],
  fields: ["credentials", "baseUrl", "options"],
  defaults: {
    search: {
      searchType: "all",
      responseLength: "short",
    },
  },
  credentialDefaults: {},
  capabilities: {
    search: {
      options: {
        type: "object",
        properties: {
          searchType: {
            anyOf: [
              {
                type: "string",
                const: "all",
              },
              {
                type: "string",
                const: "web",
              },
              {
                type: "string",
                const: "proprietary",
              },
              {
                type: "string",
                const: "news",
              },
            ],
            description:
              "Valyu search type. Use 'news' for recent journalism or current events, 'web' for public web results, 'proprietary' for Valyu proprietary sources, and 'all' when both public and proprietary sources are useful.",
          },
          responseLength: {
            anyOf: [
              {
                type: "string",
                const: "short",
              },
              {
                type: "string",
                const: "medium",
              },
              {
                type: "string",
                const: "large",
              },
              {
                type: "string",
                const: "max",
              },
            ],
            description: "Response length.",
          },
          countryCode: {
            type: "string",
            description: "Country code to scope search results.",
          },
          maxPrice: {
            type: "number",
            minimum: 0,
            description: "Maximum price per thousand characters (CPM).",
          },
          relevanceThreshold: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description: "Minimum result relevance score.",
          },
          includedSources: {
            type: "array",
            items: {
              type: "string",
            },
            description: "Restrict retrieval to these Valyu sources.",
          },
          excludeSources: {
            type: "array",
            items: {
              type: "string",
            },
            description: "Exclude these Valyu sources.",
          },
          sourceBiases: {
            type: "object",
            patternProperties: {
              "^.*$": {
                type: "number",
              },
            },
            description: "Per-source relevance bias weights.",
          },
          category: {
            type: "string",
            description: "Valyu source category to search.",
          },
          startDate: {
            type: "string",
            description: "ISO date string for earliest result date.",
          },
          endDate: {
            type: "string",
            description: "ISO date string for latest result date.",
          },
          historicalCache: {
            type: "boolean",
            description: "Allow Valyu historical cache usage when supported.",
          },
          fastMode: {
            type: "boolean",
            description: "Use Valyu fast mode when lower latency is preferred.",
          },
          urlOnly: {
            type: "boolean",
            description: "Return URL-focused results with less content.",
          },
          instructions: {
            type: "string",
            description:
              "Provider instructions for retrieval and result selection.",
          },
        },
        description: "Valyu search options.",
      },
      promptGuidelines: [
        "Use Valyu searchType='news' for recent journalism or current events, 'web' for public web results, and 'proprietary' when proprietary Valyu sources are required.",
        "Use includedSources, excludeSources, category, or source biases from configuration when the user asks for source-specific retrieval.",
        "Use startDate/endDate and countryCode when the task requires temporal or geographic scoping.",
        "Set responseLength higher only when search results need richer inline context; otherwise prefer concise results and follow up with web_contents.",
      ],
      retrySafe: true,
    },
    contents: {
      options: {
        type: "object",
        properties: {
          summary: {
            anyOf: [
              {
                type: "boolean",
              },
              {
                type: "string",
              },
              {
                type: "object",
                patternProperties: {
                  "^.*$": {},
                },
              },
            ],
            description:
              "Whether to include a summary, or instructions for the summary.",
          },
          extractEffort: {
            anyOf: [
              {
                type: "string",
                const: "normal",
              },
              {
                type: "string",
                const: "high",
              },
              {
                type: "string",
                const: "auto",
              },
            ],
            description:
              "Extraction effort. Use 'high' for difficult pages and 'normal' for faster extraction.",
          },
          responseLength: {
            anyOf: [
              {
                anyOf: [
                  {
                    type: "string",
                    const: "short",
                  },
                  {
                    type: "string",
                    const: "medium",
                  },
                  {
                    type: "string",
                    const: "large",
                  },
                  {
                    type: "string",
                    const: "max",
                  },
                ],
              },
              {
                type: "number",
                minimum: 0,
              },
            ],
            description: "Content response length.",
          },
          maxPriceDollars: {
            type: "number",
            minimum: 0,
            description: "Maximum extraction cost in USD.",
          },
          screenshot: {
            type: "boolean",
            description: "Include screenshot capture when supported.",
          },
          startDate: {
            type: "string",
            description: "ISO date string for earliest content date.",
          },
          endDate: {
            type: "string",
            description: "ISO date string for latest content date.",
          },
          historicalCache: {
            type: "boolean",
            description: "Allow Valyu historical cache usage when supported.",
          },
        },
        description: "Valyu contents options.",
      },
      retrySafe: false,
    },
    answer: {
      options: {
        type: "object",
        properties: {
          structuredOutput: {
            type: "object",
            patternProperties: {
              "^.*$": {},
            },
            description: "JSON schema-like structured output specification.",
          },
          systemInstructions: {
            type: "string",
            description:
              "System instructions that guide Valyu answer generation.",
          },
          searchType: {
            anyOf: [
              {
                type: "string",
                const: "all",
              },
              {
                type: "string",
                const: "web",
              },
              {
                type: "string",
                const: "proprietary",
              },
              {
                type: "string",
                const: "news",
              },
            ],
            description: "Valyu search type for answer grounding.",
          },
          dataMaxPrice: {
            type: "number",
            minimum: 0,
            description: "Maximum data retrieval price for answer grounding.",
          },
          countryCode: {
            type: "string",
            description: "Country code to scope answer results.",
          },
          includedSources: {
            type: "array",
            items: {
              type: "string",
            },
            description: "Restrict answer grounding to these Valyu sources.",
          },
          excludedSources: {
            type: "array",
            items: {
              type: "string",
            },
            description: "Exclude these Valyu sources from answer grounding.",
          },
          startDate: {
            type: "string",
            description: "ISO date string for earliest source date.",
          },
          endDate: {
            type: "string",
            description: "ISO date string for latest source date.",
          },
          fastMode: {
            type: "boolean",
            description: "Use Valyu fast mode when lower latency is preferred.",
          },
        },
        description: "Valyu answer options.",
      },
      retrySafe: false,
    },
    research: {
      options: {
        type: "object",
        properties: {
          mode: {
            anyOf: [
              {
                type: "string",
                const: "fast",
              },
              {
                type: "string",
                const: "standard",
              },
              {
                type: "string",
                const: "lite",
              },
              {
                type: "string",
                const: "heavy",
              },
              {
                type: "string",
                const: "max",
              },
            ],
            description: "Valyu deep research mode.",
          },
          outputFormats: {
            type: "array",
            items: {
              anyOf: [
                {
                  anyOf: [
                    {
                      type: "string",
                      const: "markdown",
                    },
                    {
                      type: "string",
                      const: "pdf",
                    },
                    {
                      type: "string",
                      const: "toon",
                    },
                  ],
                },
                {
                  type: "object",
                  patternProperties: {
                    "^.*$": {},
                  },
                },
              ],
            },
            description: "Requested Valyu research output formats.",
          },
          search: {
            type: "object",
            properties: {
              searchType: {
                anyOf: [
                  {
                    type: "string",
                    const: "all",
                  },
                  {
                    type: "string",
                    const: "web",
                  },
                  {
                    type: "string",
                    const: "proprietary",
                  },
                ],
                description: "Valyu source pool for research.",
              },
              includedSources: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              excludedSources: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              sourceBiases: {
                type: "object",
                patternProperties: {
                  "^.*$": {
                    type: "number",
                  },
                },
              },
              startDate: {
                type: "string",
              },
              endDate: {
                type: "string",
              },
              historicalCache: {
                type: "boolean",
              },
              category: {
                type: "string",
              },
              countryCode: {
                type: "string",
              },
            },
            additionalProperties: false,
            description: "Valyu deep research search configuration.",
          },
          tools: {
            type: "object",
            properties: {
              code_execution: toolControl,
              screenshots: toolControl,
              browser_use: toolControl,
              charts: toolControl,
            },
            additionalProperties: false,
            description: "Valyu deep research tool configuration.",
          },
        },
        description: "Valyu research options.",
      },
      retrySafe: false,
    },
  },
  load: async () => (await import("./adapter.js")).adapter,
});
