import { defineProvider } from "../definition.js";

export const perplexityProvider = defineProvider({
  id: "perplexity",
  label: "Perplexity",
  docsUrl: "https://docs.perplexity.ai/docs/sdk/overview",
  local: false,
  credentials: [
    {
      name: "api",
      environmentVariable: "PERPLEXITY_API_KEY",
    },
  ],
  fields: ["credentials", "baseUrl", "options"],
  defaults: {
    answer: {
      model: "sonar",
    },
    research: {
      model: "sonar-deep-research",
    },
  },
  credentialDefaults: {},
  capabilities: {
    search: {
      options: {
        type: "object",
        properties: {
          country: {
            type: "string",
            description: "Country hint for search results.",
          },
          search_mode: {
            type: "string",
            description:
              "Perplexity search mode. Choose the provider mode that best matches the user's intent, such as broad web search versus academic or other specialized retrieval modes supported by Perplexity.",
          },
          search_domain_filter: {
            type: "array",
            items: {
              type: "string",
            },
            description: "Restrict search results to these domains.",
          },
          search_recency_filter: {
            type: "string",
            description: "Recency filter for search results.",
          },
        },
        description: "Perplexity search options.",
      },
      promptGuidelines: [
        "Use Perplexity search for concise web result retrieval with recency and domain filters, not for synthesized answers.",
        "Set search_recency_filter when freshness matters, such as breaking news, recently updated documentation, prices, or current events.",
        "Set search_domain_filter when the user asks for primary sources, official documentation, or domain-scoped retrieval.",
        "Use web_answer or web_research with Perplexity when the user wants synthesis rather than a list of candidate sources.",
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
              "Perplexity model to use (for example 'sonar' or 'sonar-pro').",
          },
        },
        description: "Perplexity answer options.",
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
              "Perplexity model to use (for example 'sonar-deep-research').",
          },
        },
        description: "Perplexity research options.",
      },
      retrySafe: false,
    },
  },
  load: async () => (await import("./adapter.js")).adapter,
});
