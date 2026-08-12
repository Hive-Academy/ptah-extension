# Requirements Document — TASK_2026_173

**Title**: Editor panel — git-diff correctness, measured performance, and hunk-level stage/revert
**Type**: FEATURE (correctness remediation + performance + new interaction surface)
**Priority**: P1 (contains P0-class correctness defects — see Introduction)
**Complexity**: XL (>8h; multi-phase)
**Primary surface**: `libs/frontend/editor` (Angular 21) + `libs/backend/vscode-core` git path + `apps/ptah-electron` watcher
**Source of findings**: `.ptah/specs/TASK_2026_173/context.md` (15 findings, A–D)

---

## Evidence Verification

Eight of the fifteen file:line references in `context.md` were independently spot-checked against the working tree before these requirements were written. **All eight hold.** Two carry trivial line drift that does not affect the finding:

| Finding | Claimed                                                                                                                                            | Actual                                        | Status                                                                                                          |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| A1      | `editor-diff-split.ts:29-36` early-return                                                                                                          | exact                                         | Confirmed                                                                                                       |
| A1      | `editor-workspace.ts:348-353` reread loop                                                                                                          | `:343-355` (loop body `:349-353`)             | Confirmed. Note: loop skips `isDirty` tabs; diff tabs are created with `isDirty: false`, so they are still hit. |
| A2      | `source-control-panel.component.ts:110`, `:158` identical `diffRequested`                                                                          | `:111`, `:159`                                | Confirmed (off-by-one)                                                                                          |
| A3      | `git-info.service.ts:416-429` returns `{ content: '' }` on non-zero exit and on throw, RPC still succeeds                                          | exact                                         | Confirmed                                                                                                       |
| A4      | `editor-diff-split.ts:54-62` hard-requires `editor:openFile`                                                                                       | exact                                         | Confirmed                                                                                                       |
| B1      | `editor-panel.component.ts:254` `@if (activeDiffTab())` structural swap                                                                            | exact                                         | Confirmed                                                                                                       |
| B2      | `diff-view.component.ts:214-229` dispose+recreate models, reads `window.monaco`                                                                    | exact                                         | Confirmed                                                                                                       |
| B3      | `file-tree-node.component.ts:284-304` per-node linear scan of `fileStatusMap`                                                                      | exact                                         | Confirmed                                                                                                       |
| B4      | watcher skips only `node_modules`/`dist`/`.git`                                                                                                    | `git-watcher.service.ts:378-393`              | Confirmed                                                                                                       |
| D1      | nested `<button>`: close inside tab (`editor-panel:229` inside `:206`), unstage-all inside section header (`source-control-panel:92` inside `:78`) | exact                                         | Confirmed                                                                                                       |
| D2/D3   | `readOnly: true` `:158`, `renderSideBySide: true` `:159`, `renderMarginRevertIcon: false` `:162`                                                   | `renderMarginRevertIcon` is `:162` not `:161` | Confirmed (off-by-one)                                                                                          |

No finding was invalidated. Downstream agents should treat `context.md` as accurate and re-resolve line numbers at implementation time (the tree will drift).

---

## Introduction

### Business context

The editor panel is Ptah's in-product code surface — the thing that makes Ptah an IDE rather than a chat box. Its Source Control view is the surface where users decide what to commit. Group A of this evaluation establishes that **that surface currently produces silently wrong output**.

This distinction drives the whole priority ordering, so it is worth stating plainly: A1–A4 are not "the diff is slow" or "the diff is ugly". They are **the diff shown to the user does not correspond to the state of their repository, and the UI gives no indication that anything is wrong.**

- **A1**: after a commit, stage, or discard, an already-open diff tab keeps rendering pre-operation content forever. Clicking the file again in Source Control re-activates the same stale tab. There is no visual cue and no way to force a refresh short of closing the tab.
- **A2**: the _Staged Changes_ row and the _Changes_ row are wired to the same handler and produce the same `HEAD ↔ worktree` comparison keyed on the same tab. For a partially-staged file, the row labelled "staged" shows changes the user deliberately left **unstaged**. A user reviewing a staged diff before committing is being shown a superset of what they are about to commit.
- **A3**: when `git show` fails, the backend returns success with empty content. The UI interprets empty-original as "new file" and renders the entire file as an addition. A transient git failure is visually indistinguishable from a genuine new file.
- **A4**: deleted files cannot be diffed at all — the user gets an error toast instead of the `HEAD ↔ empty` diff that is correct.

A tool that quietly lies about repository state is worse than one that fails loudly, because the user makes commit decisions on top of it. This is why A is sequenced first and why D2 (hunk staging) — which _writes_ to the git index based on what the diff shows — is a hard-blocked dependent, not a parallel workstream.

### Why performance is in the same task

Group B is not cosmetic either. B1 tears down the entire Monaco diff editor on every tab switch — a teardown this same library was explicitly rewritten to eliminate for the code editor (`code-editor.component.ts:25-50`, TASK_2026_154). B3 is O(directories × changed files) recomputed on every git push; in this monorepo a rebase means six figures of string comparison per event. B4 makes the Electron host shell out to `git status --porcelain=v2` every 2 seconds throughout any build because the watcher's ignore list is narrower than the tree builder's. These degrade the same surface the correctness fixes are trying to make trustworthy, and several touch the same files.

### Scope decision

At Checkpoint 0 the user selected **full scope, all 15 findings, including hunk-level stage/revert (D2)**. Options declined: correctness-only (A), correctness+performance (A+B), and full-minus-hunk-staging (A+B+C+D1/D3).

---

## Requirements

Requirements are grouped A/B/C/D matching `context.md`. Each is written so a tester can execute the acceptance criteria without reading source. `SHALL` denotes a mandatory outcome.

---

### Group A — Git diff correctness (P0 within this task)

#### Requirement A1 — Open diff tabs reflect current repository state

**User Story:** As a developer reviewing changes in the editor panel, I want an open diff tab to update when the underlying git state changes, so that I never make a commit decision based on a diff that no longer matches my repository.

**Acceptance Criteria**

