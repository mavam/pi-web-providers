---
title: Full expanded web research prompts
type: bugfix
authors:
  - mavam
  - codex
pr: 18
created: 2026-04-29T08:43:51.760141Z
---

Expanded `web_research` calls now show the complete research prompt instead of keeping the collapsed ellipsis preview.

Previously, a long research prompt could still appear truncated after expanding the tool call:

```text
web_research
   What is pi coding agent? Provide a concise overview of its purpose, main features, mo...
```

The expanded view now wraps the full prompt across lines, making it possible to review the exact research brief that was submitted.
