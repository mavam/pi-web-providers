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
  readConfigFile,
  resolveConfigValue,
  serializeConfig,
} from "../src/config.js";
import { PROVIDERS_BY_ID } from "../src/providers/index.js";

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
  delete process.env.CLOUDFLARE_API_TOKEN;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.LINKUP_API_KEY;
  delete process.env.OLLAMA_API_KEY;
  delete process.env.PARALLEL_API_KEY;
  delete process.env.PERPLEXITY_API_KEY;
  delete process.env.TAVILY_API_KEY;
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

  it("rejects provider enablement", () => {
    expect(() =>
      parseConfig(
        JSON.stringify({
          providers: {
            codex: {
              enabled: true,
            },
          },
        }),
        "test-config.json",
      ),
    ).toThrow(/providers\.codex\.enabled/);
  });

  it("parses Cloudflare provider config", () => {
    const parsed = parseConfig(
      JSON.stringify({
        providers: {
          cloudflare: {
            credentials: { api: "CLOUDFLARE_API_TOKEN" },
            accountId: "CLOUDFLARE_ACCOUNT_ID",
            options: {
              cacheTTL: 0,
            },
            settings: {
              requestTimeoutMs: 45000,
            },
          },
        },
      }),
      "test-config.json",
    );

    expect(parsed.providers?.cloudflare).toEqual({
      credentials: { api: "CLOUDFLARE_API_TOKEN" },
      accountId: "CLOUDFLARE_ACCOUNT_ID",
      options: {
        cacheTTL: 0,
      },
      settings: {
        requestTimeoutMs: 45000,
      },
    });
  });

  it("parses Tavily provider config", () => {
    const parsed = parseConfig(
      JSON.stringify({
        providers: {
          tavily: {
            credentials: { api: "TAVILY_API_KEY" },
            baseUrl: "https://api.tavily.test",
            options: {
              search: {
                topic: "news",
              },
              extract: {
                format: "text",
              },
            },
            settings: {
              requestTimeoutMs: 45000,
            },
          },
        },
      }),
      "test-config.json",
    );

    expect(parsed.providers?.tavily).toEqual({
      credentials: { api: "TAVILY_API_KEY" },
      baseUrl: "https://api.tavily.test",
      options: {
        search: {
          topic: "news",
        },
        extract: {
          format: "text",
        },
      },
      settings: {
        requestTimeoutMs: 45000,
      },
    });
  });

  it("parses Linkup provider config", () => {
    const parsed = parseConfig(
      JSON.stringify({
        providers: {
          linkup: {
            credentials: { api: "LINKUP_API_KEY" },
            baseUrl: "https://api.linkup.test/v1",
            options: {
              search: {
                depth: "deep",
              },
              fetch: {
                renderJs: true,
              },
            },
            settings: {
              requestTimeoutMs: 45000,
            },
          },
        },
      }),
      "test-config.json",
    );

    expect(parsed.providers?.linkup).toEqual({
      credentials: { api: "LINKUP_API_KEY" },
      baseUrl: "https://api.linkup.test/v1",
      options: {
        search: {
          depth: "deep",
        },
        fetch: {
          renderJs: true,
        },
      },
      settings: {
        requestTimeoutMs: 45000,
      },
    });
  });

  it("parses capability-scoped Serper provider options", () => {
    const parsed = parseConfig(
      JSON.stringify({
        providers: {
          serper: {
            credentials: { api: "SERPER_API_KEY" },
            baseUrl: "https://google.serper.test",
            options: {
              search: {
                gl: "us",
                hl: "en",
              },
            },
          },
        },
      }),
      "test-config.json",
    );

    expect(parsed.providers?.serper).toEqual({
      credentials: { api: "SERPER_API_KEY" },
      baseUrl: "https://google.serper.test",
      options: {
        search: {
          gl: "us",
          hl: "en",
        },
      },
    });
  });

  it("parses capability-scoped Exa provider options", () => {
    const parsed = parseConfig(
      JSON.stringify({
        providers: {
          exa: {
            credentials: { api: "EXA_API_KEY" },
            options: {
              search: {
                type: "auto",
                contents: {
                  text: true,
                },
              },
            },
          },
        },
      }),
      "test-config.json",
    );

    expect(parsed.providers?.exa).toEqual({
      credentials: { api: "EXA_API_KEY" },
      options: {
        search: {
          type: "auto",
          contents: {
            text: true,
          },
        },
      },
    });
  });

  it("rejects unsupported flat Exa provider options", () => {
    expect(() =>
      parseConfig(
        JSON.stringify({
          providers: {
            exa: {
              credentials: { api: "EXA_API_KEY" },
              options: {
                type: "auto",
              },
            },
          },
        }),
        "test-config.json",
      ),
    ).toThrow(/providers\.exa\.options/);
  });

  it("parses capability-scoped Valyu provider options", () => {
    const parsed = parseConfig(
      JSON.stringify({
        providers: {
          valyu: {
            credentials: { api: "VALYU_API_KEY" },
            options: {
              search: {
                searchType: "all",
              },
              answer: {
                responseLength: "medium",
              },
              contents: {
                responseLength: "medium",
              },
              research: {
                responseLength: "large",
              },
            },
          },
        },
      }),
      "test-config.json",
    );

    expect(parsed.providers?.valyu).toEqual({
      credentials: { api: "VALYU_API_KEY" },
      options: {
        search: {
          searchType: "all",
        },
        answer: {
          responseLength: "medium",
        },
        contents: {
          responseLength: "medium",
        },
        research: {
          responseLength: "large",
        },
      },
    });
  });

  it("rejects unsupported flat Valyu provider options", () => {
    expect(() =>
      parseConfig(
        JSON.stringify({
          providers: {
            valyu: {
              credentials: { api: "VALYU_API_KEY" },
              options: {
                searchType: "all",
              },
            },
          },
        }),
        "test-config.json",
      ),
    ).toThrow(/providers\.valyu\.options/);
  });

  it("rejects unsupported provider-local tool toggles", () => {
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

    expect(parsed.settings).toEqual({
      search: {
        provider: "exa",
        maxUrls: 3,
        ttlMs: 60000,
      },
    });
  });

  it("accepts shared execution settings", () => {
    const parsed = parseConfig(
      JSON.stringify({
        settings: {
          requestTimeoutMs: 45000,
          retryCount: 5,
          retryDelayMs: 4000,
          researchTimeoutMs: 1800000,
        },
      }),
      "test-config.json",
    );

    expect(parsed.settings).toEqual({
      requestTimeoutMs: 45000,
      retryCount: 5,
      retryDelayMs: 4000,
      researchTimeoutMs: 1800000,
    });
  });

  it("parses custom CLI command config", () => {
    const parsed = parseConfig(
      JSON.stringify({
        providers: {
          custom: {
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

  it("migrates legacy provider credential fields when reading a config file", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-providers-config-"));
    cleanupDirs.push(root);
    const path = join(root, "web-providers.json");

    await writeFile(
      path,
      JSON.stringify({
        providers: {
          exa: {
            apiKey: "EXA_API_KEY",
            baseUrl: "https://api.exa.test",
          },
          cloudflare: {
            apiToken: "CLOUDFLARE_API_TOKEN",
            accountId: "CLOUDFLARE_ACCOUNT_ID",
          },
        },
      }),
      "utf-8",
    );

    const loaded = await readConfigFile(path);

    expect(loaded.providers?.exa).toEqual({
      credentials: { api: "EXA_API_KEY" },
      baseUrl: "https://api.exa.test",
    });
    expect(loaded.providers?.cloudflare).toEqual({
      credentials: { api: "CLOUDFLARE_API_TOKEN" },
      accountId: "CLOUDFLARE_ACCOUNT_ID",
    });
    expect(JSON.parse(await readFile(path, "utf-8"))).toEqual({
      providers: {
        cloudflare: {
          credentials: { api: "CLOUDFLARE_API_TOKEN" },
          accountId: "CLOUDFLARE_ACCOUNT_ID",
        },
        exa: {
          baseUrl: "https://api.exa.test",
          credentials: { api: "EXA_API_KEY" },
        },
      },
    });
  });

  it("loads the global config", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-providers-config-"));
    cleanupDirs.push(root);

    process.env.PI_CODING_AGENT_DIR = join(root, "agent");
    await mkdir(process.env.PI_CODING_AGENT_DIR, { recursive: true });

    const config = createDefaultConfig();
    config.providers ??= {};
    config.providers.claude = {
      pathToClaudeCodeExecutable: "/tmp/claude-code",
      options: {
        model: "claude-sonnet-4-5",
        effort: "high",
        maxTurns: 6,
      },
    };
    config.providers.codex = {
      options: {
        additionalDirectories: ["docs"],
      },
    };
    config.providers.cloudflare = {
      credentials: { api: "CLOUDFLARE_API_TOKEN" },
      accountId: "CLOUDFLARE_ACCOUNT_ID",
      options: {
        cacheTTL: 0,
      },
    };
    config.providers.exa = {
      credentials: { api: "EXA_API_KEY" },
      options: {
        search: {
          type: "auto",
        },
      },
    };
    config.providers.parallel = {
      credentials: { api: "PARALLEL_API_KEY" },
      options: {
        search: {
          mode: "one-shot",
        },
      },
    };
    config.providers.tavily = {
      credentials: { api: "TAVILY_API_KEY" },
      options: {
        search: {
          topic: "news",
        },
        extract: {
          format: "text",
        },
      },
    };
    config.providers.gemini = {
      credentials: { api: "GOOGLE_API_KEY" },
      options: {
        apiVersion: "v1alpha",
        searchModel: "gemini-2.5-flash",
      },
      settings: {
        requestTimeoutMs: 45000,
        retryCount: 5,
        retryDelayMs: 4000,
        researchTimeoutMs: 1800000,
      },
    };
    config.providers.perplexity = {
      credentials: { api: "PERPLEXITY_API_KEY" },
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

    config.providers.codex.options!.webSearchMode = "cached";
    config.providers.codex.options!.additionalDirectories = ["notes"];
    config.settings = {
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
    expect(loaded.providers?.cloudflare?.credentials?.api).toBe(
      "CLOUDFLARE_API_TOKEN",
    );
    expect(loaded.providers?.cloudflare?.accountId).toBe(
      "CLOUDFLARE_ACCOUNT_ID",
    );
    expect(loaded.providers?.cloudflare?.options?.cacheTTL).toBe(0);
    expect(loaded.providers?.exa?.credentials?.api).toBe("EXA_API_KEY");
    expect(loaded.providers?.exa?.options?.search?.type).toBe("auto");
    expect(loaded.providers?.gemini?.options?.apiVersion).toBe("v1alpha");
    expect(loaded.providers?.gemini?.settings?.requestTimeoutMs).toBe(45000);
    expect(loaded.providers?.gemini?.settings?.retryCount).toBe(5);
    expect(loaded.providers?.gemini?.settings?.retryDelayMs).toBe(4000);
    expect(loaded.providers?.gemini?.settings?.researchTimeoutMs).toBe(1800000);
    expect(loaded.providers?.perplexity?.options?.search?.country).toBe("US");
    expect(loaded.providers?.perplexity?.options?.research?.model).toBe(
      "sonar-deep-research",
    );
    expect(loaded.providers?.parallel?.options?.search?.mode).toBe("one-shot");
    expect(loaded.providers?.tavily?.options?.search?.topic).toBe("news");
    expect(loaded.providers?.tavily?.options?.extract?.format).toBe("text");
    expect(loaded.settings?.search).toEqual({
      provider: "exa",
      maxUrls: 2,
      ttlMs: 60000,
    });
  });

  it("creates a sparse default config", () => {
    const config = createDefaultConfig();

    expect(config).toEqual({
      tools: {
        search: "codex",
      },
    });
  });

  it("keeps provider templates independent from persisted default config", () => {
    const config = createDefaultConfig();

    expect(config.providers).toBeUndefined();
    expect(PROVIDERS_BY_ID.claude.config.createTemplate()).toEqual({});
    expect(PROVIDERS_BY_ID.codex.config.createTemplate().options).toEqual({
      networkAccessEnabled: true,
      webSearchEnabled: true,
      webSearchMode: "live",
    });
    expect(
      PROVIDERS_BY_ID.gemini.config.createTemplate().settings,
    ).toBeUndefined();
    expect(PROVIDERS_BY_ID.linkup.config.createTemplate()).toEqual({
      credentials: { api: "LINKUP_API_KEY" },
    });
    expect(PROVIDERS_BY_ID.ollama.config.createTemplate()).toEqual({
      credentials: { api: "OLLAMA_API_KEY" },
    });
    expect(PROVIDERS_BY_ID.serper.config.createTemplate()).toEqual({
      credentials: { api: "SERPER_API_KEY" },
      options: {
        search: {
          includeMarkdown: true,
        },
      },
    });
    expect(PROVIDERS_BY_ID.tavily.config.createTemplate().options).toEqual({
      search: {
        includeFavicon: true,
      },
      extract: {
        format: "markdown",
        includeFavicon: true,
      },
    });
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
