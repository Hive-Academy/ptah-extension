# R9w implementation report

The Rail board now owns two stable pane identities, reconciles store focus and removals, consumes the R9v split/reorder actions, and overlays Details in split mode. Its component provider supplies one retention coordinator; the transcript's dynamic environment injector forwards that same instance to ChatView.

## Contract coverage

Paths in this table are relative to `libs/frontend/canvas/src/lib/`. “Pass” means the named case passed in one of the four scoped spec runs below. A source assertion or an upstream test is identified separately.

| Contract point | File:line | Named spec case | Result |
| --- | --- | --- | --- |
| A: one board coordinator shared by both panes and distinct tab count | `canvas-rail/canvas-rail-board.component.ts:44`, `canvas-detail/canvas-detail-transcript.component.ts:44` | `canvas-rail-board.component.spec.ts:594` “board provides one RailTranscriptRetentionCoordinator; both panes share it…”; `canvas-detail-transcript.component.spec.ts:442` checks child injector | Pass |
| B: every mounted transcript has SESSION_CONTEXT and split has at most two hosts | `canvas-detail/canvas-detail-transcript.component.ts:60`, `canvas-rail/canvas-rail-board.component.ts:120` | `canvas-detail-transcript.component.spec.ts:442`; `canvas-rail-board.component.spec.ts:623` “never a third host…” | Pass |
| B: distinct pane ids, including external focus/removal; dev assertion | `canvas-rail/canvas-rail-board.component.ts:307`, `canvas-rail/canvas-rail-board.component.ts:413` | `canvas-rail-board.component.spec.ts:623`, `:706` | Pass for transitions; dev assertion is present in source |
| C/B6: three R9v action outputs and split reason | `canvas-rail/canvas-rail-board.component.ts:68`, `:80`, `:225` | `canvas-rail-board.component.spec.ts:612` “below two sessions…” and `:751` reorder | Pass |
| D/B5: display dock retained, SESSION_CONTEXT, split 360 px content floor, null in single focus | `canvas-detail/canvas-detail-transcript.component.ts:56`, `:60`, `:63` | `canvas-detail-transcript.component.spec.ts:65` “fenced display opens and updates in place”; `:442` token and no HIDE_AGENT_SIDEBAR | Pass; `ptah-ui display [id]` update-in-place is covered by the existing display case |
| Pane state, active/inactive focus, same-id refusal, session creation and main-panel switch | `canvas-rail/canvas-rail-board.component.ts:218`, `:421`, `:452`, `:530` | `canvas-rail-board.component.spec.ts:612`, `:623`, `:644` | Pass |
| Focusin activation, visual placement labels, per-pane lane ids | `canvas-rail/canvas-rail-board.component.ts:123`, `canvas-rail/canvas-focus-area.component.ts:27`, `:78` | `canvas-rail-board.component.spec.ts:663`; `canvas-focus-area.component.spec.ts:241` | Pass |
| External removal drops ghost pane and announces once | `canvas-rail/canvas-rail-board.component.ts:307` | `canvas-rail-board.component.spec.ts:706` “external removal drops a ghost pane…” | Pass |
| Close inactive, active with transient null focus, and cancelled close | `canvas-rail/canvas-rail-board.component.ts:583` | `canvas-rail-board.component.spec.ts:777`, `:789`, `:806` | Pass |
| Two hosts at 1280/920, 400 px wrappers, min width, vertical scroll | `canvas-rail/canvas-rail-board.component.ts:120` | `canvas-rail-board.component.spec.ts:689` “1280/920 stacked keeps two live hosts…” | Pass for DOM classes and host count; jsdom does not measure rendered pixels |
| Threshold 1439/1440 and no remount | `canvas-rail/canvas-rail-board.component.ts:224` | `canvas-rail-board.component.spec.ts:676` “stacks at 1439 and keeps stable pane hosts…” | Pass |
| Split Details overlay at narrow and wide bands, follows active tab, Escape/collapse returns focus; single focus column | `canvas-rail/canvas-rail-board.component.ts:141`, `:152`, `:184`, `:489` | `canvas-rail-board.component.spec.ts:723` “split Details overlay…”; `:378`, `:391` single-focus column | Pass; 920 px split does not collapse Rail |
| Reorder adjacent permutation, boundary no-op, geometry baseline, density heights, persistence error | `canvas-rail/canvas-rail-board.component.ts:509` | `canvas-rail-board.component.spec.ts:751` “expected reorder permutation with 176/96/56 heights…” | Pass; card-select focus restoration is implemented but not separately asserted by the stub |
| Stable transcript while a lane covers it; pane focus and width tokens | `canvas-detail/canvas-lane-view.component.ts:74`, `:188` | `canvas-lane-view.component.spec.ts:313` “keeps one transcript and draft…” | Pass |
| Independent lane memory per tab | `canvas-rail/canvas-focus-area.component.ts:43` | `canvas-focus-area.component.spec.ts:296` “restores the lane selected for each tab…” | Pass |
| Width-dependent dock positioning at 1920/1600/1280/920; retained A to live B one subtree | `canvas-detail/canvas-detail-transcript.component.ts:57`, `:70` | R9u chat specs own dock and coordinator transfer behavior; this batch verifies the token and shared injector | Upstream behavior consumed; no new browser measurement or transfer assertion in this batch |
| Split state remains transient | `canvas-rail/canvas-rail-board.component.ts:218` | `canvas-rail-board.component.spec.ts:723` checks reset of visual order | Source has no split persistence write; pass for reset |

