import { defineProvider } from "../definition.js";

export const tavilyProvider = defineProvider({
  id: "tavily",
  label: "Tavily",
  docsUrl: "https://docs.tavily.com/sdk/javascript/reference",
  local: false,
  credentials: [
    {
      name: "api",
      environmentVariable: "TAVILY_API_KEY",
    },
  ],
  fields: ["credentials", "baseUrl", "options"],
  defaults: {
    search: {
      includeFavicon: true,
    },
    contents: {
      format: "markdown",
      includeFavicon: true,
    },
  },
  credentialDefaults: {},
  capabilities: {
    search: {
      options: {
        type: "object",
        properties: {
          topic: {
            anyOf: [
              {
                type: "string",
                const: "general",
              },
              {
                type: "string",
                const: "news",
              },
              {
                type: "string",
                const: "finance",
              },
            ],
            description:
              "Category of the search query. Use 'news' for recent journalism or current events, 'finance' for markets or company financial data, and 'general' for broad web search.",
          },
          searchDepth: {
            anyOf: [
              {
                type: "string",
                const: "basic",
              },
              { type: "string", const: "advanced" },
              { type: "string", const: "fast" },
              { type: "string", const: "ultra-fast" },
            ],
            description:
              "Depth of the search. 'advanced' is slower but more thorough.",
          },
          timeRange: {
            type: "string",
            enum: ["year", "month", "week", "day", "y", "m", "w", "d"],
            description: "Named time range filter.",
          },
          startDate: {
            type: "string",
            description: "Earliest result date (YYYY-MM-DD).",
          },
          endDate: {
            type: "string",
            description: "Latest result date (YYYY-MM-DD).",
          },
          chunksPerSource: {
            type: "integer",
            minimum: 1,
            maximum: 3,
            description: "Chunks per source for advanced search.",
          },
          autoParameters: {
            type: "boolean",
            description:
              "Let Tavily choose retrieval parameters; may increase cost.",
          },
          country: {
            type: "string",
            description: "Country hint for search results.",
          },
          exactMatch: {
            type: "boolean",
            description: "Prefer exact matches.",
          },
          includeAnswer: {
            anyOf: [
              { type: "boolean" },
              { type: "string", enum: ["basic", "advanced"] },
            ],
            description: "Include a short AI-generated answer.",
          },
          includeRawContent: {
            anyOf: [
              { type: "boolean", const: false },
              { type: "string", enum: ["markdown", "text"] },
            ],
            description:
              "Return raw page content as markdown or text, or disable it with false.",
          },
          includeImages: {
            type: "boolean",
            description: "Include related images.",
          },
          includeFavicon: {
            type: "boolean",
            description: "Include favicon URLs.",
          },
          includeDomains: {
            type: "array",
            items: {
              type: "string",
            },
            description: "Restrict results to these domains.",
          },
          excludeDomains: {
            type: "array",
            items: {
              type: "string",
            },
            description: "Exclude these domains from results.",
          },
          days: {
            type: "integer",
            minimum: 1,
            description: "Limit results to the last N days.",
          },
        },
        description: "Tavily search options.",
      },
      promptGuidelines: [
        "Use Tavily topic='news' for recent journalism or current events and topic='finance' for market or company-finance research; otherwise leave topic as general.",
        "Use searchDepth='advanced' for broader or higher-recall source discovery, and 'basic' for quick direct lookups.",
        "Set timeRange, days, or country when the user asks for freshness, recency, or geography-specific results.",
        "Set includeRawContent or includeAnswer only when the search response itself should carry more context; prefer web_contents for selected source inspection.",
      ],
      retrySafe: true,
    },
    contents: {
      options: {
        type: "object",
        properties: {
          extractDepth: {
            type: "string",
            enum: ["basic", "advanced"],
            description: "Depth setting for extraction.",
          },
          timeout: {
            type: "number",
            minimum: 1,
            maximum: 60,
            description: "Extraction timeout in seconds.",
          },
          format: {
            anyOf: [
              {
                type: "string",
                const: "markdown",
              },
              {
                type: "string",
                const: "text",
              },
            ],
            description: "Output format for extracted content.",
          },
          includeImages: {
            type: "boolean",
            description: "Include extracted images.",
          },
          query: {
            type: "string",
            description: "Optional query to focus extraction.",
          },
          chunksPerSource: {
            type: "integer",
            minimum: 1,
            maximum: 5,
            description: "Maximum chunks per source (1–5). Used with query.",
          },
          includeFavicon: {
            type: "boolean",
            description: "Include favicon URLs.",
          },
        },
        description: "Tavily extract options.",
      },
      retrySafe: true,
    },
  },
  load: async () => (await import("./adapter.js")).adapter,
});
