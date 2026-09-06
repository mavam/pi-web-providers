import { afterEach, describe, expect, it, vi } from "vitest";

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: queryMock,
}));

import { claudeProvider } from "../src/providers/claude/definition.js";
import { providerHarness } from "./provider-harness.js";

afterEach(() => {
  queryMock.mockReset();
});

describe("providerHarness(claudeProvider)", () => {
  it("disables Claude session persistence for provider queries", async () => {
    queryMock.mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        yield {
          type: "result",
          subtype: "success",
          result: "",
          structured_output: {
            sources: [
              {
                title: "Claude docs",
                url: "https://docs.anthropic.com",
                snippet: "Official documentation",
              },
            ],
          },
          errors: [],
        };
      },
      close() {},
    }));

    const provider = providerHarness(claudeProvider);
    await provider.search(
      "latest Claude docs",
      1,
      {},
      {
        cwd: process.cwd(),
      },
      undefined,
    );

    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          persistSession: false,
        }),
      }),
    );
  });

  it("propagates cancellation into Claude queries", async () => {
    let capturedAbortSignal: AbortSignal | undefined;
    let closeCalled = false;

    queryMock.mockImplementation(({ options }) => {
      capturedAbortSignal = options.abortController.signal;
      return {
        async *[Symbol.asyncIterator]() {
          await new Promise<never>((_, reject) => {
            if (options.abortController.signal.aborted) {
              reject(new Error("aborted"));
              return;
            }
            options.abortController.signal.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            );
          });
        },
        close() {
          closeCalled = true;
        },
      };
    });

    const provider = providerHarness(claudeProvider);
    const controller = new AbortController();
    const searchPromise = provider.search(
      "latest Claude docs",
      1,
      {},
      {
        cwd: process.cwd(),
        signal: controller.signal,
      },
      undefined,
    );

    await Promise.resolve();
    controller.abort();

    await expect(searchPromise).rejects.toThrow("aborted");
    expect(capturedAbortSignal?.aborted).toBe(true);
    expect(closeCalled).toBe(true);
    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          abortController: expect.any(AbortController),
        }),
      }),
    );
  });

  it.each(["xhigh", "max"])(
    "forwards Claude %s effort and budgeted thinking without host controls",
    async (effort) => {
      queryMock.mockImplementation(() =>
        createQueryResult({
          sources: [
            {
              title: "Claude docs",
              url: "https://docs.anthropic.com",
              snippet: "Official docs",
            },
          ],
        }),
      );

      const provider = providerHarness(claudeProvider);
      await provider.search(
        "latest Claude docs",
        1,
        {},
        {
          cwd: process.cwd(),
        },
        {
          ...{
            model: "claude-sonnet-4-6",
            effort: "medium",
            maxTurns: 3,
          },
          ...{
            model: "claude-opus-4-6",
            thinking: {
              type: "enabled",
              budgetTokens: 2048,
              display: "summarized",
            },
            effort,
            maxThinkingTokens: 1234,
            maxTurns: 7,
            maxBudgetUsd: 3.5,
            cwd: "/tmp/override",
            permissionMode: "default",
            plugins: [{ type: "local", path: "/tmp/plugin" }],
          },
        },
      );

      const [searchCall] = queryMock.mock.calls;
      expect(searchCall[0].prompt).toContain("User query: latest Claude docs");
      expect(searchCall[0].options).toMatchObject({
        model: "claude-opus-4-6",
        thinking: {
          type: "enabled",
          budgetTokens: 2048,
          display: "summarized",
        },
        effort,
        maxThinkingTokens: 1234,
        maxTurns: 7,
        maxBudgetUsd: 3.5,
        allowedTools: ["WebSearch"],
        cwd: process.cwd(),
        permissionMode: "dontAsk",
        persistSession: false,
        tools: ["WebSearch"],
      });
      expect(searchCall[0].options).not.toHaveProperty("plugins");
    },
  );

  it("uses real Claude SDK options for answer calls instead of prompt text", async () => {
    queryMock.mockImplementation(() =>
      createQueryResult({
        answer: "Claude answer",
        sources: [
          {
            title: "Claude docs",
            url: "https://docs.anthropic.com",
          },
        ],
      }),
    );

    const provider = providerHarness(claudeProvider);
    const response = await provider.answer(
      "What changed?",
      {},
      {
        cwd: process.cwd(),
      },
      {
        ...{
          model: "claude-sonnet-4-6",
          maxTurns: 2,
        },
        ...{
          model: "claude-opus-4-6",
          maxTurns: 5,
          allowedTools: ["Bash"],
        },
      },
    );

    const [answerCall] = queryMock.mock.calls;
    expect(answerCall[0].prompt).not.toContain("Additional options:");
    expect(answerCall[0].options).toMatchObject({
      model: "claude-opus-4-6",
      maxTurns: 5,
      allowedTools: ["WebSearch", "WebFetch"],
      tools: ["WebSearch", "WebFetch"],
    });
    expect(response.text).toContain("Claude answer");
  });
});

function createQueryResult(structuredOutput: unknown) {
  return {
    async *[Symbol.asyncIterator]() {
      yield {
        type: "result",
        subtype: "success",
        result: "",
        structured_output: structuredOutput,
        errors: [],
      };
    },
    close() {},
  };
}
