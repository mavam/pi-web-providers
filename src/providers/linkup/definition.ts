import { defineProvider } from "../definition.js";

export const linkupProvider = defineProvider({
  id: "linkup",
  label: "Linkup",
  docsUrl: "https://docs.linkup.so/pages/sdk/js/js",
  local: false,
  credentials: [
    {
      name: "api",
      environmentVariable: "LINKUP_API_KEY",
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
          depth: {
            anyOf: [
              {
                type: "string",
                const: "standard",
              },
              {
                type: "string",
                const: "deep",
              },
            ],
            description: "Search depth. 'deep' is slower but more thorough.",
          },
          includeImages: {
            type: "boolean",
            description: "Include images in search results.",
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
          fromDate: {
            type: "string",
            description: "ISO date string for earliest result date.",
          },
          toDate: {
            type: "string",
            description: "ISO date string for latest result date.",
          },
        },
        description: "Linkup search options.",
      },
      promptGuidelines: [
        "Use Linkup depth='deep' for exploratory or high-recall source discovery, and 'standard' for quick direct searches.",
        "Use includeDomains or excludeDomains when the user names source constraints or when limiting the search space improves precision.",
        "Use fromDate and toDate when the user asks for recent, historical, or bounded-by-date results.",
        "Enable includeImages only when images are directly useful; otherwise keep search focused on textual source discovery.",
      ],
      retrySafe: true,
    },
    contents: {
      options: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            enum: ["standard", "pro"],
            description:
              "Fetch strategy; pro improves retrieval of difficult pages.",
          },
          includeRawContent: {
            type: "boolean",
            description: "Include raw page content and its content type.",
          },
          renderJs: {
            type: "boolean",
            description: "Render JavaScript before extracting content.",
          },
          includeRawHtml: {
            type: "boolean",
            deprecated: true,
            description: "Legacy raw HTML output. Prefer includeRawContent.",
          },
          extractImages: {
            type: "boolean",
            description: "Extract images from the page.",
          },
        },
        description: "Linkup fetch options.",
      },
      retrySafe: true,
    },
    research: {
      options: {
        type: "object",
        properties: {
          outputType: {
            anyOf: [
              {
                type: "string",
                const: "sourcedAnswer",
              },
              {
                type: "string",
                const: "structured",
              },
            ],
            description:
              "Research output type. Defaults to 'sourcedAnswer' unless structuredOutputSchema is provided.",
          },
          mode: {
            anyOf: [
              {
                type: "string",
                const: "answer",
              },
              {
                type: "string",
                const: "auto",
              },
              {
                type: "string",
                const: "investigate",
              },
              {
                type: "string",
                const: "research",
              },
            ],
            description:
              "Research mode. Use 'answer' for precise verified answers, 'investigate' for focused deep dives, 'research' for broad reports, or omit/auto to let Linkup classify the task.",
          },
          reasoningDepth: {
            anyOf: [
              {
                type: "string",
                const: "S",
              },
              {
                type: "string",
                const: "M",
              },
              {
                type: "string",
                const: "L",
              },
              {
                type: "string",
                const: "XL",
              },
            ],
            description:
              "Reasoning depth. Higher values trade latency for more thorough investigation.",
          },
          includeDomains: {
            type: "array",
            items: {
              type: "string",
            },
            description: "Restrict research to these domains.",
          },
          excludeDomains: {
            type: "array",
            items: {
              type: "string",
            },
            description: "Exclude these domains.",
          },
          fromDate: {
            type: "string",
            description: "ISO date string for earliest result date.",
          },
          toDate: {
            type: "string",
            description: "ISO date string for latest result date.",
          },
          structuredOutputSchema: {
            type: "object",
            patternProperties: {
              "^.*$": {},
            },
            description:
              "JSON schema object required when outputType is 'structured'.",
          },
        },
        description: "Linkup research options.",
      },
      retrySafe: false,
    },
  },
  load: async () => (await import("./adapter.js")).adapter,
});
