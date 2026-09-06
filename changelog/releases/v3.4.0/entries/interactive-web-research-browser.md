---
title: Interactive web research browser
type: feature
authors:
  - mavam
  - claude
prs:
  - 22
created: 2026-06-12T06:14:35.270177Z
---

The `/web-research` command now opens an interactive research browser: a table of running and finished researches showing status, date, provider, duration, and title.

```text
/web-research
```

- Running researches appear at the top with a live spinner and elapsed time. Press `c` twice to cancel one; cancelled researches are recorded as durable `cancelled` reports instead of appearing as failures.
- Press `Enter` on a finished research to read the full report in a scrollable Markdown overlay.
- From the report view, press `c` to copy the report as Markdown to the clipboard, or `i` to inject the report into the current conversation so the agent can build on earlier research without re-running it.

While researches run, the indicator above the editor is now a single summary line with the number of active researches and their status and elapsed time, instead of a multi-line job list.
