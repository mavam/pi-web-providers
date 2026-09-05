---
title: Predictable CLI output
type: feature
authors:
  - mavam
prs:
  - 37
created: 2026-08-03T05:34:07.693607Z
---

The CLI defaults to readable text, including when piped. Use `--format json`
for a versioned result document. Stdout contains results only; progress and
errors go to stderr. Terminal error colors respect `NO_COLOR` and `--no-color`.

```sh
web search "first query" "second query" --format json
web answer - < question.txt
web contents - < urls.txt
web research "Compare databases" --timeout 20m
```

Quoted positional inputs replace repeated `--query` flags, and `--format`
replaces `--output`. Provider-native output is no longer exposed. Explicit `-`
reads one complete text input, or newline-separated URLs for contents; stdin is
never consumed implicitly.

Partial results preserve input order and completed successes. Structured errors
and exit codes distinguish invalid input, provider failures, timeouts, and
cancellation. Deadlines include credential commands, retries, and polling;
research polling retries do not create duplicate jobs.
