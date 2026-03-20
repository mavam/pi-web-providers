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
import { ADAPTERS_BY_ID } from "../src/providers/index.js";

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
  delete process.env.FIRECRAWL_API_KEY;
  delete process.env.PARALLEL_API_KEY;
  delete process.env.PERPLEXITY_API_KEY;
});

describe("config parsing", () => {
  it("rejects unknown providers", () => {
    expect(() =>
      parseConfig(
        JSON.stringify({
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
        settings: {
          search: {
            provider: "exa",
            maxUrls: 3,
            ttlMs: 60000,
          },
        },
      }),
      "test-config.json",
    );

    expect(parsed.settings?.search).toEqual({
      provider: "exa",
      maxUrls: 3,
      ttlMs: 60000,
    });
  });

  it("accepts shared execution settings", () => {
    const parsed = parseConfig(
      JSON.stringify({
        settings: {
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

    expect(parsed.settings).toEqual({
      requestTimeoutMs: 45000,
      retryCount: 5,
      retryDelayMs: 4000,
      researchPollIntervalMs: 6000,
      researchTimeoutMs: 28800000,
      researchMaxConsecutivePollErrors: 12,
    });
  });

  it("parses custom CLI command config", () => {
    const parsed = parseConfig(
      JSON.stringify({
        providers: {
          custom: {
            enabled: true,
            options: {
              search: {
                argv: ["node", "./scripts/search-wrapper.mjs"],
                cwd: ".",
                env: {
                  DEMO_TOKEN: "EXAMPLE_TOKEN",
                },
              },
            },
          },
        },
      }),
      "test-config.json",
    );

    expect(parsed.providers?.["custom"]).toEqual({
      enabled: true,
      options: {
        search: {
          argv: ["node", "./scripts/search-wrapper.mjs"],
          cwd: ".",
          env: {
            DEMO_TOKEN: "EXAMPLE_TOKEN",
          },
        },
        contents: undefined,
        answer: undefined,
        research: undefined,
      },
      settings: undefined,
    });
  });

  it("rejects blank custom CLI argv entries", () => {
    expect(() =>
      parseConfig(
        JSON.stringify({
          providers: {
            custom: {
              options: {
                search: {
                  argv: ["node", "   "],
                },
              },
            },
          },
        }),
        "test-config.json",
      ),
    ).toThrow(/non-empty array of non-empty strings/);
  });

  it("rejects unknown tool-specific settings", () => {
    expect(() =>
      parseConfig(
        JSON.stringify({
          settings: {
            search: {
              caching: true,
            },
          },
        }),
        "test-config.json",
      ),
    ).toThrow(/Unknown search settings/);
  });

  it("loads the global config", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-providers-config-"));
    cleanupDirs.push(root);

    process.env.PI_CODING_AGENT_DIR = join(root, "agent");
    await mkdir(process.env.PI_CODING_AGENT_DIR, { recursive: true });

    const config = createDefaultConfig();
    config.providers!.claude = {
      pathToClaudeCodeExecutable: "/tmp/claude-code",
      options: {
        model: "claude-sonnet-4-5",
        effort: "high",
        maxTurns: 6,
      },
    };
    config.providers!.codex!.options!.additionalDirectories = ["docs"];
    config.providers!.exa = {
      apiKey: "EXA_API_KEY",
      options: {
        type: "auto",
      },
    };
    config.providers!.firecrawl = {
      apiKey: "FIRECRAWL_API_KEY",
      options: {
        search: {
          sources: ["web"],
        },
        scrape: {
          formats: ["markdown"],
          onlyMainContent: true,
        },
      },
    };
    config.providers!.parallel = {
      apiKey: "PARALLEL_API_KEY",
      options: {
        search: {
          mode: "one-shot",
        },
      },
    };
    config.providers!.gemini = {
      apiKey: "GOOGLE_API_KEY",
      options: {
        apiVersion: "v1alpha",
        searchModel: "gemini-2.5-flash",
      },
      settings: {
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
      options: {
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

    config.providers!.codex!.options!.webSearchMode = "cached";
    config.providers!.codex!.options!.additionalDirectories = ["notes"];
    config.settings = {
      ...(config.settings ?? {}),
      search: {
        provider: "exa",
        maxUrls: 2,
        ttlMs: 60000,
      },
    };

    await writeFile(getConfigPath(), serializeConfig(config), "utf-8");

    const loaded = await loadConfig();
    expect(loaded.providers?.claude?.pathToClaudeCodeExecutable).toBe(
      "/tmp/claude-code",
    );
    expect(loaded.providers?.claude?.options?.model).toBe("claude-sonnet-4-5");
    expect(loaded.providers?.claude?.options?.effort).toBe("high");
    expect(loaded.providers?.claude?.options?.maxTurns).toBe(6);
    expect(loaded.providers?.codex?.options?.webSearchMode).toBe("cached");
    expect(loaded.providers?.codex?.options?.additionalDirectories).toEqual([
      "notes",
    ]);
    expect(loaded.providers?.exa?.apiKey).toBe("EXA_API_KEY");
    expect(loaded.providers?.firecrawl?.apiKey).toBe("FIRECRAWL_API_KEY");
    expect(loaded.providers?.firecrawl?.options?.search?.sources).toEqual([
      "web",
    ]);
    expect(loaded.providers?.firecrawl?.options?.scrape).toEqual({
      formats: ["markdown"],
      onlyMainContent: true,
    });
    expect(loaded.providers?.gemini?.options?.apiVersion).toBe("v1alpha");
    expect(loaded.providers?.gemini?.settings?.requestTimeoutMs).toBe(45000);
    expect(loaded.providers?.gemini?.settings?.retryCount).toBe(5);
    expect(loaded.providers?.gemini?.settings?.retryDelayMs).toBe(4000);
    expect(loaded.providers?.gemini?.settings?.researchPollIntervalMs).toBe(
      6000,
    );
    expect(loaded.providers?.gemini?.settings?.researchTimeoutMs).toBe(
      28800000,
    );
    expect(
      loaded.providers?.gemini?.settings?.researchMaxConsecutivePollErrors,
    ).toBe(12);
    expect(loaded.providers?.perplexity?.options?.search?.country).toBe("US");
    expect(loaded.providers?.perplexity?.options?.research?.model).toBe(
      "sonar-deep-research",
    );
    expect(loaded.providers?.parallel?.options?.search?.mode).toBe("one-shot");
    expect(loaded.settings?.search).toEqual({
      provider: "exa",
      maxUrls: 2,
      ttlMs: 60000,
    });
  });

  it("seeds shared settings and only keeps provider-specific overrides", () => {
    const config = createDefaultConfig();

    expect(config.settings).toEqual({
      requestTimeoutMs: 30000,
      retryCount: 3,
      retryDelayMs: 2000,
      researchPollIntervalMs: 3000,
      researchTimeoutMs: 21600000,
      researchMaxConsecutivePollErrors: 3,
    });
    expect(config.providers?.claude?.settings).toBeUndefined();
    expect(config.providers?.codex?.settings).toBeUndefined();
    expect(config.providers?.exa?.settings).toBeUndefined();
    expect(config.providers?.firecrawl?.settings).toBeUndefined();
    expect(config.providers?.gemini?.settings).toEqual({
      researchMaxConsecutivePollErrors: 10,
    });
    expect(config.providers?.perplexity?.settings).toBeUndefined();
    expect(config.providers?.parallel?.settings).toBeUndefined();
    expect(config.providers?.valyu?.settings).toBeUndefined();
  });

  it("keeps provider templates aligned with provider-specific default config blocks", () => {
    const config = createDefaultConfig();

    expect(ADAPTERS_BY_ID.claude.createTemplate().settings).toEqual(
      config.providers?.claude?.settings,
    );
    expect(ADAPTERS_BY_ID.codex.createTemplate().settings).toEqual(
      config.providers?.codex?.settings,
    );
    expect(ADAPTERS_BY_ID.exa.createTemplate().settings).toEqual(
      config.providers?.exa?.settings,
    );
    expect(ADAPTERS_BY_ID.firecrawl.createTemplate().settings).toEqual(
      config.providers?.firecrawl?.settings,
    );
    expect(ADAPTERS_BY_ID.gemini.createTemplate().settings).toEqual(
      config.providers?.gemini?.settings,
    );
    expect(ADAPTERS_BY_ID.perplexity.createTemplate().settings).toEqual(
      config.providers?.perplexity?.settings,
    );
    expect(ADAPTERS_BY_ID.parallel.createTemplate().settings).toEqual(
      config.providers?.parallel?.settings,
    );
    expect(ADAPTERS_BY_ID.valyu.createTemplate().settings).toEqual(
      config.providers?.valyu?.settings,
    );
  });

  it("keeps example-config.json in sync with createDefaultConfig()", async () => {
    const examplePath = join(PROJECT_ROOT, "example-config.json");
    const exampleJson = JSON.parse(await readFile(examplePath, "utf-8"));
    const defaultConfig = JSON.parse(serializeConfig(createDefaultConfig()));
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
