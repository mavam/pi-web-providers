import { describe, expect, it, vi } from "vitest";
import {
  executeProviderExecution,
  type ProviderExecution,
} from "../src/provider-runtime.js";
import type { ProviderContext, ToolOutput } from "../src/types.js";

describe("executeProviderExecution research timeouts", () => {
  it("applies the configured research timeout to research operations", async () => {
    vi.useFakeTimers();

    try {
      const operation: ProviderExecution<"research"> = {
        capability: "research",
        providerLabel: "Gemini",
        settings: {
          researchTimeoutMs: 10,
        },
        execute: async (_context: ProviderContext) =>
          await new Promise<ToolOutput>(() => {}),
      };

      const promise = executeProviderExecution(operation, undefined, {
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
