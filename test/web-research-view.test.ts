import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  initTheme,
  stopThemeWatcher,
} from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import type {
  ActiveWebResearchTask,
  WebResearchHistoryItem,
} from "../src/web-research-lifecycle.js";
import {
  computeTableLayout,
  formatRelativeDate,
  formatResearchTableRow,
  type ResearchRow,
  WebResearchManagerView,
  type WebResearchViewActions,
} from "../src/web-research-view.js";

const KEY_UP = "\u001b[A";
const KEY_DOWN = "\u001b[B";
const KEY_ENTER = "\r";
const KEY_ESC = "\u001b";
const KEY_PAGE_UP = "\u001b[5~";

const cleanupDirs: string[] = [];

beforeAll(() => {
  initTheme("dark", false);
});

afterAll(async () => {
  stopThemeWatcher();
  await Promise.all(
    cleanupDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function createTheme(): Theme {
  return {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as unknown as Theme;
}

function createHistoryItem(
  overrides: Partial<WebResearchHistoryItem> = {},
): WebResearchHistoryItem {
  return {
    outputPath: "/tmp/research/report.md",
    fileName: "report.md",
    query: "What is pi?",
    title: "Pi coding agent overview",
    provider: "Gemini",
    status: "completed",
    startedAt: "2026-06-01T00:00:00.000Z",
    completedAt: "2026-06-01T00:05:00.000Z",
    elapsedMs: 300_000,
    mtimeMs: Date.parse("2026-06-01T00:05:00.000Z"),
    ...overrides,
  };
}

function createTask(id: string, startedAt: string): ActiveWebResearchTask {
  return {
    request: {
      tool: "web_research",
      id,
      provider: "gemini",
      input: "Compare SIEM platforms in 2026",
      outputPath: `/tmp/research/${id}.md`,
      startedAt,
      progress: "starting",
    },
    abortController: new AbortController(),
  };
}

function createActions(): WebResearchViewActions & {
  copied: string[];
  injected: Array<{ title: string; body: string }>;
} {
  const copied: string[] = [];
  const injected: Array<{ title: string; body: string }> = [];
  return {
    copied,
    injected,
    copyToClipboard: async (text: string) => {
      copied.push(text);
    },
    injectReport: ({ title, body }) => {
      injected.push({ title, body });
    },
    notify: () => {},
  };
}

function createView(options: {
  tasks?: Map<string, ActiveWebResearchTask>;
  history?: WebResearchHistoryItem[];
  cwd?: string;
  done?: (result: undefined) => void;
  onChange?: () => void;
  actions?: WebResearchViewActions;
}) {
  const view = new WebResearchManagerView(
    { requestRender() {}, terminal: { rows: 40, columns: 100 } },
    createTheme(),
    options.done ?? (() => {}),
    options.cwd ?? "/nonexistent",
    options.tasks ?? new Map(),
    options.onChange ?? (() => {}),
    options.actions ?? createActions(),
    async () => options.history ?? [],
  );
  return view;
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("research table formatting", () => {
  it("aligns title columns across rows with differing cell widths", () => {
    const now = Date.parse("2026-06-12T12:00:00.000Z");
    const rows: ResearchRow[] = [
      {
        kind: "history",
        item: createHistoryItem({
          title: "AAA",
          provider: "Gemini",
          elapsedMs: 1000,
          completedAt: "2026-06-12T11:59:30.000Z",
        }),
      },
      {
        kind: "history",
        item: createHistoryItem({
          title: "BBB",
          provider: "Perplexity",
          elapsedMs: 754_000,
          completedAt: "2026-01-02T00:00:00.000Z",
        }),
      },
    ];
    const layout = computeTableLayout(rows, 100);
    const [firstRow, secondRow] = rows;
    if (!firstRow || !secondRow) throw new Error("expected two rows");
    const first = formatResearchTableRow(
      firstRow,
      layout,
      createTheme(),
      true,
      now,
    );
    const second = formatResearchTableRow(
      secondRow,
      layout,
      createTheme(),
      false,
      now,
    );
    expect(first.indexOf("AAA")).toBeGreaterThan(0);
    expect(first.indexOf("AAA")).toBe(second.indexOf("BBB"));
    expect(visibleWidth(first)).toBeLessThanOrEqual(100);
  });

  it("shows status glyphs and durations per row state", () => {
    const now = Date.parse("2026-06-12T12:00:00.000Z");
    const layout = computeTableLayout([], 100);
    const running = formatResearchTableRow(
      {
        kind: "running",
        snapshot: {
          request: createTask("a", "2026-06-12T11:58:00.000Z").request,
        },
      },
      layout,
      createTheme(),
      false,
      now,
    );
    expect(running).toContain("2m0s");
    expect(running).toContain("Compare SIEM platforms in 2026");
    // The spinner glyph already conveys the running state; bare status words
    // like "starting" must not prefix the title.
    expect(running).not.toContain("starting");

    const informative = formatResearchTableRow(
      {
        kind: "running",
        snapshot: {
          request: {
            ...createTask("b", "2026-06-12T11:58:00.000Z").request,
            progress: "started: analyzing sources",
          },
        },
      },
      layout,
      createTheme(),
      false,
      now,
    );
    expect(informative).toContain("started: analyzing sources — Compare");

    const failed = formatResearchTableRow(
      { kind: "history", item: createHistoryItem({ status: "failed" }) },
      layout,
      createTheme(),
      false,
      now,
    );
    expect(failed).toContain("✗");

    const cancelled = formatResearchTableRow(
      { kind: "history", item: createHistoryItem({ status: "cancelled" }) },
      layout,
      createTheme(),
      false,
      now,
    );
    expect(cancelled).toContain("⊘");

    const noDuration = formatResearchTableRow(
      { kind: "history", item: createHistoryItem({ elapsedMs: undefined }) },
      layout,
      createTheme(),
      false,
      now,
    );
    expect(noDuration).toContain("—");
  });

  it("formats relative dates", () => {
    const now = Date.parse("2026-06-12T12:00:00.000Z");
    expect(formatRelativeDate(now - 5_000, now)).toBe("now");
    expect(formatRelativeDate(now - 5 * 60_000, now)).toBe("5m ago");
    expect(formatRelativeDate(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(formatRelativeDate(now - 2 * 86_400_000, now)).toBe("2d ago");
    expect(
      formatRelativeDate(Date.parse("2026-01-05T00:00:00.000Z"), now),
    ).toBe("01-05");
    expect(
      formatRelativeDate(Date.parse("2025-12-31T00:00:00.000Z"), now),
    ).toBe("2025-12-31");
    expect(formatRelativeDate(Number.NaN, now)).toBe("?");
  });
});

describe("WebResearchManagerView", () => {
  it("lists running jobs before history and renders an aligned table", async () => {
    const tasks = new Map<string, ActiveWebResearchTask>([
      ["b", createTask("b", "2026-06-12T11:00:00.000Z")],
      ["a", createTask("a", "2026-06-12T10:00:00.000Z")],
    ]);
    const view = createView({
      tasks,
      history: [createHistoryItem()],
    });
    await settle();

    const rows = view.getRows();
    expect(rows.map((row) => row.kind)).toEqual([
      "running",
      "running",
      "history",
    ]);
    expect(rows[0]?.kind === "running" && rows[0].snapshot.request.id).toBe(
      "a",
    );

    const rendered = view.render(100).join("\n");
    expect(rendered).toContain("Web research");
    expect(rendered).toContain("Pi coding agent overview");
    expect(rendered).toContain("c cancel running");
  });

  it("cancels a running job only after confirming with a second c", async () => {
    const tasks = new Map<string, ActiveWebResearchTask>([
      ["a", createTask("a", "2026-06-12T10:00:00.000Z")],
    ]);
    const onChange = vi.fn();
    const view = createView({ tasks, history: [], onChange });
    await settle();

    view.handleInput("c");
    expect(tasks.get("a")?.abortController.signal.aborted).toBe(false);
    expect(view.render(100).join("\n")).toContain("Press c again to cancel");

    view.handleInput("c");
    expect(tasks.get("a")?.abortController.signal.aborted).toBe(true);
    expect(tasks.get("a")?.cancelRequestedAt).toBeDefined();
    expect(onChange).toHaveBeenCalled();
  });

  it("ignores c on finished rows and clears pending confirmation on move", async () => {
    const tasks = new Map<string, ActiveWebResearchTask>([
      ["a", createTask("a", "2026-06-12T10:00:00.000Z")],
    ]);
    const view = createView({ tasks, history: [createHistoryItem()] });
    await settle();

    view.handleInput("c");
    view.handleInput(KEY_DOWN);
    expect(view.render(100).join("\n")).not.toContain("Press c again");

    view.handleInput("c");
    expect(tasks.get("a")?.abortController.signal.aborted).toBe(false);

    view.handleInput(KEY_UP);
    view.handleInput("c");
    view.handleInput("c");
    expect(tasks.get("a")?.abortController.signal.aborted).toBe(true);
  });

  it("opens a running job detail view on Enter", async () => {
    const tasks = new Map<string, ActiveWebResearchTask>([
      ["a", createTask("a", "2026-06-12T10:00:00.000Z")],
    ]);
    const view = createView({ tasks, history: [] });
    await settle();

    view.handleInput(KEY_ENTER);
    await settle();
    expect(view.isReportOpen()).toBe(true);
    const rendered = view.render(100).join("\n");
    expect(rendered).toContain("Running research via Gemini");
    expect(rendered).toContain("Compare SIEM platforms in 2026");

    view.handleInput(KEY_ESC);
    expect(view.isReportOpen()).toBe(false);
  });

  it("opens a report, copies frontmatter-free markdown, and injects it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-web-research-view-"));
    cleanupDirs.push(dir);
    const outputPath = join(dir, "report.md");
    await mkdir(dir, { recursive: true });
    await writeFile(
      outputPath,
      [
        "---",
        'query: "What is pi?"',
        'provider: "Gemini"',
        'status: "completed"',
        "---",
        "",
        "# Web research report",
        "",
        "# Pi coding agent overview",
        "",
        "Pi is a coding agent.",
      ].join("\n"),
      "utf-8",
    );

    const actions = createActions();
    const done = vi.fn();
    const view = createView({
      history: [createHistoryItem({ outputPath })],
      actions,
      done,
    });
    await settle();

    view.handleInput(KEY_ENTER);
    await settle();
    expect(view.isReportOpen()).toBe(true);

    const rendered = view.render(100).join("\n");
    expect(rendered).toContain("Pi coding agent overview");
    expect(rendered).toContain("c copy markdown");
    expect(rendered).toContain("i inject into context");

    view.handleInput("c");
    await settle();
    expect(actions.copied).toHaveLength(1);
    expect(actions.copied[0]).toContain("Pi is a coding agent.");
    expect(actions.copied[0]).not.toContain('query: "What is pi?"');

    view.handleInput("i");
    expect(actions.injected).toHaveLength(1);
    expect(actions.injected[0]?.title).toBe("Pi coding agent overview");
    expect(actions.injected[0]?.body).toContain("Pi is a coding agent.");

    // Scroll clamping: paging up beyond the top stays at the top.
    view.handleInput(KEY_PAGE_UP);
    expect(view.render(100).join("\n")).toContain("Pi coding agent overview");

    view.handleInput(KEY_ESC);
    expect(view.isReportOpen()).toBe(false);
    expect(done).not.toHaveBeenCalled();

    view.handleInput(KEY_ESC);
    expect(done).toHaveBeenCalledWith(undefined);
  });
});
