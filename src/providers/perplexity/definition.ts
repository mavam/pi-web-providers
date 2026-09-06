import { defineProvider } from "../definition.js";

const searchControls = {
  country: { type: "string", description: "Two-letter country hint." },
  search_mode: {
    type: "string",
    enum: ["web", "academic", "sec"],
    description: "Search source pool.",
  },
  search_domain_filter: {
    type: "array",
    items: { type: "string" },
    description: "Domain filters; prefix excluded domains with '-'.",
  },
  search_language_filter: {
    type: "array",
    items: { type: "string" },
    description: "Result languages.",
  },
  search_recency_filter: {
    type: "string",
    enum: ["hour", "day", "week", "month", "year"],
    description: "Result recency.",
  },
  search_after_date_filter: {
    type: "string",
    description: "Earliest publication date (MM/DD/YYYY).",
  },
  search_before_date_filter: {
    type: "string",
    description: "Latest publication date (MM/DD/YYYY).",
  },
  last_updated_after_filter: {
    type: "string",
    description: "Earliest update date (MM/DD/YYYY).",
  },
  last_updated_before_filter: {
    type: "string",
    description: "Latest update date (MM/DD/YYYY).",
  },
};
const contextSize = {
  type: "string",
  enum: ["low", "medium", "high"],
  description: "Amount of search context.",
};
const chatOptions = {
  type: "object",
  properties: {
    ...searchControls,
    model: { type: "string", description: "Perplexity model override." },
    max_tokens: {
      type: "integer",
      minimum: 1,
      description: "Maximum generated tokens.",
    },
    reasoning_effort: {
      type: "string",
      enum: ["minimal", "low", "medium", "high"],
      description: "Reasoning effort, where supported by the selected model.",
    },
    temperature: {
      type: "number",
      minimum: 0,
      maximum: 2,
      description: "Sampling temperature, where supported by the model.",
    },
    web_search_options: {
      type: "object",
      properties: {
        search_context_size: contextSize,
      },
      description:
        "Sonar web retrieval controls; distinct from standalone search options.",
    },
  },
  description: "Perplexity grounded generation options.",
};
export const perplexityProvider = defineProvider({
  id: "perplexity",
  label: "Perplexity",
  docsUrl: "https://docs.perplexity.ai/docs/sdk/overview",
  local: false,
  credentials: [{ name: "api", environmentVariable: "PERPLEXITY_API_KEY" }],
  fields: ["credentials", "baseUrl", "options"],
  defaults: {
    answer: { model: "sonar" },
    research: { model: "sonar-deep-research" },
  },
  credentialDefaults: {},
  capabilities: {
    search: {
      options: {
        type: "object",
        properties: {
          ...searchControls,
          search_context_size: contextSize,
          max_tokens: {
            type: "integer",
            minimum: 1,
            description: "Total search content token budget.",
          },
          max_tokens_per_page: {
            type: "integer",
            minimum: 1,
            description: "Per-page content token budget.",
          },
        },
        description: "Perplexity search options.",
      },
      promptGuidelines: [
        "Use Perplexity search for concise source retrieval, not synthesized answers.",
        "Use search_recency_filter for freshness and search_domain_filter for domain-scoped retrieval.",
        "Use web_answer or web_research with Perplexity when synthesis is needed. Search content budgets are not generation budgets.",
      ],
      retrySafe: true,
    },
    answer: { options: chatOptions, retrySafe: false },
    research: { options: chatOptions, retrySafe: false },
  },
  load: async () => (await import("./adapter.js")).adapter,
});
