# Development Tasks - TASK_2026_331

**Total Tasks**: 46 | **Batches**: 8 (7 plan batches; Batch 2 splits into 2A backend and 2B frontend) | **Status**: 1/8 complete (Batch 1 done)

**Source plan**: `implementation-plan.md` (v2, approved 2026-08-27)
**Branch**: `fix/electron-update-check-timeout`

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions verified against source

| #   | Assumption in plan                                                         | Result                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `bootThothRuntime` opens SQLite before the boot scans                      | CONFIRMED. `boot-thoth-runtime.ts:76` awaits `openAndMigrate()`. The COUNT probes (`:135`), memory trigger (`:163`), skill synthesis (`:279`) and file index (`:386`) all run after it. |
| 2   | `scheduleWarmup` returns early when the curator is null                    | CONFIRMED. `wire-runtime.ts:617`.                                                                                                                                                       |
| 3   | `bootHeavyServices` is a one-shot latch shared with the workspace listener | CONFIRMED. `wire-runtime.ts:480-483`, listener at `:530`, startup call at `:569`.                                                                                                       |
| 4   | `main.ts` copies refs into 15 nullable variables                           | CONFIRMED. `main.ts:40-69`; LIFO disposal at `main.ts:224-416`.                                                                                                                         |
| 5   | `session:list` is SQLite-backed and must return a readiness error          | **FALSE — see RISK 1**.                                                                                                                                                                 |

### Risks identified

| #   | Risk                                                                                                                                                                                                                                                                                                              | Severity | Mitigation                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The plan puts `session:list` in the SQLite readiness set. `SessionRpcHandlers` reads `SessionMetadataStore.getForWorkspace` (`session-rpc.handlers.ts:298`), and that store injects `PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE` (`session-metadata-store.ts:254`), not SQLite. `session:list` never touches SQLite. | HIGH     | Task B2A.T4 must not add a SQLite readiness guard to `session:list`. It adds an **import-readiness** guard instead. Task B1.T5 records the real Batch 1 effect: the list is short until the deferred import finishes. |
| 2   | `session:list` does **not** return an empty list on failure today. Any throw inside the handler is re-thrown as `Failed to list sessions: <message>` (`session-rpc.handlers.ts:349-362`). A deferred import cannot rely on a silent empty result.                                                                 | HIGH     | Batch 1 must not change this behaviour, and must not make the handler throw where it did not throw before. B1.T5 adds a spec that pins "empty store gives `{ sessions: [], total: 0, hasMore: false }`, no throw".    |
| 3   | The plan removes the `bootHeavyServices` await before the window. The comment at `wire-runtime.ts:501-506` states the one-shot latch is safe only because no await sits between listener registration and the boot call.                                                                                          | HIGH     | B1.T3 registers the listener and reserves the promise in the same synchronous block. A spec asserts no `await` between them.                                                                                          |
| 4   | `will-quit` cannot block. A fire-and-forget post-window boot can create services after the disposal chain has run.                                                                                                                                                                                                | HIGH     | B1.T1 + B1.T6: stable `BootRefs` object plus `abort()` and a bounded 2 s `awaitCompletion`.                                                                                                                           |
| 5   | `workspace-indexer.service.ts:295-302` tests only array length from `matchFiles`, so any non-empty `excludePatterns` skips every file.                                                                                                                                                                            | MEDIUM   | B6.T1 fixes the bug in main-process code and pins it with a spec **before** B6.T5 reproduces the logic in the worker.                                                                                                 |
| 6   | A second writable SQLite connection breaks the single-owner rule.                                                                                                                                                                                                                                                 | MEDIUM   | B5.T3 handshake: SQLite version, canonical path, WAL mode, protocol version, `busy_timeout`, short transactions, request deadlines. Documented in the file header.                                                    |
| 7   | Tail-only transcript reads permanently skip data in completed sessions.                                                                                                                                                                                                                                           | MEDIUM   | Batch 3 uses a persisted byte cursor. The watermark advances only after the last chunk.                                                                                                                               |
| 8   | A failed backup can rotate out a valid backup (`backup.service.ts:37-42`).                                                                                                                                                                                                                                        | MEDIUM   | B5.T8 validates with `quick_check` before rotation.                                                                                                                                                                   |

### Edge cases to handle

- [ ] Quit fires while the post-window boot runs -> B1.T6
- [ ] `did-finish-load` fires before the memory curator exists -> B1.T7
- [ ] Workspace change event arrives before the startup boot is reserved -> B1.T3
- [ ] `session:list` runs while the import is still in flight -> B1.T5, B2A.T4, B2B.T1
- [ ] Worker crash loop and stale responses after restart -> B5.T4, B6.T3
- [ ] Crash during the `compact` state -> B5.T10
- [ ] Empty metadata store returns an empty list, not an error -> B1.T5

### Defaults taken (no user answer was supplied)

- Batching follows the plan order. Batch 1 ships alone.
- Execution mode is sequential in every batch that rewrites `wire-runtime.ts` or `main.ts`.
- Parallel mode is used only where the task set is file-disjoint.

---

## Batch 1: Boot coordinator and window-first reordering

**Status**: DONE (code merged; the manual `nx serve` timing run is still outstanding)
**Recommended Executor**: backend-developer
**Fallback Executor**: general-purpose
**Execution Mode**: sequential
**Rationale**: every task edits the same three activation files (`main.ts`, `wire-runtime.ts`, `post-window.ts`). The tasks are not file-disjoint, so a parallel lane would conflict.
**Tasks**: 8 | **Dependencies**: none

### Independence statement (READ FIRST)

Batch 1 is independently shippable. It does **not** depend on Batches 2-7.

Until Batch 2 lands there is no readiness contract, so the renderer can call an RPC before the backend finishes the post-window boot. Two rules bound that window:

1. **Open SQLite FIRST in the post-window boot.** `bootThothRuntime` already awaits `openAndMigrate()` at `boot-thoth-runtime.ts:76` before every scan. Keep that order and make `bootThothRuntime` the first call in `wireRuntimePostWindow`. Do not put the harness reconcile, the user-layer mirror or `scanAndImport` before it.
2. **Do not change `session:list` behaviour.** Verified today: the handler reads `SessionMetadataStore`, which is backed by `IStateStorage`, not SQLite. An empty store gives `{ sessions: [], total: 0, hasMore: false }`. A thrown error is re-thrown as `Failed to list sessions: <message>`. Batch 1 keeps both. The visible effect of the deferred import is a short list that grows, not an error.

---

### Task B1.T1: Add the BootCoordinator class — DONE

**Files**

