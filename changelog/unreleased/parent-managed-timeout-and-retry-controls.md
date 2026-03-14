---
title: Timeout, retry, and resume controls for all web tools
type: feature
authors:
  - mavam
  - claude
created: 2026-03-13T16:14:46.000000Z
---

All web tools now support per-call timeout, retry, and backoff settings through
the `options` object:

- `requestTimeoutMs` — per-request timeout
- `retryCount` — number of retries on transient errors (429, 5xx, network
  failures)
- `retryDelayMs` — base delay between retries (doubles on each attempt, capped
  at 30 s)

The `web_research` tool adds controls for long-running investigations:

- `pollIntervalMs` — how often to check for completion
- `timeoutMs` — overall deadline for the research job
- `maxConsecutivePollErrors` — consecutive poll failures to tolerate before
  aborting
- `resumeId` — resume a previously timed-out research job by its ID

When a research job times out, the error message includes the job ID so you can
pick up where it left off:

```
Gemini research exceeded 6h. Resume the background job with
options.resumeId="abc123".
```

All settings are configurable per provider in
`~/.pi/agent/web-providers.json`, with provider-native knobs under `native`
and parent-managed runtime controls under `policy`.
