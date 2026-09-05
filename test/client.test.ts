import { describe, expect, it, vi, afterEach } from "vitest";
import { createWebMux } from "../src/index.js";
import { customConfig } from "./helpers.js";
afterEach(() => vi.unstubAllGlobals());

describe("application contracts", () => {
  it("never selects a provider from credentials", async () => {
    const client = createWebMux({
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
    const result = await createWebMux({ config }).search({
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
    const result = await createWebMux({ config: customConfig() }).contents({
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
    const result = await createWebMux({
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
    const result = await createWebMux({ config }).answer({
      queries: ["configured-secret"],
      onProgress: (event) => progress.push(event.message),
    });
    expect(progress).toEqual(["[redacted]"]);
    expect(JSON.stringify(result)).not.toContain("configured-secret");
    expect(JSON.stringify(result)).not.toContain("hidden");
    expect(result).not.toHaveProperty("raw");
  });
  it("returns cancellation without reclassifying message substrings", async () => {
    const controller = new AbortController();
    const client = createWebMux({ config: customConfig() });
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
      (await createWebMux({ config }).answer({ queries: ["x"] })).results[0],
    ).toMatchObject({ error: { code: "PROVIDER_FAILURE", retryable: false } });
  });
});
