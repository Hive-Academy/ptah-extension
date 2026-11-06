# Visual Review Phase 2 - TASK_2026_878_eae4 (landing v2)

Verdict: NEEDS_REVISION, 6.5/10. Two defects are visual-breaking at specific widths (1024 and 768). Mobile (390) and wide desktop (1440/1280) are largely sound.

Environment: dev server http://localhost:4200/ (not started by me), headless browser, viewports 1440x900, 1280x800, 1024x768, 768x1024, 390x844 (audit selection, no documented support policy). Dev-server numbers are not production numbers. Console errors could not be read (no console tool); the network log showed no failed requests (all 200). Screenshots: `.ptah/specs/TASK_2026_878_eae4/visual-review/`.

Not every section was screenshotted at every width. Covered: 1440 all sections; 1280 S1; 1024 S1 and S4; 768 S3; 390 S1, S3 and a full-page capture (too small to judge). Metric checks (overflow, text overlap, font sizes, tap targets) ran on every section at every width.

## Findings (by severity)

### Visual breaking

1. **S3 decision-loop diagram is clipped at 768 to ~1023px (tablet).** `.loop-canvas-wrap` is 864px wide inside a 705px `.loop-window` that has `overflow:hidden`. Stages 03 and 04 are cut off and nothing scrolls. Evidence: `768-s3.jpg`.
   - Cause: `decision-loop/decision-loop-section.component.css:292-298`. The `@media (min-width:768px)` block sets `aspect-ratio:1080/470` plus `min-height:23.5rem` (376px). The min-height forces the width to 376 x 1080/470 = 864px.
   - Fix: move the desktop-diagram breakpoint to `min-width: 1024px`, so tablet keeps the vertical mobile rail. Alternative: drop `min-height` there, or use `min-height: 0` with `min-width: 0`.
   - Check the same breakpoint pairing for `.loop-svg-mobile` and `.loop-svg-desktop`.
2. **S1 at 1024 (pinned desktop layout): the subline overlaps the first two point cards.** The 3-line subline (y 1014-1089) overlaps tile 1 (y 1031-1080) and touches tile 2 (y 1088). The opaque text block hides tile 1's text, which bleeds through as "...together." Measured by rect: 336x49 px overlap. Evidence: `1024-s1.jpg`.
   - Cause: tile offset in the S1 css (`.rail-tile` / points container, `command-center` component) does not allow for the subline wrapping to 3 lines below ~1100px. At 1280 and 1440 the subline is 2 lines and there is no overlap.
   - Fix: at `@media (max-width:1180px)` and above 1024, push the points down (`margin-top: 5rem` or `padding-top: clamp(...)`) or widen the text column from 410px to ~480px. This is in the same family as the owner's "overlap allowed" rule, but this overlap hides readable copy.

### Serious

3. **Overlap occludes meaningful content in S6 and S8 at 1440.** The S6 headline block (opaque) covers the top of the mock's left pane, and the S8 point cards hide the "Workspace Analysis" title ("rkspace Analysis"). Evidence: `1440-07-s6.jpg`, `1440-09-s8.jpg`. If overlap is intended, shift the point cards or headline 40-60px so the clip's own labels stay legible.
4. **Section H2 size is inconsistent.** At 1440: S1/S2/S3/S5-S8 are 52px, S4 is 63.4px (4 lines, `tribunal` section), final CTA is 103.7px (intended, display). At 1280: 48.6 vs 56.3. At 1024: 38.9 vs 45.1. At 768 and 390 everything is 32px except CTA. S4 is a ~22% outlier. Probably intended as a hero moment, but it makes S4 wrap to 4 lines at every desktop width. Suggested fix if unintended: S4 `h2` font-size to match `clamp(...)` used by siblings, or `max-width` raised to allow 3 lines.
5. **Body/point text sizes vary across sections without a pattern (1440):** subline 16.56 across most sections, points 15.2 (S1, S7), 15.68 (S3), 16 (S2), 16.8 (S5, S6, S8), 18.4 (S4). Six different point sizes. Fix: one token (e.g. `--landing-point-size: clamp(0.95rem, 0.9rem + 0.2vw, 1.05rem)`) applied in each section css.
6. **Footer and nav tap targets are small (WCAG 2.2 AA 2.5.8 needs 24x24).** Header icon links are 20x20 (Discord, GitHub, Reddit, LinkedIn) at all widths, and footer text links are 17px high (Download, Documentation, Discord, GitHub, Reddit, LinkedIn, Privacy, Terms). Nav links "Features" and "Docs" are 28px high (desktop). 44px is vendor guidance, not AA. Fix: `padding: 12px` on the 20px icon links (hit area 44) and `padding-block: .5rem; display:inline-block` on footer links.
7. **Hero tagline "No account, no license key, no credit card" is 11.2px** at every width (below 14px, including mobile). Raise to >= 12.5px (about `0.8rem`), ideally 14px on mobile.
8. **Eyebrows are small on narrow widths:** 12.8px at <=1024 and mobile (13.44 at 1280, 13.6 for the hero eyebrow). Acceptable for uppercase mono labels, but they are the only text <14px apart from item 7. Suggest a floor of 13px.

### Moderate and minor

