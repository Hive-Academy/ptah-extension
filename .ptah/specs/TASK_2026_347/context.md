# TASK_2026_347 — Electron boot order: persistence consumers run before SQLite open

## Evidence (D:\projects\ptah-extension\tmp\logs\log.log)

- 549 `[DEBUG] [task-specs] index rebuild write skipped — store not ready yet` — first warm from DI phase 2 (`phase-2-libraries.ts:332`), before any `openAndMigrate`.
- 555-557 `Subsystems brought up` / `Startup config registered` / `UpdateManager skipped` — `registerPostWindow` is running.
- 558 `[WARN] [gateway] voice GC failed: Persistence is offline: SQLite connection has not been initialized yet.` — `GatewayService.start()` first statement, from the fire-and-forget IIFE at `post-window.ts:141`.
- 561 `[gateway] master switch off; not starting adapters` — `lifecycle.startEnabled()` inside the same `start()`.
- 562-565 `Booting deferred backend services...` / `Resolving SQLite connection service...` / `Starting openAndMigrate...` — the post-window boot only begins here (`main.ts:152` -> `wire-runtime.ts:320` -> `boot-heavy-services.ts:146-157`).
- 575 `Migration runner created, applying migrations...`
- 576 `Messaging gateway started`, 577 `[gateway-chat-bridge] subscribed to inbound events`, 578 `Gateway chat bridge started` — gateway/bridge finish starting while migrations are in flight; `bridge.start()` runs `claimInterruptedInboundTurns()` (a write) against a database whose `this.database` is set (`sqlite-connection.service.ts:210`) but not yet migrated (`applyAll` at :224, `fireDidOpen` at :235).
- 596-599 backup, `migrations applied`, `openAndMigrate complete`.

## Root cause

Two of the three symptoms come from one defect in `apps/ptah-electron`; the third is by-design and needs no change.

**(1) Messaging gateway + chat bridge start with no persistence gate.** `post-window.ts:138-184` fires `void (async () => { await gateway.start(); ... bridge.start(); })()` immediately after `createMainWindow`, inside `registerPostWindow`. `main.ts:137-155` awaits `registerPostWindow` BEFORE it calls `coordinator.startPostWindow(wired.postWindow)`, and `wired.postWindow` (`wire-runtime.ts:320-326`) is what opens the booter gate and runs `bootThothRuntime` -> `openAndMigrate()`. So `GatewayService.start()` runs its first statement `gcOldVoiceFiles()` -> `MessageStore.listVoicePathsOlderThan` -> `SqliteConnectionService.db` getter, which throws `Persistence is offline: SQLite connection has not been initialized yet`.

`SqliteConnectionService.openAndMigrate` assigns `this.database = db` BEFORE `applyAll`, so `isOpen`/`db` report open while migrations are still running — any readiness gate must key on `openAndMigrate()` RESOLVING (or `onDidOpen`), never on `isOpen`.

There was no host-level "persistence settled" signal: `BootCoordinator` owned refs, abort, `awaitCompletion` and the warmup barrier, but nothing a post-window consumer could await.

**(2) `[task-specs] index rebuild write skipped`** is DEBUG and deliberate: `startTaskSpecsIndex` is called from DI phase 2, its first warm hits `TaskIndexService.rebuild` with `store.isReady() === false` and skips only the write; `subscribeToPersistenceOpen` re-warms on `SqliteConnectionService.onDidOpen`. Self-healing; no change required, and re-ordering the host is explicitly rejected by that lib's design note.

**(3) Secondary LIFO inconsistency:** `shutdown.ts` closed SQLite BEFORE stopping the chat bridge and the gateway. Once the gateway starts AFTER SQLite, LIFO requires bridge/gateway stop before `SQLite close`.

## Files

- `apps/ptah-electron/src/activation/boot-coordinator.ts` — persistence gate.
- `apps/ptah-electron/src/activation/boot-heavy-services.ts` — settle the gate right after `bootThothRuntime` returns (and on the aborted early-return).
- `apps/ptah-electron/src/activation/start-messaging-gateway.ts` (NEW) — extracted, Electron-free gateway/bridge start that awaits the gate.
- `apps/ptah-electron/src/activation/post-window.ts` — resolve + refs assignment stay; delegate the start.
- `apps/ptah-electron/src/activation/shutdown.ts` — bridge/gateway stop above `SQLite close`.
- Specs: `start-messaging-gateway.spec.ts` (NEW), `boot-coordinator.spec.ts`, `boot-order.spec.ts`, `wire-runtime.boot-order.spec.ts`.
- `apps/ptah-electron/CLAUDE.md`.
- NO changes in `libs/backend/messaging-gateway`, `task-specs`, `persistence-sqlite`, `thoth-runtime`, `gateway-chat-bridge`.

