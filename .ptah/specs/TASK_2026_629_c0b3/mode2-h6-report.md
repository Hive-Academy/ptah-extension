# Mode 2 (verify, no commit) - Batch R9w, Wave H6 - TASK_2026_629_c0b3

Verdict: **PASS**. The batch is ready for the orchestrator to commit (decision row 95). The
independent review of the bounded correction (`code-logic-review-R9w-correction.md`) was **not on
disk** when this report was written, so its verdict is **pending**. The orchestrator should wait
for it before running the commit below. Any findings it raises are recorded, not fixed
(decision 105, agent-lanes section 6).

Worktree W = `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5`,
branch `feat/task-629-canvas-board`, HEAD `1a2f6bc74`.

## 1. Report vs disk

`git status --short libs apps` shows exactly 8 paths, all modified (` M`), with nothing untracked
and no other path:

| Path (under `libs/frontend/canvas/src/lib/`) | Lines changed (`git diff --stat`) |
| --- | --- |
| `canvas-rail/canvas-rail-board.component.ts` | 288 |
| `canvas-rail/canvas-rail-board.component.spec.ts` | 420 |
| `canvas-rail/canvas-focus-area.component.ts` | 11 |
| `canvas-rail/canvas-focus-area.component.spec.ts` | 20 |
| `canvas-detail/canvas-lane-view.component.ts` | 4 |
| `canvas-detail/canvas-lane-view.component.spec.ts` | 9 |
| `canvas-detail/canvas-detail-transcript.component.ts` | 11 |
| `canvas-detail/canvas-detail-transcript.component.spec.ts` | 58 |

Total: 8 files, 793 insertions, 28 deletions.

There are no extra paths, which is the expected result. The three lane reports list the same set.
The fix and correction rounds stayed inside it: the fix touched the board and transcript files
plus their specs; the correction touched only the board file and its spec. `git diff --check`
is clean. The other modified files in the working tree are task-folder docs (`context.md`,
`decisions.md`, review and report `.md` files) and stay out of this commit.

Contract spot checks against the code on disk (board = `canvas-rail-board.component.ts`):

| Contract point | Evidence |
| --- | --- |
| `splitStacked = containerWidth() < 1440` | board `:224` |
| `splitDisabledReason` 'Open another session first to split' | board `:225` |
| `visualOrder` default `['left','right']`, reset on collapse, CSS `order` binding | board `:222`, `:516`, `:123` |
| Pane wrapper `min-w-[360px]` / `min-h-[400px]` only while `splitDisplayed()`; pane `overflow-y-auto`; column `overflow-x-auto` | board `:120`, `:123` |
| Split controls below the 48 px header (`top-[52px]`) | board `:126`, `:128` (NEW-3 overlap with the lane-tab strip goes to R9x) |
| Single `reorderTiles(ids)` call; `writeFailed` observed with a pending marker | board `:563-565`, `:358` |
| One board-level `RailTranscriptRetentionCoordinator` provider, forwarded into each transcript child injector | board `:44`; transcript `:70` |
| Visible-set registration gated on `parentActive()` (B1 fix) | transcript `:83` |
| `RAIL_MIN_CONTENT_WIDTH` provided from `minContentWidth` (360 when split, null single) | transcript `:63` |

Greps across the 8 files:
- No `TODO`, `FIXME`, `PLACEHOLDER`, `.skip(`, `.only(`, `xit(`, `fit(`, `xdescribe(` or
  `fdescribe(` markers.
- `HIDE_AGENT_SIDEBAR` does not appear in any source file. It appears only in the transcript spec
  (`:122`, `:174`, `:489`), and each time as `expect(injector.get(HIDE_AGENT_SIDEBAR, null)).toBeNull()`,
  so decision 77 holds.
- `RailTranscriptRetentionCoordinator` is imported only from `@ptah-extension/chat`: board `:16`,
  board spec `:11`, transcript spec `:12`. The transcript source imports it in its
  `@ptah-extension/chat` import block (`:15-26`). No deep or relative import exists.

The named cases are present, including "external removal drops a ghost pane ...", "split Details
overlay ...", the 1439/1440 threshold, "1280/920 stacked keeps two live hosts", "expected reorder
permutation with 176/96/56 heights", "board provides one RailTranscriptRetentionCoordinator ..."
and the B5 token / no HIDE_AGENT_SIDEBAR case (transcript spec `:468`). The gaps that are still
unspecced are listed in section 4.

