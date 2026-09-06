import { expect, it, vi } from "vitest";
import { createWebfox } from "../src/index.js";
vi.mock("openai", () => {
  throw new Error("Inspection initialized an SDK");
});
it("validates every lightweight definition and default without SDK initialization", () => {
  const client = createWebfox({ config: {}, env: {} });
  for (const provider of client.listProviders()) {
    for (const capability of provider.capabilities) {
      expect(client.inspectCapability(capability, provider.id).provider).toBe(
        provider.id,
      );
    }
  }
  expect(client.getProvider("cloudflare")?.configurationRequirements).toEqual({
    accountId: "CLOUDFLARE_ACCOUNT_ID",
  });
});
it("inspects supported providers and exact schemas without loading their SDKs", () => {
  const client = createWebfox({
    config: { defaults: { search: { provider: "openai" } } },
    env: {},
  });
  expect(client.getProvider("openai")).toMatchObject({
    selectedDefaults: ["search"],
    configured: [],
  });
  expect(
    client.inspectCapability("search").optionSchema?.properties,
  ).toHaveProperty("searchContextSize");
  expect(client.inspectCapability("answer").provider).toBeUndefined();
});