1. GIVEN a diff tab is open for a modified file, WHEN the user commits that file (from Ptah's Source Control panel, an external terminal, or another IDE), THEN the open diff tab SHALL re-render to reflect post-commit state without the user closing and reopening the tab.
2. GIVEN a diff tab is open for a modified file, WHEN the user stages that file, THEN the diff tab SHALL reflect the new staged/unstaged split within the refresh debounce window.
3. GIVEN a diff tab is open, WHEN the user discards the working-tree changes for that file, THEN the diff tab SHALL render an empty (no-change) diff or close itself with an explicit reason — it SHALL NOT continue displaying the discarded changes.
4. GIVEN a diff tab is open, WHEN the user clicks the same file again in the Source Control panel, THEN the tab SHALL be activated **and** its content SHALL be revalidated against current git state.
5. GIVEN one or more diff tabs are open, WHEN a git refresh event fires, THEN the system SHALL NOT issue any RPC that is guaranteed to fail (specifically: no `editor:openFile` call against a synthetic `diff:`-prefixed key). Verification: capture the RPC log across 5 consecutive git operations with 3 diff tabs open; the count of failed RPC calls SHALL be 0.
6. GIVEN a diff refresh is in flight, WHEN the user interacts with the tab, THEN the UI SHALL NOT flicker to an empty state; the previous content SHALL remain until the new content resolves.
7. GIVEN a diff refresh fails, WHEN the failure is detected, THEN the user SHALL see an explicit stale/error indicator on the tab — silent staleness is a defect.

#### Requirement A2 — Staged and unstaged rows show distinct, correct comparisons

**User Story:** As a developer preparing a commit, I want the _Staged Changes_ row to show exactly what I am about to commit and the _Changes_ row to show exactly what I am not, so that I can partially stage a file with confidence.

**Acceptance Criteria**

1. GIVEN a file with both staged and unstaged modifications, WHEN the user opens the diff from the **Staged Changes** row, THEN the diff SHALL show `HEAD ↔ index` and SHALL NOT include any unstaged hunk.
2. GIVEN the same file, WHEN the user opens the diff from the **Changes** row, THEN the diff SHALL show `index ↔ working tree` and SHALL NOT include hunks that are already staged.
3. GIVEN the same file, WHEN the user opens both rows' diffs, THEN two distinct tabs SHALL exist simultaneously, each independently addressable and closable.
4. GIVEN two distinct diff tabs for the same file, WHEN the user reads the tab labels, THEN each label SHALL unambiguously identify which comparison it shows (staged vs working-tree) without requiring hover.
5. GIVEN a diff tab of either kind, WHEN the tab is persisted and the workspace is reopened, THEN the tab SHALL restore the same comparison it had, or SHALL be discarded — it SHALL NOT silently restore as the other comparison.
6. GIVEN a file staged as a rename (`R` status), WHEN the user opens its staged diff, THEN the diff SHALL compare the correct pre-rename source path against the post-rename path.

#### Requirement A3 — Git read failures are reported, never disguised as content

**User Story:** As a developer, I want a failed git read to be shown to me as a failure, so that I do not mistake a broken read for a legitimately new file.

**Acceptance Criteria**

1. GIVEN `git show` for a path exits non-zero for a reason other than "path does not exist at that revision", WHEN the diff is requested, THEN the RPC response SHALL indicate failure and the UI SHALL display an error state — it SHALL NOT render the file as a new file.
2. GIVEN `git show` legitimately reports that the path does not exist at the base revision (a genuinely new/untracked file), WHEN the diff is requested, THEN the UI SHALL render the "(new file)" presentation as it does today. This case SHALL be distinguishable in the response from case 1.
3. GIVEN a git read throws (binary not found, repository corrupt, permission denied), WHEN the diff is requested, THEN the error SHALL be surfaced to the user with an actionable message and SHALL be written to the log with the underlying cause.
4. GIVEN any git error is surfaced to the user, WHEN the message is rendered, THEN it SHALL NOT leak absolute filesystem paths outside the workspace or raw stderr containing credentials.
5. GIVEN an empty file that is genuinely tracked and unchanged at HEAD, WHEN diffed, THEN it SHALL render as an empty diff, not as a new file and not as an error.

> **Regression risk, called out deliberately**: `git:showFile` currently swallows every failure. Fixing this will make previously-invisible failures visible. Some of those may be pre-existing bugs elsewhere (path normalization, submodules, workspace-root resolution, non-UTF8 content). Discovering them is the _point_, but see Risk R-3 — the team must budget for triage rather than reflexively re-suppressing.

#### Requirement A4 — Deleted files are diffable

**User Story:** As a developer reviewing a deletion before committing it, I want to see what was in the file, so that I can confirm the deletion is intentional.

**Acceptance Criteria**

1. GIVEN a file with git status `D` (deleted in working tree), WHEN the user clicks it in Source Control, THEN a diff SHALL open showing the HEAD content on the original side and empty on the modified side.
2. GIVEN a file staged as deleted, WHEN opened from the _Staged Changes_ row, THEN the same `HEAD ↔ empty` diff SHALL render.
3. GIVEN a deleted file's diff is open, WHEN the user reads the tab, THEN the tab SHALL be clearly marked as a deletion.
4. GIVEN a deleted file, WHEN its diff is opened, THEN no error toast SHALL be shown.
5. GIVEN a file that is untracked (status `?`), WHEN the user opens its diff, THEN the empty-original / full-addition presentation SHALL render without error (the inverse case).

---

### Group B — Performance

> **All of Group B is governed by Requirement B0. No performance item may be marked complete on the basis of code inspection alone.**

#### Requirement B0 — Performance claims are measured, not asserted

**User Story:** As the maintainer of this codebase, I want each performance fix accompanied by a before/after measurement captured with a repeatable method, so that the improvement is provable and future regressions are detectable.

**Acceptance Criteria**

1. GIVEN work begins on B1, B3, B4, or B5, WHEN the fix is implemented, THEN a **baseline** measurement SHALL have been captured on the pre-fix code and an **after** measurement on the post-fix code, using the same method, machine, and workload.
2. GIVEN both measurements exist, WHEN the work is submitted, THEN both numbers SHALL be recorded in the task's progress artifact with the workload definition, the sample count, and the measurement method — sufficient for a third party to reproduce.
3. GIVEN a measurement is reported, WHEN it is a latency figure, THEN it SHALL be reported as a median over **at least 10 samples**, with the max also recorded. Single-shot numbers are not acceptable.
4. GIVEN a fix does not achieve its stated target, WHEN it is submitted, THEN it SHALL be flagged explicitly rather than reported as a pass.
5. **Electron is the reference runtime** for all measurements (it is the only host with the full watcher path).

**Defined metrics** (these are the required measurements; targets are outcome requirements, not implementation direction):

| ID     | Metric                                                                                                                  | Workload                                                                                                | Target                                                                                              |
| ------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **M1** | Diff-tab re-display latency — time from click on an already-open diff tab to the diff editor being painted with content | Return to a diff tab for a ~500-line TypeScript file after switching to a file tab and back; 10 samples | Median ≥70% below baseline, and ≤100 ms absolute                                                    |
| **M2** | `git:status-update` handling cost — wall time from message receipt to change-detection settling                         | ≥300 changed files, ≥100 expanded directory nodes in the file tree                                      | Median ≥80% below baseline; cost SHALL NOT grow multiplicatively with (directories × changed files) |
| **M3** | `git status` invocation count attributable to build-cache churn                                                         | Run a build that writes to `.nx/cache` and `.angular/cache` for 60 s with the editor panel open         | 0 invocations triggered by paths the file-tree builder already excludes (baseline expected ≈30)     |
| **M4** | Change-detection passes per second during a sidebar drag                                                                | Drag the sidebar splitter continuously for 2 s                                                          | ≤1 change-detection pass per animation frame; median ≥50% below baseline                            |

#### Requirement B1 — The diff editor survives tab switching

**User Story:** As a developer switching between a diff tab and a file tab, I want returning to the diff to be instant, so that comparing a diff against other files is not punished by a full editor rebuild each time.

**Acceptance Criteria**

1. GIVEN a diff tab is open, WHEN the user switches to a file tab and back, THEN the diff editor instance SHALL NOT be destroyed and recreated. Verification: instrument or observe that no new diff-editor construction occurs on the return switch.
2. GIVEN the round-trip in AC1, WHEN measured per M1, THEN the target in M1 SHALL be met.
3. GIVEN a diff tab is open, WHEN the user switches away and back, THEN scroll position and any collapsed-region state in the diff SHALL be preserved.
4. GIVEN multiple diff tabs are open, WHEN switching among them, THEN each SHALL restore its own view state, not another tab's.
5. GIVEN a diff tab is **closed** (not switched away from), WHEN the close completes, THEN its Monaco resources SHALL be released — no unbounded growth. Verification: open and close 30 diff tabs; retained Monaco model count SHALL return to its starting value ±2.
6. GIVEN the workspace is switched, WHEN the new workspace has no active diff, THEN the diff host SHALL NOT throw and SHALL NOT leave a stale diff visible.

> The reference implementation for this pattern already exists in this library — `CodeEditorComponent`'s always-mounted host and model/view-state cache (`code-editor.component.ts:25-50`, `editor-panel.component.ts:240-252`). Consistency with it is a requirement of C-group, not just a convenience.

#### Requirement B2 — Diff content updates without full model rebuild

**User Story:** As a developer with a diff open while the file changes, I want the diff to update smoothly, so that content updates do not cost a full re-tokenize and a visible stall.

**Acceptance Criteria**

1. GIVEN a diff editor is displaying content, WHEN the underlying content changes, THEN the diff SHALL update **without** disposing and recreating both Monaco models.
2. GIVEN a content update occurs, WHEN it completes, THEN syntax highlighting SHALL be correct and SHALL NOT visibly flash to unstyled text.
3. GIVEN a content update occurs, WHEN the language of the file has changed (e.g. rename across extensions), THEN the language SHALL be updated correctly.
4. GIVEN the Monaco API is needed at update time, WHEN it is accessed, THEN it SHALL come from the resolved loader handle, not a direct global lookup. Verification: with the global unavailable, updates SHALL still function.
5. GIVEN repeated rapid content updates (10 in 2 s), WHEN they complete, THEN no Monaco models SHALL be leaked.

#### Requirement B3 — Directory change indicators scale with the repository

**User Story:** As a developer working in a large monorepo, I want the file tree to stay responsive after a rebase or branch switch, so that a large git event does not freeze the panel.

**Acceptance Criteria**

1. GIVEN ≥300 changed files and ≥100 expanded directory nodes, WHEN a `git:status-update` arrives, THEN handling SHALL meet target M2.
2. GIVEN any number of changed files, WHEN a single directory node evaluates whether it has changed children, THEN that evaluation SHALL be effectively constant-time with respect to the number of changed files.
3. GIVEN a git status update, WHEN it is processed, THEN directory indicator dots SHALL be correct — every directory that transitively contains a changed file SHALL be marked, and no directory without one SHALL be marked.
4. GIVEN a multi-root workspace, WHEN a status update arrives for one workspace, THEN indicators for other workspaces SHALL NOT be affected. (Workspace partitioning is a standing rule of this lib.)
5. GIVEN paths with mixed separators (Windows `\` and POSIX `/`), WHEN indicators are computed, THEN they SHALL be correct on both. Windows is the primary development platform for this project.
6. GIVEN a file's change is reverted, WHEN the next status update arrives, THEN the parent directory indicators SHALL clear.

#### Requirement B4 — The file watcher ignores what the file tree already ignores

**User Story:** As a developer running a build while the editor panel is open, I want the panel to stay idle, so that build-cache churn does not trigger a git shell-out and a full tree refetch every two seconds.

**Acceptance Criteria**

1. GIVEN a build is writing to build-cache directories that the file-tree builder already excludes, WHEN the watcher observes those writes, THEN it SHALL NOT schedule a git status update or a tree refresh. Verification per M3.
2. GIVEN the watcher's exclusion behaviour and the file tree's exclusion behaviour, WHEN a path is tested, THEN both SHALL agree. There SHALL be a single source of truth for the exclusion set — divergence between the two lists is the defect being fixed, and reintroducing a second hand-maintained list SHALL be treated as not-done.
3. GIVEN a genuine source-file change, WHEN the watcher observes it, THEN status update and tree refresh SHALL still fire as they do today. Verification: modify a tracked source file during the M3 workload; the change SHALL appear in Source Control within the existing debounce window.
4. GIVEN a `.gitignore`d directory that the user has explicitly opened in the tree, WHEN it changes, THEN behaviour SHALL be consistent with the tree's own visibility rules — the fix SHALL NOT make user-visible files stop updating.
5. GIVEN the exclusion set is changed, WHEN the VS Code and CLI runtimes are exercised, THEN neither SHALL regress. (The watcher is Electron-only; the exclusion set may not be.)

#### Requirement B5 — Drag interactions do not defeat their own optimization

**User Story:** As a developer resizing panes, I want dragging to feel smooth, so that resizing the sidebar or editor split does not stutter.

**Acceptance Criteria**

1. GIVEN a pane splitter is being dragged, WHEN pointer movement occurs, THEN change detection SHALL run at most once per animation frame, not once per pointer event. Verification per M4.
2. GIVEN a drag is in progress, WHEN the user releases, THEN the final pane size SHALL exactly match the release position — coalescing SHALL NOT lose the last update.
3. GIVEN a drag is interrupted (pointer leaves the window, ESC, window blur), WHEN the drag ends, THEN no stray listener or pending frame callback SHALL remain.
4. GIVEN all three drag surfaces in the editor panel, WHEN each is exercised, THEN all three SHALL behave per AC1–AC3.
5. GIVEN a drag is performed, WHEN it completes, THEN the resulting layout SHALL be visually identical to current behaviour — this is a performance fix with no intended UX change.

---

### Group C — Architecture consistency

#### Requirement C1 — Inbound messages use the library's mandated handler pattern

**User Story:** As a maintainer of the editor library, I want all inbound host messages to arrive through one registered pathway, so that message handling is discoverable, testable, and disposable rather than scattered across raw global listeners.

**Acceptance Criteria**

1. GIVEN the editor library at completion, WHEN searched for raw global `message` event listeners, THEN there SHALL be none in editor services — all inbound host messages SHALL be registered through the library's mandated handler multi-provider (guideline #1 of `libs/frontend/editor/CLAUDE.md`).
2. GIVEN each message type currently handled by a raw listener (git status updates, file-tree change, file-content change, reread-open-tabs), WHEN it arrives after the change, THEN the observable behaviour SHALL be unchanged — including existing debounce windows.
3. GIVEN the services owning those listeners are destroyed, WHEN destruction completes, THEN no handler SHALL remain registered and no timer SHALL remain pending.
4. GIVEN the consolidation, WHEN a new message type is added in future, THEN there SHALL be exactly one place to add it.
5. GIVEN the change, WHEN VS Code, Electron, and CLI hosts are exercised, THEN message delivery SHALL work in all three.

#### Requirement C2 — Split-pane editing cannot silently lose work

**User Story:** As a developer with the same file open in both panes, I want both my edits preserved or the conflict made explicit, so that I never silently lose work to a last-writer-wins save.

**Acceptance Criteria**

1. GIVEN the same file is open in the left pane and the split pane, WHEN the user edits in one pane, THEN the other pane's view SHALL either reflect that edit or SHALL be visibly marked as diverged. Silent divergence SHALL NOT occur.
2. GIVEN the same file is edited in both panes, WHEN the user saves from either pane, THEN the save SHALL NOT discard the other pane's edits without the user being informed.
3. GIVEN a save would overwrite unsaved changes from the other pane, WHEN the save is attempted, THEN the user SHALL be prompted or the changes SHALL be reconciled — the operation SHALL NOT complete silently.
4. GIVEN the same file is open in both panes and the user saves, WHEN the save completes, THEN the dirty indicator SHALL be correct in both panes.
5. GIVEN **different** files in the two panes, WHEN either is edited and saved, THEN behaviour SHALL be exactly as today — this requirement SHALL NOT degrade the ordinary split-pane case.
6. GIVEN the independent Monaco models per pane (a deliberate design decision, `code-editor.component.ts:202-208`), WHEN this requirement is satisfied, THEN that decision SHALL be preserved — the save path is what changes, not the model strategy.

---

### Group D — UX and accessibility

#### Requirement D1 — Interactive controls have valid, accessible semantics

**User Story:** As a keyboard or screen-reader user, I want every control in the editor panel to be individually reachable and correctly announced, so that I can close a tab or stage all files without a mouse.

**Acceptance Criteria**

1. GIVEN the rendered editor panel and source-control panel, WHEN the DOM is validated, THEN there SHALL be no nested interactive elements (no `<button>` inside `<button>`).
2. GIVEN an open editor tab, WHEN the user tabs through with the keyboard, THEN the tab-select control and the tab-close control SHALL each receive focus independently and SHALL each be activatable via Enter and Space.
3. GIVEN the Staged Changes / Changes section headers, WHEN the user tabs through, THEN the section expand-collapse control and the stage-all / unstage-all control SHALL each be independently focusable and activatable.
4. GIVEN a screen reader, WHEN focus lands on each of the above controls, THEN it SHALL announce a distinct, accurate label and role.
5. GIVEN the semantics are corrected, WHEN a nested control is activated, THEN the outer control SHALL NOT also fire — and this SHALL hold **without** relying on event-propagation suppression as the mechanism.
6. GIVEN the corrections, WHEN the panel is viewed, THEN the visual appearance SHALL be unchanged from current.
7. GIVEN focus is on any control, WHEN it is focused via keyboard, THEN a visible focus indicator SHALL be present.

#### Requirement D2 — Hunk-level stage and revert (THE FEATURE — must land last)

**User Story:** As a developer preparing a focused commit, I want to stage or revert individual hunks directly from the diff view, so that I can split a messy working tree into clean commits without leaving Ptah for the terminal or VS Code's SCM view.

**Blocking precondition:** A1, A2, A3, and A4 SHALL be complete and verified before any hunk write-path work is merged. Rationale in "Sequencing Constraints" below — this is a data-integrity constraint.

**Acceptance Criteria**

1. GIVEN a diff view with multiple hunks, WHEN the user hovers or focuses a hunk, THEN stage and revert affordances for that hunk SHALL be available.
2. GIVEN an unstaged hunk, WHEN the user stages it, THEN **only that hunk** SHALL move to the index. All other hunks in the file SHALL remain in their prior state. Verification: `git diff` and `git diff --cached` after the operation SHALL show exactly the expected split.
3. GIVEN a staged hunk, WHEN the user unstages it, THEN only that hunk SHALL leave the index.
4. GIVEN a hunk in the working tree, WHEN the user reverts it, THEN only that hunk's changes SHALL be discarded from the working tree; the file's other modifications SHALL survive.
5. GIVEN a revert is requested, WHEN it would discard unrecoverable work, THEN the user SHALL be required to confirm. Revert SHALL NOT be a single unconfirmed click.
6. GIVEN the diff snapshot the user is acting on is **stale** relative to the repository (file changed on disk or in the index since the diff was loaded), WHEN a stage or revert is attempted, THEN the operation SHALL be **refused** with a clear message and the diff SHALL refresh. It SHALL NOT be applied optimistically. This is the single most important criterion in this requirement.
7. GIVEN a stage or revert operation, WHEN the underlying git apply fails for any reason, THEN the repository SHALL be left in its pre-operation state (no partial application) and the user SHALL be told the operation failed and why.
8. GIVEN a completed stage or revert, WHEN it succeeds, THEN the diff view, the Source Control panel counts, and the file-tree indicators SHALL all update to the new state without a manual refresh.
9. GIVEN a file with CRLF line endings, or no trailing newline, or non-ASCII content, WHEN a hunk is staged or reverted, THEN the resulting file content SHALL be byte-identical to what the equivalent `git` command-line operation produces.
10. GIVEN a binary file, WHEN its diff is opened, THEN hunk actions SHALL be unavailable rather than present-and-broken.
11. GIVEN the diff view supports hunk actions, WHEN the user has no intention of using them, THEN read-only diff viewing SHALL remain unchanged — no accidental edits to the diff panes SHALL be possible outside the explicit hunk actions.
12. GIVEN a new RPC namespace is introduced for the apply operation, WHEN it is registered, THEN it SHALL be registered in **both** the shared compile-time contract and the runtime allowlist (see NFR-4). A missing runtime registration is a silent crash.
13. GIVEN the apply capability, WHEN it is implemented, THEN it SHALL be reachable through a platform port rather than added only inside one host adapter (see NFR-5).
14. GIVEN hunk actions are available, WHEN a keyboard user navigates the diff, THEN hunk stage/revert SHALL be reachable and activatable by keyboard.

#### Requirement D3 — Inline / side-by-side diff toggle

**User Story:** As a developer viewing a diff in a narrow pane, I want to switch to an inline (unified) layout, so that the diff is readable when the sidebar takes most of the width.

**Acceptance Criteria**

1. GIVEN a diff view, WHEN the user activates the layout toggle, THEN the diff SHALL switch between side-by-side and inline/unified rendering.
2. GIVEN the layout is toggled, WHEN the switch occurs, THEN scroll position SHALL be preserved as closely as the rendering allows, and the diff editor SHALL NOT be destroyed and recreated (consistency with B1).
3. GIVEN a layout preference is chosen, WHEN a new diff tab is opened, THEN it SHALL use the last-chosen layout.
4. GIVEN the layout preference, WHEN the application is restarted, THEN the preference SHALL persist.
5. GIVEN the toggle control, WHEN reached by keyboard, THEN it SHALL be focusable, labelled, and activatable.
6. GIVEN hunk actions (D2) are present, WHEN inline layout is active, THEN hunk actions SHALL remain functional and correctly targeted in that layout.

---

## Sequencing Constraints (mandatory)

These are requirements, not scheduling preferences. Violating either produces user-visible data corruption.

### SEQ-1 — A1 and A2 SHALL be delivered as a single unit of work

**Constraint:** A1 (diff tabs refresh) and A2 (staged vs unstaged comparison) SHALL be planned, implemented, reviewed, and merged as one indivisible change. They SHALL NOT be split across separate batches or separate PRs.

**Justification:** Both defects live in the same mechanism. A diff tab is currently keyed on `diff:${relativePath}` alone. A2's fix requires the key to distinguish which comparison the tab holds (staged vs working-tree); A1's fix requires the tab to carry the base revision and comparison identity so it can be revalidated. Both are changes to the same tab-identity scheme. Landing one without the other yields a scheme that is half-migrated: fixing A2 alone gives two tabs that both go stale; fixing A1 alone gives correct refresh of a comparison that is still the wrong comparison. Either intermediate state is shippable-looking and wrong, and the second change would have to rewrite the first.

**Verification:** the diff of the delivered change SHALL show the tab-key scheme changed exactly once.

### SEQ-2 — D2 (hunk stage/revert) SHALL land last

**Constraint:** No part of the hunk stage/revert write path SHALL be merged until A1, A2, A3, and A4 are complete and independently verified against their acceptance criteria.

**Justification — this is data integrity, not preference.** A hunk stage/revert takes the diff currently on screen and applies a derived patch to the user's git index or working tree. That operation is only as correct as the diff it is derived from.

- Against **A1 unfixed**: the diff on screen may be an arbitrarily old snapshot. Applying a patch derived from it against the current index means applying changes the user already committed, or reverting a hunk to content that no longer exists. Best case the apply fails; worst case it applies cleanly at a shifted offset and silently corrupts the file.
- Against **A2 unfixed**: the "staged" diff is actually `HEAD ↔ worktree`. Staging a hunk from it stages content the user deliberately left unstaged. The user believes they are curating a commit and is instead being handed the opposite of what they selected.
- Against **A3 unfixed**: a failed git read renders as "new file, all additions". Staging a hunk from that view stages a fabricated addition of an entire file whose real HEAD content was never read.
- Against **A4 unfixed**: deleted-file diffs do not open at all, so the deletion case cannot even be exercised.

The git index is the user's staging area for work they are about to commit and, in the revert case, the working tree holds work that may exist nowhere else. Corruption here is not recoverable by undo. D2 therefore ships only on a foundation whose correctness has been demonstrated.

### SEQ-3 — Recommended overall order

1. **A1+A2 together** (SEQ-1), then **A3**, then **A4**. A3 before A4 because A4's correct behaviour (`HEAD ↔ empty`) depends on being able to distinguish "no content at this revision" from "read failed" — which is exactly what A3 establishes.
2. **B0 baselines captured** before any B fix. Baselines SHALL be taken on code that already includes the A-group fixes if those fixes touch the measured path, so that before/after is apples-to-apples.
3. **B1, B2, B3, B4, B5** — largely independent of each other; B1 and B2 both touch the diff view and should be coordinated.
4. **C1, C2** — C1 touches the same message plumbing A1 relies on; if it is done before A1 it will conflict, so it follows A.
5. **D1, D3** — independent, low risk, may run in parallel with B/C.
6. **D2 last** (SEQ-2).

---

## Non-Functional Requirements

**NFR-1 — Test baseline SHALL NOT regress.**
The Electron test baseline before this task is **143 passed / 4 skipped**. At completion the suite SHALL show ≥143 passed and ≤4 skipped. Converting a failing test to skipped is a regression. New behaviour introduced by this task SHALL add tests — in particular A1–A4 and D2 acceptance criteria SHALL have automated coverage, since they are correctness claims about output the user cannot easily verify by eye.

**NFR-2 — Angular conventions.**
`ChangeDetectionStrategy.OnPush` mandatory on every component touched or added. Signals + `inject()` exclusively. No `[innerHTML]` on any AI- or git-derived content. Standalone components. New editor/git state SHALL be workspace-partitioned per the library's guideline #2.

**NFR-3 — Type safety and validation.**
`catch (error: unknown)` narrowed before use. Zod validation at every external boundary crossed by new code — specifically any new RPC payload for the hunk-apply path (D2) SHALL be validated on the backend side before touching git. No `@ts-ignore` without `@ts-expect-error` plus a reason.

**NFR-4 — RPC dual-registration.**
Any new RPC namespace introduced by this task (D2's apply path, and any new diff-fetch method for A2/A4) SHALL be registered in **both**:

- the compile-time contract in `libs/shared/.../rpc.types.ts`, and
- the runtime allowlist `ALLOWED_METHOD_PREFIXES` in `libs/backend/vscode-core/src/messaging/rpc-handler.ts` (~line 46).

Registering only the first compiles cleanly and crashes silently at runtime. Verification: exercise every new RPC method end-to-end in Electron before submission.

**NFR-5 — Hexagonal boundaries and three-runtime support.**

- New git capability SHALL be expressed as a port in `platform-core` with adapter implementations, **not** as a branch inside an existing adapter. `git-watcher.service.ts` is Electron-only; capability added there alone does not satisfy this requirement.
- Frontend libs SHALL NOT import backend libs and vice versa; `libs/shared` remains the only bridge.
- **VS Code, Electron, and CLI SHALL all continue to build and function.** Electron is the reference runtime for verification and measurement. Where a capability genuinely cannot exist in a runtime (e.g. no file watcher in CLI), the absence SHALL be a clean no-op, not a crash.

**NFR-6 — Marketplace safety.**
No new non-JS file (markdown, JSON manifest, template) shipped in the VSIX may contain trademarked AI product names. This task is unlikely to touch that surface, but any new user-facing copy SHALL be checked. A burned extension ID is permanent.

**NFR-7 — Responsiveness and correctness under load.**
No operation introduced by this task SHALL block the UI thread for >50 ms at the workloads defined in B0. Git operations SHALL be cancellable or debounced such that rapid successive git events do not queue unboundedly.

**NFR-8 — Security.**
Path inputs crossing the RPC boundary SHALL be validated against traversal (existing `validatePathSegment` behaviour SHALL be preserved, not bypassed by new methods). Error messages surfaced by A3's fix SHALL NOT leak raw stderr or paths outside the workspace root.

**NFR-9 — Concurrent-agent checkout safety.**
This repository is worked on by concurrent agents on a shared checkout. Work SHALL be confined to the files in scope. Failures originating outside this task's scope SHALL be reported and the batch stopped — not fixed opportunistically. Git hooks SHALL NOT be bypassed (`--no-verify` is forbidden).

---

## Out of Scope

The following are explicitly **not** part of TASK_2026_173:

1. **B6 — File-tree virtualization.** Expanding a large directory renders every node with no windowing. This is a real cliff but is not currently hit at the scale users operate at, and virtualizing the tree is a self-contained project with its own interaction and accessibility surface (keyboard navigation, screen-reader tree semantics, scroll restoration, drag-and-drop). Bundling it here would roughly double the task's size and put an unrelated large refactor in the same change set as a git-index write path — which directly conflicts with the caution SEQ-2 demands. **Recommendation: file as a separate follow-up task.** B3 (this task) removes the per-node scan cost, which is the sharper edge of the same problem; if B3's M2 measurement shows the tree is still slow at scale, that measurement becomes the justification for the virtualization task.
2. **Diff algorithm / rendering engine changes.** Monaco's diff computation is used as-is. No custom diff algorithm, no myers-vs-histogram tuning.
3. **Full VS Code SCM parity.** Merge-conflict resolution UI, three-way merge editor, blame annotations, interactive rebase, stash management UI, and commit-graph visualization are all out of scope. D2 delivers hunk stage/revert only.
4. **Commit authoring improvements.** Commit message UI, amend, sign-off, and hooks integration are untouched.
5. **New git providers or remote operations.** Push, pull, fetch, and remote authentication are untouched.
6. **Terminal, search, quick-open, worktree, branch-picker, and vim-mode subsystems** of the editor library, except where a shared service they depend on is changed by C1 — in which case the requirement is only that they do not regress.
7. **Chat, canvas, and any non-editor frontend surface.**
8. **Performance work on paths not named in B0.** If profiling during B-group work reveals additional hot paths, they SHALL be recorded as findings for a follow-up task, not absorbed into this one.

---

## Stakeholder Analysis

### Primary

| Stakeholder                              | Need                                                                                                  | Success criterion                                                                                                       |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Developers using Ptah's editor panel** | A diff they can trust and act on; responsiveness in a large monorepo                                  | Zero instances of stale/incorrect diff content across the A-group test matrix; M1–M4 targets met                        |
| **Developers curating commits**          | Hunk-level control without leaving Ptah                                                               | D2 acceptance criteria pass, including the stale-snapshot refusal (D2 AC6) and the byte-identical-to-git check (D2 AC9) |
| **Product owner (Ptah)**                 | Editor panel credible as an IDE surface; closes the largest functional gap against VS Code's SCM view | Task complete with no correctness regressions; D2 shipped                                                               |

### Secondary

| Stakeholder                               | Need                                                                  | Success criterion                                                                                          |
| ----------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Maintainers of `libs/frontend/editor`** | Consistency with the lib's own documented patterns; no new divergence | C1 satisfied; B1 uses the same pattern as `CodeEditorComponent`; B4 has a single exclusion source of truth |
| **QA**                                    | Executable acceptance criteria and a reproducible perf method         | Every requirement here testable without reading source; B0 measurements reproducible                       |
| **Users on Windows**                      | Correct path handling                                                 | B3 AC5 and D2 AC9 (CRLF) explicitly covered                                                                |
| **Release / marketplace**                 | No new scanner triggers                                               | NFR-6                                                                                                      |

### Stakeholder impact matrix

| Stakeholder                             | Impact   | Involvement                                    | Success criterion                               |
| --------------------------------------- | -------- | ---------------------------------------------- | ----------------------------------------------- |
| End users (developers)                  | **High** | Acceptance testing                             | No stale/wrong diffs; measured perf gains       |
| Product owner                           | High     | Scope decisions (already made at Checkpoint 0) | Full scope delivered incl. D2                   |
| Editor lib maintainers                  | Medium   | Design review                                  | Pattern consistency, no new architectural drift |
| QA                                      | Medium   | Verification                                   | 143/4 baseline held; new coverage for A and D2  |
| Multi-runtime (VS Code / CLI) consumers | Medium   | Regression testing                             | All three runtimes build and function           |

---

## Risk Register

| ID       | Risk                                                                                                                                                                                                                                                                                                                                                                                     | Probability | Impact       | Score | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                            | Contingency                                                                                                                                                                                                                |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R-1**  | **D2 corrupts the user's git index or destroys working-tree changes.** Hunk stage/revert writes to the index and the working tree. A wrong base revision, a stale snapshot, or an off-by-one hunk boundary silently destroys work the user cannot recover.                                                                                                                               | Medium      | **Critical** | **9** | SEQ-2 (A-group must land first and be verified); D2 AC6 (refuse on stale snapshot rather than apply optimistically); D2 AC7 (atomic — no partial application); D2 AC5 (confirm before destructive revert); D2 AC9 (byte-identical-to-git verification on CRLF / no-trailing-newline / non-ASCII); backend Zod validation of the apply payload (NFR-3); every hunk operation logged with enough detail to reconstruct what was applied | Ship D2 behind an explicit opt-in until it has soaked; if any corruption is observed in verification, D2 is cut from this task and the A/B/C/D1/D3 work ships without it                                                   |
| **R-2**  | **Diff tab-key change breaks cached/persisted workspace state.** SEQ-1 changes the tab identity scheme. Existing users have persisted tab state keyed the old way; on upgrade those entries are unrecognizable.                                                                                                                                                                          | High        | Medium       | **6** | Treat old-format diff tab entries as unrecognized and drop them cleanly on load rather than attempting to interpret them (A2 AC5 permits discard); ensure a dropped tab produces no error toast and no crash; test the upgrade path explicitly with pre-existing persisted state. **Per project policy this is a direct replacement — do not build a dual-format reader or a migration shim.**                                        | If dropping tabs proves user-hostile in practice, clear the diff-tab portion of persisted state wholesale on first run after upgrade                                                                                       |
| **R-3**  | **Fixing A3 surfaces previously-hidden failures to users.** `git:showFile` currently swallows every error into empty content. Making failures visible will expose whatever has been failing silently — potentially path-normalization bugs, submodule paths, workspace-root resolution, large or binary files, non-UTF8 content. Users may perceive this as "the new version is broken". | **High**    | Medium       | **6** | Before merging A3, deliberately exercise the failure surface: submodules, symlinks, paths with spaces and non-ASCII characters, binary files, files >10 MB, files added but never committed, detached HEAD, empty repository with no commits. Triage each newly-visible failure — fix root causes in scope where cheap, record the rest as follow-up findings. Error copy must be actionable, not raw stderr (A3 AC3, AC4, NFR-8)     | If the volume of newly-surfaced failures is large, gate: report genuine errors loudly, and treat the specific enumerated benign cases as their own explicit states — but never revert to the blanket empty-content swallow |
| **R-4**  | **Performance fixes are unverifiable.** All B findings are read from source, none measured. Without baselines the team may "fix" something that was not the bottleneck, or ship a regression.                                                                                                                                                                                            | High        | Medium       | **6** | B0 is a hard requirement with defined metrics M1–M4, ≥10 samples, both numbers recorded. No B item is complete without both measurements                                                                                                                                                                                                                                                                                              | If a target is not met, report it explicitly (B0 AC4) and hand the measurement to the architect for a second approach rather than declaring done                                                                           |
| **R-5**  | **Three-runtime divergence.** Several fixes touch Electron-only code (the watcher). Fixing only Electron leaves VS Code and CLI behind, or a fix added inside one adapter breaks the hexagonal rule.                                                                                                                                                                                     | Medium      | High         | **6** | NFR-5: new git capability goes through a `platform-core` port. Verify all three runtimes build; exercise VS Code and Electron functionally                                                                                                                                                                                                                                                                                            | If a capability genuinely cannot exist in a runtime, implement a clean no-op adapter and document it                                                                                                                       |
| **R-6**  | **RPC registered in only one of the two required places.** Compiles cleanly, crashes silently at runtime. Known recurring failure mode in this repo.                                                                                                                                                                                                                                     | Medium      | High         | **6** | NFR-4: explicit checklist item; every new RPC method exercised end-to-end in Electron before submission                                                                                                                                                                                                                                                                                                                               | Fast to fix once observed, but only if someone exercised the path — hence the mandatory end-to-end check                                                                                                                   |
| **R-7**  | **Scope size.** 15 findings + a feature project in one task. Risk of a sprawling change set, a hard-to-review diff, and long-lived divergence from `main`.                                                                                                                                                                                                                               | High        | Medium       | **6** | Phase strictly per SEQ-3; each phase independently verifiable and mergeable; SEQ-1 is the only mandatory bundling                                                                                                                                                                                                                                                                                                                     | If the task runs long, the natural cut line is before D2 — A/B/C/D1/D3 form a coherent shippable unit on their own                                                                                                         |
| **R-8**  | **Concurrent agents on a shared checkout cause cross-contamination.** Another agent's WIP in a neighbouring file breaks this task's build or vice versa.                                                                                                                                                                                                                                 | Medium      | Medium       | **4** | NFR-9: stay in scope, stop and report on out-of-scope failures, never `--no-verify`                                                                                                                                                                                                                                                                                                                                                   | Report to orchestrator; do not attempt to fix neighbouring WIP                                                                                                                                                             |
| **R-9**  | **B4's exclusion consolidation makes real changes stop appearing.** Over-broad exclusion is worse than the churn it fixes — a user edits a file and Source Control never notices.                                                                                                                                                                                                        | Low         | High         | **3** | B4 AC3 explicitly requires verifying that genuine source changes still fire during the M3 workload; B4 AC4 covers user-opened ignored directories                                                                                                                                                                                                                                                                                     | Narrow the exclusion set; churn is an annoyance, missing changes is a correctness defect                                                                                                                                   |
| **R-10** | **C2's conflict handling annoys users in the common case.** A prompt on every split-pane save would be worse than the current silent behaviour.                                                                                                                                                                                                                                          | Medium      | Low          | **2** | C2 AC5 requires the different-files case to be exactly as today; the prompt fires only on genuine same-file divergence                                                                                                                                                                                                                                                                                                                | Prefer reconciliation over prompting where content allows                                                                                                                                                                  |

---

## Definition of Done

The task is complete when all of the following hold:

1. Every acceptance criterion in Requirements A1–A4, B1–B5, C1–C2, D1–D3 passes, verified in Electron.
2. B0 is satisfied: before/after measurements recorded for B1, B3, B4, B5 with method, workload, sample count, median and max; targets M1–M4 met or the shortfall explicitly flagged.
3. SEQ-1 held — the tab-key scheme changed exactly once, in a single unit of work.
4. SEQ-2 held — no hunk write-path code merged before A1–A4 were verified.
5. NFR-1: Electron suite at ≥143 passed / ≤4 skipped, with new automated coverage for the A-group correctness claims and D2's stage/revert semantics.
6. NFR-4: every new RPC method registered in both required locations and exercised end-to-end.
7. NFR-5: VS Code, Electron, and CLI all build; no frontend→backend or backend→frontend import introduced; new git capability sits behind a `platform-core` port.
8. Lint and typecheck clean across affected projects.
9. R-3 triage complete: newly-surfaced git failures either fixed or recorded as follow-up findings — none re-suppressed.
10. B6 (file-tree virtualization) recorded as a follow-up task with the M2 measurement attached as justification.

---

## Traceability

| Requirement  | Finding | Primary evidence                                                                                                                                                                |
| ------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1           | A1      | `libs/frontend/editor/src/lib/services/editor/editor-diff-split.ts:29-36`; `services/editor/editor-workspace.ts:343-355`; `services/editor/editor-file-ops.ts:274-280`          |
| A2           | A2      | `libs/frontend/editor/src/lib/source-control/source-control-panel.component.ts:111`, `:159`; `editor-diff-split.ts:27`, `:42-52`                                                |
| A3           | A3      | `libs/backend/vscode-core/src/services/git-info.service.ts:400-430`; `libs/frontend/editor/src/lib/diff-view/diff-view.component.ts:100-102`                                    |
| A4           | A4      | `editor-diff-split.ts:54-62`                                                                                                                                                    |
| B1           | B1      | `libs/frontend/editor/src/lib/editor-panel/editor-panel.component.ts:253-263`; reference impl `code-editor/code-editor.component.ts:25-50`, `editor-panel.component.ts:240-252` |
| B2           | B2      | `diff-view.component.ts:214-229`                                                                                                                                                |
| B3           | B3      | `libs/frontend/editor/src/lib/file-tree/file-tree-node.component.ts:284-304`                                                                                                    |
| B4           | B4      | `apps/ptah-electron/src/services/git-watcher.service.ts:378-393`; `apps/ptah-electron/src/services/rpc/handlers/editor-rpc.handlers.ts:70` (`HIDDEN_SKIP`)                      |
| B5           | B5      | `editor-panel.component.ts:837-849`, `:885-902`, `:930-940`                                                                                                                     |
| C1           | C1      | `libs/frontend/editor/src/lib/services/git-status.service.ts:217-225`; `services/editor/editor-workspace.ts:325-358`; rule in `libs/frontend/editor/CLAUDE.md` guideline #1     |
| C2           | C2      | `editor-diff-split.ts:99-141`; `code-editor.component.ts:202-208`                                                                                                               |
| D1           | D1      | `editor-panel.component.ts:229` inside `:206`; `source-control-panel.component.ts:92` inside `:78`                                                                              |
| D2           | D2      | `diff-view.component.ts:158` (`readOnly`), `:162` (`renderMarginRevertIcon`)                                                                                                    |
| D3           | D3      | `diff-view.component.ts:159` (`renderSideBySide` hardcoded)                                                                                                                     |
| Out of scope | B6      | file tree renders all nodes; no windowing                                                                                                                                       |

---

## Handoff to Architect

The next phase owns solution design. Points that need an architectural decision rather than a requirement:

1. The diff-tab identity scheme (SEQ-1) — what a tab is keyed on and what revision metadata it carries.
2. How a diff tab revalidates itself, and how that interacts with `GitStatusService.CACHE_TTL_MS` (5 s) and the Electron watcher's documented trade-off — read that before touching git fetch scheduling.
3. The port shape for the hunk-apply capability across three runtimes, and how staleness is detected server-side (D2 AC6) rather than trusted from the client.
4. Whether B1 reuses `CodeEditorComponent`'s host/cache mechanism directly or generalizes it for both editor kinds.
5. Where the single exclusion source of truth for B4 lives, given it must be reachable from both the Electron watcher and the tree builder.
6. The B0 measurement harness — how M1–M4 are captured repeatably.
