# Visual review - canvas-tile-leaks (before vs after)

## Verdict: PASS WITH NOTES

No regression found. Layout, heights, scroll containers, overlays and markdown are unchanged. The only deterministic differences are 1px sub-pixel text-baseline shifts inside the composer textarea, which come from the intended `field-sizing: content` change.

## Builds and method
- BEFORE: `canvas-base` build (origin/main 518caa996 plus the transient `requestCanvasTab(tabId, null)` patch), re-captured as `visual/before-rerun/`. This run added the new scenarios 07 and 08. The original `visual/before/` is kept.
  - `before-rerun/` light-1440x900 shots came out at a wrong 1184x735 window, which is harness flakiness. I re-captured that combo into `before-rerun-light1440/` and merged it. The bad shots are in `before-rerun/_bad-window-1184x735/`.
- AFTER: `canvas-tile-leaks` worktree, built after the orchestrator reverted the markdown/styles.css change and fixed `closed-tab-session-ender` (SessionId). Same transient chat-view patch; it is reverted (`git diff` shows no `requestCanvasTab` change). Output is `visual/after/`.
- Both builds were captured with the same script (`tmp/visual-capture/capture.spec.ts`), 4 combos (dark and light, 1440x900 and 900x800), 31 scenarios each, 124 pairs in total.
- Pixel diff: per-channel tolerance of 12/255 (any larger channel delta counts as different). Percentages are of the full image, or of the tile crop for tile shots.
- Noise floor: base vs base (`diff-base-vs-base/`) is not pixel-stable either. The sidebar timestamp region (278,296)-(403,329) and the agent elapsed-time text (about (708,129)-(780,138)) differ between identical runs, as do some hover shots. All of these are treated as masked noise.
- Result: 63 of 124 pairs are identical. Every remaining difference is in the groups below.
- Diff images (before | diff | after) are in `visual/diff/<name>__before-diff-after.png`. `diff/summary.json` has the numbers.

## Scenario x theme x viewport (diff %; d = dark, l = light; 1440 = 1440x900, 900 = 900x800)

| Scenario | d1440 | d900 | l1440 | l900 | Status |
|---|---|---|---|---|---|
| 00 canvas-empty | 0 | 0 | 0 | 0 | identical |
| 06 single-tile bottom / top | 0 / 0.010 | 0 | 0 | 0 | identical (0.010 is timestamp noise) |
| 01 grid 2 tiles bottom / top | 0.010 | 0 | 0 | 0 | identical (noise) |
| 01 code-block wide / scrolled-x | 0 | 0 | 0 | 0 | identical; code scrolls (scrollWidth 1351 vs clientWidth 722 at 1440), same as before |
| 01 wide 8-col table / scrolled | 0 | 0 | 0 | 0 | identical (no scroll container before or after) |
| 07 20-col `0x0123456789abcdef` table / scrolled | 0 | 0 | 0 | 0 | identical |
| 08 canvas after route switch (chat then canvas) | 0 | 0 | 0 | 0 | identical |
| 02 message hover / no-hover | 0.014 / 0 | 0.041 / 0 | 0 / 0 | 0 / 0 | identical (hover toolbar timestamp noise) |
| 03 input empty | 0 | 0 | 0 | 0 | identical |
| 03 input 1 line | 0.536 | 0.852 | 0.523 | 0.814 | NOTE (sub-pixel text shift) |
| 03 input 5 lines | 0.072 | 0.218 | 0.066 | 0.201 | NOTE (sub-pixel) |
| 03 input 18 lines capped / scrolled | 0 | 0 | 0 | 0 | identical (capped at 160px, scrollHeight 426, same in both) |
| 04 model / effort selector (window, tile) | 0.15-0.35 | 0.06-0.29 | 0.15-0.35 | 0.06-0.29 | NOTE (see below) |
| 04 slash / @ picker (window, tile) | 0.51-1.06 | 0.19-0.71 | 0.20-0.42 | 0.15-0.58 | NOTE (see below) |
| 05 agent monitor / card expanded | 0.038 / 0.021 | | 0.054 / 0.012 | | identical apart from masked elapsed time |
| 05 agent monitor window | 0.235 | 3.38 | 0.026 | 0.004 | see below |
| 99 final window | 0.285 | 0.293 | 0.284 | 0.290 | NOTE (composer text only) |

### Composer textarea (field-sizing: content), intended change
- The tile and textarea heights match: the tile screenshots are the same height (632px at 900x800), and the box border and send-button positions are identical. The empty state and the capped 18-line state, including internal scroll, are pixel-identical.
- 1 line: the text row starts at y=504 after vs 503 before (a 1px baseline shift). 5 lines: only line 4 moved 1px (503 to 504). This is sub-pixel rounding of `lh`-based padding with `field-sizing`. It reproduces on repeat runs.
- The 04 overlay shots (selector menus, pickers) differ only in the text rendered inside the textarea (placeholder or the typed `/` or `@`), for the same 1px shift. The overlay panels, popovers, positions, sizes, bars and suggestion lists are identical. The effort-selector bars with `transition-colors` look the same in the frozen-transition capture.
- Assessment: intended and cosmetic. If exact vertical baseline parity matters, check the textarea's `padding-block` and `line-height` against the old computed height (1px).

### 05 agent monitor window, dark 900x800 (3.38%)
- The difference is in the right-hand GIT rail background (33,33,43 vs 24,24,28). It did not reproduce: two further after runs and one before run were identical to the original base. This is a harness hover or transition capture artifact, not a regression.

## Focus areas
- Markdown (code, wide table, long words): identical, so there is no scroll or clipping regression. The 20-column table renders and scrolls identically in both builds. At 1440 the table is 723px wide and fits. At 900 it is 506px wide inside a 219px `overflow:auto` wrapper (the same structure in both builds).
- Agent cards output: no visual change.
- Hidden-workspace pause: the harness has a single workspace. It was exercised only by switching chat then canvas, where the content is current and identical (08). Multi-workspace tile pause and catch-up were not visually tested.
- Overlays inside tiles: unchanged apart from the textarea text shift.

## Caveats
- The VS Code single-chat layout and tooltips are not reachable or capturable in this harness (same as the baseline).
- The slash and @ pickers show their empty states, because the command and file RPCs are unmocked.
