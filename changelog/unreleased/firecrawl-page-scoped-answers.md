---
title: Firecrawl page-scoped answers
type: feature
authors:
  - mavam
  - codex
prs:
  - 31
created: 2026-05-31T16:36:32.341073Z
---

Firecrawl can now power page-scoped `web_answer` calls through its question format.

Example call:

```json
{
  "queries": ["What does this page say about the question format?"],
  "options": {
    "url": "https://docs.firecrawl.dev/features/scrape#question-format"
  }
}
```

This is useful when you already know the page to inspect and want a concise answer without fetching the full page contents first. The Firecrawl answer provider remains URL-scoped, so use `web_search` plus `web_contents` or `web_research` for multi-source answers.