## Plan

1. `BootCoordinator` persistence gate: `PersistenceReadiness`, a deferred created in the field initializer, `markPersistenceSettled` (idempotent, first call wins) and `whenPersistenceSettled()`. Fallback-settle in `startPostWindow`'s `.finally` and in `abort()` so no waiter is stranded.
2. Settle the gate at the real transition in `boot-heavy-services.ts`, right after `refs.sqliteConnection = thoth.sqliteConnection`, and `{ sqliteOpen: false }` in the aborted early return.
3. Extract the gateway start into `start-messaging-gateway.ts` — no `electron` import and no `import.meta`, so it is unit-testable.
4. Wire it from `post-window.ts`.
5. LIFO shutdown fix.
6. Tests (coordinator gate, new module, boot order, source-order spec).
7. Docs in `apps/ptah-electron/CLAUDE.md`.
8. Verify with `npx nx run-many -t test -p ptah-electron` and `-t typecheck`.
9. Non-goals: no edits to `task-specs`, `persistence-sqlite`, `messaging-gateway`, `gateway-chat-bridge`; no change to `UpdateManager` timing.

## Acceptance criteria

1. In a fresh `nx serve ptah-electron` log, `[gateway] voice GC failed` does not appear, and `Messaging gateway started` / `Gateway chat bridge started` are logged after `openAndMigrate complete`.
2. `whenPersistenceSettled()` is pending until `markPersistenceSettled`, resolves with the first state passed, and is fallback-settled when `startPostWindow` finishes (success or failure) or when `abort()` runs.
3. `boot-order.spec.ts` asserts by recorded call order that `persistenceSettled` occurs after `openAndMigrate` and before `mirrorUserLayer`/`reconcileHarness`/`scanAndImport`, and that a gateway stub awaiting the gate starts after `openAndMigrate`.
4. `start-messaging-gateway.spec.ts` asserts: no `gateway.start()` before the gate; order gateway.start -> status broadcast -> bridge.start; a rejected gateway.start skips bridge.start and warns; abort before settle starts nothing; `sqliteOpen:false` still starts the gateway (degraded) and warns.
5. `wire-runtime.boot-order.spec.ts` asserts textually that `markPersistenceSettled(` sits after `await bootThothRuntime(` and before `mirrorUserLayer(`, and that `post-window.ts` delegates to `startMessagingGateway(` with no inline `await gateway.start()`.
6. `shutdown.ts` stops the chat bridge and the messaging gateway before `SQLite close`.
7. `[task-specs] index rebuild write skipped` remains DEBUG-level; no task-specs code changed.
8. No lib under `libs/backend` modified; `npx nx run-many -t test -p ptah-electron` shows `Running target test for 1 project` and passes.

## Test projects

- ptah-electron (only project touched).

## Implementation notes

### What changed

**1. `BootCoordinator` gained a persistence gate** (`apps/ptah-electron/src/activation/boot-coordinator.ts`).
`PersistenceReadiness { sqliteOpen: boolean }`, a deferred created in the FIELD
INITIALIZER (so `registerPostWindow`, which runs before `startPostWindow`, can
already await it), `markPersistenceSettled(state)` (idempotent — first call
wins) and `whenPersistenceSettled()`. Two backstops keep a waiter from being
stranded: `startPostWindow`'s `.finally` marks
`{ sqliteOpen: refs.sqliteConnection?.isOpen ?? false }`, and `abort()` marks
`{ sqliteOpen: false }`. Both are no-ops on the happy path because the real
mark has already landed.

**2. The gate opens at the real transition** (`boot-heavy-services.ts`).
One line immediately after `refs.sqliteConnection = thoth.sqliteConnection;`.
`bootThothRuntime` awaits `openAndMigrate()` to completion, so this is the first
instant at which the database is open AND migrated. The aborted early return
marks `{ sqliteOpen: false }` so a quit before the boot body runs releases the
consumers. Deliberately NOT keyed on `SqliteConnectionService.isOpen` as a
polling condition: `openAndMigrate` assigns the handle at line 210 and runs
`applyAll` at line 224, so `isOpen` is already true mid-migration — which is
exactly why the bridge's `claimInterruptedInboundTurns()` write did not throw
and instead landed on a half-migrated schema.

