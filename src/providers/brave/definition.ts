import { defineProvider } from "../definition.js";

export const braveProvider = defineProvider({
  id: "brave",
  label: "Brave",
  docsUrl: "https://api-dashboard.search.brave.com/app/documentation",
  local: false,
  credentials: [
    {
      name: "search",
      environmentVariable: "BRAVE_SEARCH_API_KEY",
      capabilities: ["search"],
    },
    {
      name: "answers",
      environmentVariable: "BRAVE_ANSWERS_API_KEY",
      capabilities: ["answer", "research"],
    },
  ],
  fields: ["credentials", "baseUrl", "options"],
  defaults: {},
  credentialDefaults: {},
  capabilities: {
    search: {
      options: {
        type: "object",
        properties: {
          mode: {
            enum: ["web", "llm_context", "news", "videos", "images", "places"],
            description:
              "Brave search mode. Use 'news' for recent journalism or current events, 'videos' for clips/tutorials, 'images' for visual references, 'places' for local businesses, venues, cafes, restaurants, hotels, shops, or near/in-location searches, and 'llm_context' for retrieval context.",
          },
          common: {
            type: "object",
            properties: {
              country: {
                type: "string",
                description:
                  "Country code used to localize Brave results, for example 'US'.",
              },
              search_lang: {
                type: "string",
                description:
                  "Content language for Brave results, for example 'en'.",
              },
              ui_lang: {
                type: "string",
                description:
                  "UI language for response metadata, for example 'en-US'.",
              },
            },
            description:
              "Common Brave query options merged into the selected mode's options.",
          },
          web: {
            type: "object",
            properties: {
              country: {
                type: "string",
                description:
                  "Country code used to localize Brave results, for example 'US'.",
              },
              search_lang: {
                type: "string",
                description:
                  "Content language for Brave results, for example 'en'.",
              },
              ui_lang: {
                type: "string",
                description:
                  "UI language for response metadata, for example 'en-US'.",
              },
              freshness: {
                type: "string",
                description:
                  "Freshness filter such as 'pd' (24h), 'pw' (7d), 'pm' (31d), 'py' (year), or a Brave date range.",
              },
              safesearch: {
                enum: ["off", "moderate", "strict"],
                description: "Safe-search filtering level.",
              },
              spellcheck: {
                type: "boolean",
                description: "Whether Brave may spellcheck the query.",
              },
              goggles: {
                type: "string",
                description: "Brave Goggles URL or inline definition.",
              },
              extra_snippets: {
                type: "boolean",
                description: "Whether to ask Brave for extra snippets.",
              },
              offset: {
                type: "integer",
                minimum: 0,
                description: "Brave result page offset for paginated requests.",
              },
              enable_rich_callback: {
                type: "boolean",
                description: "Whether to enable Brave rich callback metadata.",
              },
            },
            description: "Options for Brave Web Search mode.",
          },
          llmContext: {
            type: "object",
            properties: {
              count: {
                type: "integer",
                minimum: 1,
                maximum: 50,
                description:
                  "Mode-specific result count override. Prefer top-level maxResults unless Brave-specific pagination is needed.",
              },
              maximum_number_of_urls: {
                type: "integer",
                minimum: 1,
                description: "Maximum source URLs.",
              },
              maximum_number_of_tokens: {
                type: "integer",
                minimum: 1,
                description: "Maximum context tokens.",
              },
              maximum_number_of_snippets: {
                type: "integer",
                minimum: 1,
                description: "Maximum snippets.",
              },
              maximum_number_of_tokens_per_url: {
                type: "integer",
                minimum: 1,
                description: "Maximum context tokens per URL.",
              },
              maximum_number_of_snippets_per_url: {
                type: "integer",
                minimum: 1,
                description: "Maximum snippets per URL.",
              },
              context_threshold_mode: {
                type: "string",
                description: "Brave LLM Context threshold mode.",
              },
              enable_local: {
                type: "boolean",
                description: "Whether to include local results.",
              },
              enable_source_metadata: {
                type: "boolean",
                description: "Whether to include source metadata in grounding.",
              },
              country: {
                type: "string",
                description:
                  "Country code used to localize Brave results, for example 'US'.",
              },
              search_lang: {
                type: "string",
                description:
                  "Content language for Brave results, for example 'en'.",
              },
              ui_lang: {
                type: "string",
                description:
                  "UI language for response metadata, for example 'en-US'.",
              },
              freshness: {
                type: "string",
                description:
                  "Freshness filter such as 'pd' (24h), 'pw' (7d), 'pm' (31d), 'py' (year), or a Brave date range.",
              },
              safesearch: {
                enum: ["off", "moderate", "strict"],
                description: "Safe-search filtering level.",
              },
              spellcheck: {
                type: "boolean",
                description: "Whether Brave may spellcheck the query.",
              },
              goggles: {
                type: "string",
                description: "Brave Goggles URL or inline definition.",
              },
            },
            description: "Options for Brave LLM Context mode.",
          },
          news: {
            type: "object",
            properties: {
              country: {
                type: "string",
                description:
                  "Country code used to localize Brave results, for example 'US'.",
              },
              search_lang: {
                type: "string",
                description:
                  "Content language for Brave results, for example 'en'.",
              },
              ui_lang: {
                type: "string",
                description:
                  "UI language for response metadata, for example 'en-US'.",
              },
              freshness: {
                type: "string",
                description:
                  "Freshness filter such as 'pd' (24h), 'pw' (7d), 'pm' (31d), 'py' (year), or a Brave date range.",
              },
              safesearch: {
                enum: ["off", "moderate", "strict"],
                description: "Safe-search filtering level.",
              },
              spellcheck: {
                type: "boolean",
                description: "Whether Brave may spellcheck the query.",
              },
              goggles: {
                type: "string",
                description: "Brave Goggles URL or inline definition.",
              },
              extra_snippets: {
                type: "boolean",
                description: "Whether to ask Brave for extra snippets.",
              },
              offset: {
                type: "integer",
                minimum: 0,
                description: "Brave result page offset for paginated requests.",
              },
              count: {
                type: "integer",
                minimum: 1,
                maximum: 50,
                description:
                  "Mode-specific result count override. Prefer top-level maxResults unless Brave-specific pagination is needed.",
              },
            },
            description: "Options for Brave News Search mode.",
          },
          videos: {
            type: "object",
            properties: {
              country: {
                type: "string",
                description:
                  "Country code used to localize Brave results, for example 'US'.",
              },
              search_lang: {
                type: "string",
                description:
                  "Content language for Brave results, for example 'en'.",
              },
              ui_lang: {
                type: "string",
                description:
                  "UI language for response metadata, for example 'en-US'.",
              },
              freshness: {
                type: "string",
                description:
                  "Freshness filter such as 'pd' (24h), 'pw' (7d), 'pm' (31d), 'py' (year), or a Brave date range.",
              },
              safesearch: {
                enum: ["off", "moderate", "strict"],
                description: "Safe-search filtering level.",
              },
              spellcheck: {
                type: "boolean",
                description: "Whether Brave may spellcheck the query.",
              },
              offset: {
                type: "integer",
                minimum: 0,
                description: "Brave result page offset for paginated requests.",
              },
              count: {
                type: "integer",
                minimum: 1,
                maximum: 50,
                description:
                  "Mode-specific result count override. Prefer top-level maxResults unless Brave-specific pagination is needed.",
              },
            },
            description: "Options for Brave Video Search mode.",
          },
          images: {
            type: "object",
            properties: {
              country: {
                type: "string",
                description:
                  "Country code used to localize Brave results, for example 'US'.",
              },
              search_lang: {
                type: "string",
                description:
                  "Content language for Brave results, for example 'en'.",
              },
              ui_lang: {
                type: "string",
                description:
                  "UI language for response metadata, for example 'en-US'.",
              },
              safesearch: {
                enum: ["off", "moderate", "strict"],
                description: "Safe-search filtering level.",
              },
              spellcheck: {
                type: "boolean",
                description: "Whether Brave may spellcheck the query.",
              },
              count: {
                type: "integer",
                minimum: 1,
                maximum: 50,
                description:
                  "Mode-specific result count override. Prefer top-level maxResults unless Brave-specific pagination is needed.",
              },
            },
            description: "Options for Brave Image Search mode.",
          },
          places: {
            type: "object",
            properties: {
              country: {
                type: "string",
                description:
                  "Country code used to localize Brave results, for example 'US'.",
              },
              search_lang: {
                type: "string",
                description:
                  "Content language for Brave results, for example 'en'.",
              },
              ui_lang: {
                type: "string",
                description:
                  "UI language for response metadata, for example 'en-US'.",
              },
              latitude: {
                type: "number",
                description: "Latitude for local place search.",
              },
              longitude: {
                type: "number",
                description: "Longitude for local place search.",
              },
              location: {
                type: "string",
                description:
                  "Human-readable local search location, e.g. 'Eppendorf, Hamburg, Germany'. Use with mode='places' for neighborhood or near-me style searches.",
              },
              radius: {
                type: "number",
                description: "Local search radius.",
              },
              units: {
                type: "string",
                description: "Distance units for local search.",
              },
              safesearch: {
                enum: ["off", "moderate", "strict"],
                description: "Safe-search filtering level.",
              },
              spellcheck: {
                type: "boolean",
                description: "Whether Brave may spellcheck the query.",
              },
              geoloc: {
                type: "string",
                description:
                  "Optional geolocation token used to refine results.",
              },
              count: {
                type: "integer",
                minimum: 1,
                maximum: 50,
                description:
                  "Mode-specific result count override. Prefer top-level maxResults unless Brave-specific pagination is needed.",
              },
              includeDetails: {
                type: "boolean",
                description:
                  "Places mode only. Fetch detailed POI metadata when the task needs contact info, opening hours, ratings/review counts, photos, profiles, or richer address/distance data. Leave off for simple place listings to avoid extra latency and quota usage.",
              },
              includeDescriptions: {
                type: "boolean",
                description:
                  "Places mode only. Fetch AI-generated POI descriptions when the task needs qualitative summaries or short explanations of places. Leave off for simple nearby/place listing queries to avoid extra latency and quota usage.",
              },
            },
            description: "Options for Brave Local Place Search mode.",
          },
        },
        description: "Brave search options.",
      },
      promptGuidelines: [
        "Use Brave places mode for direct point-of-interest listings such as restaurants, cafes, hotels, shops, landmarks, or venues.",
        "Prefer Brave places mode over llm_context when the user asks for nearby businesses or wants names, addresses, ratings, opening hours, categories, or contact details.",
        "In Brave places mode, set places.includeDetails when the task needs POI attributes beyond the basic result list, such as contact info, opening hours, ratings/review counts, photos, profiles, or richer address/distance metadata.",
        "In Brave places mode, set places.includeDescriptions when the task needs qualitative summaries or short explanations of places. Leave it off for simple nearby/place listing queries to avoid extra latency and quota usage.",
        "Use Brave llm_context mode when the agent needs extracted source context for reasoning, synthesis, RAG-style grounding, or source-material collection.",
        "In Brave llm_context mode, set llmContext.enable_local=true for local or near-me queries where POI/map grounding may be useful.",
      ],
      retrySafe: true,
    },
    answer: {
      options: {
        type: "object",
        properties: {
          model: {
            enum: ["brave", "brave-pro"],
            description: "Brave Answers model. Defaults to 'brave'.",
          },
          country: {
            type: "string",
          },
          language: {
            type: "string",
          },
          safesearch: {
            enum: ["off", "moderate", "strict"],
            description: "Safe-search filtering level.",
          },
          enable_citations: {
            type: "boolean",
          },
          enable_entities: {
            type: "boolean",
          },
          max_completion_tokens: {
            type: "integer",
            minimum: 1,
          },
        },
        description: "Brave answer options.",
      },
      retrySafe: false,
    },
    research: {
      options: {
        type: "object",
        properties: {
          model: {
            enum: ["brave", "brave-pro"],
            description: "Brave Answers model. Defaults to 'brave'.",
          },
          country: {
            type: "string",
          },
          language: {
            type: "string",
          },
          safesearch: {
            enum: ["off", "moderate", "strict"],
            description: "Safe-search filtering level.",
          },
          enable_entities: {
            type: "boolean",
          },
          enable_citations: {
            type: "boolean",
            description:
              "Accepted for compatibility but forced to false for Brave research mode.",
          },
          max_completion_tokens: {
            type: "integer",
            minimum: 1,
          },
          research_allow_thinking: {
            type: "boolean",
          },
          research_maximum_number_of_tokens_per_query: {
            type: "integer",
            minimum: 1,
          },
          research_maximum_number_of_queries: {
            type: "integer",
            minimum: 1,
          },
          research_maximum_number_of_iterations: {
            type: "integer",
            minimum: 1,
          },
          research_maximum_number_of_seconds: {
            type: "integer",
            minimum: 1,
          },
          research_maximum_number_of_results_per_query: {
            type: "integer",
            minimum: 1,
          },
        },
        description: "Brave research options.",
      },
      retrySafe: false,
    },
  },
  load: async () => (await import("./adapter.js")).adapter,
});