- CREATE `D:\projects\ptah-extension\apps\ptah-electron\src\activation\boot-coordinator.ts`
- CREATE `D:\projects\ptah-extension\apps\ptah-electron\src\activation\boot-coordinator.spec.ts`

**Spec reference**: implementation-plan.md, Component 1 (lines 66-146)

**Acceptance criteria**

- Export `BootReadiness = 'warming' | 'ready' | 'degraded' | 'failed'`.
- Export `BootRefs` with every field that `wire-runtime.ts:190-200` and `post-window.ts` populate today. Read both files and copy the full set. Fields start as `null`.
- The `refs` object is `readonly` and is never reassigned.
- `startPostWindow(fn)` stores the promise, catches all rejections, sets `failed` on error, and sets `ready` on success.
- `abort()` aborts the internal `AbortController`. `abortSignal` exposes the signal.
- `awaitCompletion(timeoutMs)` returns after the promise settles or the timeout, whichever is first. It never throws.
- `isRunning` is `true` only while a post-window promise is pending.
- The class never throws from any method.
- `catch (error: unknown)` in every catch block.

**Tests to write**: `boot-coordinator.spec.ts` — readiness transitions (warming to ready, warming to failed), `awaitCompletion` returns on timeout when the promise hangs, `abort()` fires the signal, `refs` identity is stable after `startPostWindow`.

**Dependencies**: none

---

### Task B1.T2: Make the network calls in bootstrap fire-and-forget — DONE

**Files**

- MODIFY `D:\projects\ptah-extension\apps\ptah-electron\src\activation\bootstrap.ts`

**Spec reference**: implementation-plan.md 7.12 (lines 566-570); boot-path audit rows 3 and 4

**Acceptance criteria**

- `verifyLicense()` at `bootstrap.ts:230` no longer blocks. Start it and attach a `.catch` that logs and does not re-throw.
- `agentAdapter.initialize()` at `bootstrap.ts:302` no longer blocks. Same pattern. The existing non-fatal handling at `bootstrap.ts:317-322` stays.
- Settings migration and `restoreWorkspaces()` stay awaited. The renderer reads `workspaceRoot` from `get-startup-config`.
- `bootstrapElectron` still returns `startupWorkspaceRoot` with the same value as before.

**Tests to write**: a spec that asserts `bootstrapElectron` resolves while a slow `verifyLicense` stub is still pending, and that a rejected `verifyLicense` does not reject `bootstrapElectron`.

**Dependencies**: none

---

### Task B1.T3: Split wireRuntime into pre-window and post-window — DONE

**Files**

- MODIFY `D:\projects\ptah-extension\apps\ptah-electron\src\activation\wire-runtime.ts`

**Spec reference**: implementation-plan.md Component 1 + Component 3 (lines 200-229)

**Acceptance criteria**

- `wireRuntimePreWindow(...)` keeps, in this order: `armDiagnostics()` (`:190`), the IPC bridge, `registerRpcSurface()` (`:224`), `bringUpSubsystems()` (`:510`). It returns synchronously reachable results only. It accepts a `BootCoordinator`.
- `wireRuntimePostWindow(coordinator)` holds every heavy step that `bootHeavyServicesOnce` runs today (`:289-477`).
- The workspace listener registration (`:530`) and the startup boot reservation run in the **same synchronous block**, with no `await` between them:

  ```ts
  workspaceProvider.onDidChangeWorkspaceFolders(() => { ... });
  if (startupWorkspaceRoot) {
    coordinator.startPostWindow(() => bootHeavyServices(startupWorkspaceRoot, coordinator));
  }
  ```

- `bootHeavyServices` keys its one-shot latch by the normalized workspace root. The same root joins the in-flight promise. A different root starts a new boot.
- The file stays under the 700-line soft ceiling. If it does not, extract `bootHeavyServices` into `apps/ptah-electron/src/activation/boot-heavy-services.ts` and keep the exported names of `wireRuntime`'s public surface.
- No behaviour is deleted. Every call in `bootHeavyServicesOnce` still runs, only later.

**Tests to write**: workspace-race spec — fire `onDidChangeWorkspaceFolders` with a different root in the same tick as the startup reservation; assert the startup root wins the latch and the second root does not steal it.

**Dependencies**: B1.T1

---

### Task B1.T4: Stop awaiting the boot scans and COUNT probes in bootThothRuntime — DONE

**Files**

- MODIFY `D:\projects\ptah-extension\libs\backend\thoth-runtime\src\lib\boot-thoth-runtime.ts`

**Spec reference**: implementation-plan.md 7.4, 7.5, 7.8, 7.9 (lines 445-543)

**Acceptance criteria**

- `bootThothRuntime` accepts an optional `AbortSignal`.
- `openAndMigrate()` at `:76` stays awaited and stays first. `refs.sqliteConnection` is set before anything else runs. This is the rule that keeps the Batch 1 failure window short.
- The two `SELECT COUNT(*)` probes reached from `:135` are no longer awaited inside the boot. Start them and let the existing `MEMORY_CORPUS_CHANGED` message update the badge.
- `memoryTrigger.start()` (`:163`), `skillSynthesis.start()` (`:279`) and `fileIndex.start()` (`:386`) are started, not awaited. Each attaches a `.catch` that logs.
- Every started operation checks `signal.aborted` before it begins and stops at its next yield point when the signal fires.
- The returned refs object carries the same fields as today.

**Tests to write**: assert `bootThothRuntime` resolves while a slow `memoryTrigger.start` stub is pending; assert `openAndMigrate` resolved before the stub was called; assert an already-aborted signal skips the scans.

**Dependencies**: B1.T1, B1.T3

---

### Task B1.T5: Move the harness, user-layer and session import work after the window — DONE

**Files**

- MODIFY `D:\projects\ptah-extension\apps\ptah-electron\src\activation\wire-runtime.ts`
- MODIFY `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\session-importer.service.ts`
- CREATE or MODIFY `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\session-rpc.handlers.spec.ts`

**Spec reference**: implementation-plan.md 7.3 and 7.7 (lines 427-517)

**Acceptance criteria**

- `mirrorUserLayer` (`:309`, `:330`), `reconcileUserLayer` (`:317`, `:335`), `reconcileHarness` (`:345`, `:360`) and `sessionImporter.scanAndImport` (`:429`) run inside `wireRuntimePostWindow`, after `bootThothRuntime` returns.
- The deliberate double reconcile (pre-network then post-download, `:330-356`) stays. Do not collapse it.
- `SessionImporterService.scanAndImport` yields with `setImmediate` between sessions so the event loop is not held for the whole scan.
- The `session:list` handler is **unchanged**. Add a spec that pins today's behaviour: an empty `SessionMetadataStore` returns `{ sessions: [], total: 0, hasMore: false }` and does not throw; a store that throws produces the existing `Failed to list sessions:` error.
- Write a code comment above the moved `scanAndImport` call that states the user-visible effect: the sidebar list is short at first and grows as the import runs.

