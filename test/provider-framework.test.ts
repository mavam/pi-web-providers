import { describe, expect, it } from "vitest";
import { buildProviderPlan } from "../src/providers/framework.js";

describe("provider framework", () => {
  it("builds silent foreground plans with inherited settings", () => {
    const plan = buildProviderPlan({
      request: {
        capability: "search",
        query: "latest docs",
        maxResults: 3,
      },
      config: {
        settings: {
          requestTimeoutMs: 1000,
          retryCount: 2,
        },
      },
      providerId: "exa",
      providerLabel: "Exa",
      handlers: {
        search: {
          deliveryMode: "silent-foreground",
          execute: async () => ({
            provider: "exa",
            results: [],
          }),
        },
      },
    });

    expect(plan).toMatchObject({
      capability: "search",
      deliveryMode: "silent-foreground",
      traits: {
        settings: {
          requestTimeoutMs: 1000,
          retryCount: 2,
        },
      },
    });
  });

  it("builds streaming foreground plans with explicit execution traits", () => {
    const plan = buildProviderPlan({
      request: {
        capability: "research",
        input: "Investigate",
      },
      config: {},
      providerId: "perplexity",
      providerLabel: "Perplexity",
      handlers: {
        research: {
          deliveryMode: "streaming-foreground",
          traits: {
            executionSupport: {
              requestTimeoutMs: true,
              retryCount: true,
              retryDelayMs: true,
              pollIntervalMs: false,
              timeoutMs: false,
              maxConsecutivePollErrors: false,
              resumeId: false,
            },
          },
          execute: async () => ({
            provider: "perplexity",
            text: "done",
          }),
        },
      },
    });

    expect(plan).toMatchObject({
      capability: "research",
      deliveryMode: "streaming-foreground",
      traits: {
        executionSupport: {
          requestTimeoutMs: true,
          retryCount: true,
          retryDelayMs: true,
          pollIntervalMs: false,
          timeoutMs: false,
          maxConsecutivePollErrors: false,
          resumeId: false,
        },
      },
    });
  });

  it("builds background research plans and uses a custom plan-config resolver", async () => {
    const plan = buildProviderPlan({
      request: {
        capability: "research",
        input: "Investigate",
      },
      config: {
        settings: {
          researchTimeoutMs: 5000,
        },
        ignored: true,
      },
      providerId: "gemini",
      providerLabel: "Gemini",
      resolvePlanConfig: (config) => ({
        settings: config.settings,
      }),
      handlers: {
        research: {
          deliveryMode: "background-research",
          traits: {
            researchLifecycle: {
              supportsStartRetries: true,
              supportsRequestTimeouts: true,
            },
          },
          start: async () => ({ id: "job-1" }),
          poll: async () => ({
            status: "completed",
            output: { provider: "gemini", text: "done" },
          }),
        },
      },
    });

    expect(plan).toMatchObject({
      capability: "research",
      deliveryMode: "background-research",
      traits: {
        settings: {
          researchTimeoutMs: 5000,
        },
        researchLifecycle: {
          supportsStartRetries: true,
          supportsRequestTimeouts: true,
        },
      },
    });
    if (plan?.deliveryMode !== "background-research") {
      throw new Error("expected a background research plan");
    }
    await expect(plan.start({ cwd: process.cwd() })).resolves.toEqual({
      id: "job-1",
    });
  });
});
