import type { SerializedError, WebMuxErrorCode } from "./public-types.js";

export class WebMuxError extends Error {
  override readonly name = "WebMuxError";

  constructor(
    public readonly code: WebMuxErrorCode,
    message: string,
    public readonly options: {
      cause?: unknown;
      retryable?: boolean;
    } = {},
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

export function asWebMuxError(error: unknown): WebMuxError {
  if (error instanceof WebMuxError) {
    return error;
  }
  if (isCancellation(error)) {
    return new WebMuxError("CANCELLED", messageOf(error), { cause: error });
  }
  if (/timed out|timeout|deadline|exceeded/i.test(messageOf(error))) {
    return new WebMuxError("TIMEOUT", messageOf(error), { cause: error });
  }
  return new WebMuxError("PROVIDER_FAILURE", messageOf(error), {
    cause: error,
  });
}

function isCancellation(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  return (
    name === "AbortError" ||
    /aborted|cancelled|canceled/i.test(messageOf(error))
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
