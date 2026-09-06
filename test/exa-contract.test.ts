import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { Type, type TObject } from "typebox";
import { createWebfox } from "../src/index.js";
import { optionSchema } from "../src/configuration/planning.js";
import { exaProvider } from "../src/providers/exa/definition.js";
import { prepareToolArguments } from "../src/pi-validation.js";

const requests: Array<{ path: string; body: Record<string, any> }> = [];
let response: unknown;
let status = 200;
let baseUrl: string;
const server = createServer(async (request, reply) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  requests.push({ path: request.url!, body: JSON.parse(body) });
  reply.writeHead(status, { "content-type": "application/json" });
  reply.end(JSON.stringify(response));
});
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
beforeEach(() => {
  requests.length = 0;
  status = 200;
  response = {
    results: [{ title: "Source", url: "https://example.com", text: "Excerpt" }],
  };
});
function client() {
  return createWebfox({
    config: {
      execution: { retries: 1 },
      providers: {
        exa: {
          baseUrl,
          credentials: { api: { value: "local-test-key" } },
        },
      },
    },
    env: {},
  });
}

it.each([-1, 0, 24, 720])(
  "forwards nested freshness %i through the real Exa SDK",
  async (maxAgeHours) => {
    const result = await client().search({
      provider: "exa",
      queries: ["query"],
      maxResults: 5,
      options: { contents: { text: { maxCharacters: 3000 }, maxAgeHours } },
    });
    expect(result.status).toBe("ok");
    expect(requests).toEqual([
      {
        path: "/search",
        body: {
          query: "query",
          type: "auto",
          numResults: 5,
          contents: { text: { maxCharacters: 3000 }, maxAgeHours },
        },
      },
    ]);
  },
);

it.each([
  { maxAgeHours: 0 },
  { contents: { livecrawl: "always", maxAgeHours: 0 } },
  { contents: { maxAgeHours: -2 } },
  { contents: { maxAgeHours: 0.5 } },
  { contents: { maxAgeHours: 721 } },
  { contents: { livecrawlTimeout: 0 } },
  { contents: { livecrawlTimeout: 90001 } },
  { startCrawlDate: "2026-01-01" },
])(
  "rejects unsupported freshness options before contacting Exa: %j",
  async (options) => {
    await expect(
      client().search({ provider: "exa", queries: ["query"], options }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(requests).toEqual([]);
  },
);

it("guides misplaced freshness into contents and omits deprecated controls", () => {
  const options = optionSchema(exaProvider, "search")!;
  const schema = Type.Object({ queries: Type.Array(Type.String()), options });
  expect(() =>
    prepareToolArguments(schema, {
      queries: ["q"],
      options: { maxAgeHours: 0 },
    }),
  ).toThrow(
    "Invalid parameter: options.maxAgeHours. Use options.contents.maxAgeHours instead.",
  );
  expect((options.properties.contents as TObject).properties).not.toHaveProperty(
    "livecrawl",
  );
  expect(options.properties).not.toHaveProperty("startCrawlDate");
  expect(exaProvider.capabilities.search!.promptGuidelines!.join(" ")).toContain(
    "Remove livecrawl rather than moving it",
  );
});

it("uses /search, not retired /research, and preserves the synthesized report and sources", async () => {
  response = {
    output: { content: "# Research report\n\nFindings." },
    results: [{ title: "Source", url: "https://example.com" }],
  };
  const result = await client().research({
    provider: "exa",
    input: "research question",
  });
  expect(result.results[0]).toMatchObject({
    ok: true,
    value: {
      text: "# Research report\n\nFindings.\n\nSources:\n1. Source\n   https://example.com",
      itemCount: 1,
    },
  });
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    path: "/search",
    body: {
      query: "research question",
      type: "deep-reasoning",
      outputSchema: { type: "text" },
    },
  });
});

it("does not silently succeed without a synthesized report", async () => {
  const result = await client().research({
    provider: "exa",
    input: "question",
  });
  expect(result.results[0]).toMatchObject({
    ok: false,
    error: {
      code: "PROVIDER_FAILURE",
      message: "Exa returned no research report.",
    },
  });
  expect(requests).toHaveLength(1);
});

it("does not repeat a failed research request", async () => {
  status = 503;
  response = { error: "unavailable" };
  const result = await client().research({
    provider: "exa",
    input: "question",
  });
  expect(result.status).toBe("partial");
  expect(requests).toHaveLength(1);
});
