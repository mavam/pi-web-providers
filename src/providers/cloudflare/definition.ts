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
          gotoOptions: {
            type: "object",
            properties: {
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
