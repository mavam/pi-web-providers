---
title: Pi package scope migration compatibility
type: bugfix
authors:
  - mavam
created: 2026-05-08T06:38:19.770847Z
---

The extension now works with Pi's new `@earendil-works/*` package scope after the upstream repository migration. Users can install or build the package against current Pi releases without resolving stale `@mariozechner/*` internal package references.
