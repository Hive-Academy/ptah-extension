# Cutover Visual Review, round 3 - TASK_2026_576_e16a

Verdict: **APPROVED** (score 9/10; round 2 was 8/10). Visual breaking 0, Serious 0, Moderate 0, Minor 2. N-5 and N-6 are closed; every axe spec in scope is at 0 critical/serious.

## Environment and method

- HEAD 907a10283, `dist/apps/ptah-electron` as rebuilt (not rebuilt by me). Window 1280x800; docks 640 / 320 / 300 requested (567 / 319 / 299 measured). WCAG 2.2 AA.
- Harness edits (`visual-review.spec.ts` only):
  - `openGit` now waits for `ptah-review-canvas` to be attached (plus 500 ms) before `setTheme`, then `assertThemeService` reads `isDarkMode()` from the first component exposing the theme service and throws if it does not match the requested theme (`setTheme` itself lives in `support/axe.ts`, which is not mine, so the check is in the spec).
  - `comment-composer`: scrolls the list to the top and waits for the 3-hunk section before clicking Comment (fixes the light-run miss).
  - New `header-caret` step: focuses the file-section header's "Choose where to open" caret at 640 / 320 / 300 and records its rect against the list rect and its computed outline.
- Runs, one at a time: "real repo, light" and "real repo, dark", each twice (before and after adding `header-caret`), all passed with `issues: []`.

## Findings

| Finding | Status | Screenshot(s) | Evidence |
| --- | --- | --- | --- |
| N-5 open-in caret clipped on file headers with Edit | FIXED | `light-changes-wide.png`, `light-changes-min.png`, `dark-changes-min.png`, `light-header-caret-300.png`, `dark-header-caret-320.png` | The caret is drawn on every header at 567/319/299 px in both themes (README, docs/old.md, calc.ts rows). `header-caret` metrics: caret width 22, right edge 1214 against list right edge 1232 at all three docks; `focused: true`, ring `solid 2px oklch(0.7665 0.1387 91.06)` dark and `solid 2px oklch(0.48 0.12 70)` light, fully inside the header (`light-header-caret-300.png`). Real Changes metrics list no header element outside the shell any more. |
| N-6 light Pierre body dark | FIXED (harness) | `light-changes-wide.png`, `light-changes-min.png`, `light-changes-split-override-wide.png`, `light-spot-editor-dirty-wide.png` | With the canvas awaited and the theme service verified, the diff body is white with pale red/green rows and teal/pink Accept/Reject, and the spot editor uses its light syntax palette. The author's diagnosis (timing of `setTheme`, not a product bug) is consistent: nothing in the product path changed between the dark and the light capture. A manual runtime theme switch was not exercised. |
| V-6 / N-2 path readable | STILL FIXED | `light-changes-wide.png`, `dark-changes-min.png`, `light-header-caret-300.png` | Headers read "README.md", "docs/old.md", "...c/calc.ts" with `S`/`WT` and "+1"/"+2" chips at 299 px; one row. |
| N-3 header within scrollport | FIXED | same | No horizontal page overflow; header and caret end at or before the list edge. |
| V-4 comment composer ring (carried) | FIXED in both themes | `dark-focus-comment-00..02.png`, `light-focus-comment-00..02.png`, `light-comment-composer-narrow.png` | `comment-from`, `comment-to`, `comment-body`: dark `solid 2px oklch(0.7665 0.1387 91.06)`, light `solid 2px oklch(0.48 0.12 70)`. The light composer step now captures. |
| V-3, V-5 (Split override), N-1, N-4 (carried) | still fixed | `light-changes-split-override-*.png`, `dark-spot-editor-dirty-min.png` | Split press holds at 319 px; N-1 holds (git-dock axe below). |

## New findings

None above minor.

- Minor: in Split at a 319 px dock (the user's explicit choice) the hunk toolbar's right edge ("Unstage") is clipped by the pane (`dark-changes-split-override-narrow.png`); scrollable, not a layout break.
- Minor: some `window` sizes vary between steps in the saved Electron bounds (light run measured a 1184 px wide window, dark 1264/1920), so absolute pixel numbers differ between runs; relative checks (caret vs list edge) are unaffected.

## Axe and e2e results (singly)

| Spec | Result |
| --- | --- |
| `git-dock.spec.ts` | 7 passed; review-shell, review-header and review-canvas 0 critical/serious in dark and light |
| `commit-composer.spec.ts` | 7 passed; idle, running and failed axe tests 0 critical/serious |

The two non-axe failures of round 2 ("hook output streams into the log" and "Commit is disabled with nothing staged...") did **not** reproduce: both passed in this run (about 2.4 min each, the same duration at which they failed before; `retries` is 0 so these are real passes, not retried ones). I take them to be load-dependent timing in the real-git round trip (`Staged: 0 files` read before the status refresh; the hook log missing "line 2 of 3"), consistent with CI passing the spec on e0aeab566. I did not re-run the other three axe specs, which passed in round 2 on e0aeab566 and whose surfaces (spot editor, task view, conflict/history) are untouched by 907a10283 (file-section header only).

## Not captured

- A manual runtime theme switch with the git dock open (the product-side half of N-6).
- Popover of the header caret's menu at 299 px; long-author History row above 400 px; loading skeleton of the Changes body; pixel-sampled contrast of the quiet stale strip.
- spot-editor-save, task-worktree-view and conflict-and-history-axe were not re-run this round (see above).

## Verdict

- Recommendation: APPROVE.
- Confidence: HIGH on N-5 and the carried items (computed rects, computed rings and screenshots in both themes at three dock widths); MEDIUM on N-6 being harness-only (no manual theme-switch run) and on the commit-composer flakes (not reproduced, not root-caused).
- Key concern: none blocking; keep the theme-service assertion in the harness so a missed switch fails loudly.
