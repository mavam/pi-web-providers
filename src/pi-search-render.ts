import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Text,
  getCapabilities,
  hyperlink,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";
import type { SearchDocument } from "./domain.js";
import { plainText, truncateLine } from "./pi-text.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function searchDocument(value: unknown): value is SearchDocument {
  if (
    !isRecord(value) ||
    value.capability !== "search" ||
    !Array.isArray(value.results)
  )
    return false;
  return value.results.every((entry) => {
    if (!isRecord(entry) || typeof entry.input !== "string") return false;
    if (entry.ok === false)
      return isRecord(entry.error) && typeof entry.error.message === "string";
    return (
      entry.ok === true &&
      isRecord(entry.value) &&
      Array.isArray(entry.value.results) &&
      entry.value.results.every(
        (result) =>
          isRecord(result) &&
          typeof result.title === "string" &&
          typeof result.url === "string" &&
          typeof result.snippet === "string",
      )
    );
  });
}

function link(url: string, theme: Theme): string {
  const label = theme.fg("accent", theme.underline(plainText(url)));
  if (!getCapabilities().hyperlinks || /[\x00-\x20\x7f-\x9f]/.test(url))
    return label;
  try {
    const target = new URL(url);
    if (target.protocol === "https:" || target.protocol === "http:")
      return hyperlink(label, target.href);
  } catch {
    /* Invalid URLs remain readable, never executable links. */
  }
  return label;
}

/** Search excerpts are text, not documents. Never parse their Markdown. */
export function renderSearchResult(
  details: unknown,
  fallback: string,
  theme: Theme,
): Component {
  const document =
    isRecord(details) && searchDocument(details.result)
      ? details.result
      : undefined;
  return {
    render(width) {
      if (width <= 0) return [];
      if (!document) {
        // Truncated/older results may lack structured data. Respect the saved
        // output bound and full-results path instead of loading the full file.
        const text = plainText(fallback)
          .split("\n")
          .map((line) => {
            const urlLine = /^(\s*)(https?:\/\/\S+)(\s*)$/.exec(line);
            return urlLine
              ? urlLine[1] + link(urlLine[2], theme) + urlLine[3]
              : theme.fg("toolOutput", line);
          })
          .join("\n");
        return new Text(text, 0, 0)
          .render(width)
          .map((line) => truncateLine(line, width));
      }
      const lines: string[] = [];
      const append = (text: string, prefix = "") => {
        const indent = visibleWidth(prefix);
        const wrapped = new Text(text, 0, 0).render(
          Math.max(1, width - indent),
        );
        lines.push(
          ...wrapped.map((line, index) =>
            truncateLine((index ? " ".repeat(indent) : prefix) + line, width),
          ),
        );
      };
      document.results.forEach((entry, index) => {
        if (index) lines.push("");
        if (document.results.length > 1) {
          append(
            theme.fg(
              "mdHeading",
              theme.bold(`${index + 1}. ${plainText(entry.input)}`),
            ),
          );
          lines.push("");
        }
        if (!entry.ok) {
          append(theme.fg("error", `Error: ${plainText(entry.error.message)}`));
          return;
        }
        if (!entry.value.results.length)
          append(theme.fg("toolOutput", "No results found."));
        entry.value.results.forEach((result, resultIndex) => {
          if (resultIndex) lines.push("");
          const number = `${resultIndex + 1}. `;
          const indent = " ".repeat(number.length);
          append(
            theme.fg("toolOutput", plainText(result.title)),
            theme.fg("accent", number),
          );
          append(link(result.url, theme), indent);
          if (result.snippet)
            append(theme.fg("toolOutput", plainText(result.snippet)), indent);
        });
      });
      return lines;
    },
    invalidate() {},
  };
}
