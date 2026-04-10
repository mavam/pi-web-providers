The extension now supports Serper as a provider for `web_search`, giving you a lightweight Google-search option with explicit provider-specific schema fields and richer preserved SERP metadata.

## 🚀 Features

### Serper provider for web search

The extension now supports Serper as a provider for `web_search`.

You can route search to Serper with `SERPER_API_KEY`:

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

Supported provider-specific search options include:

- `gl`
- `hl`
- `location`
- `page`
- `autocorrect`

Serper responses are normalized into standard search results while preserving as much provider metadata as possible, including organic result position, sitelinks, attributes, and top-level response context such as `answerBox`, `knowledgeGraph`, `peopleAlsoAsk`, and `relatedSearches`.

## 🧪 Validation

Coverage now includes provider registration, config parsing, settings manifests, tool availability, schema exposure, and adapter request/response mapping for Serper.

*By @mavam and @codex.*
