# Batch 3 report — TASK_2026_380 (components 9, 11, 10, 14b)

**Status**: Tasks 3.1, 3.2, 3.3, 3.4 complete. Nothing committed. `batches.md`
untouched by me.

All paths are in the worktree
`D:/projects/ptah-extension/.claude-worktrees/electron-cold-start-380`.

---

## Tasks 3.1-3.3

### Task 3.1 — `IBootReadinessProvider` port + host answers (component 9)

| Action   | Path                                                                    | What it does                                                                                                                                                                 |
| -------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CREATED  | `libs/backend/platform-core/src/interfaces/boot-readiness.interface.ts` | `IBootReadinessProvider { getReadiness(): BootReadinessChangedPayload }`. Synchronous, read-only, one method. Type-only import of the payload from `@ptah-extension/shared`. |
| MODIFIED | `libs/backend/platform-core/src/di/tokens.ts`                           | `BOOT_READINESS: Symbol.for('PlatformBootReadiness')`, documented in the `SESSION_ATTACHMENT_GUARD` shape (real adapter / null default named).                               |
| MODIFIED | `libs/backend/platform-core/src/index.ts`                               | `export type { IBootReadinessProvider }` beside `ISessionAttachmentGuard`.                                                                                                   |
| CREATED  | `libs/backend/vscode-core/src/services/null-boot-readiness.ts`          | `NullBootReadinessProvider` → `{ readiness: 'ready', phase: 'settled', startedAt }`, `startedAt` captured at construction so it is stable across reads.                      |
| CREATED  | `libs/backend/vscode-core/src/services/null-boot-readiness.spec.ts`     | Always-ready, finite `startedAt`, `startedAt` stable across two reads, no `detail`.                                                                                          |
| MODIFIED | `libs/backend/vscode-core/src/di/register-platform-agnostic.ts`         | `if (!container.isRegistered(PLATFORM_TOKENS.BOOT_READINESS))` guarded `registerSingleton`, in the same idiom and beside the `SESSION_ATTACHMENT_GUARD` block.               |
| CREATED  | `libs/backend/vscode-core/src/di/register-platform-agnostic.spec.ts`    | Registers the null provider when nothing else has; does NOT replace a provider a host already registered.                                                                    |
| CREATED  | `apps/ptah-electron/src/services/platform/electron-boot-readiness.ts`   | `ElectronBootReadinessProvider` delegating to `coordinator.snapshot()`. Constructor param typed `Pick<BootCoordinator, 'snapshot'>`; no state of its own.                    |
| MODIFIED | `apps/ptah-electron/src/activation/bootstrap.ts`                        | Registers it as a VALUE beside the `WEBVIEW_MANAGER` registration; `bootstrapElectron` gained a second parameter (see deviations).                                           |
| MODIFIED | `apps/ptah-electron/src/main.ts`                                        | Passes the coordinator into `bootstrapElectron`.                                                                                                                             |

All three hosts route through `registerVsCodeCorePlatformAgnostic`
(`vscode-core/src/di/register.ts:70` for VS Code, `cli-engine/src/lib/container.ts:382`
for the CLI, and Electron via its own DI setup), so no host can present an
unregistered token. Ordering is safe in both directions: Electron's
`container.register(..., { useValue })` overrides a null already registered, and
the `isRegistered` guard skips the null if Electron got there first.

### Task 3.2 — `boot:getReadiness`, all four registration sites (component 11)

