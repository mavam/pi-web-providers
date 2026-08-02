import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONFIG_SCHEMA_URL,
  PACKAGE_NAME,
  PACKAGE_VERSION,
} from "../src/package-metadata.js";

describe("package metadata", () => {
  it("keeps runtime and static schema URLs aligned with package.json", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve("package.json"), "utf8"),
    );
    const expectedSchemaUrl = `https://unpkg.com/${packageJson.name}@${packageJson.version}/dist/config.schema.json`;

    expect(PACKAGE_NAME).toBe(packageJson.name);
    expect(PACKAGE_VERSION).toBe(packageJson.version);
    expect(CONFIG_SCHEMA_URL).toBe(expectedSchemaUrl);

    const schema = JSON.parse(
      await readFile(resolve("src/config.schema.json"), "utf8"),
    );
    const example = JSON.parse(
      await readFile(resolve("example-config.json"), "utf8"),
    );
    const readme = await readFile(resolve("README.md"), "utf8");
    expect(schema.$id).toBe(expectedSchemaUrl);
    expect(example.$schema).toBe(expectedSchemaUrl);
    expect(readme).toContain(`"$schema": "${expectedSchemaUrl}"`);
  });
});
