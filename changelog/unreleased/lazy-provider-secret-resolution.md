---
title: Lazy provider secret resolution
type: bugfix
authors:
  - mavam
  - codex
prs:
  - 28
created: 2026-05-19T16:11:52.070619Z
---

Provider secrets are now resolved only when a configured web tool is used, instead of during session startup.

Configurations that use environment variables or `!command` values for provider credentials no longer pay the secret lookup cost just because a pi session starts. For example:

```json
{
  "providers": {
    "exa": {
      "credentials": {
        "api": "!op read op://Private/Exa/api-key"
      }
    }
  }
}
```

If the secret is missing or the command fails, the error is reported when the matching web tool is called.
