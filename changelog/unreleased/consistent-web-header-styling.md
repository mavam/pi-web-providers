---
title: Consistent web header styling
type: bugfix
authors:
  - mavam
prs:
  - 37
created: 2026-09-06T10:16:26.790071Z
---

Web-tool expansion hints now show the configured shortcut, such as `ctrl+o to expand`, instead of generic text. Custom bindings are respected even when the extension loads with an isolated copy of Pi’s terminal components; disabled shortcuts produce no hint.

Truncated headers and status rows retain the tool background through the ellipsis and expansion hint, eliminating the white patch on long parameter lists. Parameter keys are now bold gray, values remain regular gray, and the extra separator after the tool name is gone.
