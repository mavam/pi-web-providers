import { describe, expect, it, vi, afterEach } from "vitest";
import {
  createWebfox,
  type ProgressEvent,
  type ProviderId,
} from "../src/index.js";
import { customConfig } from "./helpers.js";
afterEach(() => vi.unstubAllGlobals());

describe("application contracts", () => {
  it.each(["claude", "codex"])(
    "rejects removed %s request overrides",
    async (provider) => {
      const client = createWebfox({ config: customConfig() });
      await expect(
        client.search({
          queries: ["example"],
          provider: provider as ProviderId,
        }),
      ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
      expect(client.listProviders().map(({ id }) => id)).not.toContain(
        provider,
      );
    },
  );
  it.each(["search", "answer", "contents"] as const)(
    "reports ordered %s lifecycle updates including duplicate inputs and failures",
    async (capability) => {
      const config = customConfig();
      config.execution = { concurrency: 1 };
      const events: ProgressEvent[] = [];
      const inputs =
        capability === "contents"
          ? ["https://ok.test", "https://error.test", "https://ok.test"]
          : ["ok", "fail", "ok"];
      const client = createWebfox({ config });
      const request = {
        onProgress: (event: ProgressEvent) => {
          if (event.state) events.push(event);
        },
      };
      if (capability === "contents")
        await client.contents({ ...request, urls: inputs });
      else await client[capability]({ ...request, queries: inputs });
      expect(
        events.map(({ inputIndex, state }) => [inputIndex, state]),
      ).toEqual([
        [0, "queued"],
        [1, "queued"],
        [2, "queued"],
        [0, "running"],
        [0, "done"],
        [1, "running"],
        [1, "failed"],
        [2, "running"],
        [2, "done"],
      ]);
      for (const event of events)
        expect(event.input).toBe(inputs[event.inputIndex!]);
    },
  );
  it.each(["search", "answer", "contents"] as const)(
    "keeps completed %s inputs done and marks queued inputs cancelled",
    async (capability) => {
      const config = customConfig();
      config.execution = { concurrency: 1 };
      const controller = new AbortController();
      const events: ProgressEvent[] = [];
      const client = createWebfox({ config });
      const request = {
        signal: controller.signal,
        onProgress(event: ProgressEvent) {
          if (event.state) events.push(event);
          if (event.state === "done") controller.abort();
        },
      };
      const result =
        capability === "contents"
          ? await client.contents({
              ...request,
              urls: ["https://ok.test", "https://slow.test"],
            })
          : await client[capability]({ ...request, queries: ["ok", "slow"] });
      expect(result.results.map((entry) => entry.ok)).toEqual([true, false]);
      expect(events.map(({ state }) => state)).toEqual([
        "queued",
        "queued",
        "running",
        "done",
        "cancelled",
      ]);
    },
  );
  it("redacts URL lifecycle events and ignores observer exceptions", async () => {
    const config = customConfig();
    config.providers!.custom!.commands!.contents!.env = {
      SAFE_SECRET: { value: "private-key" },
    };
    const events: ProgressEvent[] = [];
    const result = await createWebfox({ config }).contents({
      urls: ["https://ok.test/private-key"],
      onProgress(event) {
        events.push(event);
        throw new Error("observer failure");
      },
    });
    expect(result.status).toBe("ok");
    expect(events.some((event) => event.state === "done")).toBe(true);
    expect(JSON.stringify(events)).not.toContain("private-key");
  });
  it.each(["ok", "fail"])(
    "reports research lifecycle for %s",
    async (input) => {
      const events: ProgressEvent[] = [];
      await createWebfox({ config: customConfig() }).research({
        input,
        onProgress: (event) => {
          if (event.state) events.push(event);
        },
      });
      expect(events.map(({ state }) => state)).toEqual([
        "queued",
        "running",
        input === "ok" ? "done" : "failed",
      ]);
      for (const event of events)
        expect(event).toMatchObject({
          inputIndex: 0,
          input,
          capability: "research",
        });
    },
  );
  it("never selects a provider from credentials", async () => {
    const client = createWebfox({
      config: {},
      env: { BRAVE_SEARCH_API_KEY: "present" },
    });
    await expect(client.search({ queries: ["hello"] })).rejects.toThrow(
      "web config default search brave",
    );
  });
  it("preserves ordered partial results and provider option precedence", async () => {
    const config = customConfig();
    config.providers!.custom!.options = {
      search: { shared: "provider", nested: { one: 1 } },
    };
    const result = await createWebfox({ config }).search({
      queries: ["slow", "fail", "third"],
      timeoutMs: 250,
      options: { shared: "call", nested: { two: 2 } },
    });
    expect(result.results.map((entry) => [entry.input, entry.ok])).toEqual([
      ["slow", false],
      ["fail", false],
      ["third", true],
    ]);
    expect(result.results[0]).toMatchObject({ error: { code: "TIMEOUT" } });
    const last = result.results[2];
    if (!last.ok) throw new Error("expected success");
    expect(last.value.results[0].metadata?.options).toEqual({
      shared: "call",
      nested: { one: 1, two: 2 },
    });
  });
  it("uses adapter input indexes even when redirected pages are reordered", async () => {
    const result = await createWebfox({ config: customConfig() }).contents({
      urls: [
        "https://redirected.test/article",
        "https://exact.test",
        "https://error.test",
      ],
    });
    expect(result.results[0]).toMatchObject({
      input: "https://redirected.test/article",
      ok: true,
      value: {
        url: "https://canonical.test/article",
        content: "Contents of https://redirected.test/article",
      },
    });
    expect(result.results[1]).toMatchObject({
      ok: true,
      value: { content: "Contents of https://exact.test" },
    });
    expect(result.results[2]).toMatchObject({
      ok: false,
      error: { code: "PROVIDER_FAILURE" },
    });
  });
  it("does not leak incompatible options when switching providers", async () => {
    const config = customConfig();
    config.providers!.custom!.options = { search: { customOnly: true } };
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ web: { results: [] } })),
      );
    vi.stubGlobal("fetch", fetch);
    const result = await createWebfox({
      config,
      env: { BRAVE_SEARCH_API_KEY: "secret" },
    }).search({ provider: "brave", queries: ["brave"] });
    expect(result.status).toBe("ok");
    expect(String(fetch.mock.calls[0][0])).not.toContain("customOnly");
  });
  it("redacts results, object keys, progress, inputs, and structured errors consistently", async () => {
    const config = customConfig();
    config.providers!.custom!.commands!.answer = {
      argv: [
        process.execPath,
        "-e",
        'const s=process.env.SAFE_SECRET; process.stderr.write(s.slice(0,5)); setTimeout(()=>{process.stderr.write(s.slice(5)+"\\n"); console.log(JSON.stringify({text:s,metadata:{[s]:s,apiToken:"hidden"}}));},10)',
      ],
      env: { SAFE_SECRET: { value: "configured-secret" } },
    };
    const progress: string[] = [];
    const result = await createWebfox({ config }).answer({
      queries: ["configured-secret"],
      onProgress: (event) => progress.push(event.message),
    });
    expect(progress).toEqual([
      "queued: [redacted]",
      "running: [redacted]",
      "[redacted]",
      "done: [redacted]",
    ]);
    expect(JSON.stringify(result)).not.toContain("configured-secret");
    expect(JSON.stringify(result)).not.toContain("hidden");
    expect(result).not.toHaveProperty("raw");
  });
  it("returns cancellation without reclassifying message substrings", async () => {
    const controller = new AbortController();
    const client = createWebfox({ config: customConfig() });
    const pending = client.research({
      input: "slow",
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(new Error("any caller reason")), 30);
    expect((await pending).results[0]).toMatchObject({
      ok: false,
      error: { code: "CANCELLED" },
    });
    const config = customConfig();
    config.providers!.custom!.commands!.answer!.argv = [
      process.execPath,
      "-e",
      'console.error("timeout cancelled but not a timeout");process.exit(1)',
    ];
    expect(
      (await createWebfox({ config }).answer({ queries: ["x"] })).results[0],
    ).toMatchObject({ error: { code: "PROVIDER_FAILURE", retryable: false } });
  });
});
