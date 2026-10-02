# P3 Visual Review, round 1 re-check - TASK_2026_576_e16a

Verdict: **APPROVE** (score 8/10). All three Serious and the Moderate findings are fixed with measurements; no new Serious or Moderate findings. Remaining items are the accepted deferred minors plus two harness/scope notes below.

## Method

- Commit `86b5ee6dd` on `feat/task-2026-576-p3`. Rebuilt with `npx nx run ptah-electron:copy-renderer-dev` (0/1 cache hit; the renderer output contains the new `cs-path` class, so the bundle is fresh).
- Throwaway specs (deleted; `git status` shows only the new `screenshots/p3/round1/` folder and the pre-existing unrelated `.shell-security-*` / antigravity review files), own user-data folder, same mocks and measurement code as the first pass. No Ptah desktop process touched, no full e2e run, no source edits.
- States: populated, counts unavailable, mixed (conflicted + reconciled + truncated + baseline note), both themes, natural width (448 px), 320 px container, and the real dock-open flow (click a row, tile squeezes to 118 px, card 66 px).
- Criteria unchanged: 4.5:1 text, 3:1 non-text. Raw data: `screenshots/p3/round1/round1-measurements.json`, `round1b-measurements.json`, `round1c-measurements.json`.
- **Harness note (important).** My harness sets `data-theme` only. In the real app `ThemeService` also writes `data-theme-mode` (`theme.service.ts:192`), and `--ptah-gold-strong` (the anubis-light focus ink) is deepened only under `[data-theme-mode='light']` (`styles.css:112-116`). The first light focus measurement (outline `rgb(245,217,125)`, 1.13:1) was therefore a harness artifact, not a product defect; `round1c` sets both attributes like the app and gives the real value. Dark needs no marker.
- **Inline error:** still not provokable with a real failure (aborting lazy chunks did not make `openInDock` throw; count 0). `*-inline-error-simulated.png` uses the committed classes (`flex items-start gap-1 text-[11px] text-error`) with an SVG cloned from the card as the icon. Colour and contrast are real computed values; the icon glyph is a stand-in. Review-button focus is now captured.

## Per-finding result

| Finding | Result | Measured (dark / light) | Evidence |
| --- | --- | --- | --- |
| S1 row focus ring (was 1.27:1, 1 px light) | **FIXED** | Global 2 px outline, offset -2 px (inset), plus `focus-visible:bg-base-300/50`. Row: amber `oklch(0.767 0.139 91)` **7.85 vs row bg / 8.39 vs card** dark; deepened gold `oklch(0.48 0.127 70)` **5.45 vs row bg / 5.73 vs card** light (with the app's theme-mode marker). Review button (offset +2 px): 8.39 vs card dark; 5.73 vs card light (4.51 vs its own teal fill). `:focus-visible` true, tab order Review, row 1, row 2. | `dark-settled-focus-*.png`, `light-modeset-focus-*.png`, `*-focus-row1.png` |
| S2 narrow tile (118 px tile / 66 px card) | **FIXED** | Card `scrollWidth` 64 vs width 66, no overflow; Review button inside the card (x 6-54 dark, 6-56 light); header wraps; each row puts the path on its own 56 px line, left-truncated (`...ew-file.ts`, `...e/app.ts`), chevron hidden, no row overflow (0 px), document has no horizontal scroll; row heights 44-84 px. 320 px: card 304 / scrollWidth 302, no overflow, layout unchanged from the previous pass. | `*-dock-open-narrow-card.png`, `*-narrow320-card.png`, `*-dock-open-window.png` |
| S3 ghost badge contrast (4.48 light) | **FIXED** | "counts unavailable" 13.89 dark / **14.21** light; "No longer changes HEAD" 13.89 / **14.21** (9 px, full `text-base-content`). Conflicted pill unchanged 4.83 / 4.86. | `*-unavailable-card.png`, `*-mixed-card.png` |
| M1 reconciled row not dimmed in light | **FIXED** | Reconciled path 5.06 dark / **4.55** light, i.e. muted in both (was 14.44 light). Still reads as inert (no chevron, badge). Margin in light is thin (4.55) but passes. | `light-mixed-card.png` ("src/old.ts" grey) |
| M2 inline error looked like a caption | **FIXED** (icon simulated) | `text-error` ink 6.70 dark (`rgb(248,113,113)` on `rgb(19,19,23)`), **6.94** light (`rgb(175,0,25)` on `rgb(250,247,245)`); leading alert icon present; `role="alert"` kept. | `dark-inline-error-simulated.png`, `light-inline-error-simulated.png` |
| M3 neutral accent below 3:1 | **FIXED** | Neutral accent (counts unavailable) 5.31 dark / **5.01** light (was 2.40 / 1.93). Populated/mixed accent: success 5.62 dark / **2.37** light. | `*-unavailable-card.png` |

## Remaining items (no action required for this phase)

1. Light success/warning accent border is 2.37 (additions) and 2.46 (mixed) against the page. Same class as the deferred "light mixed accent 2.46" you accepted; decorative, redundant with the header text and counts. Treated as accepted.
2. Decorative status-chip accent borders in light (M 2.04, A 1.96, D 2.96, R 3.41): accepted deferral; the letter (13.18) and `aria-label` carry status.
3. Light muted text sits at 4.55 (header, row counts, reconciled path): passes with no margin.
4. At 118 px the card is usable but cramped (paths are shown only as the file-name tail); this is the squeezed chat tile's limit, not the card's. No overflow or clipped controls remain.

## Verdict

- Recommendation: APPROVE.
- Confidence: HIGH on measurements (computed, both themes, real renderer and store join, real dock-open flow). MEDIUM on the inline error (icon glyph simulated, ink real) and on light focus, which depends on the app's `data-theme-mode` marker that the harness had to set by hand.
- Key concern: none blocking; watch the 4.55 light muted-text margin if the `--bcm` token is retuned.
