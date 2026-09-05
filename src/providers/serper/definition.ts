import { defineProvider } from "../definition.js";

export const serperProvider = defineProvider({
  id: "serper",
  label: "Serper",
  docsUrl: "https://serper.dev/",
  local: false,
  credentials: [
    {
      name: "api",
      environmentVariable: "SERPER_API_KEY",
    },
  ],
  fields: ["credentials", "baseUrl", "options"],
  defaults: {
    search: {
      includeMarkdown: true,
    },
  },
  credentialDefaults: {},
  capabilities: {
    search: {
      options: {
        type: "object",
        properties: {
          mode: {
            enum: [
              "search",
              "images",
              "videos",
              "places",
              "maps",
              "reviews",
              "news",
              "shopping",
              "product-reviews",
              "lens",
              "scholar",
              "patents",
              "autocomplete",
              "webpage",
            ],
            description:
              "Serper search type. Use 'search' for web results, 'news' for recent journalism/current events, 'images' for visual references, 'videos' for clips/tutorials, 'places' or 'maps' for local businesses/venues, 'reviews' for Google business reviews by place ID/CID/FID or query, 'shopping' for products, 'product-reviews' for product reviews, 'lens' for reverse image search, 'scholar' for scholarly articles, 'patents' for patents, 'autocomplete' for suggestions, and 'webpage' to scrape a URL.",
          },
          gl: {
            type: "string",
            description:
              "Country code hint for Google results (for example 'us').",
          },
          hl: {
            type: "string",
            description:
              "Language code hint for Google results (for example 'en').",
          },
          location: {
            type: "string",
            description: "Geographic location hint for Google results.",
          },
          page: {
            type: "integer",
            minimum: 1,
            description: "1-based results page to request from Serper.",
          },
          tbs: {
            type: "string",
            description:
              "Google time/date or vertical-specific filter string passed through to Serper, for example 'qdr:d' for past day.",
          },
          autocorrect: {
            type: "boolean",
            description: "Enable or disable Serper query autocorrection.",
          },
          url: {
            type: "string",
            description:
              "URL for modes that need one: image URL for 'lens', or page URL for 'webpage'. Defaults to the query string when omitted.",
          },
          ll: {
            type: "string",
            description:
              "Google Maps latitude/longitude/zoom hint, for example '@40.6973709,-74.1444871,11z'.",
          },
          placeId: {
            type: "string",
            description: "Google place ID for maps or reviews.",
          },
          cid: {
            type: "string",
            description: "Google CID for maps or reviews.",
          },
          fid: {
            type: "string",
            description: "Google FID for reviews.",
          },
          sortBy: {
            type: "string",
            description: "Review sort order for reviews mode.",
          },
          topicId: {
            type: "string",
            description: "Review topic ID for reviews mode.",
          },
          productId: {
            type: "string",
            description:
              "Google product ID for product-reviews mode. Defaults to the query string when omitted.",
          },
          nextPageToken: {
            type: "string",
            description:
              "Pagination token for reviews or product-reviews modes.",
          },
          includeMarkdown: {
            type: "boolean",
            default: true,
            description:
              "Include Markdown content in webpage mode. Defaults to true.",
          },
          includeImages: {
            type: "boolean",
            description: "Include image metadata in webpage mode.",
          },
          includeLinks: {
            type: "boolean",
            description: "Include link metadata in webpage mode.",
          },
          includeVideos: {
            type: "boolean",
            description: "Include video metadata in webpage mode.",
          },
        },
        description: "Serper search options.",
      },
      promptGuidelines: [
        "Use Serper news mode for recent journalism, current events, announcements, or time-sensitive reporting.",
        "Use Serper images or videos mode when the user asks for visual references, screenshots, diagrams, clips, tutorials, or media results.",
        "Use Serper places or maps mode for local businesses, venues, addresses, ratings, phone numbers, opening details, or nearby/in-location searches.",
        "Use Serper reviews mode when the task needs Google business reviews. Prefer cid, fid, or placeId from a maps or places result when available; otherwise use the search query as the place identifier.",
        "Use Serper shopping mode for product listings, prices, merchants, offers, or purchase comparisons, and use product-reviews mode when the task needs reviews for a known product ID.",
        "Use Serper scholar mode for academic papers and patents mode for patent searches.",
        "Use Serper autocomplete mode when the task is to discover search suggestions or query completions rather than source pages.",
        "Use Serper lens mode for reverse image search with an image URL, and use webpage mode to scrape a specific URL. Webpage mode includes Markdown by default.",
      ],
      retrySafe: true,
    },
  },
  load: async () => (await import("./adapter.js")).adapter,
});
