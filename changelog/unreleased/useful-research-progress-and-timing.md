---
title: Useful research progress and timing
type: change
authors:
  - mavam
prs:
  - 37
created: 2026-09-06T13:47:51.257045Z
---

Research progress now confirms that the provider accepted the request, then
reports elapsed time roughly every 30 seconds while polling. Provider status
changes appear when available, and transient status-check failures include the
retry delay and count without starting another job. Opaque job IDs and redundant
completion messages no longer clutter the output.

For example, stderr for `webfox research --provider gemini "research the question of life"`
can look like this:

```text
▶︎ Submitting research to Gemini.
▶︎ Gemini accepted the request; waiting for the report.
▶︎ Gemini research is still running (30s elapsed).
✔︎ Research via Gemini completed in 1m 12s.
```

The report goes to stdout, separately from these status messages. `--quiet`
suppresses the progress and completion lines but preserves errors. Elapsed-time
updates do not imply a completion percentage or research stages the provider
has not reported.
