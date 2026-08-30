# Implementation Plan - TASK_2026_331 (Revised)

## Revision history

- 2026-08-27 v1: original plan. Rejected by codex review for 8 incorrect claims and 3 critical risks.
- 2026-08-27 v2: this revision. Fixes every incorrect claim, adds a boot coordinator, typed readiness contracts, crash-resumable transcript chunking, compaction state machine, and shutdown-safe disposal. Verified against source.

## Boot-path audit (corrected)

### Every await on the path to createMainWindow

| Step | Location              | What it does                                         | Must precede window? | Evidence                                                                             |
| ---- | --------------------- | ---------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------ |
| 1    | `bootstrap.ts:129`    | Settings migrations + custom providers load          | YES                  | Renderer reads workspace root from `get-startup-config`                              |
| 2    | `bootstrap.ts:208`    | `restoreWorkspaces()`                                | YES                  | `get-startup-config` returns `workspaceRoot` from the restored folder                |
| 3    | `bootstrap.ts:230`    | `verifyLicense()` — NETWORK                          | NO                   | Identity only, never gates activation (bootstrap.ts:221-223)                         |
| 4    | `bootstrap.ts:302`    | `agentAdapter.initialize()` — NETWORK                | NO                   | Non-fatal (bootstrap.ts:317-322). Renderer shows "not configured" until it completes |
| 5    | `wire-runtime.ts:190` | `armDiagnostics()`                                   | YES                  | Must run before any heavy work                                                       |
| 6    | `wire-runtime.ts:224` | `registerRpcSurface()` — resolves ~30 handler graphs | YES                  | Renderer calls RPCs immediately on bootstrap                                         |
| 7    | `wire-runtime.ts:510` | `bringUpSubsystems()` — MCP port bind                | YES                  | MCP must be up before memory boot scans (wire-runtime.ts:489-501)                    |
| 8    | `wire-runtime.ts:569` | `bootHeavyServices()`                                | NO                   | See corrected analysis below                                                         |
| 9    | `post-window.ts:108`  | `createMainWindow()`                                 | —                    | This IS the window                                                                   |

### Correction: the renderer calls session:list during bootstrap

The v1 plan claimed "the renderer's first four RPCs need only what bootstrapElectron provides." This is wrong for `session:list`.

**Evidence**: `ChatLifecycleService.bootstrap()` (chat-lifecycle.service.ts:55-81) calls `this.sessionLoader.loadSessions()` at line 60 when `workspaceRoot` exists. `SessionLoaderService._loadSessionsImmediate()` (session-loader.service.ts:191) calls `session:list` RPC at line 205. This runs during renderer initialization, not when the user opens the chat view.

**Evidence**: `ElectronLayoutService.syncFromBackend()` (electron-layout.service.ts:572-614) calls `workspace:getInfo` at line 581 then `workspace:switch` at line 604 during renderer startup. This is the initial workspace:switch that causes the second session import and file re-index measured at t=75-96.

### Correction: RPC result contracts do not support warming responses

The v1 plan proposed returning `{ status: 'warming', retryAfterMs: 2000 }` from `session:list`, `memory:search`, and `corpus:list`. This is invalid.

**Evidence**: `SessionListResult` (rpc-session.types.ts:73-77) is a flat interface `{ sessions: ChatSessionSummary[]; total: number; hasMore: boolean }`. `MemorySearchResult` (rpc-memory.types.ts:62) is also a flat interface. Neither has a union with an unavailable variant. `DbHealthResult` (rpc-persistence.types.ts:40-66) explicitly has nullable fields designed for "connection is unavailable" — the other RPC contracts do NOT. Returning a warming object would be interpreted as a normal successful result; the frontend would access `result.sessions` and get `undefined`.

### Correction: SKILL.md migration runs after SQLite is open

The v1 plan claimed the migration runs before SQLite is open and justified a JSON sidecar. This is wrong.

**Evidence**: `SkillSynthesisService.start()` (skill-synthesis.service.ts:265-363) calls `this.connection.openAndMigrate()` at line 282-283 BEFORE calling `migrateSkillMdFiles()` at line 304. SQLite is open when the migration runs. A migration-version marker in SQLite is correct. The JSON sidecar is unnecessary.

### Correction: tailBytes reads the END, not the beginning

The v1 plan described "a typical transcript's first 64 KiB contains the system prompt." `tailBytes` reads the END of the file, not the beginning. More critically, completed historical sessions may never receive a future `PreCompact` event, so a tail-only scan can permanently skip data that a full scan would have captured.

### Correction: ignore-pattern-resolver path

The v1 plan referenced `src/lib/file-indexing/`. The actual path is `workspace-intelligence/src/file-indexing/ignore-pattern-resolver.service.ts` — there is no `src/lib` segment.

### Correction: scheduleWarmup will be silently skipped

**Evidence**: `scheduleWarmup()` (wire-runtime.ts:616-647) checks `if (refs.memoryCurator === null) return;` at line 617. With window-first boot, `did-finish-load` fires before the curator exists, so warmup returns immediately and never runs. A promise barrier is needed.

### Correction: workspace race

**Evidence**: the comment at wire-runtime.ts:501-506 says: "It is registered AFTER this await and immediately before the startup boot below, with no await between the two, so a folder-change event cannot interleave and win the one-shot latch out from under the awaited call." Registering the listener before the deferred boot starts, without immediately reserving the boot promise, reintroduces the race.

## Architecture design

### Design philosophy

**Chosen approach**: a boot coordinator that opens the window first, then runs heavy work behind a stable references object with a readiness state and an abort signal. Heavy work moves to a maintenance `utilityProcess` (SQLite) and `worker_threads` (pure CPU). Every RPC that needs SQLite returns a typed readiness error when the backend is warming, and the frontend retries after receiving a readiness notification.

### Component 1: Boot coordinator

**Purpose**: own the boot lifecycle with a stable references object, readiness state, abort signal, and shutdown-safe disposal.

**Pattern**: a coordinator class in the Electron app, not a lib. It replaces the current nullable-refs pattern in `main.ts`.

**Evidence**: `main.ts:40-65` declares 15 nullable variables that are copied once from `wired.refs` and `post.*`. If `wireRuntimePostWindow` is fire-and-forget, quitting during boot leaves later-created services outside the LIFO cleanup chain.

**Responsibilities**:

- Own a single `BootRefs` object whose fields are null until populated, but the object itself is stable (never reassigned). `main.ts` holds a reference to this object, not to 15 separate nullable variables.
- Own a `BootReadiness` state machine: `warming | ready | degraded | failed`.
- Own an `AbortController` for the entire post-window boot. `before-quit` / `will-quit` calls `abort()` to cancel in-flight boot work.
- Own the post-window boot promise. The promise is caught (never unhandled rejection). The `will-quit` handler checks `bootCoordinator.isRunning()` and waits for a bounded grace period (2 s) before proceeding with disposal.
- Populate `BootRefs` fields as each service starts. The `will-quit` LIFO chain reads from the stable object, so services created late are still disposed.
- Expose `onReady(callback)` for the renderer-facing readiness signal.

**Implementation pattern**:

