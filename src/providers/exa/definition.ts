import { defineProvider } from "../definition.js";

export const exaProvider = defineProvider({
  id: "exa",
  label: "Exa",
  docsUrl: "https://exa.ai/docs/sdks/typescript-sdk-specification",
  local: false,
  credentials: [
    {
      name: "api",
      environmentVariable: "EXA_API_KEY",
    },
  ],
  fields: ["credentials", "baseUrl", "options"],
  defaults: {
    search: {
      type: "auto",
      contents: {
        text: true,
      },
    },
  },
  credentialDefaults: {},
  capabilities: {
    search: {
      options: {
        type: "object",
        properties: {
          type: {
            anyOf: [
              {
                type: "string",
                const: "keyword",
              },
              {
                type: "string",
                const: "neural",
              },
              {
                type: "string",
                const: "auto",
              },
              {
                type: "string",
                const: "hybrid",
              },
              {
                type: "string",
                const: "fast",
              },
              {
                type: "string",
                const: "instant",
              },
              {
                type: "string",
                const: "deep-lite",
              },
              {
                type: "string",
                const: "deep",
              },
              {
                type: "string",
                const: "deep-reasoning",
              },
            ],
            description: "Exa search mode.",
          },
          category: {
            type: "string",
            description:
              "Filter by category (e.g., 'company', 'research paper').",
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
            description: "Exclude these domains.",
          },
          startPublishedDate: {
            type: "string",
            description: "ISO date string for earliest publish date.",
          },
          endPublishedDate: {
            type: "string",
            description: "ISO date string for latest publish date.",
          },
          includeText: {
            type: "array",
            items: {
              type: "string",
            },
            description:
              "Require result page text to contain these terms. Exa currently supports one short phrase.",
          },
          excludeText: {
            type: "array",
            items: {
              type: "string",
            },
            description:
              "Require result page text not to contain these terms. Exa currently supports one short phrase.",
          },
          systemPrompt: {
            type: "string",
            description:
              "Additional Exa instructions for deep search source selection and synthesis.",
          },
          additionalQueries: {
            type: "array",
            items: {
              type: "string",
            },
            maxItems: 5,
            description:
              "Alternative query formulations for Exa deep search variants.",
          },
          userLocation: {
            type: "string",
            description:
              "Two-letter ISO country code for the user location, such as 'US'.",
          },
          contents: {
            type: "object",
            properties: {
              text: {
                anyOf: [
                  {
                    type: "boolean",
                  },
                  {
                    type: "object",
                    properties: {
                      maxCharacters: {
                        type: "integer",
                        minimum: 1,
                        description: "Maximum text characters per result.",
                      },
                      includeHtmlTags: {
                        type: "boolean",
                        description: "Include HTML tags in returned text.",
                      },
                      verbosity: {
                        anyOf: [
                          {
                            type: "string",
                            const: "compact",
                          },
                          {
                            type: "string",
                            const: "standard",
                          },
                          {
                            type: "string",
                            const: "full",
                          },
                        ],
                        description: "Verbosity level for returned text.",
                      },
                    },
                    additionalProperties: false,
                  },
                ],
                description: "Include text content.",
              },
              highlights: {
                anyOf: [
                  {
                    type: "boolean",
                  },
                  {
                    type: "object",
                    properties: {
                      query: {
                        type: "string",
                        description: "Query to use for highlights.",
                      },
                      maxCharacters: {
                        type: "integer",
                        minimum: 1,
                        description: "Maximum highlight characters.",
                      },
                    },
                    additionalProperties: false,
                  },
                ],
                description: "Include highlighted excerpts.",
              },
              summary: {
                anyOf: [
                  {
                    type: "boolean",
                  },
                  {
                    type: "object",
                    properties: {
                      query: {
                        type: "string",
                        description: "Query to guide summary generation.",
                      },
                    },
                    additionalProperties: false,
                  },
                ],
                description: "Include AI-generated summary.",
              },
              livecrawlTimeout: {
                type: "integer",
                minimum: 1,
                maximum: 90_000,
                description:
                  "Content-fetch timeout in milliseconds (1–90000). Does not select a freshness policy.",
              },
              maxAgeHours: {
                type: "integer",
                minimum: -1,
                maximum: 720,
                description:
                  "Content freshness in whole hours: 0 fetches fresh, -1 uses cache only, 1–720 bounds cache age. Omit for fallback fetching. Set only inside options.contents; do not also send deprecated livecrawl.",
              },
              filterEmptyResults: {
                type: "boolean",
                description: "Filter results with no contents.",
              },
              subpages: {
                type: "integer",
                minimum: 0,
                description: "Number of subpages to return for each result.",
              },
              subpageTarget: {
                anyOf: [
                  {
                    type: "string",
                  },
                  {
                    type: "array",
                    items: {
                      type: "string",
                    },
                  },
                ],
                description: "Text used to match/rank returned subpages.",
              },
              extras: {
                type: "object",
                properties: {
                  links: {
                    type: "integer",
                    minimum: 0,
                    description: "Number of page links to include.",
                  },
                  imageLinks: {
                    type: "integer",
                    minimum: 0,
                    description: "Number of image links to include.",
                  },
                },
                additionalProperties: false,
              },
            },
            additionalProperties: false,
            description:
              "Content extraction and freshness controls. Put text, highlights, summary, maxAgeHours, and livecrawlTimeout here, not directly in options.",
          },
        },
        description: "Exa search options.",
      },
      promptGuidelines: [
        "Use Exa's neural/auto search modes for semantic source discovery where exact keywords are uncertain; use keyword mode when exact terms, names, or identifiers matter.",
        "Use Exa category filters such as 'research paper' or 'company' when the user asks for a specific source type.",
        "Set includeDomains or excludeDomains when the task names preferred sources, requires primary sources, or needs noisy domains filtered out.",
        "For fresh Exa search content, use options.contents.maxAgeHours=0; for cache-only retrieval use -1. Never put maxAgeHours at the top level of options.",
        "Do not send deprecated livecrawl, even alongside maxAgeHours. Remove livecrawl rather than moving it into contents. Exa ignores startCrawlDate/endCrawlDate; use startPublishedDate/endPublishedDate to filter publication dates, not cache freshness.",
        "Use includeText/excludeText for short required or forbidden phrases in page text.",
        "Request contents.text, contents.highlights, or contents.summary only when snippets are insufficient and richer source context is needed directly in search results.",
      ],
      retrySafe: true,
    },
    contents: {
      retrySafe: true,
    },
    answer: {
      retrySafe: false,
    },
    research: {
      retrySafe: false,
    },
  },
  load: async () => (await import("./adapter.js")).adapter,
});
