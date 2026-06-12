import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  getKeybindings,
  Key,
  Markdown,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { formatErrorMessage } from "./execution-policy.js";
import { PROVIDERS_BY_ID } from "./providers/index.js";
import type {
  ActiveWebResearchTask,
  WebResearchTaskSnapshot,
} from "./web-research-lifecycle.js";
import {
  cancelWebResearchTask,
  getWebResearchTaskSnapshots,
  loadWebResearchHistory,
  loadWebResearchReport,
  type WebResearchHistoryItem,
} from "./web-research-lifecycle.js";

export interface WebResearchViewActions {
  copyToClipboard(text: string): Promise<void>;
  injectReport(report: {
    title: string;
    body: string;
    item: WebResearchHistoryItem;
  }): void;
  notify(message: string, type?: "info" | "warning" | "error"): void;
}

export interface WebResearchViewHost {
  requestRender(): void;
  terminal: { rows: number; columns: number };
}

export type ResearchRow =
  | { kind: "running"; snapshot: WebResearchTaskSnapshot }
  | { kind: "history"; item: WebResearchHistoryItem };

type OpenView =
  | {
      kind: "report";
      title: string;
      body: string;
      truncated: boolean;
      item: WebResearchHistoryItem;
      markdown: Markdown;
    }
  | { kind: "detail"; taskId: string };

const SPINNER_FRAMES = ["◐", "◓", "◑", "◒"];
const STATUS_MESSAGE_TTL_MS = 1500;
const PAGE_JUMP = 10;

