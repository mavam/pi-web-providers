---
title: Ollama provider for web search and contents
type: feature
authors:
  - mcowger
pr: 16
created: 2026-04-27T08:24:27.664117Z
---

Ollama can now power `web_search` and `web_contents` through its Web Search and Web Fetch APIs:

```json
{
  "tools": {
    "search": "ollama",
    "contents": "ollama"
  },
  "providers": {
    "ollama": {
      "apiKey": "OLLAMA_API_KEY"
    }
  }
}
```

This gives users another API-backed option for search-plus-page-fetch workflows, including installations that already use Ollama Cloud credentials.
