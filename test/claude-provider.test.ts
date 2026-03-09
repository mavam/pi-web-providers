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

import { ClaudeProvider } from "../src/providers/claude.js";

afterEach(() => {
  execFileSyncMock.mockReset();
  queryMock.mockReset();
});

describe("ClaudeProvider", () => {
  it("reports Claude as unavailable when auth status is logged out", () => {
    execFileSyncMock.mockImplementation(() => {
      throw Object.assign(new Error("not logged in"), {
        stdout: '{"loggedIn":false,"authMethod":"none"}',
      });
    });

    const provider = new ClaudeProvider();

    expect(provider.getStatus({ enabled: true })).toEqual({
      available: false,
      summary: "missing Claude auth",
    });
  });

  it("reports Claude as available when auth status is logged in", () => {
    execFileSyncMock.mockReturnValue(
      '{"loggedIn":true,"authMethod":"claude.ai"}',
    );

    const provider = new ClaudeProvider();

    expect(provider.getStatus({ enabled: true })).toEqual({
      available: true,
      summary: "enabled",
    });
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

    const provider = new ClaudeProvider();
    const controller = new AbortController();
    const searchPromise = provider.search(
      "latest Claude docs",
      1,
      { enabled: true },
      {
        cwd: process.cwd(),
        signal: controller.signal,
      },
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
});
