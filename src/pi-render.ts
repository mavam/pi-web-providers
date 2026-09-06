import { stripVTControlCharacters } from "node:util";
import { keyText, type Theme } from "@earendil-works/pi-coding-agent";
import {
  Text,
  truncateToWidth,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";
import type { Capability } from "./domain.js";

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
    if (inputs.length)
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
    if (this.expanded) return new Text(text, 0, 0).render(width);
    if (visibleWidth(text) <= width) return [text];
    const hint = theme.fg("dim", ` (${keyText("app.tools.expand")} to expand)`);
    if (width >= visibleWidth(title) + visibleWidth(hint) + 3)
      return [truncateToWidth(text, width - visibleWidth(hint)) + hint];
    return [truncateToWidth(text, width)];
  }

  // Rendering is stateless so width and theme changes never retain stale styling.
  invalidate(): void {}
}