```typescript
// apps/ptah-electron/src/activation/boot-coordinator.ts
export type BootReadiness = 'warming' | 'ready' | 'degraded' | 'failed';

export interface BootRefs {
  diagnostics: DiagnosticsHandle | null;
  gitWatcher: { stop: () => void; switchWorkspace: (p: string) => void } | null;
  sqliteConnection: { close: () => void; isOpen: boolean } | null;
  memoryCurator: { stop: () => void } | null;
  // ... all refs from wireRuntime + postWindow
}

export class BootCoordinator {
  readonly refs: BootRefs = {
    /* all null */
  };
  private readonly abortController = new AbortController();
  private readiness: BootReadiness = 'warming';
  private postWindowPromise: Promise<void> | null = null;

  get abortSignal(): AbortSignal {
    return this.abortController.signal;
  }
  get isRunning(): boolean {
    return this.postWindowPromise !== null;
  }

  startPostWindow(fn: () => Promise<void>): void {
    this.postWindowPromise = fn()
      .catch((err) => {
        this.readiness = 'failed';
        console.error('[BootCoordinator] post-window boot failed:', err);
      })
      .finally(() => {
        if (this.readiness === 'warming') this.readiness = 'ready';
      });
  }

  abort(): void {
    this.abortController.abort();
  }
  async awaitCompletion(timeoutMs: number): Promise<void> {
    if (!this.postWindowPromise) return;
    await Promise.race([this.postWindowPromise, new Promise<void>((r) => setTimeout(r, timeoutMs))]);
  }
}
```

**Quality requirements**:

- `main.ts` holds one `BootCoordinator` reference, not 15 nullable variables.
- `will-quit` calls `coordinator.abort()`, then `coordinator.awaitCompletion(2000)`, then runs the LIFO disposal chain reading from `coordinator.refs`.
- If `will-quit` fires during boot, the abort signal cancels in-flight work (session import, harness reconcile, file index). Services that have already started check the signal and stop. Services that have not started do not start.
- The coordinator never throws. A failed boot sets `readiness = 'failed'` and the renderer shows a degraded state.

**Files affected**:

- `apps/ptah-electron/src/activation/boot-coordinator.ts` (CREATE)
- `apps/ptah-electron/src/main.ts` (REWRITE — use coordinator, remove 15 nullable variables)
- `apps/ptah-electron/src/activation/wire-runtime.ts` (REWRITE — split pre/post, accept coordinator + abort signal)
- `apps/ptah-electron/src/activation/bootstrap.ts` (MODIFY — make verifyLicense + agentAdapter.initialize fire-and-forget)
- `apps/ptah-electron/src/activation/post-window.ts` (MODIFY — window creation stays, warmup uses coordinator)

### Component 2: Backend readiness contracts in libs/shared

**Purpose**: define typed readiness contracts so RPCs that need SQLite can return a structured "warming" response that the frontend handles correctly.

**Pattern**: discriminated unions in `libs/shared` RPC type files, matching the existing `DbHealthResult` pattern where `isOpen: false` signals unavailable.

**Evidence**: `DbHealthResult` (rpc-persistence.types.ts:40-66) uses nullable fields to signal "connection is unavailable so the UI can render an offline badge without special-casing every property." `SessionListResult` (rpc-session.types.ts:73-77) and `MemorySearchResult` (rpc-memory.types.ts:62) have no such variant. The frontend accesses `result.sessions` directly (session-loader.service.ts:205+).

**Responsibilities**:

Add a `BackendReadiness` discriminated union to `libs/shared`:

```typescript
// libs/shared/src/lib/types/rpc/rpc-readiness.types.ts
export type BackendReadiness = 'warming' | 'ready' | 'degraded' | 'failed';

export interface RpcReadinessError {
  readonly ready: false;
  readonly readiness: BackendReadiness;
  readonly retryAfterMs: number;
  readonly reason: string;
}
```

For each SQLite-backed RPC, widen the result to a discriminated union:

```typescript
// SessionListResult becomes:
export type SessionListResponse = (SessionListResult & { ready: true }) | RpcReadinessError;
```

The RPC handler returns `RpcReadinessError` when `SqliteConnectionService.isOpen` is false. The frontend `SessionLoaderService` checks `result.ready` before accessing `result.sessions`. If `ready === false`, it waits for the readiness notification (via an existing message type or a `boot:readiness` RPC poll) and retries.

**Frontend retry behavior**: `SessionLoaderService._loadSessionsImmediate()` (session-loader.service.ts:191) checks `result.ready`. If false, it schedules a retry after `result.retryAfterMs` (default 2000 ms) via `setTimeout`. The retry cancels if a readiness notification arrives first (via a new `MESSAGE_TYPES.BOOT_READINESS_CHANGED` message, added to the existing `MESSAGE_TYPES` constant and `StrictMessageType` union).

**Coverage**: every SQLite-backed RPC handler gets the readiness guard. The affected namespaces are: `session:*` (list, load, stats), `memory:*` (list, search, get, stats), `corpus:*` (list, get, build, query), `skillSynthesis:*` (listCandidates, getCandidate, stats), `indexing:*` (status), `db:*` (already has it). The guard is a one-line check at the top of each handler: `if (!sqliteConnection.isOpen) return readinessError;`.

**New message type**: `BOOT_READINESS_CHANGED: 'boot:readinessChanged'` added to `MESSAGE_TYPES` (message-constants.ts) and `StrictMessageType` (message-type.ts). The backend broadcasts it when readiness transitions. This is the one new message type the plan adds.

**Files affected**:

- `libs/shared/src/lib/types/rpc/rpc-readiness.types.ts` (CREATE)
- `libs/shared/src/lib/types/rpc/rpc-session.types.ts` (MODIFY — widen to union)
- `libs/shared/src/lib/types/rpc/rpc-memory.types.ts` (MODIFY — widen to union)
- `libs/shared/src/lib/types/rpc/rpc-corpus.types.ts` (MODIFY — widen to union)
- `libs/shared/src/lib/types/messages/message-constants.ts` (MODIFY — add `BOOT_READINESS_CHANGED`)
- `libs/shared/src/lib/types/messages/message-type.ts` (MODIFY — add to union)
- `libs/shared/src/index.ts` (MODIFY — export new types)
- `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts` (MODIFY — check `result.ready`, retry on false)
- `libs/frontend/core/src/lib/services/electron-layout.service.ts` (MODIFY — handle readiness for `workspace:switch` result)
- `libs/backend/rpc-handlers/src/lib/handlers/` — each SQLite-backed handler (MODIFY — add readiness guard)

### Component 3: Workspace race prevention and deduplication

**Purpose**: prevent the renderer-driven `workspace:switch` from winning the one-shot boot latch with a different root, and deduplicate the boot-time and renderer-driven session import / index build.

**Pattern**: start the heavy-boot promise immediately after registering the workspace listener with no intervening await, and key boot work by normalized workspace root.

**Evidence**: the comment at wire-runtime.ts:501-506 explicitly says the listener is registered "AFTER this await and immediately before the startup boot below, with no await between the two, so a folder-change event cannot interleave and win the one-shot latch." `ElectronLayoutService.syncFromBackend()` (electron-layout.service.ts:604) sends `workspace:switch` during renderer startup, which triggers the `workspace-rpc.handlers.ts:445-540` handler that runs a second `scanAndImport` + file re-index.

**Responsibilities**:

- Register the workspace-change listener in `wireRuntimePreWindow`.
- Immediately after the listener registration (no intervening await), call `bootCoordinator.startPostWindow(() => bootHeavyServices(startupWorkspaceRoot, coordinator))`. This reserves the one-shot promise before any renderer event can arrive.
- Key the `bootHeavyServices` one-shot latch by normalized workspace root. A `workspace:switch` for the SAME root as the startup root deduplicates (the in-flight promise is shared). A `workspace:switch` for a DIFFERENT root starts a separate boot for that root, gated by the abort signal of the first.
- Introduce an `InFlightRegistry` keyed by normalized workspace root for session import and file index. Both the boot-time call and the `workspace:switch` handler check the registry. If work is in-flight for the same root, the second caller awaits the same promise. If the root differs, the first is aborted via the coordinator's abort signal.

