# webfox

This repository contains **webfox**, a TypeScript library, CLI, and pi extension
for configurable web access.

It exposes web-related capabilities through interchangeable providers instead of
tying each capability to a single backend.

See `README.md` for user-facing documentation.

## Setup

Install Lefthook once per clone:

```bash
uvx lefthook install
```

Pushing runs the quality gates automatically. No need to run checks manually.

## Release engineering

- Use `tenzir-ship` for changelog management and releasing
- Add changelog entries for user facing changes
- Before releasing, ensure `main` is in sync with `origin/main`
- To release, dispatch .github/workflows/release.yaml with a title & intro
- Webfox uses `webfox-v…` Git tags; never use `tenzir-ship release publish`
  directly because its `v…` tags belong to the old pi-web-providers series
- Preserve `archive/` as published history; only `changelog/`
  participates in Webfox version selection
- See `docs/releases.md` for the release process and offline smoke test
