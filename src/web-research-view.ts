import type { Theme } from "@mariozechner/pi-coding-agent";
import {
  type Component,
  getKeybindings,
  Key,
  matchesKey,
  type TUI,
  truncateToWidth,
} from "@mariozechner/pi-tui";
import { formatErrorMessage } from "./execution-policy.js";
import { PROVIDERS_BY_ID } from "./providers/index.js";
import type { ActiveWebResearchTask } from "./web-research-lifecycle.js";
import {
  cancelWebResearchTask,
  getWebResearchTaskSnapshots,
  loadWebResearchHistory,
  loadWebResearchPreview,
  type WebResearchHistoryItem,
} from "./web-research-lifecycle.js";

export class WebResearchManagerView implements Component {
  private activeSection: "running" | "history" = "running";
  private selection = { running: 0, history: 0 };
  private history: WebResearchHistoryItem[] = [];
  private confirmCancelId: string | undefined;
  private preview: string | undefined;
  private previewError: string | undefined;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly done: (result: undefined) => void,
    private readonly cwd: string,
    private readonly tasks: Map<string, ActiveWebResearchTask>,
    private readonly onChange: () => void,
  ) {
    void this.reloadHistory();
  }

  render(width: number): string[] {
    if (this.preview !== undefined || this.previewError !== undefined) {
      const text = this.previewError ?? this.preview ?? "";
      return [
        this.theme.fg("accent", "Web research report preview"),
        "",
        ...text
          .split("\n")
          .slice(0, 200)
          .map((line) => truncateToWidth(line, width)),
        "",
        this.theme.fg("dim", "Esc back"),
      ];
    }

    this.clampSelections();
    const lines: string[] = [this.theme.fg("accent", "Web research jobs"), ""];
    lines.push(...this.renderRunning(width));
    lines.push("");
    lines.push(...this.renderHistory(width));
    lines.push("");
    lines.push(
      this.theme.fg(
        "dim",
        "↑↓ move · Tab switch section · Enter open/cancel · Esc close",
      ),
    );
    return lines;
  }

  invalidate(): void {}

  handleInput(data: string): void {
    const kb = getKeybindings();
    if (this.preview !== undefined || this.previewError !== undefined) {
      if (kb.matches(data, "tui.select.cancel")) {
        this.preview = undefined;
        this.previewError = undefined;
      }
      this.tui.requestRender();
      return;
    }
    if (kb.matches(data, "tui.select.up")) this.move(-1);
    else if (kb.matches(data, "tui.select.down")) this.move(1);
    else if (matchesKey(data, Key.tab) || matchesKey(data, Key.shift("tab")))
      this.switchSection();
    else if (kb.matches(data, "tui.select.confirm")) void this.activate();
    else if (kb.matches(data, "tui.select.cancel")) {
      if (this.confirmCancelId) this.confirmCancelId = undefined;
      else return this.done(undefined);
    }
    this.tui.requestRender();
  }

  refresh(): void {
    this.clampSelections();
    void this.reloadHistory();
    this.tui.requestRender();
  }

  private async reloadHistory(): Promise<void> {
    this.history = await loadWebResearchHistory(this.cwd);
    this.clampSelections();
    this.tui.requestRender();
  }

  private renderRunning(width: number): string[] {
    const snapshots = getWebResearchTaskSnapshots(this.tasks);
    const lines = [this.sectionTitle("Running", "running")];
    if (snapshots.length === 0)
      return [...lines, this.theme.fg("muted", "  No running jobs")];
    snapshots.forEach((snapshot, index) => {
      const selected =
        this.activeSection === "running" && this.selection.running === index
          ? "›"
          : " ";
      const request = snapshot.request;
      const provider =
        PROVIDERS_BY_ID[request.provider]?.label ?? request.provider;
      const elapsed = formatCompactElapsed(
        Date.now() - Date.parse(request.startedAt),
      );
      const progress = snapshot.cancelRequestedAt
        ? "cancelling"
        : (request.progress ?? "running");
      lines.push(
        truncateToWidth(
          `${selected} ${provider} ${elapsed} ${progress} — ${cleanSingleLine(request.input)}`,
          width,
        ),
      );
      if (this.confirmCancelId === request.id)
        lines.push(
          this.theme.fg(
            "warning",
            truncateToWidth(
              `  Press Enter again to cancel ${provider}: ${truncateInline(cleanSingleLine(request.input), 80)}`,
              width,
            ),
          ),
        );
    });
    return lines;
  }

  private renderHistory(width: number): string[] {
    const lines = [this.sectionTitle("History", "history")];
    if (this.history.length === 0)
      return [...lines, this.theme.fg("muted", "  No saved reports")];
    this.history.forEach((item, index) => {
      const selected =
        this.activeSection === "history" && this.selection.history === index
          ? "›"
          : " ";
      lines.push(
        truncateToWidth(
          `${selected} ${item.status} ${item.provider} ${item.completedAt} — ${cleanSingleLine(item.query)}`,
          width,
        ),
      );
    });
    return lines;
  }

  private sectionTitle(title: string, section: "running" | "history"): string {
    return this.activeSection === section
      ? this.theme.fg("accent", title)
      : title;
  }

  private move(delta: number): void {
    const count =
      this.activeSection === "running" ? this.tasks.size : this.history.length;
    if (count === 0) return;
    this.selection[this.activeSection] =
      (this.selection[this.activeSection] + delta + count) % count;
    this.confirmCancelId = undefined;
  }

  private switchSection(): void {
    this.activeSection =
      this.activeSection === "running" ? "history" : "running";
    this.confirmCancelId = undefined;
    this.clampSelections();
  }

  private async activate(): Promise<void> {
    if (this.activeSection === "running") {
      const snapshot = getWebResearchTaskSnapshots(this.tasks)[
        this.selection.running
      ];
      if (!snapshot) return;
      if (this.confirmCancelId !== snapshot.request.id) {
        this.confirmCancelId = snapshot.request.id;
        return;
      }
      cancelWebResearchTask(this.tasks, snapshot.request.id);
      this.confirmCancelId = undefined;
      this.onChange();
      return;
    }
    const item = this.history[this.selection.history];
    if (!item) return;
    try {
      this.preview = await loadWebResearchPreview(item.outputPath);
      this.previewError = undefined;
    } catch (error) {
      this.preview = undefined;
      this.previewError = `Failed to read ${item.outputPath}: ${formatErrorMessage(error)}`;
    }
    this.tui.requestRender();
  }

  private clampSelections(): void {
    this.selection.running = Math.min(
      Math.max(0, this.selection.running),
      Math.max(0, this.tasks.size - 1),
    );
    this.selection.history = Math.min(
      Math.max(0, this.selection.history),
      Math.max(0, this.history.length - 1),
    );
  }
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

function truncateInline(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}
