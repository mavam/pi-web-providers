---
title: Secret-backed live provider tests
type: feature
authors:
  - mavam
  - codex
prs:
  - 33
created: 2026-06-13T09:39:13.275145Z
---

Maintainers can now verify API-backed providers with a documented, opt-in live test workflow:

```sh
npm run test:live
```

The default `npm test` remains deterministic and credential-free. Live runs use provider credentials from environment variables or GitHub Secrets, and can be filtered with `LIVE_API_PROVIDERS` and `LIVE_API_CAPABILITIES`.
