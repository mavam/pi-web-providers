import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createWebMux,
  parseConfig,
  resolveConfigPath,
  setCapabilityDefault,
} from "../src/index.js";
import { customConfig } from "./helpers.js";
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "web-mux-config-"));
  directories.push(path);
  return path;
}

describe("configuration and credential boundaries", () => {
  it("allows incomplete option defaults and checks required fields after merging", async () => {
    const config = parseConfig(
      JSON.stringify({
        defaults: { answer: { provider: "firecrawl" } },
        providers: {
          firecrawl: { options: { answer: { onlyMainContent: false } } },
        },
      }),
    );
    const client = createWebMux({ config, env: {} });
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
  it("resolves environment-selected files relative to the client working directory", async () => {
    const cwd = await directory();
    await writeFile(
      join(cwd, "relative.json"),
      JSON.stringify({ defaults: { search: { provider: "brave" } } }),
    );
    const env = { WEB_MUX_CONFIG: "relative.json" };
    expect(
      createWebMux({ cwd, env }).inspectCapability("search").provider,
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
    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
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
        env: { WEB_MUX_CONFIG: "/ignored" },
      }),
    ).toMatch(/chosen.json$/);
    expect(
      resolveConfigPath({ env: { XDG_CONFIG_HOME: "/tmp/config-home" } }),
    ).toBe("/tmp/config-home/web-mux/config.json");
    const config = customConfig();
    config.providers!.custom!.commands!.answer!.env = {
      SECRET: { command: ["never-run-this"] },
    };
    const client = createWebMux({ config, env: {} });
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
    const client = createWebMux({
      config,
      cwd,
      env: { TEST_SECRET: "client-one" },
    });
    for (let i = 0; i < 2; i++)
      expect(JSON.stringify(await client.answer({ queries: ["q"] }))).toContain(
        "[redacted]",
      );
    expect(await readFile(join(cwd, "runs"), "utf8")).toBe("x");
    const other = createWebMux({
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
    const result = await createWebMux({ config }).answer({
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
      createWebMux({ config }).answer({ queries: ["q"] }),
    ).rejects.toThrow("Credential command failed");
    try {
      await createWebMux({ config }).answer({ queries: ["q"] });
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain("secret-command-argument");
    }
  });
});
