---
title: Brave web provider
type: feature
authors:
  - mavam
  - codex
pr: 18
created: 2026-04-29T08:19:37.08098Z
---

`pi-web-providers` can now route `web_search`, `web_answer`, and `web_research` through Brave.

Configure Brave with separate credentials for Search and Answers:

```json
{
  "tools": {
    "search": "brave",
    "answer": "brave",
    "research": "brave"
  },
  "providers": {
    "brave": {
      "credentials": {
        "search": "BRAVE_SEARCH_API_KEY",
        "answers": "BRAVE_ANSWERS_API_KEY"
      }
    }
  }
}
```

`web_search` uses Brave Web Search by default to return source titles, URLs, snippets, and metadata. It also supports query-time modes for specialized Brave endpoints:

```json
{
  "mode": "llm_context"
}
```

The `llm_context` mode uses Brave LLM Context for query-based retrieval and places extracted source chunks directly in search snippets so agents can read them from normal `web_search` output. The `images` mode maps Brave Image Search results to their source pages while preserving image URLs and dimensions as metadata. The `places` mode maps Brave Place Search results to source-like entries with place metadata such as address, categories, rating, and provider URLs.

`web_answer` and `web_research` use Brave Answers. Answers stream grounded responses with citations and render a `Sources:` section when Brave returns citation data. Research enables Brave's research mode, normalizes the request to `enable_research=true`, `stream=true`, and `enable_citations=false`, and returns the generated report through pi's normal `web_research` artifact flow.

`web_contents` remains separate: use a URL-fetch-capable provider for page extraction, while Brave LLM Context remains available as a search/retrieval mode for query-grounded context.
