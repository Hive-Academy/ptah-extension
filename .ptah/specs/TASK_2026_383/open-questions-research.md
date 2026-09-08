# Open Questions Research — TASK_2026_383

## Question

- Decision this supports: whether Batch 11's `config:models-list` regression and
  Batch 10's `session:list` double-call are understood well enough to close the
  task, or need a follow-up remedy.
- Question: (1) what mechanism, if any, in Batch 11's diff explains
  `config:models-list` going from 1175 ms to 2039 ms median; (2) is the "callers
  don't overlap" explanation for `session:list` firing twice actually true, and
  what would make it one call.
- Bounds: no new measurement was taken. This is a read of the existing diff
  (`git show 1269a187c`), the current code on `task/383-degradation-audit`, and
  the three `tmp/after-run*.json` traces already captured by Batch 12.2. No
  production code was edited.

## Answer

**Q1**: The code does not support a mechanism that would make `config:models-list`
slower. Batch 11.1/11.2's persistence is a cross-boot cache-fill/read path; on
the after-measurement runs it is a guaranteed **miss** (batch-12-2 used a fresh
DB copy per run), so the added code executes its cheap null-return branches and
falls through to the exact pre-Batch-11 fetch. The strongest code-grounded
candidate is indirect: Batch 11.3 moved `exec-git`'s ~30 call sites onto the
same `OffThreadProcessSpawner` used by `SdkModelService.fetchModelsViaSdk`, and
every `git:*` handler got measurably slower in the same run in the same way
(`git:info` 436→638 ms, `git:branches` 366→548 ms, `git:lastCommit` 284→503 ms,
`git:stashList` 174→547 ms) — additional off-thread spawns now landing in the
same boot window Windows-schedules against the model-service's own worker.
This is not proven; see Unknowns.

**Q2**: The "callers don't overlap" explanation is **false** per the trace — in
2 of 3 runs the second `session:list` request is sent before the first
answered. The debounce/single-flight in `session-loader.service.ts` cannot be
the reason either way: it only coalesces calls that reach
`runLoadSessions()`, and `libs/frontend/dashboard/.../session-analytics-state.service.ts:225`
calls `this.rpc.call('session:list', ...)` directly, never through
`SessionLoaderService`. The single-flight cannot join a caller it never sees.

## Evidence

