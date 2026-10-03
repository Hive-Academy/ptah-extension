# Cutover Visual Review - TASK_2026_576_e16a

Verdict: **REVISE** (score 6/10). Visual breaking 2, Serious 2, Moderate 5, Minor 3.

## Environment and method

- Worktree `.claude-worktrees/task-576-cutover`, branch `feat/task-2026-576-cutover` (HEAD 1514bcfe7). `dist/apps/ptah-electron` (00:28) is newer than the last product commit under `libs/` and `apps/ptah-electron` (no non-spec, non-md commit since), so no rebuild was needed.
- Harness: new spec `apps/ptah-electron-e2e/src/specs/git/visual-review.spec.ts` (kept, tidy, prettier-formatted). It is a capture suite, not an assertion suite: every step is wrapped so one missing state never hides the next. Only that one spec was run (`-g` per group); the full e2e suite was not run and no process named Ptah was touched.
- Real RPC against a real scratch repo (branch `feature/review`, modified/staged/deleted/renamed/untracked files, a 130-char path, a real pre-commit hook, real commits, a real stash, a real `git worktree add`, a real merge conflict) for: Changes canvas, branch review, spot editor (read-only, editable, dirty, disk-conflict dialog, stale), Commit (idle, filled, hook failure, hook running, success, nothing staged), History (commits + stash), Task, Conflict banner. Mocked RPC only where a real repo cannot reach the state: Task PR open, Task PR quiet, History unavailable and empty, Changes empty, diff load failure, chat change-set card.
- Themes: `anubis` (dark) and `anubis-light`. One Electron launch per theme and group. For light, the theme is set after the shell mounts and the git rail is then closed and reopened, because Pierre reads the theme at mount (a first attempt that set the theme before the shell existed left the Pierre diff dark inside light chrome; that was a harness ordering artifact, discarded and re-captured).
- Viewports: window 1280x800 (content 1264x735). "Narrow dock" is the real dock, driven through `ElectronLayoutService.setEditorPanelWidth`: wide = 640 requested (clamped to 50 % of the window, measured 567 px), narrow = 320 requested (measured 319 px; the layout minimum is 300). Shrinking the OS window to 480 px was also tried (see Minor 2), but is an app-shell concern, not a git surface.
- Standards: no repository accessibility standard stricter than WCAG 2.2 AA was found, so AA is used: 3:1 for focus indicators and UI components (2.4.7, 1.4.11), 4.5:1 for text. axe was not re-run (it already passes per the brief). Sources of expectation: `design-spec.md` sections 4, 6, 7, 9-12, `prototype/*.html` (captured here in both themes under `screenshots/cutover/proto/`), `libs/frontend/core/.../electron-layout.service.ts` (dock min 300 px, default 700, max 50 % of window).
- Evidence: 228 PNGs and 6 JSON files in `.ptah/specs/TASK_2026_576_e16a/screenshots/cutover/`. Files are named `{dark|light}-{surface}-{wide|narrow}.png`; metrics (shell rect, document overflow, elements outside the shell rect, per-stop computed focus indicator) are in `{dark,light}-real-metrics.json`, `{theme}-mocked-metrics.json`, `{theme}-card-metrics.json`. Prototype references: `proto/{page}-{state}-{dark|light}.png` (44 files).

## Findings

### Visual breaking

#### V-1. Dock header and tab strip clip at narrow dock widths (Push button, History tab)

- Likely source: `libs/frontend/git-ui/src/lib/git-dock/git-dock-header.component.ts:54` (row is `flex h-8 ... px-2` with no wrap or overflow rule; Fetch/Pull/Push at `:164-200`), tab strip in `review-shell/review-shell.component.ts:159` (`ptah-native-tab-group`, no overflow handling).
- Viewports: dock 300-330 px (measured 319). Not affected at 567.
- Screenshots: `dark-changes-narrow.png`, `light-changes-narrow.png`, `dark-history-stashes-narrow.png`, `dark-commit-success-narrow.png`. Metrics (`dark-real-metrics.json`, `light-real-metrics.json`): on every tab at 319 px `git-push-button` spans 1230..1282 against a shell right edge of 1264, and on Changes `native-tab` (History) spans 1200..1271 (visible only as "His").
- Problem: Push is cut off the right edge, the stash count and "Open in..." collide with the refresh icon (`Open in..` plus `⟳` run together), and the History tab shows as "His". At 300 px (the layout minimum, reached after an OS-window resize) Pull is cut as well ("Pu").
- Impact: at a width the app itself allows, Push is partly unreachable and the History tab label is truncated to a fragment; the header reads as broken.
- Fix: let the header row wrap or move Open-in / refresh into an overflow menu below ~340 px, give the tab strip `overflow-x:auto` or icon-only tabs at narrow width, and set `min-w-0 shrink` on the branch trigger.

