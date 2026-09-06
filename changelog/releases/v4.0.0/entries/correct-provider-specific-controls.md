---
title: Updated provider options and working Exa research
type: breaking
authors:
  - mavam
prs:
  - 37
created: 2026-09-06 14:16:56.374317+00:00
---

Provider options now more closely match the underlying services. Some old
settings are no longer accepted:

- **Exa:** remove `livecrawl`, `startCrawlDate`, and `endCrawlDate`. Set
  `options.contents.maxAgeHours` for freshness, using `0` to fetch fresh content.
- **Firecrawl:** search `location` is a string; scrape location uses `country`
  and `languages`, not `city` or `region`. Remove obsolete search language and
  country settings.
- **Tavily:** use `markdown` or `text` for raw content, rather than `true`.
- **OpenAI:** remove `userLocation` from research options.
- **Valyu:** research tool settings accept a boolean or supported
  `enabled`/`max_calls` controls, not arbitrary objects.

For example:

```sh
web search "current release notes" --provider exa --contents-max-age-hours 0
web search --provider firecrawl --help
```

Exa research works again and returns a synthesized report with source links.
Gemini and OpenAI expose more thinking and generation controls; OpenAI also
supports cache-only web access. Parallel and Perplexity expose more retrieval
controls, while Cloudflare and Linkup offer more page-loading options.
Requested Tavily answers/images and Linkup raw content are retained in results.
Supported reasoning settings still depend on the selected model.
