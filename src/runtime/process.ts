import type { ChildProcess } from "node:child_process";

/** Call only for children spawned with detached: true on POSIX. */
export function killProcessGroup(
  child: ChildProcess,
  signal: NodeJS.Signals,
): void {
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      /* The process group may already have exited. */
    }
  }
  child.kill(signal);
}

export function cancelProcessGroup(child: ChildProcess): void {
  killProcessGroup(child, "SIGTERM");
  // Keep the grace-period timer alive even if the group leader exits first:
  // descendants can ignore SIGTERM or close their inherited output streams.
  setTimeout(() => killProcessGroup(child, "SIGKILL"), 250);
}
