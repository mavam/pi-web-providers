---
title: Prettier tool-call display and Markdown web results
type: change
authors:
  - mavam
  - codex
created: 2026-03-16T18:55:00Z
---

Web tool rendering is now cleaner and more consistent:

- `provider=auto` is no longer shown in tool-call headers
- default `maxResults=5` is hidden, while non-default values are shown compactly
- single-query and single-URL calls render on one line with the tool name
- collapsed summaries now consistently show the resolved provider, for example `3 results via gemini`
- provider casing is normalized in partial progress updates

Expanded `web_search` and `web_answer` output now renders as Markdown blocks with `##` headings for each query or question, along with improved spacing between sections. This makes batched results much easier to scan without changing the tool output content.
