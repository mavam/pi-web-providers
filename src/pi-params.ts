import { stripVTControlCharacters } from "node:util";
import type { Capability } from "./domain.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Never reveal credential-bearing options, including inside arrays. */
function safeOptions(
  value: unknown,
  ancestors = new WeakSet<object>(),
): unknown {
  if (typeof value === "string") return stripVTControlCharacters(value);
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value !== "object") return undefined;
  if (ancestors.has(value)) return "[Circular]";
  ancestors.add(value);
  const safe = Array.isArray(value)
    ? value.map((child) => safeOptions(child, ancestors))
    : Object.fromEntries(
        Object.entries(value).map(([key, child]) => {
          const normalized = stripVTControlCharacters(key).replace(
            /[^a-z0-9]/gi,
            "",
          );
          // Token budgets/counts are model settings, not credentials.
          const sensitive =
            /authorization|apikey|credential|password|secret|headers?|cookie|privatekey|token$|^(auth|bearer)$/i.test(
              normalized,
            );
          return [
            key,
            sensitive ? "[redacted]" : safeOptions(child, ancestors),
          ];
        }),
      );
  ancestors.delete(value);
  return safe;
}

function keySegment(key: string): string {
  const safe = stripVTControlCharacters(key);
  return /^[a-zA-Z_][\w-]*$/.test(safe) ? safe : JSON.stringify(safe);
}

function parameterValue(value: unknown): string | undefined {
  if (
    typeof value === "string" &&
    /^[a-zA-Z_][\w./:@+-]*$/.test(value) &&
    !/^(true|false|null)$/.test(value)
  )
    return value;
  return JSON.stringify(value);
}

/** Show only explicit call choices, not configured or provider defaults. */
export function callParameters(
  capability: Capability,
  args: Record<string, unknown>,
  formatKey: (key: string) => string = (key) => key,
): string {
  const pairs: string[] = [];
  if (
    capability === "search" &&
    typeof args.maxResults === "number" &&
    Number.isFinite(args.maxResults)
  )
    pairs.push(`${formatKey("limit")}=${args.maxResults}`);
  const append = (value: unknown, path: string) => {
    if (isRecord(value) && Object.keys(value).length) {
      for (const [key, child] of Object.entries(value))
        append(child, path ? `${path}.${keySegment(key)}` : keySegment(key));
    } else if (path) {
      const formatted = parameterValue(value);
      if (formatted !== undefined)
        pairs.push(`${formatKey(path)}=${formatted}`);
    }
  };
  if (isRecord(args.options)) {
    const options = safeOptions(args.options) as Record<string, unknown>;
    for (const [key, value] of Object.entries(options)) {
      // Avoid confusing a provider option with the top-level search limit.
      append(value, key === "limit" ? "options.limit" : keySegment(key));
    }
  }
  return pairs.join(" ");
}
