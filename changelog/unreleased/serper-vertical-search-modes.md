---
title: Serper vertical search modes
type: feature
authors:
  - mavam
  - codex
pr: 19
created: 2026-04-30T06:31:19.47589Z
---

Serper-backed `web_search` now supports Serper's vertical modes and webpage scraping through the `mode` option:

```json
{
  "mode": "news",
  "gl": "us",
  "hl": "en",
  "tbs": "qdr:d"
}
```

Use modes such as `images`, `videos`, `maps`, `reviews`, `shopping`, `scholar`, `patents`, `autocomplete`, `lens`, and `webpage` to route a search to the matching Serper endpoint. Webpage scraping includes Markdown by default, making scraped pages easier for agents to consume.
