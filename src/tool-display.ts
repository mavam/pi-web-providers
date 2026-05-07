import { formatSize } from "@mariozechner/pi-coding-agent";
import { PROVIDERS_BY_ID } from "./providers/index.js";
import type {
  ContentsDetails,
  ProviderId,
  SearchDetails,
  Tool,
  ToolDetails,
  ToolDisplayDetails,
} from "./types.js";

const ANSWER_EXCERPT_MAX_LENGTH = 100;

export interface SummaryParts {
  success: string;
  failure?: string;
}

export function buildSearchToolDisplay(
  details: SearchDetails,
): ToolDisplayDetails {
  return buildToolDisplay(details.provider, buildSearchSummaryParts(details));
}

export function buildProgressDisplay(
  providerId: ProviderId,
  action: string,
): ToolDisplayDetails {
  return {
    provider: getProviderDisplay(providerId),
    progress: { action },
  };
}

export function buildProviderToolDisplay({
  capability,
  providerId,
  details,
  text,
  outputBytes,
  outputTruncated,
  failedItemCount,
}: {
  capability: Exclude<Tool, "search">;
  providerId: ProviderId;
  details: ToolDetails;
  text: string | undefined;
  outputBytes?: number;
  outputTruncated?: boolean;
  failedItemCount?: number;
}): ToolDisplayDetails {
  const summary =
    capability === "contents" && details.tool === "web_contents"
      ? buildContentsDisplaySummary(details, text, {
          outputBytes,
          outputTruncated,
          failedItemCount,
        })
      : capability === "research" && text
        ? { success: text }
        : buildCollapsedProviderToolSummaryParts(details, text);
  return buildToolDisplay(providerId, summary);
}

export function buildCollapsedProviderToolSummary(
  details: ToolDetails | undefined,
  text: string | undefined,
): string {
  const summary = buildCollapsedProviderToolSummaryParts(details, text);
  return summary.failure
    ? `${summary.success}, ${summary.failure}`
    : summary.success;
}

export function buildCollapsedProviderToolSummaryParts(
  details: ToolDetails | undefined,
  text: string | undefined,
): SummaryParts {
  if (details?.tool === "web_answer") {
    return buildAnswerCollapsedSummary(details, text);
  }

  if (details?.tool === "web_contents") {
    return buildContentsSummary(details, text);
  }

  const baseSummary =
    getCompactProviderToolSummary(details) ??
    getFirstLine(text) ??
    `${details?.tool ?? "tool"} output available`;

  return { success: baseSummary };
}

export function buildSearchSummaryParts({
  queryCount,
  resultCount,
  failedQueryCount,
}: {
  queryCount?: number;
  resultCount?: number;
  failedQueryCount?: number;
}): SummaryParts {
  const success =
    typeof resultCount === "number"
      ? `${resultCount} result${resultCount === 1 ? "" : "s"}`
      : "Search output available";

  if (failedQueryCount && failedQueryCount > 0 && queryCount) {
    return {
      success,
      failure: `${failedQueryCount} of ${queryCount} ${queryCount === 1 ? "query" : "queries"} failed`,
    };
  }

  return { success };
}

function buildToolDisplay(
  providerId: ProviderId,
  outcome: SummaryParts,
): ToolDisplayDetails {
  return {
    provider: getProviderDisplay(providerId),
    outcome,
  };
}

function getProviderDisplay(providerId: ProviderId): {
  id: ProviderId;
  label: string;
} {
  const provider = PROVIDERS_BY_ID[providerId];
  return { id: providerId, label: provider?.label ?? providerId };
}

