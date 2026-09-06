---
title: Correct provider-specific controls
type: bugfix
authors:
  - mavam
prs:
  - 37
created: 2026-09-06 14:16:56.374317+00:00
---

Provider-specific options now more closely match the services they configure.
Gemini answers expose thinking settings, and OpenAI supports reasoning budgets
and cache-only web access. Parallel and Perplexity expose more source and
retrieval controls; Cloudflare and Linkup offer more page-loading options.

Incorrect Firecrawl location shapes and outdated Tavily option types are fixed.
Unsupported OpenAI research location settings and invalid Valyu research tool
settings are rejected locally. Requested Tavily answers/images and Linkup raw
content are preserved in result metadata instead of being discarded.

Use provider-specific help to see the current options:

```sh
webfox search --provider parallel --help
webfox answer --provider openai --help
```

Existing settings may need adjustment: Firecrawl search location is a string,
while scrape location uses `country` and `languages`. For Tavily raw content,
use `markdown` or `text`, rather than `true`. Reasoning support still depends on
the selected model.
