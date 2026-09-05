import { expect, it } from "vitest";
import { createWebMux } from "../src/index.js";
import { customConfig } from "./helpers.js";
it.each([
  [{ url: "https://test" }],
  [{ inputIndex: -1, url: "https://test" }],
  [{ inputIndex: 1, url: "https://test" }],
  [
    { inputIndex: 0, url: "https://test" },
    { inputIndex: 0, url: "https://test" },
  ],
])(
  "rejects missing, out-of-range, and duplicate contents indexes (%#)",
  async (...answers) => {
    const config = customConfig();
    config.providers!.custom!.commands!.contents!.argv = [
      process.execPath,
      "-e",
      `console.log(${JSON.stringify(JSON.stringify({ answers }))})`,
    ];
    const result = await createWebMux({ config }).contents({
      urls: ["https://test"],
    });
    expect(result.results[0]).toMatchObject({
      ok: false,
      error: { code: "PROVIDER_FAILURE" },
    });
  },
);
it("keeps completed contents when another URL exceeds the deadline", async () => {
  const result = await createWebMux({ config: customConfig() }).contents({
    urls: ["https://fast.test", "https://slow.test"],
    timeoutMs: 250,
  });
  expect(result.results[0]).toMatchObject({
    input: "https://fast.test",
    ok: true,
  });
  expect(result.results[1]).toMatchObject({
    input: "https://slow.test",
    ok: false,
    error: { code: "TIMEOUT" },
  });
});
it("smokes all four custom-provider operations through the public API", async () => {
  const client = createWebMux({ config: customConfig() });
  expect((await client.search({ queries: ["custom"] })).status).toBe("ok");
  expect(
    (await client.contents({ urls: ["https://example.test"] })).status,
  ).toBe("ok");
  expect((await client.answer({ queries: ["custom"] })).status).toBe("ok");
  expect((await client.research({ input: "custom" })).status).toBe("ok");
});