| Action   | Path                                                                   | What it does                                                                                                                                                                                                                                   |
| -------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MODIFIED | `libs/backend/vscode-core/src/messaging/rpc-handler.ts`                | `'boot:'` appended to `ALLOWED_METHOD_PREFIXES` (the runtime guard; a missing prefix throws at registration, i.e. crashes activation).                                                                                                         |
| MODIFIED | `libs/shared/src/lib/types/rpc.types.ts`                               | The three deferred hunks from `batch-1-lane-C-report.md`, verbatim: the `BootGetReadinessResult` type-only import, the `RpcMethodRegistry` entry, the `RPC_METHOD_ENTRIES` key.                                                                |
| CREATED  | `libs/backend/rpc-handlers/src/lib/handlers/boot-rpc.schema.ts`        | `BootGetReadinessParamsSchema = z.object({}).strict()` — the no-argument method still validates at the boundary.                                                                                                                               |
| CREATED  | `libs/backend/rpc-handlers/src/lib/handlers/boot-rpc.handlers.ts`      | `BootRpcHandlers`, `static readonly METHODS … as const satisfies readonly RpcMethodName[]`, `register()` via `registerMethod`. Never throws.                                                                                                   |
| CREATED  | `libs/backend/rpc-handlers/src/lib/handlers/boot-rpc.handlers.spec.ts` | Registers under `boot:` without throwing (the double enforces the real prefix allowlist), returns the port snapshot, returns the ready fallback when the port throws, answers with `undefined` params, warns-but-answers on unexpected params. |
| MODIFIED | `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts`           | `{ key: 'boot', methods: BootRpcHandlers.METHODS, requires: [], handler: BootRpcHandlers }`. **No new `Capability` member.**                                                                                                                   |
| MODIFIED | `libs/backend/rpc-handlers/src/lib/handlers/index.ts`                  | Barrel export.                                                                                                                                                                                                                                 |
| MODIFIED | `libs/backend/rpc-handlers/src/index.ts`                               | Public export of `BootRpcHandlers`.                                                                                                                                                                                                            |

**Host profiles need nothing — verified, not assumed.**
`resolveRpcHandlerPlan` (`host-profile/register-rpc-surface.ts:105-127`) computes
`satisfies(profile.capabilities, entry.requires)`; with `requires: []` that is
unconditionally true, so the entry is enabled on every profile and `entry.handler`
supplies the class. A profile only has to act when an entry is host-owned
(`handler` omitted) or when it wants to switch a capability off. `apps/ptah-electron/src/rpc-host-profile.ts`,
the VS Code profile and `cli-engine/.../cli-host-profile.ts` are all unmodified.

**Never-throw shape.** The port read is wrapped in `try/catch (error: unknown)`
and degrades to `{ readiness: 'ready', phase: 'settled', startedAt: Date.now() }`.
A Zod parse failure is a `logger.warn` only, not a refusal: the method takes no
arguments, so malformed params cannot change the answer, and denying the read
would strand the renderer behind a boot screen — the exact failure the method
exists to prevent.

### Task 3.3 — `BootCoordinator` phase state, broadcaster, phase anchors (component 10)

| Action   | Path                                                                   | What it does                                                                                                                                                                                                                                                                                                                                                       |
| -------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MODIFIED | `apps/ptah-electron/src/activation/boot-coordinator.ts`                | Local `BootReadiness` **replaced** by the shared `BackendReadiness`; adds `readonly startedAt`, `private phase: BootPhase = 'starting'`, `private detail`, `setPhase`, `snapshot()`, `onReadinessChange`, `emitCurrent`. The `.then` sets `settled` + `ready`; the `.catch` sets `failed` and KEEPS the phase. 569 lines. **Every import is still `import type`.** |
| CREATED  | `apps/ptah-electron/src/activation/boot-readiness-broadcaster.ts`      | `createBootReadinessBroadcaster(container)` → per-emit `isRegistered`-guarded lazy resolve of `TOKENS.WEBVIEW_MANAGER`, duck-typed `broadcastMessage`, `void`ed with a `.catch`, whole body in `try/catch`.                                                                                                                                                        |
| CREATED  | `apps/ptah-electron/src/activation/boot-readiness-broadcaster.spec.ts` | Broadcasts under `boot:readinessChanged`; resolves lazily per emit; no-ops with no manager; swallows a synchronous throw; swallows a rejected broadcast.                                                                                                                                                                                                           |
| MODIFIED | `apps/ptah-electron/src/main.ts`                                       | `coordinator.onReadinessChange(createBootReadinessBroadcaster(boot.container))` (see deviations for the position).                                                                                                                                                                                                                                                 |
| MODIFIED | `apps/ptah-electron/src/activation/boot-heavy-services.ts`             | Four phase anchors, exactly as specified: `database` before `await bootThothRuntime`, `harness` right after `markPersistenceSettled`, `sessions` before `scanAndImport`, `index` before `startThothCron`. **No `skills` phase.**                                                                                                                                   |
| MODIFIED | `apps/ptah-electron/src/activation/post-window.ts`                     | `once('did-finish-load')` → `on(...)`; the handler still calls `notifyWindowLoaded()` and additionally re-emits `coordinator.snapshot()` through a local broadcaster.                                                                                                                                                                                              |
| MODIFIED | `apps/ptah-electron/src/activation/boot-coordinator.spec.ts`           | New `phase state` describe: initial `starting`/`warming`, one emit per distinct phase, ZERO for a repeat, `snapshot()` reflects the last phase, a throwing emitter does not propagate (and the state still advances), no emitter registered is fine, `settled`+`ready` on resolve, phase KEPT on failure.                                                          |
| MODIFIED | `apps/ptah-electron/src/activation/boot-order.spec.ts`                 | New describe driving the phases through `startPostWindow`: asserts `database → harness → sessions → index → settled` exactly, asserts no `skills`, and asserts the pull answer (`snapshot()`) agrees with the last push.                                                                                                                                           |

