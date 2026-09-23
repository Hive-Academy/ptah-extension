---
id: TASK_2026_531_compact
status: done
type: feature
title: 'Compact session view — markdown, size-adaptive card and layout menu'
description: >-
  Render markdown in the compact card recap, show plain text in the feed, let
  the card fill every tile size, and group the tile layout menu into width,
  height and arrange. Follow-up to TASK_2026_512_feaa. PR #577.
updated: '2026-09-23T14:41:50.819Z'
---

# TASK_2026_531 — Compact session view: elevation pass

Follow-up to TASK_2026_512_feaa (compact tile redesign). The shipped compact
card works, but three gaps remain against the prototype
(`.ptah/specs/TASK_2026_512_feaa/prototypes/variant-4-wire-console.html`, the
recommended "dual-pane wire console", rationale in `prototype-notes.md`).

## Observed defects (user screenshots, 2026-09-22)

1. **Raw markdown.** The recap pane and the feed detail lines print markdown
   source: `## Where this leaves things`, `**bold**`, `` `code` ``, table rows
   such as `| | |---|---|`.
2. **Fixed-size content in a variable-size tile.** The feed shows a hard row
   budget (5 / 10) and the recap a hard `line-clamp-2` / `line-clamp-5`. When
   the tile is large (full width, Focus, compact-tall) most of the tile is
   empty space: 10 rows and a 4-line recap in an ~800px-tall tile. At 1/3
   width the panes stack and the recap crowds out the feed.
3. **Unstreamlined layout menu.** The tile's `...` menu is a flat list of nine
   text buttons (4 widths, Focus, Start new row, 3 heights) with no visible
   indication of the current width or height.

## Goals

- G1 Markdown renders properly in the recap, via `@ptah-extension/markdown`
  `MarkdownBlockComponent` (the only allowed XSS chokepoint — never
  `[innerHTML]`). Feed one-line details show plain text with markdown syntax
  removed (headings, emphasis, code ticks, links, table pipes/separator rows,
  list bullets).
- G2 The card adapts to whatever size the tile has: every width (1/3, 1/2,
  2/3, full), every height tier (compact, compact-tall) and layout Focus. The
  content fills the space instead of a fixed budget.
- G3 Closer parity with the variant-4 prototype.
- G4 A streamlined layout menu with visible current state.

## Lanes

- Lane A — `libs/frontend/chat-ui/src/lib/molecules/compact-session/**` (+ the
  smart wrapper `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts` only if an input must change).
- Lane B — `libs/frontend/canvas/src/lib/canvas-tile.component.ts` and its spec.
