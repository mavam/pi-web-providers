import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { formatErrorMessage } from "./execution-policy.js";
import { cleanupContentStore } from "./prefetch-manager.js";
import {
  getEffectiveProviderConfig,
  resolveProviderForTool,
} from "./provider-resolution.js";
import type { ProviderExecution } from "./provider-runtime.js";
import { type PROVIDER_LIST, PROVIDERS_BY_ID } from "./providers/index.js";
import type {
  ProviderConfig,
  ProviderId,
  ToolDisplayDetails,
  ToolOutput,
  WebProviders,
  WebResearchRequest,
  WebResearchResult,
} from "./types.js";

export const RESEARCH_ARTIFACTS_DIR = join(".pi", "artifacts", "research");
export const MAX_RESEARCH_HISTORY_ITEMS = 20;
export const RESEARCH_PREVIEW_MAX_BYTES = 50000;
export const RESEARCH_REPORT_MAX_BYTES = 200000;

export interface ActiveWebResearchTask {
  request: WebResearchRequest;
  abortController: AbortController;
  cancelRequestedAt?: string;
}

export interface WebResearchTaskSnapshot {
  request: WebResearchRequest;
  cancelRequestedAt?: string;
}

export interface WebResearchHistoryItem {
  outputPath: string;
  fileName: string;
  query: string;
  title: string;
  provider: string;
  status: string;
  startedAt: string;
  completedAt: string;
  elapsedMs?: number;
  mtimeMs: number;
}

export type WebResearchResultMessage = {
  customType: string;
  content: string;
  display: true;
  details: WebResearchResult;
};

export type WebResearchExecutor = (args: {
  config: WebProviders;
  provider: (typeof PROVIDER_LIST)[number];
  providerConfig: ProviderConfig;
  ctx: { cwd: string };
  signal: AbortSignal;
  options: Record<string, unknown> | undefined;
  input: string;
  onProgress: (message: string) => void;
  executionOverride?: ProviderExecution<"research">;
}) => Promise<ToolOutput>;

export interface DispatchWebResearchArgs {
  activeWebResearchRequests: Map<string, ActiveWebResearchTask>;
  config: WebProviders;
  explicitProvider?: ProviderId;
  ctx: { cwd: string };
  options: Record<string, unknown> | undefined;
  input: string;
  executionOverride?: ProviderExecution<"research">;
  executeResearch: WebResearchExecutor;
  deliverResult: (message: WebResearchResultMessage) => void;
  onJobsChanged: () => void;
  resultMessageType: string;
}

const pendingResearchTasks = new Set<Promise<void>>();

export async function dispatchWebResearch({
  activeWebResearchRequests,
  config,
  explicitProvider,
  ctx,
  options,
  input,
  executionOverride,
  executeResearch,
  deliverResult,
  onJobsChanged,
  resultMessageType,
}: DispatchWebResearchArgs): Promise<{
  content: Array<{ type: "text"; text: string }>;
  details: WebResearchRequest;
  display: ToolDisplayDetails;
}> {
  await cleanupContentStore();

  const provider = resolveProviderForTool(
    config,
    ctx.cwd,
    "research",
    explicitProvider,
  );
  const request = createWebResearchRequest(ctx.cwd, provider.id, input);
  const abortController = new AbortController();
  const task: ActiveWebResearchTask = { request, abortController };
  const providerConfig = getEffectiveProviderConfig(config, provider.id);

  activeWebResearchRequests.set(request.id, task);
  onJobsChanged();

  trackPendingResearchTask(
    runDispatchedWebResearch({
      activeWebResearchRequests,
      task,
      config,
      provider,
      providerConfig,
      ctx,
      options,
      executionOverride,
      executeResearch,
      deliverResult,
      onJobsChanged,
      resultMessageType,
    }),
  );

  return {
    content: [
      {
        type: "text" as const,
        text: `Started web research via ${provider.label}.`,
      },
    ],
    details: request,
    display: {
      provider: { id: provider.id, label: provider.label },
      outcome: { success: "started" },
    },
  };
}