### Deviations from the plan — Tasks 3.1-3.3

1. **`bootstrapElectron` gained a parameter.** The plan says register the
   Electron adapter in `bootstrap.ts` beside `WEBVIEW_MANAGER` (`:342`), but the
   `BootCoordinator` is constructed in `main.ts` and `bootstrapElectron` had no
   access to it. It now takes `coordinator: Pick<BootCoordinator, 'snapshot'>` as
   a second argument and `main.ts` passes it. `bootstrap.network.spec.ts` reads
   the function body textually and still passes. The alternative — registering in
   `wire-runtime.ts`, which already receives the coordinator — would have put a
   platform adapter registration outside the file that owns every other one.

2. **The broadcaster is wired after `bootstrapElectron` returns, not immediately
   after `new BootCoordinator()`.** It closes over the container, which does not
   exist at coordinator construction. This is the first line after the container
   appears, and it is still far ahead of the first `setPhase` (the earliest
   anchor is in `boot-heavy-services.ts`, behind the window), so no transition
   can be missed. The alternative was giving the broadcaster a
   `() => DependencyContainer | null` getter purely to satisfy a line number.

3. **`post-window.ts` builds its own broadcaster instance** rather than reaching
   for the coordinator's emitter. The coordinator's emitter fires on
   TRANSITIONS; a window load is not a transition, and the coordinator has no
   "re-emit" method (adding one would put a replay concern in the state holder).
   Both are stateless closures over the same container, so nothing is shared and
   nothing is duplicated but one function call.

4. **The `boot:getReadiness` transport handler is `async` even though the port is
   synchronous.** `RpcMethodHandler` is typed `=> Promise<TResult>`
   (`vscode-core/src/messaging/rpc-types.ts:66-68`), so a synchronous return does
   not compile. The `async` awaits nothing; the port stays synchronous as the plan
   requires.

5. **`setPhase` also clears `detail` on transition**, and the `.then` clears it
   with `settled`. Not in the plan, but a stale `"Importing recent sessions"`
   surviving into a `settled` payload would be a lie the renderer would print.

---

## Task 3.4 — Back-office activity emitter (component 14b)