## 2. Checks

All three checks ran serially from W through the machine-wide lock (`.ptah/tmp/check-run.mjs`).
Logs are in `%TEMP%\629-check-<label>.log`.

| # | Label | Command | Result |
| --- | --- | --- | --- |
| 1 | `r9w-full` | `npx nx test @ptah-extension/canvas --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | exit 0. `Test Suites: 23 passed, 23 total`; `Tests: 304 passed, 304 total`; "Successfully ran target test for project @ptah-extension/canvas" (1 task) |
| 2 | `r9w-tc` | `npx nx typecheck @ptah-extension/canvas --parallel=1 --skip-nx-cache` | exit 0. 0 `error TS`. One pre-existing Angular warning outside canvas: NG8107 at `libs/frontend/chat/src/lib/components/molecules/peer-session-send/peer-session-send-dialog.component.ts:181:46` (unnecessary `?.`), which is not an R9w file |
| 3 | `r9w-lint` | `npx nx lint @ptah-extension/canvas --parallel=1 --skip-nx-cache` | exit 0. `16 problems (0 errors, 16 warnings)` |

### Delta vs the R9v baseline (`mode2-h5-report.md`)

| Metric | R9v baseline | R9w | Delta |
| --- | --- | --- | --- |
| Canvas suites | 23 | 23 | 0 (no new spec files) |
| Canvas tests | 276 | 304 | +28 |
| Typecheck errors | 0 | 0 | 0 |
| Lint errors / warnings | 0 / 16 | 0 / 16 | 0 / 0 |

The +28 tests come from three specs. The board spec has 51 runtime tests, as the correction report
says (static `it(` count: 18 at HEAD, 39 now; some cases are parameterised). The focus-area spec
goes from 6 to 7 and the transcript spec from 8 to 10. The lane-view spec stays at 16; its 9 added
lines are assertions inside an existing case. 25 + 1 + 2 = 28, which matches.

**"Seven sibling errors".** The writer lanes reported seven errors from `ptah_get_diagnostics`
outside their files. The typecheck run is the authority, and it reports **0 errors** for canvas
and its type dependencies. The only diagnostic it prints is the pre-existing NG8107 *warning* in
`chat` above. So the seven diagnostics are not compiler errors in this project graph, and none is
attributable to R9w.

### Lint detail

All 16 warnings are in spec files. None is in an R9w source file, and none was added by R9w.

| File | Lines | Rule | Count |
| --- | --- | --- | --- |
| `canvas-detail/canvas-lane-tabs.component.spec.ts` | 10, 11, 12 | no-explicit-any | 3 |
| `canvas-detail/canvas-lane-view.component.spec.ts` | 36, 37, 38, 39, 49 | no-explicit-any | 5 |
| `canvas-layout-persistence.service.spec.ts` | 67 | no-non-null-assertion | 1 |
| `canvas-rail/canvas-focus-header.component.spec.ts` | 21, 27, 34, 36 | no-non-null-assertion | 4 |
| `canvas-rail/canvas-rail.component.spec.ts` | 62, 73, 82 | no-non-null-assertion | 3 |

The 5 warnings in the lane-view spec were already there at HEAD (HEAD has the same 5 `any`). They
moved down 1 line because R9w added one import at line 10. The R9w hunks are `@@ -9,0 +10` and
`@@ -325,0 +327,8`, and neither touches lines 36-49.

## 3. Review chain

| Review | Verdict | Handling |
| --- | --- | --- |
| `code-logic-review-R9w.md` | REVISE 5/10 (2B / 2S / 4M / 6 Minor) | Fix round under decision 104 |
| `code-logic-review-R9w-fix.md` | APPROVE-WITH-FIXES 6/10. B1, B2, S1, S2, M2, M3 and Minor 2 fixed; M1 and M4 partial | Bounded correction under decision 105 (NEW-1, NEW-2, NEW-4) |
| `lane-R9w-correction-report.md` | NEW-1, NEW-2 and NEW-4 fixed; board spec 51/51 | Confirmed by the full suite above |
| `code-logic-review-R9w-correction.md` | **Pending** (not on disk at report time) | Any findings are recorded, not fixed (decision 105) |

## 4. Recorded, not fixed (for the PR body)

From `code-logic-review-R9w.md` (Minors 1, 3-6; decision 104):
1. Minor 1: the board pane `section` and the focus area's inner `section` carry the same
   `aria-label`. This makes a nested duplicate landmark that is announced twice.
2. Minor 3: the pane column contract says `overflow-y-auto`. The outer pane container
   (`rail-pane-container`, board `:120`) sets only `overflow-x-auto`, which computes to auto.
   It works, but it is not explicit and no test asserts it.
3. Minor 4: `focus()` sets `lastFocusedId` before `store.focusTile(id)`. If the store rejects the
   id, `lastFocusedId` is stale.
4. Minor 5: the dev assertion checks `otherTabId` against store focus but does not count hosts.
   Production relies on `paneTab()`.
5. Minor 6: if the active pane changes while Details is open, the overlay is recreated in the new
   pane and focus drops to `body`.

From `code-logic-review-R9w-fix.md` (decision 105):
6. NEW-5: closing split with the right pane active keeps the survivor mounted, but the next Open
   beside resets `activeSide` to left, so the survivor is remounted once at that point.
7. NEW-7: the "announced once" case compares the announcement string, so it would still pass if
   the same string were announced twice. A spy counting `announce` calls would pin it.
8. M1 repeat failure: a second failed save while `writeFailed` is still `true` changes no signal,
   so nothing is announced. Fixing it needs a failure counter on
   `CanvasLayoutPersistenceService`, which is outside the 8 files.
9. M4, real retained A to live B: no canvas spec mounts the board with two real ChatViews and real
   `TranscriptRetentionService` end to end. Upstream coverage is
   `rail-transcript-retention-coordinator.service.spec.ts:73` and `chat-view.keepalive.spec.ts`.
   Canvas pins only the shared coordinator instance in the child injector. Also unspecced: dock
   positions at 1920/1600/1280/920, `ptah-ui display [id]` with two panes, independent lanes and
   drafts per pane, and a hidden-board `writeFailed` case. These go to the Electron visual
   re-check.

Routed to R9x (decision 105), not recorded as debt here:
- NEW-3: the split buttons at `top-[52px]` cover the right end of the lane-tab strip. R9x moves
  Close split and Details into the header.
- NEW-6: single focus can carry `data-pane-side="right"`. Add this note to the R9x brief for its
  selectors and keyboard work.

## 5. Ready commit command (orchestrator runs it, foreground, from W)

Type `feat` and scope `canvas` are both in `.commitlintrc.json` (scope-enum `:83`). The subject is
67 characters (limit 72). Body lines are at most 72 characters.

```bash
cd "D:/projects/ptah-extension/.claude-worktrees/feat-task-629-canvas-board-697f422f00f5" && \
git add \
  libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts \
  libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts \
  libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.ts \
  libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.spec.ts \
  libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts \
  libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.spec.ts \
  libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.ts \
  libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.spec.ts && \
git commit -F - <<'EOF'
feat(canvas): batch R9w - split focus board, panes, Details overlay

The Rail board now owns two stable pane hosts with left/right state,
side-by-side at >= 1440 px and stacked below, with no remount when the
width crosses the threshold. It consumes the R9v Open beside and move
actions through one reorderTiles call, and reconciles external focus
and tile removal without ghost or duplicate panes. Details opens as an
overlay on the active pane while split.

One board RailTranscriptRetentionCoordinator is forwarded into each
pane transcript. The transcript keeps visible-set registration on
parentActive and provides RAIL_MIN_CONTENT_WIDTH 360 only while split.

Canvas: 23 suites, 304 tests; typecheck 0 errors; lint 0 errors,
16 warnings (all pre-existing, in specs).

Refs: TASK_2026_629_c0b3

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log --oneline -1
```

Stage only these 8 paths. Do not stage `context.md`, `decisions.md` or the task-folder review and
report files with this commit.

### Next action: orchestrator waits for the verdict in `code-logic-review-R9w-correction.md`, records any findings in the PR-body list above (recorded, not fixed, under decision 105), runs the ready commit command in the foreground, then commits the task-folder docs separately and starts Batch R9x with NEW-3 and NEW-6 in its brief.
