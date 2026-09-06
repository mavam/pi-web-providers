import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createWebfox,
  loadConfig,
  parseConfig,
  resolveConfigPath,
  setCapabilityDefault,
} from "../src/index.js";
import { customConfig } from "./helpers.js";
import { loadConfigSync } from "../src/configuration/file.js";
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "webfox-config-"));
  directories.push(path);
  return path;
}

describe("configuration and credential boundaries", () => {
  it.each(["claude", "codex"])(
    "rejects removed %s configurations",
    (provider) => {
      expect(() =>
        parseConfig(JSON.stringify({ providers: { [provider]: {} } })),
      ).toThrow(/Invalid config.yaml:.*\/providers/);
      for (const capability of ["search", "answer"])
        expect(() =>
          parseConfig(
            JSON.stringify({
              defaults: { [capability]: { provider } },
            }),
          ),
        ).toThrow(/Invalid config.yaml:.*\/defaults/);
    },
  );
  it("loads YAML through both library loaders and the XDG default", async () => {
    const home = await directory();
    const env = { XDG_CONFIG_HOME: home };
    await setCapabilityDefault("search", "exa", { env });
    expect(await loadConfig({ env })).toEqual({
      defaults: { search: { provider: "exa" } },
    });
    expect(loadConfigSync({ env })).toEqual(await loadConfig({ env }));
    expect(createWebfox({ env }).inspectCapability("search").provider).toBe(
      "exa",
    );
    expect(await readFile(resolveConfigPath({ env }), "utf8")).toContain(
      "defaults:\n",
    );
    expect(parseConfig("# empty configuration\n")).toEqual({});
    const configPath = resolveConfigPath({ env });
    await writeFile(configPath, "# empty configuration\n");
    await setCapabilityDefault("search", "brave", { env });
    expect(await readFile(configPath, "utf8")).toContain(
      "# empty configuration",
    );
    expect(loadConfigSync({ env }).defaults?.search?.provider).toBe("brave");
  });
  it.each([
    "%YAML 1.1\n---\ndefaults: {}",
    "defaults: [",
    "defaults: {}\ndefaults: {}",
    "defaults:\n  search:\n    provider: exa\n    provider: brave",
    "defaults: {}\n---\ndefaults: {}",
    "defaults: !custom {}",
    "defaults: !!map {}",
    "defaults: &shared {}\nproviders: *shared",
    "? [complex, key]\n: value",
    "1: value",
    "execution:\n  timeoutMs: .inf",
    "execution:\n  timeoutMs: .nan",
    "null",
    "[]",
  ])("rejects unsupported or invalid YAML: %s", (text) => {
    expect(() => parseConfig(text)).toThrow();
  });
  it("does not expose secret source snippets in YAML errors", () => {
    expect(() =>
      parseConfig("providers: [secret-api-key", "test.yaml"),
    ).toThrow("Invalid YAML in test.yaml");
    try {
      parseConfig("providers: [secret-api-key");
    } catch (error) {
      expect(String(error)).not.toContain("secret-api-key");
    }
  });
  it("preserves YAML comments and unrelated values during concurrent atomic updates", async () => {
    const configPath = join(await directory(), "config.yaml");
    const original =
      '# My settings\ndefaults:\n  search:\n    provider: exa # search backend\n    maxResults: 7\nproviders:\n  exa:\n    credentials:\n      api:\n        value: "private-key" # keep this comment\n';
    await writeFile(configPath, original);
    await Promise.all([
      setCapabilityDefault("search", "brave", { configPath }),
      setCapabilityDefault("answer", "openai", { configPath }),
    ]);
    const text = await readFile(configPath, "utf8");
    expect(text).toContain("# My settings");
    expect(text).toContain("brave # search backend");
    expect(text).toContain('"private-key" # keep this comment');
    expect(parseConfig(text).defaults).toEqual({
      search: { provider: "brave", maxResults: 7 },
      answer: { provider: "openai" },
    });
    if (process.platform !== "win32")
      expect((await stat(configPath)).mode & 0o777).toBe(0o600);
    await writeFile(configPath, "defaults: {}\ndefaults: {}\n");
    await expect(
      setCapabilityDefault("search", "exa", { configPath }),
    ).rejects.toThrow("Invalid YAML");
    expect(await readFile(configPath, "utf8")).toBe(
      "defaults: {}\ndefaults: {}\n",
    );
  });
  it("allows incomplete option defaults and checks required fields after merging", async () => {
    const config = parseConfig(
      JSON.stringify({
        defaults: { answer: { provider: "firecrawl" } },
        providers: {
          firecrawl: { options: { answer: { onlyMainContent: false } } },
        },
      }),
    );
    const client = createWebfox({ config, env: {} });
    expect(client.inspectCapability("answer").defaults.options).toMatchObject({
      onlyMainContent: false,
    });
    await expect(client.answer({ queries: ["question"] })).rejects.toThrow(
      "required properties url",
    );
    expect(() =>
      parseConfig(
        JSON.stringify({
          providers: {
            firecrawl: { options: { answer: { onlyMainContent: "wrong" } } },
          },
        }),
      ),
    ).toThrow("Invalid");
  });
  it("uses the webfox configuration directory on each platform", () => {
    expect(
      resolveConfigPath({ env: {}, home: "/home/test", platform: "linux" }),
    ).toBe("/home/test/.config/webfox/config.yaml");
    expect(
      resolveConfigPath({ env: { APPDATA: "/appdata" }, platform: "win32" }),
    ).toBe("/appdata/webfox/config.yaml");
    expect(
      resolveConfigPath({
        env: { XDG_CONFIG_HOME: "/xdg" },
        platform: "darwin",
      }),
    ).toBe("/xdg/webfox/config.yaml");
  });
  it("resolves environment-selected files relative to the client working directory", async () => {
    const cwd = await directory();
    await writeFile(
      join(cwd, "relative.json"),
      JSON.stringify({ defaults: { search: { provider: "brave" } } }),
    );
    const env = { WEBFOX_CONFIG: "relative.json" };
    expect(
      createWebfox({ cwd, env }).inspectCapability("search").provider,
    ).toBe("brave");
    await setCapabilityDefault("answer", "openai", { cwd, env });
    expect(
      parseConfig(await readFile(join(cwd, "relative.json"), "utf8")).defaults
        ?.answer?.provider,
    ).toBe("openai");
  });
  it("saves a narrow default without credentials, preserving advanced settings", async () => {
    const configPath = join(await directory(), "config.json");
    await setCapabilityDefault("search", "brave", { configPath });
    expect(parseConfig(await readFile(configPath, "utf8"))).toEqual({
      defaults: { search: { provider: "brave" } },
    });
    await writeFile(
      configPath,
      JSON.stringify({
        defaults: { search: { provider: "brave", maxResults: 7 } },
        providers: { brave: { options: { search: { mode: "news" } } } },
      }),
    );
    await setCapabilityDefault("search", "openai", { configPath });
    const config = parseConfig(await readFile(configPath, "utf8"));
    expect(config.defaults?.search).toEqual({
      provider: "openai",
      maxResults: 7,
    });
    expect(config.providers?.brave?.options?.search).toEqual({ mode: "news" });
    expect(() =>
      parseConfig('{"defaults":{"search":{"options":{"model":"x"}}}}'),
    ).toThrow("Provider options belong under");
    await expect(
      setCapabilityDefault("contents", "brave", { configPath }),
    ).rejects.toThrow("does not support");
  });
  it("resolves explicit and XDG paths without probing credentials", () => {
    expect(
      resolveConfigPath({
        configPath: "./chosen.json",
        env: { WEBFOX_CONFIG: "/ignored" },
      }),
    ).toMatch(/chosen.json$/);
    expect(
      resolveConfigPath({ env: { XDG_CONFIG_HOME: "/tmp/config-home" } }),
    ).toBe("/tmp/config-home/webfox/config.yaml");
    const config = customConfig();
    config.providers!.custom!.commands!.answer!.env = {
      SECRET: { command: ["never-run-this"] },
    };
    const client = createWebfox({ config, env: {} });
    expect(client.inspectCapability("answer").configured).toBe(true);
    expect(
      client.listProviders().find((p) => p.id === "custom")?.selectedDefaults,
    ).toContain("answer");
  });
  it("resolves credential commands asynchronously with client environment/cwd/cache isolation", async () => {
    const cwd = await directory();
    const config = customConfig();
    config.providers!.custom!.commands!.answer = {
      argv: [
        process.execPath,
        "-e",
        "console.log(JSON.stringify({text:process.env.SECRET}))",
      ],
      env: {
        SECRET: {
          command: [
            process.execPath,
            "-e",
            'require("node:fs").appendFileSync("runs", "x"); console.log(process.env.TEST_SECRET)',
          ],
        },
      },
    };
    const client = createWebfox({
      config,
      cwd,
      env: { TEST_SECRET: "client-one" },
    });
    for (let i = 0; i < 2; i++)
      expect(JSON.stringify(await client.answer({ queries: ["q"] }))).toContain(
        "[redacted]",
      );
    expect(await readFile(join(cwd, "runs"), "utf8")).toBe("x");
    const other = createWebfox({
      config,
      cwd,
      env: { TEST_SECRET: "client-two" },
    });
    expect(
      JSON.stringify(await other.answer({ queries: ["q"] })),
    ).not.toContain("client-two");
    expect(await readFile(join(cwd, "runs"), "utf8")).toBe("xx");
  });
  it("includes credential commands in deadlines and does not expose failed command secrets", async () => {
    const config = customConfig();
    config.providers!.custom!.commands!.answer!.env = {
      SECRET: {
        command: [
          process.execPath,
          "-e",
          'setTimeout(()=>console.log("secret"),5000)',
        ],
      },
    };
    const result = await createWebfox({ config }).answer({
      queries: ["q"],
      timeoutMs: 40,
    });
    expect(result.results[0]).toMatchObject({ error: { code: "TIMEOUT" } });
    config.providers!.custom!.commands!.answer!.env = {
      SECRET: {
        command: [
          process.execPath,
          "-e",
          'console.error("secret-command-argument");process.exit(1)',
        ],
      },
    };
    await expect(
      createWebfox({ config }).answer({ queries: ["q"] }),
    ).rejects.toThrow("Credential command failed");
    try {
      await createWebfox({ config }).answer({ queries: ["q"] });
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain("secret-command-argument");
    }
  });
});
