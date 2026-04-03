import { Type } from "@sinclair/typebox";

export function literalUnion<const TValues extends readonly string[]>(
  values: TValues,
  options?: Record<string, unknown>,
) {
  return Type.Union(
    values.map((value) => Type.Literal(value)),
    options,
  );
}
