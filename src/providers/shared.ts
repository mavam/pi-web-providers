export function trimSnippet(
  input: string | undefined,
  maxLength = 300,
): string {
  const text = (input ?? "").replace(/\s+/g, " ").trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}
export function normalizeContentText(input: string | undefined): string {
  return (input ?? "")
    .replace(/\r/g, "")
    .trim()
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}
export function asJsonObject(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return value ? { ...value } : {};
}
export function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
