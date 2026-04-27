import { describe, expect, it, vi } from "vitest";
import {
  executeAsyncResearch,
  runWithExecutionPolicy,
} from "../src/execution-policy.js";
import type { ProviderContext } from "../src/types.js";

describe("execution policy", () => {
  it("retries transient failures in the parent execution wrapper", async () => {
    const operation = vi
      .fn<(context: ProviderContext) => Promise<string>>()
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce("ok");
    const progress: string[] = [];

    const result = await runWithExecutionPolicy(
      "Gemini answer request",
      operation,
      {
        requestTimeoutMs: undefined,
        retryCount: 1,
        retryDelayMs: 1,
      },
      {
        cwd: process.cwd(),
        onProgress: (message) => progress.push(message),
      },
    );

    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(progress).toContain(
      "Gemini answer request failed (fetch failed). Retrying in 1ms (attempt 2/2).",
    );
  });

  it("does not retry timed out requests and aborts the attempt signal", async () => {
    vi.useFakeTimers();

    try {
      let attemptSignal: AbortSignal | undefined;
      const operation = vi.fn(async (context: ProviderContext) => {
        attemptSignal = context.signal;
        return await new Promise<string>(() => {});
      });

      const promise = runWithExecutionPolicy(
        "Gemini answer request",
        operation,
        {
          requestTimeoutMs: 10,
          retryCount: 2,
          retryDelayMs: 1,
        },
        {
          cwd: process.cwd(),
        },
      );
      const rejection = expect(promise).rejects.toThrow(
        "Gemini answer request timed out after 10ms.",
      );

      await vi.advanceTimersByTimeAsync(10);
      await rejection;

      expect(operation).toHaveBeenCalledTimes(1);
      expect(attemptSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs research jobs to completion", async () => {
    vi.useFakeTimers();

    try {
      const progress: string[] = [];
      const start = vi.fn().mockResolvedValue({ id: "research-123" });
      const poll = vi
        .fn()
        .mockResolvedValueOnce({ status: "in_progress" as const })
        .mockResolvedValueOnce({
          status: "completed" as const,
          output: {
            provider: "gemini" as const,
            text: "done",
          },
        });

      const promise = executeAsyncResearch({
        providerLabel: "Gemini",
        providerId: "gemini",
        context: createContext(progress),
        pollIntervalMs: 1,
        start,
        poll,
      });

      await vi.advanceTimersByTimeAsync(1);
      const result = await promise;

      expect(result.text).toBe("done");
      expect(start).toHaveBeenCalledTimes(1);
      expect(poll).toHaveBeenCalledTimes(2);
      expect(progress).toContain("Starting research via Gemini");
      expect(progress).toContain("Gemini research started: research-123");
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails when research start never finishes before the overall deadline", async () => {
    vi.useFakeTimers();

    try {
      const start = vi.fn(
        async () => await new Promise<{ id: string }>(() => {}),
      );

      const promise = executeAsyncResearch({
        providerLabel: "Exa",
        providerId: "exa",
        context: createContext([]),
        timeoutMs: 10,
        start,
        poll: vi.fn(),
      });

      const rejection = expect(promise).rejects.toThrow(
        "Exa research exceeded 10ms.",
      );
      await vi.advanceTimersByTimeAsync(10);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries transient poll failures until research completes", async () => {
    vi.useFakeTimers();

    try {
      const progress: string[] = [];
      const poll = vi
        .fn()
        .mockRejectedValueOnce(new Error("fetch failed"))
        .mockResolvedValueOnce({
          status: "completed" as const,
          output: {
            provider: "gemini" as const,
            text: "done",
          },
        });

      const promise = executeAsyncResearch({
        providerLabel: "Gemini",
        providerId: "gemini",
        context: createContext(progress),
        pollIntervalMs: 1,
        start: vi.fn().mockResolvedValue({ id: "research-123" }),
        poll,
      });

      await vi.advanceTimersByTimeAsync(1);
      const result = await promise;

      expect(result.text).toBe("done");
      expect(poll).toHaveBeenCalledTimes(2);
      expect(progress).toContain(
        "Gemini research poll is still retrying after transient errors (1/3 consecutive poll failures). Background job id: research-123",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses provider-specific in-progress status text when available", async () => {
    vi.useFakeTimers();

    try {
      const progress: string[] = [];
      const promise = executeAsyncResearch({
        providerLabel: "Gemini",
        providerId: "gemini",
        context: createContext(progress),
        pollIntervalMs: 1,
        start: vi.fn().mockResolvedValue({ id: "research-123" }),
        poll: vi
          .fn()
          .mockResolvedValueOnce({
            status: "in_progress" as const,
            statusText: "running",
          })
          .mockResolvedValueOnce({
            status: "completed" as const,
            output: {
              provider: "gemini" as const,
              text: "done",
            },
          }),
      });

      await vi.advanceTimersByTimeAsync(1);
      await promise;

      expect(progress).toContain("Research via Gemini: running (0s elapsed)");
    } finally {
      vi.useRealTimers();
    }
  });
});

function createContext(progress: string[]): ProviderContext {
  return {
    cwd: process.cwd(),
    onProgress: (message) => progress.push(message),
  };
}