## Scoped checks

Each command ran from `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5` through `.ptah/tmp/check-run.mjs` with the machine-wide lock, `--coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`.

| Label and `--testFile` | Observed result |
| --- | --- |
| `r9w-20` `canvas-rail-board.component.spec.ts` | `Test Suites: 1 passed, 1 total`; `Tests: 40 passed, 40 total` |
| `r9w-13` `canvas-focus-area.component.spec.ts` | `Test Suites: 1 passed, 1 total`; `Tests: 7 passed, 7 total` |
| `r9w-14` `canvas-lane-view.component.spec.ts` | `Test Suites: 1 passed, 1 total`; `Tests: 16 passed, 16 total` |
| `r9w-10` `canvas-detail-transcript.component.spec.ts` | `Test Suites: 1 passed, 1 total`; `Tests: 9 passed, 9 total` |

`git diff --check` reported no whitespace errors. The lane-view spec prints existing Angular NG0956 tracking warnings; the transcript spec prints a mocked session-loader restore error while passing. No typecheck, lint, build, full suite, or e2e was run under the batch's strict check rule. `ptah_get_diagnostics` was not listed in this lane's available tools.

## Decisions

| Decision | Options considered | Evidence | Reversible |
| --- | --- | --- | --- |
| Provide the coordinator on the board and forward it into each transcript environment injector | Board provider alone; board provider plus explicit forwarding | Angular's `EnvironmentInjector` boundary is separate from component element providers; the transcript spec asserts the child injector sees the same coordinator | Yes |
| Keep pane wrappers keyed by fixed left/right identity and change tab inputs | Key by tab id; key by pane identity | R9w contract requires no host remount on tab switch; board spec checks stable nodes at the width threshold | Yes |
| Keep a covered orchestrator transcript mounted with `visible=false` | Keep it active; let it freeze while covered | Existing lane case checks subtree and draft retention; SESSION_VISIBLE registration follows the visible signal | Yes |
| Use a board-owned overlay for split Details | Reuse the single-focus column; active-pane overlay | Decision 83 and the 920 px no-Rail-collapse case | Yes |

## Clarifications Needed

None.

## Proposed Removals

none

## Changed files

- `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-rail-board.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-rail-board.component.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-focus-area.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-focus-area.component.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-detail\canvas-lane-view.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-detail\canvas-lane-view.component.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-detail\canvas-detail-transcript.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-detail\canvas-detail-transcript.component.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\.ptah\specs\TASK_2026_629_c0b3\lane-R9w-report.md`

An existing unrelated modification to `.ptah/specs/TASK_2026_629_c0b3/context.md` was present in the working tree; this lane did not edit it.
