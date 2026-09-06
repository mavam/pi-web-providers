---
title: Credential handling and provider flag fixes
type: bugfix
authors:
  - mavam
prs:
  - 37
created: 2026-09-05 17:32:33.466496+00:00
---

Configured credentials are redacted consistently from progress, result values,
input echoes, and errors. Credential commands obey the operation deadline and
cancellation, and successful outputs are cached only within their client.
Overriding one credential preserves the provider's other standard environment
references.

Provider-specific flags also work when `--no-color` precedes the command:

```sh
webfox --no-color search --provider brave --mode web "Node.js release notes"
```

Complex options remain available through `--options-json`; explicit typed flags
take precedence without carrying options across provider changes.
