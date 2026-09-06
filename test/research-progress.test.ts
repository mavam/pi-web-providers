import { afterEach, expect, it, vi } from "vitest";
import { executeAsyncResearch } from "../src/runtime/polling.js";
import { formatDuration } from "../src/runtime/duration.js";
import type { ResearchPollResult } from "../src/providers/contract.js";

afterEach(() => vi.useRealTimers());

it("reports acceptance and elapsed time without job IDs or duplicate terminal status", async () => {
  vi.useFakeTimers();
  const progress = vi.fn();
  const start = vi.fn().mockResolvedValue({ id: "opaque-job-id" });
  let polls = 0;
  const pending = executeAsyncResearch({
    providerId: "gemini",
    providerLabel: "Gemini",
    context: { cwd: ".", onProgress: progress },
    start,
    poll: async (): Promise<ResearchPollResult> =>
      ++polls <= 21
        ? { status: "in_progress" }
        : {
            status: "completed",
            output: { provider: "gemini", text: "# Report" },
          },
  });
  await vi.advanceTimersByTimeAsync(63_000);
  expect(await pending).toEqual({ provider: "gemini", text: "# Report" });
  expect(start).toHaveBeenCalledTimes(1);
  expect(progress.mock.calls.map(([message]) => message)).toEqual([
    "Submitting research to Gemini.",
    "Gemini accepted the request; waiting for the report.",
    "Gemini research is still running (30s elapsed).",
    "Gemini research is still running (1m 0s elapsed).",
  ]);
});

it("reports provider status transitions without inventing stages", async () => {
  vi.useFakeTimers();
  const progress = vi.fn();
  const results: ResearchPollResult[] = [
    { status: "in_progress", statusText: "queued" },
    { status: "in_progress", statusText: "queued" },
    { status: "in_progress" },
    { status: "completed", output: { provider: "gemini", text: "report" } },
  ];
  const pending = executeAsyncResearch({
    providerId: "gemini",
    providerLabel: "Gemini",
    context: { cwd: ".", onProgress: progress },
    start: async () => ({ id: "job" }),
    poll: async () => results.shift()!,
  });
  await vi.advanceTimersByTimeAsync(9_000);
  await pending;
  expect(progress.mock.calls.map(([message]) => message)).toEqual([
    "Submitting research to Gemini.",
    "Gemini accepted the request; waiting for the report.",
    "Gemini research status: queued (0s elapsed).",
    "Gemini research is still running (6s elapsed).",
  ]);
});

it("reports retry delay and budget without resubmitting the job", async () => {
  vi.useFakeTimers();
  const progress = vi.fn();
  const start = vi.fn().mockResolvedValue({ id: "opaque-job-id" });
  const poll = vi
    .fn()
    .mockRejectedValueOnce(
      Object.assign(new Error("reset"), { code: "ECONNRESET" }),
    )
    .mockResolvedValue({
      status: "completed",
      output: { provider: "gemini", text: "report" },
    });
  const pending = executeAsyncResearch({
    providerId: "gemini",
    providerLabel: "Gemini",
    context: {
      cwd: ".",
      onProgress: progress,
      retryPolicy: { retries: 2, delayMs: 2000 },
    },
    start,
    poll,
  });
  await vi.advanceTimersByTimeAsync(2000);
  await pending;
  expect(start).toHaveBeenCalledTimes(1);
  expect(poll).toHaveBeenCalledTimes(2);
  expect(progress).toHaveBeenLastCalledWith(
    "Gemini status check failed; retrying in 2s (retry 1/2).",
  );
});

it.each(["failed", "cancelled"] as const)(
  "does not log %s as running progress",
  async (status) => {
    const progress = vi.fn();
    await expect(
      executeAsyncResearch({
        providerId: "gemini",
        providerLabel: "Gemini",
        context: { cwd: ".", onProgress: progress },
        start: async () => ({ id: "job" }),
        poll: async () => ({ status, error: "provider detail" }),
      }),
    ).rejects.toMatchObject({
      code: status === "cancelled" ? "CANCELLED" : "PROVIDER_FAILURE",
    });
    expect(progress).toHaveBeenCalledTimes(2);
  },
);

it.each([
  [0, "0s"],
  [999, "0s"],
  [30_000, "30s"],
  [72_000, "1m 12s"],
  [3_661_000, "1h 1m 1s"],
])("formats %i milliseconds as %s", (milliseconds, expected) => {
  expect(formatDuration(milliseconds as number)).toBe(expected);
});
