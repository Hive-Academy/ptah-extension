# Visual Review R10 Re-check - TASK_2026_494_ca38 (Apps page)

Targeted re-check of the R10 visual-fix round only. Scope: the four checks
listed in the brief. Does not re-run the full original R10 review or its
prototype-fidelity pass; see `visual-review.md` for that.

## Summary

| Metric            | Value                                                   |
| ------------------ | -------------------------------------------------------- |
| Verdict            | **NEEDS_REVISION** (see Check 3)                          |
| Check 1 (560-620 band) | PASS                                                  |
| Check 2 (605<->606 boundary settle x5) | PASS                                  |
| Check 3 (stat tile contrast, dark+light) | **FAIL** (light theme)              |
| Check 4 (splitter a11y, wide vs stacked) | PASS                                 |
| Viewports tested   | Container widths 560, 590, 604, 605, 606, 607, 620 (outer 624-684, sidebar collapsed); 1440x900 |
| Screenshots taken  | 15                                                        |

## Environment

- Worktree: `D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772` (branch `feat/task-494-apps-page`), uncommitted changes present.
- Build verified: `dist/apps/ptah-extension-webview/browser` (timestamp 2026-09-26 02:39:53) postdates both changed source files under review — `libs/frontend/mcp-apps-page/src/lib/components/apps-page.component.ts` (02:33:02) and `libs/frontend/declarative-dashboard/src/lib/components/dashboard-stat.component.ts` (02:34:05). No rebuild was needed; confirmed by direct `ls -la --time-style=full-iso` comparison, not inferred.
- Base URL: local static server serving that build directory, started by `.ptah/specs/TASK_2026_494_ca38/visual/apps-visual-r10-recheck.e2e.spec.ts` (new file, added under the task folder per the brief; reuses `installCspStub` from `libs/frontend/webview-e2e-harness` by relative import — nothing added under `libs/`). Same Electron-host / RPC-stub approach as the original `apps-visual.e2e.spec.ts`; did not modify that file or its screenshots.
- **Runner note**: this worktree's own `node_modules` is a sparse, partially-junctioned tree (5 native/binary packages only — `better-sqlite3`, `daisyui`, `electron`, `monaco-editor`, `prismjs`; no `@playwright/test`, no `.bin`). Per the brief's "do not create node_modules junctions" instruction, none were created. Instead the test was invoked with the *main checkout's* installed Playwright binary (`/d/projects/ptah-extension/node_modules/.bin/playwright`, v1.63.0) and `NODE_PATH=/d/projects/ptah-extension/node_modules`, with cwd inside the worktree's `visual/` folder and `--config=playwright.config.ts` pointing at the worktree's own config. This resolves `@playwright/test` and other deps from the main checkout while every file read (spec, config, build, harness import) still comes from the worktree — no writes outside the worktree, no junctions created. Confirmed working: the run correctly picked up the worktree's uncommitted `apps-page.component.ts`/`dashboard-stat.component.ts` (the container-query breakpoint and compact tiles below are exactly what those files define).
- Themes: `anubis` (dark) and `anubis-light` (forced via `data-theme`, same as the original script).
- **Container-width calibration**: the Electron shell's Workspaces sidebar leaves a fixed ~64px offset between the outer viewport (`page.setViewportSize`) and the `.apps-page` container's own inline size, even collapsed (measured directly: outer 900px -> container 836px). All "container width" figures below are the *measured* `.apps-page` width, not the outer viewport; the outer viewport used to hit each target is recorded alongside it so the mapping is auditable.

## Check 1 — 560-620px container-width band

Target container widths 560, 590, 604, 605, 606, 607, 620, hit via outer viewports 624, 654, 668, 669, 670, 671, 684 (sidebar collapsed, offset 64px measured this run).

| Container width | Outer viewport | Layout | Grid template | Surface width | Splitter visible | Screenshot |
| --- | --- | --- | --- | --- | --- | --- |
| 560 | 624 | Stacked | `560px` | n/a (single column) | No | `band-container560-outer624-dark.png` |
| 590 | 654 | Stacked | `590px` | n/a | No | `band-container590-outer654-dark.png` |
| 604 | 668 | Stacked | `604px` | n/a | No | `band-container604-outer668-dark.png` |
| 605 | 669 | Stacked | `605px` | n/a | No | `band-container605-outer669-dark.png` |
| 606 | 670 | Side-by-side | `240px 6px 360px` | **360px** | Yes | `band-container606-outer670-dark.png` |
| 607 | 671 | Side-by-side | `241px 6px 360px` | **360px** | Yes | `band-container607-outer671-dark.png` |
| 620 | 684 | Side-by-side | `254px 6px 360px` | **360px** | Yes | `band-container620-outer684-dark.png` |

