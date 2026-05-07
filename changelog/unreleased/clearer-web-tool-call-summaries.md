---
title: Clearer web tool call summaries
type: change
authors:
  - mavam
  - codex
prs:
  - 23
created: 2026-05-07T06:51:23.566905Z
---

Collapsed web tool calls are easier to scan and can use configurable status symbols.

Running `web_*` tools now show concise progress with dim provider context, successful results focus on the outcome, and mixed results show both the successful and failed parts in one line. You can also customize or hide the symbols used in collapsed summaries:

```json
{
  "settings": {
    "symbols": {
      "success": "✔",
      "failure": "✘"
    }
  }
}
```

Set either value to `null` to render summaries without that symbol.
