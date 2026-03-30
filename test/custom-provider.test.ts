import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { customAdapter } from "../src/providers/custom.js";

const cleanupDirs: string[] = [];

afterEach(async () => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("customAdapter", () => {
  it("executes a configured search command and parses structured JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-providers-custom-"));
    cleanupDirs.push(root);

    const scriptPath = join(root, "search.mjs");
    await writeFile(
      scriptPath,
      [
        'let input = "";',
        'process.stdin.setEncoding("utf8");',
        'process.stdin.on("data", (chunk) => (input += chunk));',
        'process.stdin.on("end", () => {',
        "  const request = JSON.parse(input);",
        "  process.stderr.write(`searching ${request.query}\\n`);",
        "  process.stdout.write(JSON.stringify({",
        "    results: [{",
        "      title: `Result for ${request.query}` ,",
        '      url: "https://example.com",',
        '      snippet: "example snippet",',
        "      score: 0.9,",
        "      metadata: { echoedMaxResults: request.maxResults }",
        "    }]",
        "  }));",
        "});",
      ].join("\n"),
      "utf8",
    );

    const provider = customAdapter;
    const progress: string[] = [];
    const result = await provider.search(
      "custom query",
      3,
      {
        options: {
          search: {
            argv: [process.execPath, scriptPath],
          },
        },
      },
      {
        cwd: process.cwd(),
        onProgress: (message: string) => progress.push(message),
      },
      { mode: "demo" },
    );

    expect(result).toEqual({
      provider: "custom",
      results: [
        {
          title: "Result for custom query",
          url: "https://example.com",
          snippet: "example snippet",
          score: 0.9,
          metadata: { echoedMaxResults: 3 },
        },
      ],
    });
    expect(progress).toEqual([]);
  });

  it("parses provider tool output for non-search capabilities", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-providers-custom-"));
    cleanupDirs.push(root);

    const scriptPath = join(root, "answer.mjs");
    await writeFile(
      scriptPath,
      [
        'let input = "";',
        'process.stdin.setEncoding("utf8");',
        'process.stdin.on("data", (chunk) => (input += chunk));',
        'process.stdin.on("end", () => {',
        "  const request = JSON.parse(input);",
        "  process.stdout.write(JSON.stringify({",
        "    text: `Answer for: ${request.query}` ,",
        "    itemCount: 2,",
        '    metadata: { source: "fixture" }',
        "  }));",
        "});",
      ].join("\n"),
      "utf8",
    );

    const provider = customAdapter;
    const result = await provider.answer(
      "what is this?",
      {
        options: {
          answer: {
            argv: [process.execPath, scriptPath],
          },
        },
      },
      {
        cwd: process.cwd(),
      },
      undefined,
    );

    expect(result).toEqual({
      provider: "custom",
      text: "Answer for: what is this?",
      itemCount: 2,
      metadata: { source: "fixture" },
    });
  });

  it("rejects invalid search payloads from the wrapped command", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-providers-custom-"));
    cleanupDirs.push(root);

    const scriptPath = join(root, "invalid.mjs");
    await writeFile(
      scriptPath,
      [
        'process.stdout.write(JSON.stringify({ results: [{ title: "Missing fields" }] }));',
      ].join("\n"),
      "utf8",
    );

    const provider = customAdapter;

    await expect(
      provider.search(
        "broken",
        1,
        {
          options: {
            search: {
              argv: [process.execPath, scriptPath],
            },
          },
        },
        {
          cwd: process.cwd(),
        },
        undefined,
      ),
    ).rejects.toThrow(/results\[0\]\.url/);
  });
});
