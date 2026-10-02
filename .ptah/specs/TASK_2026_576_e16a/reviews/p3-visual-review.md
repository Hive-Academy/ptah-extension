# P3 Phase-End Visual Review - TASK_2026_576_e16a (change-set card)

Verdict: **REVISE** (score 6/10). Visual breaking 0, Serious 3, Moderate 3, Minor 3.

## Method and environment

- Worktree `.claude-worktrees/task-576-p3`, branch `feat/task-2026-576-p3`. Rebuilt with `npx nx run-many -t build-dev copy-renderer-dev -p ptah-electron` (succeeded, 0/2 cache hit, so the bundle is fresh).
- Harness as P2: throwaway Playwright specs in `apps/ptah-electron-e2e/src/specs/git/` reusing `UiDriver`, `prepareCanvasWithSessions`, `sessionRowButton`, the `chat:resume` replay seam and a `git:turnChangeSets` / `git:info` mock (the seam of `change-set-card.spec.ts`). One Electron launch per spec in its own user-data folder; the user's Ptah desktop app was not touched; the full suite was not run. Both scratch specs were deleted; `git status` shows only the new `screenshots/p3/` folder and this file (the `.shell-security-*` dirs and `p3-phase-review-antigravity-round1.md` pre-existed and are not mine).
- Themes: `data-theme` set to `anubis` (dark) and `anubis-light` (light). Window 1200x800. Card measured at its natural width (448 px, `max-w-md`) and at a 320 px container (sidebar emulation: `width:320px` set on the `chat-change-set` wrapper, an audit selection, not a support contract). The dock-open case is a real layout: opening the Review dock squeezes the chat tile to 118 px.
- States captured per theme: populated (M/A/D/R with orig path, 4-digit counts, a 150-char path), counts unavailable, mixed (conflicted + reconciled + truncated "7 more files" + baseline-missing note), keyboard focus on a row (two Tab stops), dock-open narrow tile. Reconciled and conflicted are driven by the mocked `git:info`, as the store computes them in production.
- Contrast: computed colour composited through ancestor backgrounds and cumulative opacity, canvas-converted to sRGB, WCAG 2.x. Criteria: 4.5:1 text, 3:1 non-text, 24x24 target (WCAG 2.2 AA; the repository declares nothing stricter). Raw data: `screenshots/p3/p3-measurements.json`, `p3b-measurements.json`.
- Limitation 1: the inline action error could not be provoked with a real failure (clicking a row opens the dock successfully; the dock then shows its own viewer error because `git:diff` is not mocked, which is a different surface). `*-inline-error-simulated.png` injects the identical markup/classes from `chat-transcript.component.html:84-92`; measurements are of the real class set, the trigger is simulated.
- Limitation 2: the approved prototype was compared against its structure and design-spec §4.1 text, not by a side-by-side screenshot of `prototype/change-set-card.html`.
- Limitation 3: focus on the Review button was not captured; only row focus.

## Findings

### Serious

