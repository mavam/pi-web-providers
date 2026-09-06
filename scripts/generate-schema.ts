import { writeFile } from "node:fs/promises";
import { configurationSchema } from "../src/configuration/schema.js";
await writeFile(
  new URL("../src/config.schema.json", import.meta.url),
  `${JSON.stringify(configurationSchema, null, 2)}\n`,
);
