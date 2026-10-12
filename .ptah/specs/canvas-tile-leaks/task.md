---
id: canvas-tile-leaks
status: done
type: BUGFIX
title: >-
  Free closed-tile caches and pause hidden canvas tiles
depends_on: []
created: '2026-10-04T20:06:02.000Z'
updated: '2026-10-05T12:54:29.000Z'
description: >-
  Closed canvas tiles left per-tile caches behind and hidden tiles kept rendering. Free the caches when a tile closes and pause tiles that are not visible. Shipped in PR #645 (merge e2371ea99); code-logic review approved, visual review passed with notes.
labels:
  - canvas
  - performance
  - memory
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Closed canvas tiles left per-tile caches behind and hidden tiles kept rendering. Free the caches when a tile closes and pause tiles that are not visible. Shipped in PR #645 (merge e2371ea99); code-logic review approved, visual review passed with notes.
