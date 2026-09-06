---
title: Actionable unknown-parameter errors
type: bugfix
authors:
  - mavam
prs:
  - 37
created: 2026-09-06T10:22:16.800901Z
---

Unsupported Pi tool parameters now produce precise errors that help the model repair its next call. For example, placing Exa highlights at the wrong level reports:

```text
Invalid parameter: options.highlights. Use options.contents.highlights instead.
```

Suggestions come from the selected provider’s parameter schema and appear only when the destination is unambiguous. Invalid calls remain rejected before provider execution; parameters are never silently moved. Unknown-parameter errors no longer dump the full argument payload.
