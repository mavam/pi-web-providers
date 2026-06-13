import { describe, expect, it } from "vitest";
import { PROVIDERS_BY_ID } from "../src/providers/index.js";
import { TOOLS, type Tool } from "../src/types.js";
import {
  API_PROVIDER_IDS,
  DEFAULT_LIVE_API_CAPABILITIES,
  getMissingLiveApiSecrets,
  LIVE_API_CONTRACTS,
  selectLiveApiContracts,
} from "./live-api-contracts.js";

describe("live API contract matrix", () => {
  it("covers every API-backed provider capability", () => {
    const expected = API_PROVIDER_IDS.flatMap((providerId) =>
      TOOLS.filter((capability) => {
        const capabilities = PROVIDERS_BY_ID[providerId]
          .capabilities as Partial<Record<Tool, unknown>>;
        return capabilities[capability] !== undefined;
      }).map((capability) => `${providerId}/${capability}`),
    ).sort();

    const actual = LIVE_API_CONTRACTS.map(
      (contract) => `${contract.provider}/${contract.capability}`,
    ).sort();

    expect(actual).toEqual(expected);
  });

  it("selects quick live coverage by default", () => {
    const selected = selectLiveApiContracts({});
    const capabilities = new Set(
      selected.map((contract) => contract.capability),
    );

    expect([...capabilities].sort()).toEqual(
      [...DEFAULT_LIVE_API_CAPABILITIES].sort(),
    );
    expect(capabilities.has("research")).toBe(false);
  });

  it("can select research coverage explicitly", () => {
    const selected = selectLiveApiContracts({
      LIVE_API_INCLUDE_RESEARCH: "1",
    });
    const capabilities = new Set(
      selected.map((contract) => contract.capability),
    );

    expect(capabilities.has("research")).toBe(true);
  });

  it("requires only the secrets used by the selected contracts", () => {
    const selected = selectLiveApiContracts({
      LIVE_API_PROVIDERS: "brave",
      LIVE_API_CAPABILITIES: "search",
    });

    expect(getMissingLiveApiSecrets(selected, {})).toEqual([
      "BRAVE_SEARCH_API_KEY",
    ]);
  });

  it("rejects unknown provider and capability filters", () => {
    expect(() =>
      selectLiveApiContracts({ LIVE_API_PROVIDERS: "unknown" }),
    ).toThrow("Unknown LIVE_API_PROVIDERS value(s): unknown.");

    expect(() =>
      selectLiveApiContracts({
        LIVE_API_CAPABILITIES: "search,unknown",
      }),
    ).toThrow("Unknown LIVE_API_CAPABILITIES value(s): unknown.");
  });
});
