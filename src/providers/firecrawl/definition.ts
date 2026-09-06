import { defineProvider } from "../definition.js";

const strings = { type: "array", items: { type: "string" } };
const formats = {
  type: "array",
  items: {
    type: "string",
    enum: [
      "markdown",
      "html",
      "rawHtml",
      "links",
      "images",
      "screenshot",
      "summary",
      "json",
      "attributes",
      "changeTracking",
    ],
  },
  description: "Output formats for scraping.",
};
const scrapeProperties = {
  timeout: {
    type: "integer",
    minimum: 1,
    description: "Request timeout in milliseconds.",
  },
  onlyMainContent: {
    type: "boolean",
    description: "Extract only the main content.",
  },
  includeTags: { ...strings, description: "CSS selectors to include." },
  excludeTags: { ...strings, description: "CSS selectors to exclude." },
  waitFor: {
    type: "integer",
    minimum: 0,
    description: "Milliseconds to wait before scraping.",
  },
  headers: {
    type: "object",
    patternProperties: { "^.*$": { type: "string" } },
    description: "Headers to send when scraping.",
  },
  location: {
    type: "object",
    properties: {
      country: { type: "string", description: "Country code." },
      languages: { ...strings, description: "Preferred languages." },
    },
    description: "Scrape location; unlike search location, this is an object.",
  },
  mobile: { type: "boolean", description: "Use a mobile browser profile." },
  proxy: {
    type: "string",
    description: "Proxy mode supported by your Firecrawl deployment.",
  },
  fastMode: { type: "boolean", description: "Use Firecrawl fast mode." },
  blockAds: { type: "boolean", description: "Block ads while scraping." },
  removeBase64Images: {
    type: "boolean",
    description: "Remove base64 image data from output.",
  },
  redactPII: {
    anyOf: [
      { type: "boolean" },
      {
        type: "object",
        properties: {
          entities: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "PERSON",
                "EMAIL",
                "PHONE",
                "LOCATION",
                "FINANCIAL",
                "SECRET",
              ],
            },
          },
          mode: { type: "string", enum: ["accurate", "aggressive", "fast"] },
        },
      },
    ],
    description: "Redact personal or sensitive data from output.",
  },
  maxAge: {
    type: "number",
    minimum: 0,
    description: "Maximum cached scrape age in milliseconds; 0 bypasses reuse.",
  },
  minAge: {
    type: "number",
    minimum: 0,
    description: "Minimum cached scrape age in milliseconds.",
  },
  storeInCache: {
    type: "boolean",
    description: "Store the scrape result in cache.",
  },
  skipTlsVerification: {
    type: "boolean",
    description: "Skip TLS certificate verification.",
  },
};

export const firecrawlProvider = defineProvider({
  id: "firecrawl",
  label: "Firecrawl",
  docsUrl: "https://docs.firecrawl.dev/sdks/node",
  local: false,
  credentials: [
    { name: "api", environmentVariable: "FIRECRAWL_API_KEY", optional: true },
  ],
  fields: ["credentials", "baseUrl", "options"],
  defaults: { contents: { formats: ["markdown"], onlyMainContent: true } },
  credentialDefaults: {},
  capabilities: {
    search: {
      options: {
        type: "object",
        properties: {
          sources: {
            type: "array",
            items: { type: "string", enum: ["web", "news", "images"] },
            description: "Search source groups.",
          },
          categories: {
            type: "array",
            items: {
              type: "string",
              enum: ["github", "research", "pdf", "developer"],
            },
            description: "Search categories.",
          },
          includeDomains: {
            ...strings,
            description: "Restrict results to these domains.",
          },
          excludeDomains: { ...strings, description: "Exclude these domains." },
          tbs: {
            type: "string",
            description: "Google-style time-based search filter.",
          },
          ignoreInvalidURLs: {
            type: "boolean",
            description: "Ignore invalid result URLs.",
          },
          location: {
            type: "string",
            description:
              "Search location, for example 'Berlin, Germany'. Not a scrape location object.",
          },
          timeout: scrapeProperties.timeout,
          highlights: {
            type: "boolean",
            description: "Generate query-relevant highlights.",
          },
          scrapeOptions: {
            type: "object",
            properties: { formats, ...scrapeProperties },
            description: "Options for scraping each search result.",
          },
        },
        description: "Firecrawl search options.",
      },
      promptGuidelines: [
        "Use Firecrawl search when results should also include scraped page content through scrapeOptions.",
        "Set options.scrapeOptions.formats=['markdown'] and options.scrapeOptions.onlyMainContent=true for extracted page context.",
        "Use includeDomains/excludeDomains for source constraints. Use location as a string for local search; scraping uses a separate location object with country and languages.",
        "Prefer web_contents after search when only a small set of known URLs needs full extraction.",
      ],
      retrySafe: true,
    },
    contents: {
      options: {
        type: "object",
        properties: { formats, ...scrapeProperties },
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
          ...scrapeProperties,
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
