---
title: Compact Pi results with per-input progress
type: change
authors:
  - mavam
prs:
  - 37
created: 2026-09-06 09:59:11.442231+00:00
---

All four Pi web tools show one status row per input, in request order. Rows
update in place and preserve completed work when another input fails or the
request is cancelled. Successful result bodies stay collapsed; errors remain
visible. Expansion hints respect configured shortcuts.

Headers show explicit parameter choices rather than inherited defaults:

```text
web search limit=2 type=neural contents.text=true
✔︎ first query
▶︎ second query
```

Expanded search titles and snippets remain literal text with clickable source
links. Extracted contents, answers, and research reports render as Markdown.
Credential-bearing options are redacted and terminal control sequences are
removed from displayed inputs. Model-facing result content is unchanged.

Invalid tool parameters report their exact paths and suggest an unambiguous
valid location when possible, rather than dumping the full argument payload or
silently moving options. Library progress callbacks expose indexed input
lifecycle events for every capability.