export class WebResearchManagerView implements Component {
  private selectedIndex = 0;
  private history: WebResearchHistoryItem[] = [];
  private confirmCancelId: string | undefined;
  private open: OpenView | undefined;
  private scrollOffset = 0;
  private statusMessage: string | undefined;
  private statusMessageTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly tui: WebResearchViewHost,
    private readonly theme: Theme,
    private readonly done: (result: undefined) => void,
    private readonly cwd: string,
    private readonly tasks: Map<string, ActiveWebResearchTask>,
    private readonly onChange: () => void,
    private readonly actions: WebResearchViewActions,
    private readonly loadHistory: (
      cwd: string,
    ) => Promise<WebResearchHistoryItem[]> = loadWebResearchHistory,
  ) {
    void this.reloadHistory();
  }

  isReportOpen(): boolean {
    return this.open !== undefined;
  }

  render(width: number): string[] {
    if (this.open?.kind === "report") {
      return this.renderReport(this.open, width);
    }
    if (this.open?.kind === "detail") {
      const snapshot = this.findSnapshot(this.open.taskId);
      if (snapshot) return this.renderDetail(snapshot, width);
      this.open = undefined;
    }
    return this.renderTable(width);
  }

  invalidate(): void {}

  dispose(): void {
    if (this.statusMessageTimer) clearTimeout(this.statusMessageTimer);
  }

  handleInput(data: string): void {
    if (this.open) {
      this.handleOpenInput(data);
    } else {
      this.handleTableInput(data);
    }
    this.tui.requestRender();
  }

  refresh(): void {
    if (this.open?.kind === "detail" && !this.findSnapshot(this.open.taskId)) {
      this.open = undefined;
      this.confirmCancelId = undefined;
    }
    void this.reloadHistory();
    this.tui.requestRender();
  }

  // --- table mode ---

  getRows(): ResearchRow[] {
    const snapshots = getWebResearchTaskSnapshots(this.tasks).sort((a, b) =>
      a.request.startedAt.localeCompare(b.request.startedAt),
    );
    const runningPaths = new Set(
      snapshots.map((snapshot) => snapshot.request.outputPath),
    );
    const rows: ResearchRow[] = snapshots.map((snapshot) => ({
      kind: "running",
      snapshot,
    }));
    for (const item of this.history) {
      if (runningPaths.has(item.outputPath)) continue;
      rows.push({ kind: "history", item });
    }
    return rows;
  }

  private border(width: number): string {
    return this.theme.fg("border", "─".repeat(Math.max(1, width)));
  }

  private renderTable(width: number): string[] {
    const rows = this.getRows();
    this.selectedIndex = clamp(this.selectedIndex, 0, rows.length - 1);

    const lines: string[] = [
      this.border(width),
      this.theme.fg("accent", " Web research"),
      "",
    ];
    if (rows.length === 0) {
      lines.push(this.theme.fg("muted", "  No research jobs or reports"));
    } else {
      const layout = computeTableLayout(rows, width);
      const now = Date.now();
      rows.forEach((row, index) => {
        lines.push(
          formatResearchTableRow(
            row,
            layout,
            this.theme,
            index === this.selectedIndex,
            now,
          ),
        );
        if (
          row.kind === "running" &&
          this.confirmCancelId === row.snapshot.request.id
        ) {
          lines.push(
            this.theme.fg(
              "warning",
              truncateToWidth(
                `     Press c again to cancel this ${providerLabel(row.snapshot.request.provider)} research`,
                width,
              ),
            ),
          );
        }
      });
    }
    lines.push("");
    if (this.statusMessage) {
      lines.push(this.theme.fg("accent", ` ${this.statusMessage}`));
    }
    lines.push(
      this.theme.fg(
        "dim",
        " ↑↓ move · Enter open · c cancel running · Esc close",
      ),
      this.border(width),
    );
    return lines;
  }

  private handleTableInput(data: string): void {
    const kb = getKeybindings();
    const rows = this.getRows();
    if (kb.matches(data, "tui.select.up")) this.move(rows.length, -1);
    else if (kb.matches(data, "tui.select.down")) this.move(rows.length, 1);
    else if (kb.matches(data, "tui.select.pageUp"))
      this.move(rows.length, -PAGE_JUMP, false);
    else if (kb.matches(data, "tui.select.pageDown"))
      this.move(rows.length, PAGE_JUMP, false);
    else if (kb.matches(data, "tui.select.confirm"))
      void this.openRow(rows[this.selectedIndex]);
    else if (data === "c") this.cancelRow(rows[this.selectedIndex]);
    else if (kb.matches(data, "tui.select.cancel")) {
      if (this.confirmCancelId) this.confirmCancelId = undefined;
      else this.done(undefined);
    }
  }

  private move(count: number, delta: number, wrap = true): void {
    this.confirmCancelId = undefined;
    if (count === 0) return;
    const next = this.selectedIndex + delta;
    this.selectedIndex = wrap
      ? (next + count) % count
      : clamp(next, 0, count - 1);
  }

  private async openRow(row: ResearchRow | undefined): Promise<void> {
    if (!row) return;
    this.confirmCancelId = undefined;
    if (row.kind === "running") {
      this.open = { kind: "detail", taskId: row.snapshot.request.id };
      this.scrollOffset = 0;
      return;
    }
    try {
      const report = await loadWebResearchReport(row.item.outputPath);
      this.open = {
        kind: "report",
        title: row.item.title || row.item.query,
        body: report.body,
        truncated: report.truncated,
        item: row.item,
        markdown: new Markdown(report.body, 1, 0, getMarkdownTheme()),
      };
      this.scrollOffset = 0;
    } catch (error) {
      this.showStatusMessage(
        `Failed to read ${row.item.outputPath}: ${formatErrorMessage(error)}`,
      );
    }
    this.tui.requestRender();
  }

  private cancelRow(row: ResearchRow | undefined): void {
    if (!row || row.kind !== "running") return;
    const id = row.snapshot.request.id;
    if (this.confirmCancelId !== id) {
      this.confirmCancelId = id;
      return;
    }
    cancelWebResearchTask(this.tasks, id);
    this.confirmCancelId = undefined;
    this.onChange();
  }

  // --- report / detail mode ---

  private renderReport(
    open: Extract<OpenView, { kind: "report" }>,
    width: number,
  ): string[] {
    const lines: string[] = [
      this.border(width),
      this.theme.fg("accent", truncateToWidth(` ${open.title}`, width)),
      this.theme.fg(
        "dim",
        " c copy markdown · i inject into context · ↑↓/PgUp/PgDn scroll · Esc back",
      ),
      this.border(width),
      "",
    ];

    let body: string[];
    try {
      body = open.markdown.render(Math.max(20, width - 2));
    } catch {
      body = open.body.split("\n").map((line) => truncateToWidth(line, width));
    }

    const viewport = this.viewportHeight();
    const maxOffset = Math.max(0, body.length - viewport);
    this.scrollOffset = clamp(this.scrollOffset, 0, maxOffset);
    lines.push(...body.slice(this.scrollOffset, this.scrollOffset + viewport));

    lines.push("");
    const footer: string[] = [];
    if (body.length > viewport) {
      const end = Math.min(body.length, this.scrollOffset + viewport);
      footer.push(`lines ${this.scrollOffset + 1}–${end} of ${body.length}`);
    }
    if (open.truncated) {
      footer.push(`report truncated · full text: ${open.item.outputPath}`);
    }
    if (this.statusMessage) {
      lines.push(this.theme.fg("accent", ` ${this.statusMessage}`));
    }
    if (footer.length > 0) {
      lines.push(
        this.theme.fg("dim", truncateToWidth(` ${footer.join(" · ")}`, width)),
      );
    }
    lines.push(this.border(width));
    return lines;
  }

  private renderDetail(
    snapshot: WebResearchTaskSnapshot,
    width: number,
  ): string[] {
    const request = snapshot.request;
    const elapsed = formatCompactElapsed(
      Date.now() - Date.parse(request.startedAt),
    );
    const progress = snapshot.cancelRequestedAt
      ? "cancelling"
      : (request.progress ?? "running");
    const lines: string[] = [
      this.border(width),
      this.theme.fg(
        "accent",
        truncateToWidth(
          ` Running research via ${providerLabel(request.provider)}`,
          width,
        ),
      ),
      this.theme.fg("dim", " c cancel · Esc back"),
      this.border(width),
      "",
      truncateToWidth(` Status: ${progress} (${elapsed} elapsed)`, width),
      truncateToWidth(` Report path: ${request.outputPath}`, width),
      "",
      this.theme.fg("accent", " Research brief"),
      "",
    ];
    for (const line of request.input.split("\n").slice(0, 100)) {
      lines.push(truncateToWidth(` ${line}`, width));
    }
    if (this.confirmCancelId === request.id) {
      lines.push(
        "",
        this.theme.fg("warning", " Press c again to cancel this research"),
      );
    }
    if (this.statusMessage) {
      lines.push("", this.theme.fg("accent", ` ${this.statusMessage}`));
    }
    lines.push(this.border(width));
    return lines;
  }

  private handleOpenInput(data: string): void {
    const kb = getKeybindings();
    const open = this.open;
    if (!open) return;

    if (kb.matches(data, "tui.select.cancel")) {
      if (this.confirmCancelId) {
        this.confirmCancelId = undefined;
        return;
      }
      this.open = undefined;
      this.scrollOffset = 0;
      return;
    }

    if (open.kind === "detail") {
      if (data === "c") {
        const snapshot = this.findSnapshot(open.taskId);
        if (!snapshot) return;
        if (this.confirmCancelId !== open.taskId) {
          this.confirmCancelId = open.taskId;
          return;
        }
        cancelWebResearchTask(this.tasks, open.taskId);
        this.confirmCancelId = undefined;
        this.onChange();
        this.showStatusMessage("Cancellation requested");
      }
      return;
    }

    if (kb.matches(data, "tui.select.up")) this.scrollOffset -= 1;
    else if (kb.matches(data, "tui.select.down")) this.scrollOffset += 1;
    else if (kb.matches(data, "tui.select.pageUp"))
      this.scrollOffset -= this.viewportHeight();
    else if (kb.matches(data, "tui.select.pageDown"))
      this.scrollOffset += this.viewportHeight();
    else if (matchesKey(data, Key.home)) this.scrollOffset = 0;
    else if (matchesKey(data, Key.end))
      this.scrollOffset = Number.MAX_SAFE_INTEGER;
    else if (data === "c") {
      void this.actions
        .copyToClipboard(open.body)
        .then(() => this.showStatusMessage("Copied report to clipboard"))
        .catch((error: unknown) => {
          const message = `Copy failed: ${formatErrorMessage(error)}`;
          this.showStatusMessage(message);
          this.actions.notify(message, "error");
        });
    } else if (data === "i") {
      this.actions.injectReport({
        title: open.title,
        body: open.body,
        item: open.item,
      });
      this.showStatusMessage("Report added to conversation context");
    }
    // scrollOffset is clamped in renderReport
  }

  private viewportHeight(): number {
    return Math.max(5, Math.floor(this.tui.terminal.rows * 0.85) - 6);
  }

  private showStatusMessage(message: string): void {
    this.statusMessage = message;
    if (this.statusMessageTimer) clearTimeout(this.statusMessageTimer);
    this.statusMessageTimer = setTimeout(() => {
      this.statusMessage = undefined;
      this.statusMessageTimer = undefined;
      this.tui.requestRender();
    }, STATUS_MESSAGE_TTL_MS);
  }

  private findSnapshot(taskId: string): WebResearchTaskSnapshot | undefined {
    return getWebResearchTaskSnapshots(this.tasks).find(
      (snapshot) => snapshot.request.id === taskId,
    );
  }

  private async reloadHistory(): Promise<void> {
    this.history = await this.loadHistory(this.cwd);
    this.tui.requestRender();
  }
}