function buildContentsDisplaySummary(
  details: ContentsDetails,
  text: string | undefined,
  metadata: {
    outputBytes?: number;
    outputTruncated?: boolean;
    failedItemCount?: number;
  },
): SummaryParts {
  const totalCount = details.itemCount ?? inferContentsPageCount(text);
  const failedCount =
    metadata.failedItemCount ?? inferContentsFailureCount(text);
  const successCount =
    totalCount === undefined
      ? undefined
      : Math.max(0, totalCount - (failedCount ?? 0));
  const sizeSummary =
    typeof metadata.outputBytes === "number"
      ? `${formatSize(metadata.outputBytes)}${metadata.outputTruncated ? " (truncated)" : ""}`
      : undefined;
  const success =
    successCount === undefined
      ? (sizeSummary ?? "Contents output available")
      : successCount === 1 && sizeSummary
        ? sizeSummary
        : `${successCount} page${successCount === 1 ? "" : "s"}${sizeSummary ? `, ${sizeSummary}` : ""}`;

  if (failedCount && failedCount > 0 && totalCount) {
    return {
      success,
      failure: `${failedCount} of ${totalCount} ${totalCount === 1 ? "page" : "pages"} failed`,
    };
  }

  return { success };
}

function buildAnswerCollapsedSummary(
  details: Extract<ToolDetails, { tool: "web_answer" }>,
  text: string | undefined,
): SummaryParts {
  if (
    typeof details.queryCount === "number" &&
    (details.queryCount > 1 || (details.failedQueryCount ?? 0) > 0)
  ) {
    return buildAnswerSummary(details);
  }

  return { success: buildAnswerExcerpt(text) ?? "Answer output available" };
}

function buildAnswerSummary(
  details: Extract<ToolDetails, { tool: "web_answer" }>,
): SummaryParts {
  const queryCount = details.queryCount ?? 0;
  const failedQueryCount = details.failedQueryCount ?? 0;
  const answerCount = Math.max(0, queryCount - failedQueryCount);
  const success = `${answerCount} answer${answerCount === 1 ? "" : "s"}`;

  if (failedQueryCount > 0) {
    return {
      success,
      failure: `${failedQueryCount} of ${queryCount} ${queryCount === 1 ? "question" : "questions"} failed`,
    };
  }

  return { success };
}

function buildAnswerExcerpt(text: string | undefined): string | undefined {
  const excerpt = getFirstLine(text);
  if (!excerpt) {
    return undefined;
  }

  if (excerpt.length <= ANSWER_EXCERPT_MAX_LENGTH) {
    return excerpt;
  }

  return `${excerpt.slice(0, ANSWER_EXCERPT_MAX_LENGTH - 1).trimEnd()}…`;
}

function buildContentsSummary(
  details: ContentsDetails,
  text: string | undefined,
): SummaryParts {
  const totalCount = details.itemCount ?? inferContentsPageCount(text);
  const failedCount = inferContentsFailureCount(text);
  const successCount =
    totalCount === undefined
      ? undefined
      : Math.max(0, totalCount - (failedCount ?? 0));
  const success =
    successCount === undefined
      ? "Contents output available"
      : `${successCount} page${successCount === 1 ? "" : "s"}`;

  if (failedCount && failedCount > 0 && totalCount) {
    return {
      success,
      failure: `${failedCount} of ${totalCount} ${totalCount === 1 ? "page" : "pages"} failed`,
    };
  }

  return { success };
}

function getCompactProviderToolSummary(
  details: ToolDetails | undefined,
): string | undefined {
  if (!details) {
    return undefined;
  }

  if (
    details.tool === "web_contents" &&
    typeof details.itemCount === "number"
  ) {
    return `${details.itemCount} page${details.itemCount === 1 ? "" : "s"}`;
  }

  if (details.tool === "web_research") {
    return "Research";
  }

  return undefined;
}

function inferContentsPageCount(text: string | undefined): number | undefined {
  if (!text) {
    return undefined;
  }

  const pageMatches = text.match(/^##\s+/gm);
  return pageMatches?.length;
}

function inferContentsFailureCount(
  text: string | undefined,
): number | undefined {
  if (!text) {
    return undefined;
  }

  const failureMatches = text.match(/^##\s+(?:\d+\.\s+)?Error:/gm);
  return failureMatches?.length;
}

function getFirstLine(text: string | undefined): string | undefined {
  return text
    ?.split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}
