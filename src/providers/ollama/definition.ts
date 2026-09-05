import { defineProvider } from "../definition.js";

export const ollamaProvider = defineProvider({
  id: "ollama",
  label: "Ollama",
  docsUrl: "https://docs.ollama.com/capabilities/web-search",
  local: true,
  credentials: [
    {
      name: "api",
      environmentVariable: "OLLAMA_API_KEY",
    },
  ],
  fields: ["credentials", "baseUrl", "options"],
  defaults: {},
  credentialDefaults: {},
  capabilities: {
    search: {
      limits: {
        maxResults: 10,
      },
      retrySafe: true,
    },
    contents: {
      retrySafe: true,
    },
  },
  load: async () => (await import("./adapter.js")).adapter,
});
