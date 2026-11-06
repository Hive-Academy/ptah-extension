# Round 3 progress — complete

Owner decisions: overlap allowed; S1/S4 headline stays on screen while the clip is pinned;
S4 text and clip bigger. Everything else (mobile order, hero arcs, S2, S3, lightning) unchanged.

## Done
- `sections/shared/section-header.component.ts`: `--section-title-size` / `--section-subline-size`
  custom properties (defaults unchanged).
- S1 command-center (.ts/.css/.spec.ts): `.cc-head[data-overlap]` moved inside the pinned
  `[data-stage]`; desktop: absolute over the clip's top-left (width min(34rem, 40vw), z 4) on an ink
  scrim (94% to 0, fades over the last 7rem). Mobile flow unchanged (header, clip, rail).
  Spec asserts the header is the stage's first child and holds the h2.
- S4 tribunal (.ts/.css/.spec.ts): clip min(66vw, 76vh*1.6) anchored right; text column
  min(34rem, 38vw) absolute over the clip's left edge on the same scrim; title clamp(2.4rem, 4.4vw,
  4rem), subline/points 1.15rem. Gutter bolt replaced by a horizontal floor bolt under the clip's right
  part (seed 83); outer bolt and seats unchanged. Spec: stage children [tb-text, tb-clip], two bolts
  inside the clip, floor bolt horizontal.

## Verification (completed before the "no scripts" decision)
- `lock slot 0 acquired after 465s: verify lint,typecheck,test (web-landing,ptah-landing-page)`
- `NX   6 tasks: 6 succeeded`
- `lock released after 177.2s, exit code 0`
- Shots: `round3-shots/command-center/`, `round3-shots/tribunal/` (desktop-enter|mid|final|seam,
  mobile-mid|final). Reviewed desktop-final for both: headlines on screen and readable.

## Not done / open
- Mobile shots were captured but not reviewed (mobile CSS was not changed).
- No processes of mine are running; no further scripts will be run (owner decision).
