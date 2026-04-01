---
title: Cloudflare Browser Rendering provider for web contents
type: feature
authors:
  - arpagon
  - mavam
  - codex
pr: 9
created: 2026-04-01T01:29:18.908322Z
---

The new `cloudflare` provider adds `web_contents` support via Cloudflare Browser Rendering. It renders pages in a real browser and converts them to Markdown, which helps with JavaScript-heavy sites that do not expose useful content to a plain HTTP fetch.

Configure it with a Cloudflare API token and account ID:

```json
{
  "tools": {
    "contents": "cloudflare"
  },
  "providers": {
    "cloudflare": {
      "apiToken": "CLOUDFLARE_API_TOKEN",
      "accountId": "CLOUDFLARE_ACCOUNT_ID"
    }
  }
}
```

You can also pass Browser Rendering options such as `gotoOptions`, `waitForSelector`, `waitForTimeout`, and `cacheTTL` through `providers.cloudflare.options` or per-call `web_contents.options`.