**Implementation pattern**:

```typescript
// In wireRuntimePreWindow:
workspaceProvider.onDidChangeWorkspaceFolders(() => {
  const active = workspaceProvider.getWorkspaceRoot();
  if (active) {
    bootCoordinator.startOrJoinBoot(active);
  }
});
// Immediately, no await between listener registration and boot start:
if (startupWorkspaceRoot) {
  bootCoordinator.startPostWindow(() => bootHeavyServices(startupWorkspaceRoot, bootCoordinator));
}
```

**Files affected**:

- `apps/ptah-electron/src/activation/wire-runtime.ts` (MODIFY — register listener + immediately start boot)
- `libs/backend/agent-sdk/src/lib/session-importer.service.ts` (MODIFY — accept shared in-flight registry)
- `libs/backend/workspace-intelligence/src/lib/file-indexing/workspace-file-index.service.ts` (MODIFY — deduplicate start calls for same root)

### Component 4: Maintenance worker (utilityProcess)

**Purpose**: run SQLite integrity checks, retention purge, daily backup, and one-time compaction in a separate OS process with its own SQLite handle.

**Pattern**: `utilityProcess.fork` with a request-agnostic process factory port in `platform-core`. Domain protocol and typed client stay in `persistence-sqlite`.

**Evidence**: `IEmbedderWorkerProcessFactory` (worker-process.port.ts:9-20) — request-agnostic process interface. `ElectronEmbedderWorkerFactory` (electron-embedder-worker-factory.ts:44-63) — `utilityProcess.fork`. `EmbedderWorkerClient` (embedder-worker-client.ts:68-309) — lazy spawn, idle-teardown, crash-loop guard, request/response by `id`. Root audit section 2: read-only connection for scans, read-write for purge. Root audit section 5: `db_maintenance_state` persisted marker.

**Port interface** (new, in `platform-core`):

```typescript
// libs/backend/platform-core/src/interfaces/worker-process-factory.interface.ts
export interface IWorkerProcess {
  postMessage(msg: unknown): void;
  on(event: 'message', cb: (msg: unknown) => void): void;
  on(event: 'exit', cb: (code: number | null) => void): void;
  kill(): void;
}

export interface IWorkerProcessFactory {
  spawn(workerPath: string, serviceName: string): IWorkerProcess;
}
```

This is request-agnostic — it does not reference any domain protocol. The domain protocol (maintenance messages) stays in `persistence-sqlite`. The same port is reused by the embedder and voice workers (they can migrate to it in a follow-up).

**Domain protocol and client** (new, in `persistence-sqlite`):

The `MaintenanceWorkerClient` injects `IWorkerProcessFactory` via the token, not a domain-specific factory token. The client owns lazy spawn, request/response correlation by `id`, request deadlines, stale-response rejection after cancellation/restart, crash-loop guard, and idle-teardown.

**Documented exception: second writable SQLite connection**

The maintenance worker opens a read-write connection for purge and `PRAGMA optimize`. This is an explicit, documented exception to the single-owner rule. The worker handshake enforces:

- `sqlite_version() >= 3.51.3` (root audit section: WAL-reset race)
- Canonical DB path match
- `journal_mode = wal`
- Protocol version match
- `busy_timeout = 5000` per worker handle
- Short transaction limit: each purge batch commits in under 100 ms under normal load
- Request deadline: each operation has a timeout (default 60 s for scans, 300 s for backup)
- WAL growth telemetry: the worker reports WAL size before and after each operation

**Zod validation**: all worker messages (both directions) are validated with Zod schemas at the boundary. The protocol file exports schemas alongside types.

**Quality requirements**:

- The worker must never run migrations. It spawns only after `openAndMigrate()` completes.
- The worker must close its read-only handle immediately after each scan (root audit: a long read transaction pins a WAL end mark).
- The purge must use batched `BEGIN IMMEDIATE` transactions with cursor progress, not the current unbounded `purgeOlderThan`.
- Stale responses (response `id` not in pending map, or response after abort) are rejected and logged.
- WAL size is reported before and after each scan/backup to detect WAL growth from pinned snapshots.

**Files affected**:

- `libs/backend/platform-core/src/interfaces/worker-process-factory.interface.ts` (CREATE)
- `libs/backend/platform-core/src/di/tokens.ts` (MODIFY — add `WORKER_PROCESS_FACTORY`)
- `libs/backend/platform-core/src/index.ts` (MODIFY)
- `libs/backend/persistence-sqlite/src/lib/maintenance/maintenance-worker-protocol.ts` (CREATE — types + Zod schemas)
- `libs/backend/persistence-sqlite/src/lib/maintenance/maintenance-worker-client.ts` (CREATE)
- `libs/backend/persistence-sqlite/src/lib/maintenance/maintenance-worker.ts` (CREATE — utilityProcess entry)
- `libs/backend/persistence-sqlite/src/lib/maintenance/maintenance-state.ts` (CREATE — `db_maintenance_state` CRUD)
- `libs/backend/persistence-sqlite/src/lib/migrations/0041_db_maintenance_state.ts` (CREATE)
- `libs/backend/persistence-sqlite/src/lib/sqlite-connection.service.ts` (MODIFY — remove `runBootChecks` from boot path)
- `libs/backend/persistence-sqlite/src/index.ts` (MODIFY)
- `libs/backend/persistence-sqlite/src/lib/di/tokens.ts` (MODIFY — add `MAINTENANCE_WORKER_CLIENT`)
- `apps/ptah-electron/src/services/platform/electron-worker-process-factory.ts` (CREATE — implements `IWorkerProcessFactory`)
- `apps/ptah-electron/src/di/phase-2-libraries.ts` (MODIFY — register factory)
- `apps/ptah-electron/project.json` (MODIFY — add `build-maintenance-worker` target)
- `apps/ptah-electron/tsconfig.maintenance-worker.json` (CREATE)

### Component 5: CPU worker pool (worker_threads)

**Purpose**: move pure-CPU work (pattern matching, content hashing, file index build) off the main event loop.

**Pattern**: `worker_threads.Worker` with a real entry file + esbuild target. Domain protocol stays in `workspace-intelligence`. The `platform-core` port is request-agnostic.

**Evidence**: worker audit section "Recommended cut points": `PatternMatcherService.matchFiles` is pure CPU (pattern-matcher.service.ts:121 — constructor needs no DI). `hashDir`/`hashFile` are pure async FS + CPU (content-hash.ts:290-307). TS diagnostics worker (ts-diagnostics-worker-source.ts) — `worker_threads` pattern.

**Port interface**: the same `IWorkerProcessFactory` from Component 4 is reused. For `worker_threads`, the Electron implementation spawns a `Worker` and wraps it in the `IWorkerProcess` interface.

**Domain protocols stay in their owning libraries**:

- `workspace-intelligence` owns the file-index CPU worker protocol (match-files, build-workspace-index).
- `harness-sync` owns the hashing protocol (hash-directories) and delegates to the `IWorkerProcessFactory` via its own client, NOT through `workspace-intelligence`.

This prevents the cross-feature coupling the review identified. `platform-core` depends on no feature library. `harness-sync` does not depend on `workspace-intelligence`.

**Workspace-indexer exclusion bug verification**: before reproducing the index logic in a worker, verify the bug the worker audit identified: `workspace-indexer.service.ts:295-302` calls `matchFiles([relativePath], patterns)` and tests only array length. Because `matchFiles` always returns one result per input path, any non-empty `excludePatterns` skips every file. This bug must be fixed in the main-process code FIRST, then the corrected logic is reproduced in the worker.

