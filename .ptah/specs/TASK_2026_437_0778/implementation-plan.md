# Implementation Plan - TASK_2026_437_0778

Keep the Electron main process (and the renderer that shares its fate) responsive while agents
run long, heavy node / git / build processes and mass file operations.

## Inputs and constraints

- Requirements used:
  `D:\projects\ptah-extension\.ptah\specs\TASK_2026_437_0778\task.md`,
  `context.md`, `research-main-loop-inventory.md`, `research-isolation-options.md`,
  `research-renderer-load.md`; root `CLAUDE.md`; module `CLAUDE.md` for `apps/ptah-electron`,
  `libs/shared`, `libs/backend/{platform-core,platform-electron,vscode-core,workspace-intelligence,agent-sdk,rpc-handlers}`,
  `libs/frontend/{core,chat,chat-state,chat-streaming,canvas,git-ui}`, `apps/ptah-extension-vscode`.
- Corrections applied (research reports checked against source; see "Corrections to the research" below).
- Design handoff used: none (no UI design change; Phase 4 is behaviour/perf only).
- Missing decision-critical input: `task-description.md` is absent. It would have fixed acceptance
  budgets; this plan states budgets itself (section "Acceptance criteria and budgets") and marks the
  choices that need the user under "Open questions".

---

## 1. Root cause of the 2026-09-14 freeze

### 1.1 Statement

One agent Bash command deleted ten full checkouts (~74k files) that live **inside** the open
workspace (`.claude-worktrees/*`, `.claude/worktrees/*`). Both workspace watchers run **on the
Electron main event loop** and neither excludes those folders, so every OS delete event became
main-thread JavaScript: the git watcher's recursive `fs.watch` callback, and chokidar's
per-directory watch handlers across every directory of all ten checkouts. Each debounce fire of the
git watcher first **deleted the in-flight `git status` entry** and then asked for a fresh one, so
status pipelines (4 git children each, each launched on a newly created worker thread) overlapped
instead of coalescing, while the machine was saturated by the delete itself. The main loop spent
33 s in repeated 265–615 ms blocks, the one status run the log shows timed out at 10 s, and at
11:46:25 the loop stopped producing log output. Because every canvas tile and session lives in the
one renderer and every RPC is served on the one main loop, all of them froze together. Nothing
recorded the end state: no crash/hang handlers exist, `crashReporter` is never started, and the log
is an async stream that needs the frozen loop to flush.

### 1.2 Confirmed (source or log, cited)

| #   | Fact                                                                                                                                                                                                                                                                                               | Evidence                                                                                                                                                                                                                                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| C1  | One Bash tool call, YOLO auto-approved, at 11:45:49.176Z; first lag window 3 s later                                                                                                                                                                                                               | log `Ptah Electron-2026-09-14.log` lines 760–762                                                                                                                                                                                                                                                        |
| C2  | 15 consecutive `[event-loop] lag` windows 11:45:52.4 → 11:46:24.995, max 265.7–615.5 ms; sampler still fired every 2.0–2.5 s (loop turning, repeatedly blocked); nothing logged after 11:46:24.995                                                                                                 | log lines 762–782; sampler is a 2 s `setInterval` on main (`libs/backend/vscode-core/src/diagnostics/event-loop-monitor.ts:150-155`)                                                                                                                                                                    |
| C3  | `[GitInfoService] getGitInfo failed ... git status timed out after 10000ms` at 11:46:10.629                                                                                                                                                                                                        | log line 769; `DEFAULT_GIT_TIMEOUT_MS` `libs/backend/vscode-core/src/utils/exec-git.ts:6`                                                                                                                                                                                                               |
| C4  | Git watcher arms a recursive `fs.watch` on the workspace root in the main process and filters AFTER the event reaches JS; the filter set has no worktree entry                                                                                                                                     | `apps/ptah-electron/src/services/git-watcher.service.ts:449-483`, predicate `:421-426`; set `libs/shared/src/lib/constants/workspace-scan.constants.ts:57-78`                                                                                                                                           |
| C5  | Every surviving event re-arms the workspace debounce (`clearTimeout`+`setTimeout`) and `change` events create one timer per path                                                                                                                                                                   | `git-watcher.service.ts:458-465`, `:606-634`, `:512-551`                                                                                                                                                                                                                                                |
| C6  | Both worktree folders are git-ignored, so `git status` can never report anything under them — every one of those events was pure waste                                                                                                                                                             | `.gitignore:58`, `:98-99`                                                                                                                                                                                                                                                                               |
| C7  | File-index watcher is chokidar `**/*` in the main process; its prune predicate is only the static glob list, which lacks the worktree folders. The `.gitignore` rules the initial walk honours are NOT applied to the watcher prune, so chokidar watches every directory of every ignored checkout | `libs/backend/workspace-intelligence/src/file-indexing/workspace-file-index.service.ts:630-664`; `workspace-default-excludes.ts:1-26`; `libs/backend/platform-electron/src/implementations/electron-file-system-provider.ts:151-161`; `libs/backend/platform-core/src/utils/glob-watch-plan.ts:134-145` |
| C8  | `fetchAndPush` calls `invalidateReadCache` then `getGitInfo`; invalidation deletes the `info                                                                                                                                                                                                       | <root>                                                                                                                                                                                                                                                                                                  | `in-flight entry that`coalesce` would have joined | `git-watcher.service.ts:667,671`; `libs/backend/vscode-core/src/services/git-info.service.ts:326-328`, `:335-346`, `:363-367` |
| C9  | One status pipeline = `rev-parse` → `status --untracked-files=all` → two parallel `diff --numstat` (+ a full `readFile` per untracked file, sequential)                                                                                                                                            | `git-info.service.ts:2324-2330`, `:380-383`, `:399-412`, `:2395-2422`                                                                                                                                                                                                                                   |
| C10 | In Electron each git child is launched through `OffThreadProcessSpawner`, which constructs a **new eval'd `Worker` per spawn**; no pool, no cap                                                                                                                                                    | `apps/ptah-electron/src/di/phase-4-handlers.ts:110-116`; `git-info.service.ts:2377-2380`; `exec-git.ts:162-168`; `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.ts:294`, `:594`                                                                                                     |
| C11 | A timed-out git call rejects immediately while its child may still be alive (SIGTERM + async taskkill), so the next pipeline starts beside the dying one                                                                                                                                           | `exec-git.ts:258-269`                                                                                                                                                                                                                                                                                   |
| C12 | No `render-process-gone`, `child-process-gone`, `unresponsive` or `console-message` handler; no `crashReporter` anywhere                                                                                                                                                                           | grep of `apps/ptah-electron/src` and `apps,libs/**/*.ts` (0 hits); handler anchors that DO exist: `apps/ptah-electron/src/windows/main-window.ts:71,145`, `apps/ptah-electron/src/main.ts:166,274,280,306,317`                                                                                          |
| C13 | The log sink is an async `fs.WriteStream` written from the main loop — lines queued during a hard block are lost if the process dies                                                                                                                                                               | `libs/backend/platform-electron/src/implementations/electron-output-channel.ts:33-38`, `:77-79`                                                                                                                                                                                                         |
| C14 | Windows Application event log holds **no** events 11:40–12:00Z (no WER crash 1000, no hang 1002)                                                                                                                                                                                                   | `Get-WinEvent` query run during this planning session                                                                                                                                                                                                                                                   |
| C15 | Every RPC and every push is served by the main loop; all tiles share one renderer                                                                                                                                                                                                                  | `apps/ptah-electron/src/ipc/ipc-bridge.ts:155-170`, `:288`; single `BrowserWindow` factory `main-window.ts:95-131`                                                                                                                                                                                      |

### 1.3 Inferred (not separated experimentally)

- **I1 — what exactly filled each 265–615 ms block.** Candidates, all on main: `fs.watch` callback
  bursts (libuv drains a whole `ReadDirectoryChangesW` buffer in one turn), chokidar's per-directory
  unlink/close handling across thousands of watched directories, worker-thread creation for the
  overlapping 4-spawn pipelines, and GC of the resulting garbage. The regression test in
  Phase 1 separates them (exclude-only vs coalescing-only runs).
- **I2 — the end state after 11:46:25.** Either the loop blocked outright or the process was
  terminated. C13 means a total block leaves no log; C14 (no hang event) plus the 8-minute gap to
  relaunch point to a user force-close of a hung process, but that is not provable from the data.
  `context.md`'s "no Crashpad dump" is **not** evidence of "no crash": `crashReporter` is never
  started (C12), so no dump could have been written.
- **I3 — the 8 leftover `.claude-worktrees/*` folders holding a `node_modules` junction.** Two
  hypotheses: git's recursive delete refusing the junction, or chokidar's per-directory Windows
  handles keeping directories delete-pending during `git worktree remove`. Unverified; Phase 1's
  exclude removes the second cause regardless.
- **I4 — per-path content-change timers.** They are created only for `eventType === 'change'`
  (`git-watcher.service.ts:463`); a delete arrives as `rename`. Timers therefore scale with
  parent-directory `change` notifications Windows emits during a tree delete, not with deleted files.

### 1.4 Corrections to the research

| Report claim                                                                 | Source says                                                                                                                                                                                                                                            | Consequence                                                           |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Inventory: "every watcher event can spawn its own `git status`", "unbounded" | Fires are rate-bounded by the debounce/max-wait ceilings (`git-watcher.service.ts:136,146,582-595,623-633`): at most one forced fire per 2 s (git-ops) and per 8 s (workspace). Overlap comes from each pipeline outliving that cadence (C8, C9, C11). | Fix is single-flight + trailing rerun, not "throttle harder"          |
| Inventory: "tens of thousands of live timers" on a delete storm              | Only `change` events create them (I4)                                                                                                                                                                                                                  | Still replaced (one timer), but not the primary suspect               |
| Inventory: autocomplete folder watchers "Medium, no excludes"                | Patterns are `.claude/agents/*.md` and `.claude/commands/**/*.md` (`agent-discovery.service.ts:342-346`, `command-discovery.service.ts:355-359`); `planGlobWatch` prunes every other branch (`glob-watch-plan.ts:143-145`)                             | Low; out of scope                                                     |
| Inventory: `editor:detectTargets` "High" main-loop cost                      | It is an `await`-chained async `stat` walk (`libs/backend/platform-core/src/utils/editor-launcher-detection.ts:163-235`) — slow under loop/threadpool contention, not a blocker                                                                        | Moved to Phase 3 boot deferral, not Phase 2 isolation                 |
| Isolation: "`execGit` spawns inline via cross-spawn on main"                 | Electron passes the off-thread spawner (C10)                                                                                                                                                                                                           | The real cost is worker-per-spawn churn, not `CreateProcessW` on main |
| Isolation: "`WATCH_IGNORED_DIRS` is the one set both watchers use"           | File index uses `DEFAULT_WORKSPACE_EXCLUDES` (C7)                                                                                                                                                                                                      | Single source of truth must feed BOTH lists                           |
| Isolation: `@parcel/watcher` ignore accepts RegExp (v2.6.0)                  | Installed 2.5.6 (`npm ls`: transitive via `sass`) accepts path or glob strings only (`node_modules/@parcel/watcher/index.d.ts` `Options.ignore`)                                                                                                       | Plan uses globs/paths only                                            |
| Context: "no Crashpad dump"                                                  | `crashReporter` never started (C12)                                                                                                                                                                                                                    | Absence of a dump proves nothing                                      |

---

## 2. Invariants the app holds afterwards

Each invariant names the phase that establishes it and how it is enforced.