#### V-2. A long branch name overlaps and displaces the header controls

- Likely source: `git-dock-header.component.ts:88-97` (branch trigger button renders `gitBranches.currentBranch() || gitStatus.branchName()` with no `truncate`/`max-w`).
- Viewports: 567 px and 319 px dock (any width once the name exceeds roughly 40 chars; stress value `feat/task-2026-576-with-a-rather-long-branch-name-for-truncation`).
- Screenshots: `dark-task-pr-ok-wide.png`, `light-task-pr-ok-wide.png`, `dark-history-unavailable-wide.png`, `dark-changes-diff-error-wide.png`, `dark-task-pr-ok-narrow.png` (worst case, text drawn over the stash count, info icon and refresh icon).
- Problem: the branch text is drawn on top of the stash-count and info buttons, and "Open in...", Pull and Push disappear from the row (only `↓3 ↑12` remain). At 319 px the whole header is an unreadable pile of overlapping glyphs.
- Impact: overlapping elements with real-world input (long task branches, worktree branches such as `agent/...`); Fetch/Pull/Push become unavailable from the header.
- Fix: `truncate max-w-[14rem] min-w-0` on the label with the full name in `title`, and `min-w-0` on the flex parent so the right-hand controls keep their width.

### Serious

#### V-3. The Open-in caret has no visible focus indicator (both themes)

- Likely source: `libs/frontend/git-ui/src/lib/open-in/open-in-button.component.ts:72-78` (`btn btn-ghost btn-xs join-item px-1`, `aria-label="Choose where to open"`).
- Screenshots: `dark-focus-changes-10.png`, `light-focus-changes-10.png`, task surface stop 2 (`dark-focus-task-02.png`, `light-focus-task-02.png`).
- Evidence: the focus pass records `:focus-visible` true and `outline: solid 2px rgba(0, 0, 0, 0)` (transparent) on that stop in both themes and on both the Changes file header and the Task tab. Every neighbouring control gets a 2 px amber ring (dark `oklch(0.77 0.14 91)`, light `oklch(0.48 0.12 70)`), so this one is an omission, not a design choice.
- Impact: a keyboard user cannot see where focus is on the Open-in menu trigger (WCAG 2.4.7).
- Fix: give the join-item caret the same `focus-visible:outline-*` colour the sibling buttons use (the review shell sets `oklch(var(--s))` for tabs; the btn class chain loses it on `join-item`).

#### V-4. Text-field focus ring is a 20 %-alpha outline (Filter files, commit message)

- Likely source: daisyUI `input`/`textarea` default focus (`outline ... / 0.2`) used unchanged by `review-canvas/comparison-bar.component.ts` (filter input) and `commit/commit-composer.component.ts` (message textarea).
- Screenshots: `light-focus-changes-03.png`, `dark-focus-commit-00.png`, `light-focus-commit-00.png`. Computed: `outline: solid 2px oklch(0.236 0.066 313 / 0.2)` (light) and `oklch(0.925 0.007 88 / 0.2)` (dark) on `Filter changed files` and `commit-message`.
- Estimated contrast of that ring against the surrounding surface (blend of the outline colour at 0.2 alpha, not pixel-measured): about 1.4:1 light and 1.7:1 dark, below the 3:1 required for focus indicators.
- Impact: the two primary text inputs of the git surface show only a hairline-faint ring; in light it is nearly invisible (same class of defect as the P3 change-set card finding, which is fixed on the card: the row ring is now a visible 2 px brown, `light-chat-card-focus-row.png`).
- Fix: `focus-visible:outline-primary` (or the amber token used by the buttons) at full opacity for these inputs.

### Moderate