**Quality requirements**:

- The worker must not receive DI objects, `AbortSignal`, `Logger`, or `IFileSystemProvider`.
- Progress messages must be throttled (every 100-250 files).
- The main-side `WorkspaceFileIndexService` must accept a worker snapshot only when `response.generation === this.generation`.
- Interactive search stays on main.
- Worker request deadlines and stale-response rejection after cancellation.
- Zod validation for all worker messages.

**Files affected**:

- `libs/backend/workspace-intelligence/src/lib/workers/cpu-worker.ts` (CREATE — worker_threads entry)
- `libs/backend/workspace-intelligence/src/lib/workers/cpu-worker-protocol.ts` (CREATE — types + Zod schemas)
- `libs/backend/workspace-intelligence/src/lib/workers/cpu-worker-client.ts` (CREATE)
- `libs/backend/workspace-intelligence/src/lib/file-indexing/workspace-indexer.service.ts` (MODIFY — fix exclusion bug, then delegate build to worker)
- `libs/backend/workspace-intelligence/src/lib/file-indexing/workspace-file-index.service.ts` (MODIFY — accept worker snapshot)
- `libs/backend/workspace-intelligence/src/di/register.ts` (MODIFY)
- `libs/backend/workspace-intelligence/src/index.ts` (MODIFY)
- `libs/backend/harness-sync/src/lib/hash/hash-worker-client.ts` (CREATE — delegates to `IWorkerProcessFactory`)
- `libs/backend/harness-sync/src/lib/hash/content-hash.ts` (MODIFY — delegate `hashDir`/`hashFile` to worker client when available)
- `apps/ptah-electron/src/services/platform/electron-cpu-worker-pool.ts` (CREATE — wraps `worker_threads.Worker` in `IWorkerProcess`)
- `apps/ptah-electron/src/di/phase-2-libraries.ts` (MODIFY)
- `apps/ptah-electron/project.json` (MODIFY — add `build-cpu-worker`)
- `apps/ptah-electron/tsconfig.cpu-worker.json` (CREATE)

### Component 6: Compaction state machine

**Purpose**: reclaim the 684 MB of processed observation_queue rows via a safe, owner-coordinated compaction.

**Pattern**: an owner-coordinated state machine with persisted recovery state, not a single `VACUUM` call.

**Evidence**: root audit section 3: plain `VACUUM` can need twice the DB size in free disk space. `VACUUM INTO` is not safe for live cutover while writes continue. Windows cannot rename an in-use database. Root audit section 4: the ordered recommendation requires owner quiescence, checkpoint, closure, sole-handle compaction, validation, and reopening.

**State machine** (runs in the maintenance worker, coordinated by the owner):

```
States: idle -> pre-check -> backup -> drain -> checkpoint -> close-owner ->
         compact -> validate -> reopen-owner -> rebuild-caches -> resume -> idle
```

1. **pre-check**: verify `db_maintenance_state` lease is claimable. Verify NTFS free-space guard (root audit section 3: `available >= 2 * dbFileBytes + walFileBytes + max(512 MiB, 20% dbFileBytes)`).
2. **backup**: run a validated pre-maintenance online backup. Validate the backup with `quick_check`. If backup fails, abort. Do NOT rotate old backups until the new backup is validated (root audit: rotation after a failed backup ages out a valid backup).
3. **drain**: owner stops admitting new DB work. Drain all in-flight statements and prepared-statement caches. The owner signals the worker when `statementCount === 0` and no writes are pending.
4. **checkpoint**: owner runs `wal_checkpoint(TRUNCATE)`. Inspect the three-column result. A first column of `1` means busy; retry up to 3 times with 1 s sleep. If still busy, abort compaction (the purge already succeeded; compaction is a one-time optimization).
5. **close-owner**: owner closes the canonical connection. All consumer caches that hold `SqliteDatabase` references are invalidated (the queue store already does this at observation-queue.store.ts:289-301).
6. **compact**: worker opens the sole source handle. Runs plain `VACUUM` (preferred over `VACUUM INTO` per root audit section 3). If disk pressure requires `VACUUM INTO`, use the closed-handle validation/replacement protocol from root audit section 3 (steps 4-7).
7. **validate**: worker opens the compacted DB read-only. Runs `quick_check`, `foreign_key_check`, validates `schema_migrations` version, and counts expected rows in critical tables (`observation_queue`, `memories`, `memory_chunks`). Close the handle.
8. **reopen-owner**: owner reopens via `openAndMigrate()`. WAL and all connection-local pragmas are reapplied. Every prepared-statement cache is rebuilt.
9. **rebuild-caches**: owner re-regers DB-dependent caches (observation queue store, memory store, skill candidate store, skill queue store). The existing `dbObjectIdentity` invalidation pattern (observation-queue.store.ts:289-301, 478-489) is the template.
10. **resume**: owner resumes DB work admission. Cron and capture work resume. Lease is released. Recovery state is cleared.

**Recovery state**: each state transition is persisted in `db_maintenance_state.result_json`. If the process crashes during compaction, the next boot reads the recovery state:

- If state is `compact` or later and the compacted DB is valid, the owner reopens the compacted DB.
- If state is `compact` and the compacted DB is invalid, the owner reopens the pre-compaction backup (renamed to the canonical path after all handles are closed).
- If state is `close-owner` and neither DB is valid, the owner refuses to open and surfaces a `db:health` error.

**Recovery if compaction succeeds but owner reopen fails**: the compacted DB is valid but `openAndMigrate()` throws (ABI mismatch, corrupted vec extension). The owner falls back to the pre-compaction backup (still on disk from step 2). If the backup also fails to open, the owner sets `readiness = 'failed'` and surfaces a `db:health` error with both failure reasons.

**Quality requirements**:

- A validated backup MUST exist before compaction starts. No backup, no compaction.
- Backups rotate ONLY after the new backup is validated (root audit: `backup.service.ts:37-42` rotates after `backup()` returns, but `backup()` can return `null`).
- WAL size telemetry is reported at each state transition.
- The entire state machine is abortable via the boot coordinator's abort signal. An abort during compaction leaves the pre-compaction DB in place (the backup is the recovery path).
- The state machine runs at most once per boot, and at most once per N days (default 30), persisted in `db_maintenance_state.next_eligible_at`.

**Files affected**:

- `libs/backend/persistence-sqlite/src/lib/maintenance/compaction-state-machine.ts` (CREATE)
- `libs/backend/persistence-sqlite/src/lib/maintenance/maintenance-worker.ts` (MODIFY — add compaction operations)
- `libs/backend/persistence-sqlite/src/lib/maintenance/maintenance-state.ts` (MODIFY — add recovery state CRUD)
- `libs/backend/persistence-sqlite/src/lib/sqlite-connection.service.ts` (MODIFY — add `pauseAdmission`, `drainStatements`, `reopen` methods)

### Component 7: Strategy per blocker

This section covers every blocker in `context.md`. Each item states what the user still gets and when.

#### 7.1 quick_check + foreign_key_check (sqlite-connection.service.ts:604)

**Strategy**: RELOCATE + BOUND (persisted marker)

**Current**: runs synchronously on every boot on the owner connection before migrations. 2-20 seconds.

**New**: move to the maintenance worker. The owner opens and migrates without `runBootChecks`. The worker opens a read-only connection, runs `quick_check`, finalizes the statement, runs `foreign_key_check`, records the result in `db_maintenance_state`, and closes the handle. Runs at most once per 7 days (persisted `next_eligible_at`).

