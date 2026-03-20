import type { ProviderId } from "./types.js";

export interface ContentsAnswer {
  url: string;
  content?: string;
  summary?: unknown;
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface ContentsResponse {
  provider: ProviderId;
  answers: ContentsAnswer[];
}

export function renderContentsAnswer(
  answer: ContentsAnswer,
  index?: number,
): string {
  const heading =
    answer.error !== undefined
      ? `Error: ${answer.url || "Untitled"}`
      : answer.url || "Untitled";
  const lines = [
    `## ${index === undefined ? "" : `${index + 1}. `}${heading}`.trim(),
  ];

  const body =
    answer.error !== undefined
      ? answer.error.trim()
      : (answer.content?.trim() ?? "");
  if (body) {
    lines.push("", body);
  }

  if (answer.summary !== undefined) {
    const summaryText = renderUnknown(answer.summary);
    if (summaryText) {
      lines.push("", "### Summary", "", summaryText);
    }
  }

  return lines.join("\n").trimEnd();
}

export function renderContentsAnswers(answers: ContentsAnswer[]): string {
  if (answers.length === 0) {
    return "No contents found.";
  }

  return (
    answers
      .map((answer, index) => renderContentsAnswer(answer, index))
      .join("\n\n")
      .trim() || "No contents found."
  );
}

function renderUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (value === undefined) {
    return "";
  }

  return `\`\`\`json\n${JSON.stringify(value, null, 2).trim()}\n\`\`\``;
}
