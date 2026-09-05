import { defineProvider } from "../definition.js";

export const customProvider = defineProvider({
  id: "custom",
  label: "Custom",
  docsUrl: "https://github.com/mavam/web-mux#custom-providers",
  local: true,
  credentials: [],
  fields: ["commands", "options"],
  defaults: {},
  credentialDefaults: {},
  capabilities: {
    search: {
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