| ID     | Invariant                                                                                                                                                                                                                                                                          | Phase                                                        | Enforcement                                                                                                                                                                                                                                                                              |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INV-1  | **No per-file-system-event JavaScript work on the Electron main thread.** Main receives file-system changes only as coalesced batches (≤ 4 per second per subscriber, ≤ 500 paths each, or an `overflow` marker).                                                                  | P1 (bounded in-process), P2 (fully)                          | P2: ESLint `no-restricted-syntax`/`no-restricted-imports` forbidding `fs.watch(…{recursive:true})` and `chokidar` imports outside `libs/backend/platform-{electron,cli}` adapters and the watch-host module; unit test on the port adapter asserting batch cadence; stress test (INV-B1) |
| INV-2  | **Nested repositories and agent worktrees under a workspace are never watched.** One shared rule set feeds every watcher; registered worktrees and nested `.git` roots discovered at runtime are added.                                                                            | P1 (static + git-watcher dynamic), P2 (all watchers, native) | Table test in `workspace-scan.constants.spec.ts` over both the segment predicate and the derived globs; drift test asserting `DEFAULT_WORKSPACE_EXCLUDES` ⊇ the shared nested rules                                                                                                      |
| INV-3  | **At most one `git status` pipeline per workspace is alive, plus at most one queued trailing run.** An invalidation never starts a parallel run; a timed-out run's slot is held until its children exit.                                                                           | P1 (single-flight), P2 (process gate)                        | Unit tests with a controllable fake spawner counting concurrent `status` children; runtime gate in `GitInfoService`                                                                                                                                                                      |
| INV-4  | **Git output ingestion on main is bounded** (byte cap per call; untracked numstat capped by count and file size).                                                                                                                                                                  | P2                                                           | Unit tests: oversized stdout rejects with a typed error and kills the child; untracked cap respected                                                                                                                                                                                     |
| INV-5  | **Every high-frequency push to the renderer is coalesced at the source.** `file:content-changed` carries a path batch; `git:status-update` stays ≤ 1 per 2 s under churn.                                                                                                          | P1                                                           | Unit test on `GitWatcherService` broadcast count under synthetic storm; contract test on the payload type                                                                                                                                                                                |
| INV-6  | **An event storm degrades to "one rescan later", never to per-event work.** Above a rate threshold a watcher stops per-event processing and schedules one refresh after quiet.                                                                                                     | P1 (in-process), P2 (inside the watch host)                  | Unit tests on the pure `EventStormBreaker` with an injected clock; stress test                                                                                                                                                                                                           |
| INV-7  | **Background work yields.** Background LLM lanes, the symbol indexer, non-activation harness reconciles, backups and index rebuilds do not start a unit while a foreground turn is generating or while measured lag is above threshold (with hysteresis and a starvation ceiling). | P3                                                           | Unit tests on the governor state machine; gate admission tests in `internal-query.service.spec.ts`                                                                                                                                                                                       |
| INV-8  | **Every process death and every hang leaves a durable record** — renderer gone, utility/child process gone, window unresponsive/responsive, renderer console errors, and a main-loop block ≥ 5 s written by a thread that does not need the main loop.                             | P1                                                           | Unit tests on the handler module with fake emitters; watchdog test blocking a worker's "main" synchronously and asserting the hang line lands                                                                                                                                            |
| INV-9  | **Tile open is bounded work on the renderer**: history replay yields between chunks, finalization is O(events + messages), `chat:resume` carries no duplicate transcript.                                                                                                          | P4                                                           | Mechanism tests (visit counts, chunk yields); perf spec behind `PTAH_PERF_SPECS=1`                                                                                                                                                                                                       |
| INV-10 | **A renderer save failure never repeats full serialization on every tick.**                                                                                                                                                                                                        | P4                                                           | Unit test: quota error → back-off, no second `JSON.stringify` inside the back-off window                                                                                                                                                                                                 |
| INV-11 | **A burst of inbound messages after a main stall costs the renderer one change-detection pass per drained burst, not one per message.**                                                                                                                                            | P4                                                           | Unit test on `MessageRouterService` with N queued messages asserting one zone re-entry                                                                                                                                                                                                   |

---

## 3. Phase overview

| Phase                         | Goal                                                                                                                                      | Directly prevents a repeat of 09-14?                                                                                                       | Ships alone?   |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| **P1 — Immediate protection** | Exclude worktrees/nested repos everywhere, single-flight git status, coalesce pushes, storm breaker, crash/hang records                   | **Yes** — removes the trigger (C4–C8) and bounds any unlisted storm (INV-6); makes the next incident diagnosable (INV-8)                   | Yes            |
| **P2 — Structural isolation** | Move recursive workspace watching into a supervised out-of-main host; supervise git processes; bound spawn workers; attribute SQLite cost | **Yes, for the general class** — an unlisted high-churn folder (build output, nested `npm install`) degrades a helper process, not the app | Yes (after P1) |
| **P3 — Load shedding**        | Background work yields to foreground turns and measured lag; network back-off                                                             | Indirectly (reduces compounding load; boot lag 0.3–4 s)                                                                                    | Yes            |
| **P4 — Renderer resilience**  | Bounded tile open, chunked replay, O(E+M) finalization, quota back-off, inbound burst coalescing                                          | Indirectly (the "3 tiles opened" crash path)                                                                                               | Yes            |

---

## Codebase evidence

| Evidence                                                                                                                                                                                                                                          | Location                                                                                                                                                                                                                                                     | Architectural implication                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Watcher exclude set is zero-dependency, segment-matched, and compiled into VS Code, Electron and CLI                                                                                                                                              | `libs/shared/src/lib/constants/workspace-scan.constants.ts:27-30,57-111`                                                                                                                                                                                     | The nested-worktree rule set belongs here; it needs a multi-segment rule because `.claude` itself must stay watched (tracked `.claude/commands`, `.claude/skills`) |
| Worktree directory literal is duplicated                                                                                                                                                                                                          | `libs/backend/vscode-core/src/utils/worktree-path.ts:4`; `libs/backend/agent-sdk/src/lib/helpers/worktree-hook-handler.ts:85-89`                                                                                                                             | Promote to one shared constant                                                                                                                                     |
| `platform-core` imports nothing from `@ptah-extension/*`                                                                                                                                                                                          | `libs/backend/platform-core/CLAUDE.md` Cross-Lib Rules                                                                                                                                                                                                       | A new watcher port must take exclusion rules as a parameter; policy stays in `shared`                                                                              |
| `IFileSystemProvider.createFileWatcher` is a per-event contract used by scoped watchers (specs, autocomplete) and the recursive file index                                                                                                        | `libs/backend/platform-core/src/interfaces/file-system-provider.interface.ts:136-139`; `libs/backend/task-specs/src/lib/task-index.service.ts:434`; `workspace-folder-watchers.ts:74`; `workspace-file-index.service.ts:635`                                 | Per-event delivery is the defect only for the recursive case; scoped watchers keep the existing port                                                               |
| utilityProcess fork shim + three workers; transport auto-detect lets the same entry run as utilityProcess or `worker_threads`                                                                                                                     | `apps/ptah-electron/src/services/platform/electron-utility-worker-process.ts:21-61`; `electron-integrity-worker-factory.ts:22-31`; `libs/backend/persistence-sqlite/src/lib/integrity/integrity-worker.ts:65,77-88,114`                                      | Watch host follows this exact shape; tests run it as a worker thread                                                                                               |
| Every ESM worker bundle is pinned by a gate spec and three `dependsOn` lists                                                                                                                                                                      | `apps/ptah-electron/src/config/esm-bundle-gate.spec.ts:153-159`; `apps/ptah-electron/project.json:160-186,236-242,388-392`; app `CLAUDE.md` Build & Run                                                                                                      | New `build-workspace-watch-host` target must be added in all four places                                                                                           |
| Native modules are unpacked from asar explicitly                                                                                                                                                                                                  | `apps/ptah-electron/electron-builder.yml:52+` (`asarUnpack`)                                                                                                                                                                                                 | `@parcel/watcher` + its platform package need entries                                                                                                              |
| `@parcel/watcher` 2.5.6: N-API (`binary.napi_versions: [3]`, prebuilt `optionalDependencies` per platform) → no Electron ABI rebuild; ignore applied natively on Windows; native debounce 50/500 ms; buffer overflow surfaces as a callback error | `node_modules/@parcel/watcher/package.json`; `src/windows/WindowsBackend.cc:40,177,219`; `src/Debounce.hh:9-10`                                                                                                                                              | Engine choice for the host; overflow maps to the port's `overflow` flag                                                                                            |
| chokidar 5 has no recursive mode: one `fs.watch` per directory, JS-side walk                                                                                                                                                                      | `electron-file-system-provider.ts:137-161`; `workspace-file-index.service.ts:620-629`                                                                                                                                                                        | Rejected for recursive workspace watching                                                                                                                          |
| `GitInfoService` read caches use generation + identity-delete idioms                                                                                                                                                                              | `git-info.service.ts:286-361`                                                                                                                                                                                                                                | Single-flight/trailing rerun extends the same map, replacing `coalesce` in place                                                                                   |
| `exec-git` already threads an optional spawner and a tree kill                                                                                                                                                                                    | `exec-git.ts:86-115,156-227`                                                                                                                                                                                                                                 | Process gate and output cap live in `exec-git`/`GitInfoService`, not in callers                                                                                    |
| Background LLM work funnels through one gate with named lanes                                                                                                                                                                                     | `libs/backend/agent-sdk/src/lib/internal-query/internal-query.service.ts:167-260`; agent-sdk `CLAUDE.md` (lanes `memory-curator`, `skill-synthesis`)                                                                                                         | Governor check belongs in gate admission for background lanes                                                                                                      |
| Turn phase has one backend source of truth                                                                                                                                                                                                        | `libs/backend/agent-sdk/src/lib/helpers/session-turn-state.registry.ts` (`SessionTurnStateRegistry`), token `libs/backend/agent-sdk/src/lib/di/tokens.ts:147`                                                                                                | Foreground-busy signal derives from it; vscode-core cannot import agent-sdk, so the governor takes a structural source                                             |
| Lag monitor notifies only on breach                                                                                                                                                                                                               | `event-loop-monitor.ts:122-127,189-207`; registered `libs/backend/vscode-core/src/di/register-platform-agnostic.ts:98`                                                                                                                                       | Governor needs every sample (hysteresis) → add a sample subscription                                                                                               |
| Diagnostics are armed once per host                                                                                                                                                                                                               | `libs/backend/vscode-core/src/diagnostics/arm-diagnostics.ts:60-108`; `apps/ptah-electron/src/activation/wire-runtime.ts:305`                                                                                                                                | Watchdog joins `armDiagnostics`                                                                                                                                    |
| Eval'd `worker_threads` source precedent for pure-JS off-thread work                                                                                                                                                                              | workspace-intelligence `CLAUDE.md` "Type-check worker" (`ts-diagnostics-worker-source.ts`, `eval: true`)                                                                                                                                                     | Main-loop watchdog uses the same pattern, no build target                                                                                                          |
| Electron 40.10.1 exposes the needed events                                                                                                                                                                                                        | `node_modules/electron/electron.d.ts:278` (app `child-process-gone`), `:673` (app `render-process-gone`), `:5056` (BrowserWindow `unresponsive`), `:15622` (WebContents `console-message` with details object), `:16879` (WebContents `render-process-gone`) | Observability contract verified against typings                                                                                                                    |
| Stream pushes are batched; other pushes go one `webContents.send` each                                                                                                                                                                            | `ipc-bridge.ts:57-66,155-170,241-276`                                                                                                                                                                                                                        | `file:content-changed` must be coalesced at the source, not in the bridge                                                                                          |
| `file:content-changed` payload and its single consumer                                                                                                                                                                                            | `libs/shared/src/lib/types/messages/payload-map.ts:133-137`; `message-constants.ts:272`; `libs/frontend/git-ui/src/lib/services/diff-tabs.service.ts:169,184,366-382`                                                                                        | Replace the payload in place (one producer, one consumer, same release)                                                                                            |
| Renderer message listener runs every message as its own zone task                                                                                                                                                                                 | `libs/frontend/core/src/lib/services/message-router.service.ts:53-86`; webview shell is Zone-based (root `CLAUDE.md`)                                                                                                                                        | Coalesce inbound delivery in the router                                                                                                                            |
| Tile open: synchronous replay then O(M×E) finalization                                                                                                                                                                                            | `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:764-779`; `libs/frontend/chat-streaming/src/lib/message-finalization.service.ts:303-306,316-321`                                                                                   | Chunked replay + one indexing pass                                                                                                                                 |
| `messages` in `ChatResumeResult` is `@deprecated`, still computed and shipped; renderer reads it only when `events` is empty                                                                                                                      | `libs/shared/src/lib/types/rpc/rpc-chat.types.ts:233-252`; `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:876-883`; `session-loader.service.ts:781-793`                                                                             | Delete the field and its fallback branch                                                                                                                           |
| Tab save retries full stringify after a quota failure                                                                                                                                                                                             | `libs/frontend/chat-state/src/lib/tab-manager.service.ts:2356-2380` (`_lastPersisted` set only on success)                                                                                                                                                   | Add a failure back-off state                                                                                                                                       |
| SQLite handle is produced by an injectable factory                                                                                                                                                                                                | `libs/backend/persistence-sqlite/src/lib/sqlite-connection.service.ts` (`SqliteDatabaseFactory`, `configure({ factory })`, `defaultBetterSqlite3Factory`)                                                                                                    | Slow-statement attribution wraps the factory; no consumer change                                                                                                   |
| Host DI manifests pin resolvable/absent tokens                                                                                                                                                                                                    | `apps/ptah-electron/src/di/expected-resolvable.ts`; `apps/ptah-extension-vscode/src/di/expected-absent.ts:34-67`; `libs/backend/cli-engine/src/lib/rpc/expected-absent.ts`                                                                                   | New tokens must be added to the resolvable manifests of all three hosts                                                                                            |
| Perf specs with absolute ms budgets are gated behind `PTAH_PERF_SPECS=1`; CI asserts mechanism                                                                                                                                                    | agent-sdk `CLAUDE.md` (`off-thread-process-spawner.perf.spec.ts`)                                                                                                                                                                                            | Stress tests follow this split                                                                                                                                     |