- **V-5. Split diff in a narrow canvas column: hunk toolbar stacks into three lines and the other half shows a blank grey block.** `dark-changes-wide.png`, `light-changes-wide.png`, `dark-changes-narrow.png` (README staged hunk: "@. Hunk 1 of 1", chevrons and "Unstage" stacked in the right half, an empty block on the left half; the modified side is clipped and needs a horizontal scroll). The deleted-file hunk (unified-like) shows the proper single-row toolbar with Accept/Reject. The prototype (`proto/review-canvas-populated-*.png`) uses an in-flow single-row toolbar with `@@ ... Hunk n of m` and Accept/Reject at the right. Source: `review-canvas/hunk-toolbar.component.ts` plus the Pierre slot placement; suggestion: default to unified (or collapse the toolbar to a single row) below ~600 px canvas width.
- **V-6. File-section header wraps to two or three rows.** `review-canvas/file-section-header.component.ts:98-114`. At 567 px the path plus badges sit on row 1 and `+4 -0 / Comment / Edit / open-in` on row 2 (`dark-changes-wide.png`); a long path puts the status badge alone on one row and the path on the next (`dark-changes-collapsed-file.png`, collapsed header at 567 px). Not clipped, no overlap, `title` carries the full path, but it makes every section header 60-70 px tall where the prototype's is one 28 px row.
- **V-7. Spot editor stale bar is a full-bleed saturated orange band, and a dirty file has no marker beyond an enabled Save.** `dark-spot-editor-stale.png`, `light-spot-editor-stale.png` (bar is `bg-warning`-saturated in both themes; dark text on it is readable, about 5:1 estimated). The prototype has no stale bar; its conflict state is the quiet dialog (`proto/spot-editor-conflict-dark.png`) which the build also provides (`dark-spot-editor-conflict-dialog-wide.png`, matches). Dirty state: `dark-spot-editor-dirty-wide.png` shows only the blue Save; the prototype's "Edit" toggle with a check and the disabled Save are replaced by a "Read only / Edit / Save" row (read-only shot `dark-spot-editor-readonly-wide.png`). Suggest a dot or "Unsaved" label and a calmer stale bar (outlined, not solid).
- **V-8. Truncation priority is inverted at narrow widths.** History: the commit subject truncates to about 15 characters while author and time keep their width (`dark-history-stashes-narrow.png`: `feat(review): s...`, stash message `On fe...`). Task: the worktree branch is cut to `feature/re...` / `agent/visual-revi...` while the path gets most of the row (`dark-task-wide.png`, `dark-task-add-form-narrow.png`). Titles exist for both (`history-timeline.component.ts:207`, `history-stash-section.component.ts:141`, `task-worktree-view.component.ts:366`), so nothing is lost, but the high-value text should win: drop the author below ~400 px, truncate the path from the left (the prototype shows `.../wt/576`).
- **V-9. Wording of the PR panel for a repo without a GitHub remote.** `dark-task-wide.png` shows "PR status could not be read." for a real repo with no remote; the mocked quiet case reads correctly ("GitHub CLI not available - PR status hidden", `dark-task-pr-quiet-wide.png`). It is quiet (no alert role, no error colour), but "could not be read" suggests a fault. Source: `task/task-worktree-view.component.ts` PR-unavailable reason mapping.

### Minor

1. The worktree row badge "main" labels the main worktree even when its branch is `feature/review` (`dark-task-wide.png`), which reads as the branch name. Same as the prototype's wording, so not a deviation.
2. Observation, not a git defect: shrinking the OS window to 480 px (`dark-app-window-480.png`) leaves the app shell wider than the window (document scroll width 873 against 464) and the git dock sits off-screen. The dock only works down to its 300 px layout minimum; the window minimum is not part of this task.
3. Observation: the nav "Chat" focus ring in `anubis-light` is the pale teal primary (`oklch(0.85 0.138 181)`, `light-focus-spot-04.png`), the same low-contrast ring called out in the P3 review; app chrome, not a git surface. Also, the app writes untracked `.mcp.json` and `.agents/mcp_config.json` into the opened repo, so they appear as `U` files in the Changes tree (`dark-changes-scrolled.png`); worth a separate look, not a visual defect. A transient amber "Git status is unavailable (git timed out) - showing the last known changes." strip appeared once under load in the light run (`light-spot-editor-conflict-dialog-wide.png`) and renders cleanly.

## Per-surface table

Window 1280x800. "Wide" = dock 567 px, "narrow" = dock 319 px. Prototype column names the reference capture.

