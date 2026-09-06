import { stripVTControlCharacters } from "node:util";
import { truncateToWidth } from "@earendil-works/pi-tui";

/** Pi's shell owns the background; truncation must not reset it. */
export function truncateLine(text: string, width: number): string {
  return truncateToWidth(text, width).replaceAll(
    "\x1b[0m",
    "\x1b[22;23;24;25;27;28;29;39m",
  );
}

/** Keep source punctuation literal and remove terminal control sequences. */
export function plainText(value: string): string {
  return stripVTControlCharacters(value).replace(
    /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g,
    "",
  );
}