**3. The gateway start moved out of `post-window.ts`** into the new
`start-messaging-gateway.ts`. The module imports no Electron API and no
`import.meta`, so it is unit-testable (`post-window.ts` cannot be required under
ts-jest — `TS1343`). It awaits the gate, returns early if the boot aborted in
the meantime, warns once and still starts when `sqliteOpen` is false (a launch
with no workspace root has no database and must still be reachable from the chat
platforms), then runs the unchanged start / status-broadcast / bridge-start
sequence. `post-window.ts` keeps the DI resolve and the `refs` assignments and
now delegates; the webview manager is still resolved LAZILY, inside the
broadcast closure, so a missing registration cannot fail activation.

**4. Shutdown LIFO** (`shutdown.ts`). `Gateway chat bridge stop` and
`Messaging gateway stop` moved ABOVE `SQLite close`. Now that the gateway starts
after SQLite, LIFO requires it to stop before it — and `GatewayService.stop()`
drains outbound delivery and settles turn state through `gateway_messages`, so
the old order made that drain write into a closed connection.
`src/main.quit-path.spec.ts`'s `EXPECTED_LIFO_ORDER` was updated to match, with
the reason recorded beside it.

### Explicitly not changed

- `libs/backend/**` — nothing. `messaging-gateway`, `gateway-chat-bridge`,
  `persistence-sqlite`, `task-specs` and `thoth-runtime` stay host-agnostic; the
  gate is a host concern and lives entirely in `apps/ptah-electron`.
- `[task-specs] index rebuild write skipped — store not ready yet` (log.log:549)
  is unchanged: it is DEBUG, it skips only the write, and
  `subscribeToPersistenceOpen` re-warms on `onDidOpen`. Symptom of the same boot
  ordering, already self-healing.
- `UpdateManager` timing and the double harness reconcile are untouched.

### Tests

New: `start-messaging-gateway.spec.ts` (7 cases) — nothing starts before the
gate; the order is `gateway.start` -> status broadcast -> `bridge.start`; the
broadcast payload keeps `lastError` only where present; `sqliteOpen: false`
still starts and warns; an abort before the gate settles starts nothing; a
rejected `gateway.start` skips the bridge and the broadcast; a throwing
`bridge.start` does not reject; a null bridge still starts the gateway.

Extended:

- `boot-coordinator.spec.ts` — a `persistence gate` describe (8 cases): pending
  until marked, same promise identity, first-mark-wins, settled by a boot that
  never marks (both `false` and `true` variants), settled by a rejected boot,
  settled by `abort()`, and the backstop not overwriting an earlier mark.
- `boot-order.spec.ts` — a `persistence gate` describe (4 cases) driving the
  real booter: the gate opens after `openAndMigrate` and before
  `mirrorUserLayer` / `reconcileHarness` / `scanAndImport`, exactly once; a
  gated consumer registered in the WINDOW phase does not run until after
  `openAndMigrate`; an aborted boot releases it with `sqliteOpen: false`.
  `markPersistenceSettled` is wrapped so the recorded position is the CALL SITE,
  not where a `.then` microtask happened to land.
- `wire-runtime.boot-order.spec.ts` — source assertions: the happy-path mark
  sits after `await bootThothRuntime(` and before `mirrorUserLayer(`; there are
  exactly two mark call sites and the first is the aborted early return;
  `post-window.ts` (read as text, never imported) contains
  `startMessagingGateway({` and no longer contains `await gateway.start()`,
  `bridge.start()` or `GATEWAY_STATUS_CHANGED`.
- `main.quit-path.spec.ts` — `EXPECTED_LIFO_ORDER` updated.

A separate `shutdown.dispose-order.spec.ts` was written and then deleted: the
ordering contract is already pinned by name in `EXPECTED_LIFO_ORDER`, and two
specs asserting one list is duplication.

### Results

- `npx nx run-many -t test -p ptah-electron` — `Running target test for 1
project`. Final run: 376 passed, 4 skipped, 0 failed of 380 (31 of 32 suites,
  1 skipped). An earlier run of the same suite failed once on
  `GitWatcherService › lifecycle › switchWorkspace() to a non-git workspace
re-attaches workspace watcher (after debounce)`; that spec passes on its own
  (`--testPathPatterns=git-watcher`: 30/30) and passed on the re-run. It is a
  real-chokidar debounce test, timing-flaky under full-suite load, and touches
  nothing in this task.
