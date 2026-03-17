import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDefaultConfig,
  getConfigPath,
  loadConfig,
  parseConfig,
  resolveConfigValue,
  serializeConfig,
} from "../src/config.js";
import { PROVIDER_MAP } from "../src/providers/index.js";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const cleanupDirs: string[] = [];

afterEach(async () => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop();
    if (!dir) continue;
    await import("node:fs/promises").then(({ rm }) =>
      rm(dir, { recursive: true, force: true }),
    );
  }
  delete process.env.PI_CODING_AGENT_DIR;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.PARALLEL_API_KEY;
  delete process.env.PERPLEXITY_API_KEY;
});

describe("config parsing", () => {
  it("rejects unknown providers", () => {
    expect(() =>
      parseConfig(
        JSON.stringify({
          version: 2,
          providers: {
            searxng: {},
          },
        }),
        "test-config.json",
      ),
    ).toThrow(/Unknown providers/);
  });

  it("rejects unknown top-level tool mappings", () => {
    expect(() =>
      parseConfig(
        JSON.stringify({
          version: 2,
          tools: {
            summarize: "codex",
          },
        }),
        "test-config.json",
      ),
    ).toThrow(/Unknown tools in test-config.json: summarize/);
  });

  it("accepts provider enablement", () => {
    const parsed = parseConfig(
      JSON.stringify({
        providers: {
          codex: {
            enabled: true,
          },
        },
      }),
      "test-config.json",
    );

    expect(parsed.providers?.codex?.enabled).toBe(true);
  });

  it("rejects legacy provider-local tool toggles", () => {
    expect(() =>
      parseConfig(
        JSON.stringify({
          version: 2,
          providers: {
            valyu: {
              tools: {
                research: true,
              },
            },
          },
        }),
        "test-config.json",
      ),
    ).toThrow(/providers\.valyu\.tools/);
  });

  it("accepts search tool settings for persisted prefetch defaults", () => {
    const parsed = parseConfig(
      JSON.stringify({
        toolSettings: {
          search: {
            prefetch: {
              provider: "exa",
              maxUrls: 3,
              ttlMs: 60000,
            },
          },
        },
      }),
      "test-config.json",
    );

    expect(parsed.toolSettings?.search?.prefetch).toEqual({
      provider: "exa",
      maxUrls: 3,
      ttlMs: 60000,
    });
  });

  it("accepts shared generic execution settings", () => {
    const parsed = parseConfig(
      JSON.stringify({
        genericSettings: {
          requestTimeoutMs: 45000,
          retryCount: 5,
          retryDelayMs: 4000,
          researchPollIntervalMs: 6000,
          researchTimeoutMs: 28800000,
          researchMaxConsecutivePollErrors: 12,
        },
      }),
      "test-config.json",
    );

    expect(parsed.genericSettings).toEqual({
      requestTimeoutMs: 45000,
      retryCount: 5,
      retryDelayMs: 4000,
      researchPollIntervalMs: 6000,
      researchTimeoutMs: 28800000,
      researchMaxConsecutivePollErrors: 12,
    });
  });

  it("rejects unknown tool-specific settings", () => {
    expect(() =>
      parseConfig(
        JSON.stringify({
          toolSettings: {
            search: {
              caching: true,
            },
          },
        }),
        "test-config.json",
      ),
    ).toThrow(/Unknown search tool settings/);
  });

  it("loads the global config", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-providers-config-"));
    cleanupDirs.push(root);

    process.env.PI_CODING_AGENT_DIR = join(root, "agent");
    await mkdir(process.env.PI_CODING_AGENT_DIR, { recursive: true });

    const config = createDefaultConfig();
    config.providers!.claude = {
      pathToClaudeCodeExecutable: "/tmp/claude-code",
      native: {
        model: "claude-sonnet-4-5",
        effort: "high",
        maxTurns: 6,
      },
    };
    config.providers!.codex!.native!.additionalDirectories = ["docs"];
    config.providers!.exa = {
      apiKey: "EXA_API_KEY",
      native: {
        type: "auto",
      },
    };
    config.providers!.parallel = {
      apiKey: "PARALLEL_API_KEY",
      native: {
        search: {
          mode: "one-shot",
        },
      },
    };
    config.providers!.gemini = {
      apiKey: "GOOGLE_API_KEY",
      native: {
        apiVersion: "v1alpha",
        searchModel: "gemini-2.5-flash",
      },
      policy: {
        requestTimeoutMs: 45000,
        retryCount: 5,
        retryDelayMs: 4000,
        researchPollIntervalMs: 6000,
        researchTimeoutMs: 28800000,
        researchMaxConsecutivePollErrors: 12,
      },
    };
    config.providers!.perplexity = {
      apiKey: "PERPLEXITY_API_KEY",
      native: {
        search: {
          country: "US",
        },
        answer: {
          model: "sonar",
        },
        research: {
          model: "sonar-deep-research",
        },
      },
    };

    config.providers!.codex!.native!.webSearchMode = "cached";
    config.providers!.codex!.native!.additionalDirectories = ["notes"];
    config.toolSettings = {
      search: {
        prefetch: {
          provider: "exa",
          maxUrls: 2,
          ttlMs: 60000,
        },
      },
    };

    await writeFile(getConfigPath(), serializeConfig(config), "utf-8");

    const loaded = await loadConfig();
    expect(loaded.providers?.claude?.pathToClaudeCodeExecutable).toBe(
      "/tmp/claude-code",
    );
    expect(loaded.providers?.claude?.native?.model).toBe("claude-sonnet-4-5");
    expect(loaded.providers?.claude?.native?.effort).toBe("high");
    expect(loaded.providers?.claude?.native?.maxTurns).toBe(6);
    expect(loaded.providers?.codex?.native?.webSearchMode).toBe("cached");
    expect(loaded.providers?.codex?.native?.additionalDirectories).toEqual([
      "notes",
    ]);
    expect(loaded.providers?.exa?.apiKey).toBe("EXA_API_KEY");
    expect(loaded.providers?.gemini?.native?.apiVersion).toBe("v1alpha");
    expect(loaded.providers?.gemini?.policy?.requestTimeoutMs).toBe(45000);
    expect(loaded.providers?.gemini?.policy?.retryCount).toBe(5);
    expect(loaded.providers?.gemini?.policy?.retryDelayMs).toBe(4000);
    expect(loaded.providers?.gemini?.policy?.researchPollIntervalMs).toBe(6000);
    expect(loaded.providers?.gemini?.policy?.researchTimeoutMs).toBe(28800000);
    expect(
      loaded.providers?.gemini?.policy?.researchMaxConsecutivePollErrors,
    ).toBe(12);
    expect(loaded.providers?.perplexity?.native?.search?.country).toBe("US");
    expect(loaded.providers?.perplexity?.native?.research?.model).toBe(
      "sonar-deep-research",
    );
    expect(loaded.providers?.parallel?.native?.search?.mode).toBe("one-shot");
    expect(loaded.toolSettings?.search?.prefetch).toEqual({
      provider: "exa",
      maxUrls: 2,
      ttlMs: 60000,
    });
  });

  it("maps legacy defaults into native and policy config blocks", () => {
    const loaded = parseConfig(
      JSON.stringify({
        version: 2,
        providers: {
          gemini: {
            apiKey: "GOOGLE_API_KEY",
            defaults: {
              searchModel: "gemini-2.5-flash",
              requestTimeoutMs: 45000,
              retryCount: 5,
            },
          },
        },
      }),
      "test-config.json",
    );

    expect(loaded.providers?.gemini?.native?.searchModel).toBe(
      "gemini-2.5-flash",
    );
    expect(loaded.providers?.gemini?.policy?.requestTimeoutMs).toBe(45000);
    expect(loaded.providers?.gemini?.policy?.retryCount).toBe(5);
    expect(loaded.providers?.gemini).not.toHaveProperty("defaults");
  });

  it("seeds shared generic defaults and only keeps provider-specific overrides", () => {
    const config = createDefaultConfig();

    expect(config.genericSettings).toEqual({
      requestTimeoutMs: 30000,
      retryCount: 3,
      retryDelayMs: 2000,
      researchPollIntervalMs: 3000,
      researchTimeoutMs: 21600000,
      researchMaxConsecutivePollErrors: 3,
    });
    expect(config.providers?.claude?.policy).toBeUndefined();
    expect(config.providers?.codex?.policy).toBeUndefined();
    expect(config.providers?.exa?.policy).toBeUndefined();
    expect(config.providers?.gemini?.policy).toEqual({
      researchMaxConsecutivePollErrors: 10,
    });
    expect(config.providers?.perplexity?.policy).toBeUndefined();
    expect(config.providers?.parallel?.policy).toBeUndefined();
    expect(config.providers?.valyu?.policy).toBeUndefined();
  });

  it("keeps provider templates aligned with provider-specific default config blocks", () => {
    const config = createDefaultConfig();

    expect(PROVIDER_MAP.claude.createTemplate().policy).toEqual(
      config.providers?.claude?.policy,
    );
    expect(PROVIDER_MAP.codex.createTemplate().policy).toEqual(
      config.providers?.codex?.policy,
    );
    expect(PROVIDER_MAP.exa.createTemplate().policy).toEqual(
      config.providers?.exa?.policy,
    );
    expect(PROVIDER_MAP.gemini.createTemplate().policy).toEqual(
      config.providers?.gemini?.policy,
    );
    expect(PROVIDER_MAP.perplexity.createTemplate().policy).toEqual(
      config.providers?.perplexity?.policy,
    );
    expect(PROVIDER_MAP.parallel.createTemplate().policy).toEqual(
      config.providers?.parallel?.policy,
    );
    expect(PROVIDER_MAP.valyu.createTemplate().policy).toEqual(
      config.providers?.valyu?.policy,
    );
  });

  it("keeps example-config.json in sync with createDefaultConfig()", async () => {
    const examplePath = join(PROJECT_ROOT, "example-config.json");
    const exampleJson = JSON.parse(await readFile(examplePath, "utf-8"));
    const defaultConfig = createDefaultConfig();
    expect(exampleJson).toEqual(defaultConfig);
  });

  it("caches command-backed config values within the process", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-providers-config-"));
    cleanupDirs.push(root);

    const markerPath = join(root, "marker.txt");
    const scriptPath = join(root, "secret.js");
    await writeFile(
      scriptPath,
      [
        'const { appendFileSync } = require("node:fs");',
        'appendFileSync(process.argv[2], "x");',
        'process.stdout.write("secret-key");',
      ].join("\n"),
      "utf-8",
    );

    const command = `!node ${JSON.stringify(scriptPath)} ${JSON.stringify(markerPath)}`;

    expect(resolveConfigValue(command)).toBe("secret-key");
    expect(resolveConfigValue(command)).toBe("secret-key");
    expect(await readFile(markerPath, "utf-8")).toBe("x");
  });
});
