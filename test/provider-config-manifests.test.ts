import { describe, expect, it } from "vitest";
import {
  getProviderConfigManifest,
  type ProviderTextSettingDescriptor,
} from "../src/provider-config-manifests.js";
import type {
  Cloudflare,
  Custom,
  Linkup,
  Serper,
  Tavily,
} from "../src/types.js";

describe("provider config manifests", () => {
  it("exposes only custom argv, cwd, and env settings", () => {
    const manifest = getProviderConfigManifest("custom");
    const ids = manifest.settings.map((setting) => setting.id);

    expect(ids).toEqual(
      expect.arrayContaining([
        "customSearchArgv",
        "customSearchCwd",
        "customSearchEnv",
        "customContentsArgv",
        "customContentsCwd",
        "customContentsEnv",
        "customAnswerArgv",
        "customAnswerCwd",
        "customAnswerEnv",
        "customResearchArgv",
        "customResearchCwd",
        "customResearchEnv",
      ]),
    );
    expect(ids).not.toContain("researchPollIntervalMs");
    expect(ids).not.toContain("researchMaxConsecutivePollErrors");
  });

  it("round-trips custom cwd and env settings and cleans up empty commands", () => {
    const config: Custom = {};

    getTextSetting("customSearchArgv").setValue(
      config,
      '["node","./wrappers/search.mjs"]',
    );
    getTextSetting("customSearchCwd").setValue(config, "./wrappers");
    getTextSetting("customSearchEnv").setValue(
      config,
      '{"TOKEN":"DEMO_TOKEN","MODE":"!print-mode"}',
    );

    expect(config.options?.search).toEqual({
      argv: ["node", "./wrappers/search.mjs"],
      cwd: "./wrappers",
      env: {
        TOKEN: "DEMO_TOKEN",
        MODE: "!print-mode",
      },
    });
    expect(getTextSetting("customSearchCwd").getValue(config)).toBe(
      "./wrappers",
    );
    expect(getTextSetting("customSearchEnv").getValue(config)).toBe(
      '{"TOKEN":"DEMO_TOKEN","MODE":"!print-mode"}',
    );

    getTextSetting("customAnswerEnv").setValue(config, '{"TOKEN":"DEMO"}');
    expect(config.options?.answer?.env).toEqual({ TOKEN: "DEMO" });

    getTextSetting("customAnswerEnv").setValue(config, "");
    expect(config.options?.answer).toBeUndefined();
  });

  it("rejects empty custom argv arrays in the settings manifest", () => {
    const config: Custom = {};

    expect(() =>
      getTextSetting("customSearchArgv").setValue(config, "[]"),
    ).toThrow(/non-empty JSON string array/);
  });

  it("exposes only Cloudflare-specific settings", () => {
    const manifest = getProviderConfigManifest("cloudflare");
    const ids = manifest.settings.map((setting) => setting.id);

    expect(ids).toEqual(["apiToken", "accountId"]);
  });

  it("round-trips Cloudflare token and account settings", () => {
    const manifest = getProviderConfigManifest("cloudflare");
    const apiTokenSetting = manifest.settings.find(
      (setting) => setting.id === "apiToken",
    );
    const accountIdSetting = manifest.settings.find(
      (setting) => setting.id === "accountId",
    );

    if (
      !apiTokenSetting ||
      apiTokenSetting.kind !== "text" ||
      !accountIdSetting ||
      accountIdSetting.kind !== "text"
    ) {
      throw new Error("Missing Cloudflare settings.");
    }

    const config: Cloudflare = {};
    apiTokenSetting.setValue(config, "CLOUDFLARE_API_TOKEN");
    accountIdSetting.setValue(config, "CLOUDFLARE_ACCOUNT_ID");

    expect(config).toEqual({
      apiToken: "CLOUDFLARE_API_TOKEN",
      accountId: "CLOUDFLARE_ACCOUNT_ID",
    });
  });

  it("exposes only Linkup API key and base URL settings", () => {
    const manifest = getProviderConfigManifest("linkup");
    const ids = manifest.settings.map((setting) => setting.id);

    expect(ids).toEqual(["apiKey", "baseUrl"]);
  });

  it("round-trips Linkup API key and base URL settings", () => {
    const manifest = getProviderConfigManifest("linkup");
    const apiKeySetting = manifest.settings.find(
      (setting) => setting.id === "apiKey",
    );
    const baseUrlSetting = manifest.settings.find(
      (setting) => setting.id === "baseUrl",
    );

    if (
      !apiKeySetting ||
      apiKeySetting.kind !== "text" ||
      !baseUrlSetting ||
      baseUrlSetting.kind !== "text"
    ) {
      throw new Error("Missing Linkup settings.");
    }

    const config: Linkup = {};
    (apiKeySetting as ProviderTextSettingDescriptor<Linkup>).setValue(
      config,
      "LINKUP_API_KEY",
    );
    (baseUrlSetting as ProviderTextSettingDescriptor<Linkup>).setValue(
      config,
      "https://api.linkup.test/v1",
    );

    expect(config).toEqual({
      apiKey: "LINKUP_API_KEY",
      baseUrl: "https://api.linkup.test/v1",
    });
  });

  it("exposes Serper API key and base URL settings", () => {
    const manifest = getProviderConfigManifest("serper");
    const ids = manifest.settings.map((setting) => setting.id);

    expect(ids).toEqual(["apiKey", "baseUrl"]);
  });

  it("round-trips Serper API key and base URL settings", () => {
    const manifest = getProviderConfigManifest("serper");
    const apiKeySetting = manifest.settings.find(
      (setting) => setting.id === "apiKey",
    );
    const baseUrlSetting = manifest.settings.find(
      (setting) => setting.id === "baseUrl",
    );

    if (
      !apiKeySetting ||
      apiKeySetting.kind !== "text" ||
      !baseUrlSetting ||
      baseUrlSetting.kind !== "text"
    ) {
      throw new Error("Missing Serper settings.");
    }

    const config: Serper = {};
    (apiKeySetting as ProviderTextSettingDescriptor<Serper>).setValue(
      config,
      "SERPER_API_KEY",
    );
    (baseUrlSetting as ProviderTextSettingDescriptor<Serper>).setValue(
      config,
      "https://google.serper.test",
    );

    expect(config).toEqual({
      apiKey: "SERPER_API_KEY",
      baseUrl: "https://google.serper.test",
    });
  });

  it("exposes Tavily API key, base URL, and non-research execution settings", () => {
    const manifest = getProviderConfigManifest("tavily");
    const ids = manifest.settings.map((setting) => setting.id);

    expect(ids).toEqual(["apiKey", "baseUrl"]);
  });

  it("round-trips Tavily API key and base URL settings", () => {
    const manifest = getProviderConfigManifest("tavily");
    const apiKeySetting = manifest.settings.find(
      (setting) => setting.id === "apiKey",
    );
    const baseUrlSetting = manifest.settings.find(
      (setting) => setting.id === "baseUrl",
    );

    if (
      !apiKeySetting ||
      apiKeySetting.kind !== "text" ||
      !baseUrlSetting ||
      baseUrlSetting.kind !== "text"
    ) {
      throw new Error("Missing Tavily settings.");
    }

    const config: Tavily = {};
    (apiKeySetting as ProviderTextSettingDescriptor<Tavily>).setValue(
      config,
      "TAVILY_API_KEY",
    );
    (baseUrlSetting as ProviderTextSettingDescriptor<Tavily>).setValue(
      config,
      "https://api.tavily.test",
    );

    expect(config).toEqual({
      apiKey: "TAVILY_API_KEY",
      baseUrl: "https://api.tavily.test",
    });
  });
});

function getTextSetting(id: string): ProviderTextSettingDescriptor<Custom> {
  const setting = getProviderConfigManifest("custom").settings.find(
    (candidate) => candidate.id === id,
  );
  if (!setting || setting.kind !== "text") {
    throw new Error(`Missing text setting '${id}'.`);
  }
  return setting as ProviderTextSettingDescriptor<Custom>;
}