- `npx nx run-many -t typecheck -p ptah-electron` — passed.
- `npx nx run-many -t lint -p ptah-electron` — passed (4 pre-existing warnings
  in `electron-adapters.ts`, `electron-browser-capabilities.ts` and
  `editor-rpc.handlers.ts`; none in files this task touched).
- Acceptance criterion 1 (a fresh `nx serve ptah-electron` log) was NOT verified:
  a live desktop launch is not available from this session. The mechanism it
  describes is covered by the ordering specs above.

### Working-tree note

Edits to `boot-order.spec.ts`, `wire-runtime.boot-order.spec.ts` and
`apps/ptah-electron/CLAUDE.md` were silently reverted on disk once mid-session by
something outside this session (other agents share this working tree). They were
re-applied and verified present. Worth re-checking those three files before
committing.

## Revision (round 2)

The judge FAILED the first round on one defect and left one acceptance criterion
unverified. Both are addressed below.

### Defect 1 — the LIFO reorder in `shutdown.ts` did not fix the race it named

The round-1 change moved `Gateway chat bridge stop` and `Messaging gateway stop`
above `SQLite close` in `disposeBootRefs`, and stopped there. That was a
STATEMENT reorder, not a happens-before:

```ts
nonFatal('Messaging gateway stop', () => {
  void refs.messagingGateway?.stop().catch(...);   // fire and forget
});
nonFatal('SQLite close', () => refs.sqliteConnection?.close()); // same tick
```

`disposeBootRefs` was fully synchronous, so `close()` ran on the same tick as the
`stop()` call — before a single one of that promise's internal awaits resolved.
`GatewayService.stop()` (`libs/backend/messaging-gateway/src/lib/gateway.service.ts:211`)
is `cancelAllReconnects()` -> `await outbound.drainAll()` -> `StreamCoalescer.drainAll()`
-> `await lifecycle.stopAdapters()`, and that drain flushes buffered adapter sends
and settles turn state THROUGH `gateway_messages`. Quit the app while a streamed
Telegram/Discord reply still has an unflushed coalescer buffer and the final write
lands on a closed handle a few microtasks later — the same defect class this task
exists to close, moved from startup to shutdown.

**Why the fix has to defer the quit.** Electron tears the process down the moment
a synchronous `will-quit` listener returns. There is no way to await anything
from inside one; the only lever is `event.preventDefault()` plus a later
`app.quit()`, which the sequence already owns as `deferQuit` / `quit` for the
in-flight-boot case. So the quit is now deferred for a SECOND reason, and
`handleWillQuit` says so:

- `requiresDeferredDisposal(refs)` — `true` when `refs.messagingGateway !== null`.
  That is the one handle in the chain whose stop writes to SQLite after an
  `await`. Everything else is synchronous or deliberately fire-and-forget (the
  agent reaper issues its kills synchronously and nothing downstream depends on
  its settle).
- With no boot in flight AND no gateway, the listener is still byte-for-byte the
  pre-change synchronous teardown. `handleWillQuit` runs the two halves inline on
  that path rather than calling the async `disposeBootRefs`, precisely so no
  `await` can slip in front of `SQLite close` on a path Electron will not wait
  for.

**The chain, now split at the persistence boundary:**

- `disposeBeforePersistence(deps)` — synchronous head, unchanged order, ending at
  `Gateway chat bridge stop` (`GatewayChatBridge.stop()` is `stop(): void`, so it
  needs no wait of its own).
- `stopMessagingGateway(gateway, budgetMs)` — `await Promise.race([stop(), deadline])`,
  bounded by `GATEWAY_STOP_BUDGET_MS = 2000`, never rejects. Same
  bounded-wait philosophy as `BOOT_DRAIN_BUDGET_MS` and
  `BootCoordinator.awaitCompletion`: a quit that hangs is a worse failure than a
  lost final delivery, so a wedged adapter socket costs two seconds, warns, and
  the close proceeds.
- `disposeAfterPersistence(deps)` — `SQLite close` first, then voice worker,
  agents, CLI registry, diagnostics LAST.
- `runDeferredDisposal` puts `deps.quit()` in a `finally`: no failure inside the
  chain may leave the app unquittable.

`main.ts` needed no change — it already delegates and already re-enters
`will-quit` behind its one-shot `quitSequenceStarted` guard.

### The spec could no longer hide it

