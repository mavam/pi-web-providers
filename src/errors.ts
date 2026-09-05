import type { SerializedError, WebMuxErrorCode } from "./domain.js";

export class WebMuxError extends Error {
  override readonly name = "WebMuxError";
  constructor(
    public readonly code: WebMuxErrorCode,
    message: string,
    public readonly options: { cause?: unknown; retryable?: boolean } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
  }
  toJSON(): SerializedError {
    return {
      code: this.code,
      message: this.message,
      ...(this.options.retryable === undefined
        ? {}
        : { retryable: this.options.retryable }),
    };
  }
}

/** Classify structured transport/SDK fields, never error-message substrings. */
export function asWebMuxError(error: unknown): WebMuxError {
  if (error instanceof WebMuxError) return error;
  const record =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  const message =
    typeof record.message === "string" ? record.message : String(error);
  if (record.name === "AbortError" || record.name === "APIUserAbortError")
    return new WebMuxError("CANCELLED", message);
  if (
    record.name === "TimeoutError" ||
    record.name === "RequestTimeoutError" ||
    record.name === "APIConnectionTimeoutError"
  )
    return new WebMuxError("TIMEOUT", message, { retryable: true });
  const status = record.status ?? record.statusCode;
  const cause =
    record.cause && typeof record.cause === "object"
      ? (record.cause as Record<string, unknown>)
      : {};
  const retryable =
    (typeof status === "number" &&
      [408, 429, 500, 502, 503, 504].includes(status)) ||
    [
      "ECONNRESET",
      "EHOSTUNREACH",
      "EAI_AGAIN",
      "ETIMEDOUT",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_SOCKET",
    ].includes(String(record.code ?? cause.code)) ||
    record.name === "APIConnectionError";
  return new WebMuxError("PROVIDER_FAILURE", message, { retryable });
}

export function httpError(response: Response, message: string): WebMuxError {
  return new WebMuxError("PROVIDER_FAILURE", message, {
    retryable: [408, 429, 500, 502, 503, 504].includes(response.status),
  });
}