| Action   | Path                                                          | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CREATED  | `libs/backend/thoth-runtime/src/lib/activity-emitter.ts`      | `createActivityEmitter(container, logPrefix)` → `emit(source, kind, summary, level?)`, lazily resolving `TOKENS.WEBVIEW_MANAGER` behind `isRegistered`, broadcasting `MESSAGE_TYPES.ACTIVITY_EVENT` with an `ActivityEventPayload`, `void`ed and fully swallowed. Plus `withActivityEmit(emit, handlerName, handler)`, the cron wrapper.                                                                                                           |
| CREATED  | `libs/backend/thoth-runtime/src/lib/activity-emitter.spec.ts` | 12 cases: payload passes `isActivityEventPayload`, `level` omitted when absent and passed through when given, zero emits + zero `resolve` with no manager, lazy per-emit resolution, sync throw and rejected broadcast both swallowed; wrapper returns the original object by identity, emits one info event, emits a warn event carrying the skip reason, falls back to a generic summary, and rethrows a failing handler while emitting nothing. |
| MODIFIED | `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts`      | One `emitActivity` built at the top of `startThothCron`; `backup:daily`, `db:integrity` and the three `skills:drain:*` tiers each wrapped with `withActivityEmit`. 456 lines. User-defined jobs deliberately untouched.                                                                                                                                                                                                                            |
| MODIFIED | `libs/backend/thoth-runtime/src/lib/start-thoth-cron.spec.ts` | New `back-office activity events` describe: a wrapped handler returns its original value AND emits exactly one `activity:event`; with no `WEBVIEW_MANAGER` the handler still runs, emits zero and throws nothing.                                                                                                                                                                                                                                  |
| MODIFIED | `libs/backend/thoth-runtime/src/index.ts`                     | Exports `createActivityEmitter`, `withActivityEmit`, `type ActivityEmitter`.                                                                                                                                                                                                                                                                                                                                                                       |
| MODIFIED | `apps/ptah-electron/src/activation/boot-heavy-services.ts`    | One `emitActivity = createActivityEmitter(container, '[Ptah Electron]')`; three emits — `harness`/`user-layer` after `refreshUserLayer(…, 'activation')`, `harness`/`reconcile` after the first `reconcileHarness(…, 'activation', …)`, `sessions`/`import` after `scanAndImport` returns its count.                                                                                                                                               |

### Decisions in Task 3.4

- **The app reuses `thoth-runtime`'s `createActivityEmitter`** rather than
  emitting through Task 3.3's boot-readiness broadcaster. The two carry different
  message types and different payloads; routing activity through the readiness
  broadcaster would have meant giving it a second responsibility. `thoth-runtime`
  is already a dependency of the app, so this is one emitter implementation and
  one lazy-resolution rule, which is what the brief asked for.
- **A THROWN cron handler emits nothing and rethrows.** The ticker has no
  `'error'` level by design (`rpc-activity.types.ts` header), the scheduler's run
  row is the channel for a failed run, and swallowing would turn a failure into a
  success.
- **`{ outcome: 'skipped' }` emits at `'warn'`** — a gated tick ran to completion
  and did nothing, which is exactly the degraded-but-completed case `'warn'`
  exists to tint. The reason token is passed through verbatim.
- **Only the FIRST harness reconcile emits.** The post-download pass in the
  `ensureContent().then(...)` callback is the same work against fresher sources;
  emitting there too would put two indistinguishable lines in the ticker for one
  user-visible outcome.