export interface ResearchTableLayout {
  date: number;
  provider: number;
  duration: number;
  title: number;
  total: number;
}

export function computeTableLayout(
  rows: ResearchRow[],
  width: number,
): ResearchTableLayout {
  const providerWidth = clamp(
    Math.max(0, ...rows.map((row) => visibleWidth(rowProvider(row)))),
    4,
    12,
  );
  const date = 10;
  const duration = 7;
  // cursor(2) + glyph(2) + gaps between the remaining columns
  const fixed = 2 + 2 + date + 1 + providerWidth + 1 + duration + 1;
  return {
    date,
    provider: providerWidth,
    duration,
    title: Math.max(10, width - fixed),
    total: width,
  };
}

export function formatResearchTableRow(
  row: ResearchRow,
  layout: ResearchTableLayout,
  theme: Pick<Theme, "fg" | "bg">,
  selected: boolean,
  now = Date.now(),
): string {
  const cursor = selected ? "› " : "  ";
  const glyph = statusGlyph(row, theme, now);
  const date = padCell(
    formatRelativeDate(rowTimestampMs(row), now),
    layout.date,
  );
  const provider = padCell(
    truncateToWidth(rowProvider(row), layout.provider),
    layout.provider,
  );
  const duration = padCell(rowDuration(row, now), layout.duration, "right");
  const title = truncateToWidth(rowTitle(row), layout.title);
  const dim = (text: string) =>
    row.kind === "history" ? text : theme.fg("dim", text);
  const line = `${cursor}${glyph} ${dim(date)} ${provider} ${theme.fg("muted", duration)} ${title}`;
  if (!selected) {
    return line;
  }
  // Highlight the whole row; theme.fg resets only the foreground, so nested
  // cell colors keep the background intact.
  return theme.bg("selectedBg", padCell(line, layout.total));
}

