import type pc from "picocolors";
import type { SerializedError } from "../domain.js";

/** Human-facing status only; never decorate result documents on stdout. */
export function createDiagnostics(
  stderr: Pick<NodeJS.WritableStream, "write">,
  colors: ReturnType<typeof pc.createColors>,
) {
  const write = (glyph: string, message: string) =>
    stderr.write(`${glyph} ${message.trimEnd()}\n`);
  return {
    success: (message: string) => write(colors.green("✔︎"), message),
    progress: (message: string) => write(colors.yellow("▶︎"), message),
    error(error: Pick<SerializedError, "code" | "message">, input?: string) {
      const glyph =
        error.code === "CANCELLED" ? colors.dim("■") : colors.red("✘︎");
      write(
        glyph,
        `${input === undefined ? "" : `${input}: `}${error.code}: ${error.message}`,
      );
    },
  };
}
