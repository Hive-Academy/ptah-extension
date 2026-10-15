# R9w fix report

Paths below are relative to `libs/frontend/canvas/src/lib/`. This fix round started from the uncommitted R9w implementation and changed only its board and transcript files.

| Finding | Fix | File:line | Spec case (file:line) | Result |
| --- | --- | --- | --- | --- |
| B1 | Visible-set registration reads `parentActive`; covered transcripts keep registration while render/focus tokens remain false. | `canvas-detail/canvas-detail-transcript.component.ts:83` | `canvas-detail/canvas-detail-transcript.component.spec.ts:323,360` | Pass, 10/10 transcript specs |
| B2 | Inactive side returns null without a split; valid `lastFocusedId` only, with a previous-order neighbour chosen after removal. | `canvas-rail/canvas-rail-board.component.ts:314-322,442-460` | `canvas-rail/canvas-rail-board.component.spec.ts:306` | Pass, one pane and lane in both null-focus cases |
| S1 | Hidden board collapses transient split state and returns without `focusTile` or announcement. | `canvas-rail/canvas-rail-board.component.ts:323-327` | `canvas-rail/canvas-rail-board.component.spec.ts:324` | Pass |
| S2 | Move Close split and Details below the 48 px header. | `canvas-rail/canvas-rail-board.component.ts:126,128` | `canvas-rail/canvas-rail-board.component.spec.ts:734-736` | Pass, offset class asserted; no browser pixel measurement |
| M1 | Announce save failure only for a pending visible reorder; clear pending after the failure or a false read. | `canvas-rail/canvas-rail-board.component.ts:352-358,556` | `canvas-rail/canvas-rail-board.component.spec.ts:827,863` | Pass for pending and pre-existing failure. A second failure while `writeFailed` remains true cannot trigger a new signal change; a service failure counter would be needed outside scope. |
| M2 | `activeId()` validates store or last focus against current tiles and drives activate, Open beside, close, and removal reconciliation. | `canvas-rail/canvas-rail-board.component.ts:329,442-447,474,484,624-627` | `canvas-rail/canvas-rail-board.component.spec.ts:757,900` | Pass with null focus before actions |
| M3 | Collapse keeps `activeSide` and its host; the next split normalises left. Focus returns to the active card select or active lane tab. | `canvas-rail/canvas-rail-board.component.ts:497-516,528-541` | `canvas-rail/canvas-rail-board.component.spec.ts:757,809` | Pass, survivor node identity and Details focus return |
| M4 | Forwarding test provides coordinator on a host component; board specs cover focus and anchor on reorder, geometry shift count, threshold announcement, wide Details overlay and collapse focus. | `canvas-detail/canvas-detail-transcript.component.spec.ts:468-494`; `canvas-rail/canvas-rail-board.component.spec.ts:705-717,809-861` | Same cases | Pass for listed assertions. Real `TranscriptRetentionService` A-to-B subtree transfer was not mounted here: its full ChatView dependency graph and coordinator internals are exercised upstream, while these scoped tests assert the shared injected instance. Width-dependent dock positioning remains upstream/browser coverage. |
| Minor 2 | Split-only 360 px/400 px minimums. | `canvas-rail/canvas-rail-board.component.ts:123` | `canvas-rail/canvas-rail-board.component.spec.ts:719-737,757-776` | Pass in split and single focus |

## Scoped checks

All commands ran from `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5` through the machine lock, with `--coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`:

| Command | Observed result |
| --- | --- |
| `node .ptah/tmp/check-run.mjs r9w-fix-10 -- npx nx test @ptah-extension/canvas --testFile=canvas-rail-board.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | `Test Suites: 1 passed, 1 total`; `Tests: 47 passed, 47 total` |
| Same command with label `r9w-fix-3` and `--testFile=canvas-detail-transcript.component.spec.ts` | `Test Suites: 1 passed, 1 total`; `Tests: 10 passed, 10 total` |
| Same command with label `r9w-fix-4` and `--testFile=canvas-focus-area.component.spec.ts` | `Test Suites: 1 passed, 1 total`; `Tests: 7 passed, 7 total` |
| Same command with label `r9w-fix-5` and `--testFile=canvas-lane-view.component.spec.ts` | `Test Suites: 1 passed, 1 total`; `Tests: 16 passed, 16 total` |

`git diff --check` passed. Scoped `ptah_get_diagnostics` found no errors in the four changed files; it reported seven sibling errors outside this fix's allowed files. The transcript spec logged an existing mocked session-loader restore error while passing. The lane spec logged existing Angular NG0956 warnings while passing. No build, typecheck, lint, full suite or e2e was run under the strict check rule.

## Decisions

- Kept display dock, typed `SESSION_CONTEXT`, and one board coordinator per board. No host, capability or persistence API was removed.
- Single-focus removal chooses a surviving id from the prior ordered ids adjacent to the removed focused id. This avoids deriving a pane from `focusedId()` or current `tiles[0]` during null focus.
- Split controls use `top-[52px]` so they clear the 48 px header; R9x still owns header-menu split actions.
- The real retained-A-to-live-B subtree case was not added to these canvas specs. It needs a full ChatView retention fixture; the in-scope forwarding test now fails if the explicit child-injector forwarding is removed.

## Recorded minors

- Minor 1: duplicate nested pane/focus-area `aria-label` landmarks.
- Minor 3: pane column lacks an explicit `overflow-y-auto` class on the outer container.
- Minor 4: `focus()` sets `lastFocusedId` before a potentially rejected store focus.
- Minor 5: dev assertion does not count hosts; production relies on `paneTab`.
- Minor 6: switching active panes while Details is open can drop overlay focus.

## Clarifications Needed

None.

## Proposed Removals

None.

## Changed files

- `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-rail-board.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-rail-board.component.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-detail\canvas-detail-transcript.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-detail\canvas-detail-transcript.component.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\.ptah\specs\TASK_2026_629_c0b3\lane-R9w-fix-report.md`