| Claim                                                                                                                                                                                                                                                                                                                   | Source                                                                                                                     | Date                  | Verified how                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Batch 11 commit touches `sdk-model-service.ts`, `claude-cli-detector.ts`, `git-info.service.ts`, `exec-git.ts`, `phase-4-handlers.ts` only                                                                                                                                                                              | `git show 1269a187c --stat` in the worktree                                                                                | 2026-09-07            | ran the command                                                                                                                                                                                       |
| `getSupportedModels()` checks `pendingModels` in-flight map, then `restorePersistedCatalog(key)`, only when nothing is in flight                                                                                                                                                                                        | `libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.ts:382-407`                                                      | current worktree HEAD | read                                                                                                                                                                                                  |
| `readPersistedStore()` is a synchronous in-memory `Map`/JSON read (`stateStorage.get()`), not disk I/O per call                                                                                                                                                                                                         | `sdk-model-service.ts:493-509`; `libs/backend/platform-electron/src/implementations/electron-state-storage.ts:23-26,55-61` | current               | read — `ElectronStateStorage.get()` reads `this.data`, populated once by a synchronous `loadSync()` at construction, well before this batch                                                           |
| `persistCatalog()` is fire-and-forget (`void storage.update(...).catch(...)`) — does not block the RPC response                                                                                                                                                                                                         | `sdk-model-service.ts:520-545`                                                                                             | current               | read                                                                                                                                                                                                  |
| `ClaudeCliDetector.restorePersistedVerdict()` returns `null` immediately when `storage.get()` is `undefined` (no persisted entry), doing no `fs.promises.stat` in that case                                                                                                                                             | `libs/backend/agent-sdk/src/lib/detector/claude-cli-detector.ts:265-299`                                                   | current               | read                                                                                                                                                                                                  |
| Batch 12.2's three after-runs each used **a fresh database copy**, so nothing a prior boot wrote to `IStateStorage` can have been read back                                                                                                                                                                             | `.ptah/specs/TASK_2026_383/batch-12-2-after-measurement.md:103-107`                                                        | 2026-09-07            | read the report                                                                                                                                                                                       |
| `exec-git.ts`'s ~30 `GitInfoService` call sites now route through `IProcessSpawner` (aliased to the same `SDK_TOKENS.SDK_PROCESS_SPAWNER` singleton `SdkModelService` uses) instead of inline `crossSpawn`                                                                                                              | `batch-11-report.md:41-68`; `git-info.service.ts:245-258,2311/2321,2327-2337`                                              | 2026-09-07 / current  | read report + code                                                                                                                                                                                    |
| Every `git:*` handler measured slower after Batch 11, in the same run `config:models-list` also regressed                                                                                                                                                                                                               | `batch-12-2-after-measurement.md:58-79`                                                                                    | 2026-09-07            | read the report's own duration tables                                                                                                                                                                 |
| `OffThreadProcessSpawner` (`WorkerBackedProcess`) constructs **a new `Worker` per spawn** (`new Worker(OFF_THREAD_SPAWNER_WORKER_SOURCE, { eval: true })` inside the per-call constructor), not one shared worker                                                                                                       | `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.ts:294`                                                 | current               | read                                                                                                                                                                                                  |
| `SdkModuleLoader.getCliJsPath()` calls `this.cliDetector.findExecutable()`, so the CLI detector sits on `fetchModelsViaSdk`'s path                                                                                                                                                                                      | `libs/backend/agent-sdk/src/lib/helpers/sdk-module-loader.ts:134-156`                                                      | current               | read                                                                                                                                                                                                  |
| The two `session:list` calls in every after-run share the identical response `dataShape` (`sessions,total,hasMore`) and answer at nearly the same timestamp as each other within a run, but the **second call's `sentAt` precedes the first call's `answeredAt`** in runs A and C                                       | `tmp/after-runA.json`, `tmp/after-runC.json` (`rpcs` array, `method: "session:list"` entries)                              | 2026-09-07            | computed directly: run A gap 29 ms vs. first call's 228 ms duration (199 ms overlap); run C gap 170 ms vs. 239 ms duration (69 ms overlap); run B gap 5 ms vs. 3 ms duration (no overlap, 2 ms clear) |
| `loadSessions()` clears any pending debounce timer and starts a fresh one on every call; a second call inside the 300 ms window **replaces** the first call's timer, so the first call's own `Promise` never settles and no second RPC can be produced by two same-instance callers landing within 300 ms of each other | `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:195-231`                                         | current               | read — matches the documented pre-existing defect ("每 call returns a new Promise whose resolve/reject live in a setTimeout the next call clears") in `batch-10-report.md:335-341`                    |
| Only one of the five documented `loadSessions()` callers fires unconditionally on boot: `ChatLifecycleService.bootstrap()`                                                                                                                                                                                              | `libs/frontend/chat/src/lib/services/chat-store/chat-lifecycle.service.ts:50-56`                                           | current               | read — the other four (`:248`, `:319`, stats aggregator, message handler) are event-driven (session-id resolution, chat error, stats broadcast, message handling), not called from `bootstrap()`      |
| `session-analytics-state.service.ts` issues its own `session:list` RPC directly through `this.rpc`, with a `since`/limit shape different from the sidebar loader's, and never through `SessionLoaderService`                                                                                                            | `libs/frontend/dashboard/src/lib/services/session-analytics-state.service.ts:205-230`                                      | current               | read — same finding `batch-10-report.md:212-238` already made for a different purpose (justifying why the dashboard rewire was rejected)                                                              |

## Options

Not applicable in the usual sense — this is a diagnostic question, not a design
choice between implementations. For Q2's "what would make it one call",
options are laid out below since the prompt asks for them explicitly.

