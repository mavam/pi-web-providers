---
title: Batched web answers and multiline tool-call rendering
type: change
authors:
  - mavam
  - codex
created: 2026-03-15T20:53:25.89995Z
---

`web_answer` now accepts a required `queries` array, matching `web_search`, so you can batch several related questions into one grounded-answer call.

```json
{
  "queries": [
    "What are common Tenzir use cases?",
    "How does Tenzir help with SIEM migration?"
  ]
}
```

Tool-call rendering is also easier to scan: `web_answer` shows the tool name on the first line and each question on its own line below it, and multi-query `web_search` calls now list each query the same way instead of collapsing them into a count. Partial foreground updates for `web_search`, `web_contents`, and `web_answer` no longer clutter the pending tool box.
