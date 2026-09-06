---
title: Batched multi-query web search
type: change
author: mavam
created: 2026-03-15T15:41:50.096493Z
---

The agent can now run several related web searches in a single `web_search`
call instead of issuing them one at a time. This reduces round-trips, speeds up
research workflows, and returns results grouped by query so context stays
organized. Each call can include up to 10 queries.

```json
{
  "queries": ["exa sdk docs", "exa pricing", "exa API limits"],
  "maxResults": 5
}
```

The `query` parameter has been replaced by a required `queries` array. Single
searches still work the same way—just wrap the query in a list, up to 10
queries per call.
