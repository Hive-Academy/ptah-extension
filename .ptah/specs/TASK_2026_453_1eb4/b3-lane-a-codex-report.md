# Batch 3 Lane A Codex Report

## Frontend implementation — `TASK_2026_453_1eb4`, batch 3 / Task 3.1

**Task completed**: Replace the single-slot canvas-session request with the FU-22a FIFO queue.

## What changed

- `libs/frontend/core/src/lib/services/app-state.service.ts:108-127,259-264,333-336,693-737`
  replaces the nullable single slot with a readonly request array, appends requests in arrival
  order, removes an exact still-pending request on timeout, clears the timer on every settlement,
  and exposes an atomic `takeCanvasSessionRequests()` drain that avoids writing when empty.
- `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:319-340` observes the plural queue,
  drains it with `untracked`, and starts every queued request in FIFO order without awaiting between
  requests. Each request retains the existing switch-success, switch-rejection, and tile-cap
  settlement behavior.
- `libs/frontend/core/src/lib/services/app-state.service.spec.ts:617-678` pins two-request FIFO
  ordering, drain-to-empty behavior, timeout removal plus `false` settlement, and accepted-request
  `true` settlement with no timer left pending.
- `libs/frontend/canvas/src/lib/orchestra-canvas.component.spec.ts:362-427` pins a two-request drain
  in one application tick, ordered `addTileFromSession` / `switchSession` calls, and the second
  request alone resolving `false` when the second tile hits the cap. All three AppStateManager
  mocks in this spec now use the plural queue contract.

## Acceptance criteria

1. **“`_canvasSessionRequest` → `_canvasSessionRequests = signal<readonly
   CanvasSessionRequest[]>([])`; public `canvasSessionRequests` (readonly);
   `takeCanvasSessionRequests()` returns the queue and sets `[]` (no write when already empty).
   `requestCanvasSession` appends. The old API is deleted.”** Met at
   `app-state.service.ts:259-264,333-336,703-737`. The implementation returns before any signal
   write for an empty queue.
2. **“The 5 s timeout resolving `false` removes that exact request from the queue if still present;
   the timer is cleared when the request resolves.”** Met at `app-state.service.ts:706-726` by
   reference-identity filtering and the guarded `settle` closure. Pinned at
   `app-state.service.spec.ts:656-678`.
3. **“Canvas effect reads `canvasSessionRequests()`; when non-empty, `untracked(() =>
   takeCanvasSessionRequests())` and for each request in order runs the existing body. No `await`
   between requests.”** Met at `orchestra-canvas.component.ts:319-340`; the synchronous `for...of`
   starts each switch in queue order.
4. **“`grep -rn "canvasSessionRequest\\b\\|clearCanvasSessionRequest" W/libs W/apps` returns only
   the new plural names.”** The old singular API and clear method are absent from all product and
   unit-test code. The grep still finds two pre-existing prose references at
   `apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts:157,168`; these were
   intentionally not edited because the lane prompt explicitly says not to touch the perf harness.
5. **“Specs: app-state — two requests before `take` returned in order; `take` empties; a timed-out
   request is removed and resolves `false` (fake timers); resolve `true` path. Canvas — two requests
   queued before one `TestBed.tick()` → two `addTileFromSession` and two `switchSession` in order;
   cap on the second → only the second resolves `false`.”** Met by the specs cited above. The canvas
   tests enqueue both requests before the single `ApplicationRef.tick()` wrapper call.
6. **“Perf-harness comments reworded.”** Not changed by explicit user scope: “Do NOT touch ... the
   perf harness.” The one-rAF stress cadence and its existing comments remain untouched.

## Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\core\src\lib\services\app-state.service.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\core\src\lib\services\app-state.service.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\canvas\src\lib\orchestra-canvas.component.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\canvas\src\lib\orchestra-canvas.component.spec.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\.ptah\specs\TASK_2026_453_1eb4\b3-lane-a-codex-report.md`

## Stack observed

Angular 21.2.6 from `package.json`; signal-first state and `inject()` conventions from
`libs/frontend/core/CLAUDE.md`; standalone OnPush and zoneless-safe effects from
`libs/frontend/canvas/CLAUDE.md`. Styling and rendering markup were not changed.

## States and accessibility

Interactive request success, switch rejection, timeout, and tile-cap failure retain exactly-once
promise settlement. The task changes no rendered markup, focus behavior, labels, roles, or visual
states.

## Verification

1. `npx nx run-many -t test -p @ptah-extension/core @ptah-extension/canvas --parallel=1 --maxWorkers=2`
   - Final exit code: `0`.
   - Header: `NX Running target test for 2 projects` (`@ptah-extension/core`,
     `@ptah-extension/canvas`).
   - Core: `30 passed, 30 total`; `718 passed, 718 total`.
   - Canvas: `9 passed, 9 total`; `120 passed, 120 total`.
   - An earlier exit-1 run had the same two-project header and passed all 718 core tests, then found
     two new canvas-test failures because their placeholder session ids did not satisfy the existing
     UUID `SessionId` contract. The fixtures were corrected to stable UUIDs before the final run.
2. `npx nx run-many -t typecheck -p @ptah-extension/core @ptah-extension/canvas`
   - Exit code: `0`; `Successfully ran target typecheck for 2 projects`.
3. `npx nx run-many -t lint -p @ptah-extension/core @ptah-extension/canvas`
   - Exit code: `0`; canvas: `All files pass linting`; core: `0 errors, 11 warnings`.
   - All 11 warnings are pre-existing and in unrelated core files; none names a changed file.
4. Direct changed-file checks:
   - A raw `npx eslint <four changed files>` exited `1` because root direct invocation did not load
     the canvas library flat config, so three pre-existing inline Angular-rule suppressions reported
     “rule not found.”
   - `npx eslint --config libs/frontend/core/eslint.config.mjs <two core files>` plus
     `npx eslint --config libs/frontend/canvas/eslint.config.mjs <two canvas files>` exited `0` with
     no output.
   - Initial `npx prettier --check <four changed files>` exited `1`; `npx prettier --write ...`
     formatted all four, and the repeated check exited `0`: `All matched files use Prettier code
     style!`.
5. `npx nx run degradation-audit:lint --skip-nx-cache`
   - Exit code: `0`.
   - `degradation-audit: TOTAL 303 unsuppressed site(s)`.
   - Neither `libs/frontend/core` nor `libs/frontend/canvas` appears as a failing per-directory row.

## Plan deviations

- The perf-harness comment edits from the broader batch criterion were omitted because the direct
  lane prompt explicitly excludes the perf harness. No runtime or test requirement depends on those
  comments.
- The requested verification commands name only the core and canvas projects, so no e2e project was
  added to typecheck/lint.

## Out-of-scope observations

Concurrent Lane B edits are present in the shared worktree under `libs/frontend/chat/**`, and an
external edit is present in `implementation-plan.md`. Lane A did not inspect, modify, revert, or
format those files.
