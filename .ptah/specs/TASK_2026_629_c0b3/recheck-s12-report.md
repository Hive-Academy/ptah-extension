# Re-check (session 12) — automated Electron post-change check

Build under test: dev Electron app from HEAD `b648b6e57` (launched by the orchestrator, CDP 9333, video on).
Workspace: `D:\projects\ptah-final-run-ws` (3 Rail cards S2, S4, "can you generate html stats…", all `done`; no running,
needs-you, error or idle card, no live agent). Viewport 1920x983. Themes `anubis` (dark) and `anubis-light`.
Read-only: no code, git, build or paid agent run. Colours were measured in the running app (computed styles resolved
through a 1x1 canvas, alpha composited over the real ancestor backgrounds, sRGB gamut-clipped), not from source.
WCAG thresholds: text >= 4.5:1, UI parts >= 3:1. Screenshots: `S` = `W\.ptah\tmp\final-run\shots\`.

## Verdict: FAIL — 5 findings (0 visual-breaking, 3 Serious, 2 Moderate); passing sub-checks: 1, 1b, 2b, 2c, 2e, 2g, 2h, 4b, 4c, 5b

## Result table

| # | Check | Result | Measured numbers | Evidence |
|---|---|---|---|---|
| 1 | `s-heap` (Rail, split off) | PASS | detached `ptah-canvas-lane-view` / `ptah-canvas-detail-transcript` / `chat-msg-slot`: 0 / 0 / 0 (no custom-element hit for `ptah-canvas*`, `ptah-chat*`, `gridstack*`); Grid DOM (`ptah-canvas-tile`, `gridstack-item`, `.grid-stack`): 0; `ptah-chat-view` in the board host 1, `data-canvas-live-views` 1 (<= 1). Total detached nodes 869 (generic divs/spans, 38 `ptah-native-option`, 16 `lucide-angular`, 1 each `ptah-compact-session-*`) | `s-heap` output (TAG=s12), custom heap scan in this report's run |
| 1b | `s-heap` with split on (two panes) | PASS | board host ChatViews 2, live views 2 (<= 2); lane views 2; detached lane-view / detail-transcript / chat-msg-slot 0; Grid DOM 0. Detached total rose 869 -> 1193 (`ptah-native-option` 38 -> 57, `lucide-angular` 16 -> 22) after opening and closing popover menus, outside the named set; recorded, not a fail | split screenshots below |
| 2a | Contrast #10 incl. M5, dark (anubis) | FAIL (F-B) | state inks vs b1 / b2 / b3 / focused surface: idle #6b7280 3.83 / 3.58 / 3.17 / 3.18; run #3b82f6 5.04 / 4.71 / 4.17 / 4.18; need #f97316 6.61 / 6.18 / 5.47 / 5.48; err #ef4444 4.92 / 4.60 / 4.07 / 4.08; done #16a34a 5.62 / 5.25 / 4.65 / 4.66. Pill text is 10 px, so run/err/idle on the new focused surface (4.18 / 4.08 / 3.18) and idle on b2 (3.58) are below 4.5. Live cards (all `done`): unfocused min text 5.25 (pill "done"), focused min text 4.66. Muted text 5.65 on b2, 5.01 on focused. Callout text on the 14% tint 10.3-12.1; callout border (UI) 3.98-5.10 on b2, 2.76 (idle) / 3.51 (run) / 3.54 (err) / 3.90 (done) / 4.52 (need) on focused | numbers from `getComputedStyle` eval; `S\after-s12-rail-anubis.png` |
| 2b | Contrast #10 incl. M5, light (anubis-light) | PASS | inks vs b1 / b2 / b3 / focused: idle #6b6570 5.29 / 4.73 / 4.38 / 4.54; run #2a56c6 6.07 / 5.42 / 5.03 / 5.20; need #8f5200 5.83 / 5.21 / 4.83 / 5.00; err #b4232a 6.12 / 5.47 / 5.07 / 5.25; done #13713a 5.71 / 5.09 / 4.73 / 4.89 (all text >= 4.5 except idle on b3 4.38, not a card surface). Live cards min text 5.09 unfocused, 4.89 focused. Callout border on tint 3.80-4.43 (UI >= 3 pass) | `S\after-s12-rail-anubis-light.png` |
| 2c | Focused Rail card highlight (row 111), dark | PASS | border + inset ring `#2563eb` vs page `#131317` = 3.59:1 (UI >= 3); surface `#222339` vs page 1.21, vs unfocused card 1.13 (tint is a secondary cue only). No size change (card 176 px, `data-canvas-rail-shifts` 0) | `S\after-s12-rail-focused-anubis.png` |
| 2d | Focused Rail card highlight (row 111), light | FAIL (F-A) | ring/border `#44ebd3` (`--p` in light is bright teal) vs page `#faf7f5` = 1.40:1, vs unfocused card bg `#efeae6` = 1.25:1; focused surface `#f0e5d5` vs unfocused card 1.04:1. Highlight is visible but under the 3:1 UI criterion | `S\after-s12-rail-focused-anubis-light.png` |
| 2e | Active split header accent bar + 1/2 marker, dark | PASS | bar `#2563eb` vs header `#131317` 3.59:1 (expected 3.59); active marker numeral `#f8f7f4` on `#2563eb` 4.82:1 (expected 4.82); inactive marker `#989291` on `#1a1a20` 5.65; inactive title 6.05, inactive chips 5.65 / 5.25 (quiet tier works); active title 14.86 | `S\after-s12-split-anubis.png` |
| 2f | Active split header accent bar + 1/2 marker, light | PASS (numbers) / FAIL (F-C, quiet tier) | bar `#004a45` vs header `#faf7f5` 9.53:1 (expected ~9.5); active marker numeral `#44ebd3` on `#004a45` 6.81:1 (expected 6.8); inactive marker `#745665` on `#efeae6` 5.39. But the inactive title and chips are NOT muted in light: title 15.92:1 on both panes, chips 14.21 on both | `S\after-s12-split-swapped-anubis-light.png` |
| 2g | Split divider `base-content-muted` | PASS | 1 px `border-l` between panes (`data-pane-divider="vertical"`), dark `#989291` vs container `#131317` 6.05:1; light `#745665` vs `#faf7f5` 6.04:1 (>= 5) | split screenshots |
| 2h | Card actions trigger (row 110) | PASS | trigger 24x24, top 6 / right 6 px inside the card corner (light 7 px, 1 px render difference); dots `#a8a6a4` on focused surface 6.33:1 (dark default, hover `#e8e6e1` 12.31), `#68576e` 5.31:1 light; menu items text 12.46:1; menu opens and closes with Esc | `S\after-s12-rail-actions-anubis.png`, `...-anubis-light.png` |
| 3 | `s-switch` vs `switch-baseline.md` | FAIL vs target (improved) | see below | `%TEMP%\629-switch-after-s12.json`, `...-after-s12-b.json` |
| 4 | Screenshots | done | see pairs below | `S\after-s12-*.png` |
| 4b | Display dock | PASS | dock header "Displays (0)", one display pill "Turn summary", no Agents tab, no agent badge or running count | `S\after-s12-display-dock-anubis.png` |
| 4c | Swap: markers follow | PASS | before Swap: left S4 marker 1 (inactive), right S2 marker 2 (active). After Swap: left S2 marker 1 (active, now pane 1), right S4 marker 2; `aria-label`s follow ("Left session: S2, active") | `S\after-s12-split-swapped-anubis.png`, `...-anubis-light.png` |
| 5a | Sub-agent tile click opens its lane | NOT VERIFIED live / FAIL on restored (F-E) | no live agent can be started (paid runs forbidden). The only sub-agent (S2 `general-purpose`, "Completed, 5 tools") is a restored one: the tile button is visible after expanding "5 tools", the click opens nothing (tabs stay Orchestrator, codex, Turn summary; no dock). `CanvasDetailService.open` returns false because the monitor has no record for the restored session, so the only feedback is an sr-only live region "This agent is not available yet." | `S\after-s12-subagent-click-anubis.png` |
| 5b | CLI lane row click opens its lane | PASS | card row "codex · done" selects the `codex` lane tab (`aria-selected` true), Orchestrator deselected | `S\after-s12-lane-row-click-anubis.png` |
| 5c | "Workflow launched" chip is static text in Electron | SKIPPED | no "Workflow launched" chip exists in S2, S4 or the third session | text search of all three transcripts |

