import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";

const fixture = resolve("test/fixtures/custom-provider.mjs");

async function setupConfig(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "web-mux-cli-"));
  const path = join(directory, "config.json");
  const command = { argv: [process.execPath, fixture] };
  await writeFile(
    path,
    JSON.stringify({
      defaults: {
        search: { provider: "custom" },
        contents: { provider: "custom" },
        answer: { provider: "custom" },
        research: { provider: "custom" },
      },
      providers: {
        custom: {
          commands: {
            search: command,
            contents: command,
            answer: command,
            research: command,
          },
        },
      },
    }),
  );
  return path;
}

async function invoke(
  args: string[],
  stdin = "",
  signalSource?: EventEmitter,
  env: NodeJS.ProcessEnv = process.env,
) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = "";
  let err = "";
  stdout.on("data", (chunk) => {
    out += chunk;
  });
  stderr.on("data", (chunk) => {
    err += chunk;
  });
  const code = await runCli(args, {
    stdin: Readable.from([stdin]),
    stdout,
    stderr,
    env,
    cwd: process.cwd(),
    signalSource,
  });
  return { code, out, err };
}

function forcedColorEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, FORCE_COLOR: "1" };
  delete env.NO_COLOR;
  return env;
}

describe("web CLI", () => {
  it("uses Commander help with provider-specific option groups", async () => {
    const result = await invoke(["search", "--provider", "openai", "--help"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Usage: web search");
    expect(result.out).toContain("Common options");
    expect(result.out).toContain("OpenAI options");
    expect(result.out).toContain("--search-context-size <value>");
    expect(result.out).not.toMatch(/\x1b\[/);
  });

  it("validates generated enum flags through Commander", async () => {
    const result = await invoke([
      "search",
      "hello",
      "--provider",
      "openai",
      "--search-context-size",
      "huge",
    ]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("must be one of: low, medium, high");
    expect(result.err).toContain("✘︎");
  });

  it("colors human output when forced and uses heavy status marks", async () => {
    const path = await setupConfig();
    const result = await invoke(
      ["search", "hello", "--config", path],
      "",
      undefined,
      forcedColorEnv(),
    );
    expect(result.code).toBe(0);
    expect(result.out).toContain("✔︎");
    expect(result.out).toMatch(/\x1b\[/);
    expect(result.err).toMatch(/\x1b\[/);
  });

  it("honors --no-color even when color is forced", async () => {
    const path = await setupConfig();
    const result = await invoke(
      ["search", "hello", "--config", path, "--no-color"],
      "",
      undefined,
      forcedColorEnv(),
    );
    expect(result.code).toBe(0);
    expect(result.out).toContain("✔︎");
    expect(result.out).not.toMatch(/\x1b\[/);
    expect(result.err).not.toMatch(/\x1b\[/);
  });

  it("never colors normalized JSON output", async () => {
    const path = await setupConfig();
    const result = await invoke(
      ["search", "hello", "--config", path, "--output", "json"],
      "",
      undefined,
      forcedColorEnv(),
    );
    expect(result.code).toBe(0);
    expect(result.out).not.toMatch(/\x1b\[/);
    expect(JSON.parse(result.out)).toMatchObject({ status: "ok" });
  });

  it("never colors raw output", async () => {
    const path = await setupConfig();
    const result = await invoke(
      ["search", "hello", "--config", path, "--raw"],
      "",
      undefined,
      forcedColorEnv(),
    );
    expect(result.code).toBe(0);
    expect(result.out).not.toMatch(/\x1b\[/);
    expect(JSON.parse(result.out)).toMatchObject({
      capability: "search",
      status: "ok",
    });
  });

  it("uses the heavy X for partial human output", async () => {
    const path = await setupConfig();
    const result = await invoke([
      "answer",
      "first",
      "--query",
      "fail",
      "--config",
      path,
    ]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("✘︎");
  });

  it("keeps provider status cells icon-only", async () => {
    const directory = await mkdtemp(join(tmpdir(), "web-mux-providers-"));
    const path = join(directory, "config.json");
    await writeFile(path, "{}");
    const result = await invoke(
      ["providers", "--config", path],
      "",
      undefined,
      { NO_COLOR: "1" },
    );
    expect(result.code).toBe(0);
    const [matrix] = result.out.split("\n\n");
    expect(result.out).toMatch(/^brave\s+✘︎\s+—\s+✘︎\s+✘︎$/m);
    expect(result.out).toMatch(/^claude\s+✔︎\s+—\s+✔︎\s+—$/m);
    expect(matrix).not.toMatch(/\b(?:ready|local|setup)\b/);
    expect(result.out).toContain(
      "Legend: ✔︎ available · ✘︎ setup required · — unsupported",
    );
  });

  it("reports an unknown first-pass provider as a usage error", async () => {
    const result = await invoke(["search", "--provider", "bogus", "hello"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("Unknown provider 'bogus'");
    expect(result.err).not.toContain("TypeError");
  });

  it("treats --version after -- as positional input", async () => {
    const path = await setupConfig();
    const result = await invoke([
      "search",
      "--config",
      path,
      "--",
      "--version",
    ]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Result for --version");
  });

  it("keeps normalized JSON on stdout and progress on stderr", async () => {
    const path = await setupConfig();
    const result = await invoke([
      "search",
      "hello",
      "--config",
      path,
      "--output",
      "json",
    ]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toMatchObject({
      schemaVersion: 1,
      capability: "search",
      provider: "custom",
      status: "ok",
    });
    expect(result.out.trim().split("\n")).toHaveLength(1);
    expect(result.err).toContain("custom search progress");
  });

  it("reads newline-separated contents URLs from stdin", async () => {
    const path = await setupConfig();
    const result = await invoke(
      ["contents", "-", "--config", path, "--output", "json"],
      "https://one.test\nhttps://two.test\n",
    );
    expect(result.code).toBe(0);
    expect(
      JSON.parse(result.out).results.map((entry: any) => entry.input),
    ).toEqual(["https://one.test", "https://two.test"]);
  });

  it("emits available batch results and exits nonzero for partial failure", async () => {
    const path = await setupConfig();
    const result = await invoke([
      "answer",
      "first",
      "--query",
      "fail",
      "--config",
      path,
      "--output",
      "json",
    ]);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.out)).toMatchObject({ status: "partial" });
  });

  it("runs research in the foreground and reports progress", async () => {
    const path = await setupConfig();
    const result = await invoke(["research", "brief", "--config", path]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Research for brief");
    expect(result.err).toContain("custom research progress");
  });

  it("uses exit 2 for mutually exclusive output modes", async () => {
    const result = await invoke([
      "search",
      "query",
      "--raw",
      "--output",
      "json",
    ]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("cannot be combined");
  });

  it("returns exit 130 when Ctrl-C cancels foreground research", async () => {
    const path = await setupConfig();
    const signals = new EventEmitter();
    const pending = invoke(
      ["research", "slow", "--config", path, "--output", "json"],
      "",
      signals,
    );
    setTimeout(() => signals.emit("SIGINT"), 20);
    const result = await pending;
    expect(result.code).toBe(130);
    expect(JSON.parse(result.out).results[0].error.code).toBe("CANCELLED");
  });

  it("validates provider options without resolving credential commands", async () => {
    const directory = await mkdtemp(join(tmpdir(), "web-mux-validate-"));
    const path = join(directory, "config.json");
    await writeFile(
      path,
      JSON.stringify({
        providers: {
          openai: {
            credentials: {
              api: { command: ["definitely-does-not-exist"] },
            },
            options: {
              search: { searchContextSize: "impossible" },
            },
          },
        },
      }),
    );
    const result = await invoke(["config", "validate", "--config", path]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("Invalid openai search options");
    expect(result.err).not.toContain("definitely-does-not-exist");
  });
});
