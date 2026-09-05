---
title: Progressive CLI help
type: change
authors:
  - mavam
prs:
  - 37
created: 2026-08-03T06:46:03.701626Z
---

Common help now shows a small set of everyday controls. Request provider help
for exact provider-specific flags, or advanced help for configuration and complex
JSON options:

```sh
web search --help
web search --provider openai --help
web search --help-advanced
```

Provider discovery distinguishes supported capabilities, locally configured
credential sources, and saved defaults without running credential commands or
claiming that credentials have been verified. Save a selection with
`web config default search brave`; starter-file and generic editor commands are
no longer part of the CLI.
