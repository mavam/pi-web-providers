import { describe, expect, it, vi } from "vitest";
import { executeOperationPlan } from "../src/provider-runtime.js";
import type {
  ProviderContext,
  ProviderPlan,
  ToolOutput,
} from "../src/types.js";

describe("executeOperationPlan research timeouts", () => {
  it("applies the configured research timeout to research plans", async () => {
    vi.useFakeTimers();

    try {
      const plan: ProviderPlan<ToolOutput> = {
        capability: "research",
        providerId: "gemini",
        providerLabel: "Gemini",
        traits: {
          settings: {
            researchTimeoutMs: 10,
          },
        },
        execute: async (_context: ProviderContext) =>
          await new Promise<ToolOutput>(() => {}),
      };

      const promise = executeOperationPlan(plan, undefined, {
        cwd: process.cwd(),
      });

      const rejection = expect(promise).rejects.toThrow(
        "Gemini research exceeded 10ms.",
      );
      await vi.advanceTimersByTimeAsync(10);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});
