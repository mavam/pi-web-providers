import { readFile, mkdir, writeFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { CAPABILITIES, type Capability, type ProviderId } from "../domain.js";
import { WebMuxError } from "../errors.js";
import {
  parseConfig,
  resolveConfigPath,
  type ConfigPathOptions,
} from "./file.js";
import { selectProvider, validateConfiguredOptions } from "./planning.js";
import type { WebMuxConfig } from "./types.js";

const updates = new Map<string, Promise<unknown>>();
export async function setCapabilityDefault(
  capability: Capability,
  provider: ProviderId,
  options: ConfigPathOptions = {},
): Promise<string> {
  if (!CAPABILITIES.includes(capability))
    throw new WebMuxError(
      "INVALID_INPUT",
      `Unknown capability '${capability}'. Choose ${CAPABILITIES.join(", ")}.`,
    );
  try {
    selectProvider({}, capability, provider);
  } catch (error) {
    throw new WebMuxError(
      "INVALID_INPUT",
      error instanceof WebMuxError
        ? error.message
        : "Invalid provider selection.",
    );
  }
  const path = resolveConfigPath(options);
  const previous = updates.get(path) ?? Promise.resolve();
  const operation = previous
    .catch(() => {})
    .then(async () => {
      let config: WebMuxConfig = {};
      try {
        config = parseConfig(await readFile(path, "utf8"), path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      config.defaults = {
        ...config.defaults,
        [capability]: { ...config.defaults?.[capability], provider },
      };
      validateConfiguredOptions(config);
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, {
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
    if (error instanceof WebMuxError) throw error;
    throw new WebMuxError(
      "INVALID_CONFIG",
      `Could not save provider default to ${path}. Check the path and file permissions.`,
    );
  } finally {
    if (updates.get(path) === operation) updates.delete(path);
  }
}
