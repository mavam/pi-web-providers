import { describe, expect, it } from "vitest";
import {
  getProviderConfigManifest,
  type ProviderTextSettingDescriptor,
} from "../src/provider-config-manifests.js";
import type { CustomCliProviderConfig } from "../src/types.js";

describe("provider config manifests", () => {
  it("exposes custom-cli argv, cwd, env, and request policy settings", () => {
    const manifest = getProviderConfigManifest("custom-cli");
    const ids = manifest.settings.map((setting) => setting.id);

    expect(ids).toEqual(
      expect.arrayContaining([
        "customCliSearchArgv",
        "customCliSearchCwd",
        "customCliSearchEnv",
        "customCliContentsArgv",
        "customCliContentsCwd",
        "customCliContentsEnv",
        "customCliAnswerArgv",
        "customCliAnswerCwd",
        "customCliAnswerEnv",
        "customCliResearchArgv",
        "customCliResearchCwd",
        "customCliResearchEnv",
        "requestTimeoutMs",
        "retryCount",
        "retryDelayMs",
      ]),
    );
    expect(ids).not.toContain("researchPollIntervalMs");
    expect(ids).not.toContain("researchTimeoutMs");
    expect(ids).not.toContain("researchMaxConsecutivePollErrors");
  });

  it("round-trips custom-cli cwd and env settings and cleans up empty commands", () => {
    const config: CustomCliProviderConfig = { enabled: true };

    getTextSetting("customCliSearchArgv").setValue(
      config,
      '["node","./wrappers/search.mjs"]',
    );
    getTextSetting("customCliSearchCwd").setValue(config, "./wrappers");
    getTextSetting("customCliSearchEnv").setValue(
      config,
      '{"TOKEN":"DEMO_TOKEN","MODE":"!print-mode"}',
    );

    expect(config.native?.search).toEqual({
      argv: ["node", "./wrappers/search.mjs"],
      cwd: "./wrappers",
      env: {
        TOKEN: "DEMO_TOKEN",
        MODE: "!print-mode",
      },
    });
    expect(getTextSetting("customCliSearchCwd").getValue(config)).toBe(
      "./wrappers",
    );
    expect(getTextSetting("customCliSearchEnv").getValue(config)).toBe(
      '{"TOKEN":"DEMO_TOKEN","MODE":"!print-mode"}',
    );

    getTextSetting("customCliAnswerEnv").setValue(config, '{"TOKEN":"DEMO"}');
    expect(config.native?.answer?.env).toEqual({ TOKEN: "DEMO" });

    getTextSetting("customCliAnswerEnv").setValue(config, "");
    expect(config.native?.answer).toBeUndefined();
  });
});

function getTextSetting(
  id: string,
): ProviderTextSettingDescriptor<CustomCliProviderConfig> {
  const setting = getProviderConfigManifest("custom-cli").settings.find(
    (candidate) => candidate.id === id,
  );
  if (!setting || setting.kind !== "text") {
    throw new Error(`Missing text setting '${id}'.`);
  }
  return setting as ProviderTextSettingDescriptor<CustomCliProviderConfig>;
}
