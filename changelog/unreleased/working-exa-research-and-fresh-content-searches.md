---
title: Working Exa research and fresh-content searches
type: bugfix
authors:
  - mavam
prs:
  - 37
created: 2026-09-06T13:56:37.067412Z
---

Exa research works again and returns a synthesized report with source links:

```sh
webfox research --provider exa "Compare current approaches to database backups"
```

Fresh-content search requests no longer offer the deprecated `livecrawl` option
that conflicts with `maxAgeHours`. Use `options.contents.maxAgeHours: 0` to fetch
fresh content, or the CLI flag `--contents-max-age-hours 0`. Remove `livecrawl`
from existing search requests and saved options. Ignored `startCrawlDate` and
`endCrawlDate` controls are also removed. Invalid cache ages and fetch timeouts
are rejected before contacting Exa.
