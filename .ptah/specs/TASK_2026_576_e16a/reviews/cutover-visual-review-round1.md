# Cutover Visual Review, round 1 - TASK_2026_576_e16a

Verdict: **REVISE** (score 8/10; round 0 was 6/10). Visual breaking 0, Serious 1 (axe regression on the review canvas, dark), Moderate 3, Minor 2.

All nine round-0 findings are FIXED on the rendered build; the only blocker is a deterministic axe color-contrast failure in `git-dock.spec.ts` (dark review canvas).

## Environment and method

- Worktree `.claude-worktrees/task-576-cutover`, HEAD 2c7a95130, `dist/apps/ptah-electron` used as is (not rebuilt, per brief). Window 1280x800; dock wide 640 requested / 567 measured, narrow 320 / 319, new **min 300 / 299** (V-1 at the true layout minimum).
- Harness: `apps/ptah-electron-e2e/src/specs/git/visual-review.spec.ts`. Only edit: `both()` now also captures a 300 px dock (`{theme}-{surface}-min.png`, metrics names `*-min`), through the same `setEditorPanelWidth` path. No selector update was needed. Groups run one at a time: "real repo, dark" / "light", "mocked states, dark" / "light" (each passed, `issues: []`). Screenshots in `screenshots/cutover/` were overwritten (old set: commit 32d7d84f3). No Ptah process was stopped; the full e2e suite was not run.
- Standard: WCAG 2.2 AA (3:1 focus indicators / UI parts, 4.5:1 text). Evidence: `{dark,light}-real-metrics.json`, `{dark,light}-mocked-metrics.json` (shell rect, elements outside it, computed focus outline per tab stop).

## Round-0 findings

| Finding | Status | Screenshot(s) | Evidence |
| --- | --- | --- | --- |
| V-1 header and tab strip clip at 300-340 | FIXED | `dark-changes-narrow.png`, `dark-changes-min.png`, `light-changes-min.png`, `dark-history-stashes-narrow.png` | At 319 and 299 px the header wraps: row 1 sidebar/branch/info/stash, row 2 icon-only Open in, refresh, Pull, Push, all inside the shell. Tabs show full labels with counts ("Changes 9 / Commit 2 / Task / History"), none clipped. Metrics: `git-push-button`/Pull/History no longer appear in `clipped` at any width (round 0: Push 1230..1282 against 1264). Compact mode only changes padding/size, not labels. |
| V-2 long branch overlaps controls | FIXED | `dark-task-pr-ok-min.png`, `light-task-pr-ok-wide.png`, `dark-task-pr-ok-narrow.png` | Branch label truncates ("feat/task-2026-576-with-a-rat..."), stash, info, refresh, ahead/behind keep their place at 567/319/299. No overlapping glyphs. |
| V-3 Open-in caret focus ring transparent | FIXED | `dark-focus-changes-10.png`, `light-focus-changes-10.png`, `dark-focus-task-02.png` | Computed on "Choose where to open": dark `solid 2px oklch(0.7665 0.1387 91.06)`, light `solid 2px oklch(0.48 0.12 70)` on Changes and Task, `:focus-visible` true. Equal to the neighbouring buttons (round 0: `rgba(0,0,0,0)`). |
| V-4 text-field ring 20 % alpha | FIXED (header-level inputs); comment-composer inputs not measured | `dark-focus-changes-03.png`, `light-focus-changes-03.png`, `dark-focus-commit-00.png`, `light-focus-commit-00.png` | "Filter changed files", "commit-message": same opaque 2 px ring as buttons in both themes (dark amber 0.7665/0.1387/91, light oklch(0.48 0.12 70) ~ 6.5:1 on base-100). Metrics scan: no focus stop with a transparent or alpha ring. The `comment-from/to/body` inputs (handoff patch) have no focus stop in the harness, so they were not verified. |
| V-5 split diff / stacked hunk toolbar at narrow canvas | FIXED (Split override not captured) | `dark-changes-wide.png`, `dark-changes-min.png`, `light-changes-wide.png` | The diff list now defaults to Unified in a ~300 px canvas (Unified pressed). Toolbar is one row: "@@ -1,... Hunk 1 of 1 < > Unstage" and "Hunk 1 of 1 < > Accept Reject". No blank half, no stacking. Pressing Split afterwards is covered by unit tests only; not captured. |
| V-6 file-section header wraps 2-3 rows | PARTIAL | `dark-changes-wide.png`, `dark-changes-min.png` | Headers are now one 28-34 px row (was 60-70). But the left-truncated path collapses to almost nothing next to the actions: "...md", and "R :" for the rename row (see N-2). Row height fixed, readability of the path regressed. |
| V-7 loud stale bar, no dirty marker | FIXED | `dark-spot-editor-stale.png`, `dark-spot-editor-dirty-wide.png`, `light-spot-editor-dirty-wide.png` | Stale bar is a quiet base-200 strip with an amber left rule and normal text, "Reload" at right. "Unsaved" label with amber dot next to Save while dirty (both themes). |
| V-8 truncation priority | FIXED | `dark-history-stashes-narrow.png`, `dark-task-wide.png`, `light-task-pr-ok-wide.png`, `dark-task-pr-ok-min.png` | History at 319: author hidden, subject now ~23 chars ("feat(review): scale the l...", "chore: add docs, helper..."), sha and age kept. Task: branch name is full ("agent/task", "feature/review"), path is left-truncated and reads correctly ("...ata/Local/Temp/ptah-vr-wt-dark-1791023147894", "...xtremely-long-folder-name-that-must-truncate-gracefully"). |
| V-9 PR wording without GitHub remote | FIXED | `dark-task-wide.png` | Real repo without remote now reads "No GitHub remote - PR status hidden." (quiet, no error colour). |

