import { describe, expect, it } from "vitest";
import {
  getProviderConfigManifest,
  type ProviderTextSettingDescriptor,
} from "../src/provider-config-manifests.js";
import type { Custom } from "../src/types.js";

describe("provider config manifests", () => {
  it("exposes custom argv, cwd, env, and request settings", () => {
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
        "requestTimeoutMs",
        "retryCount",
        "retryDelayMs",
      ]),
    );
    expect(ids).not.toContain("researchPollIntervalMs");
    expect(ids).not.toContain("researchTimeoutMs");
    expect(ids).not.toContain("researchMaxConsecutivePollErrors");
  });

  it("round-trips custom cwd and env settings and cleans up empty commands", () => {
    const config: Custom = { enabled: true };

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
    const config: Custom = { enabled: true };

    expect(() =>
      getTextSetting("customSearchArgv").setValue(config, "[]"),
    ).toThrow(/non-empty JSON string array/);
  });

  it("exposes Tavily auth and research lifecycle settings", () => {
    const ids = getProviderConfigManifest("tavily").settings.map(
      (setting) => setting.id,
    );

    expect(ids).toEqual([
      "apiKey",
      "baseUrl",
      "researchPollIntervalMs",
      "researchTimeoutMs",
      "researchMaxConsecutivePollErrors",
    ]);
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
