---
title: OpenAI provider for web search, answers, and research
type: feature
authors:
  - mavam
  - codex
created: 2026-04-12T14:17:55.289783Z
---

You can now route `web_search`, `web_answer`, and `web_research` through OpenAI with an `OPENAI_API_KEY`, including longer async research runs through pi's managed research workflow.

```json
{
  "tools": {
    "search": "openai",
    "answer": "openai",
    "research": "openai"
  },
  "providers": {
    "openai": {
      "apiKey": "OPENAI_API_KEY"
    }
  }
}
```

This gives you an API-key-based OpenAI option alongside Codex. Codex is still useful when you want to reuse local Codex CLI auth for `web_search`, while OpenAI covers a broader set of web tools and is a better fit when you want grounded answers or research reports from the OpenAI API without depending on a local Codex installation.
