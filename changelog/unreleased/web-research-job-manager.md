---
title: Web research job manager
type: feature
authors:
  - mavam
  - codex
pr: 22
created: 2026-05-03T13:26:00.657369Z
---

The `web_research` tool now has an interactive manager for running jobs and saved reports:

```text
/web-research
```

Use it to inspect active research tasks, cancel a running local job after confirmation, and preview recent reports saved under `.pi/artifacts/research/`. Cancelled jobs are recorded as durable `cancelled` artifacts instead of appearing as failures.
