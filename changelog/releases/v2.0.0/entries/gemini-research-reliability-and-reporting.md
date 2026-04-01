---
title: Gemini research reliability and reporting
type: bugfix
authors:
  - mavam
  - codex
created: 2026-03-31T23:59:00Z
---

Gemini-backed `web_research` runs now fail earlier with clearer diagnostics when the provider stops making forward progress, and the resulting completion messages are easier to review in pi.

The overall research deadline is now configurable through `settings.researchTimeoutMs` or a provider-specific override such as `providers.gemini.settings.researchTimeoutMs`. The default deadline is now 30 minutes.

When Gemini returns terminal states such as `requires_action` or `incomplete`, the extension now reports those outcomes directly instead of continuing to poll until the outer timeout expires.

Async research result messages also render more cleanly in the TUI. The collapsed view now shows a compact metadata summary with the start time, duration, saved file, and any error, while `ctrl+o` expands the full report. Successful expanded reports now render as Markdown.
