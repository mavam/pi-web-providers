import { CAPABILITIES } from "../domain.js";
import { CONFIG_SCHEMA_URL } from "../package-metadata.js";
import { providers } from "../providers/registry.js";
import { optionSchema } from "./planning.js";

const text = { type: "string", minLength: 1 };
const object = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  properties,
});
const source = {
  oneOf: ["env", "value", "command"].map((key) => ({
    ...object({
      [key]:
        key === "command" ? { type: "array", minItems: 1, items: text } : text,
    }),
    required: [key],
  })),
};
const sourceMap = { type: "object", additionalProperties: source };
const command = {
  ...object({
    argv: { type: "array", minItems: 1, items: text },
    cwd: text,
    env: sourceMap,
  }),
  required: ["argv"],
};
const positive = { type: "integer", minimum: 1 };
const timeout = { ...positive, maximum: 2_147_483_647 };
const fields: Record<string, unknown> = {
  credentials: sourceMap,
  baseUrl: text,
  accountId: source,
  commands: object(
    Object.fromEntries(CAPABILITIES.map((capability) => [capability, command])),
  ),
};

/** Generated from the same lightweight definitions as help and planning. */
export const configurationSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: CONFIG_SCHEMA_URL,
  title: "webfox configuration",
  ...object({
    $schema: text,
    defaults: object(
      Object.fromEntries(
        CAPABILITIES.map((capability) => [
          capability,
          object({
            provider: {
              enum: Object.values(providers)
                .filter((provider) => provider.capabilities[capability])
                .map((provider) => provider.id),
            },
            ...(capability === "search" ? { maxResults: positive } : {}),
          }),
        ]),
      ),
    ),
    execution: object({
      timeoutMs: timeout,
      researchTimeoutMs: timeout,
      retries: { type: "integer", minimum: 0 },
      retryDelayMs: { type: "integer", minimum: 0 },
      concurrency: positive,
    }),
    providers: object(
      Object.fromEntries(
        Object.values(providers).map((provider) => [
          provider.id,
          object(
            Object.fromEntries(
              provider.fields.map((field) => [
                field,
                field === "options"
                  ? object(
                      Object.fromEntries(
                        CAPABILITIES.filter(
                          (capability) => provider.capabilities[capability],
                        ).map((capability) => [
                          capability,
                          optionSchema(provider, capability, "defaults") ?? {
                            type: "object",
                            additionalProperties: provider.id === "custom",
                          },
                        ]),
                      ),
                    )
                  : field === "credentials"
                    ? object(
                        Object.fromEntries(
                          provider.credentials.map((credential) => [
                            credential.name,
                            source,
                          ]),
                        ),
                      )
                    : fields[field],
              ]),
            ),
          ),
        ]),
      ),
    ),
  }),
};
