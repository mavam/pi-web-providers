#!/usr/bin/env bash
# Exercise release preparation in isolation; no remote or publishing commands.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$tmp/scripts" "$tmp/src" "$tmp/changelog/releases" "$tmp/changelog/unreleased"
cp -R "$root/archive" "$tmp/"
cp "$root/changelog/config.yaml" "$tmp/changelog/"
cat > "$tmp/changelog/unreleased/first.md" <<'ENTRY'
---
title: First Webfox release
type: breaking
authors: [mavam]
created: 2026-09-06T00:00:00Z
---

Start the Webfox version series.
ENTRY
cp "$root/package.json" "$root/package-lock.json" "$root/README.md" "$root/example-config.yaml" "$tmp/"
cp "$root/src/config.schema.json" "$tmp/src/"
cp "$root/scripts/prepare-release.sh" "$root/scripts/sync-release-metadata.mjs" "$tmp/scripts/"
cd "$tmp"
git init -q -b main
git config user.name 'Release smoke test'
git config user.email 'release-smoke@example.invalid'
git add .
git -c commit.gpgsign=false commit -qm 'Fixture with legacy history'
git tag v0.1.0
git tag v3.5.1
initial_head=$(git rev-parse HEAD)
export RELEASE_INTRO='Offline release preparation test.'
export RELEASE_TITLE='Release smoke test'
export GITHUB_OUTPUT="$tmp/outputs"

check_version() {
  EXPECTED_VERSION="$1" node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const version = process.env.EXPECTED_VERSION;
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
assert.equal(pkg.name, 'webfox');
assert.equal(pkg.version, version);
assert.equal(lock.version, version);
assert.equal(lock.packages[''].version, version);
for (const path of ['README.md', 'example-config.yaml', 'src/config.schema.json']) {
  assert.ok(readFileSync(path, 'utf8').includes(`https://unpkg.com/webfox@${version}/dist/config.schema.json`));
}
assert.ok(readFileSync('outputs', 'utf8').includes(`tag=webfox-v${version}`));
assert.ok(readFileSync(`changelog/releases/v${version}/manifest.yaml`, 'utf8'));
JS
}

# Legacy manifests and tags must not affect the new project's first version.
test "$(bash scripts/prepare-release.sh)" = webfox-v0.1.0
check_version 0.1.0
uvx tenzir-ship==2.2.0 validate
git diff --exit-code -- archive
test "$(git rev-parse HEAD)" = "$initial_head"
test "$(git tag --list | wc -l | tr -d ' ')" = 2

add_bugfix() {
  cat > changelog/unreleased/smoke.md <<'ENTRY'
---
title: Smoke test fix
type: bugfix
authors: [mavam]
created: 2026-09-06T00:00:00Z
---

This entry tests the next Webfox patch release.
ENTRY
}

# Subsequent releases derive their version from Webfox history only.
add_bugfix
test "$(bash scripts/prepare-release.sh)" = webfox-v0.1.1
check_version 0.1.1
uvx tenzir-ship==2.2.0 validate

# Preparation must refuse an existing namespaced tag, without changing Git.
git tag webfox-v0.1.2
add_bugfix
if bash scripts/prepare-release.sh >collision.out 2>collision.err; then
  echo 'Expected a tag collision to fail.' >&2
  exit 1
fi
grep -q 'Release tag already exists: webfox-v0.1.2' collision.err
test "$(git rev-parse HEAD)" = "$initial_head"
git diff --exit-code -- archive
echo 'Release preparation smoke tests passed.'