**Tests to write**: importer yields between sessions (assert `setImmediate` scheduling with fake timers); `session:list` empty-store spec described above.

**Dependencies**: B1.T3, B1.T4

---

### Task B1.T6: Rewrite main.ts around the coordinator — DONE

**Files**

- MODIFY `D:\projects\ptah-extension\apps\ptah-electron\src\main.ts`
- MODIFY `D:\projects\ptah-extension\apps\ptah-electron\src\main.quit-path.spec.ts` (extend; do not weaken the existing assertions)

**Spec reference**: implementation-plan.md Component 1 (lines 74-138)

**Acceptance criteria**

- The 15 nullable variables at `main.ts:40-69` are replaced by one `BootCoordinator` reference plus the variables that are not boot refs (`mainWindow`, `trayService`, the two intervals).
- Order in `whenReady`: `bootstrapElectron` -> `wireRuntimePreWindow` -> `registerPostWindow` (window opens) -> `coordinator.startPostWindow(...)`.
- `will-quit` runs: `flushWorkspacePersistence()`, `flushSessionMetadataStores()`, `coordinator.abort()`, `coordinator.awaitCompletion(2000)`, then the existing LIFO chain reading from `coordinator.refs`.
- The LIFO order in `main.ts:224-416` is preserved exactly. Diagnostics stay last.
- Every disposal keeps its `try / catch (error: unknown)` and its non-fatal warning.
- `handleWindowAllClosed` delegation and the tray behaviour are unchanged.

**Tests to write**: quit-during-boot — start a post-window promise that never settles, fire `will-quit`, assert `abort()` was called, assert disposal ran after about 2000 ms of fake time, assert LIFO order.

**Dependencies**: B1.T1, B1.T2, B1.T3

---

### Task B1.T7: Add the warmup promise barrier — DONE

**Files**

- MODIFY `D:\projects\ptah-extension\apps\ptah-electron\src\activation\boot-coordinator.ts`
- MODIFY `D:\projects\ptah-extension\apps\ptah-electron\src\activation\wire-runtime.ts`
- MODIFY `D:\projects\ptah-extension\apps\ptah-electron\src\activation\post-window.ts`

**Spec reference**: implementation-plan.md Component 8 (lines 572-588)

**Acceptance criteria**

- `scheduleWarmup` moves onto the coordinator. It waits for **both** `did-finish-load` and `refs.memoryCurator !== null`.
- The curator poll uses `setInterval(200)` with `unref()`, and a 30 s timeout.
- The existing 3-second idle timer starts only after both conditions hold.
- The interval is cleared on success, on timeout and on abort.
- The early return at `wire-runtime.ts:617` is removed; the barrier replaces it.

**Tests to write**: warmup barrier — fire `did-finish-load` first, set the curator 5 s later, assert warmup ran; assert no warmup and no leaked interval after the 30 s timeout.

**Dependencies**: B1.T1, B1.T6

---

### Task B1.T8: Add the boot-order regression spec — DONE

**Files**

- CREATE `D:\projects\ptah-extension\apps\ptah-electron\src\activation\boot-order.spec.ts`

**Spec reference**: implementation-plan.md Verification (lines 613-639)

**Acceptance criteria**

- The spec drives the activation sequence with stubs and records the call order.
- It asserts window creation happens before `scanAndImport`, before `reconcileHarness` and before `memoryTrigger.start`.
- It asserts `openAndMigrate` is the first call in the post-window phase.
- It asserts no network stub (`verifyLicense`, `agentAdapter.initialize`) is awaited before window creation.

**Tests to write**: this task is the test.

**Dependencies**: B1.T1 to B1.T7

---

**Batch 1 verification**

```bash
npx nx run-many -t test -p ptah-electron @ptah-extension/thoth-runtime @ptah-extension/agent-sdk @ptah-extension/rpc-handlers
npm run typecheck:all
npm run lint:all
```

Read the header line `Running target test for 4 projects` and confirm the number is 4.

Manual run: `npx nx serve ptah-electron`. In the log look for:

- `[Ptah Electron] Startup config registered` — must appear in less than 5 s on a warm start (73 s before).
- `[event-loop] lag` — `maxMs` must stay under 500 ms in the first 120 s.
- `Imported N sessions` — must appear **after** `Startup config registered`.
- `PRAGMA quick_check` — still present in Batch 1 (Batch 5 removes it from the boot path).

**Batch 1 commit message**

```
perf(electron): open the window before the heavy boot (TASK_2026_331 B1)
```

---

## Batch 2A: Readiness contracts in shared and backend

**Status**: PENDING
**Recommended Executor**: backend-developer
**Fallback Executor**: general-purpose
**Execution Mode**: sequential
**Rationale**: the type widening in `libs/shared` must land before the handlers compile against it. The handler edits are file-disjoint but share the new type, so one lane keeps the build green.
**Tasks**: 5 | **Dependencies**: Batch 1

### Task B2A.T1: Add the readiness types — PENDING

**Files**

- CREATE `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc\rpc-readiness.types.ts`
- MODIFY `D:\projects\ptah-extension\libs\shared\src\index.ts`

**Acceptance criteria**: export `BackendReadiness` and `RpcReadinessError` exactly as specified in implementation-plan.md lines 160-170. Add a type guard `isRpcReadinessError(value: unknown): value is RpcReadinessError`. Export both from the barrel.

**Tests to write**: type-guard spec — rejects a normal result object, accepts a readiness error.

**Dependencies**: none

---

### Task B2A.T2: Add the BOOT_READINESS_CHANGED message type — PENDING

**Files**

- MODIFY `D:\projects\ptah-extension\libs\shared\src\lib\types\messages\message-constants.ts`
- MODIFY `D:\projects\ptah-extension\libs\shared\src\lib\types\messages\message-type.ts`

**Acceptance criteria**: add `BOOT_READINESS_CHANGED: 'boot:readinessChanged'` to `MESSAGE_TYPES` and the literal to `StrictMessageType`. This is the only new message type in the whole task.

**Tests to write**: extend the existing message-constants spec so the new key is covered by the exhaustiveness assertion.

**Dependencies**: B2A.T1

---

### Task B2A.T3: Widen the SQLite-backed RPC result contracts — PENDING

**Files**

