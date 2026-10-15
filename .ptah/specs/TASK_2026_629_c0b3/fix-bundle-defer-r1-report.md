# Bundle defer fix round 1: lane tabs loaded eagerly again

**Verdict:** done. `CanvasLaneTabsComponent` is an eager child again. Both focus-area files now
match HEAD exactly. The other two defers are unchanged. The two board-spec type errors were real,
and they are fixed. The canvas test, typecheck and lint targets all pass.

## Changed files (this round)

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-focus-area.component.ts`:
  removed the `@defer (on idle)` block, the `h-9` placeholder and the "Deferred" import comment.
  `<ptah-canvas-lane-tabs>` is back as an eager child with its original four bindings.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-focus-area.component.spec.ts`:
  removed the `DeferBlockState`/`ComponentFixture` imports, the `completeDeferBlocks` helper, the
  "holds the lane strip height with a placeholder" test, and the `async`/`await completeDeferBlocks`
  steps in the "unique panel id" and "falls back to Orchestrator" tests.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-rail-board.component.spec.ts`:
  changed the helper parameter type to `Pick<ComponentFixture<unknown>, 'getDeferBlocks'>`. This
  fixes the type error (see below). No behaviour changed.

`git diff --stat HEAD -- libs/frontend/canvas` now lists only four files:
`canvas-rail-board.component{,.spec}.ts` and `orchestra-canvas.component{,.spec}.ts`. The diff
for both focus-area files is empty. All edits were made with file tools. No git command changed
any state.

## Codex findings

| # | Severity | Status |
| --- | --- | --- |
| 1 | Serious: lane focus lost before the idle load | Resolved. The tabs render eagerly again, so the Rail `afterNextRender` focus query finds the selected tab on the first pass. |
| 2 | Moderate: stale lane key, dangling `aria-labelledby` | Resolved. The tabs' reset effect runs during the first render again, and the tab named by the tabpanel exists from that first render. |
| 3 | Moderate: e2e `laneTabs.boundingBox()` race | Resolved by the source change. The selector belongs to an eager element again. `apps/ptah-electron-e2e/**` was not touched. |
| 4 | Minor: dock placeholder width | Not fixed, as the orchestrator decided. Left for a follow-up. |

## Components still deferred

1. `CanvasSessionDetailsComponent`, in `canvas-rail-board.component.ts`: 3 `@defer (on idle)` blocks. Unchanged.
2. `CanvasNeedsYouQueueComponent` and its helper `canvas-needs-you-queue.ts`, in `orchestra-canvas.component.ts`: 1 `@defer (on idle)` block. Unchanged.

## New net saving estimate (unmeasured, because builds are not allowed)

| Item | kB |
| --- | --- |
| Gross before this round (r2 report) | ~14.8 |
| Lane tabs, now eager again | −4.8 |
| Gross now | ~10.0 |
| Cost of the defer blocks in `main`: 4 blocks now instead of 5 (r2 put 5 blocks at 1.5 to 2 kB, about 0.3 to 0.4 kB each) | −1.2 to −1.6 |
| **Net** | **~8.4 to 8.8** |

Against the 2.75 kB overshoot, this still fits the 3.50 MB budget with about 5.7 to 6 kB to spare.
It no longer meets the r2 goal of at least 10 kB, or the 15 kB target. These numbers come from
the r2 method (minified-source estimates). The real figure is the CI `bundle initial` line after
the push.

## Spec type errors (codex `ptah_get_diagnostics`, board spec lines 468/480)

- **They were real errors.** Before the fix, `ptah_get_diagnostics` reported TS2345 at
  `canvas-rail-board.component.spec.ts:467` and `:479`. In this spec, `mount()` returns
  `Omit<ComponentFixture<CanvasRailBoardComponent>, 'nativeElement'> & { nativeElement: TestHost }`.
  That type is not assignable to `ComponentFixture<unknown>`, because the private members are
  gone.
- **Why the project typecheck missed them:** `nx typecheck canvas` runs
  `npx ngc --noEmit --project libs/frontend/canvas/tsconfig.lib.json`, and that config excludes
  `src/**/*.spec.ts`. Jest does not type-check these specs either, so they passed. The earlier
  "typecheck passed" result was true, but it never covered the specs.
- **Fix:** the helper now takes `Pick<ComponentFixture<unknown>, 'getDeferBlocks'>`.
  `ptah_get_diagnostics` on the board, orchestra and focus-area specs plus the focus-area
  component now reports **0 errors in the requested files**. The `orchestra-canvas.component.spec.ts`
  helper had no error. Some sibling errors are still reported, all in files this change does not
  touch: `orchestra-canvas.rail.spec.ts:276`, `core/src/testing/mock-rpc-service.ts:53-68` and
  `shared/.../capability-id-codec.ts:262-263`. These were not changed.

## Checks (all through `node .ptah/tmp/check-run.mjs`, one at a time, lock wait 0 s each)

| Label | Command | Result |
| --- | --- | --- |
| r1-focus-spec | `npx nx test canvas --testFile=canvas-focus-area.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | exit 0. 1/1 suite, **10/10 tests** passed (11 at r2, minus the removed placeholder test) |
| r1-canvas-test | `npx nx test canvas --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | exit 0. **23/23 suites, 371/371 tests** passed |
| r1-canvas-typecheck | `npx nx typecheck canvas --parallel=1 --skip-nx-cache` | exit 0 (ngc, lib config only, specs excluded) |
| r1-canvas-lint | `npx nx lint canvas --parallel=1 --skip-nx-cache` | exit 0. **0 errors, 31 warnings** |

The logs are in `%TEMP%\629-check-r1-*.log`. The lint warnings are non-null assertions, `$any` and
`max-lines` in spec files and in `canvas-rail-board.component.ts`. None is on a line this round
changed. One warning is related to the change: `canvas-rail-board.component.ts` has 781 lines
against a `max-lines` limit of 700. The r2 defer added about 12 of those lines, but the file was
already over 700 before this task.

No build, serve, e2e or package targets were run. No workspace-wide runs were done.

## Decisions

- **Decision:** fix the board-spec helper with a narrow `Pick<..., 'getDeferBlocks'>` parameter.
  **Options:** cast at the two call sites, widen the type of `mount()`'s return value, or narrow
  the helper's parameter. **Evidence:** TS2345 names the missing private members, and the helper
  only calls `getDeferBlocks()`. **Reversible:** yes.
- **Decision:** do not run an extra `tsc -p tsconfig.spec.json`. **Options:** run it, or rely on
  scoped `ptah_get_diagnostics`. **Evidence:** the orchestrator's check list does not include it,
  and the scoped diagnostics run a TypeScript compiler on the spec files and show 0 errors in them.
  **Reversible:** yes. The spec config can be type-checked later if wanted.

## Out-of-scope observations

- Specs are covered by neither the canvas `typecheck` target nor Jest, so spec type errors can
  reach CI unseen. A `tsconfig.spec.json` typecheck target would close that gap. Not changed here.
- Pre-existing errors in `orchestra-canvas.rail.spec.ts:276`, `mock-rpc-service.ts` and
  `capability-id-codec.ts`, as reported by `ptah_get_diagnostics` for sibling files. Not touched.