async function runDispatchedWebResearch({
  activeWebResearchRequests,
  task,
  config,
  provider,
  providerConfig,
  ctx,
  options,
  executionOverride,
  executeResearch,
  deliverResult,
  onJobsChanged,
  resultMessageType,
}: {
  activeWebResearchRequests: Map<string, ActiveWebResearchTask>;
  task: ActiveWebResearchTask;
  config: WebProviders;
  provider: (typeof PROVIDER_LIST)[number];
  providerConfig: ProviderConfig;
  ctx: { cwd: string };
  options: Record<string, unknown> | undefined;
  executionOverride?: ProviderExecution<"research">;
  executeResearch: WebResearchExecutor;
  deliverResult: (message: WebResearchResultMessage) => void;
  onJobsChanged: () => void;
  resultMessageType: string;
}): Promise<void> {
  const { request, abortController } = task;
  let result: WebResearchResult;
  let reportText = "";

  try {
    const response = await executeResearch({
      config,
      provider,
      providerConfig,
      ctx,
      signal: abortController.signal,
      options,
      input: request.input,
      onProgress: (message) => {
        request.progress = summarizeWebResearchProgress(
          message,
          provider.label,
        );
        onJobsChanged();
      },
      executionOverride,
    });
    result = buildWebResearchResult(request, abortController, task, response);
    if (result.status === "completed") {
      reportText = response.text;
    }
  } catch (error) {
    result = buildFailedWebResearchResult(
      request,
      abortController,
      task,
      error,
    );
  }

  try {
    await writeWebResearchArtifact(result, reportText);
    deliverResult({
      customType: resultMessageType,
      content: formatWebResearchResultMessage(result, reportText),
      display: true,
      details: result,
    });
  } finally {
    activeWebResearchRequests.delete(request.id);
    onJobsChanged();
  }
}

function buildWebResearchResult(
  request: WebResearchRequest,
  abortController: AbortController,
  task: ActiveWebResearchTask,
  response: ToolOutput,
): WebResearchResult {
  const completedAt = new Date().toISOString();
  if (abortController.signal.aborted && task.cancelRequestedAt !== undefined) {
    return {
      ...request,
      status: "cancelled",
      completedAt,
      elapsedMs: elapsedMs(request.startedAt, completedAt),
      error: "web research was cancelled by the user.",
    };
  }

  return {
    ...request,
    status: "completed",
    completedAt,
    elapsedMs: elapsedMs(request.startedAt, completedAt),
    itemCount: response.itemCount,
  };
}

function buildFailedWebResearchResult(
  request: WebResearchRequest,
  abortController: AbortController,
  task: ActiveWebResearchTask,
  error: unknown,
): WebResearchResult {
  const completedAt = new Date().toISOString();
  const cancelled =
    abortController.signal.aborted && task.cancelRequestedAt !== undefined;
  return {
    ...request,
    status: cancelled ? "cancelled" : "failed",
    completedAt,
    elapsedMs: elapsedMs(request.startedAt, completedAt),
    error: cancelled
      ? "web research was cancelled by the user."
      : formatErrorMessage(error),
  };
}

function elapsedMs(startedAt: string, completedAt: string): number {
  return Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));
}

export function getActiveWebResearchRequests(
  tasks: ReadonlyMap<string, ActiveWebResearchTask>,
): WebResearchRequest[] {
  return [...tasks.values()].map((task) => task.request);
}

export function getWebResearchTaskSnapshots(
  tasks: ReadonlyMap<string, ActiveWebResearchTask>,
): WebResearchTaskSnapshot[] {
  return [...tasks.values()].map((task) => ({
    request: task.request,
    cancelRequestedAt: task.cancelRequestedAt,
  }));
}

export function cancelWebResearchTask(
  tasks: Map<string, ActiveWebResearchTask>,
  id: string,
): boolean {
  const task = tasks.get(id);
  if (!task || task.abortController.signal.aborted) return false;
  task.cancelRequestedAt = new Date().toISOString();
  task.request.progress = "cancelling";
  task.abortController.abort(
    new Error("web research was cancelled by the user."),
  );
  return true;
}

function createWebResearchRequest(
  cwd: string,
  provider: ProviderId,
  input: string,
): WebResearchRequest {
  const startedAt = new Date().toISOString();

  return {
    tool: "web_research",
    id: randomUUID(),
    provider,
    input,
    outputPath: buildWebResearchArtifactPath(cwd, input, startedAt),
    startedAt,
  };
}

function buildWebResearchArtifactPath(
  cwd: string,
  input: string,
  startedAt: string,
): string {
  const timestamp = startedAt.replaceAll(":", "-").replace(".", "-");
  const slug = slugifyWebResearchInput(input);
  return join(cwd, RESEARCH_ARTIFACTS_DIR, `${timestamp}-${slug}.md`);
}

function slugifyWebResearchInput(input: string): string {
  const slug = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : "research";
}

/**
 * Progress icon for a running research request, shared by the editor widget
 * and the research table so both surfaces speak the same iconography.
 */
export function getWebResearchProgressIcon(
  request: Pick<WebResearchRequest, "progress">,
): string {
  if (request.progress === "poll retrying after transient errors") {
    return "⟳";
  }

  if (request.progress === "queued" || request.progress === "cancelling") {
    return "◌";
  }

  if (request.progress === "starting") {
    return "◔";
  }

  if (request.progress?.startsWith("started:")) {
    return "◑";
  }

  return "●";
}