1. **Row focus ring is 1.27:1 in the light theme and only 1 px thick in both.** `change-set-card.component.ts:169` (`focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary`). Measured computed `box-shadow` ring: dark `oklch(0.546 0.215 263)` (blue) vs card `rgb(24,24,30)` = **3.42:1** (passes marginally); light `oklch(0.85 0.138 181)` (the pale teal primary) vs card `rgb(239,236,234)` = **1.27:1 (fails 3:1)**. Screenshots: `light-mixed-focus-row1.png`, `light-populated-focus-row1.png` (a faint teal hairline; the row also has no background change on focus), `dark-mixed-focus-row1.png`. Focus is correctly reachable (`:focus-visible` true, tab order Review, then rows top to bottom) but in light it is nearly invisible. Impact: keyboard users in anubis-light cannot tell which file row is focused. Fix: a 2 px inset ring in a token that holds 3:1 in both themes (the P2 branch-picker rings used 2 px amber/dark-amber, 2.9-3.3:1), or add a `focus-visible:bg-base-300/50` tint plus the ring.
2. **At a very narrow tile the card loses its file names and its primary action.** `change-set-card.component.ts:97` (header row is `flex`, no wrap) and `:177-179` (path `flex-1 min-w-0` collapses to 0). With the 1200 px window and the Review dock open (after clicking a row) the chat tile is 118 px, the card 66 px wide, content `scrollWidth` 175; the Review button sits at x=126 inside a 66 px card, i.e. clipped and unreachable by pointer; row paths render as nothing, leaving only badge + count. Screenshots: `light-dock-open-narrow-card.png`, `dark-dock-open-narrow-card.png`, `dark-populated-after-row-click-window.png`. At 320 px the card is fine (`*-narrow320-card.png`: no horizontal overflow, long path left-truncated with title, Review visible). Impact: after opening a file the user sees a card they cannot read or review from. The tile being crushed is arguably the real defect (the composer is also unusable), but the card has no min-width/wrap fallback. Fix: `flex-wrap` on the header row, `min-w-[12ch]` on the path (or stack count under path below a container breakpoint), and let the card scroll or hide counts first.
3. **Light-theme 9 px ghost badges fall just under AA.** "counts unavailable" (`:108-113`) and "No longer changes HEAD" (`:162-164`): `text-base-content-muted` on `badge-ghost` = **4.48:1** light (`rgb(128,99,110)` on `rgb(239,234,230)`, 9 px, so no large-text relief); dark 4.97 passes. Screenshots: `light-unavailable-card.png`, `light-mixed-card.png`. The design-spec §4.2 value of 5.01 assumed `bg-base-300`; the card's own tint plus the ghost badge fill is darker. Miss is 0.02, filed Serious because the rubric files a below-criterion contrast there. Fix: use `text-base-content` on these badges, or drop the badge fill.

### Moderate

1. **Reconciled row is not dimmed in light.** In dark the reconciled path reads muted (5.06:1, `dark-mixed-card.png`), in light the path measures 14.44:1 (full ink, `light-mixed-card.png`, "src/old.ts"), identical to actionable rows, so only the badge and the missing chevron signal that it is inert. `:152` sets `text-base-content-muted` on the row, so the cause was not traced (a light-theme override of the muted token on the `font-mono truncate` span is the likely suspect). The spec (§4.1) also called for `opacity-60`; the build deliberately uses muted text instead (acceptable, but then it must work in both themes).
2. **Inline action error reads as a caption, not an error.** `chat-transcript.component.html:84-92`: `text-[11px] text-base-content-muted`, no icon, no colour, outside the card. Contrast passes (5.31 dark / 5.01 light) and it has `role="alert"`, so it is announced, but sighted users get a grey line that looks like help text (`light-inline-error-simulated.png`, `dark-inline-error-simulated.png`). Fix: leading `TriangleAlert`/error icon and `text-base-content` with an error-tinted band (the P2 pattern), keeping the 4.5:1 text.
3. **Neutral card accent is below 3:1** when counts are unavailable or empty: `oklch(var(--bc)/0.3)` = 2.40 dark / 1.93 light against the page (`ACCENT.neutral`, `:36`); the mixed accent is 2.46 light (`oklch(0.72 0.18 55)`). Decorative and redundant with the header text, but §4.2 claims "3:1+". Dark populated 6.61.

### Minor

1. Status chip accent borders (decorative): A 4.65 / M 5.47 / D 3.17 / R 7.29 dark; M 2.04 / A 1.96 / D 2.96 / R 3.41 light. The letter (12.29 dark, 13.18 light) and `aria-label`/`title` carry the status, so no failure; a colour-blind user gets the letter.
2. Light muted text is at the limit: header label, counts, orig path, chevron measure 4.55:1 light (5.06 dark). Passes, no margin.
3. Layout movement on the live push: inserting the card moves the next message from y=487 to y=676 (189 px), CLS 0.012 at t=1594 ms plus 0.000002 at 1638 ms; card height is constant (165 px) over the next 900 ms, so there is no post-load drift. There is no `@defer` placeholder, so the shift is the card's own insertion, below the 0.1 "good" bound and expected for content appended at the end of a turn. Not a defect, recorded for the "no shift when deferred card loads" check.

## Pass list (examined, no defect)

