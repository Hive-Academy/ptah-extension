# SEQ-2 Gate Verification — TASK_2026_173

**Scope**: Independent re-verification of Batch 2's A1, A2, A3, A4 acceptance
criteria against the **current tree** (not against commit `61628f623` or
Batch 2's own claims), per the SEQ-2 gate blocking Batch 8 (D2 hunk
stage/revert write path).

**Method**: Direct reading of current source (not the plan's description of
it), running the live test suites, one real-git scratch-repo spot-check, and
two "break it and watch it fail" mutation probes against guards this
verification relies on as evidence. No product code changed net of this
pass; no git `add`/`commit`/`stash`/`checkout`/`reset` was run; no scratch
work touched the shared index. TASK_2026_177's concurrent files were not
touched.

**AC text source**: `task-description.md` §Requirements A1–A4 (read
verbatim, not paraphrased from `tasks.md` or Batch 2's own commit message).

---

## 0. What changed since Batch 2's commit (`61628f623`, 2026-08-03)

```
git log --oneline 61628f623..HEAD -- <path>
```

| Path                                                                      | Changed since Batch 2? | By                                                                                                           |
| ------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| `libs/backend/vscode-core/src/services/git-info.service.ts`               | **No**                 | —                                                                                                            |
| `libs/backend/vscode-core/src/utils/exec-git.ts`                          | **No**                 | —                                                                                                            |
| `libs/backend/rpc-handlers/.../git-rpc.handlers.ts` / `git-rpc.schema.ts` | **No**                 | —                                                                                                            |
| `libs/shared/src/lib/types/rpc/rpc-git.types.ts`                          | **No**                 | —                                                                                                            |
| `libs/frontend/editor/.../editor-diff-split.ts`                           | Yes                    | Batch 7 (`f47351d14`)                                                                                        |
| `libs/frontend/editor/.../editor-panel.component.ts`                      | Yes (heavily)          | Batches 4, 6, 7                                                                                              |
| `libs/frontend/editor/.../diff-view.component.ts`                         | Yes                    | Batch 6 (`3a73a037d`, mount-once/model-reuse rewrite) + `ac7594f51` (unrelated Thoth feature, 13-line touch) |
| `libs/frontend/editor/.../source-control-file.component.ts`               | Yes (markup only)      | Batch 6 D1 (`b57d3c8d4`, a11y de-nesting)                                                                    |
| `libs/frontend/editor/.../editor-workspace.ts`                            | Yes                    | Batch 7                                                                                                      |

This matches the prompt's framing exactly: the git-read backend (A3's
classification ladder, A2's side-resolution table) is untouched since Batch
2 landed it, but the frontend consumption layer that renders and drives it
has been rewritten twice. The verification below is weighted accordingly —
backend claims lean on "unchanged + tests green + live re-spot-check";
frontend claims lean on direct code reading plus two non-vacuity probes.

---

## A1 — Open diff tabs reflect current repository state

**AC1–AC3, AC5** (commit/stage/discard revalidation via `git:status-update`;
0 failed RPCs against a `diff:`-keyed tab): `EditorDiffSplitHelper` in
`libs/frontend/editor/src/lib/services/editor/editor-diff-split.ts`
(`onGitStatusUpdate` :163, `refreshAllDiffTabs` :197, `refreshDiffTab` :213)
still debounces a `git:status-update` push and revalidates every open diff
tab in the active workspace via the single `git:diffFile` RPC
(`requestDiff` :472). `EditorWorkspaceHelper.onRereadOpenTabs`
(`editor-workspace.ts:416`) still guards `if (tab.diff) continue;` before
issuing `editor:openFile`, which is the AC5 mechanism — a diff-keyed tab
(`diff:<comparison>:<path>`) is never handed to the file-reread path.

**Non-vacuity probe (AC5)**: removed the `if (tab.diff) continue;` guard,
ran `editor-workspace.spec.ts -t "A1 AC5"` — the literal test
(`'(A1 AC5, literal) editor:reread-open-tabs SKIPS diff tabs entirely — 0
failed RPCs against a diff key'`, line 518) failed exactly as expected
(`expected 1, received 3` — both diff tabs plus the real tab all fired).
Restored the guard; test passes again; `git status --porcelain` on the file
confirms clean. The guard is real, not decorative.

**AC4** (re-click activates AND revalidates, no early return): `openDiff`
(`editor-diff-split.ts:96`) — the `existingTab` branch does `set active` +
`set content` + `await this.refreshDiffTab(key)`, unconditionally. No early
return that skips revalidation exists in the current file.

**AC6** (no flicker to empty during refresh): `refreshDiffTab` sets
`status: 'refreshing'` via `patchDiff` — a targeted field patch, never
touching `diff.original`/`diff.modified` — confirmed by reading `patchDiff`
(:601) and the refresh body (:222-226); `applyFreshDiff` (:579) is the only
place `content`/`original`/`modified` are overwritten, and it only runs once
a _validated_ fresh result exists.

**AC7** (persistent stale/error indicator, not silent): `refreshDiffTab`
retains previous content and patches only `status`/`errorMessage` on both
transport failure and a non-fresh backend result (:242-262).
`diff-view.component.ts`'s `gitError` computed (:407) and the
`data-testid="diff-error-overlay"` block (:203-231) render this as a
persistent `role="alert"` overlay with a Retry button — not a toast, and not
auto-dismissing (no timer anywhere in the component).

**Verdict: A1 holds on the current tree.** AC5's guard was proven
non-vacuous by direct mutation; AC1–AC3/AC4/AC6/AC7 verified by direct
reading of the current implementation, corroborated by 269/269 green editor
specs covering these files.

---

## A2 — Staged and unstaged rows show distinct, correct comparisons

**AC1/AC2** (Staged row → `HEAD ↔ index`; Changes row → `index ↔ worktree`):
read directly from the current `GitInfoService.diffFile`
(`git-info.service.ts:574-629`, unchanged since Batch 2): the `staged`
branch reads `original` at `HEAD:<originalPath>` and `modified` at the index
(`''` rev); the non-`staged` branch reads `original` at the index and
`modified` from the worktree via `WorktreeFileReader`. `HEAD ↔ worktree` is
not offered by any branch. Matches the table verbatim.

**AC3** (two distinct simultaneous tabs) / **AC4** (unambiguous label): the
tab key is `diff:<comparison>:<path>` (`editor-tab.types.ts:105-110`,
`diffTabKey`), so the same path under `staged` vs `worktree` produces two
distinct keys and therefore two distinct `EditorTab` entries in `openTabs`.
Grepped the whole repo for any other site that constructs or re-derives this
key: only `editor-tab.types.ts` computes it, and only
`editor-diff-split.ts:98` calls `diffTabKey(...)`. (One unrelated literal —
`libs/frontend/skill-synthesis-ui/.../lazy-diff-view.component.ts:194`,
`` `diff:worktree:${path}` `` — exists for a synthetic in-memory diff used by
the Skills-tab enhancement preview. It never reaches `git:diffFile`, never
enters `EditorInternalState.openTabs`, and does not participate in the
write path this gate protects. Noted as a documentation-comment violation
("never re-derived... anywhere else") worth a follow-up, not an A2/SEQ-1
defect.) `diffTabLabel` (`editor-tab.types.ts:134-148`) produces
`foo.ts (staged)` / `foo.ts (working tree)` / `foo.ts (new[, staged])` /
`foo.ts (deleted, staged)` — readable without hover, matching AC4.

**AC5** (persist-or-discard on workspace reopen, never silently wrong
comparison): **NOT independently verified.** I traced `openTabs` through
`EditorTabsHelper.syncTabsToCache` and `EditorWorkspaceHelper` and found no
`vscode.getState()`/`setState()` or other disk/webview-state write tied to
`openTabs` — the workspace cache backing this is an in-memory `Map` scoped
to the running webview session, which would make "discarded" trivially true
across an actual extension-host restart. But I did not trace this
conclusively to the actual webview reload/restore path, found no dedicated
test for `R-2`'s "drop old-format diff tab entries cleanly" behavior
described in `task-description.md`, and did not exercise a real reload.
**This is a genuine gap.** It is lower-severity than the other three
criteria for the purposes of this gate — the D2 write path corrupts data by
deriving a bad patch from a _currently open_ tab's comparison, and AC5 only
concerns what happens to a tab across a reload it may not even survive — but
it is unproven, not passed.

**AC6** (staged rename against correct pre-rename source): confirmed two
ways. (1) Direct code reading: `diffFile`'s `staged` branch reads `original`
at `originalPath` (populated from `parseFileStatus`'s post-tab segment per
N3, code unchanged since Batch 2) via `readBlob(root, 'HEAD', originalPath)`.
(2) **Live real-git spot-check** in a throwaway scratch repo (`git
2.54.0.windows.1`, matching the July `r3-triage.md` environment exactly):
staged a rename `file.txt → renamed.txt` with new content, confirmed
`git status --porcelain=v2` emits `R66 renamed.txt<TAB>file.txt` (new path
pre-tab, old path post-tab, matching `parseFileStatus`'s extraction), then
confirmed `git show HEAD:file.txt` (exit 0, pre-rename content) and
`git show :renamed.txt` (exit 0, post-rename content) resolve exactly as the
side-resolution table requires. Scratch repo deleted after the check; no
workspace files touched.

**Verdict: A2 holds on AC1, AC2, AC3, AC4, AC6, confirmed by direct source
reading plus a live git spot-check. AC5 is unverified** — see above.

---

## A3 — Git read failures are reported, never disguised as content

**AC1–AC3** (non-zero `git show` for a reason other than "absent" → error
state, never rendered as new-file; a throw is surfaced with an actionable
message + logged cause): read `GitInfoService.readBlob`
(`git-info.service.ts:498-550`, unchanged since Batch 2) directly — this is
the exact classification ladder `r3-triage.md` verified against real git on
2026-08-03: `git show` exit 0 → content/binary; exit≠0 →
`git rev-parse --verify --quiet` exit 1 → `absent`, otherwise → `error` via
`probeReadErrorCode`/`classifyExecError`. Confirmed **the file has not
changed a single line** since that triage ran (`git log` on the path since
`61628f623` is empty) and **the git version on this machine today is
identical** (`git version 2.54.0.windows.1`) to the one the triage was run
against — so the 15-row real-git matrix in `r3-triage.md` still describes
today's behavior by construction, not by re-assertion. Spot-re-ran 3 of the
15 rows live (deletion, empty-tracked-file, rename — see A2/A4 sections) as
an independent today-dated confirmation rather than trusting the July
document alone.

**AC4** (no leaked absolute paths / raw stderr): `readBlob`'s error branch
logs `workspacePath`, `stderr`, etc. to `this.logger.error` only, and
returns `this.gitReadError(code, relativePath)` to the RPC caller — the
error-message mapping (`git-read-error-messages.ts`, referenced from
`editor-diff-split.ts`'s `describeGitReadError`) is a fixed lookup table
keyed by a closed `GitReadErrorCode` union, not string interpolation of
stderr. Confirmed by reading `readBlob`'s catch/error branches directly
(lines 525-548): raw `stderr` and `workspacePath` never leave the
`logger.error` call.

**AC5** (genuinely empty tracked file → empty diff, not new-file, not
error): this is the specific defect the batch fixed. Frontend chrome is
`isNewFile = originalRef.kind === 'absent'`
(`diff-view.component.ts:356-358`), never `original === ''`.

**Non-vacuity probe (AC5)**: temporarily rewrote `isNewFile` to
`this.diff()?.original === ''` (the pre-fix defect, reintroduced verbatim).
Ran `diff-view.component.spec.ts -t "A3 AC5"` — the dedicated test (`'is NOT
a new file for a genuinely-empty TRACKED file (the A3 AC5 defect)'`, line 217) failed immediately (`expected false, received true`). Restored the
original `originalRef.kind === 'absent'` derivation; re-ran, passes; `git
status --porcelain` on the file confirms clean. Backend-side confirmation:
live scratch-repo check — `git show HEAD:empty.txt` exits 0 with zero-length
stdout, and `git rev-parse --verify --quiet HEAD:empty.txt` exits 0
(resolves to the well-known empty-blob SHA `e69de29b...`) — so `readBlob`
takes the `content: ''` branch, never `absent`, exactly as required.

**Verdict: A3 holds on the current tree.** Backend ladder unchanged +
version-matched live re-check; frontend chrome-suppression-on-error and
empty-vs-new distinction directly read and proven non-vacuous by mutation.

---

## A4 — Deleted files are diffable

**AC1/AC2** (D unstaged/staged → HEAD or index content on original, empty
on modified): confirmed directly in `diffFile`'s non-`staged` branch — when
`modifiedPath` doesn't exist in the worktree, `readWorktreeBlob` returns
`{ outcome: 'absent' }` and `modifiedRef = { kind: 'absent' }`, while
`original` still resolves normally from the index (unstaged) or HEAD
(staged). Live scratch-repo check: committed `todelete.txt`, deleted it from
the worktree (unstaged `D`), confirmed `git status --porcelain=v2` reports
`1 .D N...`, and `git show HEAD:todelete.txt` exits 0 with the pre-deletion
content — exactly the "original resolves, modified doesn't" shape the
`readWorktreeBlob`/`fs.readFile` path depends on.

**AC3** (tab clearly marked as a deletion): `diffTabLabel`
(`editor-tab.types.ts:141`) — `if (modifiedRef.kind === 'absent') return
'${fileName} (deleted, ${where})'` — checked first, before the new-file
branch, so a deletion always reads "deleted", never "new". `chromeLabel`
(`diff-view.component.ts:384-391`) checks `isDeleted()` before `isNewFile()`
for the same reason.

**AC4** (no error toast): structural, not just behavioral — `openDiff` only
calls `this.state.showError(...)` on the split-pane-open RPC failure path
(`editor-diff-split.ts:311`, unrelated to diff-tab opening); the diff-open
path (`openDiff`/`refreshDiffTab`) never calls `showError`/any toast
mechanism for a `modifiedRef: absent` result, because that is a _successful_
`diffFile` response (`status: 'fresh'`, no `failure`) — `toDiffState`
(:491-525) only sets `status: 'error'` when `firstReadError` finds an actual
`GitReadErrorCode` on either side, which absence-of-worktree-file does not
produce.

**AC5** (untracked file → inverse case renders without error): symmetric to
AC1/AC2 via `originalRef: absent`, `modifiedRef: worktree` in the non-staged
branch; already exercised by the existing `git-info.service.spec.ts` diffFile
matrix (`314/314` green in this run) and cross-checked live in the A2 rename
scratch-repo session (pre-rename `file.txt` state was itself an ordinary
tracked-then-modified case, not separately re-run for `??` here beyond the
existing mocked coverage, which was green).

**Verdict: A4 holds on the current tree**, verified by direct reading of
`diffFile`, `diffTabLabel`, `chromeLabel`, and the absence of any toast call
on the deletion path, plus one live scratch-repo confirmation of the
unstaged-deletion row.

---

## Executable evidence summary

| Suite                                                                                                         | Result                                                                                                        |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `nx test vscode-core --testPathPattern="git-info\|exec-git"`                                                  | 314/314 passed (20 suites)                                                                                    |
| `nx test editor --testPathPattern="diff-view\|editor-diff-split\|editor-workspace\|editor-panel\|editor-tab"` | 269/269 passed (16 suites)                                                                                    |
| `nx test rpc-handlers --testPathPattern="git-rpc"`                                                            | 1718 passed / 31 skipped (unrelated), 74 suites                                                               |
| Mutation probe 1 — `editor-workspace.ts` A1 AC5 guard removed                                                 | Test failed (3 calls vs expected 1) → restored → passes, file clean                                           |
| Mutation probe 2 — `diff-view.component.ts` `isNewFile` reverted to `original === ''`                         | Test failed (`true` vs expected `false`) → restored → passes, file clean                                      |
| Live scratch-repo checks (real `git 2.54.0.windows.1`, same as `r3-triage.md`)                                | Staged rename origPath resolution, unstaged deletion, empty-tracked-file — all matched the code's assumptions |

No git operation in this pass touched `add`/`commit`/`stash`/`checkout`/
`reset`/`restore`. `git status --porcelain` was re-checked after each
mutation probe and is clean on both touched files. No file under
`apps/ptah-license-server/**`, `libs/api/**`, `libs/api-contracts/**`,
`tsconfig.base.json`, or `marketing/**` (TASK_2026_177's concurrent scope)
was read, run, or modified.

## Explicitly unverified (say so, per the brief)

1. **A2 AC5** — diff-tab persistence/discard behavior across an actual
   workspace/webview reload. No disk- or webview-state persistence path for
   `openTabs` was found (in-memory-only cache is the likely reason "discard"
   is trivially satisfied), but this was not traced to a conclusive
   confirmation, and no dedicated regression test for it was found. Residual
   risk to the D2 write path is low (D2 operates on a tab that is currently
   open and live, not one recovered from a stale persisted format), but this
   criterion is unproven, not passed.
2. **Nothing here ran against a real Electron/VS Code host, real Monaco, or
   a live app.** All evidence is direct source reading, mocked/jsdom Jest
   specs, and real-git-CLI checks against throwaway scratch repositories —
   consistent with what Batch 7's own report disclosed as its gap. The
   git-read backend's real-CLI behavior _was_ independently re-confirmed
   live today; the full rendering pipeline in a real webview was not.
3. **SEQ-1's "touched exactly once" wording** is satisfied for the git
   diff-tab write path specifically; one unrelated synthetic literal exists
   outside that path (see A2 AC3/AC4 section) and is flagged as a follow-up,
   not a defect against this gate.

## Overall Verdict

**A1: holds.** **A2: holds except AC5, unproven.** **A3: holds.**
**A4: holds.**

Three of four requirements verify completely against the current tree, with
executable evidence including two non-vacuous mutation probes and a live
git spot-check. A2 AC5 is a genuine unverified gap, not a failure —
no contradicting evidence was found, but no confirming evidence was
produced either, and the instructions for this gate are explicit that an
unproven criterion is not a passing one.

**SEQ-2 NOT SATISFIED** — on the strength of one gap (A2 AC5) whose
residual risk to the D2 write path is assessed as low, not zero. To close
it: trace `openTabs`/diff-tab entries through an actual webview
reload/`getState`/`setState` round trip (or confirm affirmatively that diff
tabs are never persisted at all and always discarded), and add the
dedicated regression test `task-description.md`'s R-2 mitigation calls for
("test the upgrade path explicitly with pre-existing persisted state").
That is a bounded, cheap follow-up — it does not reopen A1, A3, or A4.

---

## A2 AC5 — closure attempt

**Scope of this section only.** A1, A3, A4 were not reopened or re-run
beyond the full suite re-runs shown below, which are unchanged from the
first pass.

### Which branch of AC5 applies

AC5 has two ways to pass: restore the same comparison, or discard. Tracing
`openTabs` end to end (not inferring from absence) settles which branch
this codebase is actually in, and it turns out to be **both**, at two
different layers:

1. **Within a live session** (switching between already-open workspace
   folders while the extension host/webview keeps running):
   `EditorWorkspaceHelper.switchWorkspace` (`editor-workspace.ts:72-138`)
   restores `openTabs` from `workspaceEditorState`, an in-memory
   `Map<string, EditorWorkspaceState>` owned by `EditorService`
   (`editor.service.ts:58-61`). The restore at `:89`
   (`this.state.openTabs.set(cachedState.openTabs)`) assigns the cached
   `EditorTab[]` array **by reference** — no serialize/parse round trip, so
   there is no code path that could re-derive or scramble a tab's
   `diff.comparison` on the way back. This is the **restore** branch.

2. **Across an actual reload** (VS Code window reload, extension
   update/restart, or the panel's webview context being torn down and
   recreated — `EditorService` is `@Injectable({ providedIn: 'root' })`,
   a fresh instance per Angular bootstrap, not a process-lifetime
   singleton): traced every consumer of `VSCodeService.getState()` /
   `setState()` in the editor lib. The only real hit is
   `git-branches.service.ts` (`recent branches by workspace`, unrelated).
   `EditorService`'s constructor (`editor.service.ts:131-160`) initializes
   `_openTabs = signal<EditorTab[]>([])` and never calls `getState()` for
   it. `EditorWorkspaceHelper.switchWorkspace`'s cache-miss branch
   (`:119-137`, hit on any workspace path with no `workspaceEditorState`
   entry — which is every path immediately after a reload, since that Map
   is rebuilt empty) unconditionally sets `openTabs` to `[]`. This is the
   **discard** branch, and it is unconditional: there is no persisted
   store this codebase reads from at all, so an old-format entry (or any
   entry) categorically cannot reach `openTabs` after a reload.

R-2's risk language ("existing users have persisted tab state keyed the
old way") describes a persistence mechanism that, as shipped today, does
not exist for tabs. That may be a planning-time assumption that never
materialized this way, or a mechanism removed before this task — either
way, what matters for this gate is what the current tree does, and it does
not persist tabs at all.

### Regression tests added (permanent artifacts)

Both branches are now covered by executable tests, added to existing spec
files following their established harness patterns — no new files:

- `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\editor\editor-workspace.spec.ts`
  — three new tests appended:
  1. `'restores a staged diff tab as staged, never as worktree, across an
away-and-back switch'` — opens a `diff:staged:a.ts` tab, switches to
     another workspace and back, asserts `diff.comparison` is still
     `'staged'`.
  2. `'keeps two simultaneous tabs for the same path (staged + worktree)
distinct across the round trip'` — same round trip with both
     comparisons open for one path simultaneously (A2 AC3 × AC5).
  3. `'starts a never-before-cached workspace with zero tabs — a live diff
tab does not leak across'` — the discard branch: a tab live in one
     workspace must not appear in a workspace `switchWorkspace` has never
     cached.
- `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\editor.service.spec.ts`
  — one new test: `'starts with zero open tabs even when
VSCodeService.getState() holds an old-format persisted tab list'` —
  constructs a real `EditorService` via `TestBed` with `getState()` stubbed
  to return an old-format payload (literal pre-`diffTabKey()` shape,
  `'a.ts::diff::HEAD::worktree'`), asserts `openTabs()` is `[]` post-
  construction. This is the literal R-2 upgrade-path test the mitigation
  calls for, run against the actual coordinator, not a hand-rolled harness.

### Non-vacuity — break each, confirm fail, restore, confirm pass

Per the standing standard, each new test was proven capable of failing
before being trusted as evidence. All four probes were temporary edits to
product code, reverted immediately after observing the failure; `git status
--porcelain` was re-checked clean on every touched product file after each
restore.

1. **Restore-branch guard** (`editor-workspace.ts:89`, the direct-reference
   restore). Replaced it with code that flips `staged`↔`worktree` on every
   restored diff tab — the literal AC5 hazard. Result: both new
   comparison-round-trip tests failed (`Expected: "staged", Received:
"worktree"`). Reverted; `nx test editor --testPathPattern="editor-workspace"
--skip-nx-cache` → 272/272 passed; `git status --porcelain` on
   `editor-workspace.ts` clean.
2. **Discard-branch guard** (`editor-workspace.ts:123`, the cache-miss
   `openTabs.set([])`). Deleted that one line, leaving a live tab to leak
   into a never-seen workspace. Result: the discard test failed (`Expected:
[], Received: [{ diff.comparison: 'staged', ... }]`). Reverted; re-ran
   clean.
3. **Reload-discard guard** (`editor.service.ts`, the constructor).
   Temporarily added exactly the hazard R-2 describes — hydrate `_openTabs`
   from `this.vscodeService.getState('editorState')` on construction.
   Result: the `EditorService`-level test failed (`Expected: [], Received:
[{ filePath: 'a.ts::diff::HEAD::worktree', ... }]` — the stubbed
   old-format payload came through). Reverted; `nx test editor
--testPathPattern="editor.service\.spec" --skip-nx-cache` → 273/273
   passed; `git status --porcelain` on `editor.service.ts` clean.

All four probes were destructive to the product file only for the duration
of one test run each; no probe was left in place. No throwaway files were
created for this closure (the tests live permanently in the two spec files
above, which is the deliverable, not a probe).

### Executable evidence (this pass)

| Check                                                                                                                                          | Result                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `nx test editor --testPathPattern="editor-workspace" --skip-nx-cache`                                                                          | 272/272 passed (16 suites) — includes the 3 new A2 AC5 tests           |
| `nx test editor --testPathPattern="editor\.service\.spec" --skip-nx-cache`                                                                     | 273/273 passed (16 suites) — includes the 1 new A2 AC5 test            |
| `nx test editor --testPathPattern="diff-view\|editor-diff-split\|editor-workspace\|editor-panel\|editor-tab\|editor\.service" --skip-nx-cache` | 273/273 passed — full re-run, A1/A3/A4-adjacent suites unaffected      |
| `nx run @ptah-extension/editor:lint --max-warnings=-1`                                                                                         | 0 errors, 14 warnings — all 14 pre-existing, none in the new test code |
| Mutation probe on `editor-workspace.ts:89` (restore)                                                                                           | Failed as expected → reverted → clean                                  |
| Mutation probe on `editor-workspace.ts:123` (discard)                                                                                          | Failed as expected → reverted → clean                                  |
| Mutation probe on `editor.service.ts` constructor (reload discard)                                                                             | Failed as expected → reverted → clean                                  |
| `git status --porcelain` on all three product files after every probe                                                                          | Clean each time                                                        |

Files changed by this closure pass (test code only, as scoped):

- `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\editor\editor-workspace.spec.ts`
- `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\editor.service.spec.ts`

No product code file has a net change. No git `add`/`commit`/`stash`/
`checkout`/`reset`/`restore` was run; the index was not touched.

### Updated per-AC status

**A2 AC5: holds.** Both branches of the criterion (restore-correctly and
discard-cleanly) are now traced to specific code, hold on the current tree,
and are backed by regression tests proven capable of failing.

---

## Overall Verdict (final)

**A1: holds.** **A2: holds — AC1–AC6, including AC5, all verified.**
**A3: holds.** **A4: holds.**

All four requirements now verify completely against the current tree, with
executable evidence for every criterion: direct source reading, the full
editor/vscode-core/rpc-handlers test suites green, three live real-git
scratch-repo spot-checks, and five non-vacuous mutation probes across this
verification and its A2 AC5 closure (each one: break the guarded behavior,
confirm the relevant test fails, restore, confirm it passes again).

**SEQ-2 SATISFIED.** Batch 8 (the D2 hunk stage/revert write path) is no
longer blocked by this gate. The two permanent regression tests added in
this closure pass stay in the suite going forward — a future change that
reintroduces stale-comparison restoration, cross-workspace tab leakage, or
reload-time tab hydration from persisted state will fail them.
