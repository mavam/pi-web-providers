import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { __test__ } from "../src/index.js";
import type { WebProviders } from "../src/types.js";

interface TestSchema {
  additionalProperties?: boolean;
  anyOf?: TestSchema[];
  enum?: string[];
  properties?: Record<string, TestSchema>;
}

function schemaInner(schema: unknown): TestSchema {
  const typed = schema as TestSchema;
  return typed.anyOf?.[0] ?? typed;
}

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
          credentials: { api: "literal-key" },
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
      executionOverrides: [
        {
          capability: "search",
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
          credentials: { api: "literal-key" },
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
      executionOverrides: [
        {
          capability: "search",
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
          credentials: { api: "literal-key" },
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
      executionOverrides: [
        {
          capability: "search",
          providerLabel: "Exa",
          execute: async () => ({
            provider: "exa",
            results: [],
          }),
        },
        {
          capability: "search",
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
          credentials: { api: "literal-key" },
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
        executionOverrides: [
          {
            capability: "search",
            providerLabel: "Exa",
            execute: async () => {
              throw new Error("timeout");
            },
          },
          {
            capability: "search",
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
          credentials: { api: "literal-key" },
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
          credentials: { api: "literal-key" },
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
          credentials: { api: "literal-key" },
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
        "How can an ACME platform help with tool migration?",
      ],
      executionOverrides: [
        {
          capability: "answer",
          providerLabel: "Gemini",
          execute: async () => ({
            provider: "gemini",
            text: "ACME platforms are used for workflow automation and data operations.",
          }),
        },
        {
          capability: "answer",
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
      'Question 2: "How can an ACME platform help with tool migration?"',
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
          credentials: { api: "literal-key" },
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
        "How can an ACME platform help with tool migration?",
      ],
      executionOverrides: [
        {
          capability: "answer",
          providerLabel: "Gemini",
          execute: async () => ({
            provider: "gemini",
            text: "ACME platforms are used for workflow automation and data operations.",
          }),
        },
        {
          capability: "answer",
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
      'Question 2: "How can an ACME platform help with tool migration?"',
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
          credentials: { api: "literal-key" },
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
          "How can an ACME platform help with tool migration?",
        ],
        executionOverrides: [
          {
            capability: "answer",
            providerLabel: "Gemini",
            execute: async () => {
              throw new Error("timeout");
            },
          },
          {
            capability: "answer",
            providerLabel: "Gemini",
            execute: async () => {
              throw new Error("rate limited");
            },
          },
        ],
      }),
    ).rejects.toThrow(
      'All 2 web_answer queries failed: 1. "What are common ACME platform use cases?" — Gemini: timeout.; 2. "How can an ACME platform help with tool…" — Gemini: rate limited.',
    );
  });

  it("supports a single-question batch for web_answer", async () => {
    const config: WebProviders = {
      providers: {
        gemini: {
          credentials: { api: "literal-key" },
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
      executionOverrides: [
        {
          capability: "answer",
          providerLabel: "Gemini",
          execute: async () => ({
            provider: "gemini",
            text: "ACME platforms are used for workflow automation and data migrations.",
            itemCount: 2,
          }),
        },
      ],
    });

    expect(result.content[0]?.text).toBe(
      "ACME platforms are used for workflow automation and data migrations.",
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
          credentials: { api: "literal-key" },
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
        "How can an ACME platform help with tool migration?",
      ],
      executionOverrides: [
        {
          capability: "answer",
          providerLabel: "Gemini",
          execute: async () => ({
            provider: "gemini",
            text: "Answer one",
          }),
        },
        {
          capability: "answer",
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
          credentials: { api: "literal-key" },
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
      executionOverrides: [
        {
          capability: "contents",
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
          credentials: { api: "literal-key" },
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
      executionOverride: {
        capability: "contents",
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
          credentials: { api: "literal-key" },
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
      executionOverride: {
        capability: "research",
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
          credentials: { api: "literal-key" },
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
      executionOverride: {
        capability: "research",
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
          credentials: { api: "literal-key" },
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
      executionOverride: {
        capability: "research",
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
            credentials: { api: "literal-key" },
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
        executionOverride: {
          capability: "research",
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

  it("builds structured options schema from provider options directly", () => {
    const inner = schemaInner(
      __test__.buildStructuredOptionsSchema("search", "tavily"),
    );
    const props = inner.properties ?? {};
    expect(props).toHaveProperty("country");
    expect(props).not.toHaveProperty("provider");
    expect(props).not.toHaveProperty("runtime");
  });

  it("omits options schema when no provider-specific schema is available", () => {
    expect(__test__.buildStructuredOptionsSchema("search", undefined)).toBe(
      undefined,
    );
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

    expect(exaContents).toBeUndefined();
    expect(customSearch).toBeUndefined();
  });

  it("does not leak Exa search options into the contents schema", () => {
    const schema = __test__.buildStructuredOptionsSchema("contents", "exa");

    expect(schema).toBeUndefined();
  });

  it("exposes provider-specific search knobs in provider schemas", () => {
    const perplexity = __test__.buildStructuredOptionsSchema(
      "search",
      "perplexity",
    )!;
    const brave = __test__.buildStructuredOptionsSchema("search", "brave")!;
    const exa = __test__.buildStructuredOptionsSchema("search", "exa")!;
    const serper = __test__.buildStructuredOptionsSchema("search", "serper")!;
    const tavily = __test__.buildStructuredOptionsSchema("search", "tavily")!;

    const braveProps = schemaInner(brave).properties ?? {};

    expect(schemaInner(perplexity).properties ?? {}).toHaveProperty("country");
    expect(braveProps.mode?.enum).toEqual([
      "web",
      "llm_context",
      "news",
      "videos",
      "images",
      "places",
    ]);
    expect(braveProps.news?.properties ?? {}).toHaveProperty("freshness");
    expect(braveProps.videos?.properties ?? {}).toHaveProperty("safesearch");
    expect(schemaInner(exa).properties ?? {}).toHaveProperty("userLocation");
    expect(schemaInner(serper).properties ?? {}).toHaveProperty("gl");
    expect(schemaInner(serper).properties ?? {}).toHaveProperty("location");
    expect(schemaInner(tavily).properties ?? {}).toHaveProperty("country");
  });

  it("exposes only safe Gemini research knobs in provider schemas", () => {
    const gemini = __test__.buildStructuredOptionsSchema("research", "gemini")!;
    const valyu = __test__.buildStructuredOptionsSchema("search", "valyu")!;

    const geminiProvider = schemaInner(gemini);
    const geminiProviderProps = geminiProvider.properties ?? {};
    const valyuProvider = schemaInner(valyu);

    expect(geminiProvider.additionalProperties).toBe(false);
    expect(geminiProviderProps).toHaveProperty("agent_config");
    expect(geminiProviderProps.agent_config?.additionalProperties).toBe(false);
    expect(geminiProviderProps).not.toHaveProperty("store");
    expect(geminiProviderProps).not.toHaveProperty("tools");
    expect(geminiProviderProps).not.toHaveProperty("response_format");
    expect(geminiProviderProps).not.toHaveProperty("response_modalities");
    expect(geminiProviderProps).not.toHaveProperty("system_instruction");
    expect(JSON.stringify(gemini)).not.toContain("search_types");
    expect(JSON.stringify(gemini)).not.toContain("response_length");
    expect(valyuProvider.properties ?? {}).toHaveProperty("countryCode");
  });

  it("omits runtime from the research tool schema", () => {
    const inner = schemaInner(
      __test__.buildStructuredOptionsSchema("research", "gemini"),
    );
    const props = inner.properties ?? {};

    expect(props).not.toHaveProperty("runtime");
    expect(props).toHaveProperty("agent_config");
  });
});
