# Release engineering

Webfox has its own version series, starting at `0.1.0`. The old pi-web-providers
release files are preserved byte-for-byte under
[`archive/changelog/releases`](../archive/changelog/releases).
Existing `v…` Git tags and GitHub releases belong to that old series and must not
be deleted or replaced.

## Versions and tags

- `changelog/` is the active Webfox project. Ship selects versions only from this
  history, not from the archive or Git tags.
- The first release is explicitly `0.1.0`. Later versions are inferred from the
  active unreleased entries using Ship's normal versioning rules.
- Package versions are bare semantic versions, such as `0.1.0`.
- Manifest directories retain Ship's format: `changelog/releases/v0.1.0/`.
- Git tags use the Webfox namespace: `webfox-v0.1.0`.

Ship 2.2.0 hard-codes `v…` publishing tags. The workflow therefore uses Ship for
release creation and version updates, then Git and GitHub CLI for publishing the
namespaced tag and generated notes. Do not run `tenzir-ship release publish`
directly for Webfox.

## Publish a release

1. Merge release-ready changes into `main` and synchronize it with `origin/main`.
2. Dispatch `.github/workflows/release.yaml` on `main` with an introduction and
   optional title.
3. Check both the GitHub release job and npm publishing job.

The workflow serializes releases and rejects non-main or stale checkouts.
Preparation updates the package and lockfile versions and all configuration
schema URLs. Validation runs before committing. An atomic push updates `main`
and the new tag together; a concurrent main update or existing tag fails instead
of overwriting history.

The npm job checks out the explicit `tag` output, not the semantic `version`
output. The published package remains `webfox` and installs `web`.

If npm publishing fails, rerun only that failed job. If GitHub release creation
fails after the tag was pushed, recover from the existing tag and generated
notes rather than running release preparation again. Never delete or replace a
release tag to retry.

## Test without publishing

```sh
bun run smoke:release
```

This uses a temporary Git repository with legacy `v0.1.0` and `v3.5.1` tags and
the archived manifests. It verifies the initial `webfox-v0.1.0` target, a following
patch release, package/schema synchronization, unchanged archived files, and
rejection of a duplicate Webfox tag. No remote is configured; no commits or tags
are created by release preparation. CI runs this check too.
