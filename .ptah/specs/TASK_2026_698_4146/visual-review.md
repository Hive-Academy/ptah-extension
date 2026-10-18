# Visual Review - TASK_2026_698_4146

## Summary

| Metric            | Value                                                                    |
| ----------------- | ------------------------------------------------------------------------ |
| Overall score     | 8/10 (re-captured after f7bc25dea; was 5/10 before the fix)            |
| Assessment        | APPROVED (was NEEDS_REVISION)                                            |
| Visual breaking   | 0                                                                        |
| Serious           | 0 (1 fixed in f7bc25dea)                                                 |
| Moderate          | 2                                                                        |
| Minor             | 1                                                                        |
| Viewports tested  | 2 (1365x983 wide, 640x800 narrow), each in dark and light, before and after |
| Screenshots taken | 16 saved under `screenshots/` (8 full-page, 8 inspector crops)           |
| Components tested | 1 (inspector cache tile in the SESSION grid)                             |

Score rationale: the data, copy, accessible name and contrast are right. 5 rather than 7 because the tile
lands in a single grid column instead of the full row the code intends. That makes the headline wrap to
4 lines and leaves an empty half-row beside it. The cause is a one-line source defect, so this is not
visual-breaking. It does fall in the "spacing or component inconsistency that reads as broken" class.

## Environment

- Method (same as TASK_2026_692_f748): Electron dev builds, `nx build-dev ptah-electron` then
  `nx copy-renderer-dev ptah-electron`, `--parallel=1 --skip-nx-cache`, `NX_NO_CLOUD=true`. Both builds
  succeeded. One app ran at a time.
  - AFTER: worktree `cache-expiry-timer`, HEAD d9cfec11a.
  - BEFORE: detached worktree `cache-expiry-base`, 241d4ff3c.
- Launched with `NODE_ENV=development`, CDP on 9380 only, workspace `D:\tmp\ptah-visual-ws`.
- Isolation: private profile copies `D:\tmp\ptah-698-after` and `D:\tmp\ptah-698-base`, copied from
  "Ptah Dev" without caches. The untracked `dist/apps/ptah-electron/main.mjs` in each worktree is patched so
  `app.setPath("userData", ...)` reads `PTAH_VISUAL_USERDATA`. No source edited, nothing committed, no tests
  run. The only change in the worktree is the untracked task folder.
