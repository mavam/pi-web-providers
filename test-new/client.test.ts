import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createWebMux, type WebMuxConfig } from "../src/index.js";

const fixture = resolve("test-new/fixtures/custom-provider.mjs");

function config(): WebMuxConfig {
  const command = {
    argv: [process.execPath, fixture] as [string, ...string[]],
    env: { SAFE_SECRET: { value: "configured-secret" } },
  };
  return {
    defaults: {
      search: {
        provider: "custom",
        options: { shared: "default", nested: { one: 1 } },
      },
      contents: { provider: "custom" },
      answer: { provider: "custom" },
      research: { provider: "custom" },
    },
    providers: {
      custom: {
        options: { search: { shared: "provider", nested: { two: 2 } } },
        commands: {
          search: command,
          contents: command,
          answer: command,
          research: command,
        },
      },
    },
  };
}

describe("web-mux client", () => {
  it("does not choose an implicit provider", async () => {
    const client = createWebMux({ config: {} });
    await expect(client.search({ queries: ["hello"] })).rejects.toThrow(
      /Compatible providers/,
    );
  });

  it("preserves batch ordering and returns partial results", async () => {
    const result = await createWebMux({ config: config() }).search({
      queries: ["first", "fail", "third"],
    });
    expect(result.status).toBe("partial");
    expect(result.results.map((entry) => entry.input)).toEqual([
      "first",
      "fail",
      "third",
    ]);
    expect(result.results.map((entry) => entry.ok)).toEqual([
      true,
      false,
      true,
    ]);
  });

  it("applies default, configured, and call option precedence with nested merging", async () => {
    const result = await createWebMux({ config: config() }).search({
      queries: ["options"],
      options: { shared: "call", nested: { three: 3 } },
    });
    const metadata = result.results[0].value?.results[0].metadata as any;
    expect(metadata.options).toEqual({
      shared: "call",
      nested: { one: 1, two: 2, three: 3 },
    });
  });

  it("maps per-URL content failures without losing successful content", async () => {
    const result = await createWebMux({ config: config() }).contents({
      urls: ["https://one.test", "https://error.test", "https://three.test"],
    });
    expect(result.status).toBe("partial");
    expect(result.results.map((entry) => entry.ok)).toEqual([
      true,
      false,
      true,
    ]);
  });

  it("captures unstable raw output and redacts secret-looking fields", async () => {
    const result = await createWebMux({ config: config() }).answer({
      queries: ["question"],
      raw: true,
    });
    expect(result.results[0].raw).toMatchObject({
      providerPayload: { metadata: { apiToken: "[redacted]" } },
    });
    expect(JSON.stringify(result)).not.toContain("must-not-leak");
    expect(JSON.stringify(result)).not.toContain("configured-secret");
  });

  it("forwards research progress and cancellation", async () => {
    const controller = new AbortController();
    const messages: string[] = [];
    const promise = createWebMux({ config: config() }).research({
      input: "slow",
      signal: controller.signal,
      onProgress: (event) => messages.push(event.message),
    });
    setTimeout(
      () => controller.abort(new DOMException("cancelled", "AbortError")),
      20,
    );
    const result = await promise;
    expect(result.status).toBe("partial");
    expect(result.results[0].error?.code).toBe("CANCELLED");
  });
});
