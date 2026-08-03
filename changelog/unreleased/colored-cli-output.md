---
title: Colored CLI output
type: feature
authors:
  - mavam
  - codex
prs:
  - 37
created: 2026-08-03T05:34:07.693607Z
---

Interactive `web` commands now use colored help, provider status tables, and
human-readable result headers with `✔︎` and `✘︎` status marks:

```sh
web providers
web search "Node.js 22"
```

Colors disable automatically when output is redirected and can be controlled
with `--no-color`, `NO_COLOR`, or `FORCE_COLOR`. JSON and raw output remain
free of ANSI color codes.