**What the user gets**: the integrity check runs on a 7-day cycle. If corruption is found, it is logged and surfaced via `db:health`. The first boot after install runs immediately (`next_eligible_at = 0`).

#### 7.2 observation_queue retention + one-time compaction (observation-queue.store.ts:650)

**Strategy**: SCHEDULE (persisted marker) + BOUND (batched) + STATE MACHINE (compaction)

**Current**: `purgeOlderThan` has NO production caller. 684 MB / 142,834 rows accumulate forever.

**New**: the maintenance worker runs the purge on a schedule (default 30-day retention, daily check). Batched `BEGIN IMMEDIATE` transactions (250-500 rows), cursor progress in `db_maintenance_state.cursor_id`, 100-250 ms sleep between batches. On `SQLITE_BUSY`, rollback, jittered backoff, retry without advancing the cursor.

The one-time compaction runs via the compaction state machine (Component 6) after the first successful purge.

**What the user gets**: the queue is pruned automatically. The database stops growing. The compaction reclaims the 684 MB on the first purge run after upgrade.

#### 7.3 session import + prune (wire-runtime.ts:429)

**Strategy**: DEFER (after window) + DEDUPLICATE (shared in-flight registry)

**Current**: `sessionImporter.scanAndImport(workspaceRoot, 50)` awaited before the window. 30-60 seconds. A second run fires on the initial `workspace:switch` from the renderer.

**New**: move `scanAndImport` to `wireRuntimePostWindow`. Both the boot-time call and the `workspace:switch` handler check an `InFlightRegistry` keyed by normalized workspace root. If work is in-flight for the same root, the second caller awaits the same promise. If the root differs, the first is aborted via the coordinator's signal.

`SessionLoaderService._loadSessionsImmediate()` calls `session:list` during renderer bootstrap. When SQLite is not yet open, the handler returns `RpcReadinessError`. The frontend retries after `retryAfterMs` or when `BOOT_READINESS_CHANGED` arrives.

The session list populates progressively. The user can start a new chat while the import runs.

**Files affected**:

- `apps/ptah-electron/src/activation/wire-runtime.ts` (MODIFY — move to post-window)
- `libs/backend/agent-sdk/src/lib/session-importer.service.ts` (MODIFY — yield between sessions via `setImmediate`, accept in-flight registry)
- `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts` (MODIFY — add readiness guard)

#### 7.4 memory boot scan (memory-trigger.service.ts:894)

**Strategy**: DEFER (after window) + CRASH-RESUMABLE CHUNKING (not tail-only)

**Current**: `memoryTrigger.start()` reads whole transcripts (up to 36 MB each). 22-480 seconds.

**New**: `memoryTrigger.start()` moves to `wireRuntimePostWindow`. The boot scan uses crash-resumable transcript chunking, not a fixed `tailBytes`:

- Each session is read in chunks (default 256 KiB) starting from byte offset 0.
- A per-session byte cursor is persisted in a `session_scan_state` table (or in `db_maintenance_state` with `operation = 'memory-boot-scan'`).
- The scan processes one chunk per session, then yields to the event loop via `setImmediate`.
- The "fully scanned" watermark for a session is advanced ONLY after all eligible chunks have been processed. A tail-only read would permanently skip data in completed historical sessions that never receive a `PreCompact` event.

**What the user gets**: memory is available after the window opens. The boot scan runs in the background. Memories appear as they are extracted. No session data is permanently skipped.

**Files affected**:

- `libs/backend/memory-curator/src/lib/triggers/boot-scan-runner.ts` (MODIFY — chunked reading with cursor)
- `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts` (MODIFY — pass cursor config)
- `libs/backend/persistence-sqlite/src/lib/migrations/0042_session_scan_state.ts` (CREATE — per-session scan cursor)

#### 7.5 skills boot scan (skill-synthesis.service.ts:304,311, trajectory-extractor.ts:168)

**Strategy**: DEFER (after window) + CRASH-RESUMABLE CHUNKING

**Current**: `skillSynthesis.start()` reads full JSONL transcripts for every session. 22-480 seconds.

**New**: `skillSynthesis.start()` moves to `wireRuntimePostWindow`. The boot scan uses the same crash-resumable chunking as the memory boot scan (shared cursor infrastructure). The "fully scanned" watermark is not advanced until all chunks are processed.

**What the user gets**: skills are available after the window opens. The boot scan runs in the background. No session data is permanently skipped.

**Files affected**:

- `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts` (MODIFY — accept cursor config)
- `libs/backend/skill-synthesis/src/lib/trajectory-extractor.ts` (MODIFY — chunked reading with cursor)

#### 7.6 SKILL.md migration re-walk (skill-md-migration.ts:47,81-93)

**Strategy**: INCREMENTAL (migration-version marker in SQLite)

**Current**: `readdirSync`/`readFileSync` over 2391 + 2390 files on every boot, all skipped. 2 seconds.

**New**: SQLite IS open before the migration runs (skill-synthesis.service.ts:282-283 calls `openAndMigrate()` before `migrateSkillMdFiles()` at line 304). Add a migration-version marker in a `skill_md_migration_state` table. The marker records the last migration version applied and the last scan timestamp. If the marker is current (same migration version, scan within 24 h), skip the walk.

Do NOT rely solely on root-directory mtime — individual SKILL.md files may have been edited without changing the directory mtime. The marker records the migration version, not the directory mtime.

**What the user gets**: the SKILL.md migration runs once, then never again until the migration version changes. The 2-second overhead disappears from subsequent boots.

**Files affected**:

- `libs/backend/skill-synthesis/src/lib/skill-md-migration.ts` (MODIFY — check persisted marker)
- `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts` (MODIFY — pass marker)
- `libs/backend/persistence-sqlite/src/lib/migrations/0043_skill_md_migration_state.ts` (CREATE)

#### 7.7 user-layer mirror/reconcile + harness reconcile (wire-runtime.ts:309,317,360)

**Strategy**: RELOCATE (hash worker) + DEFER (after window) + BOUND (abort signal)

**Current**: `mirrorUserLayer` (walk), `reconcileUserLayer` (walk + sha256), `reconcileHarness('activation')` (sha256, no abort signal, runs twice). 22-40 seconds.

**New**: move all three to `wireRuntimePostWindow`. The sha256 hashing delegates to the CPU worker pool via `harness-sync`'s own `HashWorkerClient` (which uses `IWorkerProcessFactory`, not `workspace-intelligence`). The reconciler orchestration stays on main — it owns the manifest stores, locks, gates, and targets (worker audit section "Recommended cut points" 3).

Add an `AbortSignal` to `reconcileHarness` from the boot coordinator. A `workspace:switch` for a different root aborts the in-flight pass. The double-run (pre-network + post-download at wire-runtime.ts:330-356) stays deliberate.

**What the user gets**: harness skills are available after the window opens. The `HARNESS_HEALTH_CHANGED` message updates the UI badge when the first pass completes.

**Files affected**:

- `apps/ptah-electron/src/activation/wire-runtime.ts` (MODIFY — move to post-window, pass abort signal)
- `libs/backend/harness-sync/src/lib/reconciler/harness-reconciler.service.ts` (MODIFY — accept `AbortSignal`)
- `libs/backend/harness-sync/src/lib/hash/content-hash.ts` (MODIFY — delegate to `HashWorkerClient`)
- `libs/backend/harness-sync/src/lib/hash/hash-worker-client.ts` (CREATE)

#### 7.8 workspace file index (boot-thoth-runtime.ts:386)

**Strategy**: RELOCATE (worker_threads) + DEFER (after window) + FIX EXCLUSION BUG FIRST

