# Visual review - canvas-render-followups (before vs after)

## Verdict: PASS WITH NOTES

No functional regressions. The notes are listed below. A second pass after the pause-selector fix and the message-bubble revert is in "Re-check after fixes" at the end of this file; it supersedes notes 1 and 3.

## Builds and method
- BEFORE: canvas-tile-leaks at HEAD 5c329bbea (PR #645 baseline), in `visual/before/`.
- AFTER: canvas-render-followups worktree, built with no patch (`nx build-dev` and `copy-renderer-dev` both exited 0), in `visual/after/`.
- The same two scripts ran on both builds (`tmp/visual-capture/capture.spec.ts` and `followups.spec.ts`), plus one extra probe (`probe.spec.ts`, outputs in `visual/before-probe/` and `visual/after-probe/`).
  - The probe runs WITHOUT the animation freeze, so it can read `animation-play-state`, scroll an unfocused tile, and check pin-to-bottom while streaming.
- Pixel diff: per-channel tolerance of 12/255, over 260 pairs; 150 are identical. Diff images (before | diff | after) are in `visual/diff/`. `diff/summary.json` has the numbers.
- Noise: live scenarios (fa, fe, ff) use the wall clock for "Claude 11:36 PM" timestamps, random "thinking" phrases and the streaming cursor. Two identical after runs differ by 0.1 to 0.6% on those tiles. The sidebar timestamp, agent elapsed time and the right-hand rail hover are also noisy (they were in the previous review). In the table below, "noise" means within that band.

## Results against expected changes

| Expected change | Result | Evidence |
|---|---|---|
| Tool rows: 2 fewer elements per row, pixel-identical | Elements: PASS. Pixels: PASS at 1440x900, NOTE at 900x800 | Per-row `querySelectorAll('*')`: 28,28,28,28,21,21,29 changes to 26,26,26,26,19,19,27 in all 4 combos (tile total 858 to 658, or 736 to 658). Row heights are all 43px and unchanged. fd-toolrows-tile is identical at 1440 (both themes). At 900x800 the row content (icons, badge text, path text) sits 1px lower: 1.05% (dark) and 1.11% (light) of the tile, see `diff/_toolrow-zoom-dark-900.png`. Row boxes and heights are the same. |
| Assistant footer: 1 fewer wrapper, layout identical | PASS WITH NOTE | Tile heights are identical and footers line up. See note 3 about the copy icon. |
| Tab order identical | PASS | `fc-taborder-*.json`: all 17 stops identical (tag, aria-label, host, outline) in both directions, in all 4 combos. One run (dark 900, 2 Branch stops) showed `parentOpacity` 1 instead of 0. A repeat run matched the before run exactly, so this is a hover flake. |
| Inline agent bubble textarea heights (34/32/68/70) | CHANGED as intended: now 34/34/70/70 | `fe-reply-geometry`: empty 34 and 8-line cap 70 unchanged. 1 line goes from 32 to 34 and 3 lines from 68 to 70. This is the same in all 4 combos. The 1-line height now equals the empty height, so the box no longer shrinks 2px on the first keystroke, and the cap is unchanged. |
| Unfocused tile: spinners and pulses paused | PASS | Probe, dark 1440, unfocused agents tile: 8 of 9 animated elements paused (all `animate-spin` and `animate-pulse`). 1 element, a `motion-safe:animate-pulse`, still runs (note 1). The focused tile is unchanged: 3 of 3 running. After the focus swap, the previously focused tile pauses 3 of 3 and the newly focused tile resumes 9 of 9. Before the change nothing was paused. |
| Unfocused tile mounts fewer bubbles | PASS WITH NOTE | See "Scroll" below. |
| Scroll handlers outside the Angular zone, pin to bottom still works | PASS | Probe, dark 1440: while streaming 12 deltas, the distance from bottom stayed 0 before and after, for both the unfocused long tile and the focused agents tile. Scrolled up 800px and streaming more text, `scrollTop` stayed at 10629 (no jump). Same as the before build. |

## Look of a running row in an unfocused tile
Spinners (Grep "Searching for ...", "Streaming" badge, "Starting agent execution") render as static partial arcs. The status dots, badges and text are unchanged, the row layout is identical, and there is no flicker. Compare `after-probe/p-agents-unfocused-*` (static arcs) with `p-agents-focused-*` (spinning). The only visible change is that motion stops.

## Scroll (fast scroll and unfocused tile)
`fb-scroll-*.json` (focused long tile) are **identical** in all 4 combos: scrollTop and scrollHeight match at top, middle, bottom, fast-immediate, fast-settled and jump-bottom. The fb screenshots match the before build, so there are no jumps or placeholder gaps in the focused tile.

Probe (unfocused long tile, dark 1440, before and after):

| Stop | scrollHeight | mounted bubbles |
|---|---|---|
| top | 10833, now 10557 | 22, now 14 |
| fast-settled | 11883, now 11717 | 35, now 18 |
| middle | 11883, same | 35, now 18 |
| bottom | 11883, same | 14, now 6 |

- Fewer bubbles are mounted in the unfocused tile (about half), as intended. `scrollHeight` is up to 2.5% smaller before the list has been scrolled (the unmounted rows use estimated heights), and it converges to the same value at the middle and bottom.
- Because of that, the same scroll fraction lands about 100px apart (3987 vs 3887 at fast-settled).
- No placeholder gaps, blank areas or jumps appear in the shots (`diff/_probe-p-unfocused-*`). The collapsed one-line message summaries in the unfocused tile are present in both builds.
- The light 900x800 probe's focus switch did not take effect (the long tile stayed focused), so its unfocused-tile numbers there are not valid. The animation and scroll checks are based on dark 1440.

## All scenarios
Diff % (range over dark and light, 1440 and 900). "id" = identical.

| Scenario | Result |
|---|---|
| 00 empty canvas, 01 grid/code/table, 06 single tile, 07 many-column table, 08 route switch, 03 input, 04 overlays, 99 final | id (all 4 combos) |
| 02 message hover | 0 to 0.25%: noise (message timestamp) |
| 05 agent monitor tile / card | 0.04 to 0.06%: noise (elapsed time) |
| 05 agent monitor window | 0.24 to 0.34%: noise (right-hand rail hover) |
| fa running rows, two tiles | 0.014 to 0.15%: noise (live timestamp); the copy icon is described in note 3 |
| fb scroll (6 shots) | id, except fb-scroll-bottom dark 1440 at 0.0003% (2 px) |
| fc hover assistant / user | 1440 id or noise; 900 about 1.05 to 1.11% is the 1px content shift in the tool rows below the message (same cause as fd) |
| fc focus stops (back/fwd) | 0.05 to 4.6%. The tile scrolls 1px differently when focus lands on a button (e.g. back10, back13 at 1440), so the whole view moves by a pixel. Tab order and the focus ring itself are unchanged. |
| fd tool rows (tile) | 1440 id; 900 1.05 to 1.11% (1px content shift, note 2) |
| fd tool rows (window) | 0.2 to 0.7%, same cause |
| fe reply textarea (empty, 1 line, 3 lines, 8 lines, scrolled) | 0.06 to 3.6%. This is the 2px taller box (1 line and 3 lines), the content below shifting 2px, and live timestamp noise. 8-line cases only differ by the content shift. |
| ff focus switch (agents tile) | 2.5 to 3.8% (same cause as fe: the reply box is open in that tile and now 2px taller, plus live text) |
| ff focus switch (long tile) | 0.1 to 0.6%: 1px content shift and noise |

Focus state is identical to before in all 4 combos: the focused tile has `data-focused="true"` and the `ring-primary` ring, and the other tile has neither.

## Notes for the developer
1. **One animation still runs in an unfocused tile**: a `motion-safe:animate-pulse` element in the agents tile is not paused (1 of 9 animated elements). Paused: 8 of 9. It may be the streaming-cursor or avatar pulse; check that it is covered by the same rule.
2. **Tool-row content sits 1px lower at 900x800** (both themes). Row height is the same 43px. It is not pixel-identical there, though 1440 is. Cause is probably sub-pixel centering after the 2 wrapper removals.
3. **Copy icon in the streaming footer of the unfocused agents tile**: in the frozen-transition capture the icon (left of "Let me think about this") shows in the before build but not in the after build, in dark 900 and light 900 and 1440. In the probe (transitions on) neither build shows it at rest. The change to the footer (`message-bubble.component.html`) swaps `hover:opacity-100` for `focus-within:opacity-100`. This is probably a hover-reveal state, so it is low risk, but please confirm the icon still appears on hover of the streaming message.
4. Reply textarea 1-line and 3-line heights increased by 2px (intended, see the table).
5. `scrollHeight` of the unfocused tile before it has been scrolled is up to 2.5% smaller than before (fewer mounted bubbles). It converges after scrolling, so the scrollbar thumb may shift slightly.

## Caveats
- Everything is mocked RPC in Electron (grid layout only), as before. Multi-workspace hiding was not exercised.
- Animation play-state and scroll-pin results come from `probe.spec.ts` (dark 1440 valid, light 900 focus switch invalid, see above).

## Re-check after fixes (rebuilt after build, `visual/after2/`, `visual/after2-probe/`)
After the pause CSS used `[class*='animate-spin']` / `[class*='animate-pulse']` and `message-bubble.component.html` was reverted, I rebuilt (both nx targets exited 0) and re-captured the full follow-up set (`followups.spec.ts`, 4 combos) plus the probe.

**Note 1 (pulse still running): fixed.** Probe, unfocused agents tile: 9 of 9 animated elements are `paused`, including `motion-safe:animate-pulse` (it was 8 of 9). The focused tile still runs 3 of 3 (dark 1440) and the tile that becomes unfocused after a focus swap pauses 3 of 3. This is the same in light 900x800 (9 of 9 paused; the focus swap in that probe still did not take effect, so only the first half of the check is valid there). Pin-to-bottom while streaming is unchanged: distance from bottom is 0 before and after for both tiles, and `scrollTop` stays 10629 when scrolled up (dark 1440).

**Note 3 (copy icon): not caused by the footer markup, still open.**
- With the wrapper restored, the frozen-transition capture of the unfocused agents tile at 900x800 (`fa-tile-agents-*`, dark and light) still lacks the dim copy icon that the before build shows left of "Let me think about this" (`diff/_copyicon-dark900-before_after_after2.png`). Diff is 0.13 to 0.15% (the icon and the live timestamp).
- Hover works in both builds. `fc-hover-assistant` has no diff in the footer area (the only diff region is the tool-row text, note 2), so the copy button is revealed on hover as before.
- In the unfrozen probe neither build shows the icon at rest. So the difference is only in the harness state at capture time (icon visible without hover in "before"). I could not find the cause; it is hover-reveal UI, so low risk. If it matters, check whether the old behaviour was a hover leak.

**Note 2 (tool rows 1px lower at 900x800): not caused by the separator or by `tool-call-header`.** I measured the first tool row (`tool-call-item`) in both builds at 900x800 and 1440x900 with `getBoundingClientRect` and `getComputedStyle` (data in `visual/sep-before/` and `visual/sep-after/`).
- **(a) Separator is identical.** Item height is 42.5px in both. The separator box is at 38.5px from the item top, 4px tall, `display:flex; align-items:center; gap:8px; margin:6px 0` in both. The dot is at 38.5px, 4x4. The two lines are `::before`/`::after` with `content:""; display:block; height:1px; border-top:1px solid; flex:1 1 0%`, widths 100.406/100.422px at 900 (352.562/352.578px at 1440), the same as the former `div.flex-1.border-t` children, whose top was 40px (38.5 + (4-1)/2 = 40). The only differences are that the lines are pseudo-elements and the DOM has 2 fewer elements.
- **(b) Header is identical.** All 23 descendants of the header (button, icons, badge, path link, check icon, SVG paths) have the same top, height, left and width in both builds, and the same `line-height`/`align-items`.
- **Actual cause: fractional vertical offset of the whole row from the transcript above it.** In a 12-turn transcript at 900x800, the first tool row's offset from the scroll content top is 4002.438 (before) vs 3836.688 (after). The row's position inside its container is identical, so content paints on a different .25px phase and the glyphs/icons rasterise 1px lower. The offset differs because the after build mounts fewer bubbles in the transcript window (6 vs 11 in that sample, `scrollHeight` 4208 vs 4042), so the estimated heights of unmounted rows add a non-integer amount (.75px here). That change is in `transcript-render-window.ts`/`chat-transcript.component.ts`, not in the tool-row components. At 1440x900 the phase happens to match, so the rows are identical there.
- I did not force the same phase in both builds to prove it; the evidence is the identical row-internal geometry and the differing fractional offset.

**Re-checked scenarios** (after2 vs before): `fa-*` 0.014 to 0.15% (live timestamp, plus the icon at 900); `fc-hover-*` and `fd-toolrows-tile` at 1440 are identical, and at 900 they show the same 1.05 to 1.11% row-content shift as before; `fd-toolrows-window` 0.65 to 0.68% at 900 (same shift). Verdict stays PASS WITH NOTES.
