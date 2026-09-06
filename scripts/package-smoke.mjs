#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourcePackageJson = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
);
const expectedSchemaUrl = `https://unpkg.com/${sourcePackageJson.name}@${sourcePackageJson.version}/dist/config.schema.json`;
const directory = await mkdtemp(join(tmpdir(), "webfox-package-smoke-"));
let archive;

try {
  const packed = JSON.parse(
    execFileSync("npm", ["pack", "--json"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    }),
  );
  archive = resolve(root, packed[0].filename);
  await writeFile(
    join(directory, "package.json"),
    '{"type":"module","private":true}\n',
  );
  execFileSync(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", archive],
    {
      cwd: directory,
      stdio: "inherit",
    },
  );

  const executable =
    process.platform === "win32"
      ? join(directory, "node_modules", ".bin", "webfox.cmd")
      : join(directory, "node_modules", ".bin", "webfox");
  const help = execFileSync(executable, ["--help"], {
    cwd: directory,
    encoding: "utf8",
  });
  if (!help.includes("webfox"))
    throw new Error("packed webfox --help did not run");
  const version = execFileSync(executable, ["--version"], {
    cwd: directory,
    encoding: "utf8",
  }).trim();
  if (version !== sourcePackageJson.version)
    throw new Error("packed webfox --version does not match package metadata");

  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      [
        'const library = await import("webfox");',
        'if (typeof library.createWebfox !== "function") throw new Error("missing createWebfox");',
        `if (library.CONFIG_SCHEMA_URL !== ${JSON.stringify(expectedSchemaUrl)}) throw new Error("library schema version does not match package metadata");`,
      ].join("\n"),
    ],
    { cwd: directory, stdio: "inherit" },
  );

  const packageJson = JSON.parse(
    await readFile(
      join(directory, "node_modules", "webfox", "package.json"),
      "utf8",
    ),
  );
  if (
    packageJson.name !== sourcePackageJson.name ||
    packageJson.version !== sourcePackageJson.version
  ) {
    throw new Error("packed metadata is incorrect");
  }
  if (
    JSON.stringify(Object.keys(packageJson.bin)) !==
      JSON.stringify(["webfox"]) ||
    packageJson.bin.webfox.replace(/^\.\//, "") !== "dist/cli.js"
  )
    throw new Error("packed package must expose only the webfox executable");
  const schema = JSON.parse(
    await readFile(
      join(directory, "node_modules", "webfox", "dist", "config.schema.json"),
      "utf8",
    ),
  );
  if (schema.$id !== expectedSchemaUrl)
    throw new Error("packed schema version does not match package metadata");
  const configPath = join(directory, "webfox.json");
  const sample = join(
    directory,
    "node_modules",
    "webfox",
    "examples",
    "custom",
    "provider.mjs",
  );
  await writeFile(
    configPath,
    JSON.stringify({
      providers: {
        custom: {
          commands: Object.fromEntries(
            ["search", "contents", "answer", "research"].map((capability) => [
              capability,
              { argv: [process.execPath, sample] },
            ]),
          ),
        },
      },
    }),
  );
  const run = (args, input) =>
    execFileSync(executable, [...args, "--config", configPath], {
      cwd: directory,
      encoding: "utf8",
      input,
      stdio: ["pipe", "pipe", "pipe"],
    });
  run(["config", "default", "search", "custom"]);
  run(["config", "validate"]);
  const text = run(["search", "example"]);
  if (
    !text.includes("Example result for example") ||
    text.trimStart().startsWith("{")
  )
    throw new Error("piped output was not plain text");
  const cases = [
    ["search", ["first query", "second query"], undefined, 2],
    [
      "contents",
      ["https://example.com/a", "https://example.com/a"],
      undefined,
      2,
    ],
    ["answer", ["-"], "one complete\nquestion", 1],
    ["research", ["-"], "one complete\nbrief", 1],
  ];
  for (const [capability, inputs, stdin, count] of cases) {
    const document = JSON.parse(
      run(
        [capability, ...inputs, "--provider", "custom", "--format", "json"],
        stdin,
      ),
    );
    if (
      document.status !== "ok" ||
      document.results.length !== count ||
      document.results.some((result) => !result.ok)
    )
      throw new Error(`packed ${capability} failed`);
  }
  // Optional pi peers must not be required by standalone library/CLI users.
  // Install the host separately before checking the extension entry point.
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      `@earendil-works/pi-coding-agent@${sourcePackageJson.devDependencies["@earendil-works/pi-coding-agent"]}`,
    ],
    { cwd: directory, stdio: "inherit" },
  );
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      'if (typeof (await import("webfox/pi")).default !== "function") throw new Error("missing pi extension")',
    ],
    { cwd: directory, stdio: "inherit" },
  );
  console.log("Packed package and custom-provider smoke tests passed.");
} finally {
  if (archive) await rm(archive, { force: true });
  await rm(directory, { recursive: true, force: true });
}
