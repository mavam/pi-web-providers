import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadConfig,
  parseConfig,
  redactConfig,
  resolveConfigPath,
} from "../src/index.js";
import { resolveConfigValue } from "../src/config-values.js";

describe("configuration", () => {
  it("resolves explicit, environment, XDG, home, and Windows paths in order", () => {
    expect(resolveConfigPath({ configPath: "./explicit.json" })).toMatch(
      /explicit\.json$/,
    );
    expect(
      resolveConfigPath({ env: { WEB_MUX_CONFIG: "/tmp/from-env.json" } }),
    ).toBe("/tmp/from-env.json");
    expect(
      resolveConfigPath({
        env: { XDG_CONFIG_HOME: "/tmp/xdg" },
        home: "/home/test",
      }),
    ).toBe("/tmp/xdg/web-mux/config.json");
    expect(
      resolveConfigPath({ env: {}, home: "/home/test", platform: "linux" }),
    ).toBe("/home/test/.config/web-mux/config.json");
    expect(
      resolveConfigPath({
        env: { APPDATA: "C:\\Users\\test\\AppData" },
        platform: "win32",
      }),
    ).toContain("web-mux/config.json");
  });

  it("accepts only exact credential source objects and strict fields", () => {
    expect(
      parseConfig(
        JSON.stringify({
          providers: {
            openai: { credentials: { api: { env: "OPENAI_API_KEY" } } },
          },
        }),
      ),
    ).toMatchObject({
      providers: {
        openai: { credentials: { api: { env: "OPENAI_API_KEY" } } },
      },
    });

    expect(() =>
      parseConfig(
        JSON.stringify({
          providers: { openai: { credentials: { api: "OPENAI_API_KEY" } } },
        }),
      ),
    ).toThrow(/must be a JSON object/);
    expect(() =>
      parseConfig(
        JSON.stringify({
          providers: {
            openai: { credentials: { api: { env: "KEY", value: "secret" } } },
          },
        }),
      ),
    ).toThrow(/exactly one/);
    expect(() => parseConfig('{"tools":{"search":"openai"}}')).toThrow(
      /Unknown field/,
    );
  });

  it("validates without running credential commands and redacts all literal/command sources", async () => {
    const directory = await mkdtemp(join(tmpdir(), "web-mux-config-"));
    const path = join(directory, "config.json");
    await writeFile(
      path,
      JSON.stringify({
        providers: {
          openai: {
            credentials: {
              api: { command: ["definitely-does-not-exist", "secret-arg"] },
              literal: { value: "top-secret" },
              env: { env: "OPENAI_API_KEY" },
            },
          },
        },
      }),
    );
    const config = await loadConfig({ configPath: path });
    expect(redactConfig(config)).toMatchObject({
      providers: {
        openai: {
          credentials: {
            api: { command: ["<redacted>"] },
            literal: { value: "<redacted>" },
            env: { env: "OPENAI_API_KEY" },
          },
        },
      },
    });
  });

  it("runs credential argv directly and caches trimmed stdout", async () => {
    const directory = await mkdtemp(join(tmpdir(), "web-mux-credential-"));
    const script = join(directory, "credential.mjs");
    const marker = join(directory, "marker.txt");
    await writeFile(
      script,
      [
        'import { appendFileSync } from "node:fs";',
        'appendFileSync(process.argv[2], "x");',
        "process.stdout.write(`  ${process.argv[3]}  \\n`);",
      ].join("\n"),
    );
    const source = {
      command: [
        process.execPath,
        script,
        marker,
        "literal;$(never-executed)",
      ] as [string, ...string[]],
    };
    expect(resolveConfigValue(source)).toBe("literal;$(never-executed)");
    expect(resolveConfigValue(source)).toBe("literal;$(never-executed)");
    expect(
      await import("node:fs/promises").then(({ readFile }) =>
        readFile(marker, "utf8"),
      ),
    ).toBe("x");
  });
});