### Check 3 — `s-switch` numbers (10 Rail swaps, light theme, Full view, 1920x983)

Baseline (before R9, 4 cards, 1600x967) vs this build (3 cards: the baseline had S1 as a fourth card). Run A = cold (first
visit to each card mounts it), run B = immediately after (warm).

| Metric | Baseline median / max | Run A median / max | Run B median / max | Delta (median, run B) |
|---|---|---|---|---|
| Task time | 422 / 514 ms | 391 / 1205 ms | 314 / 576 ms | -108 ms (-26%) |
| Script | 107 / 257 ms | 32 / 920 ms | 35 / 318 ms | -72 ms (-67%) |
| Recalc style | 85 / 128 ms | 69 / 143 ms | 69 / 93 ms | -16 ms |
| Layout | 18 / 40 ms | 26 / 35 ms | 26 / 36 ms | +8 ms |
| Longest long task | 124 / 289 ms | 91 / 966 ms | 80 / 352 ms | -44 ms |
| Elements added under focus area | 7,657 / 16,921 | 10 / 3,156 | 6 / 10 | -7,651 (views retained) |
| Click-to-settle latency | n/a | 46 / 303 ms | 71 / 378 ms | not in baseline |
| Swaps with a long task > 50 ms | 10 / 10 | 8 / 10 | 8 / 10 | -2 |
| CLS (sum) | 0 | 0.0006 | 0 | 0 |
| `data-canvas-rail-shifts` / live views | 0 / 1 | 0 / 1 | 0 / 1 | same |

