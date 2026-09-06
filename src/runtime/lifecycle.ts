import { WebfoxError } from "../errors.js";

export function deadline(timeoutMs: number, parent?: AbortSignal) {
  const controller = new AbortController();
  const abort = () =>
    controller.abort(new WebfoxError("CANCELLED", "Operation cancelled."));
  if (parent?.aborted) abort();
  else parent?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(
        new WebfoxError(
          "TIMEOUT",
          `Operation exceeded its ${formatDuration(timeoutMs)} overall deadline.`,
        ),
      ),
    timeoutMs,
  );
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abort);
    },
  };
}
export function formatDuration(ms: number): string {
  const [unit, divisor] =
    ms >= 3_600_000
      ? (["h", 3_600_000] as const)
      : ms >= 60_000
        ? (["m", 60_000] as const)
        : ms >= 1000
          ? (["s", 1000] as const)
          : (["ms", 1] as const);
  return `${Number((ms / divisor).toFixed(3))}${unit}`;
}
export async function withSignal<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return promise;
  // Attach rejection handlers even when the signal is already aborted.
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(
        signal.reason ?? new WebfoxError("CANCELLED", "Operation cancelled."),
      );
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
export async function orderedMap<T, R>(
  items: T[],
  concurrency: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(items.length, concurrency) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await work(items[index], index);
      }
    }),
  );
  return results;
}
