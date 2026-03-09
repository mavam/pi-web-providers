---
title: Claude provider for web search and answers
type: feature
authors:
  - mavam
  - codex
created: 2026-03-09T19:55:02.003606Z
---

`pi-web-providers` now supports Claude as a provider for `web_search` and `web_answer` when Claude Code is installed and authenticated locally. This lets you route grounded web lookups through Claude Code's built-in `WebSearch` and `WebFetch` tools and configure Claude-specific defaults such as the model, effort level, maximum turns, and executable path from `/web-providers`.
