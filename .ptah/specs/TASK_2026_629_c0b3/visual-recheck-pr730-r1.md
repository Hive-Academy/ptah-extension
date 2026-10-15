# Visual Re-check - TASK_2026_629_c0b3 - PR #730 fix round 1 (session 13 r1)

`S` = `W\.ptah\tmp\final-run\shots\` (W = worktree root). New shots are `S\after-s13r1-*.png` (10 files). "Before" shots are
from `visual-review-pr730-fixes.md` (`S\after-s13-*.png`).

## Summary

| Metric | Value |
| --- | --- |
| Score | 9/10 |
| Assessment | APPROVED |
| Visual breaking | 0 |
| Serious | 0 |
| Moderate | 0 new (the earlier toggle-size Moderate is resolved) |
| Minor | 2 (pre-existing, outside the fix round) |
| Viewports | 1600x967 (both themes), 1084x835, 984x770 |

## Environment

- Build: `node .ptah/tmp/check-run.mjs s13r1-build -- npx nx run ptah-electron:build-dev` (no wait for the lock, exit 0, started 04:02:55) and `node .ptah/tmp/check-run.mjs s13r1-copy -- npx nx copy-renderer-dev ptah-electron --parallel=1` (exit 0, built `ptah-extension-webview` plus 3 deps). `dist/apps/ptah-electron/renderer/index.html` is 04:04:48, newer than the start. The bundle contains the new `min-w-6` class. `main.mjs` is 04:03:08.
- Launched with `launch.mjs` (CDP 9333). First on `D:\projects\ptah-s13-empty-ws` (empty board), then on `D:\projects\ptah-final-run-ws` (opened as a folder, no git run there). The app is closed (no listener on 9333, no Electron process).
- Method as in the earlier review: computed styles through CDP, colours resolved through a 1x1 canvas and composited over the real ancestor backgrounds, WCAG 2 luminance; thresholds 4.5:1 text, 3:1 UI. No source files edited, no tests, no other builds, no state-changing git.

## Result table

| Check | Before shot | After shot (dark / light) | Measurement | Result |
| --- | --- | --- | --- | --- |
| F-1 setup card, light | `after-s13-20-light-empty-board.png` (1.44 / 1.32 / 2.32) | light: `after-s13r1-01-light-empty-board.png` | "Skills Not Configured" `#8f5200` on `#f4f0ed` **5.50** (was 2.32); warning icon (UI) 5.50; body 5.69 and 6.21; title "Intelligent Project Setup" `#291334` on `#fefaf4` **16.38** (was 1.44); "Open Marketplace Skills" 11 px `#004a45` on fill `#44ebd3` **6.81** (was 1.32); "Configure" 6.81; scan icon on tile 6.81; tags 14.21; "Claude Agents" 15.21, "Not configured" 5.77; "No sessions on this board" 15.92, sub 6.04, "New session" 6.81. Buttons 143x24 and 66x24. | PASS (min text 5.50) |
| F-1 setup card, dark | `after-s13-23-dark-empty-board.png` (3.16 / 3.47) | dark: `after-s13r1-03-dark-empty-collapsed.png`, `after-s13r1-04-dark-empty-expanded.png` | Warning title and icon `#f97316` on `#17171c` **6.40**; body 5.86 / 5.34 / 5.50; title `#e8e6e1` on `#1f1f29` **13.11** (was 3.16); "Open Marketplace Skills" `#f8f7f4` on `#2563eb` **4.82** (was 3.47); "Configure" 4.82; scan icon on tile 4.82 (UI); button fill vs its surround 3.47 and 3.26 (>= 3:1); heading 14.86, sub 6.05, "New session" 4.82. | PASS (min text 4.82) |
| F-2 collapsed 56 px empty Rail | `after-s13-21-light-empty-short-top.png` ("No sessio / yet", scrollWidth 70 > clientWidth 55) | light: `after-s13r1-02-light-empty-collapsed.png`; dark: `after-s13r1-03-dark-empty-collapsed.png` | Aside 56 px. `[data-testid="rail-empty"]` is `<p class="py-4 text-center">` with an `aria-hidden` "—" and an `sr-only` "No sessions yet". `scrollWidth` 55 = `clientWidth` 55, nothing clipped; the "—" glyph is 14 px wide, contrast 6.04 light / 6.05 dark. `ariaSnapshot`: `complementary "Sessions"` > `button "Expand rail"`, `paragraph: No sessions yet`, `button "+"`. The accessible text is present and the visible glyph is not announced twice. Expanded text unchanged (261 px wide, `px-3`). | PASS |
| F-3 card names | `after-s13-10-light-rail.png` (every card "..., in focus") | light: `after-s13r1-10-light-rail.png`, `after-s13r1-11-light-focus-switched.png`; dark: `after-s13r1-12-dark-rail-s2-focused.png` | Initial focus on the third card: names `S2, done` / `S4, done` / `can you generate html stats and some…, done, in focus`; `aria-current="true"` and `tabindex=0` only on the focused one. After a real click on S2: `S2, done, in focus` / `S4, done` / `can you generate html stats and some…, done` and `aria-current` moves with it. Same in dark (snapshot lines `button "S2, done, in focus"`, `button "S4, done"`). Collapsed rail names match (`S2, done, in focus`, `S4, done`, ...). | PASS |
| M-2 toggle hit box | 15x24 (earlier review) | `after-s13r1-01-light-empty-board.png` (expanded), `after-s13r1-02-light-empty-collapsed.png` (collapsed), `after-s13r1-13-light-rail-collapsed-cards.png` | `getBoundingClientRect` **24.48 x 24.48** expanded and collapsed, both themes; `min-width: 24px` applies, `min-height` computes to 20 px (styles.css `.btn-xs` wins) but the height still comes out at 24.48 from the daisyUI `height: 1.5rem`, so the floor is not what guarantees it. Colour contrast 15.92 light / 14.86 dark. Disabled (auto-collapsed) state at 984: 24x24, `aria-disabled="true"`, opacity 0.6, reason text unchanged. | PASS |
| Rail layout unchanged | `after-s13-10-light-rail.png` | `after-s13r1-10-light-rail.png` | Aside 288 px with cards x 354, 261 wide, 176 tall (identical to the earlier values); the "Sessions" label (144 px) is not truncated; no horizontal page scroll. The only drift is the row glyphs: the toggle is 9 px wider, so the "≡" and "‹" sit about 4 to 11 px further left than before (visible when you compare the two shots), and the text "0 / 9 running" moved 10 px left. Collapsed: aside `w-[56px]`, cards 55x56, header 39 px inner width holds the 24 px toggle with no overlap. The "Lanes" line differs only because the earlier shot was taken after a lane test (data, not layout). | PASS (cosmetic 4-11 px glyph shift) |
| Regression a (idle ink) | `after-s13-01-dark-rail.png` / `after-s13-10-light-rail.png` | same views, `after-s13r1-12`, `-10` | Same values as before: dark `--state-ink-idle` `#9ca3af`, pill min 5.91 (focused error), dot min 4.08 (focused running/error vs focused tint, same as before); light min pill 6.58, dot min 4.54. | PASS (unchanged) |
| Regression b (focus ring) | `after-s13-02-dark-focus.png` | `after-s13r1-12-dark-rail-s2-focused.png` | Outer ring 2 px solid: dark `#e8e6e1` 14.86, light `#291334` 15.92; inner ring dark `#16a34a` 4.66, light `#13713a` 4.89. | PASS (unchanged) |
| Regression c (ctx whole number) | `after-s13-03-dark-rail-ctx-whole.png` | `after-s13r1-10`, `-12` | Cards read `ctx 0%` (real data); regex `^ctx (\d+%\|—)$` true in both themes. | PASS |
| Regression d (empty board scroll) | `after-s13-20/23` | `after-s13r1-01`, `-03`, `-04` | Section `overflow-y: auto`, `scrollHeight` 890 = `clientHeight` 890 at 1600x967, h2 and card inside, no document scroll (short-window scroll behaviour not re-run; no change in that code). | PASS |
| Regression e (narrow canvas) | `after-s13-05/06` | `after-s13r1-15-light-narrow-auto.png` (984x770), `after-s13r1-14-light-narrow.png` (1084x835, manually collapsed) | 984: canvas 606 px, rail 56, toggle `aria-disabled="true"`, `title`/`aria-describedby` "Widen the canvas to expand the Rail", pane 506x693 visible, no horizontal scroll. 1084: canvas 706, toggle enabled. | PASS |
| Regression f (regions) | split and single snapshots | page `ariaSnapshot` | Single pane: exactly one `region "Focused session: S2"` plus the Display chip's `region "Turn summary..."`. Split was not re-run (not touched by this round). | PASS |

