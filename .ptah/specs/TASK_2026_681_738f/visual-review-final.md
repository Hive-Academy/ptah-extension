# Visual review (final) - TASK_2026_681_738f items 11-19

Overall verdict: PASS (no blocking or new serious defects; one Serious contrast issue and two Moderate items are pre-existing, one Minor is new).

## How captured

- Build under test: `dist/apps/ptah-electron/main.mjs` (18:56) and `renderer/index.html` (18:58), both newer than the newest edited source (18:49). No build, nx, jest, serve or e2e was run.
- Launch: `.ptah/tmp/a1117-launcher.mjs` (NODE_ENV=development, `userData` redirected to the private copy `.ptah/tmp/a1117-appdata/Ptah Dev`, single-instance lock skipped, imports this worktree's `main.mjs`). Command: `electron.exe a1117-launcher.mjs --remote-debugging-port=9351`. Port 9351 was free; 9333 was not used. The profile copy already existed and was not refreshed.
- Electron PID started by me: 684 (plus its 7 children: 23012, 18572, 16288, 38720, 32744, 17688, 11212). Nothing else was started or killed.
- Playwright `connectOverCDP`, `setViewportSize` 1440 / 760 / 400 x 900 (plus 1700 / 1920 for item 19 only), themes via `document.documentElement.dataset.theme` (`anubis` dark, `anubis-light` light). Session "S4" (`ptah-final-run-ws`, two restored codex CLI lanes). No prompt was sent. The session and workspace sidebars were closed for the shots.
- Scripts and logs in `.ptah/tmp/`: `final-lib.mjs`, `final-common.mjs`, `final-a.mjs` (header, focus, chat turn), `final-b.mjs` (item 19 widths), `final-c.mjs` (lane view, dock shadow, hover card, menu), `final-d.mjs` (760 lane retake after dismissing the hover card), `final-run2.mjs` (inspector, compact), `final-e.mjs` (partial marker, synthetic cost badge, compact 1440/760), `final-f.mjs` (usage-row colours); logs `run-final-a.log`, `run-final-c.log`, `run-final-run2.log`. Not touched: the real Ptah Dev profile, `C:\Users\abdal\.ptah` harness and plugin files, the untracked `.claude\skills\ts-web-conventions`.
- Screenshots: `.ptah/specs/TASK_2026_681_738f/screenshots/final/` (50 files). Before = `screenshots/before-11-17/`, after = `screenshots/after-11-17/`.
- Viewport sample is an audit selection, not a support contract (same set as session 1).

## Item results

| Item | Verdict | Screenshots | Evidence |
| --- | --- | --- | --- |
| 11 No model chip in focus header | PASS | `focus-header-{1440,760,400}-{dark,light}.png` | Header text is `S4 done` only (no `claude-*`/`opus` text, `modelChip:false` at all three widths). Model remains in the inspector tile. |
| 12 Compact / More / Close / Details as icon buttons, focus ring | PASS | `focus-header-*`, `focus-header-focus-1440-{dark,light}.png`, `...-clip.png` | Three 24x24 lucide icon buttons (`Switch to compact view`, `More session actions`, `Close session`, empty text, `svg.lucide.size-4`) at 1440 and 760. At 400 a fourth 24x24 `Open details` button appears and is a lucide icon (the Unicode `i` glyph in after-11-17 is gone). Keyboard Tab visits all four in order with `:focus-visible` and a 2 px solid outline (white ring in dark, dark ring in light). One note: at 760 the separate pane-side details opener is still the circled `i` glyph (see Moderate 1). |
| 13 Inspector Model row padding and bold value | PASS | `inspector-agents-1440-{dark,light}.png`, `inspector-agents-400-{dark,light}.png` | Model tile `p-2.5` (10 px, equal to the other tiles), label 11 px muted over a `font-semibold` (600) 15 px value `Opus 5.5`. Same at the 400 sheet. |
| 14 Lane view has no "Back to conversation" | PASS | `lane-view-{1440,760,400}-{dark,light}.png` | `backToConv:false` at all widths. Lane text starts at `completed`. |
| 15 Inspector AGENTS rows: no raw "Usage:", stat badges, partial marker | PASS (cost badge synthetic only) | `inspector-agents-{1440,400,400-scrolled}-*.png`, `inspector-agents-partial-clip-1440-{dark,light}.png`, `inspector-agents-cost-synthetic-clip-1440-{dark,light}.png` | `usageRaw:false` at 1440 and 400; rows show `CLI lane` chip, optional activity (`pong`), outlined `≥ 11.9k tokens` badge and a ghost duration badge (`68h 18m`); no overflow (`li` scrollWidth equals clientWidth, `rootOver:false`). Real partial marker captured: `title="From retained output, may be partial"`, `aria-label="at least 11925 tokens"`, class `badge badge-outline badge-sm cursor-help`. The restored lanes have no cost data, so the cost badge could not be shown for real; a template-mirrored synthetic `≥ ~$0.12` badge (DOM-injected, removed afterwards) shows the three badges wrap cleanly at the 1440 aside width. Lane view usage row also shows the `≥` partial values (`in ≥ 11.9k out ≥ 56`). |
| 16 User-chosen compact view shows condensed card | PASS | `compact-{1440,400}-{dark,light}.png`, `compact-760-{dark,light}.png`, `compact-1440-dark-recheck.png` | Header button flips to `Switch to full view`; chat input and transcript are hidden; the focus pane shows the condensed card (title, `Full view`, Done status, NOW line, LANES list, totals footer). The same toggle (and `Full view`) restores the transcript and composer at 1440, 760 and 400. |
| 17 Flat lane thread (no frame, no name badge, no chevron, gutter px-3) | PASS for CLI lane; subagent lane NOT CAPTURED | `lane-view-{1440,760,400}-*.png`, `lane-view-details-open-1440-dark.png` | Card border width 0, no `codex` name badge, no chevron, no CLI id badge; remaining chrome is `completed`, resume play button, elapsed, usage row, collapsed Task, output. Header/usage/output boxes start at x=380 in a lane view starting at x=368 (12 px = px-3) at 1440; 348 vs 336 at 760; 132 vs 120 at 400. This fixes session 1's flush-to-edge gutter finding. The profile has no subagent (non-CLI) lane tab, so the flat subagent variant could not be opened. |
| 18 Bottom shadow under the dock; hover card and menu paint over lane | PASS | `dock-shadow-clip-1440-{dark,light}.png`, `lane-view-*.png`, `dock-hovercard-1440-{dark,light}.png`, `dock-menu-1440-{dark,light}.png` | Lane tabs row computes `box-shadow: rgba(0,0,0,0.45) 0 6px 8px -6px`, `z-index:10` in both themes and at all widths. Pixel sample below the row: dark bg (19,19,23) goes to (16,16,19) = darker, not a pale haze; light bg (250,247,245) goes to (210,207,206), clearly visible. Hover card (`z-index:50`, fixed) at 1440: 9 of 9 sample points hit the card, it overlaps the lane header area. Dock menu (`role=menu`): 9 of 9 sample points hit the menu, it overlaps the lane view. Both readable in dark and light. See Minor 1 for the dark shadow's subtlety. |
| 19 Assistant left padding aligns with composer at 1440; narrow unchanged | PASS | `chat-turn-{1440,760,400}-{dark,light}.png`, `chat-turn-wide-{1700,1920}-{dark,light}.png` | At 1440 the transcript container is 686 px (inspector docked), under the rule's 704 px threshold, so padding is 0 and the response text starts at x=376 against the composer card edge at x=380 (4 px). The new rule is active from 704 px: at 1700 padding is 87 px (text x=463, card edge x=467) and at 1920 177 px (text x=553, card x=557), tracking the 758 px card with a constant 4 px offset. At 760 and 400 the turn padding is 0 px (container 314 / 278 px), so the narrow layout is unchanged from after-11-17; the composer card stays centred (`max-w-[758px] mx-auto`). |
| Narrow panes (400) otherwise unchanged | PASS | `focus-header-400-*`, `lane-view-400-*`, `compact-400-*`, `inspector-agents-400-*` | Diffs against after-11-17 are limited to the intended items (icon buttons, shadow, lane gutter, content timestamps). Page-level horizontal overflow at 400 is still present (`scrollWidth` 723 vs `innerWidth` 400 in the lane view); pre-existing, documented in `visual-before-11-17.md`, not part of this change. |

## Findings

### Blocking
None.

### Serious
1. Pre-existing, not introduced: low contrast of the lane usage row in the light theme (`cli-lane-usage-summary`, 10 px mono). Measured against the page background (250,247,245): `out ≥ 56` 1.74:1, cost/dash 2.32:1, `in ≥ 11.9k` 3.44:1, all below the 4.5:1 WCAG AA text criterion. Dark theme passes (5.1 to 8.5:1). Screenshot `lane-view-1440-light.png`. The colours come from unchanged classes; the flat presentation now sits on the page background instead of `bg-base-200/50`, which does not rescue them. Not a regression, recommend a follow-up task.

### Moderate
1. Pre-existing and unchanged from after-11-17: at 760 the details opener in the pane-side strip is still a circled Unicode `i` glyph, not a lucide icon button like the header's 400 px Details (PanelRight). `focus-header-760-{dark,light}.png`.
2. Pre-existing: at 400 the page overflows horizontally (723 px document), so the top nav and `New Session` are clipped in every 400 shot, including the lane view and compact card. Outside this change.

### Minor
1. Dark-theme dock shadow is the right colour and direction but only about 3 of 255 levels darker than the background (19 to 16), so it is barely perceptible on this near-black surface; the light-theme shadow is clear (40 levels). Within spec ("dark, not pale"), could be strengthened if a visible edge is wanted. `dock-shadow-clip-1440-dark.png`.
2. Item 19 alignment is 4 px short of the composer card border (text x=463 vs card x=467 at 1700) and 19 px short of the composer text (textarea text at 482). It is consistent at every width and reads as aligned to the card edge; the CSS comment says "inner border". Cosmetic.
3. At 760 the dock hover card stayed visible after a pointer-away on the first pass (`role=tooltip` count 1) and cleared on the retake; a pre-existing behaviour noted in session 1 (the card covers the lane header while the lane tab keeps focus). Final 760 lane shots were retaken with the card dismissed.

## Coverage gaps
- Flat subagent (non-CLI) lane thread: no such lane exists in the profile.
- Cost badge in the AGENTS row: shown with a synthetic injected element only.
- Items were captured only on the restored S4 session (done lanes); no running/steer state was driven.

## Cleanup
Electron PID 684 and its 7 child processes were stopped with `taskkill /PID 684 /T /F`. `Get-Process electron` returns nothing and port 9351 has only TIME_WAIT entries. Electron closed: yes.