export function summarizeWebResearchProgress(
  message: string,
  providerLabel: string,
): string {
  const startingMessage = `Starting research via ${providerLabel}`;
  if (message === startingMessage) {
    return "starting";
  }

  const startedPrefix = `${providerLabel} research started: `;
  if (message.startsWith(startedPrefix)) {
    return `started: ${message.slice(startedPrefix.length)}`;
  }

  const statusPrefix = `Research via ${providerLabel}: `;
  if (message.startsWith(statusPrefix)) {
    return message
      .slice(statusPrefix.length)
      .replace(/\s+\([^)]* elapsed\)$/u, "")
      .trim();
  }

  const retryPrefix = `${providerLabel} research poll is still retrying after transient errors`;
  if (message.startsWith(retryPrefix)) {
    return "poll retrying after transient errors";
  }

  return message.trim();
}

export function formatWebResearchResultMessage(
  result: WebResearchResult,
  reportText: string,
): string {
  const text = reportText.trim();
  if (text.length > 0) {
    return `${text}\n`;
  }

  if (result.error) {
    return `${result.error}\n`;
  }

  return "";
}

export async function writeWebResearchArtifact(
  result: WebResearchResult,
  reportText: string,
): Promise<void> {
  await mkdir(dirname(result.outputPath), { recursive: true });
  await writeFile(
    result.outputPath,
    formatWebResearchArtifact(result, reportText),
    "utf-8",
  );
}

export function formatWebResearchArtifact(
  result: WebResearchResult,
  reportText: string,
): string {
  const providerLabel =
    PROVIDERS_BY_ID[result.provider]?.label ?? result.provider;
  const metadata: Record<string, string | number | undefined> = {
    query: result.input,
    provider: providerLabel,
    providerId: result.provider,
    status: result.status,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    elapsedMs: result.elapsedMs,
    itemCount: result.itemCount,
    error: result.error,
  };
  const lines = [
    "---",
    ...Object.entries(metadata).flatMap(([key, value]) =>
      value === undefined ? [] : [`${key}: ${formatYamlScalar(value)}`],
    ),
    "---",
    "",
    "# Web research report",
  ];

  if (reportText) {
    lines.push("", reportText);
  }

  return `${lines.join("\n")}\n`;
}

function formatYamlScalar(value: string | number): string {
  if (typeof value === "number") {
    return String(value);
  }
  return JSON.stringify(value);
}

export async function loadWebResearchHistory(
  cwd: string,
  maxItems = MAX_RESEARCH_HISTORY_ITEMS,
): Promise<WebResearchHistoryItem[]> {
  const dir = join(cwd, RESEARCH_ARTIFACTS_DIR);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const markdown = entries.filter((name) => name.endsWith(".md"));
  const withStats = await Promise.all(
    markdown.map(async (fileName) => {
      const outputPath = join(dir, fileName);
      try {
        return { fileName, outputPath, stat: await stat(outputPath) };
      } catch {
        return undefined;
      }
    }),
  );

  const newest = withStats
    .filter((item): item is NonNullable<typeof item> => item !== undefined)
    .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs)
    .slice(0, maxItems);

  return Promise.all(
    newest.map(async ({ fileName, outputPath, stat }) => {
      let content = "";
      try {
        content = await readFile(outputPath, "utf-8");
      } catch {}
      const metadata = parseWebResearchArtifactMetadata(content);
      return {
        outputPath,
        fileName,
        query: metadata.query ?? "",
        title: deriveWebResearchTitle(content, metadata.query ?? ""),
        provider: metadata.provider ?? "",
        status: metadata.status ?? "unknown",
        startedAt: metadata.startedAt ?? "",
        completedAt: metadata.completedAt ?? "",
        elapsedMs: computeHistoryElapsedMs(metadata),
        mtimeMs: stat.mtimeMs,
      };
    }),
  );
}

export function parseWebResearchArtifactMetadata(
  content: string,
): Record<string, string> {
  return (
    parseWebResearchFrontmatter(content) ??
    parseLegacyWebResearchArtifactMetadata(content)
  );
}

function parseWebResearchFrontmatter(
  content: string,
): Record<string, string> | undefined {
  if (!content.startsWith("---\n")) {
    return undefined;
  }

  const end = content.indexOf("\n---", 4);
  if (end === -1) {
    return undefined;
  }

  const result: Record<string, string> = {};
  const frontmatter = content.slice(4, end);
  for (const line of frontmatter.split(/\r?\n/u)) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/u.exec(line);
    if (!match) {
      continue;
    }
    result[match[1] ?? ""] = parseYamlScalar(match[2] ?? "");
  }
  return result;
}

function parseYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed);
      return typeof parsed === "string" ? parsed : String(parsed);
    } catch {}
  }
  return trimmed;
}

function parseLegacyWebResearchArtifactMetadata(
  content: string,
): Record<string, string> {
  const result: Record<string, string> = {};
  const metadataHeadings = new Map([
    ["Query", "query"],
    ["Provider", "provider"],
    ["Status", "status"],
    ["Started", "startedAt"],
    ["Completed", "completedAt"],
  ]);
  const artifactBodyHeadings = new Set(["Elapsed", "Items", "Error", "Report"]);
  const lines = content.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index++) {
    const match = /^##\s+(.+)$/u.exec(lines[index] ?? "");
    if (!match) continue;
    const heading = match[1] ?? "";
    if (artifactBodyHeadings.has(heading)) break;
    const key = metadataHeadings.get(heading);
    if (key === undefined || result[key] !== undefined) continue;
    const values: string[] = [];
    for (let next = index + 1; next < lines.length; next++) {
      if (/^##\s+/u.test(lines[next] ?? "")) break;
      if ((lines[next] ?? "").trim() || values.length > 0)
        values.push(lines[next] ?? "");
    }
    result[key] = values.join("\n").trim();
  }
  return result;
}

const RESEARCH_TITLE_MAX_LENGTH = 80;

// Headings that never make a useful display title: the boilerplate heading
// written by formatWebResearchArtifact and the metadata/body headings of the
// legacy artifact format.
const NON_TITLE_HEADINGS = new Set([
  "Web research report",
  "Query",
  "Provider",
  "Status",
  "Started",
  "Completed",
  "Elapsed",
  "Items",
  "Error",
  "Report",
]);

export function deriveWebResearchTitle(content: string, query: string): string {
  const body = getWebResearchBody(content);
  for (const line of body.split(/\r?\n/u)) {
    const match = /^#{1,2}\s+(.+?)\s*$/u.exec(line);
    if (!match) continue;
    const heading = (match[1] ?? "").trim();
    if (heading.length > 0 && !NON_TITLE_HEADINGS.has(heading)) {
      return heading;
    }
  }

  const fallback = query.replace(/\s+/g, " ").trim();
  if (fallback.length <= RESEARCH_TITLE_MAX_LENGTH) {
    return fallback;
  }
  return `${fallback.slice(0, RESEARCH_TITLE_MAX_LENGTH - 1)}…`;
}

export function computeHistoryElapsedMs(
  metadata: Record<string, string>,
): number | undefined {
  if (metadata.elapsedMs !== undefined) {
    const parsed = Number(metadata.elapsedMs);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  const started = Date.parse(metadata.startedAt ?? "");
  const completed = Date.parse(metadata.completedAt ?? "");
  if (Number.isFinite(started) && Number.isFinite(completed)) {
    return Math.max(0, completed - started);
  }
  return undefined;
}

function getWebResearchBody(content: string): string {
  if (!content.startsWith("---\n")) {
    return content;
  }
  const end = content.indexOf("\n---", 4);
  if (end === -1) {
    return content;
  }
  const afterClose = content.indexOf("\n", end + 4);
  return afterClose === -1 ? "" : content.slice(afterClose + 1);
}

export interface WebResearchReport {
  body: string;
  metadata: Record<string, string>;
  truncated: boolean;
}

export async function loadWebResearchReport(
  outputPath: string,
): Promise<WebResearchReport> {
  const buffer = await readFile(outputPath);
  const truncated = buffer.byteLength > RESEARCH_REPORT_MAX_BYTES;
  const content = buffer
    .subarray(0, RESEARCH_REPORT_MAX_BYTES)
    .toString("utf-8");
  return {
    body: getWebResearchBody(content).trim(),
    metadata: parseWebResearchArtifactMetadata(content),
    truncated,
  };
}

export async function loadWebResearchPreview(
  outputPath: string,
): Promise<string> {
  const buffer = await readFile(outputPath);
  const truncated = buffer.byteLength > RESEARCH_PREVIEW_MAX_BYTES;
  const text = buffer.subarray(0, RESEARCH_PREVIEW_MAX_BYTES).toString("utf-8");
  return truncated
    ? `${text}\n\n---\nPreview truncated. Open the full report at \`${outputPath}\`.`
    : `${text}\n\n---\nFull report: \`${outputPath}\``;
}

function trackPendingResearchTask(task: Promise<void>): void {
  const tracked = task
    .catch(() => {})
    .finally(() => {
      pendingResearchTasks.delete(tracked);
    });
  pendingResearchTasks.add(tracked);
}

export async function waitForPendingResearchTasks(): Promise<void> {
  await Promise.all([...pendingResearchTasks]);
}
