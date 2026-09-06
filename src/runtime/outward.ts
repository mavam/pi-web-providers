import { asWebfoxError, WebfoxError } from "../errors.js";
import type { SerializedError } from "../domain.js";

/** The only boundary through which internal provider data reaches a caller. */
export class OutwardBoundary {
  private readonly secrets = new Set<string>();
  addSecret(secret: string): void {
    if (secret) this.secrets.add(secret);
  }
  text(value: string): string {
    return [...this.secrets]
      .sort((a, b) => b.length - a.length)
      .reduce((text, secret) => text.split(secret).join("[redacted]"), value);
  }
  value<T>(value: T): T {
    const seen = new WeakSet<object>();
    const visit = (entry: unknown): unknown => {
      if (typeof entry === "string") return this.text(entry);
      if (!entry || typeof entry !== "object") return entry;
      if (seen.has(entry)) return "[Circular]";
      seen.add(entry);
      const result = Array.isArray(entry)
        ? entry.map(visit)
        : Object.fromEntries(
            Object.entries(entry).map(([key, child]) => [
              this.text(key),
              /authorization|api[-_]?key|token|credential|password|secret|headers?/i.test(
                key,
              )
                ? "[redacted]"
                : visit(child),
            ]),
          );
      seen.delete(entry);
      return result;
    };
    return visit(value) as T;
  }
  error(error: unknown): SerializedError {
    return this.value(asWebfoxError(error).toJSON());
  }
  exception(error: unknown): WebfoxError {
    const safe = this.error(error);
    // Do not expose an unredacted cause through the public exception.
    return new WebfoxError(safe.code, safe.message, {
      retryable: safe.retryable,
    });
  }
}
