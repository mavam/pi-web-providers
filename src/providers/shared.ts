import type { JsonObject } from "../types.js";

export function trimSnippet(
  input: string | undefined,
  maxLength = 300,
): string {
  const text = (input ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

export function normalizeContentText(input: string | undefined): string {
  const text = (input ?? "").replace(/\r/g, "").trim();
  if (!text) {
    return "";
  }

  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

export function pushIndentedBlock(lines: string[], text: string): void {
  const normalized = normalizeContentText(text);
  if (!normalized) {
    return;
  }

  for (const line of normalized.split("\n")) {
    lines.push(`   ${line}`);
  }
}

export function asJsonObject(
  value: JsonObject | undefined,
): Record<string, unknown> {
  return value ? { ...value } : {};
}

export function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
