import { Type } from "typebox";

export function literalUnion<const TValues extends readonly string[]>(
  values: TValues,
  options?: Record<string, unknown>,
) {
  return Type.Union(
    values.map((value) => Type.Literal(value)),
    options,
  );
}

/**
 * A flag that can be enabled with `true` or configured with an options object.
 * Common for SDK tool toggles that also accept per-tool configuration.
 */
export function boolOrConfig(options?: Record<string, unknown>) {
  return Type.Union(
    [Type.Boolean(), Type.Record(Type.String(), Type.Any())],
    options,
  );
}
