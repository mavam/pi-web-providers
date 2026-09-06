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
  it("shows redacted YAML configuration and validates it", async () => {
    const shown = await cli(["config", "show"]);
    expect(shown.code).toBe(0);
    expect(shown.stdout).toContain("defaults:\n");
    expect(parse(shown.stdout).defaults.search.provider).toBe("custom");
    expect((await cli(["config", "validate"])).code).toBe(0);
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
          '  webfox search "Node.js release notes" --provider brave',
          "  webfox config default search brave",
          "  webfox search --help",
          "  webfox search --provider brave --help",
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
          expect(line).toMatch(new RegExp(`^  webfox ${capability} `));
        expect(examples?.[1]).toBe(
          `  webfox ${capability} --provider ${provider} --help`,
        );
        const styled = await cli(args, "", {}, { stdout: true, stderr: false });
        expect(styled.stdout).toContain("\u001b[1mExamples:\u001b[22m");
        expect(styled.stdout).toContain(
          `  \u001b[36mwebfox ${capability}\u001b[39m`,
        );
        expect(stripVTControlCharacters(styled.stdout)).toBe(plain.stdout);
      }
    },
  );
  it("uses webfox in help, examples, and provider guidance", async () => {
    const root = await cli(["--help"]);
    expect(root.code).toBe(0);
    expect(root.stdout).toContain("Usage: webfox");
    expect(root.stdout).toContain("webfox search");
    expect(root.stdout).toContain("webfox config default");
    const search = await cli(["search", "--help"]);
    expect(search.stdout).toContain("Usage: webfox search");
    expect(search.stdout).toContain("  webfox search --provider brave --help");
    const invalid = await cli(["search", "query", "--provider", "invalid"]);
    expect(invalid.stderr).toContain("See webfox providers");
    const missing = await cli(["search", "query"], "", {
      env: { XDG_CONFIG_HOME: directories[0] },
    });
    expect(missing.stderr).toContain("webfox config default search");
  });
  it("keeps execution errors on stderr even with quiet text output", async () => {
    const failure = await cli(["search", "fail", "--quiet"]);
    expect(failure.code).toBe(1);
    expect(failure.stdout).toBe("");
    expect(failure.stderr).toContain("PROVIDER_FAILURE");
    const partial = await cli(["search", "success", "fail", "--quiet"]);
    expect(partial.stdout).toContain("Result for success");
    expect(partial.stdout).not.toContain("intentional provider failure");
    expect(partial.stderr).toContain("intentional provider failure");
  });
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
    expect(json.stderr).toContain("custom search progress");
    expect((await cli(["search", "-", "other"], "stdin")).code).toBe(2);
    for (const flag of ["--raw", "--output", "--query", "--retries"])
      expect((await cli(["search", "x", flag, "json"])).code).toBe(2);
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
  it("reports discovery honestly and saves defaults with no stdout banner", async () => {
    const result = await cli(["providers"]);
    expect(result.stdout).toContain("Supported");
    expect(result.stdout).toContain("Configured");
    expect(result.stdout).toContain("Selected default");
    expect(result.stdout).toContain("have not been verified");
    const saved = await cli(["config", "default", "search", "brave"]);
    expect(saved.code).toBe(0);
    expect(saved.stdout).toBe("");
    expect(saved.stderr).toContain("Saved search default: brave");
  });
  it("cancels pending stdin and unregisters signal listeners", async () => {
    const signalSource = new EventEmitter();
    const pending = cli(["search", "-"], "", {
      stdin: new PassThrough(),
      signalSource,
    });
    const timer = setInterval(() => {
      if (signalSource.listenerCount("SIGINT")) signalSource.emit("SIGINT");
    }, 10);
    try {
      expect((await pending).code).toBe(130);
    } finally {
      clearInterval(timer);
    }
    expect(signalSource.listenerCount("SIGINT")).toBe(0);
    expect(signalSource.listenerCount("SIGTERM")).toBe(0);
  });
});
