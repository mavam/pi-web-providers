---
title: Standalone web-mux library and CLI
type: breaking
authors:
  - mavam
prs:
  - 37
created: 2026-08-02T15:12:01.952462Z
---

Web access is now available as the `web-mux` library, `web` CLI, and pi extension.
Use a provider directly with its standard environment credentials, then save a
capability default when you want to reuse that choice:

```sh
web search "Node.js release notes" --provider brave
web config default search brave
web search "TypeBox validation"
```

Credentials never select providers. Advanced JSON configuration keeps provider
options under `providers.<id>.options.<capability>`; capability defaults contain
only provider selection and portable settings.

Existing pi users must remove `pi-web-providers`, install `web-mux` with
`pi install npm:web-mux`, and recreate their configuration. Old configuration is
not detected or converted automatically. Replace `tools.<capability>` selections
with `defaults.<capability>.provider`, and move provider-specific defaults under
the provider. The library exposes `createWebMux()` with execution and inspection
methods plus `setCapabilityDefault()` for saving a choice.