| Surface | Theme | Screenshots | Prototype comparison | Findings |
| --- | --- | --- | --- | --- |
| Shell + header | dark | `dark-changes-shell.png`, `dark-changes-wide.png`, `dark-changes-narrow.png`, `dark-task-pr-ok-wide.png` | Header not in prototype; tab strip with count badges and per-tab single active underline matches the design-spec 3.1 intent | V-1, V-2 |
| Shell + header | light | `light-changes-wide.png`, `light-changes-narrow.png`, `light-task-pr-ok-wide.png` | as above; light palette is distinct (warm neutrals, teal primary), not a dimmed copy of dark | V-1, V-2 |
| Changes canvas (tree, sections, hunks, collapsed file, branch review) | dark | `dark-changes-wide.png`, `-narrow`, `-scrolled`, `-collapsed-file`, `dark-comparison-menu.png`, `dark-branch-review-picker.png`, `-wide`, `-narrow`, `dark-changes-empty-wide.png`, `dark-changes-diff-error-wide.png` | `proto/review-canvas-populated-dark.png`, `-loading`, `-error`: tree sections STAGED/CHANGES with bulk actions, status chips, totals, Accept/Reject and the stale/binary/LFS rows are present; build defaults to split where the prototype shows one column | V-5, V-6, V-4 (filter input) |
| Changes canvas | light | `light-changes-wide.png`, `-narrow`, `-scrolled`, `-collapsed-file`, `light-comparison-menu.png`, `light-branch-review-*.png`, `light-changes-empty-*.png`, `light-changes-diff-error-wide.png` | `proto/review-canvas-populated-light.png`: Pierre light (white diff body, pale red/green rows, teal/pink Accept/Reject) matches | V-5, V-6, V-4 |
| Spot editor read-only / editable / dirty / disk conflict | dark | `dark-spot-editor-readonly-{wide,narrow}.png`, `-editable-clean.png`, `-dirty-{wide,narrow}.png`, `-conflict-dialog-{wide,narrow}.png`, `-stale.png` | `proto/spot-editor-{populated,readonly,conflict}-dark.png`: Back, path, Save, line numbers, three-button disk-conflict dialog all present; dialog matches in structure | V-7 |
| Spot editor | light | same names with `light-` | same prototypes, light | V-7 |
| Commit idle, filled, hook running, failure, success, nothing staged | dark | `dark-commit-idle-{wide,narrow}.png`, `-message-filled-*`, `dark-commit-running-{wide,narrow}.png`, `dark-commit-failure-*`, `dark-commit-success-*`, `dark-commit-nothing-staged.png`, `dark-conflict-commit-blocked-*` | `proto/commit-composer-{populated,empty,loading,error,success}-dark.png`: Staged count, Generate message, message area, primary Commit, Cancel + Committing... and a monospaced hook log all match; failure uses a red inline banner with the kept-message wording | V-1 (header), V-4 (textarea) |
| Commit | light | same names with `light-` | same prototypes, light (`light-commit-failure-wide.png`: pink banner, mono log, teal Commit) | V-4 |
| Task: worktrees, PR ok, PR quiet, add form | dark | `dark-task-{wide,narrow}.png`, `dark-task-add-form-*`, `dark-task-pr-ok-{wide,narrow}.png`, `dark-task-pr-quiet-{wide,narrow}.png` | `proto/task-worktree-{populated,empty,loading,error}-dark.png`: branch panel, PR with passing/failing/pending, Open PR, Worktrees (n) with Add, active/main badges, per-row remove; build adds ahead/behind arrows, stash count and last commit | V-2, V-8, V-9 |
| Task | light | same names with `light-` | same, light | V-2, V-8, V-9 |
| Conflict banner (real merge conflict) | dark | `dark-conflict-banner-changes-{wide,narrow}.png`, `dark-conflict-banner-only.png`, `dark-conflict-commit-blocked-*`, `dark-conflict-history.png` | `proto/conflict-banner-default-dark.png`: bordered card, left warning accent, warning icon chip, "Merge in progress - 2 files conflicted", Ask agent to resolve (primary), Abort (red). Build lists each file on its own row with its own Open in editor (prototype: one comma list and one button) | none (deviation acceptable) |
| Conflict banner | light | same names with `light-` | same, light | none |
| History: commits, root commit, stashes, empty, unavailable | dark | `dark-history-commits-{wide,narrow}.png`, `dark-history-stashes-{wide,narrow}.png`, `dark-history-stash-hover.png`, `dark-history-empty-wide.png`, `dark-history-unavailable-wide.png` | `proto/history-timeline-{populated,empty}-dark.png`: Stashes (n) with Apply/Pop/drop, "Commits since main" list with sha, subject, author, age; matches. The root commit is not in "since main" for this repo, so a root-commit row was not rendered in the real run (`history-root-commit` is covered by `conflict-and-history-axe.spec.ts`) | V-8 |
| History | light | same names with `light-` | same, light | V-8 |
| Chat change-set card | dark | `dark-chat-card.png`, `dark-chat-card-window.png`, `dark-chat-card-focus-row.png`, `dark-chat-card-focus-review.png`, `dark-chat-card-after-review-click.png` | `proto/change-set-card-populated-dark.png`: header icon + "N files changed" + totals + single primary Review, one row per file with status chip, path, counts, chevron; 130-char path left-truncated, 4-digit counts fit | none new (P3 findings verified fixed: ring visible) |
| Chat change-set card | light | same names with `light-` | `proto/change-set-card-populated-light.png`: matches; the row focus ring is now 2 px and visible (`light-chat-card-focus-row.png`) | none |

