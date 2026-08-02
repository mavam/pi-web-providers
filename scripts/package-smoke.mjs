#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const directory = await mkdtemp(join(tmpdir(), "web-mux-package-smoke-"));
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
      ? join(directory, "node_modules", ".bin", "web.cmd")
      : join(directory, "node_modules", ".bin", "web");
  const help = execFileSync(executable, ["--help"], {
    cwd: directory,
    encoding: "utf8",
  });
  if (!help.includes("web-mux"))
    throw new Error("packed web --help did not run");

  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      [
        'const library = await import("web-mux");',
        'if (typeof library.createWebMux !== "function") throw new Error("missing createWebMux");',
        'await import("web-mux/pi");',
      ].join("\n"),
    ],
    { cwd: directory, stdio: "inherit" },
  );

  const packageJson = JSON.parse(
    await readFile(
      join(directory, "node_modules", "web-mux", "package.json"),
      "utf8",
    ),
  );
  if (packageJson.name !== "web-mux" || packageJson.version !== "0.1.0") {
    throw new Error("packed metadata is incorrect");
  }
  console.log("Packed package smoke test passed.");
} finally {
  if (archive) await rm(archive, { force: true });
  await rm(directory, { recursive: true, force: true });
}
