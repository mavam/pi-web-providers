import { rm } from "node:fs/promises";
import { dirname } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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
      options: undefined,
      urls: ["https://example.com"],
      planOverride: {
        capability: "contents",
        providerId: "exa",
        providerLabel: "Exa",
        mode: "single",
        execute: async () => ({
          provider: "exa",
          text: Array.from(
            { length: 2500 },
            (_, index) => `line ${index + 1}: ${"x".repeat(40)}`,
          ).join("\n"),
          summary: "Large contents via Exa",
          itemCount: 2500,
        }),
      },
    });

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("[Output truncated:");

    const fullPath = text.match(/Full output saved to: (.+)\]$/m)?.[1];
    expect(fullPath).toBeTruthy();
    if (fullPath) {
      cleanupDirs.push(dirname(fullPath));
    }
  });

  it("emits heartbeat updates for long-running blocking research tools", async () => {
    vi.useFakeTimers();

    try {
      const config: WebProvidersConfig = {
        version: 1,
        providers: {
          perplexity: {
            enabled: true,
            apiKey: "literal-key",
          },
        },
      };

      const updates: string[] = [];
      const resultPromise = __test__.executeProviderTool({
        capability: "research",
        config,
        explicitProvider: "perplexity",
        ctx: { cwd: process.cwd() },
        signal: undefined,
        onUpdate: (update) => {
          const text = update.content[0]?.text;
          if (text) {
            updates.push(text);
          }
        },
        options: undefined,
        input: "Investigate the topic",
        planOverride: {
          capability: "research",
          providerId: "perplexity",
          providerLabel: "Perplexity",
          mode: "single",
          execute: async (context) => {
            context.onProgress?.("Starting research");
            await new Promise((resolve) => setTimeout(resolve, 20000));
            return {
              provider: "perplexity",
              text: "Research complete",
              summary: "Research via Perplexity",
            };
          },
        },
      });

      await vi.advanceTimersByTimeAsync(20000);
      const result = await resultPromise;

      expect(result.content[0]?.text).toBe("Research complete");
      expect(updates).toContain("Starting research");
      expect(updates).toContain(
        "web_research still running via perplexity (15s elapsed)",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects lifecycle-only options for blocking Perplexity research", async () => {
    const config: WebProvidersConfig = {
      version: 1,
      providers: {
        perplexity: {
          enabled: true,
          apiKey: "literal-key",
        },
      },
    };

    await expect(
      __test__.executeProviderTool({
        capability: "research",
        config,
        explicitProvider: "perplexity",
        ctx: { cwd: process.cwd() },
        signal: undefined,
        onUpdate: undefined,
        options: {
          resumeId: "job-1",
          timeoutMs: 60000,
        },
        input: "Investigate the topic",
      }),
    ).rejects.toThrow(
      "Perplexity research runs synchronously and does not support timeoutMs, resumeId. Use requestTimeoutMs/retryCount/retryDelayMs instead.",
    );
  });

  it("rejects removed resumeInteractionId compatibility for research", async () => {
    const config: WebProvidersConfig = {
      version: 1,
      providers: {
        gemini: {
          enabled: true,
          apiKey: "literal-key",
        },
      },
    };

    await expect(
      __test__.executeProviderTool({
        capability: "research",
        config,
        explicitProvider: "gemini",
        ctx: { cwd: process.cwd() },
        signal: undefined,
        onUpdate: undefined,
        options: {
          resumeInteractionId: "job-1",
        },
        input: "Investigate the topic",
      }),
    ).rejects.toThrow(
      "resumeInteractionId is not supported. Use resumeId instead.",
    );
  });
});
