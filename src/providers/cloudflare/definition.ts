import { defineProvider } from "../definition.js";

export const cloudflareProvider = defineProvider({
  id: "cloudflare",
  label: "Cloudflare",
  docsUrl: "https://developers.cloudflare.com/browser-rendering/",
  local: false,
  credentials: [
    {
      name: "api",
      environmentVariable: "CLOUDFLARE_API_TOKEN",
    },
  ],
  fields: ["credentials", "accountId", "options"],
  defaults: {
    contents: {
      gotoOptions: {
        waitUntil: "networkidle0",
      },
    },
  },
  credentialDefaults: {
    accountId: {
      env: "CLOUDFLARE_ACCOUNT_ID",
    },
  },
  capabilities: {
    contents: {
      options: {
        type: "object",
        properties: {
          cacheTTL: {
            type: "number",
            minimum: 0,
            description: "Cache lifetime in seconds; 0 disables caching.",
          },
          actionTimeout: {
            type: "number",
            minimum: 0,
            description: "Post-navigation action timeout in milliseconds.",
          },
          waitForTimeout: {
            type: "number",
            minimum: 0,
            description: "Milliseconds to wait before extraction.",
          },
          waitForSelector: {
            type: "object",
            required: ["selector"],
            properties: {
              selector: { type: "string", minLength: 1 },
              timeout: { type: "number", minimum: 0 },
              visible: { type: "boolean", const: true },
              hidden: { type: "boolean", const: true },
            },
            description: "Wait for a page element.",
          },
          userAgent: { type: "string", description: "Browser user agent." },
          setJavaScriptEnabled: {
            type: "boolean",
            description: "Enable page JavaScript.",
          },
          gotoOptions: {
            type: "object",
            properties: {
              timeout: {
                type: "number",
                minimum: 0,
                description: "Navigation timeout in milliseconds.",
              },
              waitUntil: {
                anyOf: [
                  {
                    type: "string",
                    const: "load",
                  },
                  {
                    type: "string",
                    const: "domcontentloaded",
                  },
                  {
                    type: "string",
                    const: "networkidle0",
                  },
                  {
                    type: "string",
                    const: "networkidle2",
                  },
                ],
                description: "When to consider navigation complete.",
              },
            },
            description: "Navigation options.",
          },
        },
        description: "Cloudflare Browser Rendering options.",
      },
      retrySafe: true,
    },
  },
  load: async () => (await import("./adapter.js")).adapter,
});