Reading: the whole-transcript rebuild is gone (nodes added 7.7k -> about 6-10 after the first visit; the three cold swaps
in run A added 2.8k / 3.2k nodes once per card and cost 515 / 966 ms). Median task and script time dropped clearly.
The handoff-6 acceptance target ("no long task > 50 ms on a switch for a typical transcript") is not met: 8 of 10 swaps in
both runs still have a long task of 53-352 ms. Recurring spikes sit on one card (`…18bc95`: script 233-318 ms on 3 of
its swaps in the two runs) and run A had a 594 ms spike on a swap that added 2 nodes (retained view re-attach or a
change-detection pass, not a rebuild). Cause not isolated; no trace was recorded.

## Findings

| ID | Sev | Element | Measured | Probable owner |
|---|---|---|---|---|
| F-A | Serious | Focused Rail card (`ptah-compact-rail-card.rc-focused`) in `anubis-light`: `border-color`/inset ring `oklch(var(--p))` | `#44ebd3` vs page `#faf7f5` 1.40:1 (< 3:1 UI), vs unfocused card 1.25:1; tint 1.04:1. `--p` is bright teal in light; the C-headers split accent switched to `--pc` in light for the same reason (`canvas-focus-header.component.ts:23-24`) | C-card (`compact-rail-card.component.ts` `:host(.rc-focused)`) |
| F-B | Serious | State pill text (10 px, `.rc-pill`, colour `--rail-state-ink`) on the focused 14% primary tint, dark | run 4.18, err 4.08, idle 3.18 (< 4.5 text); idle on plain b2 3.58 (pre-existing M5). Not seen live (workspace has only `done` cards, done is 4.66 pass); computed from the running app's tokens | C-card (focused surface lowers every ink by ~0.5); idle ink itself is the recorded M5 / D13 item |
| F-C | Moderate | Inactive split pane header title `strong.truncate` and meta chips, `anubis-light` | title 15.92:1 and chips 14.21:1, identical to the active pane, so the "quieter inactive header" of row 113 is absent in light. Cause: the global rule `[data-theme='anubis-light'] .truncate { color: oklch(var(--bc)) }` (`apps/ptah-extension-webview/src/styles.css:2071`, specificity 0,2,0) beats `.text-base-content-muted` (0,1,0). Dark works (6.05 / 5.65). Active bar and marker still mark the active pane | C-headers (`canvas-focus-header.component.ts`: needs a rule that wins, e.g. a host-scoped colour or `!` variant) |
| F-D | Serious | Rail switch performance | 8/10 swaps with a long task (53-352 ms; one 594 ms and one 966 ms spike cold), target is none > 50 ms; median improved clearly (see table) | Fix D / Fix H (retained transcript path); needs a trace to localise |
| F-E | Moderate | Sub-agent tile button (`[data-testid=subagent-open]`) for a restored session | click is a silent no-op: no lane tab, no dock, feedback only in an sr-only live region (`canvas-detail-transcript.component.ts:75-78`, `CanvasDetailService.open` returns false at `canvas-detail.service.ts:~55`). Live case unverified | C-dedupe (visible fallback or hide the open affordance when no record exists); live case needs a user or agent run |

