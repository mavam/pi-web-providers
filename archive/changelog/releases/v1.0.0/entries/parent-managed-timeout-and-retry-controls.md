---
title: Timeout, retry, and resume controls for all web tools
type: feature
authors:
  - mavam
  - claude
created: 2026-03-13T16:14:46.000000Z
---

Web tools now support parent-managed retry and backoff settings through the
`options` object, plus per-call timeouts where the selected provider lifecycle
can safely enforce them:

- `requestTimeoutMs` — per-request timeout
- `retryCount` — number of retries on transient errors (429, 5xx, network
  failures)
- `retryDelayMs` — base delay between retries (doubles on each attempt, capped
  at 30 s)

The `web_research` tool adds controls for long-running investigations. The
overall `timeoutMs` starts when the research request begins, including
background job creation:

- `pollIntervalMs` — how often to check for completion
- `timeoutMs` — overall deadline for the research job
- `maxConsecutivePollErrors` — consecutive poll failures to tolerate before
  aborting
- `resumeId` — resume a previously timed-out research job by its ID

Perplexity research remains synchronous, so it only supports
`requestTimeoutMs`, `retryCount`, and `retryDelayMs`. Exa and Valyu research
support polling, overall deadlines, and resume IDs after job creation, but
reject `requestTimeoutMs` because their current SDK lifecycles do not safely
support per-request local timeouts. Their research start requests also avoid
automatic start retries, because retrying a non-idempotent background-job
creation call could create duplicate jobs.

When a research job times out, the error message includes the job ID so you can
pick up where it left off:

```
Gemini research exceeded 6h. Resume the background job with
options.resumeId="abc123".
```

All settings are configurable per provider in
`~/.pi/agent/web-providers.json`, with provider-specific knobs under `options`
and parent-managed runtime controls under `policy`.