States not captured: the Changes body `review-shell-body-loading` skeleton (the shell fills too quickly to catch it, no spinner frame obtained), the hook-running state with the Cancel button focused, and a root-commit row in the real History run (see above).

## Prototype fidelity

- Approved prototype: `.ptah/specs/TASK_2026_576_e16a/prototype/index.html` and the seven page files; design-spec sections 3-12.
- Assessment: MATCHES in structure, component choice and action hierarchy for Commit, Task, Conflict banner, History, change-set card and the spot-editor dialogs; DEVIATES in the Changes canvas density (split + wrapped section headers + stacked toolbar, V-5/V-6) and in the spot-editor stale bar (V-7).
- Acceptable deviations (no action): status chip is the neutral chip with a hue-accent border (`ptah-file-status-badge`, approved at Gate 2), reconciled rows use muted text; conflict banner lists files one per row with a per-file Open in editor; Task adds ahead/behind arrows, stash count and last commit row; commit composer's idle button is dimmed instead of hidden; History shows author next to the age; icons are lucide not Unicode glyphs; Pierre renders the diff (the prototype is static markup) so the toolbar sits in Pierre's annotation slot.
- Defects against the prototype: V-5 (toolbar and split layout at narrow canvas widths), V-6 (header height), V-7 (loud stale bar, no dirty marker).
- No banned component or substituted control was found (badges, tooltips and hints are present where the prototype has them).

## Theme check

Light is a distinct design, not a washed-out copy: warm off-white surfaces (`base-100` page, darker `base-200` rails), teal primary buttons and tab underline, pink-red destructive actions, dark-amber focus rings, white Pierre diff body with pale red/green rows. Text contrast at a glance holds (axe already gates it). Only the faint input rings (V-4) and the transparent caret ring (V-3) differ from the buttons' rings.

## Accessibility notes (supplementary to axe)

- Focus order recorded per surface (`{theme}-real-metrics.json`, `focus` array): Changes tab, tabpanel, comparison, filter, split, unified, tree row, row actions, Open in, Open-in caret; Task: refresh, choose editor, caret, Add, worktree rows, remove; Conflict: per-file Open in editor, Ask agent, Abort, tab, tabpanel. All reachable; every stop shows a 2 px ring except the open-in caret (V-3) and the 20 %-alpha text inputs (V-4).
- Targets: the header and row action buttons are `btn-xs` (24 px) as measured in P3; no new target-size failure was seen.

## Verdict

- Recommendation: REVISE.
- Confidence: HIGH on V-1 to V-4 (reproduced in both themes with metrics and screenshots), MEDIUM on completeness (loading skeleton and a real root-commit row not captured; V-4 contrast is estimated from the computed outline alpha, not sampled from pixels).
- Key concern: the dock header and tab strip clip and overlap at the dock's allowed minimum width and with long branch names (V-1, V-2), which hides Push and part of the History tab.
- Fix order: V-2 and V-1 (one header change), V-3 and V-4 (focus tokens), then V-5 to V-9 as the cutover follow-up bucket.
