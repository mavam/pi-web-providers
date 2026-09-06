import { expect, it } from "vitest";
import type { GenerateContentConfig } from "@google/genai";
import { ThinkingLevel } from "@google/genai";
import type { SearchRequest, ScrapeOptions } from "@mendable/firecrawl-js";
import type { TavilySearchOptions, TavilyExtractOptions } from "@tavily/core";
import type { SearchParams } from "parallel-web/resources/top-level";
import type { MarkdownCreateParams } from "cloudflare/resources/browser-rendering/markdown";
import type { CompletionCreateParams } from "@perplexity-ai/perplexity_ai/resources/chat/completions";
import type { FetchParams } from "linkup-sdk";
import type { DeepResearchTools } from "valyu-js";
import type { Capability, ProviderId } from "../src/domain.js";
import { providers } from "../src/providers/registry.js";
import { validateOptions } from "../src/configuration/planning.js";

// SDK type checks catch upstream removals/renames; runtime checks catch drift
// between those types and the schemas actually exposed to callers.
const samples: Array<{
  provider: ProviderId;
  capability: Capability;
  options: Record<string, unknown>;
}> = [
  {
    provider: "gemini",
    capability: "answer",
    options: {
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        maxOutputTokens: 1024,
      } satisfies GenerateContentConfig,
    },
  },
  {
    provider: "firecrawl",
    capability: "search",
    options: {
      location: "Berlin, Germany",
      sources: ["web"],
      categories: ["developer"],
      scrapeOptions: {
        location: { country: "DE", languages: ["de"] },
        waitFor: 100,
      },
    } satisfies Omit<SearchRequest, "query">,
  },
  {
    provider: "firecrawl",
    capability: "contents",
    options: {
      location: { country: "US", languages: ["en"] },
      redactPII: { mode: "fast", entities: ["EMAIL"] },
    } satisfies ScrapeOptions,
  },
  {
    provider: "tavily",
    capability: "search",
    options: {
      searchDepth: "ultra-fast",
      includeAnswer: "advanced",
      includeRawContent: "markdown",
      timeRange: "week",
    } satisfies TavilySearchOptions,
  },
  {
    provider: "tavily",
    capability: "contents",
    options: {
      extractDepth: "advanced",
      query: "release dates",
      chunksPerSource: 3,
      timeout: 30,
    } satisfies TavilyExtractOptions,
  },
  {
    provider: "parallel",
    capability: "search",
    options: {
      mode: "fast",
      objective: "Find official docs",
      advanced_settings: {
        source_policy: { include_domains: ["example.com"] },
        fetch_policy: { max_age_seconds: 600 },
        excerpt_settings: { max_chars_per_result: 2000 },
      },
    } satisfies Omit<SearchParams, "search_queries">,
  },
  {
    provider: "cloudflare",
    capability: "contents",
    options: {
      gotoOptions: { timeout: 10000, waitUntil: "domcontentloaded" },
      waitForSelector: { selector: "main", visible: true },
    } satisfies Omit<MarkdownCreateParams, "account_id" | "url">,
  },
  {
    provider: "perplexity",
    capability: "research",
    options: {
      model: "sonar-deep-research",
      reasoning_effort: "high",
      max_tokens: 2000,
      search_mode: "academic",
      web_search_options: { search_context_size: "high" },
    } satisfies Omit<CompletionCreateParams, "messages">,
  },
  {
    provider: "linkup",
    capability: "contents",
    options: {
      mode: "pro",
      includeRawContent: true,
      extractImages: true,
    } satisfies Omit<FetchParams, "url">,
  },
  {
    provider: "valyu",
    capability: "research",
    options: {
      tools: {
        browser_use: { enabled: true, max_calls: 3 },
        screenshots: false,
      } satisfies DeepResearchTools,
    },
  },
];
it.each(samples)(
  "accepts SDK-backed $provider $capability controls",
  ({ provider, capability, options }) => {
    expect(() =>
      validateOptions(providers[provider], capability, options),
    ).not.toThrow();
  },
);

it("isolates provider schemas and keeps host-managed controls unavailable", () => {
  for (const definition of Object.values(providers)) {
    if (definition.id === "custom") continue;
    for (const capability of Object.keys(
      definition.capabilities,
    ) as Capability[]) {
      expect(() =>
        validateOptions(definition, capability, {
          commands: { search: "malicious" },
        }),
      ).toThrow();
      expect(() =>
        validateOptions(definition, capability, {
          unknownProviderControl: true,
        }),
      ).toThrow();
    }
  }
});
it.each([
  ["firecrawl", "search", { location: { country: "US" } }],
  ["firecrawl", "contents", { location: { city: "Boston" } }],
  ["tavily", "contents", { extractDepth: "deep" }],
  ["perplexity", "search", { search_mode: "invented" }],
  ["openai", "research", { userLocation: { country: "US" } }],
  ["valyu", "research", { tools: { browser_use: { arbitrarySetting: true } } }],
] as const)(
  "rejects invalid %s %s combinations",
  (provider, capability, options) => {
    expect(() =>
      validateOptions(providers[provider], capability, options),
    ).toThrow();
  },
);
