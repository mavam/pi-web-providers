import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { beforeAll, afterAll, beforeEach, expect, it } from "vitest";
import { createWebfox } from "../src/index.js";
import type { ProviderId } from "../src/domain.js";

let baseUrl: string;
let response: unknown;
const requests: Array<{ path: string; body: Record<string, any> }> = [];
const server = createServer(async (request, reply) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  requests.push({ path: request.url!, body: JSON.parse(body) });
  reply.writeHead(200, { "content-type": "application/json" });
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
});
function client(provider: ProviderId) {
  return createWebfox({
    config: {
      providers: {
        [provider]: {
          baseUrl,
          credentials: { api: { value: "local-test-key" } },
        },
      },
    },
    env: {},
  });
}

it("forwards Firecrawl's distinct search and scrape location shapes through its SDK", async () => {
  response = { success: true, data: { web: [] } };
  const options = {
    location: "Berlin, Germany",
    scrapeOptions: {
      location: { country: "DE", languages: ["de"] },
      waitFor: 100,
    },
  };
  const result = await client("firecrawl").search({
    provider: "firecrawl",
    queries: ["q"],
    options,
  });
  expect(result.status).toBe("ok");
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ path: "/v2/search", body: options });
});
it("forwards Parallel source, fetch, and excerpt settings to its current endpoint", async () => {
  response = { results: [] };
  const options = {
    mode: "fast",
    advanced_settings: {
      source_policy: { include_domains: ["example.com"] },
      fetch_policy: { max_age_seconds: 600 },
      excerpt_settings: { max_chars_per_result: 1200 },
    },
  };
  const result = await client("parallel").search({
    provider: "parallel",
    queries: ["q"],
    maxResults: 3,
    options,
  });
  expect(result.status).toBe("ok");
  expect(requests).toEqual([
    {
      path: "/v1/search",
      body: {
        ...options,
        search_queries: ["q"],
        objective: "q",
        advanced_settings: { ...options.advanced_settings, max_results: 3 },
      },
    },
  ]);
});
it("lets Tavily serialize enum controls and retains the requested answer", async () => {
  response = {
    results: [{ title: "Source", url: "https://example.com", content: "Text" }],
    answer: "Answer",
    images: [],
    response_time: 0.1,
  };
  const result = await client("tavily").search({
    provider: "tavily",
    queries: ["q"],
    options: {
      searchDepth: "fast",
      includeAnswer: "advanced",
      includeRawContent: "markdown",
    },
  });
  expect(result.status).toBe("ok");
  expect(requests[0]).toMatchObject({
    path: "/search",
    body: {
      search_depth: "fast",
      include_answer: "advanced",
      include_raw_content: "markdown",
    },
  });
  expect(result.results[0]).toMatchObject({
    ok: true,
    value: { results: [{ metadata: { answer: "Answer" } }] },
  });
});
it("forwards Perplexity Sonar retrieval settings separately from the standalone search endpoint", async () => {
  response = {
    id: "test",
    model: "sonar",
    choices: [{ message: { role: "assistant", content: "Answer" } }],
  };
  const options = {
    search_mode: "academic",
    max_tokens: 1024,
    reasoning_effort: "high",
    web_search_options: { search_context_size: "high" },
  };
  const result = await client("perplexity").answer({
    provider: "perplexity",
    queries: ["q"],
    options,
  });
  expect(result.status).toBe("ok");
  expect(requests[0]).toMatchObject({
    path: "/chat/completions",
    body: { ...options, stream: false },
  });
});
it("forwards Linkup's fetch strategy and retains requested raw content", async () => {
  response = {
    markdown: "Page",
    rawContent: "<main>Page</main>",
    contentType: "html",
    favicon: "https://example.com/icon.png",
  };
  const result = await client("linkup").contents({
    provider: "linkup",
    urls: ["https://example.com"],
    options: { mode: "pro", includeRawContent: true },
  });
  expect(result.status).toBe("ok");
  expect(requests[0]).toMatchObject({
    body: { mode: "pro", includeRawContent: true },
  });
  expect(result.results[0]).toMatchObject({
    ok: true,
    value: {
      content: "Page",
      metadata: { rawContent: "<main>Page</main>", contentType: "html" },
    },
  });
});

it("forwards OpenAI reasoning, output budgets, and explicit cache-only access", async () => {
  response = {
    id: "test",
    model: "test-model",
    status: "completed",
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: "Answer", annotations: [] }],
      },
    ],
    error: null,
    incomplete_details: null,
  };
  const result = await client("openai").answer({
    provider: "openai",
    queries: ["q"],
    options: {
      model: "test-model",
      reasoning: { effort: "high" },
      max_output_tokens: 1024,
      externalWebAccess: false,
    },
  });
  expect(result.status).toBe("ok");
  expect(requests[0]).toMatchObject({
    path: "/responses",
    body: {
      reasoning: { effort: "high" },
      max_output_tokens: 1024,
      tools: [{ type: "web_search", external_web_access: false }],
    },
  });
});
