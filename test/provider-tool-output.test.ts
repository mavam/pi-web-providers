import { rm } from "node:fs/promises";
import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { __test__ } from "../src/index.js";
import type { WebProvidersConfig } from "../src/types.js";

const cleanupDirs: string[] = [];

afterEach(async () => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("provider tool output", () => {
  it("truncates oversized non-search output and saves the full response", async () => {
    const config: WebProvidersConfig = {
      version: 1,
      providers: {
        exa: {
          enabled: true,
          apiKey: "literal-key",
        },
      },
    };

    const result = await __test__.executeProviderTool({
      capability: "contents",
      config,
      explicitProvider: "exa",
      ctx: { cwd: process.cwd() },
      signal: undefined,
      onUpdate: undefined,
      invoke: async () => ({
        provider: "exa",
        text: Array.from(
          { length: 2500 },
          (_, index) => `line ${index + 1}: ${"x".repeat(40)}`,
        ).join("\n"),
        summary: "Large contents via Exa",
        itemCount: 2500,
      }),
    });

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("[Output truncated:");

    const fullPath = text.match(/Full output saved to: (.+)\]$/m)?.[1];
    expect(fullPath).toBeTruthy();
    if (fullPath) {
      cleanupDirs.push(dirname(fullPath));
    }
  });
});
