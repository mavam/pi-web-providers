import { resolve } from "node:path";
import type { WebMuxConfig } from "../src/index.js";
export function customConfig(): WebMuxConfig {
  const command = {
    argv: [process.execPath, resolve("test/fixtures/custom-provider.mjs")] as [
      string,
      ...string[],
    ],
  };
  return {
    defaults: {
      search: { provider: "custom" },
      contents: { provider: "custom" },
      answer: { provider: "custom" },
      research: { provider: "custom" },
    },
    providers: {
      custom: {
        commands: {
          search: command,
          contents: command,
          answer: command,
          research: command,
        },
      },
    },
  };
}
