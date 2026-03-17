---
title: Consistent provider names and progress messages
type: bugfix
authors:
  - mavam
  - claude
created: 2026-03-17T18:22:55.14456Z
---

In-flight progress messages now use consistent capitalization and a
uniform structure across all providers and tools.

Previously, the provider name was shown in lowercase in collapsed
result summaries (e.g. `3 results via exa`) while the same provider
appeared capitalized in in-flight messages (e.g. `Searching Exa
for: …`). All collapsed summaries now use the same capitalized
provider label.

The in-flight messages themselves have also been unified into a
common pattern:

- Search: `Searching <Provider> for: <query>`
- Contents: `Fetching contents from <Provider> for N URL(s)`
- Answer: `Getting <Provider> answer for: <query>`
- Research: `Starting <Provider> research`
- Research heartbeat: `Researching via <Provider> (N elapsed)`

Previously, research messages used inconsistent phrasing such as
`Creating Exa research task`, `Creating Valyu deep research task`,
and `web_research still running via exa (30s elapsed)`.
