---
title: Progressive CLI help
type: change
authors:
  - mavam
prs:
  - 37
created: 2026-08-03 06:46:03.701626+00:00
---

Common help shows a small set of everyday controls. Request provider help
for exact provider-specific flags, or advanced help for configuration and complex
JSON options:

```sh
webfox search --help
webfox search --provider openai --help
webfox search --help-advanced
```

Provider discovery distinguishes supported capabilities, locally configured
credential sources, and saved defaults without running credential commands or
claiming that credentials have been verified. Save a selection with
`webfox config default search brave`.