---

## Architecture decision

- **Chosen approach.** Two layers. (1) Remove the incident's trigger and bound its amplifiers in
  place (P1): one exclusion policy in `shared` feeding both watchers, a pure storm breaker, source
  coalescing of pushes, single-flight git status, and durable crash/hang records. (2) Make the
  class structural (P2): a new `IWorkspaceWatcher` port whose contract is _batched, pre-filtered,
  overflow-signalling_; the Electron adapter runs `@parcel/watcher` in a supervised
  `utilityProcess`, the CLI adapter runs the same host module in a `child_process.fork` child (corrected in Batch 8; see C9), the
  VS Code adapter wraps VS Code's own (already out-of-process) watcher. Git processes get a gate,
  output caps and hold-until-exit timeouts; spawn workers are reused and bounded. P3 adds a
  background-work governor; P4 bounds renderer work on tile open and after a stall.
- **Rationale.** User goal 1 is met by P1 alone: the exact trigger is excluded, and any other storm
  collapses to "one rescan". User goal 2 ("long heavy processes must not affect the app") needs
  failure containment, which only an out-of-main host gives: the event volume of an unlisted
  churn source then costs a helper process, and main receives ≤ 4 small batches per second.
  The repo already ships the host pattern three times (C-evidence: utility worker shim + transport
  auto-detect) and VS Code uses the same design for its own watcher.
- **Rejected alternatives.**
  - _Exclude-list fix only._ Closes 09-14 but the next unlisted folder (a nested `dist`, a
    `node_modules` install under a non-excluded path, a Docker volume mount) reproduces the class.
  - _Keep `fs.watch`/chokidar in main, add a breaker._ Bounds JS per event but still runs one
    callback per OS event on main; cannot meet INV-1.
  - _Swap to `@parcel/watcher` in-process on main._ Native ignore + native debounce remove most JS
    cost, but a native abort in the watcher kills the app and its callback still runs on main.
  - _`worker_threads` host in Electron._ Isolates the loop but not crashes (a native addon fault is
    process-fatal) and gives no `child-process-gone` supervision. (Originally chosen for the CLI;
    Batch 8 proved `@parcel/watcher` cannot load again in a second Worker, so the CLI uses
    `child_process.fork`.)
  - _Change `IFileSystemProvider.createFileWatcher` to batches in place._ Forces three scoped,
    low-volume consumers (specs, agents, commands) through batch semantics they do not need; the
    recursive workspace feed is a different responsibility with a different contract (overflow,
    rescan). A separate port is not a parallel copy: after P2 no caller uses `createFileWatcher`
    recursively, and an ESLint rule keeps it that way.
  - _Move all better-sqlite3 traffic to a worker now._ Every store uses the synchronous API; the
    inventory has no measured attribution of lag to SQLite. P2 ships attribution first; a move is
    a follow-up decision (open question Q4).
  - _`git status --untracked-files=no` / `core.fsmonitor` / writing the user's git config._ UX and
    footprint decisions outside this task; recorded, not adopted.
- **Assumptions** (each with its resolving check):
  - A1: `@parcel/watcher`'s subscription survives the "Buffer overflow" error (WindowsBackend
    `ERROR_NOTIFY_ENUM_DIR`). Check: host integration test deleting 75k files under a
    non-excluded path; if the subscription dies, the host re-subscribes on every error (design
    already requires this).
  - A2: `@parcel/watcher` native binary loads inside an Electron `utilityProcess` from
    `app.asar.unpacked`. Check: `nx package ptah-electron` + launch smoke; extend
    `verify-packed-native.js` to require the module from the packed tree.
  - A3: The CLI package can take `@parcel/watcher` as a runtime dependency (prebuilt optional
    packages). Check: `apps/ptah-cli` externals / `validate-deps`; if refused, the CLI adapter keeps
    chokidar inside its worker (contract unchanged) — see Q3.
  - A4: The memory-curator "Codex proxy" retry loop seen during the outage lives in the curator
    LLM adapter / `CuratorJobQueue`. Check: grep the 2026-09-14 log for the failing line and trace
    its logger tag before implementing C-14b.
  - A5: No consumer outside `session-loader.service.ts` reads `ChatResumeResult.messages`
    (CLI/TUI included). Check: `ptah_lsp_references` on the field before deletion.
- **Effect on existing code.** Replaced: the git watcher's recursive `fs.watch` path and per-file
  timer map (P1 in place, then P2 onto the port); `GitInfoService.coalesce`'s delete-on-invalidate
  semantics; `FileContentChangedPayload`; the file index's recursive `createFileWatcher` call;
  per-spawn worker creation; `ChatResumeResult.messages`; `finalizeSessionHistory`'s scans; the
  router's per-message dispatch. Left alone: scoped `createFileWatcher` users, `.git/HEAD|index|refs`
  dedicated watchers, the stream-batching IPC path, the integrity/embedder/voice workers.

---

## Component specifications

Phase tags: **[P1]** … **[P4]**. "Prevents repeat" marks components that alone would have stopped
09-14.

### 1. Workspace exclusion policy — [P1] prevents repeat

- Purpose: one definition of "never watch this subtree", including nested repositories.
- Responsibilities:
  - `AGENT_WORKTREE_DIR` (`'.claude-worktrees'`) as the single literal; `worktree-path.ts:4` and
    `worktree-hook-handler.ts:85-89` import it.
  - `NESTED_WORKSPACE_PATH_RULES`: ordered segment sequences matched at any depth —
    `['.claude-worktrees']`, `['.claude', 'worktrees']`. `.claude` alone is NOT excluded.
  - `isExcludedWorkspacePath` gains multi-segment matching (same split, consecutive-segment test),
    keeping today's single-segment behaviour for `WATCH_IGNORED_DIRS`.
  - `toWorkspaceExcludeGlobs(rules)` derives `**/.claude-worktrees/**`, `**/.claude/worktrees/**` for
    glob consumers; `DEFAULT_WORKSPACE_EXCLUDES` spreads it (replaces hand-listing).
  - `NestedRepoRoots` (pure value type): a set of workspace-relative roots with O(depth) prefix
    lookup, built from `parseWorktreeList` output (`libs/shared` utils, used by
    `git-info.service.ts:465`) filtered to paths under the workspace, plus roots added at runtime.
- Verified contracts: `WATCH_IGNORED_DIRS`/`isExcludedWorkspacePath` `workspace-scan.constants.ts:57-111`;
  `DEFAULT_WORKSPACE_EXCLUDES` `workspace-default-excludes.ts:1-26`; `parseWorktreeList` exported from
  shared (`libs/shared/CLAUDE.md` utilities; consumed `git-info.service.ts:23,465`).
- Dependencies: none (shared stays zero-dep, no `path`/`fs`).
- Integration points: git watcher (C3), file index (C2/C10), watch host (C8), worktree path resolvers.
- Failure behaviour: pure; an over-broad rule only suppresses refreshes (documented cost in the
  module header). Rules require the evidence bar the header states: "can never hold tracked source".
- Quality: predicate O(segments × rules); no allocation beyond the existing split.
- Verification seam: extend `libs/shared/src/lib/constants/workspace-scan.constants.spec.ts` (table:
  `.claude/worktrees/x/a.ts` excluded, `.claude/commands/x.md` not, nested
  `pkg/.claude-worktrees/y` excluded, Windows separators); drift spec in workspace-intelligence
  asserting the derived globs are present in `DEFAULT_WORKSPACE_EXCLUDES`; `git check-ignore -v`
  evidence recorded in the header as the module already does for `.angular`.
- Files: MODIFY `libs/shared/src/lib/constants/workspace-scan.constants.ts`,
  `libs/shared/src/lib/constants/workspace-scan.constants.spec.ts`, `libs/shared/src/index.ts` (export);
  CREATE `libs/shared/src/lib/utils/nested-repo-roots.ts` (+ `.spec.ts`), MODIFY
  `libs/shared/src/lib/utils/index.ts`; MODIFY
  `libs/backend/workspace-intelligence/src/file-indexing/workspace-default-excludes.ts`,
  `libs/backend/vscode-core/src/utils/worktree-path.ts`,
  `libs/backend/agent-sdk/src/lib/helpers/worktree-hook-handler.ts`.

### 2. `EventStormBreaker` — [P1]

- Purpose: turn an unbounded event rate into "stop per-event work, one refresh after quiet".
- Responsibilities: pure state machine with injected `now`; `record(now) → 'normal' | 'entered' |
'storming'`; `poll(now) → 'storming' | 'exited'`; configurable `enterEventsPerWindow`
  (default 500 per 1 000 ms), `quietMs` (default 2 000), `maxStormMs` (default 30 000 — forces one
  refresh even if the storm never ends, then re-arms). Exposes counters for the log line.
- Verified contracts: none existing (new); placement follows `libs/shared` "pure utilities" rule
  (`libs/shared/CLAUDE.md` Guidelines 3).
