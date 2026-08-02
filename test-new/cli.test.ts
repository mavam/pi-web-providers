import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";

const fixture = resolve("test-new/fixtures/custom-provider.mjs");

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

async function invoke(args: string[], stdin = "", signalSource?: EventEmitter) {
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
    env: process.env,
    cwd: process.cwd(),
    signalSource,
  });
  return { code, out, err };
}

describe("web CLI", () => {
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