| Option                                                                                                        | Fit here                                                                                                                                                                                                                                                                                                                                              | Cost to adopt                                                                                                                                             | Known failure mode                                                                                                      |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Longer debounce window on `SessionLoaderService`                                                              | Does nothing — the dashboard call never reaches this class, so no debounce value joins it                                                                                                                                                                                                                                                             | None to adopt, zero benefit                                                                                                                               | False confidence: looks like a fix, changes nothing                                                                     |
| Short-lived result cache in a shared `type:data-access` lib, keyed on `(workspacePath, since, limit, offset)` | Correct shape for the actual problem — the two callers ask different questions, so a naive single answer cache misses; a real cache would need the sidebar's page and the dashboard's date-bounded set as separate entries, which converges to "two cached answers", not one call, unless one caller is rewritten to read a superset the other slices | Cross-library data-access lib, a boundary neither `chat` nor `dashboard` crosses today (`batch-10-report.md:228-234`) — real design work, not a leaf edit | Staleness window has to be tuned per surface; the dashboard's `since` makes a blanket TTL wrong for both shapes at once |
| Remove one caller (e.g., serve the dashboard from the sidebar's cached list)                                  | Rejected already in Batch 10 with evidence: different query shapes (`since` bound, different limit) — would silently drop the dashboard's date range or cap it at the sidebar's page size                                                                                                                                                             | N/A — a behavior regression, not a remedy                                                                                                                 | Dashboard analytics would show the wrong window                                                                         |

## Disagreements

- The task's premise ("the working explanation is that the single-flight only
  joins callers whose requests overlap in time, and the two boot-window callers
  do not overlap") is contradicted by the trace: in runs A and C the second
  request is sent while the first is still in flight (199 ms and 69 ms of
  overlap respectively). Only run B shows no overlap, and by 2 ms — inside
  measurement noise. Overlap timing is not what determines whether the
  single-flight helps here; **the second call never goes through the class that
  owns the single-flight at all**, so overlap is moot.

## Local consequences

- `libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.ts` and
  `libs/backend/agent-sdk/src/lib/detector/claude-cli-detector.ts`: no code
  defect found. Their persistence paths are cold on every after-measurement run
  and cannot be blamed for the regression from source alone.
- `libs/backend/vscode-core/src/utils/exec-git.ts` /
  `libs/backend/vscode-core/src/services/git-info.service.ts`: the off-thread
  routing this batch shipped is the one change in the same commit with a
  measured, same-direction regression (`git:*` handlers), making it the
  strongest candidate worth instrumenting next, ahead of re-reading the model
  service.
- `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`:
  confirmed working as designed for the callers it owns; not the place to add
  a fix for the double `session:list`.
- `libs/frontend/dashboard/src/lib/services/session-analytics-state.service.ts:225`:
  the most likely second boot-window caller. Not verified by request
  parameters (the trace does not record them), only by response shape and by
  elimination of the other four documented `loadSessions()` callers, none of
  which is boot-triggered.

## Unknowns

- Whether `OffThreadProcessSpawner`'s new-Worker-per-spawn model actually
  causes measurable CPU/OS contention between concurrent `git:*` spawns and the
  model service's own spawn, versus the regression being pure measurement
  noise from the same probe reliability problem the report already flags
  (P-1, 11-12 attach retries in this same measurement round). The smallest
  experiment: rerun the boot-probe capturing worker-thread create/spawn
  timestamps (or just re-run `config:models-list` in isolation, with the four
  `git:*` RPCs suppressed) — if the regression disappears when git calls are
  removed from the boot window, contention is confirmed; if it persists,
  the cause is still open.
- Whether the two `session:list` calls are genuinely
  `ChatLifecycleService.bootstrap()` + `session-analytics-state.service.ts`, or
  two calls from the sidebar loader on some path this reading missed. The trace
  files do not carry request parameters, only response shape, so this is
  inferred from code elimination, not confirmed from the trace directly. The
  smallest experiment: add `workspacePath`/`since`/`limit` to the probe's
  captured RPC params (or grep `tmp/logs/log.log` for the two `session:list`
  RPC ids' argument logging, if the handler logs params) for one more run.
