# Cutover Visual Review, round 2 - TASK_2026_576_e16a

Verdict: **REVISE** (score 8/10, same as round 1). Visual breaking 0, Serious 1 (new: file-header open-in caret clipped), Moderate 1, Minor 3. N-1 to N-4 and V-6 are fixed; the fix to N-3 exposed a new, smaller clipping bug of the same kind.

## Environment and method

- HEAD e0aeab566; `dist/apps/ptah-electron` used as rebuilt (not rebuilt by me). Window 1280x800, docks 567 / 319 / 299 px.
- Harness (`visual-review.spec.ts`, only file edited): two new wrapped steps in the real-repo run. `split-override` (narrow 320 dock, press Split, capture; wide capture; press Unified again) and `comment-composer` (narrow dock, open the Comment composer on the 3-hunk file, focus pass over `comment-from`, `comment-to`, `comment-body`). Both groups run singly: "real repo, dark" passed with `issues: []`; "real repo, light" passed with one step failure (the light `comment-composer` step could not find the file header's Comment button, so no light composer capture).
- Standard WCAG 2.2 AA. Evidence: `screenshots/cutover/*`, `{dark,light}-real-metrics.json`.

## Fix verification

| Finding | Status | Screenshot(s) | Evidence |
| --- | --- | --- | --- |
| N-1 axe contrast, dark diff comment token | FIXED | `screenshots/axe/review-canvas-dark.png` | `git-dock.spec.ts:390` passes: `[axe] review-canvas / dark: 0 critical/serious`, light 0 (round 1: 2.11:1 `#737373` on `#154b35`). |
| N-2 path squeezed to "...md" at about 300 px | FIXED | `dark-changes-min.png`, `dark-changes-wide.png`, `light-changes-wide.png`, `dark-changes-split-override-narrow.png` | Headers read "README.md", "docs/old.md", "...ers/util.ts", "...omponent.ts" with `S`/`WT` short side badges and one "+1" / "+2" chip (f5594b9c1 fold) at 567/319/299 px. One row, about 34 px, both themes. |
| N-3 header wider than scrollport, caret clipped | PARTIAL (see N-5) | `dark-changes-wide.png`, `light-changes-wide.png`, `dark-changes-min.png` | The headers no longer widen the list: no horizontal page scroll (`docScrollWidth` equals `docClientWidth` in the real Changes metrics at 1264) and the row fits. But the open-in caret is cut off by the new `overflow-x: clip` (metrics: `open-in-caret[1219..1241]` against shell right edge 1232 at 567; `[1215..1237]` against 1232 at 299). Rows with an Edit button lose the caret (README at 299: no caret drawn; util.ts and component.ts at 567: absent or half drawn). Deleted-file row (no Edit) keeps its caret. |
| N-4 spot editor 14 px past the shell | FIXED (author's claim holds) | `dark-spot-editor-dirty-min.png`, `light-spot-editor-dirty-min.png` | The visible editor pane ends at the shell edge: the 41-char line is cut at "// CHAN" with the editor's own horizontal scrollbar under it; nothing draws past the shell. The `.cm-content` metric (`Contents of src/calc.ts[961..1246]`, shell right 1232) is the scroll content inside the clipped pane, as claimed. Header row at 299 px: "Back to review", "...calc.ts", "Unsaved", "Save" all inside. |
| V-6 file-section header path | FIXED | as N-2 | Path keeps its minimum width at 299 px; badges fold. Left-truncation reads correctly. |

f5594b9c1 checks: the "+N" chip is present below 480 px in both themes (`+1`, `+2`); at 567 (canvas below 480 px) it also shows. History at 319 px (`light-history-commits-narrow.png`, `dark-history-stashes-narrow.png`): sha, subject (about 23 chars), age; author hidden below 400 px; a wide-dock author cap was not separately captured with a long author. Early Split press: `dark-changes-split-override-narrow.png` and `light-changes-split-override-wide.png` show Split pressed and a real two-column diff at 319 px (default there is Unified), then Unified restores. In split at 319 px the hunk toolbar is clipped on the right ("Unstage" cut), which is the user's explicit choice.

Focus rings on text inputs (V-4, comment composer): dark `comment-from`, `comment-to`, `comment-body` all `solid 2px oklch(0.7665 0.1387 91.06)` (`dark-focus-comment-00..02.png`); the `Filter files`, `commit-message`, `Choose where to open` stops are unchanged and opaque in both themes. Light composer not captured (see below), but it uses the same class that maps to the light ring `oklch(0.48 0.12 70)` on every other input.

## New findings

### Serious

**N-5. The open-in caret on file-section headers is clipped for files with an Edit button.** Likely source: `review-canvas/file-section-header.component.ts:107` (host `overflow-x: clip`), with the header content wider than the visible list width (it extends under the list's vertical scrollbar: caret at x 1219..1241 vs scrollbar from x 1224). Viewports: dock 567, 319 and 299, both themes. Screenshots: `dark-changes-wide.png` (util.ts and component.ts rows: caret gone), `dark-changes-min.png` (README row: caret gone), `dark-comment-composer-narrow.png` (carets cut at the right edge). Impact: the "Choose where to open" menu trigger cannot be clicked on those rows (the VS Code button still works; keyboard focus lands on an invisible control, which is a 2.4.7 failure there). Round 1 showed this caret on every row. Fix: let the header measure the visible list width (scrollbar excluded) with `min-w-0 max-w-full`, or fold Edit to icon-only earlier / drop the VS Code button's gap so the caret fits at 299 px.

### Moderate

- **N-6. Pierre diff body renders dark in the light run (second round in a row).** `light-changes-wide.png`, `light-changes-split-override-wide.png`, `light-changes-min.png`: black diff body inside light chrome, while the axe light capture (`screenshots/axe/review-canvas-light.png`) is white and the CodeMirror spot editor in the same light run is light (`light-spot-editor-dirty-wide.png`). Round 0 (older build) showed a white body with the same harness ordering. That the light chrome and editor follow the theme but Pierre does not points at the runtime theme switch (worker pool or `themeType` captured at first mount in the dark session), not at the static light theme. Likely `libs/frontend/git-ui/src/lib/renderer/pierre-config.ts` / `pierre-diff-host.component.ts` (theme read at mount). Confidence MEDIUM: the harness reaches the theme through `ng.getComponent(...).theme.setTheme` after a dark first mount, so a real user switching theme with the git dock open is the case to confirm by hand. Light diff colours versus the prototype could therefore not be judged.

### Minor

- The dark run's later steps show a 1920-wide window (`dark-comment-composer-narrow.png`, `dark-spot-editor-dirty-min.png`); the harness' window restore, not a product matter. Doc-level overflow numbers for those steps are not comparable.
- The conflict dialog metrics (`git-confirm-dialog[0..1254]`) are the full-window overlay, as in round 1.
- Light `comment-composer` step failed: the Comment button of the 3-hunk file section was not found in the light run (the section was likely not rendered in time). Not a defect finding on its own; see not captured.

## Axe results (singly)

| Spec | Result |
| --- | --- |
| `git-dock.spec.ts` | 7 passed; review-shell, review-header, review-canvas all 0 critical/serious in dark and light |
| `spot-editor-save.spec.ts` | 6 passed; read-only and editable 0 critical/serious |
| `task-worktree-view.spec.ts` | 5 passed; open-PR and quiet-PR views 0 critical/serious |
| `conflict-and-history-axe.spec.ts` | 2 passed; conflict banner and history 0 critical/serious |
| `commit-composer.spec.ts` | 5 passed, 2 failed, none of them axe: idle, running and failed axe tests pass (0 critical/serious). Failing: "hook output streams into the log" (log shows line 1 of 3, never line 2, 2.4 min timeout) and "Commit is disabled with nothing staged and enables once a file is staged" (`Staged: 0 files` where 1 was expected). Test 1 passed in the earlier round-1 run and both are functional, not visual. I ran the file twice, once as a whole run with the same two failing; the second time (a broader `-g`) also ran the whole file. They look like timing under load but I did not prove that; the author should check them before merge. |

## Not captured

- Light comment-composer ring and light composer layout (step failed in the light run); the long-author cap above 400 px on the History row; the loading skeleton of the Changes body; Open-in popover at 299 px.
- Pixel-sampled contrast of the quiet stale strip; light Pierre colours against the prototype (N-6).

## Verdict

- Recommendation: REVISE.
- Confidence: HIGH on N-1, N-2, N-4, V-6 and the Split override (screenshots and axe); MEDIUM on N-6 (harness path) and on the commit-composer e2e failures (not diagnosed).
- Key concern: N-5, the clipped open-in caret on editable file headers, plus the two unexplained commit-composer e2e failures.
