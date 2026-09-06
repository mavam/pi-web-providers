import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adapter,
  geminiImplementation,
} from "../src/providers/gemini/adapter.js";
import { createWebfox, parseConfig } from "../src/index.js";
import type { Gemini } from "../src/providers/gemini/types.js";
import type { ProviderContext } from "../src/providers/contract.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Gemini capability boundaries", () => {
  it("offers answers and research, not standalone search", async () => {
    const client = createWebfox({
      config: {},
      env: { GOOGLE_API_KEY: "test-key" },
    });
    const provider = client.getProvider("gemini")!;
    expect(provider.capabilities).toEqual(["answer", "research"]);
    expect(provider.configured).toEqual(["answer", "research"]);
    expect("search" in adapter).toBe(false);
    expect("search" in geminiImplementation).toBe(false);
    await expect(
      client.search({ provider: "gemini", queries: ["test"] }),
    ).rejects.toThrow("does not support search");
  });
  it("rejects obsolete Gemini search configuration", () => {
    expect(() =>
      createWebfox({
        config: { defaults: { search: { provider: "gemini" } } },
      }),
    ).toThrow();
    expect(() =>
      parseConfig("providers:\n  gemini:\n    options:\n      search: {}\n"),
    ).toThrow();
  });
});

describe("Gemini provider answer", () => {
  it("supports provider-specific request options for answers while keeping Google Search grounding enabled", async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: "Grounded answer",
      candidates: [],
    });

    const provider = createProvider({ models: { generateContent } });
    await provider.answer("What changed?", createConfig(), createContext(), {
      model: "gemini-2.5-pro",
      config: {
        labels: {
          route: "answer",
        },
        temperature: 0.1,
        tools: [{ urlContext: {} }],
      },
    });

    expect(generateContent).toHaveBeenCalledWith({
      model: "gemini-2.5-pro",
      contents: "What changed?",
      config: {
        labels: {
          route: "answer",
        },
        temperature: 0.1,
        tools: [{ googleSearch: {} }],
      },
    });
  });

  it("suppresses opaque grounding redirect URLs and dedupes source display", async () => {
    const provider = createProvider({
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: "ACME platforms help teams route and transform operational data.",
          candidates: [
            {
              groundingMetadata: {
                groundingChunks: [
                  {
                    web: {
                      title: "ACME overview",
                      uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/opaque-1",
                    },
                  },
                  {
                    web: {
                      title: "ACME docs",
                      uri: "https://example.com/docs",
                    },
                  },
                  {
                    web: {
                      title: "ACME overview",
                      uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/opaque-2",
                    },
                  },
                ],
              },
            },
          ],
        }),
      },
    });

    const response = await provider.answer(
      "ACME platform use cases",
      createConfig(),
      createContext(),
      undefined,
    );

    expect(response.text).toContain(
      "ACME platforms help teams route and transform operational data.",
    );
    expect(response.text).toContain("Sources:\n1. ACME overview\n2. ACME docs");
    expect(response.text).toContain("   https://example.com/docs");
    expect(response.text).not.toContain("vertexaisearch.cloud.google.com");
    expect(response.itemCount).toBe(2);
  });
});

it("does not expose a contents handler", () => {
  expect("contents" in geminiImplementation).toBe(false);
});