- Dependencies: none; callers own timers.
- Integration: C3 git watcher, C10 file index (P1), C8 watch host (P2, same class).
- Failure behaviour: cannot throw on valid numbers; invalid config clamps to defaults.
- Quality: `record` O(1), no allocation.
- Verification seam: `event-storm-breaker.spec.ts` with a fake clock (enter, sustain, exit after
  quiet, forced refresh at `maxStormMs`, re-entry).
- Files: CREATE `libs/shared/src/lib/utils/event-storm-breaker.ts` (+ `.spec.ts`); MODIFY
  `libs/shared/src/lib/utils/index.ts`.

### 3. `GitWatcherService` hardening — [P1] prevents repeat

- Purpose: bounded main-thread cost for workspace changes in the Electron host.
- Responsibilities:
  - Root filter consults `isExcludedWorkspacePath` with `WATCH_IGNORED_DIRS` + nested rules, then
    `NestedRepoRoots`. Nested-root detection runs **before** the `.git` segment filter: an event
    whose last segment is `.git` at depth > 1 adds its parent to `NestedRepoRoots`.
  - `NestedRepoRoots` seeded at `start()` from `GitInfoService.getWorktrees` (async, not awaited by
    `start`), refreshed when a `.git/worktrees` directory watch fires (non-recursive, same
    `watchDirectory` helper `:383-410`).
  - Per-event path: breaker `record` → if storming, set a dirty flag and return (no timer touch, no
    path accumulation). Normal: `scheduleUpdate` as today plus content-change accumulation.
  - Content changes: the per-path timer map `:68-71,115,512-551` is replaced by one pending
    `Set<string>` capped at 256 paths (overflow sets `truncated`), one 500 ms debounce, 2 000 ms
    max-wait — same constants, one timer.
  - `fetchAndPush` calls `GitInfoService.refreshGitInfo(root)` (C4); it no longer calls
    `invalidateReadCache` itself.
  - One `warn` line on storm entry and one on exit (`[GitWatcher] event storm`, counts, duration).
- Verified contracts: `start/stop/switchWorkspace` `:176-346`; broadcast signature `:176-179`;
  construction `apps/ptah-electron/src/activation/boot-heavy-services.ts:380-408`.
- Dependencies: `GitInfoService` (vscode-core, existing edge), shared constants (existing edge).
- Integration: broadcasts `GIT_STATUS_UPDATE` (unchanged payload) and the new batched
  `FILE_CONTENT_CHANGED` (C5).
- Failure behaviour: `getWorktrees` failure → keep static rules only, `warn` once (existing
  degradation-audit style). Breaker never drops the final refresh: exit or `maxStormMs` always
  issues exactly one `fetchAndPush` and one truncated content-change push.
- Quality: per OS event ≤ 1 predicate + 1 counter increment + at most 1 timer re-arm; 0 allocations
  while storming.
- Verification seam: `apps/ptah-electron/src/services/git-watcher.service.spec.ts` drives
  `isIgnoredWorkspaceEvent` and the scheduler with fake timers: 10 000 synthetic events under
  `.claude-worktrees` → 0 schedules, 0 broadcasts; 10 000 under `src/` in 1 s → storm entered,
  exactly 1 `refreshGitInfo` and 1 content push after quiet; `.claude/commands/x.md` still
  schedules. Stress test ST-1 (see "Tests").
- Files: MODIFY `apps/ptah-electron/src/services/git-watcher.service.ts`,
  `apps/ptah-electron/src/services/git-watcher.service.spec.ts`.

### 4. `GitInfoService` single-flight with trailing rerun — [P1] prevents repeat

- Purpose: at most one computation per read key, and an invalidation joins the next run instead of
  racing the current one (INV-3).
- Responsibilities:
  - Replace `coalesce` (`git-info.service.ts:335-346`) with a per-key flight record
    `{ running, startedAtGeneration, trailing? }`. A caller arriving while `running` started under
    the CURRENT generation joins it; a caller arriving after an invalidation gets the single
    `trailing` promise, which starts when `running` settles. Never two runs per key.
  - `invalidateReadCache` (`:314-329`) bumps the generation and drops settled `readCache` entries
    only; it no longer deletes `inFlight` entries.
  - New public `refreshGitInfo(workspacePath)`: invalidates the ref caches for that root and returns
    the status of a run that started after the call (joins `trailing` or starts one). `getGitInfo`
    keeps "join whatever is running" semantics for RPC reads.
  - `cachedRead` (`:349-361`) keeps its generation-checked write-back on top of the new flight map.
- Verified contracts: `execGit` wrapper invalidation `:2349-2367` (mutating commands still call
  `invalidateReadCache`); callers `GitRpcHandlers` (phase-4 `:117`), git watcher `:667-671`.
- Dependencies: none new.
- Integration: C3 uses `refreshGitInfo`; RPC callers unchanged.
- Failure behaviour: a rejected/timeout run settles its waiters with the rejection (today's
  `computeGitInfo` already maps errors to an empty result `:415-433`); a queued trailing run still
  starts after a rejection. Timeout does not free the key early (C11 closed in C11-gate, P2; in P1
  the run's promise settles on timeout but the trailing run waits for the flight record to clear,
  which happens on settle — acceptable until P2 holds the slot to child exit).
- Quality: map operations O(1); no timers.
- Verification seam: `libs/backend/vscode-core/src/services/git-info.service.spec.ts` with a fake
  spawner exposing live-child count: invalidate during run → second caller waits, exactly 2
  `status` spawns total for 5 invalidate+refresh calls during one run; concurrent `status` children
  never exceeds 1.
- Files: MODIFY `libs/backend/vscode-core/src/services/git-info.service.ts`,
  `libs/backend/vscode-core/src/services/git-info.service.spec.ts`.

### 5. Batched `file:content-changed` push — [P1]

- Purpose: one push per coalesced window, one renderer revalidation per push (INV-5).
- Responsibilities: replace `FileContentChangedPayload { filePath }` with
  `{ filePaths: readonly string[]; truncated: boolean }` (forward-slash absolute paths). Renderer
  `DiffTabsService` builds a key set once per push and refreshes matching tabs; `truncated` →
  revalidate all open file views and worktree diffs through the existing debounced path
  (`onGitStatusUpdate` debounce `:344-360`).
- Verified contracts: payload `payload-map.ts:133-137`; message type `message-constants.ts:272`;
  handler registration `diff-tabs.service.ts:169,184`; current handler `:366-382`. Producer is only
  `git-watcher.service.ts:531` (grep: no other `FILE_CONTENT_CHANGED` producer in `libs`/`apps`).
- Dependencies: shared ← backend and frontend (allowed bridge).
- Failure behaviour: empty `filePaths` with `truncated: false` is ignored.
- RPC dual-registration: not applicable (push message, not RPC).
- Verification seam: `diff-tabs.service.spec.ts` (one refresh per matching tab for a 3-path batch;
  `truncated` → one debounced full revalidation); watcher spec asserts payload shape.
- Files: MODIFY `libs/shared/src/lib/types/messages/payload-map.ts`,
  `libs/frontend/git-ui/src/lib/services/diff-tabs.service.ts` (+ spec),
  `apps/ptah-electron/src/services/git-watcher.service.ts` (shared with C3 — same batch).

### 6. Crash / hang observability — [P1] prevents a silent repeat