- **The session import emits even when the count is zero** ("No new sessions to
  import"). That is the answer a user wondering where their sessions went needs.
- **No subsystem that already broadcasts gained a second broadcast.** Memory,
  indexing, skill synthesis, vec, embedder and boot readiness are untouched.
- **`thoth-runtime` learned nothing about a ticker.** No `electron` import, no
  renderer type; the payload is the same kind of pre-formatted sentence the memory
  bridges in `boot-thoth-runtime.ts` already produce.

### Deviations — Task 3.4

1. **`withActivityEmit` lives in `activity-emitter.ts`, not inline in the cron
   file**, per the brief's own instruction. It imports `JobHandler` from
   `@ptah-extension/cron-scheduler` (type-only); `thoth-runtime` already depends
   on that lib.
2. **`registerSkillDrainJobs` and `registerIntegrityCheckJob` each gained an
   `emit: ActivityEmitter` parameter.** Both are file-private.

---

## Verification run

Every command below was run from the worktree root.

| Command                                                                                                                                                                                                             | Result                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx nx run-many -t test -p @ptah-extension/platform-core @ptah-extension/vscode-core @ptah-extension/rpc-handlers @ptah-extension/thoth-runtime @ptah-extension/shared ptah-electron --parallel=1 --skip-nx-cache` | **PASS.** Header read: `Running target test for 6 projects`. shared 1347/1347, platform-core 540 + 4 todo, vscode-core 490/490, rpc-handlers 2714 passed + 31 pre-existing skips, thoth-runtime 66/66, ptah-electron 432 passed + 4 skipped. `Successfully ran target test for 6 projects`. |
| `npx nx run-many -t typecheck -p ptah-electron @ptah-extension/rpc-handlers @ptah-extension/thoth-runtime @ptah-extension/vscode-core @ptah-extension/platform-core --parallel=1`                                   | **PASS.** `Successfully ran target typecheck for 5 projects`, zero `error TS`.                                                                                                                                                                                                              |
| `npx nx build ptah-electron`                                                                                                                                                                                        | **PASS.** `Successfully ran target build for project ptah-electron and 9 tasks it depends on`.                                                                                                                                                                                              |
| `npx jest --config libs/backend/rpc-handlers/jest.config.ts …/rpc-allowlist.spec.ts …/boot-rpc.handlers.spec.ts`                                                                                                    | **PASS**, 2 suites / 14 tests. `rpc-allowlist.spec.ts` — the manifest partition + prefix gate — is green.                                                                                                                                                                                   |
| `npx tsc -p libs/shared/tsconfig.lib.json --noEmit`                                                                                                                                                                 | **PASS**, no output.                                                                                                                                                                                                                                                                        |
| `npx eslint` over every file touched                                                                                                                                                                                | **PASS**, zero errors. One pre-existing `max-lines` WARNING on `libs/shared/src/lib/types/rpc.types.ts` (3207 lines; it was already far past 700 before this task and is the contract barrel the ceiling explicitly does not target).                                                       |
| `npx prettier --write` over every file touched                                                                                                                                                                      | Applied, so the husky `nx format:write` hook has nothing to reformat at commit time.                                                                                                                                                                                                        |

**One flake worth recording, not a failure.** The FIRST `run-many` attempt (with
Nx's default parallelism) reported three failed tasks. The only real assertion
failure in the output was `CpuProfileCapture › allows a fresh capture once the
previous one settled` → `ENOTEMPTY: directory not empty, rmdir
C:\…\Temp\ptah-cpuprofile-OTQRAc` — a Windows temp-directory teardown race
between concurrently running projects, in a spec this batch does not touch. Each
of the three projects passed when re-run alone with `--skip-nx-cache`, and the
serialized `--parallel=1` run above passed all six. Worth knowing before someone
reads a red run-many as a regression from this batch.

## Open questions / handoff notes

1. **`bootstrapElectron`'s signature changed.** Any caller added later must pass
   the coordinator. There is exactly one caller today (`main.ts:67`).
2. **`BootReadiness` no longer exists as an app-local type.** It had no consumers
   outside `boot-coordinator.ts` (verified by grep); anything that wants it should
   import `BackendReadiness` from `@ptah-extension/shared`.
3. **For Batch 4.** `boot:getReadiness` takes `Record<string, never>` and the
   schema is `.strict()`, so the renderer must send `{}` or nothing — not a
   placeholder field. The pull answer and the push payload are the same object
   shape, so one consumer path handles both, and the pull is MANDATORY: the
   `did-finish-load` replay fires before Angular installs its message listener.
4. **Nothing sets `degraded`.** Today the coordinator only ever produces
   `warming`, `ready` and `failed`. The renderer must still handle `degraded`
   (it is in the wire vocabulary), but no producer emits it yet.
5. **User-defined cron jobs emit no activity**, as the plan pre-authorised. Giving
   them one needs an event surface on `CronScheduler` — recorded as a follow-up,
   not done here.
6. **`libs/frontend/**` files are dirty in this worktree** (`boot-status.service.ts`,
`back-office-activity.service.ts`, `activity-ticker/`, `boot-progress/`, …).
   Those are Batch 4's, not mine. My changes are confined to the files listed
   above.

---

## Shutdown wiring (Batch 5 logic follow-through)

Closes the whole-task logic finding ("the integrity worker is the one boot-path
resource with no shutdown entry", `code-logic-review.md:1412-1470`) and
follow-up 3 (`:1531-1534`).

**Files**

- MODIFIED `libs/backend/persistence-sqlite/src/lib/integrity/integrity-check.service.ts`
  — `dispatchIfDue(options?: { signal?: AbortSignal })`: an already-aborted
  signal logs at `debug` and returns without spawning; an abort in flight kills
  the worker, writes NO record (the abort path is distinguished from "asked and
  got no answer", which still warns) and releases the single-flight flag. New
  synchronous `dispose()` does the same through a stored `abortInFlight`
  callback — idempotent, never throws, no-op when nothing is in flight.
- MODIFIED `.../integrity-check.service.spec.ts` — call-count cases for a
  pre-aborted signal (zero spawns), abort mid-flight (one `kill`, zero records,
  flag released so the next dispatch spawns again), a late reply after an abort
  (still zero records), and `dispose()` called twice / with nothing in flight.
- MODIFIED `libs/backend/thoth-runtime/src/lib/types.ts` — `signal?: AbortSignal`
  on `StartThothCronOptions`, documented as the boot window's lifetime only.
- MODIFIED `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts` — the 60 s
  boot dispatch now calls `dispatchIfDue({ signal })` and the timer is not armed
  at all when the signal is already aborted; the `db:integrity` handler's
  `container.resolve` is wrapped in the boot timer's own try/catch shape and
  returns `{ outcome: 'skipped', reason: 'integrity-service-unavailable' }`. The
  cron dispatch deliberately does not take the boot signal (it fires at 03:30).
- MODIFIED `.../start-thoth-cron.spec.ts` — signal threaded into the boot
  dispatch, an aborted signal arms no timer and dispatches nothing (handler
  still registered), and the handler's skipped outcome on a resolve failure.
- MODIFIED `apps/ptah-electron/src/activation/boot-coordinator.ts` —
  `integrityService: { dispose: () => void } | null` on `BootRefs` and in
  `createEmptyBootRefs()`, structural so the file still imports nothing at
  runtime.
- MODIFIED `apps/ptah-electron/src/activation/boot-heavy-services.ts` — passes
  `signal` into `startThothCron`, then captures `refs.integrityService` eagerly
  (guarded by `container.isRegistered`) while the container is healthy, per the
  `cliRegistry` precedent.
- MODIFIED `apps/ptah-electron/src/activation/shutdown.ts` — one
  `nonFatal('Integrity check abort', () => refs.integrityService?.dispose())`
  in `disposeBeforePersistence`, between `UpdateManager dispose` and
  `Git watcher stop`: LIFO (captured last in the heavy boot) and before
  `SQLite close`, because a completing check writes its verdict through that
  connection. Synchronous, so `requiresDeferredDisposal` is unchanged.
- MODIFIED `apps/ptah-electron/src/main.quit-path.spec.ts` —
  `EXPECTED_LIFO_ORDER` gains `integrityService`, the fixture gains the handle,
  plus a standalone "aborts the integrity check BEFORE SQLite is closed" case
  and a null-handle case.

**Verification**

- `npx jest --config libs/backend/persistence-sqlite/jest.config.ts --rootDir libs/backend/persistence-sqlite integrity` — 4 suites, 61 tests passed.
- `npx jest --config libs/backend/thoth-runtime/jest.config.ts --rootDir libs/backend/thoth-runtime start-thoth-cron` — 1 suite, 25 tests passed.
- `npx jest --config apps/ptah-electron/jest.config.ts --rootDir apps/ptah-electron src/activation src/main` — 13 suites, 183 tests passed (`src/main` added because `main.quit-path.spec.ts` pins the disposal order and sits outside `src/activation`).
- `npx eslint` on all nine touched files — clean.
- `npx tsc -p apps/ptah-electron/tsconfig.app.json --noEmit` — clean. No `nx build` / `run-many`: a dev build was running on this machine.

**Not done**: `boot-order.spec.ts` and `wire-runtime.boot-order.spec.ts`
enumerate no `BootRefs` fields (only `boot-coordinator.spec.ts` calls
`createEmptyBootRefs`, and it asserts no field list), so neither needed a
change. The per-lib `CLAUDE.md` public-API lines for `persistence-sqlite`
(`dispatchIfDue()` → `dispatchIfDue(options?)` + `dispose()`) and
`thoth-runtime` (`startThothCron`'s `signal`) are now slightly stale — left
alone deliberately, another agent is editing those files.
