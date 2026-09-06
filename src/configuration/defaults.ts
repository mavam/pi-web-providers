import { readFile, mkdir, writeFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { CAPABILITIES, type Capability, type ProviderId } from "../domain.js";
import { WebfoxError } from "../errors.js";
import {
  parseConfig,
  parseConfigDocument,
  resolveConfigPath,
  type ConfigPathOptions,
} from "./file.js";
import { selectProvider, validateConfiguredOptions } from "./planning.js";
import type { WebfoxConfig } from "./types.js";

const updates = new Map<string, Promise<unknown>>();
export async function setCapabilityDefault(
  capability: Capability,
  provider: ProviderId,
  options: ConfigPathOptions = {},
): Promise<string> {
  if (!CAPABILITIES.includes(capability))
    throw new WebfoxError(
      "INVALID_INPUT",
      `Unknown capability '${capability}'. Choose ${CAPABILITIES.join(", ")}.`,
    );
  try {
    selectProvider({}, capability, provider);
  } catch (error) {
    throw new WebfoxError(
      "INVALID_INPUT",
      error instanceof WebfoxError
        ? error.message
        : "Invalid provider selection.",
    );
  }
  const path = resolveConfigPath(options);
  const previous = updates.get(path) ?? Promise.resolve();
  const operation = previous
    .catch(() => {})
    .then(async () => {
      let config: WebfoxConfig = {};
      let text = "";
      try {
        text = await readFile(path, "utf8");
        config = parseConfig(text, path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      config.defaults = {
        ...config.defaults,
        [capability]: { ...config.defaults?.[capability], provider },
      };
      validateConfiguredOptions(config);
      const document = parseConfigDocument(text, path);
      document.setIn(["defaults", capability, "provider"], provider);
      const serialized = document.toString();
      parseConfig(serialized, path);
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, serialized, {
          mode: 0o600,
          flag: "wx",
        });
        await rename(temporary, path);
      } finally {
        await rm(temporary, { force: true });
      }
      return path;
    });
  updates.set(path, operation);
  try {
    return await operation;
  } catch (error) {
    if (error instanceof WebfoxError) throw error;
    throw new WebfoxError(
      "INVALID_CONFIG",
      `Could not save provider default to ${path}. Check the path and file permissions.`,
    );
  } finally {
    if (updates.get(path) === operation) updates.delete(path);
  }
}
