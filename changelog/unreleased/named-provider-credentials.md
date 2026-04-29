---
title: Named provider credentials
type: breaking
authors:
  - mavam
  - codex
created: 2026-04-29T07:08:11.683799Z
---

Provider API credentials now live under the `credentials` map. Existing configuration files that use provider-specific credential keys such as `apiKey` or `apiToken` are rewritten to `credentials.api` when pi reads the config file.

Before:

```json
{
  "providers": {
    "exa": {
      "apiKey": "EXA_API_KEY"
    },
    "cloudflare": {
      "apiToken": "CLOUDFLARE_API_TOKEN",
      "accountId": "CLOUDFLARE_ACCOUNT_ID"
    }
  }
}
```

After:

```json
{
  "providers": {
    "exa": {
      "credentials": {
        "api": "EXA_API_KEY"
      }
    },
    "cloudflare": {
      "credentials": {
        "api": "CLOUDFLARE_API_TOKEN"
      },
      "accountId": "CLOUDFLARE_ACCOUNT_ID"
    }
  }
}
```

The automatic migration applies this change:

- `apiKey` → `credentials.api`
- `apiToken` → `credentials.api`

Non-credential fields such as `baseUrl`, `accountId`, `options`, and `settings` stay at their current locations.

This enables providers that require multiple credentials while keeping single-key providers consistent.