function statusGlyph(
  row: ResearchRow,
  theme: Pick<Theme, "fg">,
  now: number,
): string {
  if (row.kind === "running") {
    const frame =
      SPINNER_FRAMES[Math.floor(now / 1000) % SPINNER_FRAMES.length] ?? "◐";
    return theme.fg("accent", row.snapshot.cancelRequestedAt ? "◌" : frame);
  }
  switch (row.item.status) {
    case "completed":
      return theme.fg("success", "✓");
    case "failed":
      return theme.fg("error", "✗");
    case "cancelled":
      return theme.fg("warning", "⊘");
    default:
      return theme.fg("dim", "?");
  }
}

function rowProvider(row: ResearchRow): string {
  return row.kind === "running"
    ? providerLabel(row.snapshot.request.provider)
    : row.item.provider || "?";
}

function rowTimestampMs(row: ResearchRow): number {
  if (row.kind === "running") {
    return Date.parse(row.snapshot.request.startedAt);
  }
  const completed = Date.parse(row.item.completedAt);
  if (Number.isFinite(completed)) return completed;
  const started = Date.parse(row.item.startedAt);
  if (Number.isFinite(started)) return started;
  return row.item.mtimeMs;
}

function rowDuration(row: ResearchRow, now: number): string {
  if (row.kind === "running") {
    return formatCompactElapsed(
      now - Date.parse(row.snapshot.request.startedAt),
    );
  }
  return row.item.elapsedMs === undefined
    ? "—"
    : formatCompactElapsed(row.item.elapsedMs);
}

// Bare status words restate what the status glyph already shows; only
// informative progress (e.g. "started: analyzing sources") earns a prefix.
const REDUNDANT_PROGRESS = new Set([
  "in_progress",
  "running",
  "starting",
  "queued",
  "cancelling",
]);

function rowTitle(row: ResearchRow): string {
  if (row.kind === "running") {
    const request = row.snapshot.request;
    const progress = row.snapshot.cancelRequestedAt
      ? undefined
      : request.progress;
    const prefix =
      progress && !REDUNDANT_PROGRESS.has(progress) ? `${progress} — ` : "";
    return `${prefix}${cleanSingleLine(request.input)}`;
  }
  return row.item.title || cleanSingleLine(row.item.query);
}

export function formatRelativeDate(timestampMs: number, now: number): string {
  if (!Number.isFinite(timestampMs)) return "?";
  const diff = Math.max(0, now - timestampMs);
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  const date = new Date(timestampMs);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  if (date.getFullYear() === new Date(now).getFullYear()) {
    return `${month}-${day}`;
  }
  return `${date.getFullYear()}-${month}-${day}`;
}

function providerLabel(providerId: string): string {
  return (
    PROVIDERS_BY_ID[providerId as keyof typeof PROVIDERS_BY_ID]?.label ??
    providerId
  );
}

function padCell(
  text: string,
  width: number,
  align: "left" | "right" = "left",
): string {
  const pad = " ".repeat(Math.max(0, width - visibleWidth(text)));
  return align === "left" ? `${text}${pad}` : `${pad}${text}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function formatCompactElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return `${minutes}m${seconds}s`;
  }

  return `${totalSeconds}s`;
}

function cleanSingleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
