---
title: Standalone CLI with explicit routing and predictable output
type: feature
authors:
  - mavam
prs:
  - 37
created: 2026-08-03 05:34:07.693607+00:00
---

Use `webfox` to search, extract pages, answer questions, and run research from
scripts or a terminal. Provider-aware help exposes only relevant options, and
provider discovery separates capability support, configuration, and selected
defaults without running credential commands or claiming connectivity is verified.

```sh
webfox providers
webfox search --provider exa --help
webfox search "first query" "second query" --provider exa --format json
webfox contents - --provider tavily < urls.txt
```

Results go to stdout; progress, completion notices, and errors go to stderr.
Text is the default even when piped; `--format json` returns a versioned result
document. Explicit `-` reads stdin: one complete query, question, or research
brief, or newline-separated URLs for contents.

Batches preserve input order and completed results on partial failure. Error
codes distinguish invalid input, provider failures, timeouts, and cancellation;
deadlines include credential resolution and retries. Research polling reports
acceptance, elapsed time, and retry delays without submitting duplicate jobs.
`--quiet` hides progress and success notices but never errors. Colors respect
terminal detection, `NO_COLOR`, and `--no-color`.
