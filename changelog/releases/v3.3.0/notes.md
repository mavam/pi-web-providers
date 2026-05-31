Firecrawl can now answer questions against a specific page through its question format. This lets users ask for concise page-scoped answers without first fetching full page contents.

## 🚀 Features

### Firecrawl page-scoped answers

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

*By @mavam and @codex in #31.*
