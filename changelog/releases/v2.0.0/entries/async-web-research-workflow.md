---
title: Async web research workflow
type: breaking
authors:
  - mavam
  - codex
created: 2026-03-31T19:06:52.973902Z
---

The `web_research` tool now always runs asynchronously and uses one execution model across providers.

Start research as before:

```json
{
  "input": "Compare the managed cloud SIEM market in 2026"
}
```

pi now returns immediately, tracks the running job, and later posts a completion message with the saved report path.

If you previously passed research-specific local execution controls such as `requestTimeoutMs`, `retryCount`, `retryDelayMs`, `pollIntervalMs`, `timeoutMs`, `maxConsecutivePollErrors`, or `resumeId` in `web_research.options`, remove them. The async workflow is now the only supported research behavior.

You can still configure the overall async research deadline in `~/.pi/agent/web-providers.json` with `settings.researchTimeoutMs` or a provider-specific override such as `providers.gemini.settings.researchTimeoutMs`.