Minor observations (not counted): header chip strip in a 616 px split pane clips the AGENTS chip ("AGENT") behind a
horizontal scroller; dock header reads "Displays (0)" while one display pill exists; after clicking a card its black
keyboard focus outline sits outside the primary ring (both themes); detached `ptah-native-option` count grows with
popover use (38 -> 57).

## Before / after pairs (absolute paths)

Before images are the pre-R9 captures (1600x967 viewport, 4 cards, Rail/Grid toggle still present); after images are
1920x983, 3 cards, Grid removed. No earlier capture of the split, the card actions or the display dock exists in
`shots/` (the user's own manual-test screenshots are not in the repo), so those have no before image.

| Subject | Before | After |
|---|---|---|
| Rail board, dark | `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\.ptah\tmp\final-run\shots\before-r9-rail-anubis.png` | `...\shots\after-s12-rail-anubis.png`, `...\shots\after-s12-rail-focused-anubis.png` |
| Rail board, light | `...\shots\before-r9-rail-anubis-light.png` | `...\shots\after-s12-rail-anubis-light.png`, `...\shots\after-s12-rail-focused-anubis-light.png` |
| Card actions inside card (menu open), dark / light | `...\shots\before-r9-rail-anubis.png` (no actions in card) | `...\shots\after-s12-rail-actions-anubis.png`, `...\shots\after-s12-rail-actions-anubis-light.png` |
| Split, two panes (divider, active accent, 1/2) | none | `...\shots\after-s12-split-anubis.png`, `...\shots\after-s12-split-menu-anubis.png` |
| Split after Swap, dark / light | none | `...\shots\after-s12-split-swapped-anubis.png`, `...\shots\after-s12-split-swapped-anubis-light.png` |
| Display dock (Displays only) | none | `...\shots\after-s12-display-dock-anubis.png` |
| Sub-agent click, lane row click | none | `...\shots\after-s12-subagent-click-anubis.png`, `...\shots\after-s12-subagent-overlap-anubis.png` (collapsed "5 tools" group hides the tile; the tile is clickable only after expanding), `...\shots\after-s12-subagent-expanded-anubis.png`, `...\shots\after-s12-lane-row-click-anubis.png` |

## Not done

- Checks that need a live agent or sub-agent, a running/needs-you/error card, or a "Workflow launched" chip: the test
  workspace holds none, and paid runs are forbidden. Contrast for non-`done` states is from the running app's tokens
  only, not from live cards.
- Hover/DaisyUI mix and lane-fade colours were not measured separately (hover border = ink, covered by the ink table).
- 1280 stacked and 1600 overlay dock widths were not re-opened (the run used 1920 only).
- The app was not relaunched and no `stop` file was created.
