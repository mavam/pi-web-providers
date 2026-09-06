import { stripVTControlCharacters } from "node:util";
import { keyText, type Theme } from "@earendil-works/pi-coding-agent";
import {
  Text,
  Container,
  truncateToWidth,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";
import type { Capability } from "./domain.js";

const urlStates = {
  queued: { glyph: "○", color: "dim" },
  running: { glyph: "◌", color: "accent" },
  done: { glyph: "✓", color: "success" },
  failed: { glyph: "✗", color: "error" },
  cancelled: { glyph: "−", color: "warning" },
} as const;
export interface UrlStatus {
  url: string;
  state: keyof typeof urlStates;
}

function statusRows(details: unknown): UrlStatus[] | undefined {
  if (
    !details ||
    typeof details !== "object" ||
    !("webContentsStatus" in details) ||
    details.webContentsStatus !== true ||
    !("urls" in details) ||
    !Array.isArray(details.urls)
  )
    return;
  return details.urls.filter(
    (row): row is UrlStatus =>
      row &&
      typeof row === "object" &&
      typeof row.url === "string" &&
      typeof row.state === "string" &&
      Object.hasOwn(urlStates, row.state),
  );
}

/** Display-only input formatting; never interpret input as terminal markup. */
function displayInput(value: string, url: boolean): string {
  const quoted = JSON.stringify(stripVTControlCharacters(value));
  return url ? quoted.slice(1, -1) : quoted;
}

export class WebCall implements Component {
  private args: Record<string, unknown> = {};
  private theme!: Theme;
  private expanded = false;

  constructor(private readonly capability: Capability) {}

  update(args: unknown, theme: Theme, expanded: boolean): void {
    this.args =
      args && typeof args === "object" ? (args as Record<string, unknown>) : {};
    this.theme = theme;
    this.expanded = expanded;
  }

  render(width: number): string[] {
    if (width <= 0) return [];
    const { args, theme, capability } = this;
    const title = theme.fg("toolTitle", theme.bold(`web ${capability}`));
    const raw =
      capability === "research"
        ? [args.input]
        : capability === "contents"
          ? args.urls
          : args.queries;
    const inputs = Array.isArray(raw)
      ? raw.filter((value): value is string => typeof value === "string")
      : [];
    let text = title;
    if (inputs.length && (capability !== "contents" || this.expanded))
      text +=
        " " +
        theme.fg(
          "accent",
          inputs
            .map((value) => displayInput(value, capability === "contents"))
            .join(" "),
        );
    if (
      capability === "search" &&
      typeof args.maxResults === "number" &&
      Number.isFinite(args.maxResults)
    )
      text +=
        theme.fg("dim", " limit ") +
        theme.fg("warning", String(args.maxResults));
    if (this.expanded)
      return visibleWidth(text) <= width
        ? [text]
        : new Text(text, 0, 0).render(width);
    const key = keyText("app.tools.expand");
    const hint = theme.fg(
      "dim",
      key ? ` (${key} to expand)` : " (expand for details)",
    );
    if (width >= visibleWidth(title) + visibleWidth(hint) + 3)
      return [truncateToWidth(text, width - visibleWidth(hint)) + hint];
    return [truncateToWidth(text, width)];
  }

  // Rendering is stateless so width and theme changes never retain stale styling.
  invalidate(): void {}
}

export function renderWebResult(
  result: { content: { type: string; text?: string }[]; details?: unknown },
  options: { expanded: boolean; isPartial: boolean },
  theme: Theme,
  isError: boolean,
): Component {
  const text = result.content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
  const rows = statusRows(result.details);
  if (rows?.length) {
    const container = new Container();
    container.addChild({
      render: (width) =>
        width > 0
          ? rows.map((row) => {
              const { glyph, color } = urlStates[row.state];
              return truncateToWidth(
                theme.fg(color, glyph) +
                  " " +
                  theme.fg("accent", displayInput(row.url, true)),
                width,
              );
            })
          : [],
      invalidate() {},
    });
    if (options.expanded && !options.isPartial)
      container.addChild(new Text(theme.fg("toolOutput", text), 0, 0));
    return container;
  }
  if (options.expanded)
    return new Text(theme.fg(isError ? "error" : "toolOutput", text), 0, 0);
  const partialFailure =
    result.details &&
    typeof result.details === "object" &&
    "status" in result.details &&
    result.details.status === "partial";
  if (!options.isPartial && !isError && !partialFailure) return new Container();
  const summary = partialFailure
    ? "One or more inputs failed; expand for details."
    : (stripVTControlCharacters(text)
        .split(/\r?\n/)
        .find((line) => line.trim()) ??
      (options.isPartial ? "Working…" : "Tool failed; expand for details."));
  const safe = JSON.stringify(summary).slice(1, -1);
  return {
    render: (width) =>
      width > 0
        ? [
            truncateToWidth(
              theme.fg(
                isError || partialFailure ? "error" : "muted",
                `${isError || partialFailure ? "✗" : "◌"} ${safe}`,
              ),
              width,
            ),
          ]
        : [],
    invalidate() {},
  };
}