- MODIFY `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc\rpc-memory.types.ts`
- MODIFY `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc\rpc-corpus.types.ts`
- MODIFY `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc\rpc-session.types.ts`

**Acceptance criteria**

- Add `<Name>Response = (<Name>Result & { ready: true }) | RpcReadinessError` for the memory and corpus results.
- `rpc-session.types.ts`: add the response union but **do not** change `SessionListResult` itself. See RISK 1: `session:list` is not SQLite-backed. The union exists for `session:stats-batch`, which is.
- Do not delete or rename any existing exported type. The unions are additive.

**Tests to write**: a compile-time spec file that assigns both variants and asserts narrowing works.

**Dependencies**: B2A.T1

---

### Task B2A.T4: Add readiness guards to the SQLite-backed handlers — PENDING

**Files**

- MODIFY `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\memory-rpc.handlers.ts`
- MODIFY `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\skills-synthesis-rpc.handlers.ts`
- MODIFY `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\indexing-rpc.handlers.ts`
- MODIFY `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\session-rpc.handlers.ts` (only `session:stats-batch`)

**Acceptance criteria**

- Each SQLite-backed method starts with one guard: if the connection is not open, return an `RpcReadinessError` with `readiness: 'warming'`, `retryAfterMs: 2000` and a short `reason`.
- **`session:list` gets no SQLite guard.** It reads `SessionMetadataStore`, which uses `PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE` (`session-metadata-store.ts:254`). Its behaviour stays exactly as Batch 1 left it.
- `db:*` already signals unavailability through `DbHealthResult` nullable fields. Do not change it.
- Zod validation of inbound params stays first, before the guard, in every handler that has it.

**Tests to write**: for each guarded method, set `isOpen = false` and assert the readiness error shape; set `isOpen = true` and assert the normal path. One spec asserts `session:list` still works with SQLite closed.

**Dependencies**: B2A.T1, B2A.T3

---

### Task B2A.T5: Broadcast the readiness transition — PENDING

**Files**

- MODIFY `D:\projects\ptah-extension\apps\ptah-electron\src\activation\boot-coordinator.ts`
- MODIFY `D:\projects\ptah-extension\apps\ptah-electron\src\activation\wire-runtime.ts`

**Acceptance criteria**: when readiness changes, the coordinator sends `BOOT_READINESS_CHANGED` to the renderer through the existing IPC bridge. The send is guarded: a destroyed or missing window must not throw. Each state is sent once.

**Tests to write**: readiness broadcast — one message per transition, no throw when the window is null.

**Dependencies**: B2A.T2, Batch 1

---

**Batch 2A verification**

```bash
npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/rpc-handlers ptah-electron
npm run typecheck:all
npm run lint:all
```

**Batch 2A commit message**

```
feat(shared,rpc-handlers): return typed readiness errors while the backend warms (TASK_2026_331 B2A)
```

---

## Batch 2B: Frontend readiness retry

**Status**: PENDING
**Recommended Executor**: frontend-developer
**Fallback Executor**: general-purpose
**Execution Mode**: sequential
**Rationale**: Angular signal work in `libs/frontend`. Different skill set and different file set from 2A. It starts only after 2A publishes the types.
**Tasks**: 3 | **Dependencies**: Batch 2A

### Task B2B.T1: Retry the session load on a readiness error — PENDING

**Files**

- MODIFY `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\session-loader.service.ts`

**Acceptance criteria**

- `_loadSessionsImmediate()` checks the result with `isRpcReadinessError` before it reads `result.sessions`.
- On a readiness error it schedules one retry after `retryAfterMs` (default 2000 ms).
- The pending retry is cancelled when `BOOT_READINESS_CHANGED` reports `ready`, and the load runs at once.
- A retry cap (5 attempts) prevents an endless loop. After the cap the service logs once and leaves the list empty.
- The timer is cleared on service teardown. No leaked `setTimeout`.
- `ChangeDetectionStrategy.OnPush` and signal usage stay as they are.

**Tests to write**: readiness error schedules a retry; a `ready` notification cancels the timer and loads at once; the cap stops the loop; teardown clears the timer.

**Dependencies**: B2A.T1, B2A.T3

---

### Task B2B.T2: Handle readiness in the layout sync — PENDING

**Files**

- MODIFY `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\electron-layout.service.ts`

**Acceptance criteria**: `syncFromBackend()` (`:572-614`) treats a readiness error from `workspace:getInfo` or `workspace:switch` as "not ready yet", not as a failure. It retries once the readiness notification arrives. The existing success path is unchanged.

**Tests to write**: readiness error does not clear the current layout; a later `ready` notification re-runs the sync.

**Dependencies**: B2A.T1, B2A.T2

---

### Task B2B.T3: Route the readiness message to the frontend — PENDING

**Files**

- MODIFY the `MESSAGE_HANDLERS` registration in `D:\projects\ptah-extension\libs\frontend\core\src\lib` (find the map that binds `MESSAGE_TYPES` to handlers)

**Acceptance criteria**: `boot:readinessChanged` reaches a signal that `SessionLoaderService` and `ElectronLayoutService` both read. An unknown readiness value does not throw.

**Tests to write**: the handler updates the signal; an unknown payload is ignored.

**Dependencies**: B2A.T2

---

**Batch 2B verification**

```bash
npx nx run-many -t test -p @ptah-extension/chat @ptah-extension/core
npm run typecheck:all
npm run lint:all
```

**Batch 2B commit message**

```
feat(chat,core): retry startup RPCs when the backend reports it is warming (TASK_2026_331 B2B)
```

---

## Batch 3: Crash-resumable transcript chunking

**Status**: PENDING
**Recommended Executor**: backend-developer
**Fallback Executor**: general-purpose
**Execution Mode**: sequential
**Rationale**: the migration must exist before the two scanners read the cursor table. The memory and skill scanners share the cursor helper.
**Tasks**: 5 | **Dependencies**: Batch 1

### Task B3.T1: Add the session_scan_state migration — PENDING

**Files**

