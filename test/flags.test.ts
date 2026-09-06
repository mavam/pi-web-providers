import { describe, expect, it } from "vitest";
import { buildOptionFlags } from "../src/cli.js";

describe("dynamic provider flags", () => {
  it("flattens nested scalars and supports arrays, booleans, enums, and numbers", () => {
    const flags = buildOptionFlags({
      type: "object",
      properties: {
        model: { type: "string" },
        searchContextSize: { type: "string", enum: ["low", "high"] },
        userLocation: {
          type: "object",
          properties: { country: { type: "string" } },
        },
        allowedDomains: { type: "array", items: { type: "string" } },
        includeImages: { type: "boolean" },
        maxTokens: { type: "integer" },
        complex: { type: "object", additionalProperties: true },
      },
    });
    expect(flags.map((flag) => flag.flag)).toEqual([
      "--model",
      "--search-context-size",
      "--user-location-country",
      "--allowed-domains",
      "--include-images",
      "--max-tokens",
    ]);
    expect(
      flags.find((flag) => flag.flag === "--include-images")?.negativeFlag,
    ).toBe("--no-include-images");
  });

  it("omits generated collisions and common-option collisions", () => {
    const flags = buildOptionFlags({
      type: "object",
      properties: {
        fooBar: { type: "string" },
        foo_bar: { type: "string" },
        provider: { type: "string" },
        safe: { type: "string" },
      },
    });
    expect(flags.map((flag) => flag.flag)).toEqual(["--safe"]);
  });
});
