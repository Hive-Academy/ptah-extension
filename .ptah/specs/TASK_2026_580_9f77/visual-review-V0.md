VERDICT: APPROVED

Score: 9/10

Counts: visual breaking 0, serious 0, moderate 0, minor 1 (evidence note, see Residual).

# Visual Review - TASK_2026_580_9f77 batch T2 (V0 base "before" shots for task card and task detail)

## Environment

- Base: commit `a90c086d7` checked out in a temporary worktree `D:\projects\ptah-extension\.claude-worktrees\task-580-v0b` (detached; the 580 branch was never switched). `node_modules` was a junction to the shared one; the junction was removed with `rmdir` before `git worktree remove --force`. The real `node_modules` is intact (1280 top-level entries), the worktree is gone from `git worktree list`. Nothing was committed or edited.
- Base build: `npx nx build ptah-extension-webview --configuration=development` in that worktree (2 m 45 s), served by a throwaway Node static server on 127.0.0.1; Playwright Chromium. The Electron app was not launched.
- After reference: the current 580 worktree `dist` (C2.2 round 1, C1.2 round 1 and C2.3 changes), captured with the identical script and mocks.
- Harness: `visual-v0/v0.mjs` (merged mocks from `visual-c22/run2.mjs` and `visual-c23/c23.mjs`: five card tasks T1..T5 with the same session states, three detail tasks D1..D3, UUID session ids, `tasks:board`, `tasks:get`, `workspace:getInfo`, `session:listForTasks`; the base build never calls the links RPC). Hosts: Electron shape (`isElectron`, `ptah-electron-shell`, requested) and the VS Code shape (as used in the C2.2/C2.3 reviews). Themes `anubis` and `anubis-light`; widths 360, 800, 1400 (viewport height 2600 so the whole detail panel fits).
- Evidence folder: `visual-v0/` (`base-electron/`, `after-electron/`, `base-vscode/`, `after-vscode/` each with per-card and per-detail crops, board shots and `results.json`; `diff-results.json`; scripts `v0.mjs`, `diff.mjs`, `bbox.mjs`, `xcheck.mjs`).

## Method of comparison

Pixel comparison with an 8/255 per-channel tolerance on element crops. A card or panel with a new block is compared in two parts: the rows above the new block must be identical, and the rows below it must be identical to the base once shifted down by the block's height. A task without sessions must be identical in full.

## Results

### Task card (240 px wide at every viewport, both themes, both hosts: 24 combinations of host, theme, width, plus all five cards each)

| Card                      | Base to after     | Result                                                  |
| ------------------------- | ----------------- | ------------------------------------------------------- |
| T1 no sessions            | height 141 to 141 | 0 differing pixels (identical)                          |
| T2 three sessions + PR    | 160 to 208 (+48)  | rows above the new row: 0; rows below, shifted 48 px: 0 |
| T3 PR without number      | 141 to 189 (+48)  | 0 / 0                                                   |
| T4 running, no PR         | 137 to 185 (+48)  | 0 / 0                                                   |
| T5 long title, 7 sessions | 156 to 224 (+68)  | 0 / 0                                                   |

So the only change to the card is the inserted sessions row (42 px, or 62 px with the +N marker); the header, title, labels, rollup, actions and footer are pixel-identical above and below it.

### Task detail (384 px panel, 3 tasks, 24 combinations)

- D2 (3 sessions) and D3 (8 sessions): rows below the new Sessions section, shifted by the section height plus its 12 px gap (216 and 522 px), are identical: 0 differing pixels at every width, theme and host. Rows above the section: 0 at 800 and 1400 in both hosts and themes.
- D1 (empty section "No sessions linked to this task", 37.6 px high): the content below, shifted by 49.59 px, differs by about 1200 sub-pixel antialiasing pixels only. Measured in the DOM: the Files heading sits at 744 (base) and 793.59 (after), a fractional shift of 49.59 px, which cannot be matched by an integer shift. No structural difference.
- At 360 px some rows above the section differ in a left strip 0 to 23 px wide (for example electron dark D2: x 0 to 7, y 298 to 391; vscode light D1: x 0 to 23, y 134 to 460). That is the board column visible beside the narrow overlapping panel, where the cards that gained a sessions row show a different edge; it is the card change above and not the panel. At 800 and 1400 there is no such difference.
- Headings in the panel: base shows Workflow, Files; after shows Workflow, Sessions (N), Files (N) (`results.json` `details.headings`).

### Cross-check against the earlier reviews

Card crops of T2 and T5 in the new "after" run versus `visual-c22/round1/card-three-*` and `card-long-*` (360 and 1400, both themes): T5 is identical (0 pixels); T2 differs by 88 of 49,920 pixels in all four, the pulsing running dot caught at a different animation frame (T5 has no pulsing dot). The mocks and harness are therefore equivalent to the earlier ones. The Sessions section values measured in `visual-c23/` (2 px focus ring, contrast, dot rings) were not re-measured.

## Findings

No visual regression. Differences between base and after are exactly: the new sessions row on cards that have linked sessions (and none on cards without), and the new Sessions section between the Workflow panel and Files in the detail. No other element moved, changed colour, or changed in size at any viewport, theme or host.

### Residual (minor)

1. The D1 comparison shows an integer-pixel residual caused by the section height being fractional (37.59 px); a sub-pixel antialiasing effect, not a defect, recorded so the number is not mistaken for one.

## Prototype fidelity

No prototype exists (plan :973). The base shots are the V0 evidence for the C2.2 and C2.3 batches; the after shots are in `visual-v0/after-*` and in `visual-c22/round1/` and `visual-c23/`.

## Verdict

APPROVED. The V0 base evidence is complete (dark and light, 360/800/1400, Electron shape and VS Code shape, card and detail) and confirms the only differences from base are the new card sessions row and the detail Sessions section. Confidence: HIGH (pixel comparison on all 48 card crops and 48 detail crops with explained residuals).