## Findings

No Visual-breaking, Serious or Moderate findings. F-1, F-2, F-3 and the toggle-size Moderate are resolved.

### Minor (pre-existing, not caused by the fix round)

- **m-1. Collapsed "+" new-session button has no accessible name.** `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts:232-242`: the visible text is `'+'` when collapsed and there is no `aria-label`, so the name is "+". The expanded state reads "New session". Fix: add `[attr.aria-label]="collapsed() ? 'New session' : null"`. Seen in the `ariaSnapshot` (`button "+"`), `after-s13r1-02-light-empty-collapsed.png`.
- **m-2. Rail header chips are 17x24 px.** "Dense cards" (`≡`, 17x24) and the "3 done, jump to the next one" chip (17x24) are under 24 px wide. Adjacent to the now 24x24 toggle; the WCAG 2.5.8 spacing exception probably applies, so this is guidance-level. Seen in `after-s13r1-10-light-rail.png`.

### Informational

- In `anubis-light` the filled "Open Marketplace Skills" and "Configure" buttons are 1.32:1 and 1.34:1 against their surrounds (same as every `btn-primary` in the app). The text labels at 6.81:1 identify them, so no failure under 1.4.11. Dark is 3.47:1 / 3.26:1.
- The 🤖 emoji in the "Claude Agents" tile is a colour glyph and is excluded from the contrast numbers.
- Playwright's `locator.click()` on `.rc-select` timed out because the card host (`ptah-compact-rail-card`) is the topmost element at the card centre; a real mouse click at that point focused the card correctly, so this is a harness artefact, not a user-facing defect.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Score 9/10: all four fixes verified by measurement in both themes with no layout regression; the remaining 1 point is for the two pre-existing small-target and naming gaps in the Rail (m-1, m-2) and the thin light-theme state margins (4.54:1 focused idle text).
