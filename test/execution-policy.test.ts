import { describe, expect, it, vi } from "vitest";
import {
  executeResearchWithLifecycle,
  resolveRequestExecutionPolicy,
  runWithExecutionPolicy,
  stripLocalExecutionOptions,
} from "../src/execution-policy.js";
import type {
  GeminiProviderConfig,
  JsonObject,
  ProviderContext,
} from "../src/types.js";

describe("execution policy", () => {
  it("strips local execution control fields before calling providers", () => {
    const options: JsonObject = {
      model: "gemini-2.5-pro",
      requestTimeoutMs: 45000,
      retryCount: 4,
      retryDelayMs: 3000,
      pollIntervalMs: 5000,
      timeoutMs: 7200000,
      maxConsecutivePollErrors: 8,
      resumeId: "job-1",
    };

    expect(stripLocalExecutionOptions(options)).toEqual({
      model: "gemini-2.5-pro",
    });
  });

  it("uses Gemini config defaults for parent-side request execution", () => {
    const config: GeminiProviderConfig = {
      enabled: true,
      apiKey: "literal-key",
      defaults: {
        requestTimeoutMs: 45000,
        retryCount: 5,
        retryDelayMs: 4000,
      },
    };

    expect(resolveRequestExecutionPolicy("gemini", config, undefined)).toEqual({
      requestTimeoutMs: 45000,
      retryCount: 5,
      retryDelayMs: 4000,
    });
  });

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

  it("aborts hung requests when the parent signal is aborted without a per-request timeout", async () => {
    vi.useFakeTimers();

    try {
      const controller = new AbortController();
      const operation = vi.fn(async () => await new Promise<string>(() => {}));

      const promise = runWithExecutionPolicy(
        "Gemini answer request",
        operation,
        {
          requestTimeoutMs: undefined,
          retryCount: 0,
          retryDelayMs: 1,
        },
        {
          cwd: process.cwd(),
          signal: controller.signal,
        },
      );
      const rejection = expect(promise).rejects.toThrow("parent aborted");

      controller.abort(new Error("parent aborted"));
      await vi.runAllTimersAsync();
      await rejection;

      expect(operation).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries research start when a stable idempotency key is available", async () => {
    vi.useFakeTimers();

    try {
      const progress: string[] = [];
      const startContexts: ProviderContext[] = [];
      const start = vi
        .fn<
          (
            input: string,
            options: JsonObject | undefined,
            context: ProviderContext,
          ) => Promise<{ id: string }>
        >()
        .mockImplementationOnce(async (_input, _options, context) => {
          startContexts.push(context);
          throw new Error("fetch failed");
        })
        .mockImplementationOnce(async (_input, _options, context) => {
          startContexts.push(context);
          return { id: "research-123" };
        });
      const poll = vi.fn().mockResolvedValue({
        status: "completed" as const,
        output: {
          provider: "gemini" as const,
          text: "done",
          summary: "Research via Gemini",
        },
      });

      const promise = executeResearchWithLifecycle({
        providerLabel: "Gemini",
        providerId: "gemini",
        input: "Investigate Tenzir use cases",
        options: { retryCount: 1 },
        context: createContext(progress),
        policy: {
          requestTimeoutMs: undefined,
          retryCount: 1,
          retryDelayMs: 1,
          pollIntervalMs: 1,
          timeoutMs: 60000,
          maxConsecutivePollErrors: 3,
        },
        startRetryCount: 1,
        startIdempotencyKey: "stable-key",
        start,
        poll,
      });

      await vi.advanceTimersByTimeAsync(1);
      const result = await promise;

      expect(result.text).toBe("done");
      expect(start).toHaveBeenCalledTimes(2);
      expect(startContexts[0]?.idempotencyKey).toBe("stable-key");
      expect(startContexts[1]?.idempotencyKey).toBe("stable-key");
      expect(progress).toContain(
        "Gemini research start failed (fetch failed). Retrying in 1ms (attempt 2/2).",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries timed-out idempotent research starts", async () => {
    vi.useFakeTimers();

    try {
      const progress: string[] = [];
      const startContexts: ProviderContext[] = [];
      const start = vi
        .fn<
          (
            input: string,
            options: JsonObject | undefined,
            context: ProviderContext,
          ) => Promise<{ id: string }>
        >()
        .mockImplementationOnce(async (_input, _options, context) => {
          startContexts.push(context);
          return await new Promise<{ id: string }>(() => {});
        })
        .mockImplementationOnce(async (_input, _options, context) => {
          startContexts.push(context);
          return { id: "research-123" };
        });
      const poll = vi.fn().mockResolvedValue({
        status: "completed" as const,
        output: {
          provider: "gemini" as const,
          text: "done",
          summary: "Research via Gemini",
        },
      });

      const promise = executeResearchWithLifecycle({
        providerLabel: "Gemini",
        providerId: "gemini",
        input: "Investigate Tenzir use cases",
        options: { requestTimeoutMs: 10, retryCount: 1 },
        context: createContext(progress),
        policy: {
          requestTimeoutMs: 10,
          retryCount: 1,
          retryDelayMs: 1,
          pollIntervalMs: 1,
          timeoutMs: 60000,
          maxConsecutivePollErrors: 3,
        },
        startRetryCount: 1,
        startIdempotencyKey: "stable-key",
        startRetryOnTimeout: true,
        start,
        poll,
      });

      await vi.advanceTimersByTimeAsync(11);
      const result = await promise;

      expect(result.text).toBe("done");
      expect(start).toHaveBeenCalledTimes(2);
      expect(startContexts[0]?.idempotencyKey).toBe("stable-key");
      expect(startContexts[1]?.idempotencyKey).toBe("stable-key");
      expect(progress).toContain(
        "Gemini research start failed (Gemini research start timed out after 10ms.). Retrying in 1ms (attempt 2/2).",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not attach resume advice to terminal research failures", async () => {
    await expect(
      executeResearchWithLifecycle({
        providerLabel: "Gemini",
        providerId: "gemini",
        input: "Investigate Tenzir use cases",
        options: { resumeId: "research-123" },
        context: createContext([]),
        policy: {
          requestTimeoutMs: undefined,
          retryCount: 1,
          retryDelayMs: 1,
          pollIntervalMs: 1,
          timeoutMs: 60000,
          maxConsecutivePollErrors: 3,
          resumeId: "research-123",
        },
        start: vi.fn(),
        poll: vi.fn().mockResolvedValue({
          status: "failed" as const,
          error: "Gemini research failed.",
        }),
      }),
    ).rejects.toThrow("Gemini research failed.");

    await expect(
      executeResearchWithLifecycle({
        providerLabel: "Gemini",
        providerId: "gemini",
        input: "Investigate Tenzir use cases",
        options: { resumeId: "research-123" },
        context: createContext([]),
        policy: {
          requestTimeoutMs: undefined,
          retryCount: 1,
          retryDelayMs: 1,
          pollIntervalMs: 1,
          timeoutMs: 60000,
          maxConsecutivePollErrors: 3,
          resumeId: "research-123",
        },
        start: vi.fn(),
        poll: vi.fn().mockResolvedValue({
          status: "failed" as const,
          error: "Gemini research failed.",
        }),
      }).catch((error) => {
        expect((error as Error).message).not.toContain("options.resumeId");
        throw error;
      }),
    ).rejects.toThrow("Gemini research failed.");
  });

  it("turns total research timeouts into resumable errors even while sleeping between polls", async () => {
    vi.useFakeTimers();

    try {
      const poll = vi
        .fn()
        .mockResolvedValue({ status: "in_progress" as const });

      const promise = executeResearchWithLifecycle({
        providerLabel: "Gemini",
        providerId: "gemini",
        input: "ignored while resuming",
        options: { resumeId: "research-123" },
        context: createContext([]),
        policy: {
          requestTimeoutMs: undefined,
          retryCount: 0,
          retryDelayMs: 1,
          pollIntervalMs: 30000,
          timeoutMs: 10000,
          maxConsecutivePollErrors: 3,
          resumeId: "research-123",
        },
        start: vi.fn(),
        poll,
      });
      const rejection = expect(promise).rejects.toThrow(
        'Gemini research exceeded 10s. Resume the background job with options.resumeId="research-123".',
      );

      await vi.advanceTimersByTimeAsync(10000);
      await rejection;
      expect(poll).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("turns total research timeouts into resumable errors even when a poll request ignores aborts", async () => {
    vi.useFakeTimers();

    try {
      const poll = vi
        .fn()
        .mockImplementationOnce(() => new Promise<never>(() => {}));

      const promise = executeResearchWithLifecycle({
        providerLabel: "Gemini",
        providerId: "gemini",
        input: "ignored while resuming",
        options: { resumeId: "research-123" },
        context: createContext([]),
        policy: {
          requestTimeoutMs: undefined,
          retryCount: 0,
          retryDelayMs: 1,
          pollIntervalMs: 30000,
          timeoutMs: 10000,
          maxConsecutivePollErrors: 3,
          resumeId: "research-123",
        },
        start: vi.fn(),
        poll,
      });
      const rejection = expect(promise).rejects.toThrow(
        'Gemini research exceeded 10s. Resume the background job with options.resumeId="research-123".',
      );

      await vi.advanceTimersByTimeAsync(10000);
      await rejection;
      expect(poll).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats timed out poll requests as transient research poll failures", async () => {
    vi.useFakeTimers();

    try {
      const progress: string[] = [];
      const poll = vi
        .fn()
        .mockImplementationOnce(() => new Promise<never>(() => {}))
        .mockResolvedValueOnce({
          status: "completed" as const,
          output: {
            provider: "gemini" as const,
            text: "done",
            summary: "Research via Gemini",
          },
        });

      const promise = executeResearchWithLifecycle({
        providerLabel: "Gemini",
        providerId: "gemini",
        input: "ignored while resuming",
        options: { resumeId: "research-123" },
        context: createContext(progress),
        policy: {
          requestTimeoutMs: 10,
          retryCount: 0,
          retryDelayMs: 1,
          pollIntervalMs: 5,
          timeoutMs: 60000,
          maxConsecutivePollErrors: 3,
          resumeId: "research-123",
        },
        start: vi.fn(),
        poll,
      });

      await vi.advanceTimersByTimeAsync(20);
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

  it("polls research jobs in the parent and supports resume ids", async () => {
    vi.useFakeTimers();

    try {
      const progress: string[] = [];
      const poll = vi
        .fn()
        .mockResolvedValueOnce({ status: "in_progress" as const })
        .mockResolvedValueOnce({
          status: "completed" as const,
          output: {
            provider: "gemini" as const,
            text: "done",
            summary: "Research via Gemini",
          },
        });

      const promise = executeResearchWithLifecycle({
        providerLabel: "Gemini",
        providerId: "gemini",
        input: "ignored while resuming",
        options: { resumeId: "research-123" },
        context: createContext(progress),
        policy: {
          requestTimeoutMs: undefined,
          retryCount: 0,
          retryDelayMs: 1,
          pollIntervalMs: 5000,
          timeoutMs: 60000,
          maxConsecutivePollErrors: 3,
          resumeId: "research-123",
        },
        start: vi.fn(),
        poll,
      });

      await vi.advanceTimersByTimeAsync(5000);
      const result = await promise;

      expect(result.text).toBe("done");
      expect(poll).toHaveBeenCalledWith(
        "research-123",
        undefined,
        expect.objectContaining({ cwd: process.cwd() }),
      );
      expect(progress).toContain("Resuming Gemini research: research-123");
      expect(progress).toContain(
        "Gemini research status: in_progress (0s elapsed)",
      );
      expect(progress).toContain(
        "Gemini research status: completed (5s elapsed)",
      );
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
