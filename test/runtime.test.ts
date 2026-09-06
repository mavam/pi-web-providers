import { afterEach, expect, it, vi } from "vitest";
import { createWebfox } from "../src/index.js";
import { executeAsyncResearch } from "../src/runtime/polling.js";
import { WebfoxError } from "../src/errors.js";
const { markdown } = vi.hoisted(() => ({ markdown: vi.fn() }));
vi.mock("cloudflare", () => ({
  default: class {
    browserRendering = { markdown: { create: markdown } };
  },
}));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("retries structurally transient per-page failures on safe adapters", async () => {
  markdown
    .mockRejectedValueOnce(
      Object.assign(new Error("rate limited"), { status: 429 }),
    )
    .mockResolvedValueOnce("page");
  const client = createWebfox({
    config: { execution: { retries: 1, retryDelayMs: 0 } },
    env: { CLOUDFLARE_API_TOKEN: "token", CLOUDFLARE_ACCOUNT_ID: "account" },
  });
  expect(
    (
      await client.contents({
        provider: "cloudflare",
        urls: ["https://example.test"],
      })
    ).results[0],
  ).toMatchObject({ ok: true, value: { content: "page" } });
  expect(markdown).toHaveBeenCalledTimes(2);
});
it("applies the runtime retry policy to polling without restarting jobs", async () => {
  const start = vi.fn().mockResolvedValue({ id: "job" });
  const poll = vi
    .fn()
    .mockRejectedValueOnce(
      Object.assign(new Error("reset"), { code: "ECONNRESET" }),
    )
    .mockResolvedValueOnce({
      status: "completed",
      output: { provider: "openai", text: "done" },
    });
  const context = { cwd: ".", retryPolicy: { retries: 1, delayMs: 0 } };
  await expect(
    executeAsyncResearch({
      providerId: "openai",
      providerLabel: "OpenAI",
      context,
      start,
      poll,
    }),
  ).resolves.toMatchObject({ text: "done" });
  expect(start).toHaveBeenCalledTimes(1);
  expect(poll).toHaveBeenCalledTimes(2);
  poll.mockRejectedValue(
    Object.assign(new Error("reset"), { code: "ECONNRESET" }),
  );
  await expect(
    executeAsyncResearch({
      providerId: "openai",
      providerLabel: "OpenAI",
      context: { cwd: "." },
      start,
      poll,
    }),
  ).rejects.toMatchObject({ code: "PROVIDER_FAILURE" });
  expect(poll).toHaveBeenCalledTimes(3);
});
it("bounds retries and backoff by one overall deadline", async () => {
  vi.useFakeTimers();
  let notifyFirstFetch!: () => void;
  const firstFetch = new Promise<void>((resolve) => {
    notifyFirstFetch = resolve;
  });
  const fetch = vi.fn().mockImplementation(async () => {
    notifyFirstFetch();
    return new Response("busy", { status: 503 });
  });
  vi.stubGlobal("fetch", fetch);
  const client = createWebfox({
    config: { execution: { retries: 10, retryDelayMs: 60 } },
    env: { BRAVE_SEARCH_API_KEY: "key" },
  });
  const started = Date.now();
  const pending = client.search({
    provider: "brave",
    queries: ["test"],
    timeoutMs: 100,
  });
  // Wait for lazy adapter loading before advancing the simulated clock.
  await firstFetch;
  await vi.advanceTimersByTimeAsync(60);
  expect(fetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(40);
  const result = await pending;
  expect(result.results[0]).toMatchObject({ error: { code: "TIMEOUT" } });
  expect(Date.now() - started).toBe(100);
  await vi.advanceTimersByTimeAsync(500);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("never retries research creation and preserves explicit terminal errors", async () => {
  const start = vi
    .fn()
    .mockRejectedValue(
      new WebfoxError("PROVIDER_FAILURE", "busy", { retryable: true }),
    );
  await expect(
    executeAsyncResearch({
      providerId: "openai",
      providerLabel: "OpenAI",
      context: { cwd: "." },
      start,
      poll: vi.fn(),
    }),
  ).rejects.toMatchObject({ code: "PROVIDER_FAILURE" });
  expect(start).toHaveBeenCalledTimes(1);
  await expect(
    executeAsyncResearch({
      providerId: "openai",
      providerLabel: "OpenAI",
      context: { cwd: "." },
      start: async () => ({ id: "job" }),
      poll: async () => ({ status: "cancelled", error: "stopped remotely" }),
    }),
  ).rejects.toMatchObject({ code: "CANCELLED" });
});