**Current**: `fileIndex.start(workspaceRoot)` triggers `WorkspaceIndexerService.indexWorkspace` which runs `ignore-pattern-resolver.service.ts:225-239` (async with zero I/O, microtask-only, never yields) and `pattern-matcher.service.ts:146` (`JSON.stringify` cache key per call). ~1.5 M pattern checks, one unbroken run.

**New**: move `fileIndex.start` to `wireRuntimePostWindow`. The one-shot index build delegates to the CPU worker pool. `WorkspaceFileIndexService` stays main-side (owns watcher, generation, mutable maps).

**Fix the exclusion bug first**: the worker audit identified that `workspace-indexer.service.ts:295-302` calls `matchFiles([relativePath], patterns)` and tests only array length. Because `matchFiles` always returns one result per input path, any non-empty `excludePatterns` skips every file. This bug must be fixed in the main-process code before the logic is reproduced in the worker.

**What the user gets**: the `@`-picker is empty at first, then populates via `INDEXING_PROGRESS` / `INDEXING_COMPLETE` messages.

**Files affected**:

- `libs/backend/workspace-intelligence/src/lib/file-indexing/workspace-indexer.service.ts` (MODIFY — fix exclusion bug, then delegate to worker)
- `libs/backend/workspace-intelligence/src/lib/file-indexing/workspace-file-index.service.ts` (MODIFY — accept worker snapshot)
- `apps/ptah-electron/src/activation/wire-runtime.ts` (MODIFY — move to post-window)

#### 7.9 COUNT(\*) probes (indexing-control.service.ts:226-239)

**Strategy**: DEFER (after window)

**Current**: two `SELECT COUNT(*)` scans awaited before the window. Only feeds a UI badge.

**New**: move to `wireRuntimePostWindow`. The UI badge shows "calculating..." until counts are ready, then updates via `MEMORY_CORPUS_CHANGED` (existing message type).

#### 7.10 cron catch-up daily backup + pre-migration backup

**Strategy**: SCHEDULE (maintenance worker) + BOUND + VALIDATE-BEFORE-ROTATE

**Current**: cron cold-start catch-up can run `@ptah/daily-backup` at boot. Pre-migration backup copies the whole DB.

**New**: daily backup moves to the maintenance worker with a read-only source handle. The cron handler dispatches to the worker. Rotation runs ONLY after the backup is validated with `quick_check` (root audit: `backup.service.ts:37-42` rotates after `backup()` returns, but `backup()` can return `null` — a failed attempt can age out a valid backup).

Pre-migration backup stays on the owner connection (must complete before migrations; migrations are rare; backup is non-fatal).

`incremental_vacuum(100)` stays on the owner connection (bounded, safe). The one-time 684 MB reclaim is handled by the compaction state machine (Component 6).

**What the user gets**: the daily backup runs at 03:00 UTC. The boot is not blocked. Pre-migration backup runs when a migration is pending (rare).

#### 7.11 eager registerRpcSurface (wire-runtime.ts:224)

**Strategy**: keep eager in pre-window

0.5-2 seconds is within the 5-second target. Lazy resolution is a future optimization.

**What the user gets**: all RPC handlers are registered before the window opens. No behavior change.

#### 7.12 Network awaits before window (bootstrap.ts:230,302)

**Strategy**: DEFER (fire-and-forget)

**New**: `verifyLicense` and `agentAdapter.initialize` become fire-and-forget. The membership card and auth status populate when the network calls complete.

### Component 8: Warmup promise barrier

**Purpose**: ensure embedder warmup runs even when `did-finish-load` fires before the memory curator exists.

**Pattern**: a promise barrier that combines renderer readiness and memory-curator readiness.

**Evidence**: `scheduleWarmup()` (wire-runtime.ts:616-617) returns immediately when `refs.memoryCurator === null`. With window-first boot, `did-finish-load` fires before the curator exists.

