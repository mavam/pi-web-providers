import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import {
  CONFIG_SCHEMA_URL,
  PACKAGE_NAME,
  PACKAGE_VERSION,
} from "../src/package-metadata.js";

describe("package metadata", () => {
  it("keeps Pi runtime packages optional for standalone consumers", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve("package.json"), "utf8"),
    );
    for (const peer of [
      "@earendil-works/pi-coding-agent",
      "@earendil-works/pi-tui",
    ]) {
      expect(packageJson.peerDependencies[peer]).toBe("*");
      expect(packageJson.peerDependenciesMeta[peer]).toEqual({
        optional: true,
      });
      expect(packageJson.dependencies).not.toHaveProperty(peer);
      expect(packageJson.optionalDependencies ?? {}).not.toHaveProperty(peer);
      expect(packageJson.bundledDependencies ?? []).not.toContain(peer);
    }
  });
  it("keeps runtime and static schema URLs aligned with package.json", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve("package.json"), "utf8"),
    );
    const expectedSchemaUrl = `https://unpkg.com/${packageJson.name}@${packageJson.version}/dist/config.schema.json`;

    expect(packageJson.name).toBe("webfox");
    expect(packageJson.bin).toEqual({ web: "./dist/cli.js" });
    expect(packageJson.pi.extensions).toEqual(["./dist/pi.js"]);
    expect(PACKAGE_NAME).toBe(packageJson.name);
    expect(PACKAGE_VERSION).toBe(packageJson.version);
    expect(CONFIG_SCHEMA_URL).toBe(expectedSchemaUrl);

    const schema = JSON.parse(
      await readFile(resolve("src/config.schema.json"), "utf8"),
    );
    const example = parse(
      await readFile(resolve("example-config.yaml"), "utf8"),
    );
    const readme = await readFile(resolve("README.md"), "utf8");
    expect(schema.$id).toBe(expectedSchemaUrl);
    expect(example.$schema).toBe(expectedSchemaUrl);
    expect(readme).toContain(`$schema: ${expectedSchemaUrl}`);
  });
});
