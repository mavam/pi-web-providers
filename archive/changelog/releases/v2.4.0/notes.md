This release adds a Serper provider for `web_search`, giving you a fast Google-style search backend that you can configure with a `SERPER_API_KEY`. Serper also preserves rich search context such as sitelinks, answer boxes, knowledge graph data, and related searches for better follow-up analysis.

## 🚀 Features

### Serper provider for web search

You can now route `web_search` through Serper with a `SERPER_API_KEY`, giving you another API-backed provider for fast Google-style search results.

```json
{
  "tools": {
    "search": "serper"
  },
  "providers": {
    "serper": {
      "apiKey": "SERPER_API_KEY"
    }
  }
}
```

Serper preserves rich search context such as sitelinks, answer boxes, knowledge graph data, and related searches, which makes the returned results more useful for follow-up analysis.

*By @Thinkscape in #13.*
