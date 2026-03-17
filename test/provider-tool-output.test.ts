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
  it("groups multi-query search output into per-query sections", async () => {
    const config: WebProvidersConfig = {
      providers: {
        exa: {
          enabled: true,
          apiKey: "literal-key",
        },
      },
    };

    const result = await __test__.executeSearchTool({
      config,
      explicitProvider: "exa",
      ctx: { cwd: process.cwd() },
      signal: undefined,
      onUpdate: undefined,
      options: undefined,
      maxResults: 3,
      queries: ["exa sdk", "exa pricing"],
      planOverrides: [
        {
          capability: "search",
          providerId: "exa",
          providerLabel: "Exa",
          deliveryMode: "silent-foreground",
          execute: async () => ({
            provider: "exa",
            results: [
              {
                title: "Exa SDK",
                url: "https://exa.ai/sdk",
                snippet: "SDK docs",
              },
            ],
          }),
        },
        {
          capability: "search",
          providerId: "exa",
          providerLabel: "Exa",
          deliveryMode: "silent-foreground",
          execute: async () => ({
            provider: "exa",
            results: [
              {
                title: "Exa Pricing",
                url: "https://exa.ai/pricing",
                snippet: "Pricing page",
              },
              {
                title: "Exa API Plans",
                url: "https://exa.ai/plans",
                snippet: "Plans overview",
              },
            ],
          }),
        },
      ],
    });

    expect(result.content[0]?.text).toContain('Query 1: "exa sdk"');
    expect(result.content[0]?.text).toContain('Query 2: "exa pricing"');
    expect(result.content[0]?.text).toContain(
      "1. [Exa SDK](<https://exa.ai/sdk>)",
    );
    expect(result.content[0]?.text).toContain(
      "2. [Exa API Plans](<https://exa.ai/plans>)",
    );
    expect(result.details).toEqual({
      tool: "web_search",
      provider: "exa",
      queryCount: 2,
      failedQueryCount: 0,
      resultCount: 3,
    });
  });

  it("preserves successful search results when one query in a batch fails", async () => {
    const config: WebProvidersConfig = {
      providers: {
        exa: {
          enabled: true,
          apiKey: "literal-key",
        },
      },
    };

    const result = await __test__.executeSearchTool({
      config,
      explicitProvider: "exa",
      ctx: { cwd: process.cwd() },
      signal: undefined,
      onUpdate: undefined,
      options: undefined,
      maxResults: 3,
      queries: ["exa sdk", "exa pricing"],
      planOverrides: [
        {
          capability: "search",
          providerId: "exa",
          providerLabel: "Exa",
          deliveryMode: "silent-foreground",
          execute: async () => ({
            provider: "exa",
            results: [
              {
                title: "Exa SDK",
                url: "https://exa.ai/sdk",
                snippet: "SDK docs",
              },
            ],
          }),
        },
        {
          capability: "search",
          providerId: "exa",
          providerLabel: "Exa",
          deliveryMode: "silent-foreground",
          execute: async () => {
            throw new Error("rate limited");
          },
        },
      ],
    });

    expect(result.content[0]?.text).toContain('Query 1: "exa sdk"');
    expect(result.content[0]?.text).toContain(
      "1. [Exa SDK](<https://exa.ai/sdk>)",
    );
    expect(result.content[0]?.text).toContain('Query 2: "exa pricing"');
    expect(result.content[0]?.text).toContain("Search failed: rate limited");
    expect(result.details).toEqual({
      tool: "web_search",
      provider: "exa",
      queryCount: 2,
      failedQueryCount: 1,
      resultCount: 1,
    });
  });

  it("fails the batch when every query fails", async () => {
    const config: WebProvidersConfig = {
      providers: {
        exa: {
          enabled: true,
          apiKey: "literal-key",
        },
      },
    };

    await expect(
      __test__.executeSearchTool({
        config,
        explicitProvider: "exa",
        ctx: { cwd: process.cwd() },
        signal: undefined,
        onUpdate: undefined,
        options: undefined,
        maxResults: 3,
        queries: ["exa sdk", "exa pricing"],
        planOverrides: [
          {
            capability: "search",
            providerId: "exa",
            providerLabel: "Exa",
            deliveryMode: "silent-foreground",
            execute: async () => {
              throw new Error("timeout");
            },
          },
          {
            capability: "search",
            providerId: "exa",
            providerLabel: "Exa",
            deliveryMode: "silent-foreground",
            execute: async () => {
              throw new Error("rate limited");
            },
          },
        ],
      }),
    ).rejects.toThrow(
      'All 2 web_search queries failed: 1. "exa sdk" — timeout; 2. "exa pricing" — rate limited',
    );
  });

  it("rejects a whitespace-only query in the array", async () => {
    const config: WebProvidersConfig = {
      providers: {
        exa: {
          enabled: true,
          apiKey: "literal-key",
        },
      },
    };

    await expect(
      __test__.executeSearchTool({
        config,
        explicitProvider: "exa",
        ctx: { cwd: process.cwd() },
        signal: undefined,
        onUpdate: undefined,
        options: undefined,
        maxResults: 3,
        queries: ["valid query", "   "],
      }),
    ).rejects.toThrow("queries[1] must be a non-empty string.");
  });

  it("rejects an empty queries array", async () => {
    const config: WebProvidersConfig = {
      providers: {
        exa: {
          enabled: true,
          apiKey: "literal-key",
        },
      },
    };

    await expect(
      __test__.executeSearchTool({
        config,
        explicitProvider: "exa",
        ctx: { cwd: process.cwd() },
        signal: undefined,
        onUpdate: undefined,
        options: undefined,
        maxResults: 3,
        queries: [],
      }),
    ).rejects.toThrow("queries must contain at least one item.");
  });

  it("groups multi-query answer output into per-question sections", async () => {
    const config: WebProvidersConfig = {
      providers: {
        gemini: {
          enabled: true,
          apiKey: "literal-key",
        },
      },
    };

    const result = await __test__.executeAnswerTool({
      config,
      explicitProvider: "gemini",
      ctx: { cwd: process.cwd() },
      signal: undefined,
      onUpdate: undefined,
      options: undefined,
      queries: [
        "What are common Tenzir use cases?",
        "How does Tenzir help with SIEM migration?",
      ],
      planOverrides: [
        {
          capability: "answer",
          providerId: "gemini",
          providerLabel: "Gemini",
          deliveryMode: "silent-foreground",
          execute: async () => ({
            provider: "gemini",
            text: "Tenzir is used for detection engineering and security data pipelines.",
            summary: "Answer via Gemini with 2 source(s)",
          }),
        },
        {
          capability: "answer",
          providerId: "gemini",
          providerLabel: "Gemini",
          deliveryMode: "silent-foreground",
          execute: async () => ({
            provider: "gemini",
            text: "Tenzir can reduce SIEM costs during migration by reshaping and routing data.",
            summary: "Answer via Gemini with 3 source(s)",
          }),
        },
      ],
    });

    expect(result.content[0]?.text).toContain(
      'Question 1: "What are common Tenzir use cases?"',
    );
    expect(result.content[0]?.text).toContain(
      "Tenzir is used for detection engineering and security data pipelines.",
    );
    expect(result.content[0]?.text).toContain(
      'Question 2: "How does Tenzir help with SIEM migration?"',
    );
    expect(result.content[0]?.text).toContain(
      "Tenzir can reduce SIEM costs during migration by reshaping and routing data.",
    );
    expect(result.details).toEqual({
      tool: "web_answer",
      provider: "gemini",
      summary: undefined,
      itemCount: undefined,
      queryCount: 2,
      failedQueryCount: 0,
    });
  });

  it("preserves successful answers when one query in a batch fails", async () => {
    const config: WebProvidersConfig = {
      providers: {
        gemini: {
          enabled: true,
          apiKey: "literal-key",
        },
      },
    };

    const result = await __test__.executeAnswerTool({
      config,
      explicitProvider: "gemini",
      ctx: { cwd: process.cwd() },
      signal: undefined,
      onUpdate: undefined,
      options: undefined,
      queries: [
        "What are common Tenzir use cases?",
        "How does Tenzir help with SIEM migration?",
      ],
      planOverrides: [
        {
          capability: "answer",
          providerId: "gemini",
          providerLabel: "Gemini",
          deliveryMode: "silent-foreground",
          execute: async () => ({
            provider: "gemini",
            text: "Tenzir is used for detection engineering and security data pipelines.",
            summary: "Answer via Gemini with 2 source(s)",
          }),
        },
        {
          capability: "answer",
          providerId: "gemini",
          providerLabel: "Gemini",
          deliveryMode: "silent-foreground",
          execute: async () => {
            throw new Error("rate limited");
          },
        },
      ],
    });

    expect(result.content[0]?.text).toContain(
      'Question 1: "What are common Tenzir use cases?"',
    );
    expect(result.content[0]?.text).toContain(
      'Question 2: "How does Tenzir help with SIEM migration?"',
    );
    expect(result.content[0]?.text).toContain("Answer failed: rate limited");
    expect(result.details).toEqual({
      tool: "web_answer",
      provider: "gemini",
      summary: undefined,
      itemCount: undefined,
      queryCount: 2,
      failedQueryCount: 1,
    });
  });

  it("fails the answer batch when every query fails", async () => {
    const config: WebProvidersConfig = {
      providers: {
        gemini: {
          enabled: true,
          apiKey: "literal-key",
        },
      },
    };

    await expect(
      __test__.executeAnswerTool({
        config,
        explicitProvider: "gemini",
        ctx: { cwd: process.cwd() },
        signal: undefined,
        onUpdate: undefined,
        options: undefined,
        queries: [
          "What are common Tenzir use cases?",
          "How does Tenzir help with SIEM migration?",
        ],
        planOverrides: [
          {
            capability: "answer",
            providerId: "gemini",
            providerLabel: "Gemini",
            deliveryMode: "silent-foreground",
            execute: async () => {
              throw new Error("timeout");
            },
          },
          {
            capability: "answer",
            providerId: "gemini",
            providerLabel: "Gemini",
            deliveryMode: "silent-foreground",
            execute: async () => {
              throw new Error("rate limited");
            },
          },
        ],
      }),
    ).rejects.toThrow(
      'All 2 web_answer queries failed: 1. "What are common Tenzir use cases?" — timeout; 2. "How does Tenzir help with SIEM migratio…" — rate limited',
    );
  });

  it("supports a single-question batch for web_answer", async () => {
    const config: WebProvidersConfig = {
      providers: {
        gemini: {
          enabled: true,
          apiKey: "literal-key",
        },
      },
    };

    const result = await __test__.executeAnswerTool({
      config,
      explicitProvider: "gemini",
      ctx: { cwd: process.cwd() },
      signal: undefined,
      onUpdate: undefined,
      options: undefined,
      queries: ["What are common Tenzir use cases?"],
      planOverrides: [
        {
          capability: "answer",
          providerId: "gemini",
          providerLabel: "Gemini",
          deliveryMode: "silent-foreground",
          execute: async () => ({
            provider: "gemini",
            text: "Tenzir is used for detection engineering and SIEM migration.",
            summary: "Answer via Gemini with 2 source(s)",
            itemCount: 2,
          }),
        },
      ],
    });

    expect(result.content[0]?.text).toBe(
      '## "What are common Tenzir use cases?"\n\nTenzir is used for detection engineering and SIEM migration.',
    );
    expect(result.details).toEqual({
      tool: "web_answer",
      provider: "gemini",
      summary: "Answer via Gemini with 2 source(s)",
      itemCount: 2,
      queryCount: 1,
      failedQueryCount: 0,
    });
  });

  it("truncates oversized non-search output and saves the full response", async () => {
    const config: WebProvidersConfig = {
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
        deliveryMode: "silent-foreground",
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

  it("emits heartbeat updates for long-running foreground research tools", async () => {
    vi.useFakeTimers();

    try {
      const config: WebProvidersConfig = {
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
          deliveryMode: "streaming-foreground",
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

  it("rejects lifecycle-only options for streaming foreground Perplexity research", async () => {
    const config: WebProvidersConfig = {
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
      "Perplexity research runs in streaming foreground mode and does not support timeoutMs, resumeId. Use requestTimeoutMs/retryCount/retryDelayMs instead.",
    );
  });

  it("inherits request timeouts for streaming foreground plans that declare support", async () => {
    vi.useFakeTimers();

    try {
      const config: WebProvidersConfig = {
        providers: {
          perplexity: {
            enabled: true,
            apiKey: "literal-key",
          },
        },
      };

      const resultPromise = __test__.executeProviderTool({
        capability: "research",
        config,
        explicitProvider: "perplexity",
        ctx: { cwd: process.cwd() },
        signal: undefined,
        onUpdate: undefined,
        options: undefined,
        input: "Investigate the topic",
        planOverride: {
          capability: "research",
          providerId: "perplexity",
          providerLabel: "Perplexity",
          deliveryMode: "streaming-foreground",
          traits: {
            executionSupport: {
              requestTimeoutMs: true,
              retryCount: true,
              retryDelayMs: true,
              pollIntervalMs: false,
              timeoutMs: false,
              maxConsecutivePollErrors: false,
              resumeId: false,
            },
            policyDefaults: {
              requestTimeoutMs: 1,
              retryCount: 0,
              retryDelayMs: 1,
            },
          },
          execute: async () =>
            await new Promise((resolve) => {
              setTimeout(() => {
                resolve({
                  provider: "perplexity" as const,
                  text: "Research complete",
                });
              }, 5);
            }),
        },
      });
      const rejection = expect(resultPromise).rejects.toThrow(
        "Perplexity research request timed out after 1ms.",
      );

      await vi.advanceTimersByTimeAsync(1);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects requestTimeoutMs for research providers that cannot safely enforce it", async () => {
    const config: WebProvidersConfig = {
      providers: {
        exa: {
          enabled: true,
          apiKey: "literal-key",
        },
      },
    };

    await expect(
      __test__.executeProviderTool({
        capability: "research",
        config,
        explicitProvider: "exa",
        ctx: { cwd: process.cwd() },
        signal: undefined,
        onUpdate: undefined,
        options: {
          requestTimeoutMs: 1000,
        },
        input: "Investigate the topic",
        planOverride: {
          capability: "research",
          providerId: "exa",
          providerLabel: "Exa",
          deliveryMode: "background-research",
          start: async () => ({ id: "job-1" }),
          poll: async () => ({
            status: "completed",
            output: {
              provider: "exa",
              text: "done",
            },
          }),
        },
      }),
    ).rejects.toThrow(
      "Exa research does not support requestTimeoutMs. Use retryCount/retryDelayMs/pollIntervalMs/timeoutMs/maxConsecutivePollErrors/resumeId instead.",
    );
  });

  it("rejects malformed local execution control fields", async () => {
    const config: WebProvidersConfig = {
      providers: {
        exa: {
          enabled: true,
          apiKey: "literal-key",
        },
      },
    };

    await expect(
      __test__.executeProviderTool({
        capability: "contents",
        config,
        explicitProvider: "exa",
        ctx: { cwd: process.cwd() },
        signal: undefined,
        onUpdate: undefined,
        options: {
          requestTimeoutMs: "1000" as never,
        },
        urls: ["https://example.com"],
        planOverride: {
          capability: "contents",
          providerId: "exa",
          providerLabel: "Exa",
          deliveryMode: "silent-foreground",
          execute: async () => ({
            provider: "exa",
            text: "contents",
          }),
        },
      }),
    ).rejects.toThrow("options.requestTimeoutMs must be a positive integer.");
  });

  it("rejects research-only execution controls on non-research tools", async () => {
    const config: WebProvidersConfig = {
      providers: {
        exa: {
          enabled: true,
          apiKey: "literal-key",
        },
      },
    };

    await expect(
      __test__.executeProviderTool({
        capability: "contents",
        config,
        explicitProvider: "exa",
        ctx: { cwd: process.cwd() },
        signal: undefined,
        onUpdate: undefined,
        options: {
          timeoutMs: 1000,
          resumeId: "job-1",
        },
        urls: ["https://example.com"],
        planOverride: {
          capability: "contents",
          providerId: "exa",
          providerLabel: "Exa",
          deliveryMode: "silent-foreground",
          execute: async () => ({
            provider: "exa",
            text: "contents",
          }),
        },
      }),
    ).rejects.toThrow(
      "Exa contents does not support timeoutMs, resumeId. These controls only apply to web_research. Use requestTimeoutMs/retryCount/retryDelayMs instead.",
    );
  });

  it("describes supported local execution controls in tool option help", () => {
    expect(__test__.describeOptionsField("contents", ["exa"])).toBe(
      "Provider-specific extraction options. Local execution controls: requestTimeoutMs, retryCount, retryDelayMs.",
    );
    expect(__test__.describeOptionsField("search", ["exa"])).toBe(
      "Provider-specific search options. Local execution controls: requestTimeoutMs, retryCount, retryDelayMs. Local orchestration options may include prefetch={ enabled, maxUrls, provider, ttlMs, contentsOptions }.",
    );
    expect(
      __test__.describeOptionsField("research", [
        "perplexity",
        "exa",
        "gemini",
      ]),
    ).toBe(
      "Provider-specific research options. Depending on provider, local execution controls may include: requestTimeoutMs, retryCount, retryDelayMs, pollIntervalMs, timeoutMs, maxConsecutivePollErrors, resumeId.",
    );
  });

  it("rejects removed resumeInteractionId compatibility for research", async () => {
    const config: WebProvidersConfig = {
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
