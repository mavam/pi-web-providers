#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

const { name, version } = JSON.parse(await readFile("package.json", "utf8"));
const schemaUrl = `https://unpkg.com/${name}@${version}/dist/config.schema.json`;
for (const path of [
  "README.md",
  "example-config.yaml",
  "src/config.schema.json",
]) {
  const content = await readFile(path, "utf8");
  const updated = content.replace(
    /https:\/\/unpkg\.com\/webfox@[^/\s]+\/dist\/config\.schema\.json/g,
    schemaUrl,
  );
  if (!updated.includes(schemaUrl))
    throw new Error(`Missing Webfox schema URL in ${path}`);
  if (updated !== content) await writeFile(path, updated);
}