**New**: `scheduleWarmup` becomes a method on the boot coordinator. It waits for BOTH `did-finish-load` AND `refs.memoryCurator !== null` (or a 30 s timeout, whichever comes first), then starts the 3-second idle timer. The coordinator polls `refs.memoryCurator` via a `setInterval` (200 ms, `unref`'d) until it is non-null or the timeout expires.

**What the user gets**: embedder warmup always runs once the memory curator is available, regardless of boot timing.

**Files affected**:

- `apps/ptah-electron/src/activation/boot-coordinator.ts` (MODIFY — add warmup barrier)
- `apps/ptah-electron/src/activation/wire-runtime.ts` (MODIFY — `scheduleWarmup` delegates to coordinator)
- `apps/ptah-electron/src/activation/post-window.ts` (MODIFY — `did-finish-load` signals coordinator)

## Hexagonal compliance

### Backend libs depend on platform-core ports only

- `IWorkerProcessFactory` is a request-agnostic port in `platform-core`. It does not reference any domain protocol. The same port serves the maintenance worker, the CPU worker, and (in a follow-up) the embedder and voice workers.
- Domain protocols (maintenance messages, CPU worker messages, hash messages) stay in their owning libraries: `persistence-sqlite`, `workspace-intelligence`, `harness-sync`.
- `harness-sync` does NOT depend on `workspace-intelligence`. It owns its own `HashWorkerClient` that injects `IWorkerProcessFactory`.
- `platform-core` does NOT depend on `workspace-intelligence` or any feature library.

### No `import 'electron'` in libs

- `ElectronWorkerProcessFactory` and `ElectronCpuWorkerPool` live in `apps/ptah-electron/src/services/platform/`.

### One writable SQLite owner stays in persistence-sqlite

- `SqliteConnectionService` remains the single owner of the canonical connection.
- The maintenance worker opens its own connection as a documented exception (Component 4). The worker handshake enforces SQLite version, canonical path, WAL mode, protocol version, deadlines, and short transaction limits.

### VS Code / CLI fallbacks

- `IWorkerProcessFactory`: no factory registered. Maintenance operations fall back to the current synchronous behavior (deferred to after window). CPU operations fall back to in-process synchronous calls.
- Readiness contracts: the frontend retry logic works the same way — if the backend is not ready, it retries. In VS Code / CLI, the backend opens synchronously (no window-first reordering), so `ready: true` is returned immediately.

## Verification

### Instrument already on this branch

- `EventLoopMonitor` (vscode-core/src/diagnostics/event-loop-monitor.ts) — samples event-loop delay every 2 s.
- `CpuProfileCapture` (vscode-core/src/diagnostics/cpu-profile-capture.ts) — captures `.cpuprofile` files.
- `armDiagnostics` (vscode-core/src/diagnostics/arm-diagnostics.ts) — wired at wire-runtime.ts:190.

### Targets

| Metric                            | Current                     | Target          | How to read                                                                    |
| --------------------------------- | --------------------------- | --------------- | ------------------------------------------------------------------------------ |
| Time-to-window                    | 73 s                        | <5 s warm start | Electron log: `[Ptah Electron] Startup config registered` (post-window.ts:107) |
| Max event-loop lag in first 120 s | 18 s                        | <500 ms         | Electron log: `[event-loop] lag` lines — `maxMs`, `p99Ms`, `meanMs`            |
| SQLite quick_check on boot        | 2-20 s every boot           | 0 s on boot     | Absent from boot log                                                           |
| Session import blocking window    | 30-60 s                     | 0 s (deferred)  | `Imported N sessions` appears after `Startup config registered`                |
| Embedder warmup                   | Runs only if curator exists | Always runs     | `[Ptah Electron] Embedder warmup complete` in log                              |

### Tests to write (verification)

- Startup RPCs issued while persistence is warming: mock `SqliteConnectionService.isOpen = false`, call `session:list`, assert `RpcReadinessError` returned. Assert frontend retries after `retryAfterMs`.
- Workspace race: fire `onDidChangeWorkspaceFolders` before `bootHeavyServices` resolves. Assert the one-shot latch is not stolen by the wrong root.
- Quit-during-boot: trigger `will-quit` while `wireRuntimePostWindow` is running. Assert `coordinator.abort()` cancels in-flight work. Assert `will-quit` disposal runs after a bounded grace period.
- Warmup barrier: fire `did-finish-load` before `refs.memoryCurator` is set. Assert warmup runs after the curator is available.
- Worker stale-response: send a request, abort the worker, restart it, send a new request. Assert the stale response is rejected.
- Compaction recovery: simulate a crash during `compact` state. Assert the next boot reopens the valid DB (compacted or backup).
- WAL growth: run `quick_check` while writes are active. Assert WAL size telemetry is logged and WAL does not grow unbounded.

## Delivery batches

Ordered by user-visible impact. Each batch is independently shippable.

### Batch 1: Boot coordinator + window-first reordering (highest impact)

**Goal**: open the window within 5 seconds. Move all heavy work to after the window with a stable refs object and abort signal.

**Files**:

- `apps/ptah-electron/src/activation/boot-coordinator.ts` (CREATE)
- `apps/ptah-electron/src/main.ts` (REWRITE)
- `apps/ptah-electron/src/activation/bootstrap.ts` (MODIFY — fire-and-forget network calls)
- `apps/ptah-electron/src/activation/wire-runtime.ts` (REWRITE — split pre/post, use coordinator)
- `apps/ptah-electron/src/activation/post-window.ts` (MODIFY)
- `libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts` (MODIFY — accept abort signal)
- `libs/backend/agent-sdk/src/lib/session-importer.service.ts` (MODIFY — yield between sessions)

**New files**: `boot-coordinator.ts`.
**New DI tokens**: none.
**New esbuild targets**: none.
**Tests**: boot ordering, quit-during-boot, workspace race, warmup barrier.

### Batch 2: Backend readiness contracts (critical for correctness)

**Goal**: SQLite-backed RPCs return typed readiness errors when the backend is warming. Frontend retries.

**Files**:

- `libs/shared/src/lib/types/rpc/rpc-readiness.types.ts` (CREATE)
- `libs/shared/src/lib/types/rpc/rpc-session.types.ts` (MODIFY)
- `libs/shared/src/lib/types/rpc/rpc-memory.types.ts` (MODIFY)
- `libs/shared/src/lib/types/rpc/rpc-corpus.types.ts` (MODIFY)
- `libs/shared/src/lib/types/messages/message-constants.ts` (MODIFY)
- `libs/shared/src/lib/types/messages/message-type.ts` (MODIFY)
- `libs/shared/src/index.ts` (MODIFY)
- `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts` (MODIFY)
- `libs/frontend/core/src/lib/services/electron-layout.service.ts` (MODIFY)
- `libs/backend/rpc-handlers/src/lib/handlers/` — each SQLite-backed handler (MODIFY)

**New files**: `rpc-readiness.types.ts`.
**New DI tokens**: none.
**New esbuild targets**: none.
**Tests**: warming RPC responses, frontend retry, readiness notification.

### Batch 3: Crash-resumable transcript chunking (medium impact, prevents data loss)

**Goal**: replace whole-transcript and tail-only reads with chunked reading that does not skip data.

**Files**:

- `libs/backend/memory-curator/src/lib/triggers/boot-scan-runner.ts` (MODIFY)
- `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts` (MODIFY)
- `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts` (MODIFY)
- `libs/backend/skill-synthesis/src/lib/trajectory-extractor.ts` (MODIFY)
- `libs/backend/persistence-sqlite/src/lib/migrations/0042_session_scan_state.ts` (CREATE)

**New files**: `0042_session_scan_state.ts`.
**Tests**: chunked reading, cursor progress, watermark not advanced until all chunks processed.

### Batch 4: SKILL.md migration marker (quick win)

**Goal**: skip the 2391+2390 file re-walk when the migration version has not changed.

**Files**:

- `libs/backend/skill-synthesis/src/lib/skill-md-migration.ts` (MODIFY)
- `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts` (MODIFY)
- `libs/backend/persistence-sqlite/src/lib/migrations/0043_skill_md_migration_state.ts` (CREATE)

**Tests**: skip when marker current, walk when version changes.

### Batch 5: Maintenance worker + SQLite operations (high impact, high effort)

**Goal**: move integrity checks, retention purge, daily backup, and compaction to a `utilityProcess` worker.

**Files**: see Component 4 and Component 6 file lists.

**New DI tokens**: `PLATFORM_TOKENS.WORKER_PROCESS_FACTORY`, `PERSISTENCE_TOKENS.MAINTENANCE_WORKER_CLIENT`.
**New esbuild targets**: `build-maintenance-worker`.
**Tests**: worker spawn, integrity check, purge batch, backup, compaction state machine, recovery, WAL growth telemetry, stale-response rejection, Zod validation.

### Batch 6: CPU worker pool + file index + hashing (high impact, high effort)

**Goal**: move pattern matching, content hashing, and file index build to `worker_threads`.

**Files**: see Component 5 file lists.

**New esbuild targets**: `build-cpu-worker`.
**Tests**: match-files, hash-directories, build-workspace-index, cancel, exclusion bug fix, generation guard.

### Batch 7: Harness reconcile abort signal + deduplication

**Goal**: add `AbortSignal` to `reconcileHarness`. Deduplicate boot-time and renderer-driven session import and index build.

**Files**:

- `apps/ptah-electron/src/activation/wire-runtime.ts` (MODIFY)
- `libs/backend/harness-sync/src/lib/reconciler/harness-reconciler.service.ts` (MODIFY)
- `libs/backend/agent-sdk/src/lib/session-importer.service.ts` (MODIFY — in-flight registry)
- `libs/backend/workspace-intelligence/src/lib/file-indexing/workspace-file-index.service.ts` (MODIFY — deduplicate start calls)

**Tests**: abort cancels in-flight pass, deduplication for same root, abort for different root.

## Decisions taken

### Decision 1: utilityProcess for SQLite maintenance, worker_threads for CPU

**Chosen**: `utilityProcess` for SQLite (crash isolation for native `better-sqlite3`). `worker_threads` for CPU (cheaper, structured clone, no native modules).

**Alternatives**: `worker_threads` for SQLite — rejected because a native `abort()` in SQLite could crash the main process. `utilityProcess` for CPU — rejected because the IPC serialization overhead exceeds the in-process transfer cost for pure-JS work.

### Decision 2: request-agnostic `IWorkerProcessFactory` in platform-core

**Chosen**: a single request-agnostic port in `platform-core`. Domain protocols stay in owning libraries.

**Rationale**: the review identified that `ICpuWorkerPool` in `platform-core` referencing `workspace-intelligence` protocol types would invert the dependency. A request-agnostic factory avoids this: `platform-core` knows only `postMessage`/`on`/`kill`. Each domain (persistence-sqlite, workspace-intelligence, harness-sync) owns its own protocol and typed client.

**Alternatives**: domain-specific factory ports (one per worker type). Rejected — duplicates the process lifecycle code. A single request-agnostic port is simpler and is the pattern `IEmbedderWorkerProcessFactory` already follows (it is request-agnostic in practice; the protocol lives in `embedder-worker-protocol.ts`).

### Decision 3: keep `registerRpcSurface` eager

0.5-2 s is within the 5-s target. Lazy resolution is a future optimization.

### Decision 4: one new message type `BOOT_READINESS_CHANGED`

**Chosen**: add `BOOT_READINESS_CHANGED: 'boot:readinessChanged'` to `MESSAGE_TYPES` and `StrictMessageType`.

**Rationale**: the renderer needs a single signal that the backend has transitioned from warming to ready. Per-service signals (`MEMORY_CORPUS_CHANGED`, etc.) are insufficient because they fire per-service, not as a unified readiness gate. The `session:list` retry needs to know when to retry, not poll on a timer.

**Alternatives**: poll-only (retry every 2 s without a notification). Rejected — adds latency and unnecessary RPC traffic.

### Decision 5: crash-resumable chunking, not tailBytes

**Chosen**: per-session byte/message cursor with chunked reading. The "fully scanned" watermark advances only after all eligible chunks are processed.

**Rationale**: the review identified that tail-only scanning can permanently skip data in completed historical sessions that never receive a `PreCompact` event. Chunked reading with a persisted cursor is crash-safe and does not skip data.

**Alternatives**: tail-only with `tailBytes = 64 KiB`. Rejected — permanently skips data.

### Decision 6: migration-version marker for SKILL.md, not JSON sidecar

**Chosen**: SQLite table `skill_md_migration_state` recording the last migration version applied.

**Rationale**: `SkillSynthesisService.start()` calls `openAndMigrate()` at line 282-283 before `migrateSkillMdFiles()` at line 304. SQLite IS open when the migration runs. A JSON sidecar is unnecessary. Do not rely on directory mtime alone — individual files may be edited without changing directory mtime.

**Alternatives**: JSON sidecar. Rejected — the claimed circular dependency does not exist.

### Decision 7: compaction as owner-coordinated state machine

**Chosen**: a 10-state state machine with persisted recovery state, validated backup, checkpoint verification, and cache rebuilding.

**Rationale**: the review identified that "pause owner writes" without defining an admission gate or draining consumers is unsafe. The state machine defines each step, the recovery path for each failure, and the cache rebuilding after reopening.

**Alternatives**: single `VACUUM` call. Rejected — unsafe while the owner is open and writing.

### Decision 8: second writable SQLite connection as documented exception

**Chosen**: the maintenance worker opens a read-write connection for purge and `PRAGMA optimize`. This is explicitly documented with version/path/WAL verification, short transactions, deadlines, and checkpoint coordination.

**Alternatives**: route all writes through the owner. Rejected — the purge generates WAL frames on the owner connection, blocking the event loop for the batch duration. The worker's own connection isolates the write contention.

### Decision 9: pre-migration backup stays on owner

**Chosen**: keep pre-migration backup on the owner connection.

**Rationale**: must complete before migrations. Migrations are rare. Backup is non-fatal. Moving to the worker adds coordination complexity for no gain.

## Team-leader handoff

### Developer type recommendation

`backend-developer` for Batches 1-4, 7. `backend-developer` + `devops-engineer` for Batches 5-6 (new esbuild targets, native module packaging).

### Complexity assessment

**Complexity**: HIGH. **Estimated effort**: 50-70 hours.

### Files affected summary

**CREATE** (new files):

- `apps/ptah-electron/src/activation/boot-coordinator.ts`
- `libs/shared/src/lib/types/rpc/rpc-readiness.types.ts`
- `libs/backend/platform-core/src/interfaces/worker-process-factory.interface.ts`
- `libs/backend/persistence-sqlite/src/lib/maintenance/maintenance-worker-protocol.ts`
- `libs/backend/persistence-sqlite/src/lib/maintenance/maintenance-worker-client.ts`
- `libs/backend/persistence-sqlite/src/lib/maintenance/maintenance-worker.ts`
- `libs/backend/persistence-sqlite/src/lib/maintenance/maintenance-state.ts`
- `libs/backend/persistence-sqlite/src/lib/maintenance/compaction-state-machine.ts`
- `libs/backend/persistence-sqlite/src/lib/migrations/0041_db_maintenance_state.ts`
- `libs/backend/persistence-sqlite/src/lib/migrations/0042_session_scan_state.ts`
- `libs/backend/persistence-sqlite/src/lib/migrations/0043_skill_md_migration_state.ts`
- `libs/backend/workspace-intelligence/src/lib/workers/cpu-worker.ts`
- `libs/backend/workspace-intelligence/src/lib/workers/cpu-worker-protocol.ts`
- `libs/backend/workspace-intelligence/src/lib/workers/cpu-worker-client.ts`
- `libs/backend/harness-sync/src/lib/hash/hash-worker-client.ts`
- `apps/ptah-electron/src/services/platform/electron-worker-process-factory.ts`
- `apps/ptah-electron/src/services/platform/electron-cpu-worker-pool.ts`
- `apps/ptah-electron/tsconfig.maintenance-worker.json`
- `apps/ptah-electron/tsconfig.cpu-worker.json`

**MODIFY** (existing files): all files listed in Component 1-8 file lists.

### Critical verification points

1. All imports verified: `IEmbedderWorkerProcessFactory` pattern at `worker-process.port.ts:9-20`. `utilityProcess.fork` at `electron-embedder-worker-factory.ts:51`. `worker_threads.Worker` at `ts-diagnostics-worker-source.ts:49`.
2. All RPC result contracts verified: `SessionListResult` (rpc-session.types.ts:73-77) is flat. `DbHealthResult` (rpc-persistence.types.ts:40-66) has nullable fields for unavailable state. The readiness union is a new addition, not a mutation of existing contracts.
3. All boot-path claims verified: `ChatLifecycleService.bootstrap()` calls `loadSessions()` at line 60. `ElectronLayoutService.syncFromBackend()` sends `workspace:switch` at line 604. `SkillSynthesisService.start()` calls `openAndMigrate()` at line 282 before `migrateSkillMdFiles()` at line 304.
4. `scheduleWarmup()` at wire-runtime.ts:617 returns early when `refs.memoryCurator === null`.
5. Workspace race comment at wire-runtime.ts:501-506.
6. No hallucinated APIs: all decorators, tokens, and esbuild options verified against existing usage.

### Architecture delivery checklist

- [x] All components specified with evidence (file:line citations)
- [x] All patterns verified from codebase
- [x] All incorrect claims from the review corrected with source evidence
- [x] Boot coordinator with stable refs, readiness state, abort signal, shutdown-safe disposal
- [x] Typed readiness contracts in libs/shared, not undocumented warming payloads
- [x] Workspace race prevention (listener + immediate boot promise, no intervening await)
- [x] Deduplication of boot-time and renderer-driven session import/index
- [x] Crash-resumable transcript chunking, not tail-only (prevents permanent data loss)
- [x] SKILL.md migration marker in SQLite (not JSON sidecar)
- [x] Compaction as owner-coordinated state machine with recovery
- [x] Second writable SQLite connection as documented exception with handshake enforcement
- [x] Warmup promise barrier combining renderer readiness and curator readiness
- [x] Request-agnostic `IWorkerProcessFactory` in platform-core (no feature-lib coupling)
- [x] Domain protocols stay in owning libraries
- [x] Zod validation for worker messages
- [x] Worker request deadlines and stale-response rejection
- [x] WAL growth telemetry
- [x] Validated-backup-before-compaction and rotate-after-success
- [x] Recovery state if compaction succeeds but reopen fails
- [x] Workspace-indexer exclusion bug fix before worker reproduction
- [x] Tests for startup RPCs issued while persistence is warming
- [x] Every feature survives — state what the user still gets and when
- [x] All 12 blockers from context.md covered
- [x] Decisions taken section for all forks resolved
