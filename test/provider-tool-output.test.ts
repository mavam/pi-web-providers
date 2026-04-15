import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { __test__ } from "../src/index.js";
import type { WebProviders } from "../src/types.js";

const cleanupDirs: string[] = [];

afterEach(async () => {
  await __test__.waitForPendingResearchTasks();
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("provider tool output", () => {
  it("groups multi-query search output into per-query sections", async () => {
    const config: WebProviders = {
      providers: {
        exa: {
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
    const config: WebProviders = {
      providers: {
        exa: {
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
    expect(result.content[0]?.text).toContain(
      "Search failed: Exa: rate limited.",
    );
    expect(result.details).toEqual({
      tool: "web_search",
      provider: "exa",
      queryCount: 2,
      failedQueryCount: 1,
      resultCount: 1,
    });
  });

  it("emits shared completion counts for batched search progress", async () => {
    const config: WebProviders = {
      providers: {
        exa: {
          apiKey: "literal-key",
        },
      },
    };
    const updates: string[] = [];

    await __test__.executeSearchTool({
      config,
      explicitProvider: "exa",
      ctx: { cwd: process.cwd() },
      signal: undefined,
      onUpdate: (update) => {
        const text = update.content[0]?.text;
        if (text) {
          updates.push(text);
        }
      },
      options: undefined,
      maxResults: 3,
      queries: ["exa sdk", "exa pricing"],
      planOverrides: [
        {
          capability: "search",
          providerId: "exa",
          providerLabel: "Exa",
          execute: async () => ({
            provider: "exa",
            results: [],
          }),
        },
        {
          capability: "search",
          providerId: "exa",
          providerLabel: "Exa",
          execute: async () => ({
            provider: "exa",
            results: [],
          }),
        },
      ],
    });

    expect(updates).toEqual([
      "Searching via Exa: 0/2 completed",
      "Searching via Exa: 1/2 completed",
      "Searching via Exa: 2/2 completed",
    ]);
  });

  it("fails the batch when every query fails", async () => {
    const config: WebProviders = {
      providers: {
        exa: {
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
            execute: async () => {
              throw new Error("timeout");
            },
          },
          {
            capability: "search",
            providerId: "exa",
            providerLabel: "Exa",
            execute: async () => {
              throw new Error("rate limited");
            },
          },
        ],
      }),
    ).rejects.toThrow(
      'All 2 web_search queries failed: 1. "exa sdk" — Exa: timeout.; 2. "exa pricing" — Exa: rate limited.',
    );
  });

  it("rejects a whitespace-only query in the array", async () => {
    const config: WebProviders = {
      providers: {
        exa: {
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
    const config: WebProviders = {
      providers: {
        exa: {
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
    const config: WebProviders = {
      providers: {
        gemini: {
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
        "What are common ACME platform use cases?",
        "How can an ACME platform help with legacy tool migration?",
      ],
      planOverrides: [
        {
          capability: "answer",
          providerId: "gemini",
          providerLabel: "Gemini",
          execute: async () => ({
            provider: "gemini",
            text: "ACME platforms are used for workflow automation and data operations.",
          }),
        },
        {
          capability: "answer",
          providerId: "gemini",
          providerLabel: "Gemini",
          execute: async () => ({
            provider: "gemini",
            text: "ACME platforms can reduce migration costs by reshaping and routing data.",
          }),
        },
      ],
    });

    expect(result.content[0]?.text).toContain(
      'Question 1: "What are common ACME platform use cases?"',
    );
    expect(result.content[0]?.text).toContain(
      "ACME platforms are used for workflow automation and data operations.",
    );
    expect(result.content[0]?.text).toContain(
      'Question 2: "How can an ACME platform help with legacy tool migration?"',
    );
    expect(result.content[0]?.text).toContain(
      "ACME platforms can reduce migration costs by reshaping and routing data.",
    );
    expect(result.details).toEqual({
      tool: "web_answer",
      provider: "gemini",
      itemCount: undefined,
      queryCount: 2,
      failedQueryCount: 0,
    });
  });

  it("preserves successful answers when one query in a batch fails", async () => {
    const config: WebProviders = {
      providers: {
        gemini: {
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
        "What are common ACME platform use cases?",
        "How can an ACME platform help with legacy tool migration?",
      ],
      planOverrides: [
        {
          capability: "answer",
          providerId: "gemini",
          providerLabel: "Gemini",
          execute: async () => ({
            provider: "gemini",
            text: "ACME platforms are used for workflow automation and data operations.",
          }),
        },
        {
          capability: "answer",
          providerId: "gemini",
          providerLabel: "Gemini",
          execute: async () => {
            throw new Error("rate limited");
          },
        },
      ],
    });

    expect(result.content[0]?.text).toContain(
      'Question 1: "What are common ACME platform use cases?"',
    );
    expect(result.content[0]?.text).toContain(
      'Question 2: "How can an ACME platform help with legacy tool migration?"',
    );
    expect(result.content[0]?.text).toContain(
      "Answer failed: Gemini: rate limited.",
    );
    expect(result.details).toEqual({
      tool: "web_answer",
      provider: "gemini",
      itemCount: undefined,
      queryCount: 2,
      failedQueryCount: 1,
    });
  });

  it("fails the answer batch when every query fails", async () => {
    const config: WebProviders = {
      providers: {
        gemini: {
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
          "What are common ACME platform use cases?",
          "How can an ACME platform help with legacy tool migration?",
        ],
        planOverrides: [
          {
            capability: "answer",
            providerId: "gemini",
            providerLabel: "Gemini",
            execute: async () => {
              throw new Error("timeout");
            },
          },
          {
            capability: "answer",
            providerId: "gemini",
            providerLabel: "Gemini",
            execute: async () => {
              throw new Error("rate limited");
            },
          },
        ],
      }),
    ).rejects.toThrow(
      'All 2 web_answer queries failed: 1. "What are common ACME platform use cases?" — Gemini: timeout.; 2. "How can an ACME platform help with lega…" — Gemini: rate limited.',
    );
  });

  it("supports a single-question batch for web_answer", async () => {
    const config: WebProviders = {
      providers: {
        gemini: {
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
      queries: ["What are common ACME platform use cases?"],
      planOverrides: [
        {
          capability: "answer",
          providerId: "gemini",
          providerLabel: "Gemini",
          execute: async () => ({
            provider: "gemini",
            text: "ACME platforms are used for workflow automation and legacy migrations.",
            itemCount: 2,
          }),
        },
      ],
    });

    expect(result.content[0]?.text).toBe(
      '## "What are common ACME platform use cases?"\n\nACME platforms are used for workflow automation and legacy migrations.',
    );
    expect(result.details).toEqual({
      tool: "web_answer",
      provider: "gemini",
      itemCount: 2,
      queryCount: 1,
      failedQueryCount: 0,
    });
  });

  it("emits shared completion counts for batched answers", async () => {
    const config: WebProviders = {
      providers: {
        gemini: {
          apiKey: "literal-key",
        },
      },
    };
    const updates: string[] = [];

    await __test__.executeAnswerTool({
      config,
      explicitProvider: "gemini",
      ctx: { cwd: process.cwd() },
      signal: undefined,
      onUpdate: (update) => {
        const text = update.content[0]?.text;
        if (text) {
          updates.push(text);
        }
      },
      options: undefined,
      queries: [
        "What are common ACME platform use cases?",
        "How can an ACME platform help with legacy tool migration?",
      ],
      planOverrides: [
        {
          capability: "answer",
          providerId: "gemini",
          providerLabel: "Gemini",
          execute: async () => ({
            provider: "gemini",
            text: "Answer one",
          }),
        },
        {
          capability: "answer",
          providerId: "gemini",
          providerLabel: "Gemini",
          execute: async () => ({
            provider: "gemini",
            text: "Answer two",
          }),
        },
      ],
    });

    expect(updates).toEqual([
      "Answering via Gemini: 0/2 completed",
      "Answering via Gemini: 1/2 completed",
      "Answering via Gemini: 2/2 completed",
    ]);
  });

  it("streams multi-url contents progress while preserving input order", async () => {
    const config: WebProviders = {
      providers: {
        exa: {
          apiKey: "literal-key",
        },
      },
    };
    const updates: string[] = [];

    const result = await __test__.executeProviderTool({
      capability: "contents",
      config,
      explicitProvider: "exa",
      ctx: { cwd: process.cwd() },
      signal: undefined,
      onUpdate: (update) => {
        const text = update.content[0]?.text;
        if (text) {
          updates.push(text);
        }
      },
      options: undefined,
      urls: ["https://slow.example", "https://fast.example"],
      planOverrides: [
        {
          capability: "contents",
          providerId: "exa",
          providerLabel: "Exa",
          execute: async () => {
            await new Promise((resolve) => setTimeout(resolve, 25));
            return {
              provider: "exa",
              answers: [
                {
                  url: "https://slow.example",
                  content: "content for https://slow.example",
                },
              ],
            };
          },
        },
        {
          capability: "contents",
          providerId: "exa",
          providerLabel: "Exa",
          execute: async () => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            return {
              provider: "exa",
              answers: [
                {
                  url: "https://fast.example",
                  content: "content for https://fast.example",
                },
              ],
            };
          },
        },
      ],
    });

    expect(updates).toContain("Fetching contents via Exa: 0/2 completed");
    expect(updates).toContain("Fetching contents via Exa: 1/2 completed");
    expect(updates).toContain("Fetching contents via Exa: 2/2 completed");

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("## 1. https://slow.example");
    expect(text).toContain("## 2. https://fast.example");
    expect(text.indexOf("https://slow.example")).toBeLessThan(
      text.indexOf("https://fast.example"),
    );
  });

  it("truncates oversized non-search output and saves the full response", async () => {
    const config: WebProviders = {
      providers: {
        exa: {
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
        execute: async () => ({
          provider: "exa",
          text: Array.from(
            { length: 2500 },
            (_, index) => `line ${index + 1}: ${"x".repeat(40)}`,
          ).join("\n"),
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

  it("dispatches web research immediately and posts the saved result later", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-web-research-"));
    cleanupDirs.push(cwd);

    const config: WebProviders = {
      providers: {
        gemini: {
          apiKey: "literal-key",
        },
      },
    };
    const sendMessage = vi.fn();
    const setWidget = vi.fn();
    const activeWebResearchRequests = new Map();
    let lastWidgetContext: any;
    const updateWebResearchWidget = (ctx?: any) => {
      const widgetContext = ctx ?? lastWidgetContext;
      if (!widgetContext?.hasUI) {
        return;
      }
      lastWidgetContext = widgetContext;
      const requests = [...activeWebResearchRequests.values()];
      if (requests.length === 0) {
        widgetContext.ui.setWidget("web-research-jobs", undefined);
        return;
      }
      widgetContext.ui.setWidget("web-research-jobs", [
        `Research jobs running: ${requests.length}`,
      ]);
    };

    const result = await __test__.dispatchWebResearch({
      pi: { sendMessage },
      activeWebResearchRequests,
      updateWebResearchWidget,
      config,
      explicitProvider: "gemini",
      ctx: {
        cwd,
        hasUI: true,
        ui: {
          setWidget,
          theme: { fg: (_color: string, text: string) => text } as any,
        },
      } as any,
      options: undefined,
      input: "Investigate the topic",
      planOverride: {
        capability: "research",
        providerId: "gemini",
        providerLabel: "Gemini",
        execute: async () => ({
          provider: "gemini",
          text: "Detailed report text",
          itemCount: 3,
        }),
      },
    });

    expect(result.content[0]?.text).toBe("Started web research via Gemini.");
    expect(sendMessage).not.toHaveBeenCalled();
    expect(setWidget).toHaveBeenCalledWith("web-research-jobs", [
      "Research jobs running: 1",
    ]);

    await __test__.waitForPendingResearchTasks();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(setWidget).toHaveBeenLastCalledWith("web-research-jobs", undefined);
    const message = sendMessage.mock.calls[0]?.[0];
    expect(message?.customType).toBe("web-research-result");
    expect(message?.content).toBe("Detailed report text\n");

    const details = message?.details as {
      outputPath: string;
      status: string;
    };
    expect(details.status).toBe("completed");
    const report = await readFile(details.outputPath, "utf-8");
    expect(report).toContain("# Web research report");
    expect(report).toContain("## Report");
    expect(report).toContain("Detailed report text");
  });

  it("writes diagnostics and posts a failure message when dispatched research fails", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-web-research-"));
    cleanupDirs.push(cwd);

    const config: WebProviders = {
      providers: {
        gemini: {
          apiKey: "literal-key",
        },
      },
    };
    const sendMessage = vi.fn();
    const setWidget = vi.fn();
    const activeWebResearchRequests = new Map();
    let lastWidgetContext: any;
    const updateWebResearchWidget = (ctx?: any) => {
      const widgetContext = ctx ?? lastWidgetContext;
      if (!widgetContext?.hasUI) {
        return;
      }
      lastWidgetContext = widgetContext;
      const requests = [...activeWebResearchRequests.values()];
      if (requests.length === 0) {
        widgetContext.ui.setWidget("web-research-jobs", undefined);
        return;
      }
      widgetContext.ui.setWidget("web-research-jobs", [
        `Research jobs running: ${requests.length}`,
      ]);
    };

    await __test__.dispatchWebResearch({
      pi: { sendMessage },
      activeWebResearchRequests,
      updateWebResearchWidget,
      config,
      explicitProvider: "gemini",
      ctx: {
        cwd,
        hasUI: true,
        ui: {
          setWidget,
          theme: { fg: (_color: string, text: string) => text } as any,
        },
      } as any,
      options: undefined,
      input: "Investigate the topic",
      planOverride: {
        capability: "research",
        providerId: "gemini",
        providerLabel: "Gemini",
        execute: async () => {
          throw new Error("Gemini: rate limited.");
        },
      },
    });

    await __test__.waitForPendingResearchTasks();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(setWidget).toHaveBeenLastCalledWith("web-research-jobs", undefined);
    const message = sendMessage.mock.calls[0]?.[0];
    expect(message?.content).toBe("Gemini: rate limited.\n");

    const details = message?.details as {
      outputPath: string;
      status: string;
      error: string;
    };
    expect(details.status).toBe("failed");
    expect(details.error).toBe("Gemini: rate limited.");

    const report = await readFile(details.outputPath, "utf-8");
    expect(report).toContain("# Web research report");
    expect(report).toContain("## Error");
    expect(report).toContain("Gemini: rate limited.");
  });

  it("cleans up active research jobs even when result delivery throws", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-web-research-"));
    cleanupDirs.push(cwd);

    const config: WebProviders = {
      providers: {
        gemini: {
          apiKey: "literal-key",
        },
      },
    };
    const sendMessage = vi.fn(() => {
      throw new Error("send failed");
    });
    const setWidget = vi.fn();
    const activeWebResearchRequests = new Map();
    let lastWidgetContext: any;
    const updateWebResearchWidget = (ctx?: any) => {
      const widgetContext = ctx ?? lastWidgetContext;
      if (!widgetContext?.hasUI) {
        return;
      }
      lastWidgetContext = widgetContext;
      const requests = [...activeWebResearchRequests.values()];
      widgetContext.ui.setWidget(
        "web-research-jobs",
        requests.length === 0
          ? undefined
          : [`Research jobs running: ${requests.length}`],
      );
    };

    await __test__.dispatchWebResearch({
      pi: { sendMessage },
      activeWebResearchRequests,
      updateWebResearchWidget,
      config,
      explicitProvider: "gemini",
      ctx: {
        cwd,
        hasUI: true,
        ui: {
          setWidget,
          theme: { fg: (_color: string, text: string) => text } as any,
        },
      } as any,
      options: undefined,
      input: "Investigate the topic",
      planOverride: {
        capability: "research",
        providerId: "gemini",
        providerLabel: "Gemini",
        execute: async () => ({
          provider: "gemini",
          text: "Detailed report text",
        }),
      },
    });

    await __test__.waitForPendingResearchTasks();

    expect(activeWebResearchRequests.size).toBe(0);
    expect(setWidget).toHaveBeenLastCalledWith("web-research-jobs", undefined);
  });

  it("emits heartbeat updates for long-running foreground research tools", async () => {
    vi.useFakeTimers();

    try {
      const config: WebProviders = {
        providers: {
          perplexity: {
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
          execute: async () => {
            await new Promise((resolve) => setTimeout(resolve, 20000));
            return {
              provider: "perplexity",
              text: "Research complete",
            };
          },
        },
      });

      await vi.advanceTimersByTimeAsync(20000);
      const result = await resultPromise;

      expect(result.content[0]?.text).toBe("Research complete");
      expect(updates).toContain("Researching via Perplexity");
      expect(updates).toContain("Researching via Perplexity (15s elapsed)");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects runtime options for research", async () => {
    const config: WebProviders = {
      providers: {
        perplexity: {
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
        options: undefined,
        runtimeOptions: {
          requestTimeoutMs: 1000,
        },
        input: "Investigate the topic",
      }),
    ).rejects.toThrow("Perplexity research does not accept options.runtime.");
  });

  it("rejects malformed local execution control fields", async () => {
    const config: WebProviders = {
      providers: {
        exa: {
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
        options: undefined,
        runtimeOptions: {
          requestTimeoutMs: "1000" as never,
        },
        urls: ["https://example.com"],
        planOverride: {
          capability: "contents",
          providerId: "exa",
          providerLabel: "Exa",
          execute: async () => ({
            provider: "exa",
            text: "contents",
          }),
        },
      }),
    ).rejects.toThrow("options.requestTimeoutMs must be a positive integer.");
  });

  it("rejects unsupported runtime options on non-research tools", async () => {
    const config: WebProviders = {
      providers: {
        exa: {
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
        options: undefined,
        runtimeOptions: {
          timeoutMs: 1000,
        },
        urls: ["https://example.com"],
        planOverride: {
          capability: "contents",
          providerId: "exa",
          providerLabel: "Exa",
          execute: async () => ({
            provider: "exa",
            text: "contents",
          }),
        },
      }),
    ).rejects.toThrow("Unsupported runtime options: timeoutMs.");
  });

  it("builds structured options schema with provider and runtime sub-objects", () => {
    const schema = __test__.buildStructuredOptionsSchema("search", "tavily")!;
    const inner = schema.anyOf?.[0] ?? schema;
    const props = inner.properties ?? {};
    expect(props).toHaveProperty("provider");
    expect(props).toHaveProperty("runtime");
    const runtimeProps =
      (props.runtime?.anyOf?.[0] ?? props.runtime)?.properties ?? {};
    expect(runtimeProps).toHaveProperty("prefetch");
    expect(runtimeProps).toHaveProperty("requestTimeoutMs");
  });

  it("omits provider sub-schema when provider has none", () => {
    const schema = __test__.buildStructuredOptionsSchema("search", undefined)!;
    const inner = schema.anyOf?.[0] ?? schema;
    const props = inner.properties ?? {};
    expect(props).not.toHaveProperty("provider");
    expect(props).toHaveProperty("runtime");
  });

  it("omits prefetch from runtime for non-search capabilities", () => {
    const schema = __test__.buildStructuredOptionsSchema("contents", "tavily")!;
    const inner = schema.anyOf?.[0] ?? schema;
    const runtimeInner =
      inner.properties?.runtime?.anyOf?.[0] ?? inner.properties?.runtime;
    const runtimeProps = runtimeInner?.properties ?? {};
    expect(runtimeProps).not.toHaveProperty("prefetch");
    expect(runtimeProps).toHaveProperty("requestTimeoutMs");
  });
  it("omits provider options when a capability has no per-call provider schema", () => {
    const exaContents = __test__.buildStructuredOptionsSchema(
      "contents",
      "exa",
    )!;
    const customSearch = __test__.buildStructuredOptionsSchema(
      "search",
      "custom",
    )!;

    const exaContentsProps =
      (exaContents.anyOf?.[0] ?? exaContents).properties ?? {};
    const customSearchProps =
      (customSearch.anyOf?.[0] ?? customSearch).properties ?? {};

    expect(exaContentsProps).not.toHaveProperty("provider");
    expect(customSearchProps).not.toHaveProperty("provider");
  });

  it("does not leak Exa search options into the contents schema", () => {
    const schema = __test__.buildStructuredOptionsSchema("contents", "exa")!;
    const inner = schema.anyOf?.[0] ?? schema;
    const props = inner.properties ?? {};

    expect(props).not.toHaveProperty("provider");
    expect(JSON.stringify(inner)).not.toContain("includeDomains");
    expect(JSON.stringify(inner)).not.toContain("excludeDomains");
    expect(JSON.stringify(inner)).not.toContain("startPublishedDate");
    expect(JSON.stringify(inner)).not.toContain("endPublishedDate");
    expect(JSON.stringify(inner)).not.toContain("userLocation");
  });

  it("exposes provider-specific search knobs in provider schemas", () => {
    const perplexity = __test__.buildStructuredOptionsSchema(
      "search",
      "perplexity",
    )!;
    const exa = __test__.buildStructuredOptionsSchema("search", "exa")!;
    const serper = __test__.buildStructuredOptionsSchema("search", "serper")!;
    const tavily = __test__.buildStructuredOptionsSchema("search", "tavily")!;

    const perplexityProvider = (perplexity.anyOf?.[0] ?? perplexity).properties
      ?.provider;
    const exaProvider = (exa.anyOf?.[0] ?? exa).properties?.provider;
    const serperProvider = (serper.anyOf?.[0] ?? serper).properties?.provider;
    const tavilyProvider = (tavily.anyOf?.[0] ?? tavily).properties?.provider;

    expect(perplexityProvider?.properties ?? {}).toHaveProperty("country");
    expect(exaProvider?.properties ?? {}).toHaveProperty("userLocation");
    expect(serperProvider?.properties ?? {}).toHaveProperty("gl");
    expect(serperProvider?.properties ?? {}).toHaveProperty("location");
    expect(tavilyProvider?.properties ?? {}).toHaveProperty("country");
  });

  it("exposes provider-specific research knobs in provider schemas", () => {
    const gemini = __test__.buildStructuredOptionsSchema("research", "gemini")!;
    const valyu = __test__.buildStructuredOptionsSchema("search", "valyu")!;

    const geminiProvider = (gemini.anyOf?.[0] ?? gemini).properties?.provider;
    const valyuProvider = (valyu.anyOf?.[0] ?? valyu).properties?.provider;

    expect(geminiProvider?.properties ?? {}).toHaveProperty("agent_config");
    expect(valyuProvider?.properties ?? {}).toHaveProperty("countryCode");
  });

  it("omits runtime from the research tool schema", () => {
    const schema = __test__.buildStructuredOptionsSchema("research", "gemini")!;
    const inner = schema.anyOf?.[0] ?? schema;
    const props = inner.properties ?? {};

    expect(props).not.toHaveProperty("runtime");
    expect(props).toHaveProperty("provider");
  });
});
