# Phase E round 1 — layout lane

## Findings

- **N1 — page scrolling:** `command-center-page.component.ts:27-28` makes the host the single vertical scroll owner with a definite height and `min-h-0`. The wide rail and work list no longer clip or scroll independently (`:73-77`); the stacked layout keeps stage, dock, then rail in document order (`:85-103`). Wheel and keyboard focus can reach content past the page box.
- **N2 — height:** `command-center-page.component.ts:49-71` sizes the stage from the host's remaining grid space with a 420 px minimum. It no longer uses `100vh`; when content exceeds available height, the host scrolls. The dock occupies its own grid row (`:54-57`) so its controls and focus rings are not cut off by the stage's fixed viewport height.
- **N3 — typed command:** `command-session-controls.component.ts:21` gives the form a 15 rem minimum width and growing basis. It wraps as a usable row instead of shrinking the input to 24–98 px. Covered in `command-session-controls.component.spec.ts:23-24`.
- **M-h — dock row:** `command-center-page.component.ts:54-65,79-83,281-306` spans the dock across the page below the stage and rail and keeps its two control groups on one row when the page container is at least 1280 px wide. Below that width the groups wrap cleanly; the form retains its minimum width. The dock remains before the rail in stacked visual order (`:85-103`).
- **N4 — toast contrast:** `command-center-page.component.ts:194-231` uses `bg-base-100 text-base-content`, a colored left border and tone-matched icon instead of a colored alert background. The theme's base content/surface pair supplies readable body text in both themes. Retry speech and Dismiss retain visible labels and 2 px warning focus outlines. Covered in `command-center-page.component.spec.ts:159-190`.
- **M-f — toast placement:** `command-center-page.component.ts:194-248` places the toast in normal rail flow before the selected-node card; it cannot cover the card title. Dismiss remains wired. The spec checks the order and non-absolute wrapper (`command-center-page.component.spec.ts:166-174`).
- **M-a — pending card:** `command-pending-input.component.ts:27,32,116` removes card-level clipping, restricts scrolling to a long question description, and uses stronger input border and placeholder tokens. `Send answer` remains outside the scroll region. Covered in `command-pending-input.component.spec.ts:77-94`.
- **Badge:** `command-center-page.component.ts:124` raises the session badge to 11 px.

## Files changed

- `libs/frontend/command-center/src/lib/components/command-center-page.component.ts`
- `libs/frontend/command-center/src/lib/components/command-center-page.component.spec.ts`
- `libs/frontend/command-center/src/lib/components/command-session-controls.component.ts`
- `libs/frontend/command-center/src/lib/components/command-session-controls.component.spec.ts`
- `libs/frontend/command-center/src/lib/components/command-pending-input.component.ts`
- `libs/frontend/command-center/src/lib/components/command-pending-input.component.spec.ts`
- `.ptah/specs/TASK_2026_678_9083/reports/phase-e-r1-layout-report.md`

## Decisions

- **One page scroll owner.** Options were host scrolling or separate rail/list scrolling. The shell clips its child, and the review requires keyboard and wheel access without nested wide-layout scrollbars, so the host owns vertical overflow. Reversible in page CSS.
- **Full-width dock grid row.** Options were keeping the dock under the stage or spanning the page. The Electron sidebar leaves too little stage-column width for both control groups at a 1440 px window, so the grid gives the dock the available page width. Reversible in the page grid and markup.
- **Neutral toast surface.** Options were adjusting theme error colors or using existing base tokens. The review measured insufficient contrast on the colored alert; base content on base surface follows the established high-contrast theme pair. Reversible in template classes.
- **Question-only internal scroll.** Options were a fixed-height card with a fixed action footer or natural card height with a bounded description. The page now scrolls, so limiting only long descriptions keeps all action rows visible with less structure. Reversible in pending-card classes.

## Verification

- Scoped `ptah_get_diagnostics` after the main edits reported zero errors in all six requested files; it reported 17 sibling-file errors outside this lane's scope. A final scoped request after the tone-icon class change timed out while the compiler was still running, so it did not provide a fresh result.
- Specs were updated but not run, as required by the lane instructions. No Nx, Jest, build, serve, e2e or package command was run.

## Not done

- Live Electron measurements at 892×735, 900×800, 1440×900 and 1600×1000, including exact contrast ratios and focus-ring visibility, remain for the orchestrator's visual review. The scoped diagnostics do not check rendered layout or token contrast.
- The 17 diagnostics in sibling files were not edited because those paths are outside this lane's ownership.