- Purpose: every death or hang of main, renderer, utility or GPU process leaves a record (INV-8).
- Responsibilities:
  - `ProcessLifecycleRecorder` (Electron app): `app.on('child-process-gone')` (type, reason,
    exitCode, serviceName, name), `app.on('render-process-gone')`, per-window
    `webContents.on('render-process-gone')`, `BrowserWindow.on('unresponsive'|'responsive')` with
    measured unresponsive duration, `webContents.on('console-message')` forwarding **warning and
    error levels only**, rate-limited (≤ 20 lines / 10 s, then one "suppressed N" line), truncated
    to 2 KB per line. All writes go to the shared `Logger` AND a synchronous append to the hang log
    (below) for `*-gone` and `unresponsive`, so they survive an immediate exit.
  - `crashReporter.start({ uploadToServer: false })` before `app.whenReady` so local minidumps are
    written under `app.getPath('crashDumps')` (see Q5).
  - `MainLoopWatchdog` (vscode-core diagnostics): eval'd `worker_threads` Worker (precedent:
    ts-diagnostics worker). Main posts a heartbeat every 1 000 ms (unref'd) carrying a small
    breadcrumb (last RPC method in flight, last lag sample). If no heartbeat for ≥ 5 000 ms the
    worker `fs.appendFileSync`s one line to `<logsPath>/ptah-hang.log` (ISO time, blocked-for, last
    breadcrumb) and again on recovery. Armed from `armDiagnostics` (`arm-diagnostics.ts:60-108`)
    when `logsPath` is given; disposed in its handle.
  - Renderer-side: `WebviewErrorHandler` already logs to console; forwarding via `console-message`
    covers it without a new IPC channel.
- Verified contracts: Electron 40.10.1 typings (Codebase evidence row); window factory
  `main-window.ts:95-131`; `post-window.ts:80-81,98`; `wire-runtime.ts:305`;
  `TOKENS.EVENT_LOOP_MONITOR` registration `register-platform-agnostic.ts:98`.
- Dependencies: app → vscode-core (existing). The watchdog uses only `node:worker_threads` and `fs`.
- DI: `TOKENS.MAIN_LOOP_WATCHDOG` registered in `register-platform-agnostic.ts` next to
  `EVENT_LOOP_MONITOR`, listed in the file's resolvable list (`:134-136`) and in the three hosts'
  expected-resolvable manifests. BootRefs: `refs.diagnostics` already owns disposal.
- Failure behaviour: any registration failure degrades to the existing no-op diagnostics handle
  (`arm-diagnostics.ts:95-107`); a failed hang-log append is swallowed inside the worker.
- Quality: heartbeat cost one `postMessage`/s; console forwarding bounded as above.
- Verification seam: unit spec with fake `app`/`webContents` emitters (each event → one log line,
  rate limit honoured); watchdog spec that starts the watchdog against a controllable heartbeat
  source and stops heartbeating for 6 s → exactly one hang line and one recovery line in a temp
  file; e2e (`apps/ptah-electron-e2e`) optional: `webContents.forcefullyCrashRenderer()` → log
  line present.
- Files: CREATE `apps/ptah-electron/src/services/diagnostics/process-lifecycle-recorder.ts` (+ spec);
  MODIFY `apps/ptah-electron/src/main.ts` (crashReporter + recorder install),
  `apps/ptah-electron/src/activation/post-window.ts` (per-window hooks);
  CREATE `libs/backend/vscode-core/src/diagnostics/main-loop-watchdog.ts`,
  `main-loop-watchdog-source.ts` (+ spec); MODIFY `arm-diagnostics.ts`,
  `libs/backend/vscode-core/src/diagnostics/index.ts`, `src/di/tokens.ts`,
  `src/di/register-platform-agnostic.ts`, `apps/ptah-electron/src/di/expected-resolvable.ts`,
  VS Code / CLI expected-resolvable manifests; MODIFY `libs/backend/vscode-core/CLAUDE.md`
  ("Diagnosing a hang": hang log).

### 7. `IWorkspaceWatcher` port and shared host logic — [P2]

- Purpose: the recursive workspace change feed as a batched, pre-filtered, overflow-signalling
  contract.
- Responsibilities (contract):
  - `watch(root, options, listener): IDisposable` where `options = { excludeGlobs: readonly string[];
excludeSegments: readonly string[]; nestedRepoDetection: boolean; minBatchIntervalMs?: number
(default 250); maxPathsPerBatch?: number (default 500) }`.
  - Listener receives `WorkspaceChangeBatch = { root; changes: readonly { path; kind:
'create'|'update'|'delete' }[]; truncated: boolean; overflow: boolean; droppedCount: number }`.
    `overflow: true` means "events were lost or suppressed; rescan" and carries no paths.
  - Guarantees: listener invoked at most once per `minBatchIntervalMs` per subscription; never
    synchronously inside `watch`; excluded paths never appear; after `dispose` no further calls.
  - `WorkspaceChangeCoalescer` (pure, platform-core utils, alongside `planGlobWatch`): accumulates
    raw events per subscription, applies exclusion, runs `EventStormBreaker` (moved into
    platform-core, see note below), emits batches.
- Verified contracts: `IDisposable`, `createEvent`, `planGlobWatch` precedent in platform-core
  (`libs/backend/platform-core/CLAUDE.md` Public API); token map `libs/backend/platform-core/src/di/tokens.ts:13-118`.
- Dependencies: platform-core only (`picomatch` already a dep of `glob-watch-plan.ts:47`).
- Integration: `PLATFORM_TOKENS.WORKSPACE_WATCHER`; adapters C8/C9; consumers C10.
- Failure behaviour: adapter errors surface as one `overflow` batch followed by resubscription;
  a permanently failed adapter emits `overflow` once and a `DegradationReporter` event (new
  `DegradationSource` value `'workspace-watcher'`, appended to the union AND
  `DEGRADATION_SOURCE_VALUES` together — `libs/shared/CLAUDE.md`).
- Note on storm breaker duplication: to avoid two implementations, `EventStormBreaker` (C2) is
  moved **into platform-core utils** in P2 and `shared` re-exports nothing; P1 consumers switch
  their import in the same batch. (platform-core is importable by the app, workspace-intelligence
  and the adapters; shared would not be importable by platform-core.)
- Verification seam: `workspace-change-coalescer.spec.ts` (cadence, cap, truncation, overflow,
  exclusion, dispose); a port contract suite in `libs/backend/platform-core/src/testing/contracts/`
  run by all three adapters (pattern: `run-file-system-contract.ts:145-155`).
- Files: CREATE `libs/backend/platform-core/src/interfaces/workspace-watcher.interface.ts`,
  `libs/backend/platform-core/src/utils/workspace-change-coalescer.ts` (+ spec),
  `libs/backend/platform-core/src/utils/event-storm-breaker.ts` (moved from shared, + spec),
  `libs/backend/platform-core/src/testing/contracts/run-workspace-watcher-contract.ts`; MODIFY
  `libs/backend/platform-core/src/di/tokens.ts`, `src/index.ts`, `CLAUDE.md` (token table);
  DELETE `libs/shared/src/lib/utils/event-storm-breaker.ts` (+ spec) and its export; MODIFY
  `libs/shared/src/lib/types/rpc/rpc-degradation.types.ts`.

### 8. Electron watch host (utilityProcess + `@parcel/watcher`) — [P2]

- Purpose: run recursive watching and all per-event work outside the Electron main process.
- Responsibilities:
  - Split in two so `platform-core` keeps its "no Electron / Node-IPC imports" rule
    (`libs/backend/platform-core/CLAUDE.md` Boundaries): `WorkspaceWatchHostCore` in
    **platform-core** (`src/workspace-watch/`) is pure — the watch engine
    (`subscribe(dir, cb, {ignore})`) and a `post(message)` function are injected; the thin entry
    `workspace-watch-host.entry.ts` in **platform-electron** does transport auto-detect exactly as
    `integrity-worker.ts` (`process.parentPort` → utilityProcess; `worker_threads.parentPort` →
    tests), requires `@parcel/watcher`, and hands both to the core. Protocol types
    (id-correlated, Zod-validated): `subscribe {id, root, options}`, `unsubscribe {id}`,
    `batch {id, …}`, `error {id, message}`, `heartbeat {seq, subscriptions, eventsPerSec}`.
  - One native `@parcel/watcher.subscribe` per root with the intersection of subscriber excludes
    passed as `ignore` (globs + absolute nested roots); per-subscriber extra excludes applied in the
    host; coalescer per subscriber.
  - Nested repo detection: a `create` of `<dir>/.git` (file or dir) at depth > 0 adds `<dir>` to the
    ignore set and re-subscribes (debounced 1 s, at most once per 10 s per root); seeded from
    `git worktree list --porcelain` passed in `subscribe` by the consumer (host does not spawn git).
  - Native error (A1 overflow) → emit `overflow` to all subscribers of that root, re-subscribe.
  - Adapter `ElectronWorkspaceWatcher implements IWorkspaceWatcher`: lazily forks one host per
    app, re-sends active subscriptions after a restart, supervises with heartbeat (missing 3 × 2 s →
    kill + restart), restart budget 5 per 10 min then degraded (`overflow` + DegradationReporter,
    subscribers told to fall back to polling rescans every 60 s — the consumer's existing rescan).
    Constructor takes an injected fork shim (`{ fork(): WatchHostProcess }`), no `electron` import,
    per `libs/backend/platform-electron/CLAUDE.md` Guidelines.
  - App factory `ElectronWorkspaceWatchHostFactory` using `ElectronUtilityWorkerProcess.fork(path,
'ptah-workspace-watch-host')`.
- Verified contracts: fork shim `electron-utility-worker-process.ts:26-61`; transport detect
  `integrity-worker.ts:65-114`; registration entry `apps/ptah-electron/src/di/phase-0-platform.ts:41`
  (`registerPlatformElectronServices(container, options)`).
- Dependencies: platform-electron → platform-core (existing); NEW external `@parcel/watcher`
  (direct dependency in root `package.json` and `apps/ptah-electron/package.json`; today only
  transitive via `sass`).
- DI: `PLATFORM_TOKENS.WORKSPACE_WATCHER` in phase 0 via `ElectronPlatformOptions.workspaceWatchHost`
  (fork shim + bundle path); add to `apps/ptah-electron/src/di/expected-resolvable.ts`. BootRefs:
  add `workspaceWatcher` and a `nonFatal` dispose line in `disposeAfterPersistence`
  (`apps/ptah-electron/src/activation/shutdown.ts`; touches no SQLite).
- Build/packaging: new `build-workspace-watch-host` esbuild ESM target in
  `apps/ptah-electron/project.json` (external `@parcel/watcher`), added to `build.dependsOn`,
  `build-dev`, `serve:watch`, `test.dependsOn` and `EXPECTED_ESM_TARGETS`
  (`esm-bundle-gate.spec.ts:153-159`); `electron-builder.yml` `asarUnpack`:
  `node_modules/@parcel/watcher/**`, `node_modules/@parcel/watcher-*/**`; extend
  `verify-packed-native.js` to load it (A2); `validate-deps` externals.
- Failure behaviour: host crash → `child-process-gone` recorded (C6), adapter restarts; while down,
  subscribers receive one `overflow`; main never blocks waiting for the host.
- Quality: main-side cost ≤ `subscriptions × 4` small messages/s; host RSS target < 150 MB on this
  repo (`DirTree` of non-ignored files).
- Verification seam: host spec running the module in Jest on a temp tree (as built in Batch 8:
  the contract suite runs over a `child_process.fork` host, because `@parcel/watcher` loads in
  only one thread per process) (create/delete batches, exclusion, nested `.git` detection, overflow → resubscribe);
  adapter spec with a fake fork shim (restart, resubscribe, budget exhaustion); ESM gate spec;
  stress ST-2.
- Files: CREATE `libs/backend/platform-core/src/workspace-watch/workspace-watch-host-core.ts`,
  `workspace-watch-protocol.ts` (+ specs); CREATE
  `libs/backend/platform-electron/src/workspace-watch/workspace-watch-host.entry.ts`,
  `electron-workspace-watcher.ts` (+ specs); MODIFY
  `libs/backend/platform-electron/src/registration.ts`, `src/index.ts`, `CLAUDE.md`,
  `libs/backend/platform-electron/package.json` (if it declares deps);
  CREATE `apps/ptah-electron/src/services/platform/electron-workspace-watch-host-factory.ts`;
  MODIFY `apps/ptah-electron/src/di/phase-0-platform.ts`, `apps/ptah-electron/project.json`,
  `apps/ptah-electron/src/config/esm-bundle-gate.spec.ts`, `apps/ptah-electron/electron-builder.yml`,
  `apps/ptah-electron/scripts/verify-packed-native.js`, `apps/ptah-electron/package.json`,
  root `package.json`, `apps/ptah-electron/src/activation/boot-coordinator.ts`,
  `apps/ptah-electron/src/activation/shutdown.ts`, `apps/ptah-electron/src/di/expected-resolvable.ts`,
  `apps/ptah-electron/CLAUDE.md` (Build & Run: fourth worker).

### 9. CLI and VS Code watcher adapters — [P2]

- Purpose: satisfy the port in the other two hosts (hexagonal rule: every port has three adapters).
- Responsibilities:
  - `CliWorkspaceWatcher`: runs `WorkspaceWatchHostCore` (platform-core, C8) in a
    `child_process.fork` child through its own ~40-line entry in platform-cli (engine per Q3).
    Corrected 2026-09-14 (Batch 8 finding): NOT a `worker_threads` Worker — `@parcel/watcher`
    loads in only one thread per process, so a restarted Worker host fails with "Module did not
    self-register". The Electron entry already supports the `child_process` IPC transport. Electron and CLI then
    differ only in transport and entry; the near-duplicate entry is deliberate (repo precedent:
    the two `build-artifact-gate.ts` copies, `apps/ptah-electron/CLAUDE.md`), because platform-cli
    must not import platform-electron.
  - `VscodeWorkspaceWatcher`: `vscode.workspace.createFileSystemWatcher(new RelativePattern(root,
'**/*'))` feeding `WorkspaceChangeCoalescer` in the extension host. VS Code's watcher already
    runs out-of-process with `files.watcherExclude`; no native dependency enters the VSIX.
- Verified contracts: VS Code adapter precedent `libs/backend/platform-vscode/src/implementations/vscode-file-system-provider.ts:178`;
  CLI precedent `libs/backend/platform-cli/src/implementations/cli-file-system-provider.ts:145`.
- Dependencies: adapters → platform-core only.
- DI: registered by each adapter lib's registration; add token to VS Code and CLI
  expected-resolvable manifests.
- Failure behaviour: CLI worker death → restart with the same budget as C8; VS Code watcher error →
  `overflow`.
- Verification seam: shared contract suite (C7) run by each adapter spec.
- Files: CREATE `libs/backend/platform-cli/src/workspace-watch/workspace-watch-host.entry.ts`,
  `libs/backend/platform-cli/src/implementations/cli-workspace-watcher.ts` (+ spec),
  `libs/backend/platform-vscode/src/implementations/vscode-workspace-watcher.ts` (+ spec); MODIFY
  both adapters' registration files, `libs/backend/cli-engine` container wiring,
  `apps/ptah-cli` build target for the host entry (A3).

### 10. Consumer migration to the port — [P2]

- Purpose: remove every recursive per-event watcher from main (INV-1).
- Responsibilities:
  - `GitWatcherService`: `watchWorkspaceRoot` (`:449-483`) replaced by one `IWorkspaceWatcher.watch`
    subscription; any batch → `scheduleUpdate`; `update` paths → content-change set; `overflow` →
    `refreshGitInfo` + truncated content push. P1 breaker and per-event filter code is deleted
    (breaker now lives in the host). `.git` dedicated watchers `:199-222` unchanged. Seeds
    nested roots from `getWorktrees`.
  - `WorkspaceFileIndexService.setupWatcher` (`:630-664`): subscribe via the port with
    `DEFAULT_WORKSPACE_EXCLUDES` segments/globs; batch handler adds/deletes synchronously from the
    batch (the async `isExcluded` per event `:753-780` becomes one compiled-matcher pass per batch
    using `compileMatcher`, per workspace-intelligence `CLAUDE.md` "File index"); `overflow` →
    mark entry stale and rebuild through the existing path-only walk (`build` `:413-448`) under the
    governor (C14) once it exists.
  - ESLint rule forbidding `fs.watch` with `recursive` and `chokidar` imports outside
    `libs/backend/platform-{electron,cli}/src/implementations/*file-system-provider.ts` and
    `libs/backend/platform-{electron,cli}/src/workspace-watch/*.entry.ts`.
- Verified contracts: as cited; `GitWatcherService` has no DI token (constructed at
  `boot-heavy-services.ts:396`), so it resolves `PLATFORM_TOKENS.WORKSPACE_WATCHER` from the
  container there.
- Failure behaviour: as C7/C8.
- Verification seam: updated specs for both services using a fake `IWorkspaceWatcher`; lint rule
  proven by a fixture file in the ESLint config spec if one exists, otherwise by `npm run lint:all`.
- Files: MODIFY `apps/ptah-electron/src/services/git-watcher.service.ts` (+ spec),
  `apps/ptah-electron/src/activation/boot-heavy-services.ts`,
  `libs/backend/workspace-intelligence/src/file-indexing/workspace-file-index.service.ts` (+ spec),
  `libs/backend/workspace-intelligence/CLAUDE.md` ("File index" rules),
  `eslint.config.mjs`.

### 11. Git process supervision — [P2]

- Purpose: bound git processes and their output regardless of caller (INV-3, INV-4).
- Responsibilities:
  - `GitProcessGate` in `exec-git.ts`: process-wide semaphore (default 4 concurrent git children,
    `PTAH_GIT_MAX_CONCURRENT`), FIFO with per-workspace round-robin. **The timeout clock starts at
    spawn, not at enqueue.** A slot is released on child `close`, or 2 s after a forced kill
    (`exec-git.ts:265-267`), never on the timeout rejection itself — so no new run overlaps a dying
    one.
  - Output cap: `maxOutputBytes` option (default 64 MiB; status path 32 MiB). Exceeding it kills the
    child (tree kill `:212-227`) and rejects with `GitOutputLimitError` (typed, `code:
'GIT_OUTPUT_LIMIT'`).
  - `priority: 'background'` option: after `whenSpawned` resolves a pid, `os.setPriority(pid,
PRIORITY_BELOW_NORMAL)` best-effort. Watcher-initiated `refreshGitInfo` uses it; user-initiated
    RPC commands do not.
  - `computeGitInfo` untracked numstat cap: first 200 untracked files, files ≤ 1 MiB; beyond →
    `additions/deletions: null` (the existing "unknown" shape `:2402-2420`).
  - Queue wait > 5 s logs one `[GitProcessGate] saturated` warn per minute.
- Verified contracts: `ExecGitOptions` `exec-git.ts:86-115`; `execGitBuffer` `:240-313`;
  `withSpawner` `git-info.service.ts:2377-2380`.
- Dependencies: vscode-core only; `os` built-in.
- Failure behaviour: gate never rejects for saturation (callers only see latency); cap and timeout
  reject with typed errors; `setPriority` failures swallowed with a degradation-audit marker.
- Verification seam: `exec-git.spec.ts` with fake spawner: 10 concurrent calls → ≤ 4 live; timeout
  keeps slot until fake child closes; output cap kills; background priority calls
  `os.setPriority` (mocked).
- Files: MODIFY `libs/backend/vscode-core/src/utils/exec-git.ts` (+ spec),
  `libs/backend/vscode-core/src/services/git-info.service.ts`.

### 12. Reusable, bounded spawn workers — [P2]

- Purpose: stop creating one V8 isolate per child process (C10) while keeping the host loop free of
  `CreateProcessW`.
- Decision (verified against `off-thread-process-spawner.ts`): keep the worker-thread design
  (TASK_2026_341's measured win) but **reuse** workers: one child per worker at a time, idle
  workers retained up to 4 for 30 s, then terminated. Live workers above 24 still spawn (never block
  a foreground launch) but emit one `warn` per minute and a degradation count.
- Responsibilities: worker source accepts sequential `spawn` messages and resets per-child state;
  `WorkerBackedProcess` borrows/returns a worker instead of `new Worker` (`:294`) and
  `teardown` (`:492-507`) returns it to the pool after `stdout-end`/grace; `dispose` (`:694-698`)
  terminates pool + live.
- Dependencies: unchanged.
- Failure behaviour: a worker that errors or exits is discarded, never returned to the pool;
  `PTAH_SDK_INLINE_SPAWN=1` fallback unchanged (`:666-669`).
- Verification seam: `off-thread-process-spawner.spec.ts` (real children): 50 sequential git-like
  spawns create ≤ 4 workers; stdout isolation between consecutive children on one worker; a killed
  child's worker is not reused. Perf spec behind `PTAH_PERF_SPECS=1` re-measures host max delay.
- Files: MODIFY `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.ts`,
  `off-thread-process-spawner-source.ts`, specs; MODIFY `libs/backend/agent-sdk/CLAUDE.md`
  (spawner bullet).

### 13. Main-thread cost attribution (SQLite and resume parse) — [P2]

- Purpose: measure before moving synchronous persistence off main (inventory risk #5 is unmeasured).
- Responsibilities: wrap the database returned by `SqliteDatabaseFactory` so `prepare()` returns
  statements whose `run/get/all/iterate` and `transaction()` callbacks are timed; any call above
  `PTAH_SQLITE_SLOW_WARN_MS` (default 50) logs `[SQLite] slow statement` with the first 120 chars
  of SQL and duration, max one line per SQL text per minute. Add the same threshold style to
  `SessionHistoryReaderService.readSessionHistory` (parse + projection duration, event count).
- Verified contracts: `SqliteDatabase`/`SqliteStatement` interfaces and `configure({ factory })` in
  `sqlite-connection.service.ts`; `readSessionHistory` `session-history-reader.service.ts:155-311`.
- Failure behaviour: timing wrapper never alters results or exceptions.
- Decision gate: if a week of logs shows SQLite or resume parsing contributing ≥ 20 % of lag
  windows, a follow-up task moves the offending store (or the JSONL parse) to a worker; recorded as
  Q4.
- Verification seam: spec asserting the wrapper forwards calls and logs above threshold.
- Files: MODIFY `libs/backend/persistence-sqlite/src/lib/sqlite-connection.service.ts` (+ spec),
  `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts`, `libs/backend/vscode-core/CLAUDE.md`
  (env table).

### 14. `BackgroundWorkGovernor` — [P3]

- Purpose: background work yields to foreground turns and to measured lag (INV-7).
- Responsibilities:
  - State `clear | foreground-busy | lagging`, computed from (a) registered
    `ForegroundActivitySource`s (`isForegroundBusy(): boolean` + change callback) and (b)
    `EventLoopMonitor` samples. Lag hysteresis: enter when `p99Ms > 100` in 2 consecutive windows,
    exit when `maxMs < 40` in 3 consecutive windows.
  - API: `isClear(): boolean`, `whenClear({ signal?, maxDeferMs? }): Promise<'clear' | 'timeout'>`
    (default `maxDeferMs` 600 000 — starvation ceiling; `timeout` proceeds and logs once),
    `onChange(listener)`.
  - `EventLoopMonitor` gains `onSample(listener)` (every window, not just breaches).
  - agent-sdk registers a source over `SessionTurnStateRegistry`: busy iff any record's phase is
    `generating` (add a read-only `hasGenerating()` scan; bounded map ≤ 256 entries); change
    notification from the stream transformer's `markGenerating`/`settleTurn`/`forceIdle` call
    sites via a registry listener list (the registry stays I/O-free).
- Adopters (each a small change at an existing seam):
  - (a) `InternalQueryConcurrencyGate.acquire`/`drain` (`internal-query.service.ts:167-260`): lanes
    other than `default` are admissible only when `governor.isClear()` or their wait exceeds
    `maxDeferMs`; `drain` re-runs on `governor.onChange`.
  - (b) `CodeSymbolIndexer` batch loop (`code-symbol-indexer.service.ts:228`): `await
governor.whenClear()` before each batch.
  - (c) `refreshUserLayer` coalescer for non-`activation` reasons (`apps/ptah-electron/src/activation/plugin-activation.ts`,
    `coalesced-job.ts`): defer the run start.
  - (d) `SqliteBackupService` start and `WorkspaceFileIndexService` rebuilds after `overflow`.
  - (e) Boot: `editor:detectTargets` (`editor-launcher-detection.ts:184-235`) runs its PATH probes
    with bounded concurrency (8) and caches per `PATH`+`PATHEXT` for the process lifetime.
  - (f) Network back-off (A4): consecutive network-class failures in the memory-curator and
    skill-synthesis lanes back off exponentially 30 s → 15 min, reset on success.
  - User-scheduled cron jobs are NOT deferred.
- DI: `TOKENS.BACKGROUND_WORK_GOVERNOR` in `register-platform-agnostic.ts` (reaches all hosts),
  started by `armDiagnostics`; VS Code and CLI hosts get it too (CLI arms diagnostics only under
  `--verbose` — governor then runs on foreground signal only). Expected-resolvable in all three.
- Dependencies: vscode-core owns the governor; agent-sdk, workspace-intelligence,
  persistence-sqlite, apps depend on vscode-core already (no new edges).
- Failure behaviour: governor resolution failure → adopters treat as always clear (degradation
  event once). A listener throw is isolated as in `event-loop-monitor.ts:216-226`.
- Verification seam: governor spec (fake clock + fake sources: hysteresis, starvation timeout,
  abort); gate spec (background lane queued while busy, `default` lane admitted, drain on clear).
- Files: CREATE `libs/backend/vscode-core/src/diagnostics/background-work-governor.ts` (+ spec);
  MODIFY `event-loop-monitor.ts` (+ spec), `arm-diagnostics.ts`, `src/di/tokens.ts`,
  `src/di/register-platform-agnostic.ts`, `libs/backend/agent-sdk/src/lib/helpers/session-turn-state.registry.ts`
  (+ spec), `libs/backend/agent-sdk/src/lib/di/register.ts`, `internal-query/internal-query.service.ts`
  (+ spec), `libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts`,
  `libs/backend/persistence-sqlite/src/lib/backup.service.ts`,
  `libs/backend/platform-core/src/utils/editor-launcher-detection.ts` (+ spec),
  `apps/ptah-electron/src/activation/plugin-activation.ts`, curator/skill lane retry sites (A4),
  host expected-resolvable manifests.

### 15. Bounded `chat:resume` — [P4]

- Purpose: tile open transfers and replays only what is needed (INV-9).
- Responsibilities:
  - Delete `ChatResumeResult.messages` (`rpc-chat.types.ts:236-246`), its forwarding
    (`chat-session.service.ts:882`) and the renderer fallback branch (`session-loader.service.ts:781-793`);
    `SessionHistoryReaderService` stops building the legacy projection if no other reader (A5).
  - Chunked replay: `SessionLoaderService` replays `events` in chunks of 250 with a macrotask yield
    (`MessageChannel`-based, not `requestAnimationFrame`, which Electron throttles for hidden
    windows) between chunks; the tab stays `resuming` until finalization.
  - Tail paging is **not** in this component (Q6); chunking + C16 must meet the budget first.
- RPC dual-registration: none (field removal on an existing method).
- Failure behaviour: a chunk throwing aborts replay and runs the existing failure branch
  (`applyResumeFailure`, `:794-799`); CLI sessions are still applied first (`:743-749`).
- Verification seam: `session-loader.service.spec.ts`: 2 000 events → 8 yields, final state equal to
  single-pass replay (equivalence oracle); shared type test.
- Files: MODIFY `libs/shared/src/lib/types/rpc/rpc-chat.types.ts`,
  `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`,
  `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts`,
  `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts` (+ specs).

### 16. O(E + M) session finalization — [P4]

- Purpose: remove the quadratic scans (`message-finalization.service.ts:303-306,316-321`).
- Responsibilities: one pass over `stateCopy.events` building `messageId → {start, complete}` and
  one `Map` over `allTrees` by id, before the message loop; loop becomes lookups.
- Failure behaviour: identical output (same first-match semantics: keep the first `message_start` /
  `message_complete` seen in map iteration order).
- Verification seam: spec comparing old vs new output on fixture sessions (equivalence), plus a
  counting proxy asserting ≤ 2 × E event visits.
- Files: MODIFY `libs/frontend/chat-streaming/src/lib/message-finalization.service.ts` (+ spec).

### 17. Tab persistence quota back-off — [P4]

- Purpose: INV-10.
- Responsibilities: on `setItem` failure record `{ key, failedAt, attempt }`; skip
  `_doSaveTabState` serialization until `failedAt + min(5 s × 2^attempt, 5 min)` unless the tab set
  shrank (tab closed) or `flushPendingSave` runs at teardown; one `console.warn` per back-off step.
- Verified contracts: `_doSaveTabState` `tab-manager.service.ts:2356-2380`; teardown flush
  `flushPendingSave` `:2323-2334`.
- Verification seam: spec with a throwing `localStorage` mock: second save inside window performs no
  `JSON.stringify` (spy), teardown flush still attempts.
- Files: MODIFY `libs/frontend/chat-state/src/lib/tab-manager.service.ts`,
  `libs/frontend/chat-state/src/lib/tab-persistence.ts` (+ specs).

### 18. Inbound message burst coalescing — [P4]

- Purpose: INV-11.
- Responsibilities: `MessageRouterService` registers its `message` listener via
  `NgZone.runOutsideAngular`, appends to a queue, and schedules one `MessageChannel` drain; the drain
  runs `ngZone.run` once and dispatches the queue in arrival order (BATCH expansion unchanged
  `:75-86`). `NgZone` is injectable in zoneless libs (no-op zone), so the lib stays zone-agnostic.
- Failure behaviour: a throwing handler is caught per message and logged; the drain continues.
- Quality: added latency ≤ one macrotask; order preserved (RPC responses included).
- Verification seam: `message-router.service.spec.ts`: 1 000 posted messages → 1 zone entry, order
  preserved, handler exception isolated.
- Files: MODIFY `libs/frontend/core/src/lib/services/message-router.service.ts` (+ spec).

---

## Integration architecture

- **Data flow (after P2).** OS → `@parcel/watcher` (native ignore, native 50/500 ms debounce) in
  the watch host → per-subscriber coalescer + storm breaker → ≤ 4 batches/s over the utility
  process port → `ElectronWorkspaceWatcher` → (a) `GitWatcherService` → `refreshGitInfo` →
  `GitProcessGate` → reused spawn worker → git child → `GIT_STATUS_UPDATE`; batched
  `FILE_CONTENT_CHANGED` → `IpcBridge.sendToRenderer` → `MessageRouterService` drain →
  `DiffTabsService`; (b) `WorkspaceFileIndexService` batch apply or governed rebuild.
- **State ownership.** Watch host owns native subscriptions and nested-root sets (process lifetime,
  rebuilt on restart from adapter's subscription table). `GitInfoService` owns flight records per
  key. Governor owns derived state only. `BootRefs.workspaceWatcher` owns the adapter for shutdown.
- **External boundaries.** Host protocol messages are validated with Zod on both sides (repo rule:
  Zod at IPC). Paths from the host are checked to be under the subscribed root before use
  (`isPathWithinRoots`, platform-core). Renderer console text is truncated before logging.
- **Failure and rollback.** Each phase ships behind no flag except P2's host: `PTAH_WATCH_HOST=0`
  selects an in-process `@parcel/watcher` path inside the same adapter for one release as a
  field-recovery hatch (consumer: Electron users hitting A2 packaging faults; delete once one
  release ships without host-load degradations). Host death → overflow → consumers rescan.
  Git timeout → slot held to exit → trailing run. Governor timeout → work proceeds.
- **Observability.** `[GitWatcher] event storm` enter/exit; `[GitProcessGate] saturated`;
  `[WorkspaceWatcher] host restarted / degraded`; `[SQLite] slow statement`; hang log
  `ptah-hang.log`; lifecycle lines from C6; boot degradation summary counts new codes
  (`apps/ptah-electron/CLAUDE.md` "One degradation summary line per boot").

---

## Acceptance criteria and measurable budgets

Budgets marked (perf) run behind `PTAH_PERF_SPECS=1` on a quiet machine; CI asserts the mechanism
counts. Tree for ST-1/ST-2: 10 synthetic checkouts, 75 000 files in ~7 500 directories, each root
with a `.git` file, inside a real temp git repository with the watchers armed.

| ID    | Scenario                                                                           | Budget                                                                                                                                                                                                                            | Phase |
| ----- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| AC-1  | ST-1: recursive delete of the tree under `.claude-worktrees/`                      | main event-loop delay p99 ≤ 50 ms, max ≤ 200 ms over delete + 10 s (perf); 0 `git status` spawns and 0 renderer pushes attributable to the delete (CI)                                                                            | P1    |
| AC-2  | ST-1b: same tree under a non-excluded `pkgs/big/`                                  | P1: p99 ≤ 100 ms, max ≤ 500 ms (perf); storm entered once, exactly 1 status refresh + 1 truncated content push after quiet (CI). P2: p99 ≤ 30 ms, max ≤ 100 ms (perf)                                                             | P1/P2 |
| AC-3  | Concurrent git children for one workspace during ST-1b                             | ≤ 1 status pipeline, ≤ 2 git children alive at once from that pipeline; process-wide ≤ 4 (P2) (CI, fake + real spawner)                                                                                                           | P1/P2 |
| AC-4  | Push rate during any storm                                                         | `file:content-changed` ≤ 2/s; `git:status-update` ≤ 1 per 2 s (CI)                                                                                                                                                                | P1    |
| AC-5  | Main-loop block of 6 s (test harness)                                              | exactly one hang line in `ptah-hang.log` written within 6 s, plus recovery line (CI, worker-level)                                                                                                                                | P1    |
| AC-6  | Renderer crash / utility-process kill in e2e                                       | one log line each with reason (e2e, optional in CI)                                                                                                                                                                               | P1    |
| AC-7  | Watch host killed during ST-1b                                                     | host restarted ≤ 3 s; consumers receive `overflow` and rescan once; main p99 unchanged vs AC-2 (perf)                                                                                                                             | P2    |
| AC-8  | Spawn workers for 50 sequential git calls                                          | ≤ 4 workers created (CI)                                                                                                                                                                                                          | P2    |
| AC-9  | Foreground turn generating while memory curator + skill synthesis have queued work | 0 background-lane queries admitted until idle or 10 min (CI)                                                                                                                                                                      | P3    |
| AC-10 | Boot on this repo                                                                  | no `[event-loop] lag` window above 1 000 ms after the window opens (perf, measured via the existing log)                                                                                                                          | P3    |
| AC-11 | Open 3 tiles of a 2 000-event session                                              | no renderer long task > 200 ms; total blocked ≤ 1 500 ms (perf, Playwright `PerformanceObserver('longtask')` in `apps/ptah-electron-e2e`); ≤ 2 × E event visits in finalization (CI)                                              | P4    |
| AC-12 | `localStorage` quota failure                                                       | no repeat stringify inside back-off window (CI)                                                                                                                                                                                   | P4    |
| AC-13 | 1 000 inbound messages after a stall                                               | one zone entry per drain, order preserved (CI)                                                                                                                                                                                    | P4    |
| AC-14 | Regression gates                                                                   | `npx nx run-many -t test -p <every touched project>` (check the "N projects" header), `npm run lint:all`, `npm run typecheck:all`, `nx build ptah-electron`, `nx package ptah-electron` (P2), `npx nx run degradation-audit:lint` | all   |

### Tests that pin the incident

- **ST-1 / ST-1b (`apps/ptah-electron/src/services/git-watcher.stress.spec.ts`)** — builds the tree
  in `os.tmpdir()`, arms real `GitWatcherService` (real `GitInfoService` with a counting spawner
  wrapper) and real `WorkspaceFileIndexService` (real `ElectronFileSystemProvider` in P1, real
  port adapter in P2), enables `monitorEventLoopDelay` in the test process, deletes with
  `fs.rm({recursive:true})`, waits 10 s, asserts AC-1..AC-4. Mechanism assertions always run with a
  reduced 8 000-file tree; ms budgets and the 75 000-file tree run under `PTAH_PERF_SPECS=1`.
  Includes the two ablations from the inventory's "Unknowns": exclude-only and single-flight-only,
  logged, not asserted — they answer I1.
- **ST-2 (`libs/backend/platform-electron/src/workspace-watch/workspace-watch-host.stress.spec.ts`)** —
  the real entry + `@parcel/watcher` as a `child_process.fork` child (the entry's transport
  auto-detect; a `worker_threads` host cannot be restarted in one process, Batch 8); asserts batch cadence, overflow handling and resubscription.

---

## Architecture-level quality requirements

- Functional: git decorations and `@` index stay correct after storms (one rescan); nested worktrees
  never appear in the `@` picker; `.claude/commands` edits still invalidate discovery.
- Performance: budgets AC-1..AC-13.
- Security: host protocol Zod-validated; host never spawns processes or reads file contents; paths
  containment-checked; console forwarding truncated and rate-limited (no unbounded log growth from
  renderer spam).
- Maintainability: hexagonal rule kept (port in platform-core, three adapters, policy in shared);
  no platform-core → shared import; no new `V2`/legacy copies (P1 code paths are replaced by P2, not
  kept); worker target registered in all four build lists; CLAUDE.md sections updated where rules
  change (vscode-core diagnostics, workspace-intelligence file index, agent-sdk spawner,
  platform-core tokens, platform-electron adapters, ptah-electron build).
- Testability: every invariant has a CI mechanism test; ms budgets only in perf specs.

---

## Risks

| Risk                                                                                                                          | Likelihood / impact                   | Mitigation                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 `@parcel/watcher` fails to load packaged (asar, signing, arm64 Windows)                                                    | Medium / High (no watching)           | A2 verification in `verify-packed-native.js`; `PTAH_WATCH_HOST=0` hatch; adapter degrades to 60 s rescans with a degradation event rather than failing boot |
| R2 Windows `ReadDirectoryChangesW` overflow still occurs under native ignore (kernel delivers ignored events into the buffer) | High during mass deletes / Low impact | Overflow is a first-class `overflow` batch → one rescan (A1 test)                                                                                           |
| R3 Over-exclusion hides real changes (a user's tracked folder named `worktrees` under `.claude`)                              | Low / Low                             | Rule requires the two-segment sequence; evidence recorded via `git check-ignore`; missed refresh is invisible, never data loss (module header)              |
| R4 Governor starves background pipelines on machines with constant lag or always-busy sessions                                | Medium / Medium                       | 10-min starvation ceiling, hysteresis, `default` lane never gated, one log line per timeout                                                                 |
| R5 Router coalescing changes handler timing assumptions (RPC correlation, focus-sensitive handlers)                           | Low / Medium                          | Order preserved; one macrotask latency; full frontend core spec suite + e2e smoke                                                                           |
| R6 Removing `ChatResumeResult.messages` breaks an unseen consumer (CLI/TUI)                                                   | Low / Medium                          | A5 reference check before deletion                                                                                                                          |
| R7 Spawn-worker reuse leaks state between children                                                                            | Low / High                            | Per-child reset in worker source; spec with consecutive children on one worker; discard on any error                                                        |
| R8 Git gate latency surprises the diff view on large repos                                                                    | Medium / Low                          | Limit 4 default, env override, saturation warn                                                                                                              |
| R9 Utility-process count/RSS grows (fourth helper process)                                                                    | Certain / Low                         | One host per app, not per root; RSS target recorded in AC-7 run                                                                                             |
| R10 Phase 1 storm thresholds mis-tuned for monorepo builds (Nx cache writes)                                                  | Medium / Low                          | Thresholds are constants with env overrides; storm log lines give field data                                                                                |

## Open questions for the user

1. **Q1 — Exclude nested repos from the `@` file picker too?** Excluding every registered worktree /
   nested `.git` root keeps the picker free of 10× duplicate files but hides files in a nested repo
   the user deliberately opened inside the workspace. **Recommended default: exclude** (they are
   already skipped by the initial walk when git-ignored).
2. **Q2 — Ship P2's utility-process watch host, or stop after P1?** P1 closes the incident; P2 is
   what makes unknown future churn harmless and adds a native dependency plus a fourth helper
   process. **Recommended default: ship P2.**
3. **Q3 — CLI adapter engine.** Add `@parcel/watcher` to `@hive-academy/ptah-cli` (same engine
   everywhere) or keep chokidar inside the CLI worker (no native dependency in the npm package).
   **Recommended default: `@parcel/watcher`** if A3 passes; otherwise chokidar in the worker.
4. **Q4 — Move SQLite writes off main now or after attribution data?** **Recommended default:
   attribution first (C13), decide with a week of logs.**
5. **Q5 — Local crash dumps.** `crashReporter.start({ uploadToServer: false })` writes minidumps
   under the user profile (disk use, may contain memory contents). **Recommended default: on,
   local only, keep newest 5.**
6. **Q6 — Tail-paged session history (older turns fetched on scroll).** Needed only if chunked
   replay + O(E+M) finalization miss AC-11 on the largest sessions; it changes transcript UX.
   **Recommended default: defer; revisit with AC-11 measurements.**

---

## Team-leader handoff

- **Recommended executors.**
  - backend-developer: C1, C2, C3, C4, C6 (backend + app wiring), C7–C14 (C8 build/packaging parts
    with devops-engineer).
  - devops-engineer: C8 build target, `electron-builder.yml`, `verify-packed-native.js`,
    `esm-bundle-gate.spec.ts`, root/app `package.json`, ESLint rule (C10), CLI host bundle (C9).
  - frontend-developer: C5 renderer half, C15 renderer half, C16, C17, C18.
  - senior-tester: ST-1/ST-1b, ST-2, AC-11 e2e perf spec, AC-5 watchdog harness.
- **Complexity:** HIGH overall (cross-process host, native dependency, three adapters, renderer
  timing); P1 alone is MEDIUM.
- **Dependencies and ordering (component level).**
  - C1, C2 before C3; C4 before C3's `refreshGitInfo` call; C5 shared type before either side.
  - C6 independent.
  - C7 before C8, C9; C8/C9 before C10; C2 is moved by C7 (same batch as C7 or later).
  - C11, C12, C13 independent of the watcher work and of each other (C11 and C4 touch
    `git-info.service.ts` — not parallel with each other).
  - C14 after C6 (both edit `arm-diagnostics.ts`, `register-platform-agnostic.ts`, `tokens.ts`).
  - C15–C18 independent of backend phases; C15 backend half and C5 both touch shared message/RPC
    types — different files, parallel-safe.
- **Suggested file-disjoint batches.**
  - P1-A (backend): C1 + C2 + C4 — `libs/shared/src/lib/constants/*`, `libs/shared/src/lib/utils/{nested-repo-roots,event-storm-breaker}.ts`,
    `workspace-default-excludes.ts`, `worktree-path.ts`, `worktree-hook-handler.ts`, `git-info.service.ts`.
  - P1-B (backend + frontend pair, after P1-A): C3 + C5 — `git-watcher.service.ts`, `payload-map.ts`,
    `diff-tabs.service.ts`; file-index breaker adoption in `workspace-file-index.service.ts`.
  - P1-C (backend, parallel with P1-A/B): C6 — `apps/ptah-electron/src/services/diagnostics/*`,
    `main.ts`, `post-window.ts`, vscode-core `diagnostics/main-loop-watchdog*`, `arm-diagnostics.ts`,
    `tokens.ts`, `register-platform-agnostic.ts`, expected-resolvable manifests.
  - P1-D (tester, after P1-A/B): ST-1/ST-1b.
  - P2-A: C7 (platform-core port, coalescer, breaker move, contract suite, shared deletion).
  - P2-B (after P2-A): C8 + C9 host core and adapters (platform-core `workspace-watch/`,
    platform-electron, platform-cli, platform-vscode, app factory, phase-0).
  - P2-C (devops, parallel with P2-B): build target, builder config, packaging verification,
    ESM gate, package.json.
  - P2-D (after P2-B/C): C10 consumer migration + ESLint rule.
  - P2-E (parallel with P2-A..D): C11 (`exec-git.ts`; `git-info.service.ts` untracked cap).
  - P2-F (parallel): C12 (agent-sdk spawner).
  - P2-G (parallel): C13 (sqlite-connection, session-history-reader).
  - P3-A (after P1-C): C14 governor + adopters.
  - P4-A (frontend): C16 + C17 (`message-finalization.service.ts`, `tab-manager.service.ts`, `tab-persistence.ts`).
  - P4-B (frontend + backend): C15 (`rpc-chat.types.ts`, `chat-session.service.ts`,
    `session-history-reader.service.ts` — coordinate with P2-G, same file; sequence after it,
    `session-loader.service.ts`).
  - P4-C (frontend): C18 (`message-router.service.ts`).
  - P4-D (tester): AC-11 e2e perf spec.
- **Files affected.**
  - CREATE: `libs/shared/src/lib/utils/nested-repo-roots.ts`; `libs/shared/src/lib/utils/event-storm-breaker.ts` (P1, moved in P2);
    `apps/ptah-electron/src/services/diagnostics/process-lifecycle-recorder.ts`;
    `libs/backend/vscode-core/src/diagnostics/main-loop-watchdog.ts`, `main-loop-watchdog-source.ts`,
    `background-work-governor.ts`; `libs/backend/platform-core/src/interfaces/workspace-watcher.interface.ts`,
    `src/utils/workspace-change-coalescer.ts`, `src/utils/event-storm-breaker.ts`,
    `src/workspace-watch/workspace-watch-host-core.ts`, `src/workspace-watch/workspace-watch-protocol.ts`,
    `src/testing/contracts/run-workspace-watcher-contract.ts`;
    `libs/backend/platform-electron/src/workspace-watch/{electron-workspace-watcher,workspace-watch-host.entry}.ts`;
    `libs/backend/platform-cli/src/{implementations/cli-workspace-watcher,workspace-watch/workspace-watch-host.entry}.ts`;
    `libs/backend/platform-vscode/src/implementations/vscode-workspace-watcher.ts`;
    `apps/ptah-electron/src/services/platform/electron-workspace-watch-host-factory.ts`;
    stress specs `apps/ptah-electron/src/services/git-watcher.stress.spec.ts`,
    `libs/backend/platform-electron/src/workspace-watch/workspace-watch-host.stress.spec.ts`; all listed `*.spec.ts`.
  - MODIFY: `libs/shared/src/lib/constants/workspace-scan.constants.ts`, `libs/shared/src/lib/utils/index.ts`,
    `libs/shared/src/index.ts`, `libs/shared/src/lib/types/messages/payload-map.ts`,
    `libs/shared/src/lib/types/rpc/rpc-chat.types.ts`, `libs/shared/src/lib/types/rpc/rpc-degradation.types.ts`;
    `libs/backend/workspace-intelligence/src/file-indexing/{workspace-default-excludes,workspace-file-index.service}.ts`,
    `libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts`;
    `libs/backend/vscode-core/src/{utils/worktree-path.ts,utils/exec-git.ts,services/git-info.service.ts,diagnostics/event-loop-monitor.ts,diagnostics/arm-diagnostics.ts,diagnostics/index.ts,di/tokens.ts,di/register-platform-agnostic.ts}`;
    `libs/backend/agent-sdk/src/lib/{helpers/worktree-hook-handler.ts,helpers/off-thread-process-spawner.ts,helpers/off-thread-process-spawner-source.ts,helpers/session-turn-state.registry.ts,internal-query/internal-query.service.ts,session-history-reader.service.ts,di/register.ts}`;
    `libs/backend/platform-core/src/{di/tokens.ts,index.ts,utils/editor-launcher-detection.ts}`;
    `libs/backend/platform-electron/src/{registration.ts,index.ts}`; platform-cli and platform-vscode registration files;
    `libs/backend/cli-engine` container; `libs/backend/persistence-sqlite/src/lib/{sqlite-connection.service.ts,backup.service.ts}`;
    `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`;
    `libs/frontend/git-ui/src/lib/services/diff-tabs.service.ts`,
    `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`,
    `libs/frontend/chat-streaming/src/lib/message-finalization.service.ts`,
    `libs/frontend/chat-state/src/lib/{tab-manager.service.ts,tab-persistence.ts}`,
    `libs/frontend/core/src/lib/services/message-router.service.ts`;
    `apps/ptah-electron/src/{main.ts,activation/post-window.ts,activation/boot-heavy-services.ts,activation/boot-coordinator.ts,activation/shutdown.ts,activation/plugin-activation.ts,services/git-watcher.service.ts,di/phase-0-platform.ts,di/expected-resolvable.ts,config/esm-bundle-gate.spec.ts}`,
    `apps/ptah-electron/{project.json,electron-builder.yml,package.json,scripts/verify-packed-native.js}`,
    root `package.json`, `eslint.config.mjs`; VS Code and CLI expected-resolvable manifests;
    CLAUDE.md files named in "Maintainability".
  - DELETE (P2): `libs/shared/src/lib/utils/event-storm-breaker.ts` (+ spec) after the move; the
    recursive `fs.watch` path and per-file timer code in `git-watcher.service.ts`; the
    `messages` field/branch (P4).
- **Verification points.**
  - Re-open and confirm before editing: `git-info.service.ts:286-367` flight semantics;
    `exec-git.ts:240-313`; `off-thread-process-spawner.ts:245-314,492-507`; `integrity-worker.ts:65-114`;
    `phase-0-platform.ts:41` options shape; `esm-bundle-gate.spec.ts:153-159`; `project.json`
    worker target shape `:160-186`.
  - Run `ptah_lsp_references` on `FileContentChangedPayload`, `ChatResumeResult.messages`,
    `invalidateReadCache`, `createFileWatcher`, `EventLoopMonitor.onLag` before changing them.
  - Resolve assumptions A1–A5 at the start of the batch that depends on each.
  - After any `project.json` edit: `npx nx reset` before trusting targets, never while another
    executor shares the worktree (root `CLAUDE.md`).
  - Tests via `npx nx run-many -t test -p …` only; confirm the project count header.
  - No new RPC namespace is introduced, so `ALLOWED_METHOD_PREFIXES` is unchanged; the one new
    `DegradationSource` value is appended to both the union and `DEGRADATION_SOURCE_VALUES`.
