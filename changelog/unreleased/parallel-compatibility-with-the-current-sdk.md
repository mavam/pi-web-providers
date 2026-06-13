---
title: Parallel compatibility with the current SDK
type: bugfix
authors:
  - mavam
  - codex
prs:
  - 32
created: 2026-06-13T08:36:20.004187Z
---

Parallel-backed `web_search` and `web_contents` continue to work with the current Parallel SDK.

Existing configurations that use the legacy `agentic` or `one-shot` search modes keep working: `agentic` maps to the Parallel `advanced` mode, and `one-shot` maps to the lower-latency `basic` mode.
