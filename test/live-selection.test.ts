import { describe, expect, it } from "vitest";
// @ts-expect-error The smoke-test helper runs directly in Node.js.
import { selectLiveTests } from "../scripts/live-selection.mjs";

const providers = [
  {
    id: "one",
    capabilities: ["search", "answer", "research"],
    configured: ["search", "research"],
  },
  { id: "two", capabilities: ["contents"], configured: ["contents"] },
];

describe("live smoke selection", () => {
  it("selects every configured non-research capability", () => {
    const result = selectLiveTests(providers, "all", "all", false);
    expect(
      result.tests.map((test: { capability: string }) => test.capability),
    ).toEqual(["search", "contents"]);
    expect(result.skipped).toHaveLength(2);
  });
  it("includes research only with consent", () => {
    expect(selectLiveTests(providers, "all", "all", true).tests).toHaveLength(
      3,
    );
  });
  it("filters unsupported capabilities in all-provider mode", () => {
    expect(
      selectLiveTests(providers, "all", "search", false).tests,
    ).toHaveLength(1);
  });
  it("does not silently skip an explicitly selected unconfigured provider", () => {
    expect(
      selectLiveTests(providers, "one", "answer", false).tests,
    ).toHaveLength(1);
  });
  it("returns an empty selection when credentials are missing", () => {
    expect(
      selectLiveTests(
        [{ ...providers[0], configured: [] }],
        "all",
        "all",
        false,
      ).tests,
    ).toEqual([]);
  });
  it("rejects unknown providers", () => {
    expect(() => selectLiveTests(providers, "missing", "all", false)).toThrow(
      "Unknown provider",
    );
  });
});
