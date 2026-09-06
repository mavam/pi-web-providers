#!/usr/bin/env bash
# Prepare files and report names only. Never commit, tag, push, or publish here.
set -euo pipefail

: "${RELEASE_INTRO:?Set RELEASE_INTRO to the release introduction}"

if ! find changelog/unreleased -maxdepth 1 -name '*.md' -print -quit | grep -q .; then
  echo "No unreleased entries to release." >&2
  exit 1
fi

args=()
if ! find changelog/releases -name manifest.yaml -print -quit | grep -q .; then
  args+=(0.1.0)
fi
if [[ -n "${RELEASE_TITLE:-}" ]]; then
  args+=(--title "$RELEASE_TITLE")
fi

# Ship owns semantic versions and manifests. Git tags have a separate namespace.
version=$(uvx tenzir-ship==2.2.0 release create "${args[@]}" --intro "$RELEASE_INTRO" --yes)
if [[ ! "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Expected a stable release version, got: $version" >&2
  exit 1
fi
tag="webfox-$version"
if git show-ref --verify --quiet "refs/tags/$tag"; then
  echo "Release tag already exists: $tag" >&2
  exit 1
fi

node scripts/sync-release-metadata.mjs
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "version=$version" >> "$GITHUB_OUTPUT"
  echo "tag=$tag" >> "$GITHUB_OUTPUT"
fi
echo "$tag"
