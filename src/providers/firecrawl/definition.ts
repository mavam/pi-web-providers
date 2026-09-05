import { defineProvider } from "../definition.js";

export const firecrawlProvider = defineProvider({
  id: "firecrawl",
  label: "Firecrawl",
  docsUrl: "https://docs.firecrawl.dev/sdks/node",
  local: false,
  credentials: [
    {
      name: "api",
      environmentVariable: "FIRECRAWL_API_KEY",
      optional: true,
    },
  ],
  fields: ["credentials", "baseUrl", "options"],
  defaults: {
    contents: {
      formats: ["markdown"],
      onlyMainContent: true,
    },
  },
  credentialDefaults: {},
  capabilities: {
    search: {
      options: {
        type: "object",
        properties: {
          lang: {
            type: "string",
            description: "Language code for search results (for example 'en').",
          },
          country: {
            type: "string",
            description: "Country code for search results (for example 'us').",
          },
          sources: {
            type: "array",
            items: {
              type: "string",
            },
            description: "Search source groups to include.",
          },
          categories: {
            type: "array",
            items: {
              type: "string",
            },
            description: "Search categories to include.",
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
          tbs: {
            type: "string",
            description: "Google-style time-based search filter.",
          },
          ignoreInvalidURLs: {
            type: "boolean",
            description: "Ignore invalid result URLs returned by search.",
          },
          location: {
            type: "object",
            properties: {
              country: {
                type: "string",
                description: "Country hint.",
              },
              region: {
                type: "string",
                description: "Region hint.",
              },
              city: {
                type: "string",
                description: "City hint.",
              },
            },
            description: "Location hint for search.",
          },
          timeout: {
            type: "integer",
            minimum: 0,
            description: "Request timeout in milliseconds.",
          },
          scrapeOptions: {
            type: "object",
            properties: {
              formats: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "string",
                      const: "markdown",
                    },
                    {
                      type: "string",
                      const: "html",
                    },
                    {
                      type: "string",
                      const: "rawHtml",
                    },
                    {
                      type: "string",
                      const: "links",
                    },
                    {
                      type: "string",
                      const: "images",
                    },
                    {
                      type: "string",
                      const: "screenshot",
                    },
                    {
                      type: "string",
                      const: "summary",
                    },
                    {
                      type: "string",
                      const: "json",
                    },
                    {
                      type: "string",
                      const: "attributes",
                    },
                  ],
                },
                description: "Output formats.",
              },
              onlyMainContent: {
                type: "boolean",
                description: "Extract only the main content.",
              },
            },
            description: "Options for scraping each search result.",
          },
        },
        description: "Firecrawl search options.",
      },
      promptGuidelines: [
        "Use Firecrawl search when the task benefits from searchable results that can also include scraped page content through scrapeOptions.",
        "Set scrapeOptions.formats=['markdown'] and onlyMainContent=true when source snippets are not enough and the user needs extracted page context in the search results.",
        "Use includeDomains/excludeDomains when search should stay within or avoid specific sites.",
        "Use lang, country, or location when the user asks for language-specific, country-specific, or local results.",
        "Prefer web_contents with Firecrawl scrape options after search when only a small set of known URLs needs full extraction.",
      ],
      retrySafe: true,
    },
    contents: {
      options: {
        type: "object",
        properties: {
          formats: {
            type: "array",
            items: {
              anyOf: [
                {
                  type: "string",
                  const: "markdown",
                },
                {
                  type: "string",
                  const: "html",
                },
                {
                  type: "string",
                  const: "rawHtml",
                },
                {
                  type: "string",
                  const: "links",
                },
                {
                  type: "string",
                  const: "images",
                },
                {
                  type: "string",
                  const: "screenshot",
                },
                {
                  type: "string",
                  const: "summary",
                },
                {
                  type: "string",
                  const: "json",
                },
                {
                  type: "string",
                  const: "attributes",
                },
                {
                  type: "string",
                  const: "changeTracking",
                },
              ],
            },
            description: "Output formats for scraping.",
          },
          timeout: {
            type: "integer",
            minimum: 0,
            description: "Request timeout in milliseconds.",
          },
          onlyMainContent: {
            type: "boolean",
            description: "Extract only the main content.",
          },
          includeTags: {
            type: "array",
            items: {
              type: "string",
            },
            description: "CSS selectors to include.",
          },
          excludeTags: {
            type: "array",
            items: {
              type: "string",
            },
            description: "CSS selectors to exclude.",
          },
          waitFor: {
            type: "integer",
            minimum: 0,
            description: "Milliseconds to wait before scraping.",
          },
          headers: {
            type: "object",
            patternProperties: {
              "^.*$": {
                type: "string",
              },
            },
            description: "Headers to send when scraping.",
          },
          location: {
            type: "object",
            properties: {
              country: {
                type: "string",
                description: "Country hint.",
              },
              region: {
                type: "string",
                description: "Region hint.",
              },
              city: {
                type: "string",
                description: "City hint.",
              },
            },
            description: "Location hint for scraping.",
          },
          mobile: {
            type: "boolean",
            description: "Use a mobile browser profile.",
          },
          proxy: {
            type: "string",
            description: "Proxy mode passed through to the Firecrawl SDK.",
          },
          fastMode: {
            type: "boolean",
            description: "Use Firecrawl fast mode.",
          },
          blockAds: {
            type: "boolean",
            description: "Block ads while scraping.",
          },
          removeBase64Images: {
            type: "boolean",
            description: "Remove base64 image data from scraped output.",
          },
          redactPII: {
            anyOf: [
              {
                type: "boolean",
              },
              {
                type: "object",
                properties: {
                  entities: {
                    type: "array",
                    items: {
                      anyOf: [
                        {
                          type: "string",
                          const: "PERSON",
                        },
                        {
                          type: "string",
                          const: "EMAIL",
                        },
                        {
                          type: "string",
                          const: "PHONE",
                        },
                        {
                          type: "string",
                          const: "LOCATION",
                        },
                        {
                          type: "string",
                          const: "FINANCIAL",
                        },
                        {
                          type: "string",
                          const: "SECRET",
                        },
                      ],
                    },
                  },
                },
                additionalProperties: false,
              },
            ],
            description: "Redact personal or sensitive data from output.",
          },
          maxAge: {
            type: "number",
            description: "Maximum age of cached scrape data in milliseconds.",
          },
          minAge: {
            type: "number",
            description: "Minimum age of cached scrape data in milliseconds.",
          },
          storeInCache: {
            type: "boolean",
            description: "Store scrape result in Firecrawl cache.",
          },
          skipTlsVerification: {
            type: "boolean",
            description: "Skip TLS certificate verification.",
          },
        },
        description: "Firecrawl scrape options.",
      },
      retrySafe: true,
    },
    answer: {
      options: {
        type: "object",
        required: ["url"],
        properties: {
          url: {
            type: "string",
            minLength: 1,
            description: "URL of the page to ask about.",
          },
          onlyMainContent: {
            type: "boolean",
            description: "Extract only the main content.",
          },
          includeTags: {
            type: "array",
            items: {
              type: "string",
            },
            description: "CSS selectors to include.",
          },
          excludeTags: {
            type: "array",
            items: {
              type: "string",
            },
            description: "CSS selectors to exclude.",
          },
          waitFor: {
            type: "integer",
            minimum: 0,
            description: "Milliseconds to wait before scraping.",
          },
          headers: {
            type: "object",
            patternProperties: {
              "^.*$": {
                type: "string",
              },
            },
            description: "Headers to send when scraping.",
          },
          location: {
            type: "object",
            properties: {
              country: {
                type: "string",
                description: "Country hint.",
              },
              region: {
                type: "string",
                description: "Region hint.",
              },
              city: {
                type: "string",
                description: "City hint.",
              },
            },
            description: "Location hint for scraping.",
          },
          mobile: {
            type: "boolean",
            description: "Use a mobile browser profile.",
          },
          proxy: {
            type: "string",
            description: "Proxy mode passed through to the Firecrawl SDK.",
          },
          fastMode: {
            type: "boolean",
            description: "Use Firecrawl fast mode.",
          },
          blockAds: {
            type: "boolean",
            description: "Block ads while scraping.",
          },
          removeBase64Images: {
            type: "boolean",
            description: "Remove base64 image data from scraped output.",
          },
          redactPII: {
            anyOf: [
              {
                type: "boolean",
              },
              {
                type: "object",
                properties: {
                  entities: {
                    type: "array",
                    items: {
                      anyOf: [
                        {
                          type: "string",
                          const: "PERSON",
                        },
                        {
                          type: "string",
                          const: "EMAIL",
                        },
                        {
                          type: "string",
                          const: "PHONE",
                        },
                        {
                          type: "string",
                          const: "LOCATION",
                        },
                        {
                          type: "string",
                          const: "FINANCIAL",
                        },
                        {
                          type: "string",
                          const: "SECRET",
                        },
                      ],
                    },
                  },
                },
                additionalProperties: false,
              },
            ],
            description: "Redact personal or sensitive data from output.",
          },
          maxAge: {
            type: "number",
            description: "Maximum age of cached scrape data in milliseconds.",
          },
          minAge: {
            type: "number",
            description: "Minimum age of cached scrape data in milliseconds.",
          },
          storeInCache: {
            type: "boolean",
            description: "Store scrape result in Firecrawl cache.",
          },
          skipTlsVerification: {
            type: "boolean",
            description: "Skip TLS certificate verification.",
          },
        },
        description:
          "Firecrawl page-question options. The URL is required; the question comes from the web_answer query.",
      },
      promptGuidelines: [
        "Firecrawl web_answer is page-scoped: set options.url to the specific page URL to ask about.",
        "Do not use Firecrawl web_answer for general multi-source answers; use web_search plus web_contents or web_research instead.",
      ],
      retrySafe: false,
    },
  },
  load: async () => (await import("./adapter.js")).adapter,
});
