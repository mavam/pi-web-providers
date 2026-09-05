import type { WebDocument, ContentsAnswer } from "./domain.js";

/** Presentation is deliberately outside the application/runtime. */
export function renderTextDocument(
  document: WebDocument,
  { includeErrors = true }: { includeErrors?: boolean } = {},
): string {
  return document.results
    .map((entry, index) => {
      const heading =
        document.results.length > 1 ? `## ${index + 1}. ${entry.input}` : "";
      if (!entry.ok)
        return includeErrors
          ? [heading, `Error: ${entry.error.message}`]
              .filter(Boolean)
              .join("\n\n")
          : undefined;
      let body: string;
      if ("results" in entry.value)
        body = entry.value.results.length
          ? entry.value.results
              .map(
                (result, i) =>
                  `${i + 1}. ${result.title}\n   ${result.url}\n   ${result.snippet}`,
              )
              .join("\n\n")
          : "No results found.";
      else if ("text" in entry.value) body = entry.value.text;
      else body = renderContents(entry.value);
      return [heading, body].filter(Boolean).join("\n\n");
    })
    .filter((part) => part !== undefined)
    .join("\n\n");
}
function renderContents(answer: ContentsAnswer): string {
  return [
    `## ${answer.url}`,
    answer.content,
    answer.summary === undefined
      ? undefined
      : `### Summary\n\n${typeof answer.summary === "string" ? answer.summary : JSON.stringify(answer.summary, null, 2)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
