---
title: One-dispatch live provider tests
type: change
authors:
  - mavam
created: 2026-09-06T16:33:46.244719Z
---

You can now test all configured web providers with one CI dispatch:

```sh
gh workflow run ci.yaml
```

The run covers supported non-research capabilities, reports missing credentials as skips, and fails if no live tests run. You can still select an individual provider or capability. Research remains opt-in.
