import { beforeAll, describe, expect, it } from "vitest";
import { __test__ } from "../../src/index.js";
import type { ContentsResponse } from "../../src/contents.js";
import { PROVIDERS_BY_ID } from "../../src/providers/index.js";
import type {
  ProviderConfig,
  SearchResponse,
  ToolOutput,
  WebProviders,
} from "../../src/types.js";
import {
  getMissingLiveApiSecrets,
  type LiveApiContract,
  selectLiveApiContracts,
} from "../live-api-contracts.js";

const isLiveApiEnabled = process.env.LIVE_API_TESTS === "1";
const describeLive = isLiveApiEnabled ? describe.sequential : describe.skip;
const selectedContracts = isLiveApiEnabled ? selectLiveApiContracts() : [];

describeLive("live API provider contracts", () => {
  beforeAll(() => {
    if (selectedContracts.length === 0) {
      throw new Error(
        "LIVE_API_TESTS=1 but no live API contracts were selected. Check LIVE_API_PROVIDERS and LIVE_API_CAPABILITIES.",
      );
    }

    const missingSecrets = getMissingLiveApiSecrets(selectedContracts);
    if (missingSecrets.length > 0) {
      throw new Error(
        [
          "LIVE_API_TESTS=1 selected live API contracts but required environment variables are missing:",
          missingSecrets.join(", "),
          "Set LIVE_API_PROVIDERS or LIVE_API_CAPABILITIES to run a smaller subset.",
        ].join(" "),
      );
    }
  });

  for (const contract of selectedContracts) {
    it(
      `${contract.provider}/${contract.capability} satisfies the live contract`,
      async () => {
        const config = buildLiveConfig(contract);
        const status = __test__.getProviderStatusForTool(
          config,
          process.cwd(),
          contract.provider,
          contract.capability,
        );

        expect(status.state).toBe("ready");

        const result = await __test__.executeRawProviderRequest({
          capability: contract.capability,
          config,
          explicitProvider: contract.provider,
          ctx: { cwd: process.cwd() },
          signal: AbortSignal.timeout(contract.timeoutMs),
          options: contract.options,
          maxResults: contract.maxResults,
          urls: contract.urls ? [...contract.urls] : undefined,
          query: contract.query,
          input: contract.input,
        });

        assertLiveResult(contract, result);
      },
      contract.timeoutMs + 5_000,
    );
  }
});

function buildLiveConfig(contract: LiveApiContract): WebProviders {
  const providerConfig = PROVIDERS_BY_ID[
    contract.provider
  ].config.createTemplate() as ProviderConfig;

  return {
    tools: {
      [contract.capability]: contract.provider,
    } as WebProviders["tools"],
    settings: {
      requestTimeoutMs: Math.min(contract.timeoutMs, 90_000),
      retryCount: 0,
      retryDelayMs: 500,
      researchTimeoutMs: contract.timeoutMs,
    },
    providers: {
      [contract.provider]: providerConfig,
    } as WebProviders["providers"],
  };
}

function assertLiveResult(
  contract: LiveApiContract,
  result: SearchResponse | ContentsResponse | ToolOutput,
): void {
  expect(result.provider).toBe(contract.provider);

  switch (contract.capability) {
    case "search":
      assertSearchResult(contract, result as SearchResponse);
      return;
    case "contents":
      assertContentsResult(contract, result as ContentsResponse);
      return;
    case "answer":
    case "research":
      assertToolOutput(contract, result as ToolOutput);
      return;
  }
}

function assertSearchResult(
  contract: LiveApiContract,
  result: SearchResponse,
): void {
  expect(result.results.length).toBeGreaterThan(0);
  expect(result.results.length).toBeLessThanOrEqual(contract.maxResults ?? 2);

  for (const item of result.results) {
    expect(isNonEmptyString(item.url)).toBe(true);
    expect(() => new URL(item.url)).not.toThrow();
    expect(isNonEmptyString(item.title) || isNonEmptyString(item.snippet)).toBe(
      true,
    );
  }
}

function assertContentsResult(
  contract: LiveApiContract,
  result: ContentsResponse,
): void {
  expect(result.answers.length).toBe(contract.urls?.length ?? 0);

  const readableAnswers = result.answers.filter(
    (answer) =>
      isNonEmptyString(answer.content) || isNonEmptyString(answer.summary),
  );
  expect(readableAnswers.length).toBeGreaterThan(0);
}

function assertToolOutput(contract: LiveApiContract, result: ToolOutput): void {
  const text = result.text.trim();
  expect(text.length).toBeGreaterThan(
    contract.capability === "research" ? 40 : 20,
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
