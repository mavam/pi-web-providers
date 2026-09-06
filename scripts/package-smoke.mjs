#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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

  const installedBins = await readdir(join(directory, "node_modules", ".bin"));
  if (installedBins.some((name) => /^webfox(?:\.cmd|\.ps1)?$/.test(name)))
    throw new Error(
      "packed package must not install a webfox compatibility executable",
    );
  const executable =
    process.platform === "win32"
      ? join(directory, "node_modules", ".bin", "web.cmd")
      : join(directory, "node_modules", ".bin", "web");
  const help = execFileSync(executable, ["--help"], {
    cwd: directory,
    encoding: "utf8",
  });
  if (!help.includes("Usage: web ") || help.includes("Usage: webfox"))
    throw new Error("packed web --help did not show the web command");
  const version = execFileSync(executable, ["--version"], {
    cwd: directory,
    encoding: "utf8",
  }).trim();
  if (version !== sourcePackageJson.version)
    throw new Error("packed web --version does not match package metadata");

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
    JSON.stringify(Object.keys(packageJson.bin)) !== JSON.stringify(["web"]) ||
    packageJson.bin.web.replace(/^\.\//, "") !== "dist/cli.js"
  )
    throw new Error("packed package must expose only the web executable");
  const schema = JSON.parse(
    await readFile(
      join(directory, "node_modules", "webfox", "dist", "config.schema.json"),
      "utf8",
    ),
  );
  if (schema.$id !== expectedSchemaUrl)
    throw new Error("packed schema version does not match package metadata");
  for (const reference of [
    "reference.md",
    "cli-experience.md",
    "provider.md",
  ]) {
    await readFile(
      join(directory, "node_modules", "webfox", "docs", reference),
      "utf8",
    );
  }
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
      defaults: Object.fromEntries(
        ["search", "contents", "answer", "research"].map((capability) => [
          capability,
          { provider: "custom" },
        ]),
      ),
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
    ["search", [], "one complete\nquery", 1],
    ["contents", [], "https://example.com/a\nhttps://example.com/b\n", 2],
    ["answer", [], "one complete\nquestion", 1],
    ["research", [], "one complete\nbrief", 1],
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
  // Optional Pi peers must not be required by standalone library/CLI users.
  // Install only the host, then use its real loader. npm may keep pi-tui
  // nested under the host; native import bypasses Pi's module aliases.
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--install-strategy=nested",
      `@earendil-works/pi-coding-agent@${sourcePackageJson.devDependencies["@earendil-works/pi-coding-agent"]}`,
    ],
    { cwd: directory, stdio: "inherit" },
  );
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      [
        'import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";',
        'import { fileURLToPath } from "node:url";',
        "const loader = new DefaultResourceLoader({",
        "  cwd: process.cwd(), agentDir: process.env.PI_CODING_AGENT_DIR,",
        "  settingsManager: SettingsManager.inMemory(),",
        "  noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,",
        '  additionalExtensionPaths: [fileURLToPath(import.meta.resolve("webfox/pi"))],',
        "});",
        "await loader.reload();",
        "const { extensions, errors } = loader.getExtensions();",
        "if (errors.length) throw new Error(JSON.stringify(errors));",
        'if (extensions.length !== 1) throw new Error("expected one packed extension");',
        "const names = [...extensions[0].tools.keys()].sort();",
        'if (JSON.stringify(names) !== JSON.stringify(["web_answer", "web_contents", "web_research", "web_search"])) throw new Error(`missing packed tools: ${names}`);',
        "for (const name of names) {",
        '  const params = name === "web_contents" ? { urls: ["https://example.com"] } : name === "web_research" ? { input: "example" } : { queries: ["example"] };',
        "  const tool = extensions[0].tools.get(name).definition;",
        '  const result = await tool.execute("package-smoke", params, undefined, undefined, { cwd: process.cwd() });',
        '  if (result.details?.status !== "ok") throw new Error(`packed ${name} execution failed`);',
        "}",
      ].join("\n"),
    ],
    {
      cwd: directory,
      stdio: "inherit",
      env: {
        ...process.env,
        WEBFOX_CONFIG: configPath,
        PI_CODING_AGENT_DIR: join(directory, "agent"),
        PI_OFFLINE: "1",
      },
      timeout: 60_000,
    },
  );
  console.log("Packed package and custom-provider smoke tests passed.");
} finally {
  if (archive) await rm(archive, { force: true });
  await rm(directory, { recursive: true, force: true });
}
