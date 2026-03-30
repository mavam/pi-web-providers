import { afterEach, describe, expect, it, vi } from "vitest";

const { execFileSyncMock, queryMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
  queryMock: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  const actual =
    await vi.importActual<typeof import("node:child_process")>(
      "node:child_process",
    );
  return {
    ...actual,
    execFileSync: execFileSyncMock,
  };
});

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: queryMock,
}));

import {
  claudeAdapter,
  resetClaudeProviderCachesForTests,
} from "../src/providers/claude.js";

afterEach(() => {
  execFileSyncMock.mockReset();
  queryMock.mockReset();
  resetClaudeProviderCachesForTests();
});

describe("claudeAdapter", () => {
  it("reports Claude as unavailable when auth status is logged out", () => {
    execFileSyncMock.mockImplementation(mockLoggedOutClaudeStatus);

    const provider = claudeAdapter;

    expect(
      provider.getCapabilityStatus(
        {
          pathToClaudeCodeExecutable: process.execPath,
        },
        process.cwd(),
      ),
    ).toEqual({
      state: "missing_auth",
    });
    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
  });

  it("reports Claude as available when auth is available", () => {
    execFileSyncMock.mockImplementation(mockClaudeAvailable);

    const provider = claudeAdapter;

    expect(
      provider.getCapabilityStatus(
        {
          pathToClaudeCodeExecutable: process.execPath,
        },
        process.cwd(),
      ),
    ).toEqual({
      state: "ready",
    });
    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
  });

  it("caches Claude auth status across repeated availability checks", () => {
    execFileSyncMock.mockImplementation(mockClaudeAvailable);

    const config = {
      pathToClaudeCodeExecutable: process.execPath,
    };

    expect(
      claudeAdapter.getCapabilityStatus(config, process.cwd()),
    ).toEqual({
      state: "ready",
    });
    expect(
      claudeAdapter.getCapabilityStatus(config, process.cwd()),
    ).toEqual({
      state: "ready",
    });
    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
  });

  it("attaches config settings to Claude operation plans", () => {
    const provider = claudeAdapter;
    const plan = provider.buildPlan(
      {
        capability: "search",
        query: "latest Claude docs",
        maxResults: 5,
      },
      {
        settings: {
          requestTimeoutMs: 1500,
          retryCount: 2,
          retryDelayMs: 250,
        },
      },
    );

    expect(plan).toMatchObject({
      deliveryMode: "silent-foreground",
      traits: {
        settings: {
          requestTimeoutMs: 1500,
          retryCount: 2,
          retryDelayMs: 250,
        },
      },
    });
  });

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

    const provider = claudeAdapter;
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

    const provider = claudeAdapter;
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

  it("forwards only allowed runtime options for Claude search", async () => {
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

    const provider = claudeAdapter;
    await provider.search(
      "latest Claude docs",
      1,
      {
        options: {
          model: "claude-sonnet-4-6",
          effort: "medium",
          maxTurns: 3,
        },
      },
      {
        cwd: process.cwd(),
      },
      {
        model: "claude-opus-4-6",
        thinking: { type: "adaptive" },
        effort: "max",
        maxThinkingTokens: 1234,
        maxTurns: 7,
        maxBudgetUsd: 3.5,
        cwd: "/tmp/override",
        permissionMode: "default",
        plugins: [{ type: "local", path: "/tmp/plugin" }],
      },
    );

    const [searchCall] = queryMock.mock.calls;
    expect(searchCall[0].prompt).toContain("User query: latest Claude docs");
    expect(searchCall[0].options).toMatchObject({
      model: "claude-opus-4-6",
      thinking: { type: "adaptive" },
      effort: "max",
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
  });

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

    const provider = claudeAdapter;
    const response = await provider.answer(
      "What changed?",
      {
        options: {
          model: "claude-sonnet-4-6",
          maxTurns: 2,
        },
      },
      {
        cwd: process.cwd(),
      },
      {
        model: "claude-opus-4-6",
        maxTurns: 5,
        allowedTools: ["Bash"],
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

function mockLoggedOutClaudeStatus(): never {
  throw Object.assign(new Error("not logged in"), {
    stdout: '{"loggedIn":false,"authMethod":"none"}',
  });
}

function mockClaudeAvailable(_command: string, args: string[]): string {
  if (args.includes("auth") && args.includes("status")) {
    return '{"loggedIn":true,"authMethod":"claude.ai"}';
  }
  throw new Error(`Unexpected Claude command: ${args.join(" ")}`);
}

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