Result: **PASS**. Stacks below 606, side-by-side at and above 606 (as the component's own comment states: `APPS_STACK_BELOW_WIDTH = 240 + 6 + 360 = 606`). At every side-by-side width the surface panel measures exactly 360px (clamped to its floor, `splitMaxWidth` giving the conversation column the remainder) — never clipped below 360px, matching the class-doc contract. No torn frame observed (grid columns and splitter-visibility always agree at every width sampled). Screenshots `band-container605-outer669-dark.png` (stacked) and `band-container606-outer670-dark.png` (side-by-side, surface panel intact, no cut-off content) confirm this visually.

This directly resolves original finding **#2** (surface panel dropping to 250-310px below 606px) — the band no longer exists because the stacking threshold moved to exactly the width where both minimums fit.

## Check 2 — Boundary settle, container 605<->606 x5

Outer viewports 669 (-> container 605) and 670 (-> container 606), alternated 5 times, each followed by an 80ms settle wait before measuring.

| Pass | Width | containerWidth | gridTemplateColumns | splitterInDom | splitterDisplay |
| --- | --- | --- | --- | --- | --- |
| 1 | 669 | 605 | `605px` | true | none |
| 1 | 670 | 606 | `240px 6px 360px` | true | flex |
| 2 | 669 | 605 | `605px` | true | none |
| 2 | 670 | 606 | `240px 6px 360px` | true | flex |
| 3 | 669 | 605 | `605px` | true | none |
| 3 | 670 | 606 | `240px 6px 360px` | true | flex |
| 4 | 669 | 605 | `605px` | true | none |
| 4 | 670 | 606 | `240px 6px 360px` | true | flex |
| 5 | 669 | 605 | `605px` | true | none |
| 5 | 670 | 606 | `240px 6px 360px` | true | flex |

Result: **PASS**. All 10 measurements (5 passes x 2 widths) are byte-identical to their own width's expected state; grid template and `splitterDisplay` always agree (one-track grid + `display:none` slot when stacked, three-track grid + `display:flex` slot when side-by-side). No torn frame (no case of a hidden splitter with a still-three-track grid, or a visible splitter with a one-track grid) across any of the 10 transitions. Screenshots `boundary-605-final-dark.png` and `boundary-606-final-dark.png` show the settled end state after the fifth pass.

This resolves original finding **#3** (intermittent splitter/stacking mismatch): the class doc's stated fix — making the CSS `@container` query the single stacking decision, with the splitter staying in the DOM and only CSS-hidden — removes the async `ResizeObserver`-vs-synchronous-CSS race that produced the earlier torn frame. `AppsPageComponent`'s `stacked()` signal from the old code no longer exists in the current source (`apps-page.component.ts`); the container query is now the only mechanism, matching the fix description.

## Check 3 — Stat tiles, dark and light theme

Screenshots: `stat-tiles-dark-1440.png`, `stat-tiles-light-1440.png` (1440x900), `stat-tiles-band-container620-dark.png` and `stat-tiles-band-container590-dark.png` (container-width band, dark).

**Layout**: PASS. Four compact bordered tiles (`DEPLOYS THIS WEEK` / `COST` / `INCIDENTS` / `UPTIME`) render several across at 1440px (measured rects: x = 414, 578, 743, 907, each ~156px wide, ~56px tall — a real grid row, not stacked blocks). At the 606-620px band the same tiles wrap to 2-across (surface panel is only 360px there; `minmax(9rem,1fr)` auto-fill genuinely cannot fit 3+ at that width — this is arithmetic, not a regression). Delta is inline in the tile header (`Δ +5`, `Δ -3`, `Δ 0`) next to the label, not a separate line. This matches the fix description and resolves original finding **#5** (stat tile density) as a *layout* matter.

**Contrast — measured via the same canvas/oklch-safe method the original review used** (`ctx.fillStyle` round-trip, since the theme resolves `oklch(...)`, not `rgb(...)`):

| Theme | Element | Foreground | Background | Ratio | WCAG AA (4.5:1 normal text) |
| --- | --- | --- | --- | --- | --- |
| Dark (anubis) | Label (`h3`, "DEPLOYS THIS WEEK" etc.) | `oklch(0.630 0.007 23.4)` | `oklch(0.220 0.012 285.4)` | **4.97** | Pass |
| Dark (anubis) | Delta (`Δ +5` etc., shares the label's `text-base-content-muted` class) | same as label | same as label | **4.97** | Pass |
| Dark (anubis) | Value (`42 deploys`, `.text-primary`) | `oklch(0.546 0.215 262.9)` | `oklch(0.220 0.012 285.4)` | **3.35** | **Fail** (needs 4.5:1; the text is `text-sm` ≈14px, below the 18.66px/14pt-bold large-text threshold even with `font-semibold`, so the 3:1 large-text/UI-component allowance does not apply) |
| Light (anubis-light) | Label | `oklch(0.533 0.041 354.5)` | `oklch(0.940 0.007 61.4)` | **4.48** | Fail, marginally (0.02 short of 4.5:1) |
| Light (anubis-light) | Delta | same as label | same as label | **4.48** | Fail, marginally |
| Light (anubis-light) | Value (`.text-primary`) | `oklch(0.850 0.138 181.1)` | `oklch(0.940 0.007 61.4)` | **1.25** | **Fail, severely** |

`stat-tiles-light-1440.png` confirms this visually: the stat values ("42 deploys", "128.42 USD", "1 incidents", "99.95 %") render in a pale mint/teal that is close to indistinguishable from the cream page background — a genuine readability failure, not just a borderline number. `stat-tiles-dark-1440.png` by contrast shows the same values in a clearly legible bright blue, even though its own measured ratio (3.35) is also under the 4.5:1 normal-text minimum.

**This is a new/worsened finding relative to the original review**, which did not measure stat-tile text contrast (its Accessibility audit only measured "Sent" status text). It sits inside the scope of Check 3 ("readable contrast for label/value/delta") as given in this brief, so it is reported as part of this targeted re-check rather than deferred.

- Severity: **Serious** (dark theme, value text 3.35:1 — a real but readable-in-practice shortfall) escalating to **Visual breaking** for the light theme (value text 1.25:1 — the primary content of every stat tile is not reliably legible against its own background in the light theme).
- File: `libs/frontend/declarative-dashboard/src/lib/components/dashboard-stat.component.ts:30` (`<p ... class="... text-primary" data-testid="stat-value">`) — the stat value's color class is `text-primary` unconditionally; the theme's `--p` (primary) token evidently resolves too close to its own `--b1`/`--b2` background lightness in `anubis-light` for this component's chosen background layer.
- Fix: the stat-value text color should use a token with a guaranteed-contrast pairing against the tile's own background (e.g. `text-base-content` with an accent only on the icon/delta, or a `text-primary-content`-style paired token if the design system has one for a `bg-primary`-adjacent surface), verified numerically post-fix rather than by eye, in both themes.

## Check 4 — Splitter accessibility snapshot

**At >=606px** (outer 684 -> container 620), `layout.ariaSnapshot()`:
```
- region "Apps": ...
- separator "Resize the conversation column"
- heading "Weekly Deploy Cost" [level=2]
...
```
Exactly **one** `separator` node in the whole page's accessibility tree (`(snapshot.match(/separator/gi) ?? []).length === 1`). Direct attribute read on `[role="separator"][data-testid="apps-split-handle-slot"]`: `aria-valuenow="254"`, `aria-valuemin="240"`, `aria-valuemax="254"`, `tabindex="0"`. `.focus()` succeeded and `document.activeElement` resolved to the slot (`data-testid="apps-split-handle-slot"`) — focusable, confirmed by actual focus state, not just the attribute. Screenshot: `splitter-a11y-wide-620-dark.png`.

**At <606px** (outer 664 -> container 600), the same `ariaSnapshot()` contains **zero** occurrences of "separator" anywhere in the tree. Direct DOM probe: the slot is still present (`exists: true`) with `display: none` and `tabindex="0"` still in markup (matching the class doc: "the splitter stays in the DOM and CSS hides it"), but tabbing six times from the composer never landed focus inside it (`landedInHiddenSlot: false`) — `display:none` removes it from both the accessibility tree and the tab order, as expected. Screenshot: `splitter-a11y-narrow-600-dark.png`.

Result: **PASS**. This resolves original finding **#4** (nested `role="separator"`): the inner `<ptah-electron-resize-handle>` now carries `aria-hidden="true"` (`apps-page.component.ts:277`), confirmed by its absence from the accessibility-tree text at >=606px — only one `separator` mention total, not two. The hidden-slot behavior below 606px (no separator exposed, nothing focusable) is also new and correct: a screen-reader or keyboard user below the stacking threshold is not offered a control for a splitter that no longer does anything.

## Regressions vs. the original visual-review findings

| Original finding | Status after R10 fix |
| --- | --- |
| #2 (surface panel 250-310px below 606px, under the 360px floor) | **Resolved.** Confirmed by Check 1: surface panel is exactly 360px at every side-by-side width in the 606-620 band, never clipped. |
| #3 (intermittent splitter/stacking torn frame near the old 480px boundary) | **Resolved.** Confirmed by Check 2: 10/10 measurements across 5 boundary passes agree; the async/sync race the finding described no longer exists in the current `apps-page.component.ts` (the `stacked()`/`ResizeObserver` signal is gone; CSS `@container` is the sole decision). |
| #4 (nested, unlabeled `role="separator"` reachable by screen readers) | **Resolved.** Confirmed by Check 4: exactly one separator in the a11y tree at >=606px; the inner handle is `aria-hidden`. |
| #5 (stat tile density/delta phrasing deviating from the prototype) | **Resolved as layout.** Tiles are now compact, bordered, several-across, with an inline `Δ` delta — matching the prototype's described pattern. **New contrast issue introduced/exposed** (see Check 3): the stat value text (`text-primary`) fails WCAG AA 4.5:1 in both themes, severely so in light theme (1.25:1) — not part of the original finding #5's density/phrasing scope, but found while checking the same component per this brief's Check 3.

No regression was found in findings #2, #3, or #4 — all three are solidly fixed with reproducible, non-flaky evidence (Check 2 in particular directly targeted the flakiness class of the original #3 and found none in 10 samples). The one new issue (stat-value contrast) was not present in the original review's scope (it never measured stat-tile contrast) and is reported here as in-scope for this recheck's Check 3.

## Verdict

- Recommendation: **NEEDS_REVISION**
- Confidence: HIGH for Checks 1, 2 and 4 (deterministic, reproduced across 5-10 samples each, with direct DOM/attribute/focus evidence, not screenshot inference alone). HIGH for Check 3's measurement (canvas-based oklch-safe contrast conversion, same method the original review validated; cross-checked against the screenshot, which shows the light-theme value text visually near-invisible).
- Key concern (superseded by the addendum below): the three items this recheck was scoped to re-verify (581-605 band, boundary settle, nested separator) are all cleanly fixed with no flakiness. The blocker was a **new** contrast failure surfaced while checking the stat tiles per this brief's Check 3: `text-primary` stat-value text measured 1.25:1 against its own tile background in the light theme (`dashboard-stat.component.ts:30`), and 3.35:1 in dark theme — both under WCAG AA's 4.5:1 normal-text minimum, with light theme visually confirmed near-unreadable in `stat-tiles-light-1440.png`. **This has since been fixed and re-verified — see the addendum.**

---

## Addendum: Check 3 re-run (after the `text-base-content` fix)

Coordinator applied an uncommitted fix in the worktree: `libs/frontend/declarative-dashboard/src/lib/components/dashboard-stat.component.ts:30` — the stat-value `<p>` now uses `text-base-content` instead of `text-primary`. This addendum re-runs Check 3 only against that fix. No source files were edited by this review, no commits were made, and no `node_modules` junctions were created (same runner approach as before: the main checkout's installed Playwright, invoked with `NODE_PATH` pointed at its `node_modules`, cwd and all file reads/writes inside the worktree).

**Rebuild**: `nx build ptah-extension-webview` (production) was re-run inside the worktree (via the same `NODE_PATH`-borrowed toolchain) so `dist/apps/ptah-extension-webview/browser` picks up the fix — confirmed complete before re-measuring (`Application bundle generation complete`, output written under the worktree's own `dist/`, not the main checkout's).

**New harness file**: `.ptah/specs/TASK_2026_494_ca38/visual/apps-visual-r10-recheck-check3-fix.e2e.spec.ts` (added under the task folder, same fixture-server/Electron-host approach as the other two scripts here; does not modify either prior spec). It also asserts the built bundle's stat-value node no longer carries `text-primary` and does carry `text-base-content` before trusting the contrast numbers (`[sanity] stat-value class list: text-sm font-semibold leading-tight tabular-nums text-base-content`) — i.e. the rebuild is confirmed to have actually picked up the source change, not just assumed.

**New screenshots** (suffix `-fix`, same `visual/screenshots/r10-recheck/` directory):
- `stat-tiles-dark-1440-fix.png`
- `stat-tiles-light-1440-fix.png`
- `stat-tiles-band-container620-dark-fix.png` (container ~620px, several-across layout still holds post-fix)

**Measured contrast** (same canvas/oklch-safe method as before):

| Theme | Element | Foreground | Background | Ratio | WCAG AA (4.5:1 normal text) | Change vs. pre-fix |
| --- | --- | --- | --- | --- | --- | --- |
| Dark (anubis) | Label (`h3`) | `oklch(0.630 0.007 23.4)` | `oklch(0.220 0.012 285.4)` | 4.97 | Pass | Unchanged (not in scope of this fix) |
| Dark (anubis) | Delta (`stat-delta`) | same as label | same as label | 4.97 | Pass | Unchanged |
| Dark (anubis) | **Value** (`stat-value`, now `.text-base-content`) | `oklch(0.925 0.007 88.6)` | `oklch(0.220 0.012 285.4)` | **13.89** | **Pass, with large margin** | Was 3.35 (fail) -> now 13.89 |
| Light (anubis-light) | Label (`h3`) | `oklch(0.533 0.041 354.5)` | `oklch(0.940 0.007 61.4)` | 4.48 | Fail, marginally (0.02 short) | Unchanged — pre-existing, not touched by this fix, not in this addendum's scope |
| Light (anubis-light) | Delta (`stat-delta`) | same as label | same as label | 4.48 | Fail, marginally | Unchanged, same pre-existing gap |
| Light (anubis-light) | **Value** (`stat-value`, now `.text-base-content`) | `oklch(0.236 0.066 313.2)` | `oklch(0.940 0.007 61.4)` | **14.21** | **Pass, with large margin** | Was 1.25 (severe fail) -> now 14.21 |

`stat-tiles-dark-1440-fix.png` and `stat-tiles-light-1440-fix.png` confirm this visually: stat values ("42 deploys", "128.42 USD", "1 incidents", "99.95 %") now render near-black on the light background and near-white on the dark background — clearly legible in both themes, a stark contrast to the pale, near-invisible light-theme text in the pre-fix `stat-tiles-light-1440.png`. `stat-tiles-band-container620-dark-fix.png` confirms the several-across layout at the 606-620px band (Check 1's scope) is unaffected by this color-only change.

**Residual, out-of-scope observation**: the stat label and delta text (`text-base-content-muted`) still measure 4.48:1 in light theme — 0.02 under the 4.5:1 AA threshold, unchanged by this fix (it only touched the value text's class) and already present, unflagged as a blocker, in the original `visual-review.md`. Noting it here for completeness only; it was not part of the coordinator's fix and is not re-opened as a new finding by this addendum — it is a pre-existing, marginal gap the coordinator can choose to fold into the same follow-up or track separately.

### Updated overall verdict

- Recommendation: **APPROVED**
- Confidence: HIGH — the fix directly targets the failing selector, the rebuild was confirmed to include it (class-list sanity check), and the re-measured ratios (13.89 dark, 14.21 light) clear the 4.5:1 bar with wide margin, corroborated by screenshot.
- All four original recheck items now pass: Check 1 (560-620px band) PASS, Check 2 (605<->606 boundary settle x5) PASS, Check 3 (stat tile contrast) **PASS** (was FAIL, now fixed and re-verified), Check 4 (splitter a11y) PASS. No regression was found in original findings #2, #3, #4, and #5 is now fully resolved (both the layout/density aspect and the contrast issue surfaced during this recheck).
- Residual note (not a blocker): the pre-existing 4.48:1 label/delta ratio in light theme, 0.02 under AA, is unchanged by this fix and was not in this addendum's scope — worth a follow-up ticket if the coordinator wants a hard AA pass on every stat-tile text element, but it predates this fix round and was not flagged as blocking in the original review either.
