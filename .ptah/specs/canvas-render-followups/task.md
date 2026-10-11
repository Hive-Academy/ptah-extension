---
id: canvas-render-followups
status: done
type: BUGFIX
title: >-
  Canvas render follow-ups: cut per-tile DOM, hover and change-detection cost of streaming canvas tiles
depends_on: []
created: '2026-10-04T21:47:56.000Z'
updated: '2026-10-05T12:55:08.000Z'
description: >-
  Research found canvas lag is dominated by style, layout and paint, not JS. Keep zone change detection with run coalescing, move hot scroll and pointer listeners out of the zone, shrink the render window for non-focused tiles and stop mounting hover-only toolbars. Shipped in PR #646 (merge 9d00ecbfa) after code-logic and visual reviews.
labels:
  - canvas
  - performance
  - chat
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Research found canvas lag is dominated by style, layout and paint, not JS. Keep zone change detection with run coalescing, move hot scroll and pointer listeners out of the zone, shrink the render window for non-focused tiles and stop mounting hover-only toolbars. Shipped in PR #646 (merge 9d00ecbfa) after code-logic and visual reviews.
