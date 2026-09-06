---
title: Literal search snippets in Pi
type: bugfix
authors:
  - mavam
prs:
  - 37
created: 2026-09-06T13:31:20.475881Z
---

Expanded Pi search results now keep titles and snippets as literal text. Source text such as `# packages/...`, backticks, or `---` no longer turns an entire flattened excerpt into a heading or other Markdown formatting.

Search URLs remain clickable, with result numbering and query headings formatted separately. Contents, answers, and research reports retain Markdown rendering. Provider data, model-facing output, and CLI output are unchanged.
