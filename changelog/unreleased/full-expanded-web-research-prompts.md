---
title: Full expanded web research prompts
type: bugfix
authors:
  - mavam
  - codex
pr: 18
created: 2026-04-29T08:43:51.760141Z
---

Expanded `web_research` calls now provide a useful Markdown detail view without letting long prompts dominate the transcript.

Collapsed tool calls stay compact:

```text
web_research What is pi coding agent? Provide a concise overview...
Started web research via Brave (ctrl+o to expand)
```

Expanding the dispatch result now shows the full submitted brief and report path in a structured Markdown layout:

```md
Started web research via Brave.

## Research brief

What is pi coding agent? Provide a concise overview of its purpose, main features, modes of operation, customization options, and where to find documentation.

## Report path

`.pi/artifacts/research/...md`
```

This makes the collapsed state scannable while preserving the exact research brief for review when expanded.
