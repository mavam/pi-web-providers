import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDefaultConfig,
  getConfigPath,
  loadConfig,
  parseConfig,
  resolveConfigValue,
  serializeConfig,
} from "../src/config.js";

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
          version: 1,
          providers: {
            searxng: {},
          },
        }),
        "test-config.json",
      ),
    ).toThrow(/Unknown providers/);
  });

  it("rejects unknown provider tools", () => {
    expect(() =>
      parseConfig(
        JSON.stringify({
          version: 1,
          providers: {
            codex: {
              tools: {
                answer: true,
              },
            },
          },
        }),
        "test-config.json",
      ),
    ).toThrow(/Unknown tools for codex/);
  });

  it("rejects removed provider tool aliases", () => {
    expect(() =>
      parseConfig(
        JSON.stringify({
          version: 1,
          providers: {
            valyu: {
              tools: {
                deepResearch: true,
              },
            },
          },
        }),
        "test-config.json",
      ),
    ).toThrow(/Unknown tools for valyu/);
  });

  it("loads the global config", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-providers-config-"));
    cleanupDirs.push(root);

    process.env.PI_CODING_AGENT_DIR = join(root, "agent");
    await mkdir(process.env.PI_CODING_AGENT_DIR, { recursive: true });

    const config = createDefaultConfig();
    config.providers!.claude = {
      enabled: false,
      pathToClaudeCodeExecutable: "/tmp/claude-code",
      native: {
        model: "claude-sonnet-4-5",
        effort: "high",
        maxTurns: 6,
      },
    };
    config.providers!.codex!.native!.additionalDirectories = ["docs"];
    config.providers!.exa = {
      enabled: true,
      apiKey: "EXA_API_KEY",
      native: {
        type: "auto",
      },
    };
    config.providers!.parallel = {
      enabled: false,
      apiKey: "PARALLEL_API_KEY",
      native: {
        search: {
          mode: "one-shot",
        },
      },
    };
    config.providers!.gemini = {
      enabled: false,
      apiKey: "GOOGLE_API_KEY",
      native: {
        apiVersion: "v1alpha",
        searchModel: "gemini-2.5-flash",
        contentsModel: "gemini-2.5-pro",
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
      enabled: true,
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
    expect(loaded.providers?.exa?.enabled).toBe(true);
    expect(loaded.providers?.gemini?.native?.apiVersion).toBe("v1alpha");
    expect(loaded.providers?.gemini?.native?.contentsModel).toBe(
      "gemini-2.5-pro",
    );
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
  });

  it("maps legacy defaults into native and policy config blocks", () => {
    const loaded = parseConfig(
      JSON.stringify({
        version: 1,
        providers: {
          gemini: {
            enabled: true,
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