describe("Gemini provider research", () => {
  it("starts Gemini deep research with supported request options", async () => {
    const create = vi.fn().mockResolvedValue({ id: "research-1" });

    const provider = createProvider({
      interactions: {
        create,
      },
    });

    const job = await provider.startResearch!(
      "Investigate ACME platform use cases",
      createConfig(),
      { ...createContext(), idempotencyKey: "stable-key" },
      undefined,
    );

    expect(job).toEqual({ id: "research-1" });
    expect(create).toHaveBeenCalledWith(
      {
        input: "Investigate ACME platform use cases",
        agent: "deep-research-preview-04-2026",
        background: true,
      },
      { idempotencyKey: "stable-key", maxRetries: 0 },
    );
  });

  it("rejects unsupported Gemini deep-research options", async () => {
    const create = vi.fn().mockResolvedValue({ id: "research-1" });
    const provider = createProvider({ interactions: { create } });

    await expect(
      provider.startResearch!(
        "Investigate ACME platform use cases",
        createConfig(),
        createContext(),
        { tools: [] },
      ),
    ).rejects.toThrow("Unsupported Gemini research options: tools.");
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects unsupported Gemini deep-research agent configuration", async () => {
    const create = vi.fn().mockResolvedValue({ id: "research-1" });
    const provider = createProvider({ interactions: { create } });

    await expect(
      provider.startResearch!(
        "Investigate ACME platform use cases",
        createConfig(),
        createContext(),
        {
          agent_config: {
            response_length: "short",
          },
        },
      ),
    ).rejects.toThrow(
      "Unsupported Gemini agent_config options: response_length.",
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("forwards supported Gemini deep-research agent configuration", async () => {
    const create = vi.fn().mockResolvedValue({ id: "research-1" });

    const provider = createProvider({
      interactions: {
        create,
      },
    });

    await provider.startResearch!(
      "Investigate ACME platform use cases",
      createConfig(),
      createContext(),
      {
        agent_config: {
          thinking_summaries: "auto",
        },
      },
    );

    expect(create).toHaveBeenCalledWith(
      {
        agent_config: {
          type: "deep-research",
          thinking_summaries: "auto",
        },
        input: "Investigate ACME platform use cases",
        agent: "deep-research-preview-04-2026",
        background: true,
      },
      { maxRetries: 0 },
    );
  });

  it("returns in-progress Gemini research status from polling", async () => {
    const get = vi.fn().mockResolvedValue({ status: "in_progress" });

    const provider = createProvider({
      interactions: {
        get,
      },
    });

    const result = await provider.pollResearch!(
      "research-1",
      createConfig(),
      createContext(),
      undefined,
    );

    expect(get).toHaveBeenCalledWith("research-1", undefined, {
      maxRetries: 0,
    });
    expect(result).toEqual({ status: "in_progress" });
  });

  it("formats completed Gemini research output from polling", async () => {
    const get = vi.fn().mockResolvedValue({
      status: "completed",
      steps: [
        { type: "user_input" },
        {
          type: "model_output",
          content: [{ type: "text", text: "Research result" }],
        },
      ],
    });

    const provider = createProvider({
      interactions: {
        get,
      },
    });

    const result = await provider.pollResearch!(
      "research-1",
      createConfig(),
      createContext(),
      undefined,
    );

    expect(result).toEqual({
      status: "completed",
      output: {
        provider: "gemini",
        text: "Research result",
      },
    });
  });

  it("maps failed Gemini research polling to a terminal status", async () => {
    const get = vi.fn().mockResolvedValue({ status: "failed" });

    const provider = createProvider({
      interactions: {
        get,
      },
    });

    const result = await provider.pollResearch!(
      "research-1",
      createConfig(),
      createContext(),
      undefined,
    );

    expect(result).toEqual({
      status: "failed",
      error: "research failed",
    });
  });

  it("surfaces unknown Gemini research states as progress text", async () => {
    const get = vi.fn().mockResolvedValue({ status: "running" });

    const provider = createProvider({
      interactions: {
        get,
      },
    });

    const result = await provider.pollResearch!(
      "research-1",
      createConfig(),
      createContext(),
      undefined,
    );

    expect(result).toEqual({
      status: "in_progress",
      statusText: "running",
    });
  });

  it("treats incomplete Gemini research as terminal failure", async () => {
    const get = vi.fn().mockResolvedValue({ status: "incomplete" });

    const provider = createProvider({
      interactions: {
        get,
      },
    });

    const result = await provider.pollResearch!(
      "research-1",
      createConfig(),
      createContext(),
      undefined,
    );

    expect(result).toEqual({
      status: "failed",
      error: "research ended incomplete",
    });
  });

  it("treats requires_action Gemini research as terminal failure", async () => {
    const get = vi.fn().mockResolvedValue({
      status: "requires_action",
      steps: [{ type: "user_input" }, { type: "function_call" }],
    });

    const provider = createProvider({
      interactions: {
        get,
      },
    });

    const result = await provider.pollResearch!(
      "research-1",
      createConfig(),
      createContext(),
      undefined,
    );

    expect(result).toEqual({
      status: "failed",
      error: "research requires additional action (function_call)",
    });
  });
});

function createProvider(client: unknown) {
  return {
    ...geminiImplementation,
    createClient: () => client,
  } as typeof geminiImplementation;
}

function createConfig(): Gemini {
  return {
    credentials: { api: "literal-key" },
  };
}

function createContext(): ProviderContext {
  return {
    cwd: process.cwd(),
  };
}