| Check | Result |
| --- | --- |
| Text contrast, dark | header 5.06, totals +5.36 / - 6.38, Review (btn-primary) 4.82, path 14.15, counts 5.06, orig path 5.06, Conflicted badge 4.83, truncated note 5.06, baseline note 5.06, ghost badges 4.97, badge letter 12.29 |
| Text contrast, light | header 4.55, totals +5.37 / - 6.30, Review 5.20, path 14.44, counts 4.55, Conflicted badge 4.86, truncated 4.55, baseline 4.55, badge letter 13.18 (exceptions above) |
| Targets | rows 26 px tall x 446 wide; Review 48x24 dark, 50x24 light (meets 24x24 AA; below 44 guidance, not an AA criterion); status chip 16x16 non-interactive |
| Focus order | Review, then each row in DOM order; reconciled rows skipped (plain text); `:focus-visible` true; see Serious 1 for visibility |
| Semantics | `section` with aria-label "N files changed", rows are single `<button>`s with a title, chip is `role="img"` with Modified/Added/Deleted/Renamed/Conflicted labels, rename has sr-only "renamed from" |
| Truncation | 150-char path left-truncated (`...hangeSetCard...spec.ts`) via rtl/bdi at 448 and 320 px, full path in the row `title`; 4-digit counts (+1234 -567) fit at 320 |
| Overflow | no horizontal scroll at 448 or 320 px (card and document) |
| Counts unavailable | "counts unavailable" ghost badge replaces totals, every row shows `?`, accent neutral; no "+0 -0" |
| Reconciled / conflicted / truncated / baseline-missing | render as designed; conflicted shows red "Conflicted" pill (white on error 4.83 dark, ink on pink 4.86 light) and "Resolve ..." title; "7 more files not listed" and "May include changes made before this turn started." both present |

## Prototype fidelity

- Approved prototype: `.ptah/specs/TASK_2026_576_e16a/prototype/change-set-card.html` (Populated / Counts unavailable / File reconciled, wide and embedded widths); design-spec §4.1 and §5.
- Fidelity assessment: MATCHES on structure and hierarchy (file-diff icon + "N files changed" + totals + single primary Review, one button per row, trailing chevron, `border-l-2` accent, truncated paths, `?` for unknown counts, ghost "No longer changes HEAD", no chevron on reconciled rows). Intentional deviations already approved in earlier phases: status chip is the neutral chip with a hue accent (`ptah-file-status-badge`, Gate 2 clarification) instead of the per-status filled badges in §4.1; reconciled row uses muted text instead of `opacity-60` (and see Moderate 1, it does not hold in light). Added beyond the prototype: Conflicted pill, baseline-missing note, truncated-count line, which are in the P3 scope.
- Before/after (no prototype diff required beyond above): not applicable; this is a new surface.

## Viewport results

| Width | States | Status | Screenshots |
| --- | --- | --- | --- |
| 448 px card (natural) | populated, unavailable, mixed, focus, dark + light | pass except focus ring in light | `{dark,light}-{populated,unavailable,mixed}-card.png`, `*-tile.png`, `*-window.png` |
| 320 px container | populated, unavailable, mixed, dark + light | pass | `{dark,light}-{populated,unavailable,mixed}-narrow320-card.png` |
| 66 px card in 118 px tile (dock open) | populated, dark + light | fail (Serious 2) | `{dark,light}-dock-open-narrow-card.png`, `dark-populated-after-row-click-window.png`, `{dark,light}-dock-open-window.png` |

## Component results (`ptah-file-status-badge`)

M/A/D/R/conflicted (`!`) chips render 16x16 with neutral fill, letter at 12.29 / 13.18:1 in both themes, correct accessible names, accent border decorative only (Minor 1). Legible at 10 px semibold; no defect.

## Verdict

- Recommendation: REVISE. Fix Serious 1-3 (focus ring token, narrow-tile fallback, ghost badge text colour) and Moderate 1 (reconciled dimming in light) then re-run only the focus and light-theme captures; Moderate 2-3 can go to the P3 follow-up bucket.
- Confidence: HIGH on measurements (computed, both themes, real renderer and real store join), MEDIUM on completeness (inline error simulated, Review-button focus not captured, narrow widths emulated by container width, single 1200x800 window).
- Key concern: keyboard focus on a file row is effectively invisible in anubis-light (1.27:1, 1 px).
