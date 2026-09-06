import { stripVTControlCharacters } from "node:util";
import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import {
  Text,
  Container,
  Markdown,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";
import type { Capability } from "./domain.js";
import { callParameters } from "./pi-params.js";
import { expansionKey } from "./pi-keybindings.js";

import { plainText, truncateLine as truncateToWidth } from "./pi-text.js";
import { renderSearchResult } from "./pi-search-render.js";

const inputStates = {
  queued: { glyph: "●", color: "dim" },
  running: { glyph: "▶︎", color: "warning" },
  done: { glyph: "✔︎", color: "success" },
  failed: { glyph: "✘︎", color: "error" },
  cancelled: { glyph: "■", color: "dim" },
} as const;
export interface InputStatus {
  input: string;
  state: keyof typeof inputStates;
}

function statusRows(details: unknown): InputStatus[] | undefined {
  if (!details || typeof details !== "object") return;
  let rows: unknown[];
  if (
    "webInputStatus" in details &&
    details.webInputStatus === true &&
    "inputs" in details &&
    Array.isArray(details.inputs)
  ) {
    rows = details.inputs;
  } else if (
    "webContentsStatus" in details &&
    details.webContentsStatus === true &&
    "urls" in details &&
    Array.isArray(details.urls)
  ) {
    // Restore status rows persisted by earlier versions of the extension.
    rows = details.urls.map((row) => ({ input: row?.url, state: row?.state }));
  } else return;
  const inputs = rows.filter(
    (row): row is InputStatus =>
      !!row &&
      typeof row === "object" &&
      "input" in row &&
      typeof row.input === "string" &&
      "state" in row &&
      typeof row.state === "string" &&
      Object.hasOwn(inputStates, row.state),
  );
  return inputs;
}

/** Display-only input formatting; never interpret input as terminal markup. */
function displayInput(value: string): string {
  return JSON.stringify(plainText(value)).slice(1, -1);
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
    let text = title;
    const parameters = callParameters(capability, args, (key) =>
      theme.bold(key),
    );
    if (parameters) text += theme.fg("dim", ` ${parameters}`);
    if (this.expanded)
      return visibleWidth(text) <= width
        ? [text]
        : new Text(text, 0, 0)
            .render(width)
            .map((line) => truncateToWidth(line, width));
    const key = expansionKey();
    const hint = key
      ? theme.fg("muted", " (") +
        theme.fg("dim", key) +
        theme.fg("muted", " to expand)")
      : "";
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
  capability?: Capability,
): Component {
  const text = result.content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
  const metadata = result.details as
    | { capability?: unknown; result?: { capability?: unknown } }
    | undefined;
  const isSearch =
    (capability ?? metadata?.capability ?? metadata?.result?.capability) ===
    "search";
  const body = () =>
    isSearch
      ? renderSearchResult(result.details, text, theme)
      : new Markdown(text, 0, 0, getMarkdownTheme());
  const rows = statusRows(result.details);
  if (rows?.length) {
    const container = new Container();
    container.addChild({
      render: (width) =>
        width > 0
          ? rows.flatMap((row) => {
              const { glyph, color } = inputStates[row.state];
              const line =
                theme.fg(color, glyph) +
                " " +
                theme.fg("accent", displayInput(row.input));
              return options.expanded
                ? new Text(line, 0, 0)
                    .render(width)
                    .map((wrapped) => truncateToWidth(wrapped, width))
                : [truncateToWidth(line, width)];
            })
          : [],
      invalidate() {},
    });
    if (options.expanded && !options.isPartial) container.addChild(body());
    return container;
  }
  if (options.expanded) return body();
  const partialFailure =
    result.details &&
    typeof result.details === "object" &&
    "status" in result.details &&
    result.details.status === "partial";
  if (!options.isPartial && !isError && !partialFailure) return new Container();
  const summary = partialFailure
    ? "One or more inputs failed."
    : (stripVTControlCharacters(text)
        .split(/\r?\n/)
        .find((line) => line.trim()) ??
      (options.isPartial ? "Working…" : "Tool failed."));
  const safe = JSON.stringify(summary).slice(1, -1);
  const status = inputStates[isError || partialFailure ? "failed" : "running"];
  return {
    render: (width) =>
      width > 0
        ? [
            truncateToWidth(
              theme.fg(status.color, status.glyph) +
                " " +
                theme.fg(isError || partialFailure ? "error" : "muted", safe),
              width,
            ),
          ]
        : [],
    invalidate() {},
  };
}
