import type { TObject } from "typebox";
import type { Tool } from "./types.js";

export type ProviderOptions = Record<string, unknown>;

export type ToolOptionsFor<
  _TTool extends Tool,
  TProviderOptions extends ProviderOptions = ProviderOptions,
> = TProviderOptions;

export function buildToolOptionsSchema(
  _capability: Tool,
  providerSchema?: TObject,
) {
  if (!providerSchema || Object.keys(providerSchema.properties).length === 0) {
    return undefined;
  }

  return providerSchema;
}
