export const RAW_PROVIDER_PAYLOAD = Symbol.for("web-mux.raw-provider-payload");

export type WithRawPayload = {
  [RAW_PROVIDER_PAYLOAD]?: unknown;
};

export function attachRawPayload<T extends object>(value: T, raw: unknown): T {
  Object.defineProperty(value, RAW_PROVIDER_PAYLOAD, {
    value: raw,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return value;
}

export function rawPayload(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  return (value as WithRawPayload)[RAW_PROVIDER_PAYLOAD] ?? value;
}
