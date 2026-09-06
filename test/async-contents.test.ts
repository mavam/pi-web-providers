import { afterEach, expect, it, vi } from "vitest";
import { createWebfox } from "../src/index.js";

const { contents, getContentsJob } = vi.hoisted(() => ({
  contents: vi.fn(),
  getContentsJob: vi.fn(),
}));
vi.mock("valyu-js", () => ({
  Valyu: class {
    contents = contents;
    getContentsJob = getContentsJob;
  },
}));
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

it("polls async contents without hiding work in an SDK waiter and retains reported URLs", async () => {
  vi.useFakeTimers();
  contents.mockResolvedValue({
    success: true,
    jobId: "job",
    status: "pending",
  });
  getContentsJob
    .mockResolvedValueOnce({ success: true, status: "processing" })
    .mockResolvedValueOnce({
      success: true,
      status: "completed",
      results: [
        { status: "success", url: "https://final.test", content: "page" },
      ],
    });
  const client = createWebfox({
    config: {},
    env: { VALYU_API_KEY: "test-key" },
  });
  const pending = client.contents({
    provider: "valyu",
    urls: ["https://original.test"],
  });
  await vi.dynamicImportSettled();
  await vi.advanceTimersByTimeAsync(3000);
  expect((await pending).results[0]).toMatchObject({
    input: "https://original.test",
    ok: true,
    value: { url: "https://final.test", content: "page" },
  });
  expect(contents).toHaveBeenCalledTimes(1);
  expect(getContentsJob).toHaveBeenCalledTimes(2);
});

it("does not create a second contents job when a poll fails, even with retries enabled", async () => {
  contents.mockResolvedValue({
    success: true,
    jobId: "job",
    status: "pending",
  });
  getContentsJob.mockRejectedValue(
    Object.assign(new Error("connection reset"), { code: "ECONNRESET" }),
  );
  const client = createWebfox({
    config: { execution: { retries: 3, retryDelayMs: 0 } },
    env: { VALYU_API_KEY: "test-key" },
  });
  expect(
    (
      await client.contents({
        provider: "valyu",
        urls: ["https://original.test"],
      })
    ).results[0],
  ).toMatchObject({ ok: false, error: { code: "PROVIDER_FAILURE" } });
  expect(contents).toHaveBeenCalledTimes(1);
});