Minors from round 0 (Chat ring in light, `.mcp.json` untracked files, 480 px OS window) are app-shell matters, unchanged and out of scope.

## New findings

### Serious

**N-1. Axe: dark review canvas has a color-contrast failure (git-dock spec).** `git-dock.spec.ts:390` "the review canvas with diffs and hunk rows has no critical or serious a11y violations in dark and light" fails (reproduced twice, singly): `color-contrast`, foreground `#737373` on `#154b35`, 2.11:1 (needs 4.5:1), 13 px; targets `diffs-container ... div[data-line-type="change-addition"] > span[data-diff-span]:nth-child(8) > span` (lines 10 and 55: the `// CHANGED` syntax comment token on an added line). Light passes. Likely source: the Pierre dark theme comment token colour against the addition background (`libs/frontend/git-ui` review-canvas theme setup, `file-diff-section.component.ts`; commit 8c0fc2c43 cleared the earlier axe findings, so this is a regression or a path newly exposed by the narrow Unified default). I could not rebuild at the previous commit to attribute it. Artefacts: `screenshots/axe/review-canvas.{json,md}`, `review-canvas-dark.png`. Fix: lift the comment token (or the addition-line background) so the pair reaches 4.5:1 in the dark Pierre theme.

### Moderate

- **N-2. File-section header path is squeezed to a fragment in a ~300 px canvas.** `review-canvas/file-section-header.component.ts:143` (path `flex` area against `shrink-0` badges and actions). `dark-changes-wide.png` / `light-changes-wide.png`: README header reads "...md" with ~60 px unused to its right; the rename row (`lib/helpers/util.ts`, Staged, "no changes") shows only a glyph, so its name appears only in the Pierre header below. `title` holds the full path. Fix: give the path a min-width (for example 8rem) and let Staged/Working-tree chips drop or wrap first.
- **N-3. Row actions clip at the canvas edge.** `dark-changes-wide.png` deleted-file header (docs/old.md): the open-in caret is cut at the right edge; at 300 px the metrics list `open-in-caret[1215..1237]` against a shell right edge of 1232 (`dark-changes-min`/`light-changes-min`, "clipped" in the JSON). The header container is wider than the visible canvas (horizontal scrollbar at the bottom). Fix: the section header should stay within the scrollport width (`min-w-0`, `max-w-full`).
- **N-4. Spot editor content is 14 px wider than the shell at 300 px.** `dark-real-metrics.json` `spot-editor-dirty-min`: "Contents of src/calc.ts[961..1246]" against shell 933..1232. Screenshot `dark-spot-editor-dirty-min.png`. Probably the editor's scroll/minimap gutter; confirm and clip.

### Minor

- Light real run (`light-changes-*.png`, not `screenshots/axe/review-canvas-light.png`) renders the Pierre diff body dark inside light chrome, unlike round 0. The axe light capture (white Pierre body, same build) is correct, so this is most likely the harness theme-ordering artefact described in round 0 (a transient "Git status is unavailable" strip also appears in `light-spot-editor-dirty-wide.png`). Not confirmed as a product defect; worth a re-check in a headed light session. Because of it, the light diff colours in this round are not a valid comparison with the prototype.
- Conflict-dialog metrics show `git-confirm-dialog[0..1254]` (document scroll width 1254 against 1264): the modal overlay, outside the dock, not a layout defect.

## Regression checks

- Header second row vs content: no overlap at 567/319/299 in either theme (`dark-changes-min.png`, `light-changes-min.png`).
- Popovers: comparison menu, branch picker, Open in menu captures present for both themes in the 567 dock; not clipped (`dark-comparison-menu.png`, `light-comparison-menu.png`, `dark-branch-review-picker.png`). Open-in menu at the 300 px header was not captured.
- Compact tabs: full labels kept at 319/299.
- Unified-at-narrow default: confirmed (Unified pressed at canvas ~300 px). Split override: not captured (unit tests only).
- "Unsaved" marker: present. Stale strip: quiet base-200 strip, normal text colour (contrast read by eye; axe passes on the spot-editor spec, which includes the editable and read-only states).
- Left-truncated paths: read correctly in Task rows and the change-set card; in the canvas header see N-2.

## Axe results (singly, `--reporter=list`)

| Spec | Result |
| --- | --- |
| `git-dock.spec.ts` | 6 passed, **1 failed** (review canvas dark color-contrast, N-1); shell a11y test passed |
| `spot-editor-save.spec.ts` | 6 passed (read-only and editable axe tests included) |
| `task-worktree-view.spec.ts` | 5 passed (open PR and quiet PR axe tests included) |
| `conflict-and-history-axe.spec.ts` | 2 passed |
| `commit-composer.spec.ts` | 7 passed (idle, running, failed axe tests included) |

The git-dock failure was re-run alone and failed identically. The axe runs rewrote `screenshots/axe/*` files (tracked), as they always do.

## Not captured

- Split press overriding the narrow Unified default (needs a harness step).
- Open-in popover and comment-composer inputs at 300 px; focus rings for `comment-*` inputs.
- Light Pierre diff body in the real-repo run (see Minor); loading skeleton of the Changes body (as in round 0); root-commit row in a real History run.
- Contrast of the quiet stale strip was not sampled from pixels.

## Verdict

- Recommendation: REVISE (one Serious: axe color-contrast on the dark review canvas; three Moderate layout items in the canvas file headers).
- Confidence: HIGH on V-1 to V-4, V-7 to V-9 (computed values and screenshots in both themes); MEDIUM on V-5/V-6 (Split override and light diff colours uncaptured).
- Key concern: N-1, the git-dock axe spec must be 0 critical/serious before merge.