- CREATE `D:\projects\ptah-extension\libs\backend\persistence-sqlite\src\lib\migrations\0042_session_scan_state.ts`
- MODIFY the migration registry in `D:\projects\ptah-extension\libs\backend\persistence-sqlite\src\lib\migrations\` (follow the pattern of migration 0040)

**Acceptance criteria**: table `session_scan_state` with `session_id` primary key, `scanner` (memory or skills), `byte_cursor`, `fully_scanned`, `updated_at`. The primary key covers `session_id` plus `scanner`. Migration is idempotent and reversible in the same way as the neighbouring migrations.

**Tests to write**: migration applies on an empty DB; applying twice is safe.

**Dependencies**: none

---

### Task B3.T2: Add the scan-cursor store — PENDING

**Files**

- CREATE `D:\projects\ptah-extension\libs\backend\persistence-sqlite\src\lib\maintenance\session-scan-state.store.ts`
- MODIFY `D:\projects\ptah-extension\libs\backend\persistence-sqlite\src\index.ts`

**Acceptance criteria**: read, upsert and clear the cursor for a `(sessionId, scanner)` pair. The store never advances `fully_scanned` on its own; the caller decides. `catch (error: unknown)` throughout.

**Tests to write**: cursor round trip; `fully_scanned` stays false until set.

**Dependencies**: B3.T1

---

### Task B3.T3: Chunk the memory boot scan — PENDING

**Files**

- MODIFY `D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\triggers\boot-scan-runner.ts`
- MODIFY `D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\triggers\memory-trigger.service.ts`

**Acceptance criteria**

- Read each transcript in 256 KiB chunks from byte offset 0, not from the end.
- Persist the byte cursor after each chunk.
- Yield with `setImmediate` after each chunk.
- Advance `fully_scanned` only after the final chunk of that session.
- Honour the abort signal from Batch 1 between chunks.
- A resume after a crash continues from the stored cursor, not from 0.

**Tests to write**: a 3-chunk transcript persists the cursor twice before the watermark is set; a simulated crash resumes at the stored offset; abort stops between chunks.

**Dependencies**: B3.T2, B1.T4

---

### Task B3.T4: Chunk the skills boot scan — PENDING

**Files**

- MODIFY `D:\projects\ptah-extension\libs\backend\skill-synthesis\src\lib\trajectory-extractor.ts`
- MODIFY `D:\projects\ptah-extension\libs\backend\skill-synthesis\src\lib\skill-synthesis.service.ts`

**Acceptance criteria**: the same chunking rules as B3.T3, with `scanner = 'skills'`. `readJsonlMessages` no longer loads a whole file for the boot scan. Interactive reads keep the current whole-file path.

**Tests to write**: same shape as B3.T3, for the skills scanner.

**Dependencies**: B3.T2, B1.T4

---

### Task B3.T5: Add the no-data-loss spec — PENDING

**Files**

- CREATE `D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\triggers\boot-scan-chunking.spec.ts`

**Acceptance criteria**: a completed historical session that never receives a `PreCompact` event is fully scanned. The spec fails if the scanner reads only the tail.

**Tests to write**: this task is the test.

**Dependencies**: B3.T3, B3.T4

---

**Batch 3 verification**

```bash
npx nx run-many -t test -p @ptah-extension/persistence-sqlite @ptah-extension/memory-curator @ptah-extension/skill-synthesis
npm run typecheck:all
npm run lint:all
```

Manual run: watch for `[event-loop] lag` during the first 120 s. `maxMs` must stay under 500 ms while the boot scans run.

**Batch 3 commit message**

```
perf(memory-curator,skill-synthesis): read transcripts in resumable chunks (TASK_2026_331 B3)
```

---

## Batch 4: SKILL.md migration marker

**Status**: PENDING
**Recommended Executor**: backend-developer
**Fallback Executor**: general-purpose
**Execution Mode**: sequential
**Rationale**: three tasks in two files. Small and coupled.
**Tasks**: 3 | **Dependencies**: Batch 3 (shares the migration numbering)

### Task B4.T1: Add the skill_md_migration_state migration — PENDING

**Files**

- CREATE `D:\projects\ptah-extension\libs\backend\persistence-sqlite\src\lib\migrations\0043_skill_md_migration_state.ts`
- MODIFY the migration registry

**Acceptance criteria**: table `skill_md_migration_state` with `migration_version`, `last_scan_at` and a single-row constraint. Idempotent.

**Tests to write**: migration applies; second apply is safe.

**Dependencies**: B3.T1

---

### Task B4.T2: Read the marker before the SKILL.md walk — PENDING

**Files**

- MODIFY `D:\projects\ptah-extension\libs\backend\skill-synthesis\src\lib\skill-md-migration.ts`
- MODIFY `D:\projects\ptah-extension\libs\backend\skill-synthesis\src\lib\skill-synthesis.service.ts`

**Acceptance criteria**

- `migrateSkillMdFiles()` reads the marker first. If the migration version matches and `last_scan_at` is inside 24 h, it returns at once and does not call `readdirSync` or `readFileSync`.
- The marker is written only after a successful walk.
- Directory mtime is **not** used as the decision input. Read the plan Decision 6 (lines 781-787).
- SQLite is already open at this point (`skill-synthesis.service.ts:282-283` calls `openAndMigrate()` before `:304`). Do not add a sidecar file.

**Tests to write**: current marker skips the walk (assert zero `readdirSync` calls); a changed version runs the walk; a marker older than 24 h runs the walk.

**Dependencies**: B4.T1

---

### Task B4.T3: Add the boot-cost regression spec — PENDING

**Files**

- CREATE or MODIFY `D:\projects\ptah-extension\libs\backend\skill-synthesis\src\lib\skill-md-migration.spec.ts`

**Acceptance criteria**: with a current marker and 2000 stub files, the file-system provider receives no read call.

**Tests to write**: this task is the test.

**Dependencies**: B4.T2

---

**Batch 4 verification**

```bash
npx nx run-many -t test -p @ptah-extension/skill-synthesis @ptah-extension/persistence-sqlite
npm run typecheck:all
npm run lint:all
```

Manual run: the second launch must not show the SKILL.md walk in the log. Time between `openAndMigrate` and the next log line drops by about 2 s.

**Batch 4 commit message**

```
perf(skill-synthesis): skip the SKILL.md re-walk with a persisted marker (TASK_2026_331 B4)
```

---

## Batch 5: Maintenance worker and SQLite operations

**Status**: PENDING
**Recommended Executor**: backend-developer, with devops-engineer for T2 and T11
**Fallback Executor**: general-purpose
**Execution Mode**: sequential
**Rationale**: the port, the protocol, the client and the worker form one dependency chain. The esbuild target and the packaging check are the devops slice and can run in parallel with T3 to T10 once T1 and T2 land.
**Tasks**: 11 | **Dependencies**: Batch 1

### Task B5.T1: Add the request-agnostic worker port — PENDING

**Files**

- CREATE `D:\projects\ptah-extension\libs\backend\platform-core\src\interfaces\worker-process-factory.interface.ts`
- MODIFY `D:\projects\ptah-extension\libs\backend\platform-core\src\di\tokens.ts`
- MODIFY `D:\projects\ptah-extension\libs\backend\platform-core\src\index.ts`

**Acceptance criteria**: `IWorkerProcess` and `IWorkerProcessFactory` exactly as in plan lines 248-259. Add `PLATFORM_TOKENS.WORKER_PROCESS_FACTORY = Symbol.for('WorkerProcessFactory')`. The port references no domain protocol and no feature library.

**Tests to write**: a token-registry spec that asserts the new token is unique and exported.

**Dependencies**: none

---

### Task B5.T2: Add the maintenance-worker build target — PENDING

**Files**

- CREATE `D:\projects\ptah-extension\apps\ptah-electron\tsconfig.maintenance-worker.json`
- MODIFY `D:\projects\ptah-extension\apps\ptah-electron\project.json`

**Acceptance criteria**: a `build-maintenance-worker` target modelled on `build-embedder-worker`. Output `maintenance-worker.mjs`. `better-sqlite3` and `sqlite-vec` stay external. The target is chained into `build`.

**Tests to write**: none (build config). Verify with `npx nx build-maintenance-worker ptah-electron`.

**Dependencies**: none

---

### Task B5.T3: Add the maintenance worker protocol — PENDING

**Files**

- CREATE `D:\projects\ptah-extension\libs\backend\persistence-sqlite\src\lib\maintenance\maintenance-worker-protocol.ts`

**Acceptance criteria**: request and response types plus Zod schemas for both directions. Operations: `integrity-check`, `purge-batch`, `backup`, `compact-step`. Every message carries `id` and `protocolVersion`. The handshake message carries the SQLite version, the canonical DB path and the journal mode. The file documents the second-writable-connection exception in its header.

**Tests to write**: schema round trip; a malformed message is rejected.

**Dependencies**: none

---

### Task B5.T4: Add the maintenance worker client — PENDING

**Files**

- CREATE `D:\projects\ptah-extension\libs\backend\persistence-sqlite\src\lib\maintenance\maintenance-worker-client.ts`
- MODIFY `D:\projects\ptah-extension\libs\backend\persistence-sqlite\src\lib\di\tokens.ts`
- MODIFY `D:\projects\ptah-extension\libs\backend\persistence-sqlite\src\index.ts`

**Acceptance criteria**: lazy spawn, request and response correlation by `id`, per-request deadline (60 s for scans, 300 s for backup), stale-response rejection after abort or restart, crash-loop guard, idle teardown. It injects `PLATFORM_TOKENS.WORKER_PROCESS_FACTORY`. When no factory is registered (VS Code, CLI), it falls back to the current in-process behaviour. Follow `EmbedderWorkerClient` (`embedder-worker-client.ts:68-309`).

**Tests to write**: stale response after restart is rejected; deadline rejects a hung request; crash loop stops respawning; missing factory falls back.

**Dependencies**: B5.T1, B5.T3

---

### Task B5.T5: Add the maintenance worker entry — PENDING

**Files**

- CREATE `D:\projects\ptah-extension\libs\backend\persistence-sqlite\src\lib\maintenance\maintenance-worker.ts`

**Acceptance criteria**

- Handshake first: assert `sqlite_version() >= 3.51.3`, canonical path match, `journal_mode = wal`, protocol version match. Refuse to serve if any check fails.
- `busy_timeout = 5000`.
- The worker **never** runs migrations.
- The read-only handle closes immediately after each scan.
- WAL size is reported before and after each scan and backup.
- Every inbound message is Zod-validated.

**Tests to write**: handshake refuses an old SQLite version, a wrong path and a wrong journal mode; the read-only handle closes after a scan.

**Dependencies**: B5.T3

---

### Task B5.T6: Add the maintenance state table and store — PENDING

**Files**

- CREATE `D:\projects\ptah-extension\libs\backend\persistence-sqlite\src\lib\migrations\0041_db_maintenance_state.ts`
- CREATE `D:\projects\ptah-extension\libs\backend\persistence-sqlite\src\lib\maintenance\maintenance-state.ts`

**Acceptance criteria**: columns `operation`, `next_eligible_at`, `cursor_id`, `result_json`, `lease_owner`, `lease_expires_at`. A lease is claimable only when it is free or expired. Note: this migration is numbered 0041 and must apply before 0042 and 0043 from Batches 3 and 4. Confirm the registry order.

**Tests to write**: lease claim and release; expired lease is claimable; migration order spec.

**Dependencies**: none

---

### Task B5.T7: Move the integrity check off the boot path — PENDING

**Files**

- MODIFY `D:\projects\ptah-extension\libs\backend\persistence-sqlite\src\lib\sqlite-connection.service.ts`

**Acceptance criteria**: `openAndMigrate()` no longer calls `runBootChecks` (`:604`). The worker runs `quick_check` and `foreign_key_check` on a 7-day cycle driven by `next_eligible_at`. First boot after install runs at once (`next_eligible_at = 0`). A corruption finding is logged and surfaced through `db:health`.

**Tests to write**: `openAndMigrate` does not call the check; the scheduler skips inside the window and runs outside it; a corruption result reaches `db:health`.

**Dependencies**: B5.T4, B5.T6

---

### Task B5.T8: Add the batched retention purge and validated backup — PENDING

**Files**

- MODIFY `D:\projects\ptah-extension\libs\backend\persistence-sqlite\src\lib\maintenance\maintenance-worker.ts`
- MODIFY the backup service that rotates snapshots (`backup.service.ts:37-42`)

**Acceptance criteria**

- Purge in batches of 250 to 500 rows inside `BEGIN IMMEDIATE`. Each batch commits in under 100 ms under normal load. Sleep 100 to 250 ms between batches. Save the cursor in `db_maintenance_state.cursor_id`.
- On `SQLITE_BUSY`: roll back, back off with jitter, retry without advancing the cursor.
- Default retention 30 days, checked daily.
- The backup validates with `quick_check` **before** rotation. A failed backup must never rotate an old valid backup out.

**Tests to write**: purge resumes from the cursor; `SQLITE_BUSY` does not advance the cursor; a failed backup leaves the old backup in place.

**Dependencies**: B5.T5, B5.T6

---

### Task B5.T9: Add the compaction state machine — PENDING

**Files**

- CREATE `D:\projects\ptah-extension\libs\backend\persistence-sqlite\src\lib\maintenance\compaction-state-machine.ts`
- MODIFY `D:\projects\ptah-extension\libs\backend\persistence-sqlite\src\lib\sqlite-connection.service.ts` (add `pauseAdmission`, `drainStatements`, `reopen`)

**Acceptance criteria**

- The 10 states from plan lines 362-376, in order.
- A validated backup must exist before `compact` starts. No backup, no compaction.
- The checkpoint reads all three columns of `wal_checkpoint(TRUNCATE)`. A first column of `1` means busy: retry 3 times with 1 s sleep, then abort. An abort is not a failure — the purge already succeeded.
- Every transition is persisted in `result_json`.
- The whole machine is abortable through the Batch 1 abort signal.
- Runs at most once per boot and at most once per 30 days.
- `rebuild-caches` follows the `dbObjectIdentity` invalidation pattern at `observation-queue.store.ts:289-301` and `:478-489`.

**Tests to write**: each transition persists; a missing backup blocks compaction; a busy checkpoint aborts after 3 retries; an abort leaves the pre-compaction DB in place.

**Dependencies**: B5.T5, B5.T6, B5.T8

---

### Task B5.T10: Add compaction crash recovery — PENDING

**Files**

- MODIFY `D:\projects\ptah-extension\libs\backend\persistence-sqlite\src\lib\maintenance\maintenance-state.ts`
- MODIFY `D:\projects\ptah-extension\libs\backend\persistence-sqlite\src\lib\maintenance\compaction-state-machine.ts`

**Acceptance criteria**: the three recovery paths from plan lines 378-384. If the compacted DB is valid, reopen it. If it is not valid, reopen the pre-compaction backup. If neither opens, set readiness `failed` and surface a `db:health` error that names both failure reasons.

**Tests to write**: crash in `compact` with a valid compacted DB; crash with an invalid compacted DB and a valid backup; both invalid.

**Dependencies**: B5.T9

---

### Task B5.T11: Register the Electron worker factory — PENDING

**Files**

- CREATE `D:\projects\ptah-extension\apps\ptah-electron\src\services\platform\electron-worker-process-factory.ts`
- MODIFY `D:\projects\ptah-extension\apps\ptah-electron\src\di\phase-2-libraries.ts`

**Acceptance criteria**: `utilityProcess.fork`, modelled on `electron-embedder-worker-factory.ts:44-63`. Registered under `PLATFORM_TOKENS.WORKER_PROCESS_FACTORY`. `import 'electron'` stays inside the app, never in a lib. The worker handle is added to `BootRefs` and disposed in the `will-quit` LIFO chain.

**Tests to write**: factory returns an `IWorkerProcess`; dispose kills the child.

**Dependencies**: B5.T1, B5.T2, B5.T4

---

**Batch 5 verification**

```bash
npx nx run-many -t test -p @ptah-extension/platform-core @ptah-extension/persistence-sqlite ptah-electron
npx nx build-maintenance-worker ptah-electron
npm run typecheck:all
npm run lint:all
```

Manual run: `PRAGMA quick_check` must be absent from the boot log. `[event-loop] lag` `maxMs` stays under 500 ms while the purge runs. The log must report WAL size before and after each scan.

**Batch 5 commit message**

```
perf(persistence-sqlite): move integrity checks, purge and backup to a maintenance utilityProcess (TASK_2026_331 B5)
```

---

## Batch 6: CPU worker pool, file index and hashing

**Status**: PENDING
**Recommended Executor**: backend-developer, with devops-engineer for T2
**Fallback Executor**: general-purpose
**Execution Mode**: sequential for T1 to T5; T6 and T7 (harness hashing) may run in parallel with T5 because they are file-disjoint
**Rationale**: the exclusion-bug fix must land and be pinned before the logic is copied into a worker. The harness hashing client touches only `harness-sync` files.
**Tasks**: 8 | **Dependencies**: Batch 5 (reuses `IWorkerProcessFactory`)

### Task B6.T1: Fix the workspace-indexer exclusion bug — PENDING

**Files**

- MODIFY `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\lib\file-indexing\workspace-indexer.service.ts`
- CREATE or MODIFY the matching spec file

**Acceptance criteria**: at `:295-302` the code must read the match **result**, not the array length. `matchFiles` returns one entry per input path, so a length test makes every file excluded when `excludePatterns` is non-empty. Fix the main-process code first. A spec must fail on the old code and pass on the new code.

**Tests to write**: a file that matches no exclude pattern is indexed while `excludePatterns` is non-empty; a file that matches is excluded.

**Dependencies**: none

---

### Task B6.T2: Add the cpu-worker build target — PENDING

**Files**

- CREATE `D:\projects\ptah-extension\apps\ptah-electron\tsconfig.cpu-worker.json`
- MODIFY `D:\projects\ptah-extension\apps\ptah-electron\project.json`

**Acceptance criteria**: a `build-cpu-worker` target. Output `cpu-worker.mjs`. Chained into `build`.

**Tests to write**: none. Verify with `npx nx build-cpu-worker ptah-electron`.

**Dependencies**: none

---

### Task B6.T3: Add the CPU worker protocol and client — PENDING

**Files**

- CREATE `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\lib\workers\cpu-worker-protocol.ts`
- CREATE `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\lib\workers\cpu-worker-client.ts`
- MODIFY `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\di\register.ts`
- MODIFY `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\index.ts`

**Acceptance criteria**: operations `match-files` and `build-workspace-index`. Zod schemas both directions. Request deadlines. Stale responses rejected after cancel or restart. Progress messages carry a `generation` field. The client injects `PLATFORM_TOKENS.WORKER_PROCESS_FACTORY` and falls back to in-process calls when no factory is registered.

**Tests to write**: stale response rejected; deadline; in-process fallback matches worker output.

**Dependencies**: B5.T1

---

### Task B6.T4: Add the CPU worker entry — PENDING

**Files**

- CREATE `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\lib\workers\cpu-worker.ts`

**Acceptance criteria**: `worker_threads` entry modelled on `ts-diagnostics-worker-source.ts:49`. It receives no DI object, no `AbortSignal`, no `Logger` and no `IFileSystemProvider`. Progress messages are throttled to one per 100 to 250 files. Every inbound message is Zod-validated. The index logic is the **corrected** logic from B6.T1.

**Tests to write**: worker output equals the main-process output for the same input; progress throttling.

**Dependencies**: B6.T1, B6.T3

---

### Task B6.T5: Delegate the index build to the worker — PENDING

**Files**

- MODIFY `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\lib\file-indexing\workspace-indexer.service.ts`
- MODIFY `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\lib\file-indexing\workspace-file-index.service.ts`

**Acceptance criteria**: the one-shot build runs in the worker. `WorkspaceFileIndexService` stays on main and keeps the watcher, the generation counter and the mutable maps. It accepts a worker snapshot **only** when `response.generation === this.generation`. Interactive search stays on main. `INDEXING_PROGRESS` and `INDEXING_COMPLETE` messages keep their current shape.

**Tests to write**: a stale generation snapshot is dropped; a matching generation is applied; the watcher still updates the index after the build.

**Dependencies**: B6.T4

---

### Task B6.T6: Add the harness hash worker client — PENDING

**Files**

- CREATE `D:\projects\ptah-extension\libs\backend\harness-sync\src\lib\hash\hash-worker-client.ts`

**Acceptance criteria**: it injects `PLATFORM_TOKENS.WORKER_PROCESS_FACTORY` directly. `harness-sync` must **not** import `workspace-intelligence`. It owns its own `hash-directories` protocol with Zod schemas. In-process fallback when no factory is registered.

**Tests to write**: fallback equals worker output; no import of `workspace-intelligence` (assert with a dependency spec or an eslint boundary rule).

**Dependencies**: B5.T1

---

### Task B6.T7: Delegate the content hashing — PENDING

**Files**

- MODIFY `D:\projects\ptah-extension\libs\backend\harness-sync\src\lib\hash\content-hash.ts`

**Acceptance criteria**: `hashDir` and `hashFile` (`:290-307`) delegate to `HashWorkerClient` when it is available. The returned hash values are byte-identical to the current implementation. All existing callers are unchanged.

**Tests to write**: hash equality between the worker path and the direct path for the same tree.

**Dependencies**: B6.T6

---

### Task B6.T8: Register the Electron CPU worker pool — PENDING

**Files**

- CREATE `D:\projects\ptah-extension\apps\ptah-electron\src\services\platform\electron-cpu-worker-pool.ts`
- MODIFY `D:\projects\ptah-extension\apps\ptah-electron\src\di\phase-2-libraries.ts`

**Acceptance criteria**: wraps `worker_threads.Worker` in `IWorkerProcess`. The pool handle is added to `BootRefs` and disposed in the `will-quit` LIFO chain.

**Tests to write**: spawn and dispose; a crashed worker is respawned once.

**Dependencies**: B6.T2, B6.T3

---

**Batch 6 verification**

```bash
npx nx run-many -t test -p @ptah-extension/workspace-intelligence @ptah-extension/harness-sync ptah-electron
npx nx build-cpu-worker ptah-electron
npm run typecheck:all
npm run lint:all
```

Manual run: open the `@`-picker. It fills after `INDEXING_COMPLETE`. `[event-loop] lag` `maxMs` stays under 500 ms during the index build (about 1.5 M pattern checks before this batch).

**Batch 6 commit message**

```
perf(workspace-intelligence,harness-sync): move index build and hashing to worker threads (TASK_2026_331 B6)
```

---

## Batch 7: Harness abort signal and deduplication

**Status**: PENDING
**Recommended Executor**: backend-developer
**Fallback Executor**: general-purpose
**Execution Mode**: sequential
**Rationale**: the in-flight registry is shared by the importer, the index and the `workspace:switch` handler. One lane keeps the contract consistent.
**Tasks**: 4 | **Dependencies**: Batches 1, 5, 6

### Task B7.T1: Add the abort signal to the harness reconciler — PENDING

**Files**

- MODIFY `D:\projects\ptah-extension\libs\backend\harness-sync\src\lib\reconciler\harness-reconciler.service.ts`
- MODIFY `D:\projects\ptah-extension\apps\ptah-electron\src\activation\wire-runtime.ts`

**Acceptance criteria**: `reconcileHarness` accepts an optional `AbortSignal` and checks it between targets and between file operations. An abort stops the pass and leaves the manifest consistent — never half-written. The deliberate double run at `wire-runtime.ts:330-356` stays.

**Tests to write**: an abort between targets stops the pass; the manifest is consistent after an abort.

**Dependencies**: B1.T1

---

### Task B7.T2: Add the in-flight registry — PENDING

**Files**

- CREATE `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\in-flight-registry.ts` (or a shared location the developer justifies in the report)

**Acceptance criteria**: keyed by normalized workspace root. The same key returns the same in-flight promise. A different key can start its own entry. Entries clear when the promise settles, on success and on failure.

**Tests to write**: same key joins; different key starts new; the entry clears after settle and after reject.

**Dependencies**: none

---

### Task B7.T3: Deduplicate the session import — PENDING

**Files**

- MODIFY `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\session-importer.service.ts`
- MODIFY `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\workspace-rpc.handlers.ts`

**Acceptance criteria**: the boot-time call and the `workspace:switch` handler (`:445-540`) both go through the registry. The second import for the same root joins the first instead of running again. This removes the second `scanAndImport` measured at t=75 to 96.

**Tests to write**: two calls for the same root produce one scan; two calls for different roots produce two scans.

**Dependencies**: B7.T2

---

### Task B7.T4: Deduplicate the file index start — PENDING

**Files**

- MODIFY `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\lib\file-indexing\workspace-file-index.service.ts`

**Acceptance criteria**: `start(root)` joins an in-flight build for the same root. A different root cancels the first through the generation counter and starts a new build.

**Tests to write**: same root joins; a different root bumps the generation and drops the old snapshot.

**Dependencies**: B7.T2, B6.T5

---

**Batch 7 verification**

```bash
npx nx run-many -t test -p @ptah-extension/harness-sync @ptah-extension/agent-sdk @ptah-extension/workspace-intelligence @ptah-extension/rpc-handlers ptah-electron
npm run typecheck:all
npm run lint:all
```

Manual run: `Imported N sessions` must appear once, not twice. `[event-loop] lag` after `Startup config registered` stays under 500 ms.

**Batch 7 commit message**

```
perf(harness-sync,agent-sdk): abort in-flight reconciles and deduplicate workspace boot work (TASK_2026_331 B7)
```

---

## Final acceptance targets (measure after Batch 7)

| Metric                           | Before                     | Target               | Where to read                                                   |
| -------------------------------- | -------------------------- | -------------------- | --------------------------------------------------------------- |
| Time to window                   | 73 s                       | under 5 s warm start | `[Ptah Electron] Startup config registered`                     |
| Max event-loop lag, first 120 s  | 18 s                       | under 500 ms         | `[event-loop] lag` — `maxMs`, `p99Ms`, `meanMs`                 |
| `quick_check` on boot            | 2 to 20 s                  | 0 s                  | absent from the boot log                                        |
| Session import before the window | 30 to 60 s                 | 0 s                  | `Imported N sessions` appears after `Startup config registered` |
| Session import runs              | 2                          | 1                    | one `Imported N sessions` line                                  |
| Embedder warmup                  | only if the curator exists | always               | `[Ptah Electron] Embedder warmup complete`                      |
