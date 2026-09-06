---
title: Custom provider discovery reflects configuration
type: change
authors:
  - mavam
prs:
  - 37
created: 2026-09-06T15:00:58.141567Z
---

`webfox providers` hides the custom provider unless at least one command is configured or it is selected as a default. Its support checkmarks now reflect configured commands rather than all possible capabilities. Run `webfox providers custom` to inspect it explicitly and see setup guidance, even before configuring any commands.
