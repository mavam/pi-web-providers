---
title: Readable web tool headers
type: change
authors:
  - mavam
prs:
  - 37
created: 2026-09-06T09:45:12.361072Z
---

Pi tool-call headers now show space-separated names and inline inputs, such as `web search "Node.js release notes"` or `web contents https://nodejs.org`. Queries and research briefs are quoted; page URLs are unquoted. Inputs use the theme accent color, while search limits are highlighted separately. Long previews stay compact and show the configured expansion shortcut. Expand a tool to read all inputs. Model-facing tool names and result output are unchanged.