- Native `<video controls>` chrome (play, 0:00, mute, fullscreen, kebab) is visible on all clips at rest (S1, S2, S4, S5) and sits under the point cards in S1 at 1280 and 1440 (`1280-s1.jpg`). It looks like unpolished UI on a marketing clip. Hide controls until hover/play, or use a custom overlay.
- S2 eyebrow reads "TITLE BAR"; S3 "WHO RUNS IT" (a copy question for the owner).
- S5, S7: clip/mock bleeds off the left viewport edge (intended asymmetric bleed; S7 mock loses its left border). Fine under the owner's rules; `img.still-image` overflows (L56-R1759 at 1440) but is clipped by `overflow: clip` on the section frames, so there is no horizontal scroll at any width (document scrollWidth <= innerWidth in every run).
- S2 bottom: large empty band (~128px padding + empty clip frame) before S3 at 1440. Sections have uniform padding 115.2/128 (1440), 102.4/115.2 (1280), 81.9/92.2 (1024), 72/80 (<=768); the CTA has larger bottom padding (160/153.6/122.9/96) by design.
- S3 uses a centered layout, S1/S2/S4-S8 asymmetrical; it matches the owner's "unique layouts" rule less than the others, but is clean.
- S7 and S8 leave a large empty top-left/left region at 1440 (`1440-08-s7.jpg`, `1440-09-s8.jpg`).

## Section consistency (1440)

| Section | top | height | padding top/bottom | H2 | H2 lines |
| --- | --- | --- | --- | --- | --- |
| hero | 0 | 900 | 0 | 60 (h1) | 1 |
| S1 | 900 | 924 | 115.2/128 | 52 | 2 |
| S2 | 1824 | 820 | 115.2/128 | 52 | 3 |
| S3 | 2644 | 1006 | 115.2/128 | 52 | 1 |
| S4 | 3650 | 998 | 115.2/128 | 63.4 | 4 |
| S5 | 4648 | 854 | 115.2/128 | 52 | 2 |
| S6 | 5502 | 731 | 115.2/128 | 52 | 3 |
| S7 | 6234 | 842 | 115.2/128 | 52 | 3 |
| S8 | 7075 | 1024 | 115.2/128 | 52 | 2 |
| CTA | 8099 | 742 | 115.2/160 | 103.7 | 3 |

Padding is consistent (no outliers except the intentional CTA). Font sizes are viewport-scaled (clamp or vw), as sections reduce proportionally at 1280 and 1024.

## Responsive summary

| Width | Horizontal scroll | Text overlap | Notes |
| --- | --- | --- | --- |
| 1440 | none | none measured (visual overlap items 3) | S4 4-line H2 |
| 1280 | none | none | OK |
| 1024 | none | S1 subline x tile (item 2) | pinned layout |
| 768 | none (clipped) | none | S3 diagram cut (item 1) |
| 390 | none (375 doc width) | none | tiles OK, nothing clipped. Tap targets: 12 under 44px, all header/footer links |

At 390 no text is under 14px except the hero tagline (11.2) and eyebrows (12.8/13.6).

## Performance (dev server, headless, software GL)

| Metric | Value |
| --- | --- |
| TTFB / DCL / load (1440) | 71 ms / 1036 ms / 1058 ms |
| FCP | 500 ms |
| LCP | 500 ms (1440). At 390 the buffered LCP reported 14.3 s because a later large image candidate was painted after my scroll; treat as unreliable |
| CLS | 0.006 (1440), 0.005 (390). Good |
| Long tasks | 2 totaling 368 ms (max 306 ms) at load |
| Scroll FPS (4 s programmatic top-to-bottom, 1440) | 42 fps, max frame 50 ms, 2 frames over 50 ms (software rendering) |
| Resources | 56 requests: script 44 (15.0 MB, dev unbundled: lucide-angular 6.3 MB, core 3.3 MB), img 6 (3.49 MB), link 2 (97 KB), video 3 (233 KB), other 1 |
| Document | 138.7 KB (SSR) |
| Heavy images | 4 WebGL textures as PNG: eye_of_horus 942 KB, scarab 807 KB, ankh-sphere 803 KB, sun_disk_ra 684 KB (about 3.2 MB) |
| Videos | 4 `<video>`, all `preload=none`, paused, readyState 0 at load. Posters are 76-102 KB JPG. Good, no eager video download |
| Canvases | 17 `<canvas>` in DOM; 1-3 are visible per scroll point at 1440 (thin lightning canvases 44-48px high plus 50xN glow canvases and the hero 576x900). Real WebGL context count cannot be read non-invasively; visible counts stay at max 3 including thin canvases and are within the owner's cap if lightning is 2D |
| Failed requests | none seen (67 requests all 200) |

Performance notes:
- Convert the 4 texture PNGs to WebP/KTX2 at the rendered size (typically -70 to -85%): about 3.2 MB down to under 700 KB.
- `ngx-markdown` and `dompurify` are loaded on the landing page in dev (deps list). Confirm they are tree-shaken or lazy in the production build.
- `favicon.ico` is 177 KB; replace with a small ICO/SVG.
- Fonts come from Google Fonts at runtime (2 requests); consider self-hosting.

## Top fixes

1. S3 tablet breakpoint (`decision-loop-section.component.css:292`): desktop diagram to `min-width:1024px`.
2. S1 1024 overlap: offset points or widen the text column between 1024 and ~1180px.
3. Unify point and subline type scale tokens; decide whether S4's 63px H2 is intended.
4. Tap target padding on header icons and footer links; raise the hero tagline to 12.5px or more.
5. Compress the four texture PNGs.
