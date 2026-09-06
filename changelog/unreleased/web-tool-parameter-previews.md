---
title: Web tool parameter previews
type: feature
authors:
  - mavam
prs:
  - 37
created: 2026-09-06T10:10:40.740821Z
---

Pi web-tool headers now show the model’s explicit parameter choices as a gray `key=value` sequence, including provider-specific options:

```text
web search · limit=2 type=neural contents.text=true
web answer · model=<model-id> config.temperature=0
```

Nested options use dotted names, arrays stay compact, and strings with spaces are quoted. Long sequences truncate when collapsed and wrap when expanded. Inherited defaults are omitted so you can distinguish what the model actually supplied. Credential-bearing options are redacted, while model settings such as token budgets remain visible.
