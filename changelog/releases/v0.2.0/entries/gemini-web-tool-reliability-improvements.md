---
title: Gemini web tool reliability improvements
type: bugfix
authors:
  - mavam
  - codex
created: 2026-03-09T18:18:46.979215Z
---

Gemini-backed web tools now behave more consistently. `web_search` again
returns the actual Google Search results, resolves Google grounding redirect
links to their underlying pages when possible, and avoids showing misleading
snippet text derived from Gemini's HTML search widgets.

`web_answer` now shows cleaner source lists by suppressing opaque Google
grounding redirect URLs, and long-running `web_research` runs emit periodic
progress updates so it is easier to tell the difference between a slow provider
and a stalled one. Truncated tool call previews now also include an ellipsis so
clipped prompts are clearly marked as incomplete.