`main.quit-path.spec.ts`'s gateway mock recorded its name as the FIRST statement
of an async function, so it pinned invocation order only and passed against
fire-and-forget. It is now `drainingGatewayStop(order)`, which awaits three
microtask turns (drainAll -> coalescer -> stopAdapters) and pushes the name LAST,
as the persistence write.

New cases:

- `disposes every handle in the pre-change order` — now async; `EXPECTED_LIFO_ORDER`
  can only come out in that order if the chain really awaited.
- `stays fully synchronous when there is nothing to await` — gateway `null` ⇒
  `handleWillQuit` returns `true`, `deferQuit`/`quit` untouched, and the order
  equals `EXPECTED_LIFO_ORDER` minus `messagingGateway`. This is the parity case
  and it also proves both paths produce one order.
- `defers the quit for the gateway stop even with no boot in flight` — returns
  `false`, head of the chain already ran, nothing past the gateway has.
- `waits for a drain that spans a real timer before closing SQLite` — the stop
  settles 50 ms later, so no number of microtask turns can smuggle the close in
  front of it.
- `closes anyway once a wedged stop exceeds its budget` — a never-settling stop;
  after `GATEWAY_STOP_BUDGET_MS` the close runs, diagnostics is still last, the
  quit is re-issued, and the warn names the budget.
- `closes anyway when the stop rejects, and does not crash the quit`.
- `names the gateway as the reason the quit must be deferred` —
  `requiresDeferredDisposal`.

**Mutation check.** With `await stopMessagingGateway(...)` changed to
`void stopMessagingGateway(...)` — i.e. exactly the round-1 behaviour — the suite
fails: 6 failed / 19 passed in `main.quit-path.spec.ts`, with
`+ "messagingGateway"` appearing after `sqliteConnection` in the diff. Restored,
it is 31/31 across `main.quit-path` + `main.metadata-flush`.

### Defect 2 — acceptance criterion 1 is now VERIFIED on a real boot

`nx serve ptah-electron` still cannot run end to end: `nx build
ptah-extension-webview --configuration=development` fails with TS2339 in
`libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:1253,1285,1317`
(`AgentProgressEvent` / `AgentStatusEvent` / `AgentCompletedEvent` have no
`agentId`). That is concurrent work by another agent in this shared tree and was
deliberately not touched.

The webview is a RENDERER build, and all three AC1 strings are MAIN-process logs,
so the check was run without it: `nx build-dev ptah-electron` (main + preload +
workers, which type-checks and bundles the changed activation code), then Electron
launched directly on `dist/apps/ptah-electron/main.mjs` with `NODE_ENV=development`
against the already-present renderer dist. Captured at
`tmp/logs/round2-boot.log` (gitignored):

```
543: [INFO] [persistence-sqlite] openAndMigrate complete: {"dbPath":"...ptah-dev.sqlite","finalVersion":41}
572: [Ptah Electron] Messaging gateway started
574: [Ptah Electron] Gateway chat bridge started
```

- `[gateway] voice GC failed` — ABSENT (baseline `log.log:558`).
- `Persistence is offline` — ABSENT anywhere in the log.
- Both gateway lines are now AFTER `openAndMigrate complete`; in the baseline the
  order was inverted (`log.log:576-578` gateway, `log.log:599` openAndMigrate).
- Apples to apples: both logs show `[gateway] master switch off; not starting
adapters`, and `gcOldVoiceFiles()` is the FIRST statement of
  `GatewayService.start()` — it ran and succeeded, it was not skipped.
- AC7 also confirmed live: `tmp/logs/round2-boot.log:518` still carries
  `[DEBUG] [task-specs] index rebuild write skipped — store not ready yet` at
  DEBUG level, and no task-specs code was touched.

Still not observed live: the SHUTDOWN ordering. The launched process was killed
from outside, so no clean `will-quit` ran. That path is covered by the specs
above, including the mutation check.

### Round-2 results

- `npx nx run-many -t test -p ptah-electron` — `Running target test for project
ptah-electron`: 31 of 32 suites passed (1 skipped), 381 passed / 4 skipped /
  0 failed of 385. Re-run with `--skip-nx-cache` after Prettier: same.
- `npx nx run-many -t typecheck -p ptah-electron` — passed.
- `npx nx run-many -t lint -p ptah-electron` — passed (the same 4 pre-existing
  warnings; none in files this task touched).
- Files changed this round: `apps/ptah-electron/src/activation/shutdown.ts`,
  `apps/ptah-electron/src/main.quit-path.spec.ts`. Nothing under `libs/backend`.
