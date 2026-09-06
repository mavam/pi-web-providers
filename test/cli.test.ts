import { Readable, Writable, PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { parse, stringify } from "yaml";
import { EventEmitter } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildOptionFlags, runCli } from "../src/cli.js";
import { customConfig } from "./helpers.js";
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function cli(
  args: string[],
  input = "",
  extra: Record<string, unknown> = {},
  terminals = { stdout: false, stderr: false },
) {
  const cwd = await mkdtemp(join(tmpdir(), "webfox-cli-"));
  directories.push(cwd);
  const config = join(cwd, "config.yaml");
  await writeFile(
    config,
    stringify(customConfig(), { aliasDuplicateObjects: false }),
  );
  let stdout = "";
  let stderr = "";
  const code = await runCli(args, {
    stdin: Readable.from([input]),
    stdout: Object.assign(
      new Writable({
        write(chunk, _encoding, done) {
          stdout += chunk;
          done();
        },
      }),
      { isTTY: terminals.stdout },
    ),
    stderr: Object.assign(
      new Writable({
        write(chunk, _encoding, done) {
          stderr += chunk;
          done();
        },
      }),
      { isTTY: terminals.stderr },
    ),
    env: { WEBFOX_CONFIG: config },
    cwd,
    ...extra,
  });
  return { code, stdout, stderr };
}
describe("CLI contracts", () => {
  it.each(["claude", "codex"])(
    "rejects removed provider %s instead of falling back",
    async (provider) => {
      for (const args of [
        ["search", "example", "--provider", provider],
        ["providers", provider],
        ["config", "default", "search", provider],
      ]) {
        const result = await cli(args);
        expect(result.code).not.toBe(0);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain(`Unknown provider '${provider}'`);
      }
      const listed = await cli(["providers"]);
      expect(listed.code).toBe(0);
      expect(listed.stdout.toLowerCase()).not.toContain(provider);
    },
  );
  it("shows redacted YAML configuration and validates it", async () => {
    const shown = await cli(["config", "show"]);
    expect(shown.code).toBe(0);
    expect(shown.stdout).toContain("defaults:\n");
    expect(parse(shown.stdout).defaults.search.provider).toBe("custom");
    const validated = await cli(["config", "validate"]);
    expect(validated.code).toBe(0);
    expect(validated.stderr).toBe(
      "✔︎ Configuration is valid. Credentials and connectivity have not been verified.\n",
    );
  });
  it.each([
    ["--help"],
    ["search", "--help"],
    ["search", "--provider", "openai", "--help"],
    ["config", "--help"],
  ])(
    "styles terminal help for %j without changing its text",
    async (...args) => {
      const plain = await cli(args);
      const styled = await cli(args, "", {}, { stdout: true, stderr: false });
      expect(styled.code).toBe(0);
      expect(styled.stdout).toContain("\u001b[1mUsage:\u001b[22m");
      expect(styled.stdout).toContain("\u001b[36m");
      expect(stripVTControlCharacters(styled.stdout)).toBe(plain.stdout);
      expect(styled.stderr).toBe("");
    },
  );
  it.each([
    { args: ["--help"], env: {}, terminals: { stdout: false, stderr: true } },
    {
      args: ["--help"],
      env: { NO_COLOR: "" },
      terminals: { stdout: true, stderr: true },
    },
    {
      args: ["--no-color", "--help"],
      env: {},
      terminals: { stdout: true, stderr: true },
    },
    {
      args: ["search", "--help", "--no-color"],
      env: {},
      terminals: { stdout: true, stderr: true },
    },
  ])(
    "keeps help plain with $args and $env",
    async ({ args, env, terminals }) => {
      const result = await cli(args, "", { env }, terminals);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Usage:");
      expect(result.stdout).toBe(stripVTControlCharacters(result.stdout));
    },
  );
  it.each([[], ["--help"]])(
    "ends root help with copyable examples for %j",
    async (...args) => {
      const result = await cli(args);
      expect(result.code).toBe(0);
      expect(result.stdout.split("\nExamples:\n")[1]?.trimEnd()).toBe(
        [
          '  web search "Node.js release notes" --provider brave',
          "  web config default search brave",
          "  web search --help",
          "  web search --provider brave --help",
        ].join("\n"),
      );
      expect(result.stdout).not.toMatch(/^(Start:|Save:|Run )/m);
      const styled = await cli(args, "", {}, { stdout: true, stderr: false });
      expect(styled.stdout).toContain("\u001b[1mExamples:\u001b[22m");
      expect(styled.stdout).toContain(
        '\u001b[33m"Node.js release notes"\u001b[39m',
      );
      expect(stripVTControlCharacters(styled.stdout)).toBe(result.stdout);
    },
  );
  it.each([
    ["search", "brave"],
    ["contents", "tavily"],
    ["answer", "openai"],
    ["research", "gemini"],
  ])(
    "ends %s help with styled invocations only",
    async (capability, provider) => {
      for (const args of [
        [capability, "--help"],
        [capability, "--provider", provider, "--help"],
      ]) {
        const plain = await cli(args);
        expect(plain.code).toBe(0);
        const examples = plain.stdout
          .split("\nExamples:\n")[1]
          ?.trimEnd()
          .split("\n");
        expect(examples).toHaveLength(2);
        for (const line of examples ?? [])
          expect(line).toMatch(new RegExp(`^  web ${capability} `));
        expect(examples?.[1]).toBe(
          `  web ${capability} --provider ${provider} --help`,
        );
        const styled = await cli(args, "", {}, { stdout: true, stderr: false });
        expect(styled.stdout).toContain("\u001b[1mExamples:\u001b[22m");
        expect(styled.stdout).toContain(
          `  \u001b[36mweb ${capability}\u001b[39m`,
        );
        expect(stripVTControlCharacters(styled.stdout)).toBe(plain.stdout);
      }
    },
  );
  it("uses web in help, examples, and provider guidance", async () => {
    const root = await cli(["--help"]);
    expect(root.code).toBe(0);
    expect(root.stdout).toContain("Usage: web ");
    expect(root.stdout).toContain("web search");
    expect(root.stdout).toContain("web config default");
    const search = await cli(["search", "--help"]);
    expect(search.stdout).toContain("Usage: web search");
    expect(search.stdout).toContain("  web search --provider brave --help");
    const invalid = await cli(["search", "query", "--provider", "invalid"]);
    expect(invalid.stderr).toContain("See web providers");
    const missing = await cli(["search", "query"], "", {
      env: { XDG_CONFIG_HOME: directories[0] },
    });
    expect(missing.stderr).toContain("web config default search");
    const unsupported = await cli([
      "contents",
      "https://example.com",
      "--provider",
      "brave",
    ]);
    expect(unsupported.stderr).toContain(
      "See available providers: web providers",
    );
    const provider = await cli(["providers", "openai"]);
    expect(provider.stdout).toContain(
      "Options: web search --provider openai --help",
    );
  });
  it("keeps execution errors on stderr even with quiet text output", async () => {
    const failure = await cli(["search", "fail", "--quiet"]);
    expect(failure.code).toBe(1);
    expect(failure.stdout).toBe("");
    expect(failure.stderr).toMatch(/^✘︎ fail: PROVIDER_FAILURE: /);
    const partial = await cli(["search", "success", "fail", "--quiet"]);
    expect(partial.stdout).toContain("Result for success");
    expect(partial.stdout).not.toContain("intentional provider failure");
    expect(partial.stderr).toContain("intentional provider failure");
    expect(partial.stderr).not.toContain("✔︎");
  });
  it.each([
    ["search", "query", "--unknown"],
    ["search", "query", "--timeout"],
    ["search", "query", "--timeout", "invalid"],
    ["search"],
    ["unknown-command"],
  ])("prefixes argument errors exactly once for %j", async (...args) => {
    const result = await cli(args);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^✘︎ INVALID_INPUT: /);
    expect(result.stderr.match(/✘︎/g)).toHaveLength(1);
    expect(result.stderr).not.toContain("error: ");
  });
  it("prefixes configuration-loading errors", async () => {
    const result = await cli(["config", "validate"], "", {
      env: { WEBFOX_CONFIG: "/nonexistent-webfox-config.yaml" },
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/^✘︎ INVALID_CONFIG: /);
  });
  it.each(["search", "contents", "answer", "research"])(
    "reports %s success on stderr without decorating JSON",
    async (capability) => {
      const input = capability === "contents" ? "https://one.test" : "query";
      const result = await cli([capability, input, "--format", "json"]);
      expect(result.code).toBe(0);
      if (capability === "research")
        expect(result.stderr).toMatch(
          /✔︎ Research via Custom completed in \d+s\.\n/,
        );
      else expect(result.stderr).toContain(`✔︎ ${input}\n`);
      expect(JSON.parse(result.stdout).status).toBe("ok");
      expect(result.stdout).not.toMatch(/[✔✘▶■]/);
    },
  );
  it.each([
    { args: [], env: {}, tty: true, colored: true },
    { args: [], env: {}, tty: false, colored: false },
    { args: ["--no-color"], env: {}, tty: true, colored: false },
    { args: [], env: { NO_COLOR: "" }, tty: true, colored: false },
  ])(
    "respects diagnostic color controls: %j",
    async ({ args, env, tty, colored }) => {
      for (const [command, prefix, color] of [
        [["config", "validate"], "✔︎", 32],
        [["config", "unknown"], "✘︎", 31],
      ] as const) {
        const result = await cli(
          [...args, ...command],
          "",
          env.NO_COLOR === undefined
            ? {}
            : {
                env: {
                  ...env,
                  XDG_CONFIG_HOME: "/nonexistent-webfox-config-home",
                },
              },
          { stdout: true, stderr: tty },
        );
        expect(stripVTControlCharacters(result.stderr)).toMatch(
          new RegExp(`^${prefix} `),
        );
        if (colored)
          expect(result.stderr).toContain(
            `\u001b[${color}m${prefix}\u001b[39m`,
          );
        else
          expect(result.stderr).toBe(stripVTControlCharacters(result.stderr));
      }
    },
  );
  it("keeps reserved and colliding provider flags behind the JSON escape hatch", () => {
    const flags = buildOptionFlags({
      type: "object",
      properties: {
        provider: { type: "string" },
        apiKey: { type: "string" },
        api: { type: "object", properties: { key: { type: "string" } } },
        foo: { type: "boolean" },
        noFoo: { type: "boolean" },
        enabled: { type: "boolean" },
      },
    });
    expect(flags.map((flag) => [flag.flag, flag.negativeFlag])).toEqual([
      ["--enabled", "--no-enabled"],
    ]);
  });
  it("routes provider options with a leading color control and exposes incomplete required options in help", async () => {
    expect(
      (
        await cli([
          "--no-color",
          "search",
          "--provider",
          "brave",
          "--mode",
          "news",
          "--help",
        ])
      ).code,
    ).toBe(0);
    const help = await cli(["answer", "--provider", "firecrawl", "--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("--url");
  });
  it.each(["search", "contents", "answer", "research"])(
    "shows all controls in %s help and adds explicit provider options",
    async (capability) => {
      const common = await cli([capability, "--help"]);
      expect(common.code).toBe(0);
      expect(common.stdout).toContain("--format");
      expect(common.stdout).not.toContain("--model");
      for (const flag of ["--config", "--cwd", "--options-json", "--no-color"])
        expect(common.stdout).toContain(flag);
      expect(common.stdout).not.toContain("--retries");
      const provider = await cli(["search", "--provider", "openai", "--help"]);
      expect(provider.code).toBe(0);
      expect(provider.stdout).toContain("--search-context-size");
      for (const flag of ["--config", "--cwd", "--options-json", "--no-color"])
        expect(provider.stdout).toContain(flag);
    },
  );
  it("uses quoted positionals, explicit stdin, and one stable format selector", async () => {
    const text = await cli(["search", "first", "second", "--quiet"]);
    expect(text.code).toBe(0);
    expect(text.stdout).toContain("## 1. first");
    expect(text.stdout).not.toContain("✔");
    expect(text.stderr).toBe("");
    const json = await cli(
      ["search", "-", "--format", "json"],
      "one\ncomplete query",
    );
    expect(JSON.parse(json.stdout).results[0].input).toBe(
      "one\ncomplete query",
    );
    expect(json.stderr).toContain("▶︎ custom search progress\n");
    expect(json.stderr).toContain("✔︎ one\ncomplete query\n");
    expect((await cli(["search", "-", "other"], "stdin")).code).toBe(2);
    for (const flag of ["--raw", "--output", "--query", "--retries"])
      expect((await cli(["search", "x", flag, "json"])).code).toBe(2);
  });
  it.each(["search", "answer", "research", "contents"])(
    "reads implicit and explicit stdin for %s",
    async (capability) => {
      const input =
        capability === "contents"
          ? "https://example.com/a\r\n\r\nhttps://example.com/b\n"
          : "one\ncomplete input\n";
      const expected =
        capability === "contents"
          ? ["https://example.com/a", "https://example.com/b"]
          : ["one\ncomplete input"];
      for (const positionals of [[], ["-"]]) {
        const result = await cli(
          [capability, ...positionals, "--format", "json"],
          input,
        );
        expect(result.code).toBe(0);
        expect(
          JSON.parse(result.stdout).results.map(
            (entry: { input: string }) => entry.input,
          ),
        ).toEqual(expected);
      }
    },
  );
  it.each(["search", "answer", "research", "contents"])(
    "rejects empty stdin and missing terminal input for %s",
    async (capability) => {
      for (const positionals of [[], ["-"]]) {
        const result = await cli([capability, ...positionals], " \n\t");
        expect(result.code).toBe(2);
        expect(result.stderr).toContain("Stdin must contain non-empty input");
      }
      const stdin = Object.assign(new PassThrough(), { isTTY: true });
      const missing = await cli([capability], "", { stdin });
      expect(missing.code).toBe(2);
      expect(missing.stderr).toContain("Supply arguments or pipe input");
      expect(stdin.readableFlowing).not.toBe(true);
    },
  );
  it.each(["search", "answer", "research", "contents"])(
    "does not consume stdin with positional input or help for %s",
    async (capability) => {
      const stdin = new PassThrough();
      const input =
        capability === "contents" ? "https://example.com" : "explicit input";
      const result = await cli([capability, input, "--format", "json"], "", {
        stdin,
      });
      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout).results[0].input).toBe(input);
      const help = await cli([capability, "--help"], "", { stdin });
      expect(help.code).toBe(0);
      expect(help.stdout).toContain("piped or redirected stdin");
      expect(stdin.readableFlowing).not.toBe(true);
    },
  );
  it("rejects already-ended stdin without waiting for another end event", async () => {
    const stdin = Readable.from([]);
    await new Promise<void>((resolve) => {
      stdin.once("end", resolve);
      stdin.resume();
    });
    const result = await cli(["search"], "", { stdin });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Stdin must contain non-empty input");
  });
  it("keeps route selection consistent with option values and separators", async () => {
    const result = await cli([
      "search",
      '--options-json={"value":"--provider"}',
      "--provider=custom",
      "--",
      "--provider",
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Result for --provider");
    expect(
      (await cli(["search", "--provider", "invalid", "--help"])).code,
    ).toBe(2);
    expect(
      (
        await cli([
          "search",
          "--provider",
          "openai",
          "--help",
          "--search-context-size",
          "invalid",
        ])
      ).code,
    ).toBe(2);
  });
  it("preserves partial JSON and accepts readable overall deadlines", async () => {
    const result = await cli([
      "search",
      "slow",
      "fast",
      "--timeout",
      "150ms",
      "--format",
      "json",
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("✘︎ slow: TIMEOUT: ");
    expect(result.stderr).toContain("✔︎ fast\n");
    expect(
      JSON.parse(result.stdout).results.map((r: { ok: boolean }) => r.ok),
    ).toEqual([false, true]);
    expect((await cli(["research", "brief", "--timeout", "20m"])).code).toBe(0);
    expect((await cli(["research", "brief", "--timeout", "20"])).code).toBe(2);
    const contents = await cli(
      ["contents", "-", "--format", "json"],
      "https://one.test\nhttps://two.test\n",
    );
    expect(JSON.parse(contents.stdout).results).toHaveLength(2);
  });
  it("renders a capability matrix with aligned glyphs and selected defaults", async () => {
    const result = await cli(["providers"]);
    expect(result.code).toBe(0);
    const table = result.stdout.split("\n\n")[0];
    const rows = table.split("\n").map((row) => row.split(/ {2,}/));
    expect(rows[0]).toEqual([
      "",
      "Provider",
      "search",
      "contents",
      "answer",
      "research",
    ]);
    expect(rows.find((row) => row[1] === "custom")).toEqual([
      "★",
      "custom",
      "◉",
      "◉",
      "◉",
      "◉",
    ]);
    expect(rows.find((row) => row[1] === "brave")).toEqual([
      "☆",
      "brave",
      "✔︎",
      "✘︎",
      "✔︎",
      "✔︎",
    ]);
    const columnStarts = table
      .split("\n")
      .map((row) =>
        [...row.replaceAll("\uFE0E", "").matchAll(/\S.*?(?= {2,}|$)/g)].map(
          (match) => match.index,
        ),
      );
    const expectedStarts = columnStarts[0].map((start, i) =>
      i === 0 ? start : start + Math.floor((rows[0][i + 1].length - 1) / 2),
    );
    for (const starts of columnStarts.slice(1)) {
      expect(starts).toEqual([0, ...expectedStarts]);
    }
    const filtered = await cli(["providers", "custom"]);
    expect(filtered.stdout.split("\n\n")[0].split("\n")).toHaveLength(2);
    const styled = await cli(
      ["providers"],
      "",
      {},
      { stdout: true, stderr: false },
    );
    expect(styled.stdout).toContain("\u001b[");
    expect(stripVTControlCharacters(styled.stdout)).toBe(result.stdout);
    const noColor = await cli(
      ["--no-color", "providers"],
      "",
      {},
      { stdout: true, stderr: true },
    );
    expect(noColor.stdout).toBe(result.stdout);
  });
  it("separates provider configuration from selected defaults", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "webfox-provider-stars-"));
    directories.push(cwd);
    const config = customConfig();
    config.defaults!.search = { provider: "brave" };
    const configPath = join(cwd, "config.yaml");
    await writeFile(
      configPath,
      stringify(config, { aliasDuplicateObjects: false }),
    );
    const result = await cli(["providers"], "", {
      env: { WEBFOX_CONFIG: configPath },
    });
    expect(result.code).toBe(0);
    const rows = result.stdout
      .split("\n\n")[0]
      .split("\n")
      .map((row) => row.split(/ {2,}/));
    expect(rows.find((row) => row[1] === "custom")).toEqual([
      "★",
      "custom",
      "✔︎",
      "◉",
      "◉",
      "◉",
    ]);
    expect(rows.find((row) => row[1] === "brave")).toEqual([
      "☆",
      "brave",
      "◉",
      "✘︎",
      "✔︎",
      "✔︎",
    ]);
    const configured = await cli(["providers"], "", {
      env: {
        WEBFOX_CONFIG: configPath,
        BRAVE_SEARCH_API_KEY: "test-key",
      },
    });
    expect(
      configured.stdout.split("\n").find((row) => row.includes("  brave ")),
    ).toMatch(/^★ +brave +◉ +✘︎ +✔︎ +✔︎$/);
  });
  it("hides unused custom providers and reports only configured commands", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "webfox-custom-discovery-"));
    directories.push(cwd);
    const configPath = join(cwd, "config.yaml");
    const extra = { env: { WEBFOX_CONFIG: configPath } };
    const customRow = (text: string) =>
      text
        .split("\n\n")[0]
        .split("\n")
        .map((row) => row.split(/ {2,}/))
        .find((row) => row[1] === "custom");
    await writeFile(configPath, "{}\n");
    const hidden = await cli(["providers"], "", extra);
    expect(hidden.code).toBe(0);
    expect(customRow(hidden.stdout)).toBeUndefined();
    const explicit = await cli(["providers", "custom"], "", extra);
    expect(explicit.code).toBe(0);
    expect(customRow(explicit.stdout)).toEqual([
      "☆",
      "custom",
      "✘︎",
      "✘︎",
      "✘︎",
      "✘︎",
    ]);
    expect(explicit.stdout).toContain(
      "providers.custom.commands.<capability>.argv",
    );
    const config = customConfig();
    config.defaults = {};
    config.providers!.custom!.commands = {
      contents: config.providers!.custom!.commands!.contents!,
    };
    await writeFile(configPath, stringify(config));
    const partial = await cli(["providers"], "", extra);
    expect(partial.code).toBe(0);
    expect(customRow(partial.stdout)).toEqual([
      "★",
      "custom",
      "✘︎",
      "✔︎",
      "✘︎",
      "✘︎",
    ]);
    await writeFile(configPath, "defaults:\n  search:\n    provider: custom\n");
    const selected = await cli(["providers"], "", extra);
    expect(selected.code).toBe(0);
    expect(customRow(selected.stdout)).toEqual([
      "☆",
      "custom",
      "◉",
      "✘︎",
      "✘︎",
      "✘︎",
    ]);
  });
  it("reports discovery honestly and saves defaults with no stdout banner", async () => {
    const result = await cli(["providers"]);
    expect(result.stdout).toContain("Supported");
    expect(result.stdout).toContain("Configured");
    expect(result.stdout).toContain("Selected default");
    expect(result.stdout).not.toContain("Configured means");
    expect(result.stdout).not.toContain("have not been verified");
    const saved = await cli(["config", "default", "search", "brave"]);
    expect(saved.code).toBe(0);
    expect(saved.stdout).toBe("");
    expect(saved.stderr).toBe("✔︎ Saved search default: brave\n");
  });
  it.each([["search"], ["search", "-"]])(
    "cancels pending stdin for %j and unregisters signal listeners",
    async (...args) => {
      const signalSource = new EventEmitter();
      const pending = cli(args, "", {
        stdin: new PassThrough(),
        signalSource,
      });
      const timer = setInterval(() => {
        if (signalSource.listenerCount("SIGINT")) signalSource.emit("SIGINT");
      }, 10);
      try {
        const result = await pending;
        expect(result.code).toBe(130);
        expect(result.stderr).toBe("■ CANCELLED: Operation cancelled.\n");
      } finally {
        clearInterval(timer);
      }
      expect(signalSource.listenerCount("SIGINT")).toBe(0);
      expect(signalSource.listenerCount("SIGTERM")).toBe(0);
    },
  );
});