- Driver: Playwright `connectOverCDP` scripts in `%TEMP%\drv698`.
- Real data, no fixture: a session was created in the UI and "Reply with OK." was sent. The turn completed
  and the inspector received real cache data (AFTER: "Prompt cache · 1h", "Cache expires in 58 min
  (estimated)", "Idle compaction in 52 min"). The footer showed the "Claude CLI" provider label with
  `claude-opus-5-5`. I did not separately verify that this is the native Anthropic API path, but the tile
  rendered from a real turn.
- Viewports: 1365x983 and 640x800 via `Emulation.setDeviceMetricsOverride`. This is an audit selection, not
  a support contract. Themes: `anubis` (dark) and `anubis-light`, via `data-theme` on `<html>`.
- Standard: WCAG 2.2 AA (4.5:1 normal text, 3:1 large text and UI components), because the repo declares none.
- Not exercised: the "Cache expired" state (needs a 1h wait), the 5m TTL variant, and the no-cache-data
  session (see below, BEFORE shows the no-tile state only for a session that had a turn on the base build).

## Findings by severity

### Visual breaking

None.

### Serious

#### 1. Cache tile occupies one grid column, not the intended full row

- File: `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-cache-tile.component.ts:12`
  (`col-span-2` on the inner `<div>`), used at `inspector-session-stats.component.ts:42`.
- Viewports affected: 1365 and 640, dark and light (the inspector has a fixed width of about 245 px, so all
  widths behave the same).
- Screenshots: `after-dark-wide.png`, `after-light-wide.png`, `after-dark-narrow.png`,
  `after-light-narrow.png`, and the `*-inspector.png` crops.
- Problem: the grid item is the host element `<ptah-inspector-cache-tile>` (`display:block`, no
  `grid-column`). `col-span-2` is on its child, where it has no effect in a non-grid parent. Measured: host
  and tile are 118.5 px wide, while the grid is 245 px with two 118.5 px columns. The sibling Context tile
  spans 245 px. The headline "Cache expires in 58 min (estimated)" (15px/600, line-height 24px) wraps to 4
  lines (96 px). The "Idle compaction in 52 min" line wraps to 2 lines. The tile is 170.8 px tall, against
  about 65 px if it spanned the row. The right half of the first row is an empty cell.
- Impact: the tile is cramped and reads as a layout bug in every theme and viewport. It also pushes the
  SESSION grid down by 181 px (grid height 340.5 px BEFORE, 521.9 px AFTER, measured), roughly 100 px more
  than a full-row tile would. This is the primary quantified layout shift.
- Fix: give the host the span, for example `host: { class: 'col-span-2 block min-w-0' }` or
  `:host { display:block; grid-column: span 2 / span 2 }`. Remove the redundant `col-span-2` from the inner
  div. Then re-capture the tile.

### Moderate and minor

- Moderate: the 15px/600 headline duplicates the unit "min" and "(estimated)" inside the large figure. At a
  full-row width it fits on one line, but at the current width "(estimated)" is a third of the headline's
  visual weight. Consider moving "(estimated)" into the 11px caption line. The `[title]` tooltip already
  carries the caveat (`inspector-cache-tile.component.ts:13`).
- Moderate: the tile's `title` tooltip is the only sighted explanation of "estimated". It is not reachable by
  keyboard because the group has no `tabindex` (measured `tabindex=null`). This is acceptable for static
  text (WCAG does not require focus here), but it means keyboard users get the caveat only through the
  `aria-label`.
- Minor: the `aria-label` text has no sentence break between "Idle compaction in 52 min" and the estimate
  sentence ("...52 min Estimated from..."), so a screen reader runs them together
  (`inspector-cache-tile.component.ts:44`). The empty `<p>` is omitted when idle compaction is not armed
  (correct).
- Observation, not a defect of this change: at 640 px the chat column in the squeezed layout is nearly
  unusable (composer wraps to single characters). It is the same in BEFORE and AFTER
  (`before-dark-narrow.png`, `after-dark-narrow.png`).

## Prototype fidelity

- Approved prototype: None (no new surface).
- Fidelity assessment: NOT APPLICABLE
- Before/after comparison (no prototype):
  - Dark wide: `screenshots/before-dark-wide.png` vs `screenshots/after-dark-wide.png` (crops
    `before-dark-wide-inspector.png` vs `after-dark-wide-inspector.png`). Result: only addition is the cache
    tile at the top of the SESSION grid. Existing tiles are unchanged in style, shifted down by 181 px.
    Tile layout defect as finding 1.
  - Light wide: `before-light-wide.png` vs `after-light-wide.png`. Same result.
  - Dark narrow: `before-dark-narrow.png` vs `after-dark-narrow.png`. Same result. Inspector width is the same.
  - Light narrow: `before-light-narrow.png` vs `after-light-narrow.png`. Same result.
  - No regression in the other tiles (Context, Tokens, Cost, Time, Model): same widths and contents.
  - BEFORE has no cache tile (base build has no cache data), which is the expected no-tile state.

## Viewport results

| Viewport | Theme       | Elements checked                 | Status                          | Screenshot                                    |
| -------- | ----------- | -------------------------------- | ------------------------------- | --------------------------------------------- |
| 1365x983 | dark        | tile, grid, other tiles          | Serious finding 1               | after-dark-wide.png, before-dark-wide.png     |
| 1365x983 | light       | tile, grid, other tiles          | Serious finding 1               | after-light-wide.png, before-light-wide.png   |
| 640x800  | dark        | tile, grid, horizontal overflow  | Serious finding 1, no overflow  | after-dark-narrow.png, before-dark-narrow.png |
| 640x800  | light       | tile, grid, horizontal overflow  | Serious finding 1, no overflow  | after-light-narrow.png, before-light-narrow.png |

No text truncation or clipping: the tile wraps (`scrollWidth <= clientWidth`) and nothing is clipped. The
wrapping is the symptom in finding 1.

## Component and interaction results

| Component         | States tested                                                     | Status                               | Evidence                    |
| ----------------- | ----------------------------------------------------------------- | ------------------------------------ | --------------------------- |
| Cache tile        | armed with idle compaction (real turn), dark and light, 2 widths  | Renders, layout defect (finding 1)   | after-* screenshots         |
| Cache tile        | no cache data (BEFORE build)                                      | No tile, as expected                 | before-* screenshots        |
| Cache tile        | expired, 5m TTL, idle-compaction not armed                        | Not exercised (see Environment)      | none                        |
| Cache tile focus  | Tab / focus ring                                                  | Not focusable by design (static)     | measured `tabindex=null`    |

## Design system compliance

- Tokens: tile uses `border-surface-border`, `bg-surface-1`, `rounded-md`, `p-2.5`, identical to the sibling
  tiles. The 11px caption and 15px/600 figure match the Time/Model tiles' scale (checked visually in
  `after-dark-wide-inspector.png`).
- No hex values or inline colours in the component.

## Accessibility audit

