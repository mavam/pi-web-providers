---
title: Brave Answers API compatibility
type: bugfix
authors:
  - mavam
  - codex
prs:
  - 27
created: 2026-05-19T15:43:57.453652Z
---

Brave-backed `web_answer` and `web_research` now use the current Brave Answers API request format.

Existing Brave configurations continue to work, and users can opt into Brave Pro for answer or research calls:

```json
{
  "providers": {
    "brave": {
      "options": {
        "answer": {
          "model": "brave-pro"
        },
        "research": {
          "model": "brave-pro"
        }
      }
    }
  }
}
```

This keeps Brave grounded answers and research compatible after Brave deprecated the Summarizer API in favor of Answers.
