import { describe, expect, it } from "vitest";
import {
  formatProviderDiagnostic,
  formatResearchTerminalDiagnostic,
} from "../src/provider-diagnostics.js";

describe("provider diagnostics", () => {
  it("prefixes provider labels onto provider-neutral clauses", () => {
    expect(
      formatProviderDiagnostic("Exa", "returned invalid JSON output"),
    ).toBe("Exa returned invalid JSON output.");
    expect(formatProviderDiagnostic("Exa", "is missing an API key")).toBe(
      "Exa is missing an API key.",
    );
  });

  it("falls back to a labeled detail form for arbitrary upstream reasons", () => {
    expect(formatProviderDiagnostic("Exa", "rate limited")).toBe(
      "Exa: rate limited.",
    );
  });

  it("formats research terminal diagnostics from provider-neutral details", () => {
    expect(
      formatResearchTerminalDiagnostic("Gemini", "failed", "research failed"),
    ).toBe("Gemini research failed.");
    expect(
      formatResearchTerminalDiagnostic(
        "Exa",
        "cancelled",
        "research was canceled",
      ),
    ).toBe("Exa research was canceled.");
    expect(
      formatResearchTerminalDiagnostic("Gemini", "failed", "quota exceeded"),
    ).toBe("Gemini research failed: quota exceeded.");
  });
});
