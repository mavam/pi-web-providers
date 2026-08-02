import { describe, expect, it } from "vitest";
import { createWebMux, PROVIDER_IDS } from "../src/index.js";

describe("provider catalog", () => {
  it("ships all 16 providers with the retained capability matrix", async () => {
    const client = createWebMux({ config: {} });
    expect(client.listProviders().map((provider) => provider.id)).toEqual(
      PROVIDER_IDS,
    );
    expect(client.getProvider("valyu")?.capabilities).toEqual([
      "search",
      "contents",
      "answer",
      "research",
    ]);
    expect(client.getProvider("cloudflare")?.capabilities).toEqual([
      "contents",
    ]);

    for (const provider of client.listProviders()) {
      for (const capability of provider.capabilities) {
        await expect(
          client.getProviderOptionSchema(provider.id, capability),
        ).resolves.toSatisfy(
          (schema) => schema === undefined || typeof schema === "object",
        );
      }
    }
  });
});