- Accessible name (measured): `role="group"`, `aria-label="Prompt cache 1h. Cache expires in 58 min
  (estimated). Idle compaction in 52 min Estimated from the last request. The server can evict cached
  content early."`. Present and correct, with a missing sentence break (minor).
- Contrast, measured with computed colours over the tile background:

| Text                         | Theme | Contrast | Requirement | Result |
| ---------------------------- | ----- | -------- | ----------- | ------ |
| Caption (11px, muted)        | dark  | 5.71:1   | 4.5:1       | Pass   |
| Headline (15px, 600)         | dark  | 14.03:1  | 4.5:1       | Pass   |
| Idle line (11px, muted)      | dark  | 5.71:1   | 4.5:1       | Pass   |
| Caption (11px, muted)        | light | 5.48:1   | 4.5:1       | Pass   |
| Headline (15px, 600)         | light | 14.44:1  | 4.5:1       | Pass   |
| Idle line (11px, muted)      | light | 5.48:1   | 4.5:1       | Pass   |

- Text size: 11px captions are the same as existing inspector captions (guidance minimum of 12px is not an AA
  criterion).
- Targets: the tile is non-interactive, so no target-size requirement applies.
- Semantics: the group sits inside the section labelled by "Session" heading. No heading-order issue.

## Visual performance

- Layout shift: when cache data arrives after the first turn, the tile is inserted above the Context tile and
  moves every other tile down by 181 px (measured grid height 340.5 px to 521.9 px, same width). The shift is
  caused by finding 1. With a full-row tile it would still insert, but be smaller (about 70 px).
  The inspector content changes after a turn ends, not during a click, so no target moves under a pointer in
  my captures.
- No animation was added. The countdown clock updates the text in place (the tile keeps its size when "58"
  changes to "57").
- Loading state: no tile until data exists, no empty or placeholder box.

## Verdict

- Recommendation: REVISE (superseded by the re-capture section below: APPROVE)
- Confidence: HIGH (measured on a real turn in both themes and viewports, with a base build for comparison)
- Key concern: `col-span-2` is on the child of the host element, so the tile uses one column (118.5 px) and
  wraps to 4 lines. Move the span to the host.

## Re-capture after f7bc25dea

- Build: AFTER only, HEAD f7bc25dea (`fix(chat-ui): span the cache tile across the inspector grid row`),
  rebuilt with `build-dev` and `copy-renderer-dev` (`--parallel=1 --skip-nx-cache`, `NX_NO_CLOUD=true`), both
  succeeded. The untracked `main.mjs` userData patch was re-applied. Profile `D:\tmp\ptah-698-after` reused,
  port 9380 only. A second real turn ("Reply with OK again.") was sent so the tile showed fresh data.
- Screenshots overwritten: `after-{dark,light}-{wide,narrow}.png` and the four `-inspector.png` crops.
  BEFORE screenshots unchanged.
- Measurements (all four theme/viewport combinations identical):
  - Host element class is `col-span-2 block min-w-0`. Host and tile are 245 px wide, the full grid width
    (was 118.5 px). Fixed.
  - Tile is 105.2 px tall (was 170.8 px). Lines: caption 1 line, headline 2 lines ("Cache expires in 59 min /
    (estimated)", was 4), idle line 1 line (was 2). No clipping (`overflowX` false). The headline wraps to two
    lines at the 245 px inspector width, which is a normal wrap and not a clip. It does not fit on one line.
  - No empty half-cell. The next tile starts exactly 8 px below the tile (`gapToNext` = 8), so the layout shift
    is the tile height plus the gap, 113.2 px, with nothing extra. A direct grid-height comparison with BEFORE
    is not valid, because this second turn made the Context tile shorter (known value 4.2%, was "Window
    unknown"). No page-level horizontal overflow at either viewport.
  - Contrast unchanged: caption 5.71:1 dark and 5.48:1 light, headline 14.03:1 dark and 14.44:1 light, idle
    line the same as the caption. All pass 4.5:1.
  - Accessible name now has the sentence break: "Prompt cache 1h. Cache expires in 59 min (estimated).
    Idle compaction in 53 min. Estimated from the last request. ..." and `role="group"` is intact.
- Kept by decision, not re-opened: headline copy (decisions.md row 17), and the tooltip not being reachable by
  keyboard (accepted).
- Not captured: the "Cache expired" state, because it needs more than an hour of waiting. It remains
  unexercised, as does the 5m TTL variant.
- Cleanup: the app was closed and no listener remains on port 9380.

Final verdict: APPROVED (8/10). 0 visual-breaking, 0 serious, 2 moderate (both accepted or kept by decision),
0 minor open. Residual uncertainty is the unexercised expired and 5m states.
