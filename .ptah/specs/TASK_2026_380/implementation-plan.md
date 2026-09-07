# Implementation Plan - TASK_2026_380

## Inputs and constraints

- Requirements used: `D:/projects/ptah-extension/.ptah/specs/TASK_2026_380/context.md`
  (measured boot timeline, five ranked root causes, two-track proposal, the two
  fixed user decisions), `D:/projects/ptah-extension/.ptah/specs/TASK_2026_380/task.md`.
- Corrections applied: **two of `context.md`'s findings are refuted by direct
  measurement taken while writing this plan.** Both are recorded in
  _Codebase evidence_ and both change the design. Root cause 4 (the SKILL.md
  marker miss) is not a defect. Root cause 1's cost model is wrong in a way that
  makes the chosen fix _more_ correct, not less.
- Design handoff used: none (no `visual-design-specification.md`,
  `design-handoff.md` or `design-assets-inventory.md` in the task folder).
- Missing decision-critical input: none. `research-report.md` and
  `task-description.md` are absent; neither was needed — every open question was
  answerable from source plus two live measurements.

### The two fixed decisions, restated

1. `PRAGMA quick_check` never runs inline on the main process again. Boot
   consults a persisted last-clean-check record and skips when it is fresh. When
   due, the check runs in a separate process against its own read-only
   connection; the result and timestamp are persisted on completion. Cron owns
   the schedule; boot may trigger the same dispatch but never awaits it.
2. CLI delegation disabled. Sub-agents only.

---

## Codebase evidence

### Measurements taken for this plan (2026-09-06, against the user's real database)

Both were run read-only against `C:\Users\abdal\.ptah\state\ptah.sqlite`
(1 000.7 MB, 256 183 pages) using the repo's own `better-sqlite3` under
`ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe`, because the
binary is compiled for the Electron ABI (143) and will not load under Node 24
(ABI 137) — itself a constraint the worker design has to honour.

| Measurement                                                         | Result                                                                                                                                                                      | Architectural implication                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PRAGMA quick_check` on the 1 000.7 MB file, **warm OS page cache** | **1868 ms**                                                                                                                                                                 | The 20–26 s in the log is NOT the intrinsic cost of the pragma. It is the cost of reading ~1 GB **cold**, at app start, when the page cache is empty. It cannot be optimised away — only relocated off the thread that answers IPC. This is the whole justification for a worker process rather than a faster check.                                                                                             |
| `PRAGMA foreign_key_check` on the same file                         | **27 ms**, 0 violations                                                                                                                                                     | `context.md`'s "index-driven, cheap" claim for `foreign_key_check` is **correct** and now measured. It is 0.14 % of the pair's warm cost.                                                                                                                                                                                                                                                                        |
| `SELECT * FROM skill_md_migration_state`                            | Two rows: `C:\Users\abdal\.ptah\skills` and `…\skills\_candidates`, both `migration_version = 1`, both `last_scan_at = 1788621559007 / …323` = **2026-09-05T15:19:19.007Z** | **Root cause 4 is refuted.** The marker write path works: boot 1 walked and wrote at exactly the log's 15:19:19. Boot 2 (19:54) left `last_scan_at` unchanged — and a marker-skipped pass returns before `writeMarker` (`skill-md-migration.ts:123-130`), so an unchanged timestamp is what a **successful skip** looks like. A boot-2 walk with `errors: []` would have UPSERTed a 19:5x timestamp; it did not. |
| `SELECT MAX(version) FROM schema_migrations`                        | **41**                                                                                                                                                                      | The next migration id is `0042`; `0041` is the highest shipped.                                                                                                                                                                                                                                                                                                                                                  |

### Repository facts

| Evidence                                                                                                                                                                                                                                                                          | Location                                                                                                                                                                                             | Architectural implication                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runBootChecks(db)` runs `quick_check` then `foreign_key_check`, both wrapped in `try/catch`, **never throwing and never marking the connection unavailable**                                                                                                                     | `libs/backend/persistence-sqlite/src/lib/sqlite-connection.service.ts:602-635`                                                                                                                       | The check is advisory today. Its position _before_ migrations is therefore not load-bearing for safety, which is what makes relocating it to a later, out-of-band moment a behaviour-preserving change rather than a weakening.                                                                                                                                                     |
| `runBootChecks(db)` is called from `openAndMigrate` **after** `this.database = db` and **before** the migration runner                                                                                                                                                            | `sqlite-connection.service.ts:210-224`                                                                                                                                                               | `isOpen` is already `true` while the pragma blocks, and the whole call is inside the one `await` the post-window boot makes. Every renderer IPC reply queues behind it.                                                                                                                                                                                                             |
| `journal_mode = WAL`, `busy_timeout = 5000` applied on open                                                                                                                                                                                                                       | `sqlite-connection.service.ts:85-91`                                                                                                                                                                 | WAL permits concurrent readers across processes, so a second read-only connection in a worker can run `quick_check` while the main process reads and writes. This is the technical enabler for A1.                                                                                                                                                                                  |
| `SqliteBackupService` already opens a **second** `better-sqlite3` connection to a file and runs `PRAGMA quick_check` on it, with a three-valued verdict `'ok' \| 'corrupt' \| 'unavailable'` and an explicit rule that an inconclusive check must never be reported as corruption | `libs/backend/persistence-sqlite/src/lib/backup.service.ts:44-53, 231-255`                                                                                                                           | In-lib precedent for both the second connection and the verdict vocabulary. The integrity worker copies this three-valued shape verbatim.                                                                                                                                                                                                                                           |
| The daily backup handler runs `db.backup()` (a full 1 GB copy) **plus** that `quick_check`, `incremental_vacuum` and `optimize` on the main process                                                                                                                               | `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts:207-251`                                                                                                                                     | A second, larger instance of the same fault. **Out of scope here** — recorded as a follow-up in _Architecture-level quality requirements_; the worker this task builds is the thing that makes it a small change later.                                                                                                                                                             |
| `memory-curator` declares its worker-process port **locally**, not in `platform-core`, with the rationale that the lib must not `import 'electron'` and that the host implements the factory                                                                                      | `libs/backend/memory-curator/src/lib/embedder/worker-process.port.ts:1-21`                                                                                                                           | Precedent to follow: the integrity worker's port belongs in `persistence-sqlite`, not `platform-core`. `platform-core` stays a leaf with no worker vocabulary.                                                                                                                                                                                                                      |
| One worker entry (`embedder-worker.ts`) auto-detects its transport — Electron `process.parentPort` (`{ data }`-wrapped) or `node:worker_threads` `parentPort` (raw) — and imports no `electron`                                                                                   | `libs/backend/memory-curator/src/lib/embedder/embedder-worker.ts:33-83`                                                                                                                              | One integrity-worker entry serves both hosts. Copy this transport shim exactly.                                                                                                                                                                                                                                                                                                     |
| `ElectronEmbedderWorkerFactory` forks via `utilityProcess.fork(path, [], { serviceName })` and posts `init` immediately; `CliEmbedderWorkerFactory` does the same over `new Worker(...)`                                                                                          | `apps/ptah-electron/src/services/platform/electron-embedder-worker-factory.ts:44-63`; `libs/backend/cli-engine/src/lib/thoth/cli-embedder-worker-factory.ts:1-40`                                    | Two host factories, one port. Same shape for integrity. `utilityProcess` runs Electron's own Node, so the ABI-143 `better-sqlite3` loads unchanged — a `child_process.fork` of system Node would not.                                                                                                                                                                               |
| Worker bundles are separate esbuild targets with the native/heavy dependency marked `external`                                                                                                                                                                                    | `apps/ptah-electron/project.json` `build-embedder-worker` / `build-voice-worker`; `build` `dependsOn` lists both                                                                                     | `build-integrity-worker` follows this exactly with `external: ["better-sqlite3"]`, and must be added to `build.dependsOn`. `apps/ptah-cli/project.json` already has a `build-embedder-worker` to mirror.                                                                                                                                                                            |
| Worker factory registration site, immediately before `registerPersistenceSqliteServices`                                                                                                                                                                                          | `apps/ptah-electron/src/di/phase-2-libraries.ts:280-310`; CLI mirror `libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts:55-81`                                                       | Exact insertion points. Worker path is derived from `__dirname` in both.                                                                                                                                                                                                                                                                                                            |
| **VS Code never registers `PERSISTENCE_TOKENS.SQLITE_CONNECTION`** — the Thoth-free invariant is lint-enforced                                                                                                                                                                    | `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:79-85`                                                                                                                                       | The "host with no worker factory" case is narrower than `context.md` assumed: VS Code has no SQLite at all, so it has no integrity check to schedule. Only Electron and the CLI matter, and both already ship a worker factory pattern.                                                                                                                                             |
| Migration `0041` documents the keyed-state idiom and why a single-row table would be wrong **there** (per-root key, roots can be repointed)                                                                                                                                       | `libs/backend/persistence-sqlite/src/lib/migrations/0041_skill_md_migration_state.ts:16-35`                                                                                                          | The reasoning inverts for `0042`: the integrity record describes the file it lives in, so `id INTEGER PRIMARY KEY CHECK (id = 1)` is the correct key and a path key would be redundant.                                                                                                                                                                                             |
| `SKILL_MD_MIGRATION_RESCAN_INTERVAL_MS = 24 h`                                                                                                                                                                                                                                    | `libs/backend/skill-synthesis/src/lib/skill-md-migration.ts:56-57`                                                                                                                                   | With the marker proven working, this ceiling is the actual cause of the observed walk: a user who launches Ptah roughly once a day trips it on roughly every launch.                                                                                                                                                                                                                |
| `skippedByMarker` is a single boolean set only at `skill-md-migration.ts:123-124`; the seven distinct reasons a marker fails to short-circuit (`isMarkerCurrent`, `:194-227`) all collapse into `false`                                                                           | `skill-md-migration.ts:88-95, 117, 123-130, 194-227`                                                                                                                                                 | This is why root cause 4 cost an investigation and produced a wrong conclusion. The log line cannot distinguish "no store" from "stale" from "version bumped".                                                                                                                                                                                                                      |
| `SkillTriggerService.start()` calls `void this.runBootScan(...)` **synchronously**, with no timer, no `unref`, no activity re-arm, and no master-switch check                                                                                                                     | `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts:166-169`                                                                                                                     | A2's target. `stop()` only aborts a controller (`:199-200`); there is no `bootScanTimer` to clear.                                                                                                                                                                                                                                                                                  |
| `MemoryTriggerService.scheduleBootScan` is the complete mirror pattern: delay, `unref`, recursive idle-backoff re-arm, `0` disables, abort checked twice                                                                                                                          | `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:864-893`, readers `:895-917`, fields `:98-108`, activity stamp `:269-273`, teardown `:241-245`                               | Copy structurally. Note `onActivity` in `skill-trigger.service.ts:214-234` does **not** stamp an activity instant — the re-arm has no input until one is added above the `idleMs <= 0` guard.                                                                                                                                                                                       |
| `memory.triggers.bootScanDelayMs` / `…IdleBackoffMs` and `skillSynthesis.drain.bootDeferralMs` are declared **only** in their libs' config files and are absent from `FILE_BASED_SETTINGS_KEYS`                                                                                   | `libs/backend/memory-curator/src/lib/triggers/memory-trigger-config.ts:29,34,87,94`; `libs/backend/platform-core/src/file-settings-keys.ts:154-411` (no matching entries)                            | On Electron an unregistered key falls through to an in-memory config object (`libs/backend/platform-electron/src/implementations/electron-workspace-provider.ts:90-102`), so it is read-only-at-default and **silently un-writable**. The file's own comment names this exact failure mode (`file-settings-keys.ts:283-290`). The precedent is a latent gap, not a pattern to copy. |
| `FILE_BASED_SETTINGS_DEFAULTS ⊆ FILE_BASED_SETTINGS_KEYS` is the only parity rule, and it is one-directional                                                                                                                                                                      | `libs/backend/platform-core/src/file-settings-keys.spec.ts:162-170`                                                                                                                                  | Adding both entries for a new key is safe and satisfies the spec.                                                                                                                                                                                                                                                                                                                   |
| `BootCoordinator.readinessState` has exactly two transitions and is **never broadcast**; the coordinator is never registered in DI and is passed as a plain parameter                                                                                                             | `apps/ptah-electron/src/activation/boot-coordinator.ts:188, 221-223, 260-286`; call sites `main.ts:152`, `post-window.ts`, `wire-runtime.ts`, `boot-heavy-services.ts:89`                            | No handler in `libs/backend/rpc-handlers` can see it. A `boot:getReadiness` RPC needs a new port.                                                                                                                                                                                                                                                                                   |
| `MESSAGE_TYPES.BOOT_READINESS_CHANGED`, `BootReadinessChangedPayload`, `rpcReadinessError`, `isRpcReadinessError`, `BACKEND_READINESS_VALUES` have **zero** production callers outside `libs/shared`                                                                              | `message-constants.ts:119`, `message-type.ts:105`, `payload-map.ts:125,316`, `rpc-readiness.types.ts:50,90,109,127`                                                                                  | The vocabulary is complete and dead. This task is purely additive wiring; nothing is deprecated.                                                                                                                                                                                                                                                                                    |
| The payload's own docs commit to "edge-triggered, one message per transition" and "deliberately coarse — no per-subsystem contract"                                                                                                                                               | `message-constants.ts:112-118`; `rpc-readiness.types.ts:83-89`                                                                                                                                       | Widening with a `phase` reverses the letter of both comments. The resolution is in _Architecture decision_; both comments must be rewritten in the same edit, not left contradicting the type.                                                                                                                                                                                      |
| `mainWindow.webContents.once('did-finish-load', …)` is the only window-load signal, and it fires when the **document** finishes loading                                                                                                                                           | `apps/ptah-electron/src/activation/post-window.ts:102-104`                                                                                                                                           | Angular's `bootstrapApplication` and therefore `MessageRouterService`'s `window.addEventListener('message')` are installed _after_ this event. A push sent at `did-finish-load` is still lost. **A pull RPC is mandatory, not belt-and-braces.** `once` also means a renderer reload gets nothing.                                                                                  |
| `ALLOWED_METHOD_PREFIXES` has no `'boot:'`; a missing prefix throws at **registration**, i.e. at boot, unguarded for lib-owned handlers                                                                                                                                           | `libs/backend/vscode-core/src/messaging/rpc-handler.ts:44-90, 159-165, 327-329`; `register-rpc-surface.ts:184`                                                                                       | The dual-registration rule, with the failure being a boot crash rather than a runtime 404.                                                                                                                                                                                                                                                                                          |
| RPC dispatch is a plain `Map<string, handler>`; there is no name-to-method reflection                                                                                                                                                                                             | `rpc-handler.ts:110, 169, 193-215`                                                                                                                                                                   | A new namespace needs a handler class + `static METHODS` + a `manifest.ts` entry that keeps the manifest a **total, disjoint partition** of `RPC_METHOD_NAMES` (`register-rpc-surface.ts:140-142`).                                                                                                                                                                                 |
| `PLATFORM_TOKENS.SESSION_ATTACHMENT_GUARD` documents the exact "real adapter on Electron / Null default registered by `vscode-core` when absent" shape                                                                                                                            | `libs/backend/platform-core/src/di/tokens.ts:73-79`; `libs/backend/vscode-core/src/di/register-platform-agnostic.ts:73-76`; `libs/backend/vscode-core/src/services/null-session-attachment-guard.ts` | The template for the readiness port.                                                                                                                                                                                                                                                                                                                                                |
| `WebviewManager.broadcastMessage<T extends StrictMessageType>(type, payload)` never throws and settles all sends; Electron and CLI register duck-typed adapters under the same symbol                                                                                             | `libs/backend/vscode-core/src/api-wrappers/webview-manager.ts:294-315`; `apps/ptah-electron/src/ipc/webview-manager-adapter.ts:24`; registered `apps/ptah-electron/src/activation/bootstrap.ts:342`  | The broadcast channel. `boot-heavy-services.ts:349-351` already resolves it duck-typed as `{ broadcastMessage(type: string, payload: unknown): Promise<void> }` — reuse that narrow shape.                                                                                                                                                                                          |
| `TOKENS.WEBVIEW_MANAGER` is registered at different points per host, and `phase-4-handlers.ts:78` warns it is registered later in Electron                                                                                                                                        | `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts:35-39`; `apps/ptah-electron/src/di/phase-4-handlers.ts:78`                                                                        | The readiness broadcaster must resolve `WEBVIEW_MANAGER` **lazily at push time**, guarded by `isRegistered`, never in a constructor.                                                                                                                                                                                                                                                |
| **`chat:resume` touches no SQLite.** `ChatSessionService.resumeSession` reads JSONL via `SessionHistoryReaderService` and `SessionMetadataStore` (backed by `PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE`)                                                                            | `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:752`, constructor `:122-…`; `chat-rpc.handlers.ts:219`                                                                       | The log's 5761 ms `chat:resume` is **queue time behind a blocked event loop**, not a persistence wait. A readiness guard on it would be wrong.                                                                                                                                                                                                                                      |
| `session:list`, `config:models-list`, `autocomplete:agents` are likewise not SQLite-backed                                                                                                                                                                                        | `session-metadata-store.ts:253`; `config-rpc.handlers.ts:73-94, 465`; `autocomplete-rpc.handlers.ts:49-58, 75`                                                                                       | Three of the four "slow handlers" in the log are innocent. Same conclusion.                                                                                                                                                                                                                                                                                                         |
| `PersistenceRpcHandlers` is the **only** class in `libs/backend/rpc-handlers` that injects `PERSISTENCE_TOKENS.SQLITE_CONNECTION`, and it already answers unavailability as data                                                                                                  | `persistence-rpc.handlers.ts:148-149, 264-283`; `DbHealthResult` at `libs/shared/src/lib/types/rpc/rpc-persistence.types.ts:40-74`                                                                   | Every other SQLite-backed namespace (`memory:*`, `skillSynthesis:*`, `corpus:*`, `cron:*`, `gateway:*`, `indexing:*`) reaches SQLite through an injected store, so a guard would have to sit at each handler boundary.                                                                                                                                                              |
| TASK_2026_331's Batch 2 was cancelled on a measured probe whose third run used a **copy** of a 997 MB `ptah.sqlite` and recorded `openAndMigrate()` at 1942 ms                                                                                                                    | `.ptah/specs/TASK_2026_331/tasks.md:316-333, 358-373`                                                                                                                                                | A freshly written copy is hot in the page cache. **That probe measured the warm number — 1942 ms against my 1868 ms — and therefore never exercised the cold read the user hit.** The probe was mis-designed, not the premise wrong. The doc's own instruction (`:365-368`) is to rebuild guards only against a run that shows a call inside the window.                            |
| `SessionLoaderService` has a 120 s `chat:resume` timeout and **no retry anywhere**; a resume failure empties the Agents panel with nothing on screen to say why                                                                                                                   | `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:87-98, 583-592, 682-697, 817-871`                                                                                          | Any guard added to `chat:resume` converts a slow-but-correct call into a silent empty panel. Independent of readiness, the log-only failure at `:837-843` is a real UX hole.                                                                                                                                                                                                        |
| The renderer's boot gate awaits only `handleInitialView()`, which reads `window.ptahConfig` and navigates — **no backend I/O**                                                                                                                                                    | `apps/ptah-extension-webview/src/app/app.ts:62-78, 95-131`                                                                                                                                           | Today's spinner is not what the user waits on. The freeze is entirely post-shell-paint. A boot screen driven by `initializationStatus` would change nothing.                                                                                                                                                                                                                        |
| `MessageHandler` is `{ handledMessageTypes: readonly string[]; handleMessage(msg): void }`; `MESSAGE_HANDLERS` is a multi-`InjectionToken`; `MessageRouterService` builds the map at construction and is forced eager by `APP_INITIALIZER`                                        | `libs/frontend/core/src/lib/services/message-router.types.ts:33-39, 49-51`; `message-router.service.ts:23-31, 53-87, 105-115`                                                                        | The registration contract for `BootStatusService`. Eager construction is what lets it issue its first pull RPC without a component.                                                                                                                                                                                                                                                 |
| One renderer bundle serves both hosts; `MESSAGE_HANDLERS` is populated identically in the single `app.config.ts:105-125`                                                                                                                                                          | `apps/ptah-extension-webview/CLAUDE.md` "Same build artifact"; `app.config.ts:112-125`                                                                                                               | `BootStatusService` is constructed under VS Code too and will never receive a push there. **Its initial value must mean "not blocking".**                                                                                                                                                                                                                                           |
| `VSCodeService.isElectron` is a **getter over a signal**, not a signal; `app.ts:47` snapshots it                                                                                                                                                                                  | `libs/frontend/core/src/lib/services/vscode.service.ts:171-173`; `app.ts:47`                                                                                                                         | Host branching in a boot screen must follow the snapshot pattern or it will not react.                                                                                                                                                                                                                                                                                              |
| There is no reusable skeleton or spinner component in `libs/frontend`; the identical skeleton markup is duplicated verbatim in two components                                                                                                                                     | `plugin-status-widget.component.ts:35-44` and `setup-status-widget.component.ts:45-54`; list-row pattern at `memory-curator-ui/.../corpus-list.component.ts:119-122, 227`                            | Extracting one atom is justified by existing duplication, not by this task alone.                                                                                                                                                                                                                                                                                                   |
| `ElectronShellComponent`'s constructor forces `setLayoutMode('grid')`, so the canvas is always the Electron launch surface                                                                                                                                                        | `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:300`                                                                                                                    | The boot screen must cover the canvas, and the Thoth dashboard (whose four SQLite calls TASK_2026_331 measured at 21 s post-open) is not rendered at launch.                                                                                                                                                                                                                        |
| `startThothCron` is the one place `persistence-sqlite` and `cron-scheduler` meet, is runtime-agnostic, is called last in the heavy boot, and already registers a `backup:daily` handler + `jobStore.upsert`                                                                       | `start-thoth-cron.ts:161-307`; called at `boot-heavy-services.ts:370-372`                                                                                                                            | The correct home for the integrity job registration and the deferred boot dispatch.                                                                                                                                                                                                                                                                                                 |
| `bootThothRuntime` awaits `openAndMigrate()` and nothing else; the memory boot scan, skill walk and file index are started, not awaited                                                                                                                                           | `libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts:115-117, 234, 361, 378`; `thoth-runtime/CLAUDE.md` "Guidelines"                                                                            | Removing the pragma from `openAndMigrate` shortens the only awaited step on the whole post-window path.                                                                                                                                                                                                                                                                             |
| `sqlite-connection.service.ts` is 839 lines and `skill-trigger.service.ts` is 922 — both already past the 700-line soft ceiling                                                                                                                                                   | `wc -l`                                                                                                                                                                                              | Neither may grow. The integrity work goes in a new `src/lib/integrity/` folder; A2 adds a small, nameable set of members to the trigger service and nothing else.                                                                                                                                                                                                                   |

---

## Architecture decision

- **Chosen approach.** Three independent changes, in this order of dependency:

  **A1 — relocate integrity checking into a worker process behind a persisted,
  interval-gated record.** `runBootChecks` is deleted from
  `SqliteConnectionService`. A new `src/lib/integrity/` folder in
  `persistence-sqlite` owns: migration `0042` + a single-row state store, a
  locally-declared `IIntegrityWorkerProcessFactory` port, a dual-transport
  `integrity-worker.ts` entry that opens its own **read-only** connection, and a
  `SqliteIntegrityService` that answers "is it due" and dispatches
  fire-and-forget. `thoth-runtime`'s `startThothCron` registers a nightly cron
  job and an `unref`'d, delayed boot dispatch — both calling the same
  `dispatchIfDue()`. Electron and the CLI each register a host factory over the
  same bundled worker.

  **A2 — arm the skill boot scan instead of running it.**
  `skillSynthesis.triggers.bootScanDelayMs` (default 300 000) and
  `…bootScanIdleBackoffMs` (default 300 000), mirroring
  `MemoryTriggerService.scheduleBootScan` member for member, including the
  activity stamp that `SkillTriggerService` currently lacks. Both keys are
  registered in `FILE_BASED_SETTINGS_KEYS` **and** `FILE_BASED_SETTINGS_DEFAULTS`.

  **A3 — raise the SKILL.md rescan ceiling and make the marker outcome
  legible.** There is no defect. `SKILL_MD_MIGRATION_RESCAN_INTERVAL_MS` goes
  from 24 h to 7 d, and `MigrationResult` gains a `markerOutcome` reason token
  plus a `markerWritten` boolean so one log line answers "why did it walk".

  **B1–B3 — a real boot signal and a boot screen driven by it.** A new
  `PLATFORM_TOKENS.BOOT_READINESS` port with an Electron adapter over
  `BootCoordinator` and a `vscode-core` null adapter; a widened
  `BootReadinessChangedPayload` carrying a **display-only** `phase`; a
  `BootReadinessBroadcaster` in the Electron app that pushes on each transition
  and a `boot:getReadiness` RPC that answers the renderer's first read; a
  `BootStatusService` in `libs/frontend/core` defaulting to `ready`; and a
  phase-driven boot screen plus two panel skeletons.

  **B4 — narrowed to the signal; no handler guards ship in this task.** See
  _Rejected alternatives_.

- **Rationale.**

  _Why a worker and not a faster check._ The pragma is 1868 ms warm and ~25 s
  cold on the same file. The difference is 1 GB of cold disk reads. No algorithm
  removes that; only moving it off the thread that answers IPC does. A worker
  process also isolates a native crash, which is why the two existing workers in
  this repo are processes and not inline code.

  _Why `utilityProcess` / `worker_threads` and not `child_process.fork`._
  `better-sqlite3` in this tree is compiled for the Electron ABI (143) — proven
  by the load failure under Node 24 (ABI 137) recorded above, and by
  `apps/ptah-electron/CLAUDE.md`'s `rebuild-native` note. `utilityProcess` runs
  Electron's own Node, so the same binary loads. A fork of system Node would
  not. The CLI runs plain Node and already ships an ABI-matched build, so
  `worker_threads` is correct there — and a worker thread still keeps the
  synchronous pragma off the main JS thread.

  _Why the record lives in the database._ The record describes the file it lives
  in. Putting it in `IStateStorage` would let a `PTAH_DB_PATH` change carry one
  file's verdict onto another — the exact failure `0041`'s per-root key exists to
  prevent, inverted. Because the table lives inside the file, no key is needed:
  `id INTEGER PRIMARY KEY CHECK (id = 1)` is correct here where it would have
  been wrong in `0041`.

  _Why reading the record after migrations is safe._ `runBootChecks` catches
  everything and never marks the connection unavailable
  (`sqlite-connection.service.ts:602-635`). The check has never gated anything,
  so its position before the migration runner was never load-bearing. Moving it
  after migrations — and off the boot path entirely — changes when a _log line_
  appears, not what the system trusts.

  _Why `foreign_key_check` goes with it anyway._ It measures 27 ms, so keeping it
  inline would cost almost nothing. It moves for two reasons that are not about
  cost. First, 27 ms is a measurement of _this_ database with _this_ row count;
  it is a scan of every foreign-key-bearing child table, so it is unbounded in
  the same direction as the file. Second, leaving one of two integrity checks
  inline means the boot path still holds a synchronous whole-table read, and the
  rule this task is establishing — "no unbounded synchronous database work on the
  activation path" — is worth more than 27 ms of latency in the reported record.
  One worker, one record, one policy.

  _Why the phase label reverses two doc comments and that is acceptable._ Both
  comments (`message-constants.ts:112-118`, `rpc-readiness.types.ts:83-89`) argue
  against a _contract_ that says what became available, because such a contract
  must be maintained against every subsystem the boot ever gains. The `phase`
  added here makes no such claim: it is a **display label with no consumer
  semantics**, and a caller that wants to know what is available still re-issues
  its call. The message also stays edge-triggered — one message per phase
  transition, not one per boot step. Both comments are rewritten in the same edit
  to say this, so the type and its documentation do not disagree.

  _Why the phase vocabulary is host-observable only._ `thoth-runtime` is
  runtime-agnostic and must not know a renderer exists. A `skills` phase would
  have to be emitted from inside `bootThothRuntime`. The vocabulary is therefore
  drawn from transitions the Electron host can honestly observe at its own call
  sites, and `skills` is deliberately absent.

- **Rejected alternatives.**
  1. _Record the daily backup's `quick_check` verdict and delete the boot check
     entirely._ `SqliteBackupService.checkIntegrity` (`backup.service.ts:231-255`)
     already validates a copy, which transitively answers the question about the
     source. Rejected because it couples integrity reporting to backup success,
     and because `db.backup()` writes a full 1 GB — it is a far more expensive
     way to learn the same thing, so it cannot substitute for a cheap scheduled
     check. The integrity worker built here should later absorb the backup's
     validation pass; that is named as a follow-up, not done now.
  2. _Run the check inline on a `setImmediate` after readiness instead of a
     worker._ Rejected by the measurement: 25 s of cold reads on the main thread
     is 25 s of blocked IPC whenever it lands, and `setImmediate` only chooses
     _when_ the block happens. It also contradicts decision 1.
  3. _Put the worker port in `platform-core`._ Rejected on precedent
     (`memory-curator`, `voice-providers` both keep theirs local) and on the leaf
     rule in `platform-core/CLAUDE.md`. `platform-core` gains exactly one thing
     in this task — the readiness port — because that one genuinely is a platform
     capability with three host answers.
  4. _Follow the memory precedent and leave the new settings keys out of
     `FILE_BASED_SETTINGS_KEYS`._ Rejected: the file documents that an
     unregistered key is read-correct and write-dropped
     (`file-settings-keys.ts:283-290`), and `memory.triggers.bootScanDelayMs`
     is that bug, not that pattern.
  5. _Guard the SQLite-backed handlers with `rpcReadinessError` (context.md B4 as
     written)._ Rejected on evidence, in three independent ways.
     - `chat:resume` and `session:list` are not SQLite-backed
       (`chat-session.service.ts:752`, `session-metadata-store.ts:253`), so a
       persistence guard on them is a category error. `chat:resume` in particular
       would trade a slow correct answer for an instantly empty Agents panel
       (`session-loader.service.ts:87-98, 682-697`).
     - While `quick_check` holds the thread the RPC dispatcher itself cannot
       run, so `rpcReadinessError` is **unreachable** in exactly the window that
       motivated it. A1 is the only thing that fixes that window.
     - After A1 the awaited boot step is the migration runner, which the
       TASK_2026_331 probe measured at under 2 s against the first renderer call
       at ~6–7 s. The window closes before any call arrives.
       What ships instead is the readiness _signal_ (needed by B2/B3 regardless)
       plus a **re-measurement gate**: re-run
       `apps/ptah-electron-e2e/scripts/measure-boot-rpcs.mjs` after A1, **with a
       cold page cache**, and add guards only for methods that run shows inside the
       window. This is TASK_2026_331's own instruction
       (`tasks.md:365-368`) applied with a corrected probe.
  6. _Split `SkillTriggerService` to stay under `max-lines`._ Rejected: A2 adds
     one field, one stamp line, one `scheduleBootScan` and two readers — a
     nameable, cohesive addition to a concern the class already owns. Extracting
     a ~60-line "boot scan scheduler" collaborator would fail the ≥150-line
     guardrail and push an 18th constructor dependency. The file's size is a
     pre-existing debt this task neither worsens meaningfully nor is scoped to
     repay.

- **Assumptions.**
  1. _A read-only `better-sqlite3` connection can open the WAL database while the
     main process holds it open._ WAL permits it and my measurement ran
     read-only, but with the app **not** running. **Check:** the worker must
     classify any open failure as `unavailable` and write **no** record — never a
     `corrupt` verdict — exactly as `backup.service.ts:44-53` already does. Verify
     with the app running before closing the batch.
  2. _`cli-engine` calls `startThothCron`._ If it does not, the CLI simply never
     dispatches an integrity check, which is an acceptable degrade for a
     short-lived process. **Check:** grep `startThothCron` under
     `libs/backend/cli-engine/src`; if absent, state it in the batch notes rather
     than adding a second dispatch site.
  3. _`rpc.types.ts` line anchors_ (`chat:resume` registry entry ~`:629`,
     `RPC_METHOD_ENTRIES` ~`:3391`, `RPC_METHOD_NAMES` ~`:3805`) come from a
     directed sub-agent read rather than my own. **Check:** open the file before
     editing; the compile error on a missing `RPC_METHOD_ENTRIES` key is the
     backstop either way.
  4. _`context.md`'s "`skippedByMarker:false` on both boots"_ is contradicted by
     the live table. **Check:** if the full log genuinely shows a boot-2 walk
     with `errors: []`, the `markerOutcome` token added by A3 will name the cause
     on the very next launch — which is the point of adding it.

- **Effect on existing code.**
  - **Replaced:** `runBootChecks` and its call site are **deleted**, not disabled,
    flagged or kept beside a new path.
  - **Replaced:** `SkillTriggerService.start()`'s direct `runBootScan` call is
    replaced by `scheduleBootScan`. The old call does not survive behind a flag;
    `bootScanDelayMs: 0` is the documented way to get the old behaviour, matching
    memory's contract.
  - **Widened, not forked:** `BootReadinessChangedPayload` gains fields. No `V2`
    payload, no parallel message type.
  - **Collapsed:** `BootCoordinator`'s local `BootReadiness`
    (`boot-coordinator.ts:62`) is replaced by an import of the shared
    `BackendReadiness`. The duplicate declaration goes away.
  - **Untouched:** `PersistenceRpcHandlers`, `SessionRpcHandlers`,
    `WorkspaceRpcHandlers`, `rpc-session.types.ts`, `electron-layout.service.ts`
    — all named as off-limits by TASK_2026_331 `tasks.md:370-373`, and nothing
    here needs them.
  - **Corrected in place:** the two doc comments the phase widening contradicts.

---

## Component specifications

### 1. Integrity check state — migration `0042` + `IntegrityCheckStateStore`

- **Purpose:** persist the one record that answers "when was this database last
  checked, and what did the check say".
- **Responsibilities:** create the table; read the record; upsert it. Nothing
  else — no scheduling, no interpretation of freshness.
- **Verified contracts and entry points:** `MIGRATIONS` tuple and `Migration`
  type (`libs/backend/persistence-sqlite/src/lib/migrations/index.ts`, highest
  shipped version `41`, live DB confirms `MAX(version) = 41`); static-SQL rule
  and `CREATE TABLE IF NOT EXISTS` idempotence
  (`0041_skill_md_migration_state.ts:60-65`); store shape to mirror —
  `libs/backend/skill-synthesis/src/lib/skill-md-migration-state.store.ts:38-97`
  (static `SELECT`/`UPSERT` constants, `read` returns `null` on any failure,
  `write` swallows into a `logger.warn`, private `db` getter over
  `connection.db`).
- **Schema:** single row, keyed `id INTEGER PRIMARY KEY CHECK (id = 1)`, because
  the record describes the file it lives in. Columns: `checked_at INTEGER NOT
NULL` (epoch ms), `quick_check_ok INTEGER NOT NULL`, `foreign_key_violations
INTEGER NOT NULL`, `duration_ms INTEGER NOT NULL`, `page_count INTEGER NOT
NULL`, `detail TEXT` (nullable — the only unknown value the record can carry).
  Absence of the row means "never checked", exactly as `0041` treats it.
- **Dependencies:** `PERSISTENCE_TOKENS.SQLITE_CONNECTION`, `TOKENS.LOGGER`.
  Direction: inward only; the store imports nothing new.
- **Integration points:** read by component 3; written by component 3 on worker
  completion.
- **Failure behaviour:** every method degrades. `read` returns `null` on any
  throw (a missing record can only cause a check to _run_, never to be skipped);
  `write` warns and swallows. `connection.db` throws `PERSISTENCE_UNAVAILABLE`
  when closed, and the store must absorb that — same contract as
  `skill-md-migration-state.store.ts:14-19`.
- **Quality requirements:** SQL must stay static — no `${…}` interpolation
  (ESLint `no-template-curly-in-migration`, Semgrep
  `sql-injection-in-migration`).
- **Verification seam:** the migration spec applies the SQL twice against an
  in-memory database and asserts idempotence and column shape; the store spec
  drives a stub connection and asserts read-degrades-to-`null` and
  write-swallows.
- **Files:**
  - CREATE `D:/projects/ptah-extension/libs/backend/persistence-sqlite/src/lib/migrations/0042_db_integrity_check_state.ts`
  - CREATE `D:/projects/ptah-extension/libs/backend/persistence-sqlite/src/lib/migrations/0042_db_integrity_check_state.spec.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/persistence-sqlite/src/lib/migrations/index.ts` (append only)
  - CREATE `D:/projects/ptah-extension/libs/backend/persistence-sqlite/src/lib/integrity/integrity-check-state.store.ts`
  - CREATE `D:/projects/ptah-extension/libs/backend/persistence-sqlite/src/lib/integrity/integrity-check-state.store.spec.ts`

### 2. Integrity worker — entry, protocol and host port

- **Purpose:** run `PRAGMA quick_check` and `PRAGMA foreign_key_check` against a
  private read-only connection, in a process that is not the host's main thread,
  and report one result.
- **Responsibilities:** transport detection; open read-only; run both pragmas
  with timings; post one result; exit. It does not decide whether it should run,
  does not read settings, and does not write to the database.
- **Verified contracts and entry points:** transport shim to copy verbatim —
  `libs/backend/memory-curator/src/lib/embedder/embedder-worker.ts:33-83`
  (Electron `process.parentPort` delivers `{ data }`, `node:worker_threads`
  `parentPort` delivers the raw payload; no `electron` import); port shape and
  rationale — `libs/backend/memory-curator/src/lib/embedder/worker-process.port.ts:9-20`;
  three-valued verdict precedent — `backup.service.ts:44-53`; `SqliteDatabase` /
  `SqliteDatabaseFactory` types exported from
  `persistence-sqlite/src/index.ts:10-16`.
- **Protocol** (`integrity-worker-protocol.ts`, mirroring
  `embedder-worker-protocol.ts`):
  - request `{ id, type: 'check', dbPath: string }`
  - response `{ id, ok: true, verdict: 'ok' | 'corrupt' | 'unavailable', quickCheck: string, foreignKeyViolations: number, durationMs: number, pageCount: number, detail: string | null }`
  - response `{ id, ok: false, error: string }`
    The worker declares `better-sqlite3` as an external and resolves it at runtime;
    a failure to load is `verdict: 'unavailable'`, never `'corrupt'`.
- **Dependencies:** `better-sqlite3` (external, ABI-matched by the host).
  Depends on nothing in the monorepo except its own protocol module, so it stays
  bundleable in isolation.
- **Integration points:** spawned by the host factories (component 4); driven by
  component 3.
- **Failure behaviour:** an open failure, a missing native module, a locked file
  or a thrown pragma all resolve to `'unavailable'`, and component 3 writes **no
  record** for an `unavailable` verdict — so an inconclusive check re-runs rather
  than being recorded as clean. A `'corrupt'` verdict is reserved for
  `quick_check` returning something other than `'ok'`. This is
  `backup.service.ts:44-53`'s rule, restated: deleting confidence on an
  inconclusive check is worse than the fault it would report.
- **Quality requirements:** must not import `electron`; must open with
  `readonly: true` and `fileMustExist: true`; must never write.
- **Verification seam:** the protocol module and the verdict-classification
  function are pure and unit-tested. The worker entry itself is exercised
  end-to-end by component 3's spec through a fake factory — the same way
  `embedder-worker-client.spec.ts` drives the embedder.
- **Files:**
  - CREATE `…/persistence-sqlite/src/lib/integrity/integrity-worker-protocol.ts`
  - CREATE `…/persistence-sqlite/src/lib/integrity/integrity-worker.ts`
  - CREATE `…/persistence-sqlite/src/lib/integrity/worker-process.port.ts`
    (`IIntegrityWorkerProcess`, `IIntegrityWorkerProcessFactory`)

### 3. `SqliteIntegrityService` — the due-decision and the dispatch

- **Purpose:** the single owner of "is an integrity check due, and if so, run one
  out of band".
- **Responsibilities:** read the record; apply the interval rule; single-flight
  dispatch to the worker; persist the result; log one structured line. It never
  blocks a caller and is never awaited on the activation path.
- **Verified contracts and entry points:** `PERSISTENCE_TOKENS`
  (`persistence-sqlite/src/lib/di/tokens.ts:10-33`) gains
  `INTEGRITY_WORKER_PROCESS_FACTORY` and `INTEGRITY_WORKER_PATH`, following the
  existing `EMBEDDER_WORKER_PATH` entry exactly; registered in
  `registerPersistenceSqliteServices`
  (`persistence-sqlite/src/lib/di/register.ts:32-56`); the factory is injected
  `{ isOptional: true }`, matching how `memory-curator` treats an absent host
  factory.
- **Due rule (`DB_INTEGRITY_CHECK_INTERVAL_MS = 7 days`):** due when there is no
  record; when `now - checked_at >= interval`; when `checked_at > now` (clock
  skew — the same "I cannot date this" reasoning as
  `skill-md-migration.ts:222-225`); or when the last recorded verdict was not
  `'ok'`. Not due otherwise.
- **Dependencies:** `TOKENS.LOGGER`, `PERSISTENCE_TOKENS.SQLITE_DB_PATH`,
  component 1's store, component 2's port (optional). Direction: inward within
  `persistence-sqlite`; no new cross-lib edge.
- **Integration points:** called by component 5 from two places (cron handler,
  delayed boot dispatch). Exposes exactly `isDue(now?)` and `dispatchIfDue()`.
- **Failure behaviour:** `dispatchIfDue()` **never throws and never rejects**. No
  factory registered ⇒ logs once at `info` and returns without dispatching (the
  documented degrade, matching the embedder's BM25 fallback). Worker exit before
  a result, or an `error` response, or an `unavailable` verdict ⇒ warn, **no
  record written**, so the next window retries. A dispatch already in flight ⇒
  no-op. The worker is killed after a bounded budget so it cannot outlive the
  host.
- **Quality requirements:** the dispatch must be `unref`-safe and must not keep
  the process alive; `catch (error: unknown)` throughout.
- **Verification seam:** service spec against a fake factory, asserting **call
  counts, not timings**: due-with-no-record dispatches once; a record 6 days old
  dispatches zero times; a record 8 days old dispatches once; a failed prior
  verdict dispatches regardless of age; two concurrent `dispatchIfDue()` calls
  produce one spawn; an `unavailable` verdict writes zero records; a clean
  verdict writes exactly one.
- **Files:**
  - CREATE `…/persistence-sqlite/src/lib/integrity/integrity-check.service.ts`
  - CREATE `…/persistence-sqlite/src/lib/integrity/integrity-check.service.spec.ts`
  - MODIFY `…/persistence-sqlite/src/lib/di/tokens.ts`
  - MODIFY `…/persistence-sqlite/src/lib/di/register.ts`
  - MODIFY `…/persistence-sqlite/src/index.ts` (export the service, the state
    types and the port with `export type` for types)
  - **REWRITE (deletion) `…/persistence-sqlite/src/lib/sqlite-connection.service.ts`:**
    remove `runBootChecks` (`:602-635`) and its call (`:214`). No other change to
    this file.

### 4. Host integrity worker factories + build targets

- **Purpose:** give each host the one implementation of
  `IIntegrityWorkerProcessFactory` its runtime supports, and bundle the worker.
- **Responsibilities:** fork/spawn, adapt the event surface, hand back the
  process handle. No policy.
- **Verified contracts and entry points:**
  `apps/ptah-electron/src/services/platform/electron-embedder-worker-factory.ts:44-63`
  (utilityProcess, `serviceName`, immediate init post) and
  `libs/backend/cli-engine/src/lib/thoth/cli-embedder-worker-factory.ts:14-40`
  (worker_threads) are the two templates. Registration sites:
  `apps/ptah-electron/src/di/phase-2-libraries.ts:280-310` (insert beside the
  embedder factory at `:306-308`, before `registerPersistenceSqliteServices` at
  `:310`) and `libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts:55-81`
  (insert beside `:77-79`). Worker path is derived from `__dirname` in both, as
  those sites already do.
- **Build:** `build-integrity-worker` in `apps/ptah-electron/project.json`,
  copied from `build-embedder-worker` with
  `main: libs/backend/persistence-sqlite/src/lib/integrity/integrity-worker.ts`,
  `outputFileName: integrity-worker.mjs`, `external: ["better-sqlite3"]`, and its
  own `tsconfig.integrity-worker.json`. It **must** be added to the `build`
  target's `dependsOn` list beside `build-embedder-worker` and
  `build-voice-worker`. Same target in `apps/ptah-cli/project.json`, added to its
  `build` chain.
- **Dependencies:** `electron` (Electron only), `node:worker_threads` (CLI only).
  Neither leaks into `persistence-sqlite`.
- **Integration points:** DI registration under
  `PERSISTENCE_TOKENS.INTEGRITY_WORKER_PROCESS_FACTORY` plus a `useValue` path
  under `INTEGRITY_WORKER_PATH`.
- **Failure behaviour:** a failed registration is caught and logged non-fatally
  at the existing try/catch that already wraps both sites; the service then sees
  no factory and degrades.
- **Quality requirements:** the packaged worker must load the ABI-143
  `better-sqlite3`. `verify-packed-native.js` already asserts the packed binary's
  ABI; no new gate is needed, but a packaged smoke run is a verification point.
- **Verification seam:** a spec asserting the Electron factory calls
  `utilityProcess.fork` with the configured path and returns a handle whose
  `on('exit')` maps the numeric code — mirroring the embedder factory's coverage.
  The real end-to-end path is covered by the packaged run.
- **Files:**
  - CREATE `D:/projects/ptah-extension/apps/ptah-electron/src/services/platform/electron-integrity-worker-factory.ts`
  - CREATE `D:/projects/ptah-extension/libs/backend/cli-engine/src/lib/thoth/cli-integrity-worker-factory.ts`
  - CREATE `D:/projects/ptah-extension/apps/ptah-electron/tsconfig.integrity-worker.json`
  - MODIFY `D:/projects/ptah-extension/apps/ptah-electron/project.json`
  - MODIFY `D:/projects/ptah-extension/apps/ptah-cli/project.json`
  - MODIFY `D:/projects/ptah-extension/apps/ptah-electron/src/di/phase-2-libraries.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts`

### 5. Integrity scheduling seam in `thoth-runtime`

- **Purpose:** own _when_ the check is considered, in the one runtime-agnostic
  place where persistence and cron already meet.
- **Responsibilities:** register a nightly cron job whose handler calls
  `dispatchIfDue()`; arm one `unref`'d, delayed boot dispatch that calls the same
  method. Nothing else.
- **Verified contracts and entry points:** `startThothCron`
  (`libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts:161-307`) already
  guards on `refs.sqliteConnection !== null` and `CRON_TOKENS.CRON_SCHEDULER`,
  registers handlers through `handlerRegistry.register(name, async (ctx) => …)`
  guarded by `has()` (`:206`, `:103`), and upserts jobs via
  `jobStore.upsert({ id, name, cronExpr, timezone, prompt: 'handler:<name>', enabled })`
  (`:253-260`). A handler returns `{ summary }` or `{ outcome: 'skipped', reason }`
  (`:125-129`). The seam rule — `persistence-sqlite` must never import
  `cron-scheduler` — is stated at `:30-40`. Called from
  `boot-heavy-services.ts:370-372`, last in the heavy boot.
- **Cron expression:** `30 3 * * *` UTC. Deliberately not `0 3` (the daily
  backup, `:256`) and not `0 4` (the weekly skills drain, `:76`) — an integrity
  read must not contend with a 1 GB backup write on the same tick.
- **Boot dispatch:** a `setTimeout` of `INTEGRITY_BOOT_DISPATCH_DELAY_MS`
  (60 000), `unref`'d, calling `dispatchIfDue()` and ignoring its result. Sixty
  seconds is chosen so the dispatch cannot land inside the window A2 is clearing;
  it is not a tuning knob and is not a setting.
- **Dependencies:** resolves `PERSISTENCE_TOKENS.SQLITE_INTEGRITY_SERVICE`
  through the container, guarded by `isRegistered`. `thoth-runtime` already
  imports `PERSISTENCE_TOKENS` (`start-thoth-cron.ts:5-8`), so no new edge.
- **Integration points:** the cron job id `@ptah/db-integrity-check` appears in
  the existing `cron:list` surface for free.
- **Failure behaviour:** the whole block is wrapped in the file's existing
  non-fatal try/catch idiom — a failure degrades to "no integrity job" and never
  aborts cron start or host activation.
- **Quality requirements:** must not `await` the dispatch anywhere.
- **Verification seam:** `start-thoth-cron.spec.ts` drives the hand-rolled
  container stub (per `thoth-runtime/CLAUDE.md`) and asserts: the handler is
  registered once across two `startThothCron` calls; the job is upserted with the
  expected id and expression; the boot timer is `unref`'d and calls
  `dispatchIfDue` exactly once; a container without the integrity service
  registers nothing and throws nothing.
- **Files:**
  - MODIFY `D:/projects/ptah-extension/libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/thoth-runtime/src/lib/start-thoth-cron.spec.ts`

### 6. Skill boot-scan deferral

- **Purpose:** move ~45 session enqueues and ~90 s of main-thread stutter out of
  the first minute after launch.
- **Responsibilities:** arm the boot scan rather than run it; re-arm while
  foreground chat is active; clear on stop.
- **Verified contracts and entry points:** the defect —
  `skill-trigger.service.ts:166-169`. The mirror —
  `memory-trigger.service.ts:864-893` (`scheduleBootScan`), `:895-917`
  (`readBootScanDelayMs`, `readBootScanIdleBackoffMs`, `readPositiveMs` with its
  "`0` is a legal value" rule), `:98-108` (`bootScanTimer`, `lastActivityAt`
  documented as `null`-not-`0`), `:269-273` (the stamp above the `idleMs` guard),
  `:241-245` (teardown order). Key/default tables —
  `skill-trigger-config.ts:6-24` and `:26-44`. Settings registration —
  `platform-core/src/file-settings-keys.ts:342-348` (KEYS) and `:595-601`
  (DEFAULTS).
- **Additions to `SkillTriggerService`:** `bootScanTimer` field;
  `lastActivityAt: number | null` field; one stamp line at the **top** of
  `onActivity` (`:214`), above the `idleMs <= 0` early return at `:217`;
  `scheduleBootScan`; `readBootScanDelayMs`; `readBootScanIdleBackoffMs`;
  `readPositiveMs`. `start()`'s `:166-169` calls `scheduleBootScan`. `stop()`
  clears the timer before aborting the controller and nulls `lastActivityAt`.
  **No new constructor parameter** — the 17-arg constructor is built positionally
  by two specs (`skill-trigger.service.spec.ts`,
  `skill-trigger.integration.spec.ts`) and must not move.
- **Settings:** `skillSynthesis.triggers.bootScanDelayMs` (300 000) and
  `skillSynthesis.triggers.bootScanIdleBackoffMs` (300 000) added to
  `SKILL_TRIGGER_KEYS`/`SKILL_TRIGGER_DEFAULTS`, kept **out** of
  `SKILL_TRIGGER_PREFIXES` and the settings-panel DTO (they are cost/latency
  knobs, matching `memory-trigger-config.ts:22-28`), and added to **both**
  `FILE_BASED_SETTINGS_KEYS` and `FILE_BASED_SETTINGS_DEFAULTS` so a write is not
  silently dropped.
- **Dependencies:** none new. The service already injects
  `PLATFORM_TOKENS.WORKSPACE_PROVIDER` (`:104-105`).
- **Integration points:** none outside the service; the drain's existing
  `skillSynthesis.drain.bootDeferralMs` row filter is unchanged and composes with
  this — the scan now enqueues later, and the drain still holds the rows.
- **Failure behaviour:** an aborted signal at either check skips the scan; a
  pending timer is `unref`'d so it cannot hold the process alive; `0` for either
  key restores the previous behaviour explicitly.
- **Quality requirements:** the boot scan must not start before
  `bootScanDelayMs`, measured by call count under a fake clock, never by
  wall-clock timing.
- **Verification seam:** a new `skill-trigger.boot-defer.spec.ts` modelled on
  `memory-trigger.boot-defer.spec.ts` — six cases: nothing enqueued
  synchronously from `start()`; enqueued once after the delay; re-armed and
  deferred when activity arrives, then run after a full backoff; `stop()` cancels
  a pending scan; `delayMs: 0` runs immediately; `backoffMs: 0` ignores activity.
  Use that file's `advance` / `advanceUntil` helpers and
  `jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })` verbatim —
  `BootScanRunner` awaits real `fs` completions.
- **Files:**
  - MODIFY `D:/projects/ptah-extension/libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/skill-synthesis/src/lib/triggers/skill-trigger-config.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/skill-synthesis/src/lib/triggers/skill-trigger-config.spec.ts`
  - CREATE `D:/projects/ptah-extension/libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.boot-defer.spec.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/platform-core/src/file-settings-keys.ts`

### 7. SKILL.md rescan policy + marker diagnostics

- **Purpose:** stop a once-a-day launch pattern from tripping a 24 h ceiling on
  essentially every launch, and make the next such investigation cost one log
  line instead of a database query.
- **Responsibilities:** widen the interval; report _why_ a walk happened and
  whether the marker was stored.
- **Verified contracts and entry points:**
  `SKILL_MD_MIGRATION_RESCAN_INTERVAL_MS` (`skill-md-migration.ts:56-57`);
  `isMarkerCurrent` (`:194-227`) with its seven distinct false-returning paths;
  the write gate (`:178-184`) and `writeMarker` (`:229-251`); `MigrationResult`
  (`:84-95`) and the single assignment of `skippedByMarker` (`:123-124`); the two
  call sites that spread the result into a log line
  (`skill-synthesis.service.ts:349-369`). **Live-data correction:** the marker
  rows exist, are version-1 and were written by the walk the log records — the
  mechanism is not broken.
- **Changes:**
  1. `SKILL_MD_MIGRATION_RESCAN_INTERVAL_MS` → `7 * 24 * 60 * 60 * 1000`, with a
     comment recording the measurement that justifies it (the transform is
     one-time and idempotent; the ceiling exists only to pick up files edited
     outside Ptah, and a week-late pickup of a missing `when_to_use:` line is not
     a correctness failure).
  2. `MigrationResult` gains
     `markerOutcome: 'current' | 'no-store' | 'absent' | 'version-mismatch' | 'stale' | 'future-stamped' | 'unreadable'`
     and `markerWritten: boolean`. `isMarkerCurrent` returns the token instead of
     a boolean; `skippedByMarker` becomes `markerOutcome === 'current'` and is
     kept for wire compatibility with the existing log consumers.
  3. `writeMarker` returns whether it stored anything, so a silently-dropped
     write is distinguishable from a walk that never tried.
- **Dependencies:** none new. `SkillMdMigrationMarkerStore` stays declared in
  this module (`:77-82`).
- **Integration points:** the two `logger.info` lines at
  `skill-synthesis.service.ts:354-358` and `:365-369` already spread the whole
  result, so both new fields reach the log with no call-site change.
- **Failure behaviour:** unchanged and non-negotiable — the marker may only ever
  cause a walk, never wrongly prevent one. Every new token maps to "walk" except
  `'current'`.
- **Quality requirements:** the existing seven-mutation ledger in
  `skill-md-migration.marker.spec.ts`'s header must be updated, not bypassed.
- **Verification seam:** extend `skill-md-migration.marker.spec.ts` with one case
  per `markerOutcome` token, each asserting the token **and** that
  `readdirSync`/`readFileSync` ran (or did not) — the file's own
  call-counts-not-timing rule (`:5-7`). Add a case where the store's `write`
  throws and assert `markerWritten === false` with `errors: []` — the exact
  signature that would have settled this investigation from the log.
- **Files:**
  - MODIFY `D:/projects/ptah-extension/libs/backend/skill-synthesis/src/lib/skill-md-migration.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/skill-synthesis/src/lib/skill-md-migration.marker.spec.ts`

### 8. Boot readiness contract widening (`libs/shared`)

- **Purpose:** carry enough for a staged boot screen without turning a display
  label into a subsystem contract.
- **Responsibilities:** the `BootPhase` vocabulary, the widened payload, and the
  `boot:getReadiness` method types.
- **Verified contracts and entry points:** `BackendReadiness` and
  `BACKEND_READINESS_VALUES` (`rpc-readiness.types.ts:47-55`);
  `BootReadinessChangedPayload` (`:90-92`); the payload map entry
  (`payload-map.ts:316`) and the message-type union (`message-type.ts:105`,
  non-exhaustive, so adding is non-breaking); the two doc comments that must be
  rewritten (`message-constants.ts:112-118`, `rpc-readiness.types.ts:83-89`); the
  RPC registry's compile-time twin requirement — a method added to
  `RpcMethodRegistry` must also appear in `RPC_METHOD_ENTRIES`
  (`Record<RpcMethodName, true>`), or it is a compile error by design.
- **Shape:**
  ```
  BootPhase = 'starting' | 'database' | 'harness' | 'sessions' | 'index' | 'settled'
  BOOT_PHASE_VALUES  (readonly tuple, for runtime narrowing, mirroring BACKEND_READINESS_VALUES)
  isBootPhase(value: unknown): value is BootPhase
  BootReadinessChangedPayload {
    readonly readiness: BackendReadiness;
    readonly phase: BootPhase;
    readonly detail?: string;     // human-facing, e.g. "Opening a 1.0 GB database"
    readonly startedAt: number;   // epoch ms of boot start, so the renderer can show elapsed
  }
  BootGetReadinessResult = BootReadinessChangedPayload   // one shape, pull and push
  ```
  `phase` and `detail` are documented as **display-only**: no caller may infer
  from a phase that a given subsystem is available; the coarse-vocabulary rule at
  `:85-88` survives intact and the comment is edited to say exactly that.
- **Dependencies:** none. `libs/shared` imports nothing from the monorepo.
- **Integration points:** producer is component 10; consumers are components 11
  and 12.
- **Failure behaviour:** not applicable (types only). `isBootPhase` exists so the
  renderer can reject a malformed payload rather than render an unknown phase.
- **Quality requirements:** type re-exports use `export type`; the message
  protocol stays append-only.
- **Verification seam:** extend `rpc-readiness.types.spec.ts` — `isBootPhase`
  accepts every member and rejects a near-miss; the payload type compiles against
  `payload-map.ts`; `BOOT_PHASE_VALUES` and the union agree
  (`satisfies readonly BootPhase[]`).
- **Files:**
  - MODIFY `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-readiness.types.ts`
  - MODIFY `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-readiness.types.spec.ts`
  - MODIFY `D:/projects/ptah-extension/libs/shared/src/lib/types/messages/message-constants.ts` (comment only)
  - MODIFY `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc.types.ts` (registry entry + `RPC_METHOD_ENTRIES`)

### 9. `IBootReadinessProvider` port + three host answers

- **Purpose:** let a runtime-agnostic RPC handler read a state that today lives
  in a plain object inside the Electron app.
- **Responsibilities:** one read-only method. No transitions, no subscription —
  the push channel is separate and host-owned.
- **Verified contracts and entry points:** the token registry
  (`platform-core/src/di/tokens.ts:11-114`) and the documented
  real-adapter/null-default pattern at `:73-79`; the null registration idiom
  `if (!container.isRegistered(...))` at
  `vscode-core/src/di/register-platform-agnostic.ts:73-76`; the null
  implementation shape at `vscode-core/src/services/null-session-attachment-guard.ts`;
  the state to expose — `BootCoordinator.readiness` (`boot-coordinator.ts:221-223`).
- **Interface:** `getReadiness(): BootReadinessChangedPayload`. Synchronous, so a
  handler can answer without awaiting anything.
- **Dependencies:** `platform-core` gains one interface file and one token. It
  imports the payload type from `libs/shared`, which it may (`libs/shared` is the
  foundation layer and `platform-core` is L0.5 above it).
- **Integration points:** Electron registers
  `ElectronBootReadinessProvider` (delegating to the coordinator) in
  `bootstrap.ts`, beside the existing `WEBVIEW_MANAGER` registration at `:342`.
  `vscode-core` registers `NullBootReadinessProvider` — always
  `{ readiness: 'ready', phase: 'settled', startedAt }` — when nothing else has.
  The CLI therefore gets the null adapter for free.
- **Failure behaviour:** a host with no adapter cannot exist, because the null
  registration is unconditional-if-absent. The handler never sees an unregistered
  token.
- **Quality requirements:** `platform-core` must remain a leaf with respect to
  other backend libs; no `electron` import anywhere in it.
- **Verification seam:** a `null-boot-readiness.spec.ts` asserting the always-ready
  answer, and a `register-platform-agnostic` spec case asserting the null adapter
  is **not** registered when one already is.
- **Files:**
  - CREATE `D:/projects/ptah-extension/libs/backend/platform-core/src/interfaces/boot-readiness.interface.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/platform-core/src/di/tokens.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/platform-core/src/index.ts`
  - CREATE `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/null-boot-readiness.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/vscode-core/src/di/register-platform-agnostic.ts`
  - CREATE `D:/projects/ptah-extension/apps/ptah-electron/src/services/platform/electron-boot-readiness.ts`
  - MODIFY `D:/projects/ptah-extension/apps/ptah-electron/src/activation/bootstrap.ts`

### 10. `BootCoordinator` phase state + broadcaster

- **Purpose:** make the boot's own progress observable, once, from the object
  that already owns the boot lifecycle.
- **Responsibilities:** hold the current phase; emit on transition; replay on
  window load. It does **not** resolve DI, does not know about IPC, and keeps its
  "every import is `import type`" property.
- **Verified contracts and entry points:** the coordinator's existing shape
  (`boot-coordinator.ts:180-227`, `:260-286`, `:401-404`); the duplicate local
  `BootReadiness` at `:62` that is replaced by the shared `BackendReadiness`; the
  broadcast surface `broadcastMessage(type, payload): Promise<void>` as already
  duck-typed at `boot-heavy-services.ts:349-351`; the lazy-resolution requirement
  for `TOKENS.WEBVIEW_MANAGER` (`register-shared-rpc-handlers.ts:35-39`,
  `phase-4-handlers.ts:78`); the window-load hook
  (`post-window.ts:102-104`).
- **Coordinator changes:**
  - `private phase: BootPhase = 'starting'` plus `readonly startedAt = Date.now()`.
  - `setPhase(phase, detail?)` — ignores a repeat of the current phase, updates
    state, then calls an injected `emit` callback. Edge-triggered.
  - `snapshot(): BootReadinessChangedPayload` — what both the pull RPC and the
    replay return.
  - `onReadinessChange(emit)` — registers the single emitter; the coordinator
    stores a plain function and never resolves a container, preserving its
    type-only import property and its ts-jest loadability.
  - The two existing readiness transitions (`:262-267`) also set
    `phase = 'settled'` / keep the phase and flip readiness to `'failed'`.
- **Broadcaster:** a small `boot-readiness-broadcaster.ts` in
  `apps/ptah-electron/src/activation/` that closes over the container and, on
  each emit, resolves `TOKENS.WEBVIEW_MANAGER` **lazily and guarded by
  `isRegistered`**, then `void broadcastMessage(MESSAGE_TYPES.BOOT_READINESS_CHANGED, payload)`.
  Wired in `main.ts` immediately after the coordinator is constructed.
- **Phase emission points — exact, and deliberately host-observable only:**

  | Phase      | Emitted at                                                                                                                | Detail                           |
  | ---------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
  | `starting` | initial value, `main.ts` coordinator construction                                                                         | —                                |
  | `database` | `boot-heavy-services.ts`, immediately before `await bootThothRuntime(...)` (`:139`)                                       | `"Opening the database"`         |
  | `harness`  | `boot-heavy-services.ts`, immediately after `markPersistenceSettled(...)` (`:152`) and before `refreshUserLayer` (`:176`) | `"Syncing skills and agents"`    |
  | `sessions` | `boot-heavy-services.ts`, immediately before `scanAndImport` (`:319`)                                                     | `"Importing recent sessions"`    |
  | `index`    | `boot-heavy-services.ts`, immediately before `startThothCron` (`:370`)                                                    | `"Starting background services"` |
  | `settled`  | `boot-coordinator.ts` `startPostWindow`'s `.then` (`:262`)                                                                | —                                |

  **`skills` is deliberately absent.** The skill trigger and synthesis service
  start _inside_ `bootThothRuntime`, and `thoth-runtime` is runtime-agnostic —
  emitting from there would require it to know a renderer exists, which its own
  `CLAUDE.md` forbids. `context.md`'s proposed vocabulary is narrowed here for
  that reason, and this is the resolution of that conflict.

- **Replay:** `post-window.ts:102-104` changes `once` to `on`, and the handler
  calls `coordinator.notifyWindowLoaded()` (unchanged, idempotent via
  `warmupSettled`) **and** re-emits `snapshot()`. This covers a renderer reload,
  which `once` did not. It does **not** replace the pull RPC — see below.
- **Dependencies:** the coordinator gains a type-only import from `libs/shared`.
  The broadcaster depends on `vscode-core` `TOKENS` and `libs/shared`
  `MESSAGE_TYPES`, both already in the app's graph.
- **Integration points:** component 9's Electron adapter reads
  `coordinator.snapshot()`; component 12 consumes the push.
- **Failure behaviour:** a throwing or absent `WEBVIEW_MANAGER` is caught and
  warned; a lost message is recoverable because the renderer pulls. `setPhase`
  must never throw into the boot path — the emit is wrapped.
- **Quality requirements:** the coordinator file stays under the 700-line ceiling
  (currently 468; this adds roughly 40). No runtime import may be added to it.
- **Verification seam:** extend `boot-coordinator.spec.ts` — `setPhase` emits once
  per distinct phase and zero times for a repeat; `snapshot()` reflects the last
  phase and the correct readiness; a throwing emitter does not propagate; the
  `failed` transition keeps the last phase. Extend
  `boot-order.spec.ts` / `wire-runtime.boot-order.spec.ts` to assert the phase
  sequence `database → harness → sessions → index → settled`.
- **Files:**
  - MODIFY `D:/projects/ptah-extension/apps/ptah-electron/src/activation/boot-coordinator.ts`
  - MODIFY `D:/projects/ptah-extension/apps/ptah-electron/src/activation/boot-coordinator.spec.ts`
  - CREATE `D:/projects/ptah-extension/apps/ptah-electron/src/activation/boot-readiness-broadcaster.ts`
  - CREATE `D:/projects/ptah-extension/apps/ptah-electron/src/activation/boot-readiness-broadcaster.spec.ts`
  - MODIFY `D:/projects/ptah-extension/apps/ptah-electron/src/activation/boot-heavy-services.ts`
  - MODIFY `D:/projects/ptah-extension/apps/ptah-electron/src/activation/post-window.ts`
  - MODIFY `D:/projects/ptah-extension/apps/ptah-electron/src/main.ts`
  - MODIFY `D:/projects/ptah-extension/apps/ptah-electron/src/activation/boot-order.spec.ts`

### 11. `boot:getReadiness` RPC

- **Purpose:** answer the renderer's **first** read, which no push can serve.
- **Why it is mandatory, not defensive:** `did-finish-load` fires when the
  document finishes loading (`post-window.ts:102`); Angular's
  `bootstrapApplication` and therefore `MessageRouterService`'s
  `window.addEventListener('message')` are installed after that. A push emitted
  at window-load is dropped. The renderer must pull once.
- **Responsibilities:** one method, no params, returning
  `BootGetReadinessResult`. No side effects.
- **Verified contracts and entry points:** the four-site registration
  contract — `ALLOWED_METHOD_PREFIXES` (`rpc-handler.ts:44-90`, throws at
  registration when a prefix is missing, `:159-165`); the handler convention
  (`static readonly METHODS … as const satisfies readonly RpcMethodName[]` +
  `register()` calling `registerMethod`, e.g.
  `persistence-rpc.handlers.ts:138-143, 159-181`); the manifest entry
  (`host-profile/manifest.ts:347-350` shape) and the requirement that the
  manifest be a total, disjoint partition of `RPC_METHOD_NAMES`
  (`register-rpc-surface.ts:140-142`); `db:health`'s never-throw contract
  (`persistence-rpc.handlers.ts:13-14`) as the precedent for answering
  unavailability as data.
- **Capability:** `requires: []`. A readiness probe must work on every host, and
  the null adapter guarantees an answer. No new `Capability` member is added —
  adding one would force every host profile to opt in and would make
  `resolveRpcHandlerPlan` throw for any profile that forgot
  (`register-rpc-surface.ts:107-115`).
- **Dependencies:** `TOKENS.RPC_HANDLER`, `TOKENS.LOGGER`,
  `PLATFORM_TOKENS.BOOT_READINESS`.
- **Integration points:** called once by component 12 on construction.
- **Failure behaviour:** never throws. Any failure reading the port returns
  `{ readiness: 'ready', phase: 'settled' }` — the safe direction, because a
  renderer that cannot learn the boot state must not sit behind a boot screen
  forever.
- **Quality requirements:** a Zod schema for the (empty) params, per the
  boundary-validation rule; `export type` for the result re-export.
- **Verification seam:** a handler spec asserting the method registers under the
  `boot:` prefix without throwing, returns the port's snapshot, and returns the
  ready fallback when the port throws. The allowlist/manifest partition is
  already covered by `rpc-allowlist.spec.ts`, which will fail if the manifest
  entry is missing — that is the intended gate.
- **Files:**
  - MODIFY `D:/projects/ptah-extension/libs/backend/vscode-core/src/messaging/rpc-handler.ts` (add `'boot:'`)
  - CREATE `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/boot-rpc.handlers.ts`
  - CREATE `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/boot-rpc.handlers.spec.ts`
  - CREATE `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/boot-rpc.schema.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/index.ts`

### 12. `BootStatusService` (`libs/frontend/core`)

- **Purpose:** the renderer's single source of truth for boot progress, correct
  on both hosts and on a reload.
- **Responsibilities:** pull once on construction; update on push; expose
  signals. No rendering, no retry policy for other services.
- **Verified contracts and entry points:** `MessageHandler`
  (`message-router.types.ts:33-39`) — `handledMessageTypes` + `handleMessage`,
  **not** `messageType`/`handle`; `MESSAGE_HANDLERS` token (`:49-51`); router
  construction and its `MESSAGE_TYPES.BATCH` unwrapping
  (`message-router.service.ts:23-31, 53-87`); eager construction via
  `APP_INITIALIZER` (`:105-115`); registration site
  (`app.config.ts:112-125`); the `providedIn: 'root'` + `implements MessageHandler`
  template at `vec-embedder-recovery.service.ts:34-71`.
- **Shape:** `readonly status = signal<BootReadinessChangedPayload>(...)`
  initialised to `{ readiness: 'ready', phase: 'settled', startedAt: Date.now() }`.
  **The initial value is `ready` and that is load-bearing** — the same bundle runs
  in the VS Code webview, where no `boot:readinessChanged` will ever arrive
  (`apps/ptah-extension-webview/CLAUDE.md`, one artifact for both hosts). A
  `warming` default would hang the VS Code webview behind a boot screen forever.
  Derived: `isBooting = computed(() => status().readiness === 'warming')`,
  `phase`, `detail`, `elapsedMs`.
- **Pull:** in the constructor, guarded by the `VSCodeService.isElectron`
  snapshot idiom (`app.ts:47`; the getter at `vscode.service.ts:171-173` is not
  reactive), call `boot:getReadiness` once and set the signal. On failure, leave
  the ready default.
- **Push:** `handledMessageTypes = [MESSAGE_TYPES.BOOT_READINESS_CHANGED]`;
  `handleMessage` narrows the payload with `isBackendReadiness` + `isBootPhase`
  before assigning, and drops anything malformed.
- **Dependencies:** `ClaudeRpcService`, `VSCodeService`. Both already in
  `libs/frontend/core`; no new cross-lib edge and no backend import.
- **Integration points:** registered in `app.config.ts` as
  `{ provide: MESSAGE_HANDLERS, useExisting: BootStatusService, multi: true }`;
  exported from `libs/frontend/core/src/lib/services/index.ts`.
- **Failure behaviour:** a failed pull, a malformed push, or a host that never
  pushes all leave the service reporting `ready` — never blocking.
- **Quality requirements:** signals + `inject()`; the lib's coverage floor
  (statements 85 %, branches 75 %, functions 75 %, lines 85 %).
- **Verification seam:** a service spec — default is `ready` before any RPC
  resolves; a `warming` push flips `isBooting`; a malformed push is ignored; a
  rejected pull leaves the default; a batched push (via the router's
  `MESSAGE_TYPES.BATCH` unwrap) still lands.
- **Files:**
  - CREATE `D:/projects/ptah-extension/libs/frontend/core/src/lib/services/boot-status.service.ts`
  - CREATE `D:/projects/ptah-extension/libs/frontend/core/src/lib/services/boot-status.service.spec.ts`
  - MODIFY `D:/projects/ptah-extension/libs/frontend/core/src/lib/services/index.ts`
  - MODIFY `D:/projects/ptah-extension/apps/ptah-extension-webview/src/app/app.config.ts`

### 13. Boot screen + panel skeletons

- **Purpose:** replace a spinner that is up for milliseconds and says nothing
  with a screen that is up for as long as the boot takes and says what is
  happening — then hand over to per-panel skeletons so the shell is usable while
  background work continues.
- **Responsibilities:** presentational only. No RPC, no service injection in the
  atoms/molecules.
- **Verified contracts and entry points:** the current gate
  (`app.html:4-13` spinner, `:16-20` shell branch, `:43`
  `<ptah-update-dialog />` rendered outside `<main>` as the overlay precedent);
  `app.ts:47-60` signals and `:62-78` `ngOnInit`, which awaits only
  `handleInitialView()` (`:95-131`) and does **no** backend I/O; the Electron
  launch surface is the canvas because `ElectronShellComponent`'s constructor
  forces `setLayoutMode('grid')` (`electron-shell.component.ts:300`); existing
  DaisyUI skeleton markup duplicated verbatim at
  `plugin-status-widget.component.ts:35-44` and
  `setup-status-widget.component.ts:45-54`; the list-row repeat idiom at
  `corpus-list.component.ts:119-122, 227`; existing spinner fallbacks at
  `electron-shell.component.ts:266-272` and `app-shell.component.html:673-678`.
- **Design:**
  - `app.html`'s loading branch becomes
    `@if (appState.isLoading() || isInitializing() || bootStatus.isBooting())`
    and renders `<ptah-boot-progress>` instead of the bare spinner. The screen
    lists the five phases with the reached ones checked, shows `detail` and
    elapsed time derived from `startedAt`, and carries the product mark.
  - **Handover point:** the screen is dismissed once `phase` reaches `harness` —
    i.e. persistence has settled — not at `settled`. Everything after `harness`
    is background work the user can watch from inside the shell. This is how
    `context.md`'s two instructions ("replace the spinner with a staged boot
    screen" and "shell still paints early") are reconciled: the screen owns the
    window in which nothing is usable, and the skeletons own the window in which
    parts are.
  - **Skeletons, two sites, both bound to `bootStatus`:** the session sidebar
    list in `app-shell.component.html` (the `chatStore.sessions()` region), which
    grows as the deferred session import runs; and the canvas region's existing
    `@else` spinner (`app-shell.component.html:673-678`), replaced by a skeleton.
    No other panel gets one — the navbar and the workspace sidebar are layout
    state only and must keep painting instantly.
  - **VS Code is unaffected by construction**, because `BootStatusService`
    defaults to `ready`, so `isBooting()` is permanently false there. No host
    branch is needed in the template; if one is added it must use the `app.ts:47`
    snapshot idiom, since `VSCodeService.isElectron` is a non-reactive getter.
- **Dependencies:** `@ptah-extension/core` (`BootStatusService`) from the app
  component only; the atoms/molecules take inputs. No backend import.
- **Integration points:** `app.html` / `app.ts`; `app-shell.component.html`.
- **Failure behaviour:** an unknown phase renders as "Starting" rather than a
  blank list; a `failed` readiness routes to the existing error branch
  (`app.html:22-39`) with the boot detail as its message.
- **Quality requirements:** `ChangeDetectionStrategy.OnPush` mandatory; signals
  and `inject()`; Tailwind + daisyui only; component styles under 10 kb; no
  `[innerHTML]`. Accessibility: the boot screen is a live region
  (`role="status"`, `aria-live="polite"`) so the phase change is announced, and
  the phase list is a real list, not a stack of divs.
- **Verification seam:** component specs driving the inputs — the phase list
  marks reached phases; elapsed time renders from `startedAt`; an unknown phase
  degrades. A `webview-e2e-harness` case that posts a `warming` readiness through
  the postmessage bridge and asserts the boot screen renders, then posts
  `harness` and asserts the shell appears.
- **Files:**
  - CREATE `D:/projects/ptah-extension/libs/frontend/chat-ui/src/lib/atoms/skeleton-block.component.ts`
  - CREATE `D:/projects/ptah-extension/libs/frontend/chat-ui/src/lib/molecules/boot-progress/boot-progress.component.ts`
  - CREATE `D:/projects/ptah-extension/libs/frontend/chat-ui/src/lib/molecules/boot-progress/boot-progress.component.spec.ts`
  - MODIFY `D:/projects/ptah-extension/libs/frontend/chat-ui/src/index.ts`
  - MODIFY `D:/projects/ptah-extension/apps/ptah-extension-webview/src/app/app.html`
  - MODIFY `D:/projects/ptah-extension/apps/ptah-extension-webview/src/app/app.ts`
  - MODIFY `D:/projects/ptah-extension/libs/frontend/chat/src/lib/components/templates/app-shell.component.html`

### 14. Back-office activity ticker (Track B5)

- **Purpose:** a single-line, rotating "news line" in the Electron shell header,
  beside the theme toggle, that says what the background half of the app is
  doing — so the work this task moves off the boot path stops being invisible
  rather than merely stops being in the way.
- **Responsibilities:** three separable pieces — a **backend emitter** for the
  subsystems that broadcast nothing today, a **frontend fan-in service** that
  normalises every source into one item type, and a **presentational ticker**
  that rotates and collapses. Nothing in this component changes what any
  subsystem does; it only makes existing facts visible.

#### 14a. Fan-in decision — hybrid, and the split is by evidence

I audited every source named in the request against the message registry. Seven
of eleven already broadcast:

| Source                                                                      | Existing push                             | Producer, verified                                                                                                                                               |
| --------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Boot phases                                                                 | `BOOT_READINESS_CHANGED`                  | component 10 (this task)                                                                                                                                         |
| Memory curator run                                                          | `MEMORY_EXTRACTED`                        | `boot-thoth-runtime.ts:260-267`                                                                                                                                  |
| Observation captured                                                        | `MEMORY_OBSERVATION_CAPTURED`             | `boot-thoth-runtime.ts:274-279`                                                                                                                                  |
| Corpus changed                                                              | `MEMORY_CORPUS_CHANGED`                   | `boot-thoth-runtime.ts:285-290`                                                                                                                                  |
| sqlite-vec status                                                           | `VEC_STATUS_CHANGED`                      | `boot-thoth-runtime.ts:310-318`                                                                                                                                  |
| Embedder status                                                             | `EMBEDDER_STATUS_CHANGED`                 | `boot-thoth-runtime.ts:326-331`                                                                                                                                  |
| Workspace indexing                                                          | `INDEXING_COMPLETE` / `INDEXING_PROGRESS` | `memory-curator/src/lib/control/indexing-control.service.ts:325, 472`                                                                                            |
| Skill synthesis (boot scan, enqueue, drain, promotion, judge, curator pass) | `SKILL_SYNTHESIS_EVENT`                   | `skill-synthesis.service.ts:1007-1027` (`pushEvent`), wire type `SkillSynthesisEventWire` at `libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts:51` |

Four broadcast **nothing**:

| Source                             | Verified absence                                                                                                                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cron job runs                      | `grep` for `onRun\|onEvent\|emit\|listener\|Emitter` across `cron-scheduler/src/lib/cron-scheduler.ts` and `job-runner.ts` returns one unrelated comment. `CronScheduler` has no event surface. |
| Harness reconcile                  | no `broadcastMessage` anywhere in `libs/backend/harness-sync`. `HARNESS_HEALTH_CHANGED` (`message-constants.ts:221`) is a different fact — health, not a reconcile pass.                        |
| Session import                     | `boot-heavy-services.ts:309-338` logs and returns a count; no push.                                                                                                                             |
| Integrity check (new, component 3) | new work — has no channel by construction.                                                                                                                                                      |

**Decision: re-map the seven in the frontend, add ONE new message type for the
four.**

- _Why not one backend bridge for everything._ Re-emitting the seven as a second
  message type doubles every one of those pushes on the wire — `INDEXING_PROGRESS`
  alone fires per file — and creates two sources of truth for the same fact. The
  first time either side gained a field they would drift. This is the same
  argument `skill-synthesis-ui/src/lib/services/skill-synthesis-live.service.ts:55-67`
  makes for riding the existing channel instead of minting a nudge channel, and
  it applies here unchanged.
- _Why not frontend-only re-mapping._ Four subsystems have nothing to map. A
  ticker that silently omits every cron run and every harness reconcile is not
  the feature that was asked for.
- _Why boot phases are re-mapped and not re-emitted._ Component 10 already pushes
  them and `BootStatusService` already holds them. A second channel for the same
  transition would be the exact duplication the first bullet rejects.

The new type carries a **generic** shape, so a future silent subsystem joins by
emitting rather than by adding a message type. That is the property that makes
one new type the minimal answer rather than four.

#### 14b. Backend emitter

- **Verified contracts and entry points:** the bridge precedent —
  `boot-thoth-runtime.ts:245-345`, where each block resolves
  `TOKENS.WEBVIEW_MANAGER` from the container, subscribes, calls
  `void webviewManager.broadcastMessage(TYPE, payload)`, and is wrapped in an
  individually-guarded non-fatal `try/catch` (`:294-299`, `:340-345`) —
  the shape `thoth-runtime/CLAUDE.md` requires every new block to keep. The
  cron handler registration site — `start-thoth-cron.ts:102-145` (skill drains)
  and `:206-252` (`backup:daily`) — where each handler already returns
  `{ summary }` or `{ outcome: 'skipped', reason }` (`:125-129`). The
  never-throw broadcast contract —
  `webview-manager.ts:294-315`. The best-effort push idiom, including the
  "a broadcast failure must NEVER break the pipeline — CLI/test runtimes have no
  webview at all" rule — `skill-synthesis.service.ts:1013-1027`.
- **Two emission sites, split on runtime-agnosticism:**
  1. **`libs/backend/thoth-runtime/src/lib/activity-emitter.ts` (new).** A small
     `createActivityEmitter(container, logPrefix)` returning
     `emit(source, kind, summary, level?)`. It resolves `TOKENS.WEBVIEW_MANAGER`
     **lazily, guarded by `isRegistered`**, and swallows every failure — the CLI
     registers a duck-typed manager, and a test host may register none.
     `start-thoth-cron.ts` uses it to wrap the handlers it already registers:
     `backup:daily`, `db:integrity` (component 5) and the three
     `skills:drain:*` tiers. This covers **every cron job Ptah ships**.
     User-defined jobs are deliberately not covered — that would require an
     event surface on `CronScheduler`, which is a change to a different lib for
     a source the ticker does not need. Recorded as a follow-up.
  2. **`apps/ptah-electron/src/activation/boot-heavy-services.ts`.** Harness
     reconcile and session import are host activation work that
     `thoth-runtime/CLAUDE.md` explicitly keeps out of that lib. They emit
     through component 10's broadcaster, which already lives in the app and
     already resolves `WEBVIEW_MANAGER` lazily. Anchors: after
     `await refreshUserLayer(…, 'activation')` (`:176`), after
     `reconcileHarness(…, 'activation', …)` (`:235-238`), and after
     `scanAndImport` returns its count (`:319-330`).
- **`thoth-runtime` gains no renderer semantics beyond what it has.** The emitter
  produces the same kind of pre-formatted payload the memory bridges at `:260`
  and `:275` already produce; it does not know a ticker exists, and its
  `summary` is a sentence the subsystem could equally write to a log.
- **Failure behaviour:** every emit is `void`-ed and individually caught. An
  absent or throwing `WEBVIEW_MANAGER` degrades to no ticker line and never to a
  failed cron run, a failed reconcile or a failed import.
- **Verification seam:** `start-thoth-cron.spec.ts` (the existing hand-rolled
  container stub) asserts a wrapped handler still returns its original
  `{ summary }` / `{ outcome: 'skipped' }` value and emits exactly one activity
  event; and that a container with no `WEBVIEW_MANAGER` runs the handler and
  emits zero, without throwing.
- **Files:**
  - CREATE `D:/projects/ptah-extension/libs/backend/thoth-runtime/src/lib/activity-emitter.ts`
  - CREATE `D:/projects/ptah-extension/libs/backend/thoth-runtime/src/lib/activity-emitter.spec.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/thoth-runtime/src/lib/start-thoth-cron.spec.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/thoth-runtime/src/index.ts`
  - MODIFY `D:/projects/ptah-extension/apps/ptah-electron/src/activation/boot-heavy-services.ts` _(also touched by component 10 — same batch)_

#### 14c. Wire contract (`libs/shared`)

- **Verified contracts and entry points:** `MESSAGE_TYPES` constant table
  (`message-constants.ts`, `SKILL_SYNTHESIS_EVENT` at `:212`,
  `HARNESS_HEALTH_CHANGED` at `:221`); the message-type union
  (`message-type.ts:105-106`, non-exhaustive, so adding is non-breaking); the
  payload map (`payload-map.ts:321-325`, append-only per
  `libs/shared/CLAUDE.md` guideline 5).
- **Shape:**
  ```
  ActivitySource = 'boot' | 'memory' | 'indexing' | 'skills' | 'cron'
                 | 'harness' | 'sessions' | 'embedder' | 'vec' | 'database'
  ActivityLevel  = 'info' | 'warn'          // 'error' deliberately absent — see below
  ActivityEventPayload {
    readonly source: ActivitySource;
    readonly kind: string;      // subsystem-local, e.g. 'cron-run', 'reconcile', 'import'
    readonly summary: string;   // one human sentence, already formatted by the emitter
    readonly timestamp: number; // epoch ms
    readonly level?: ActivityLevel;   // default 'info'
  }
  ACTIVITY_SOURCE_VALUES  (readonly tuple `as const satisfies readonly ActivitySource[]`)
  isActivitySource(value: unknown): value is ActivitySource
  isActivityEventPayload(value: unknown): value is ActivityEventPayload
  ```
  **No `'error'` level.** A ticker is a passive, non-focus-stealing surface; a
  real failure needs a channel the user cannot miss by looking away for four
  seconds. Routing errors here would make it the _de facto_ error surface by
  accident. `'warn'` exists only to tint a degraded-but-completed run.
- **Failure behaviour:** `isActivityEventPayload` is the frontend's only
  admission gate — the RPC/message client resolves to `unknown`, which is the
  same reason `isRpcReadinessError` exists (`rpc-readiness.types.ts:102-108`).
  A malformed payload is dropped, never rendered.
- **Verification seam:** a types spec asserting the guard accepts a minimal valid
  payload, rejects an unknown `source`, rejects a non-finite `timestamp`, and
  rejects a missing `summary`; and that `ACTIVITY_SOURCE_VALUES` and the union
  agree by `satisfies`.
- **Files:**
  - CREATE `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-activity.types.ts`
  - CREATE `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-activity.types.spec.ts`
  - MODIFY `D:/projects/ptah-extension/libs/shared/src/lib/types/messages/message-constants.ts` _(also touched by component 8 — same batch)_
  - MODIFY `D:/projects/ptah-extension/libs/shared/src/lib/types/messages/message-type.ts`
  - MODIFY `D:/projects/ptah-extension/libs/shared/src/lib/types/messages/payload-map.ts`
  - MODIFY `D:/projects/ptah-extension/libs/shared/src/index.ts`

#### 14d. `BackOfficeActivityService` (`libs/frontend/core`)

- **Purpose:** the one place eight message types become one ordered list of
  items, bounded and coalesced.
- **Verified contracts and entry points:** `MessageHandler`
  (`message-router.types.ts:33-39`) — `handledMessageTypes` + `handleMessage`;
  `MESSAGE_HANDLERS` multi-token (`:49-51`); the router's batch unwrapping
  (`message-router.service.ts:53-87`), so a batched activity event still lands;
  the closest existing multi-type handler
  (`memory-curator-ui/src/lib/services/vec-embedder-recovery.service.ts:34-71`);
  the closest existing "map a subsystem event stream to a human label" service
  (`skill-synthesis-live.service.ts:73-119`), including its debounce for "a
  single curator pass can emit several of these kinds within a second"
  (`:69-71`) — the same pressure this service must absorb; the registration site
  (`app.config.ts:112-125`, with `SkillSynthesisLiveService` registered at
  `:203` as the template for a lib-owned handler).
- **Why `libs/frontend/core` and not `chat`:** it consumes types from
  `libs/shared` only (`SkillSynthesisEventWire` lives at
  `rpc-curator-diagnostics.types.ts:51`, in shared, not in `skill-synthesis-ui`),
  so placing it in `core` introduces no new edge and no cycle, and lets a future
  Thoth activity log consume the same service.
- **Shape:**
  ```
  ActivityItem { id, source, kind, summary, timestamp, level }
  readonly recent: Signal<readonly ActivityItem[]>   // newest first, bounded
  readonly latest: Signal<ActivityItem | null>
  readonly isIdle: Signal<boolean>                   // no item for IDLE_AFTER_MS
  ```
  `handledMessageTypes` = the eight: `ACTIVITY_EVENT`, `BOOT_READINESS_CHANGED`,
  `MEMORY_EXTRACTED`, `MEMORY_OBSERVATION_CAPTURED`, `MEMORY_CORPUS_CHANGED`,
  `INDEXING_PROGRESS`/`INDEXING_COMPLETE`, `SKILL_SYNTHESIS_EVENT`,
  `VEC_STATUS_CHANGED`, `EMBEDDER_STATUS_CHANGED`.
- **Ring buffer:** `ACTIVITY_RING_CAPACITY = 50`, oldest dropped on push —
  the same bound and the same `push`/`shift` idiom as
  `SkillSynthesisService.RING_CAPACITY` (`skill-synthesis.service.ts:1008-1011`),
  so the two ends of the same pipeline agree on what "recent" means.
- **Coalescing — required, not an optimisation.** `INDEXING_PROGRESS` is
  broadcast per file (`indexing-control.service.ts:472`), and a workspace index
  emits thousands. The service keys on `` `${source}:${kind}` `` and applies
  **latest-wins within `ACTIVITY_COALESCE_WINDOW_MS` (750 ms)**: an arriving item
  whose key matches the newest item and is inside the window **replaces** it in
  place, keeping its position and updating `summary`/`timestamp`. Outside the
  window it is a new entry. Consequences that are deliberate: a fast progress
  stream occupies exactly one ring slot and renders as one line whose text
  changes, so 2 000 files cannot evict every other subsystem from a 50-slot ring;
  and the ticker never thrashes, because rotation is driven by a timer, not by
  arrivals.
- **Mapping rules, one per handled type.** Each is a pure function
  `(payload) => ActivityItem | null`, returning `null` for anything the ticker
  should not narrate:
  - `BOOT_READINESS_CHANGED` → `{ source: 'boot', kind: phase, summary: detail ?? phase }`;
    `null` when `phase === 'settled'` (the boot ending is not news).
  - `MEMORY_EXTRACTED` → `{ source: 'memory', kind: 'curated' }`, summary from
    `created`/`merged`.
  - `MEMORY_OBSERVATION_CAPTURED` → `{ source: 'memory', kind: 'observed' }`.
  - `MEMORY_CORPUS_CHANGED` → `{ source: 'memory', kind: 'corpus' }`.
  - `INDEXING_PROGRESS` → `{ source: 'indexing', kind: 'progress' }` (the
    coalesced one); `INDEXING_COMPLETE` → `kind: 'complete'`.
  - `SKILL_SYNTHESIS_EVENT` → `{ source: 'skills', kind: event.kind }`, summary
    derived from the wire event's `kind` + `stats`. Reuse the phrasing already
    proven in `skill-synthesis-live.service.ts:107-119` rather than inventing a
    second vocabulary for the same events.
  - `VEC_STATUS_CHANGED` / `EMBEDDER_STATUS_CHANGED` → `{ source: 'vec' | 'embedder' }`,
    `level: 'warn'` when unavailable; `null` when the snapshot is unchanged from
    the last one seen, so a status re-broadcast does not manufacture news.
  - `ACTIVITY_EVENT` → passthrough after `isActivityEventPayload`.
- **Dependencies:** `@ptah-extension/shared` only. No RPC, no `VSCodeService`, no
  backend import.
- **Integration points:** registered in `app.config.ts` as
  `{ provide: MESSAGE_HANDLERS, useExisting: BackOfficeActivityService, multi: true }`;
  exported from `libs/frontend/core/src/lib/services/index.ts`; read by
  `ElectronShellComponent`.
- **Harmless under VS Code, by construction and not by a guard.** The service is
  a pure sink: it holds an empty ring until a message arrives, and the only
  consumer is `ElectronShellComponent`, which VS Code never renders
  (`app.html:16-20` branches on `isElectron()`). Some of these messages _do_
  arrive in the VS Code webview — `SKILL_SYNTHESIS_EVENT` and the memory pushes
  reach both hosts through the same router — and that is fine: an unread ring
  costs one bounded array. **No host branch is added**, because a host check
  would be a second thing to keep true.
- **Failure behaviour:** a malformed payload is dropped by the guard; an unknown
  `SKILL_SYNTHESIS_EVENT` kind maps to a generic summary rather than `null`, so a
  new backend event kind degrades to a dull line instead of disappearing.
- **Quality requirements:** signals + `inject()`; the lib's coverage floor
  (statements 85 %, branches 75 %, functions 75 %, lines 85 %); no timer left
  running — `isIdle` is derived from a single `setInterval` that is created once
  and `unref`-equivalent (cleared in `ngOnDestroy` via `DestroyRef`).
- **Verification seam** (call counts and state, never wall-clock timing):
  - 60 pushes leave `recent().length === 50` and the newest first.
  - 100 `INDEXING_PROGRESS` messages 10 ms apart occupy **one** ring slot and
    leave `latest().summary` equal to the last one.
  - Two `INDEXING_PROGRESS` messages 2 s apart occupy two slots.
  - `isIdle()` is `false` immediately after a push and `true` after advancing a
    fake clock past `IDLE_AFTER_MS`.
  - A malformed `ACTIVITY_EVENT` payload changes nothing.
  - A `settled` boot phase produces no item.
  - A batched message (through the router's `MESSAGE_TYPES.BATCH` unwrap) lands.
- **Files:**
  - CREATE `D:/projects/ptah-extension/libs/frontend/core/src/lib/services/back-office-activity.service.ts`
  - CREATE `D:/projects/ptah-extension/libs/frontend/core/src/lib/services/back-office-activity.service.spec.ts`
  - MODIFY `D:/projects/ptah-extension/libs/frontend/core/src/lib/services/index.ts` _(also touched by component 12 — same batch)_
  - MODIFY `D:/projects/ptah-extension/apps/ptah-extension-webview/src/app/app.config.ts` _(also touched by component 12 — same batch)_
  - MODIFY `D:/projects/ptah-extension/apps/ptah-extension-webview/src/app/thoth-message-routing.spec.ts` (the existing app-level routing spec; add a case proving an `ACTIVITY_EVENT` reaches the service through the real router)

#### 14e. `ptah-activity-ticker` (`libs/frontend/chat-ui`) + shell wiring

- **Purpose:** render one line at a time, rotate, collapse when quiet, and offer
  one click target. No state of its own beyond the rotation index.
- **Verified contracts and entry points:** the header
  (`electron-shell.component.ts:87-92`, a 40 px-tall flex row with
  `titlebar-drag` on macOS); the **exact insertion point** — the right-hand
  actions group at `:205-212`, `<div class="flex items-center gap-0.5 no-drag">`
  containing `<ptah-theme-toggle />` at `:211`; the click target
  `openThoth()` at `:341-344`; `ThemeToggleComponent` exported from
  `libs/frontend/chat-ui/src/index.ts:20`; the presentational-only rule for
  `chat-ui` (`libs/frontend/chat/CLAUDE.md` guideline 2 — "if a new component
  injects a service, it stays here", i.e. in `chat`).
- **Animation: CSS transitions only. `@hive-academy/angular-gsap` is NOT a
  dependency of `chat-ui`** — a repo-wide grep for `angular-gsap` / `from 'gsap'`
  across `libs/frontend` returns a single hit inside a string literal
  (`chat-ui/src/lib/molecules/setup-plugins/prompt-suggestions.component.ts:326`),
  and `chat-ui`'s externals are `@angular/*` plus `lucide-angular`. A dependency
  is not added for one ticker. A `translateY` + `opacity` transition over
  ~180 ms is the whole effect.
- **Placement, and why it is beside the toggle and not before it.** The ticker
  goes **inside** the existing right-hand group, immediately **before**
  `<ptah-theme-toggle />`, so the toggle keeps its position at the far right
  where muscle memory expects it. The ticker is width-constrained
  (`max-w-[22rem] truncate`) and `no-drag`, because the header row carries
  `titlebar-drag` on macOS and a clickable child inside a drag region must opt
  out — the same reason every other interactive child in that header already
  carries `no-drag` (`:94`, `:113`, `:209`).
- **Inputs / outputs (inputs only, per the atomic rule):**
  ```
  items    = input.required<readonly ActivityItem[]>()
  idle     = input.required<boolean>()
  rotateMs = input<number>(4000)
  activate = output<void>()
  ```
- **Behaviour:** shows `items()[index]`; a rotation timer advances `index` every
  `rotateMs` and resets to `0` whenever `items()` gains a newer head, so a fresh
  event is shown immediately rather than waiting its turn. When `idle()` is true
  the component collapses to a single muted dot (still a click target for
  `activate`) — it never removes itself from the DOM, so the header does not
  reflow between busy and quiet.
- **Accessibility:** the line is wrapped in
  `<div role="status" aria-live="polite" aria-atomic="true">`, so a phase change
  is announced once and not character-by-character. The click target is a
  `<button type="button">` with an `aria-label` naming the destination
  ("Open Thoth background activity"), not a bare `div`. Under
  `@media (prefers-reduced-motion: reduce)` the transition is removed and the
  text swaps instantly — the same block every animated component in this repo
  already carries, e.g. `execution-node.component.ts:298`.
- **Shell wiring:** `ElectronShellComponent` injects `BackOfficeActivityService`
  (it is already a smart template that injects three services at `:289-294`),
  binds `[items]="activity.recent()"` / `[idle]="activity.isIdle()"`, and wires
  `(activate)="openThoth()"` — reusing the existing method at `:341`, including
  its `thothFirstRunDismissed` side effect, rather than duplicating navigation.
- **Failure behaviour:** an empty `items()` renders the idle dot. An item whose
  `summary` is empty renders its `source` as a fallback label, so a
  badly-formatted emitter cannot produce a blank line the user cannot explain.
- **Quality requirements:** `ChangeDetectionStrategy.OnPush`; inputs only, no
  service injection in the component; Tailwind + daisyui; component styles under
  10 kb; the header row's height must not change — the ticker is
  `h-full items-center` inside a fixed `h-10` row.
- **Verification seam:** component spec driving inputs — with three items and a
  fake clock, advancing `rotateMs` twice shows items 0, 1, 2 in order (asserted
  by rendered text, i.e. by count of advances, not by elapsed real time); a new
  head resets to index 0; `idle: true` renders the collapsed form and still
  emits `activate` on click; the reduced-motion class is applied from the
  stylesheet, not from TypeScript. Plus one `webview-e2e-harness` case: post an
  `ACTIVITY_EVENT` through the postmessage bridge and assert the header line
  renders its `summary`.
- **Files:**
  - CREATE `D:/projects/ptah-extension/libs/frontend/chat-ui/src/lib/molecules/activity-ticker/activity-ticker.component.ts`
  - CREATE `D:/projects/ptah-extension/libs/frontend/chat-ui/src/lib/molecules/activity-ticker/activity-ticker.component.spec.ts`
  - MODIFY `D:/projects/ptah-extension/libs/frontend/chat-ui/src/index.ts` _(also touched by component 13 — same batch)_
  - MODIFY `D:/projects/ptah-extension/libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`

---

## Integration architecture

- **Data flow — integrity check (A1), boundary to boundary.**
  1. `openAndMigrate()` opens, applies pragmas, loads sqlite-vec, runs
     migrations. **No integrity pragma runs here any more.**
  2. `bootThothRuntime` returns; `boot-heavy-services.ts:150` opens the
     persistence gate.
  3. `startThothCron` (`boot-heavy-services.ts:370`) registers
     `@ptah/db-integrity-check` at `30 3 * * *` and arms one `unref`'d 60 s timer.
  4. Either trigger calls `SqliteIntegrityService.dispatchIfDue()`.
  5. The service reads `db_integrity_check_state`. Fresh and clean ⇒ return. Due
     ⇒ take the single-flight latch, resolve the optional factory.
  6. No factory ⇒ log once, release, return.
  7. Factory present ⇒ spawn the worker with the db path. The worker opens its
     own read-only connection over the shared WAL file, runs `quick_check` then
     `foreign_key_check`, posts one result, exits.
  8. `verdict: 'ok' | 'corrupt'` ⇒ upsert the record and log. `'unavailable'`,
     an error, or an exit without a result ⇒ warn, **write nothing**, release the
     latch. The next window retries.

- **Data flow — readiness (B).**
  1. `main.ts` constructs the coordinator (`phase = 'starting'`, `startedAt`) and
     registers the broadcaster.
  2. The heavy boot calls `setPhase` at the five anchors in component 10's table.
     Each transition lazily resolves `TOKENS.WEBVIEW_MANAGER` and broadcasts.
  3. The renderer loads. `MessageRouterService` is forced eager by
     `APP_INITIALIZER`, constructing `BootStatusService`, which immediately calls
     `boot:getReadiness` — the pull that closes the window in which every push
     was dropped.
  4. From then on the signal is push-driven. On a renderer reload,
     `did-finish-load` fires again (now `on`, not `once`) and the coordinator
     replays `snapshot()`; the renderer also pulls again, so either path suffices.
  5. `app.html` renders `<ptah-boot-progress>` while `isBooting()` and the phase
     is before `harness`; then the shell paints and the two skeletons carry the
     remaining wait.

- **Data flow — activity ticker (B5).**
  1. Seven subsystems broadcast the message types they already broadcast. Nothing
     about them changes.
  2. The four silent ones emit `MESSAGE_TYPES.ACTIVITY_EVENT`: cron runs (backup,
     integrity, the three skill drains) through `thoth-runtime`'s
     `createActivityEmitter`, wrapped around the handlers `start-thoth-cron.ts`
     already registers; harness reconcile and session import through component
     10's Electron-side broadcaster at three anchors in `boot-heavy-services.ts`.
  3. `MessageRouterService` fans all eight types into
     `BackOfficeActivityService.handleMessage`, which narrows, maps to an
     `ActivityItem`, coalesces latest-wins per `source:kind` inside 750 ms, and
     pushes into a 50-slot ring.
  4. `ElectronShellComponent` binds `recent()` and `isIdle()` into
     `<ptah-activity-ticker>`, placed inside the header's right-hand actions
     group immediately before `<ptah-theme-toggle />`.
  5. A click emits `activate`, which the shell wires to its existing
     `openThoth()`.
  6. Under VS Code steps 3 and 4 diverge: the service still receives whichever of
     the eight types that host produces, and no component reads it, because
     `ElectronShellComponent` is never rendered there (`app.html:16-20`).

- **State or persistence.**
  - Activity items — in-memory, bounded at 50, process lifetime, single writer
    (`BackOfficeActivityService`), never persisted. Losing them on reload is
    correct: the ticker reports what is happening, not what happened.
  - `db_integrity_check_state` — one row, owned solely by
    `SqliteIntegrityService`, lifetime of the database file. Absence means "never
    checked".
  - `skill_md_migration_state` — unchanged; only the interval that reads it moves.
  - Boot phase — in-memory, process lifetime, single writer
    (`BootCoordinator`), no persistence. A restart legitimately starts at
    `starting`.

- **External boundaries.**
  - The worker's only input is a file path supplied by the host from
    `PERSISTENCE_TOKENS.SQLITE_DB_PATH` — not user input, not a wire value. The
    worker still validates its inbound message shape before acting, matching the
    embedder protocol's discipline.
  - `boot:getReadiness` takes no parameters and is validated by a Zod schema
    anyway, per the boundary rule.
  - The renderer narrows every inbound payload with `isBackendReadiness` +
    `isBootPhase` before touching it — the frontend RPC client resolves to
    `unknown`, which is exactly why those guards exist
    (`rpc-readiness.types.ts:102-108`).
  - Migration SQL stays static; no interpolation.

- **Failure and rollback.**
  - Nothing in A1 can fail the boot: `runBootChecks` is removed rather than
    replaced on the critical path, so the worst case is _less_ work than today.
  - A worker crash kills only the child. The service writes no record and the
    check re-runs at the next window. There is no crash-loop risk because the
    dispatch is interval-gated, not retry-gated.
  - A `corrupt` verdict is **recorded and logged, not acted on** — matching
    today's advisory behaviour (`sqlite-connection.service.ts:602-635` never
    marked the connection unavailable). Turning a verdict into a user-facing
    action is a separate product decision and is out of scope; the record makes
    it possible later.
  - A2's timer is `unref`'d and cleared in `stop()`, so a quit during the delay
    cannot hold the process alive or run a scan against a torn-down container.
  - B's broadcast is fire-and-forget through a method that never throws; a lost
    message is recovered by the pull.

- **Observability.** Three log lines carry the evidence a future investigation
  needs, and each replaces a place where this task's own investigation had to
  guess:
  1. `[persistence-sqlite] integrity check {verdict, durationMs, pageCount, foreignKeyViolations, ageOfPreviousMs, trigger: 'boot' | 'cron'}` — the check is now invisible unless it logs.
  2. `[persistence-sqlite] integrity check skipped {reason: 'fresh' | 'no-worker-factory' | 'in-flight', ageMs}` — a check that never runs must say why.
  3. The SKILL.md line gains `markerOutcome` and `markerWritten`, replacing the
     single boolean that made root cause 4 unresolvable from the log.
  4. The ticker is a **fourth observability surface, aimed at the user rather
     than at a log reader** — it is why the work this task pushes off the boot
     path does not simply become invisible. It is deliberately not an error
     channel (`ActivityLevel` has no `'error'` member); anything a user must act
     on needs a surface they cannot miss by looking away.
     Event-loop lag is already reported by the existing `DiagnosticsHandle`
     (`BootRefs.diagnostics`, `boot-coordinator.ts:94`); it is the metric that
     proves A1 and A2 worked and needs no new instrumentation.

---

## Architecture-level quality requirements

- **Functional.**
  - `openAndMigrate()` issues no `quick_check` and no `foreign_key_check` on any
    host.
  - With a clean record less than 7 days old, a cold boot performs zero integrity
    pragmas.
  - The skill boot scan enqueues nothing within `bootScanDelayMs` of
    `SkillTriggerService.start()`.
  - A second launch within 7 days performs no SKILL.md directory walk, and the
    log names the reason either way.
  - The renderer displays a phase-labelled boot screen for the duration of the
    Electron boot and never displays one under VS Code.
  - `boot:getReadiness` answers on every host, including hosts with no SQLite.
  - The Electron header shows a rotating activity line for boot phases, memory
    curator runs, observations, corpus changes, indexing, skill-synthesis events,
    embedder/vec status, cron runs, harness reconcile, session import and the
    integrity check; it collapses when quiet and opens the Thoth tab on click.
  - The VS Code webview renders no ticker and throws nothing.

- **Performance.** Measured against the same 1 000.7 MB database, cold cache, on
  the machine that produced the original log:
  - `openAndMigrate()` completes in under 3 s (the migration runner alone; the
    TASK_2026_331 probe measured 1942 ms for open+migrate warm, and the pragma
    that added ~24 s is gone).
  - No single event-loop lag warning above 500 ms between window creation and
    the first renderer RPC being answered.
  - The 90 s post-boot stutter (lag warnings every ~2 s for 90 s) does not occur
    within 5 minutes of launch.
  - A full workspace index (thousands of `INDEXING_PROGRESS` messages) occupies
    **one** of the activity ring's 50 slots and causes no more than one ticker
    text change per 750 ms. The ticker must not become the thing that makes the
    renderer stutter while the backend stops doing so.
  - **The measurement is part of the work, not a nice-to-have.** Re-run
    `apps/ptah-electron-e2e/scripts/measure-boot-rpcs.mjs` with a genuinely cold
    page cache — the reason TASK_2026_331 reached a wrong conclusion is that its
    third run used a freshly written copy, which is warm by construction, and
    measured 1942 ms where the field saw 25 s.

- **Security.** Migration SQL static (ESLint `no-template-curly-in-migration`,
  Semgrep `sql-injection-in-migration`). The worker opens `readonly: true` and
  performs no writes. Zod at the RPC boundary. No secret or path from user input
  reaches the worker.

- **Maintainability.**
  - `platform-core` stays a leaf and gains exactly one port.
  - `persistence-sqlite` still imports nothing from the monorepo except
    `vscode-core`'s logger, as it does today.
  - `thoth-runtime` remains free of `electron` and of renderer concepts; the
    phase vocabulary was narrowed specifically to keep it so.
  - `skill-synthesis` still never imports `cron-scheduler`.
  - No file crosses 700 lines as a result of this work; `sqlite-connection.service.ts`
    shrinks by 34. `electron-shell.component.ts` is 362 today and gains roughly
    12 lines.
  - The ticker adds **no new external dependency**. `@hive-academy/angular-gsap`
    is not a `chat-ui` dependency and is not made one for a 180 ms text fade.
  - Seven of the ticker's eleven sources keep exactly one broadcast each. Nothing
    is re-emitted on a second channel, so there is no second source of truth to
    keep in step.
  - Both doc comments that the payload widening contradicts are rewritten in the
    same change. Leaving a type and its documentation in disagreement is the
    thing that makes the next reader re-litigate a settled decision.

- **Testability.**
  - Interval and delay behaviour is proven by **call counts under a fake clock**,
    never by wall-clock timing — the rule stated in
    `skill-md-migration.marker.spec.ts:5-7` and practised in
    `memory-trigger.boot-defer.spec.ts`.
  - Every degrade path has a case: no worker factory, worker crash, unavailable
    verdict, throwing marker store, absent readiness port, malformed readiness
    push, absent `WEBVIEW_MANAGER` during an activity emit, malformed activity
    payload.
  - Ring-buffer bounding, coalescing and idle are asserted by **final state and
    call counts under a fake clock** — never by waiting. Ticker rotation is
    asserted by rendered text after N clock advances, not by elapsed time.
  - The boot-order specs assert the phase sequence, so a future reordering of
    `boot-heavy-services.ts` fails a test rather than silently mislabelling the
    screen.

- **Named follow-ups (not in scope, recorded so they are not lost).**
  1. The daily backup runs a 1 GB `db.backup()`, a `quick_check` on the copy,
     `incremental_vacuum` and `optimize` on the main process
     (`start-thoth-cron.ts:207-251`). Same fault class, larger magnitude, now
     cheap to fix because the worker exists.
  2. `memory.triggers.bootScanDelayMs`, `memory.triggers.bootScanIdleBackoffMs`,
     `skillSynthesis.drain.bootDeferralMs`,
     `skillSynthesis.triggers.turnComplete.enabled` and
     `skillSynthesis.triggers.skillInvocationTelemetry.enabled` are all absent
     from `FILE_BASED_SETTINGS_KEYS` and are therefore write-dropped. This task
     registers only its own new keys; backfilling the other five is a small,
     separate change.
  3. `SessionLoaderService.refreshResumableSubagentsForSession` fails log-only
     (`:837-843`) and leaves the Agents panel empty with no user-visible reason.
     Independent of readiness; worth a task of its own.
  4. `apps/ptah-extension-webview/src/app/app.ts:100-109`'s `VALID_VIEWS` is
     stale against the views `ElectronShellComponent` navigates to (`thoth`,
     `tasks`, `setup-hub`, `marketplace` are missing).
  5. **User-defined cron jobs emit no activity event.** Component 14b wraps only
     the handlers `start-thoth-cron.ts` registers, because `CronScheduler` has no
     event surface (verified: no emitter in `cron-scheduler.ts` or
     `job-runner.ts`). Adding `onRun` to the scheduler would let every job —
     including a user's — reach the ticker, and would also give `cron:runs` a
     live channel it does not have. Separate task, separate lib.
  6. `BackOfficeActivityService`'s 50-item ring is the natural backing store for a
     fuller activity log in the Thoth shell, which is what `context.md` line 70
     anticipates. Not built here; the service is shaped so it needs no change to
     serve it.

---

## Team-leader handoff

- **Recommended executors.**
  - Components 1, 2, 3, 5, 6, 7 — **backend-developer.** Pure backend libs, DI,
    migrations, timers; every one has a named in-repo pattern to mirror.
  - Component 4 — **devops-engineer** for the two `project.json` targets and the
    `tsconfig`, **backend-developer** for the two factory classes and their
    registration. Splitting it is optional; if kept whole, backend-developer,
    because the esbuild targets are copies of an existing one.
  - Components 8, 9, 11 — **backend-developer.** Contract widening plus the
    four-site RPC registration; the failure mode (a boot crash on a missing
    prefix) rewards someone who has done it before.
  - Component 10 — **backend-developer.** It is Electron main-process activation
    code, not UI.
  - Components 12, 13 — **frontend-developer.** Angular signals, `MESSAGE_HANDLERS`,
    OnPush, daisyui.
  - Component 14 splits by layer and must be given to two executors:
    - **14b (backend emitter)** — **backend-developer.** `thoth-runtime` +
      `boot-heavy-services.ts`; the whole job is copying the guarded-bridge shape
      at `boot-thoth-runtime.ts:245-345`.
    - **14c (wire contract)** — **backend-developer**, and it must land with or
      before 14b and 14d.
    - **14d (service) and 14e (ticker + shell wiring)** — **frontend-developer.**
      Signals, `MESSAGE_HANDLERS`, OnPush, CSS-only animation, `aria-live`.
  - After the batches land: **senior-tester** for the cold-cache boot measurement
    (it is an acceptance criterion, not a test), then **code-logic-reviewer** and
    **code-style-reviewer**.

- **Complexity: HIGH.** Not because any single component is hard — most are
  transcriptions of an existing pattern — but because the work spans ten
  libraries and two apps, crosses the hexagonal boundary in three places (a new
  worker port, a new platform port, a new RPC namespace), adds a forward-only
  migration and a new message type, and touches the activation path of the
  desktop app. The blast radius is boot itself, where a mistake is a crash on
  launch rather than a failing test. Component 14 is the least risky of the
  fourteen — it is additive, reads channels that already exist, and can be cut
  without affecting anything else — but it is the one that touches the most
  shared barrels, so it drives the batching more than its difficulty suggests.

- **Dependencies and ordering (component-level; the team-leader owns batching).**
  - 1 → 3 (the service reads the store).
  - 2 → 3 (the service drives the port) and 2 → 4 (the factories implement the
    port and bundle the entry).
  - 3 → 5 (the scheduler calls the service).
  - **A1 (1–5) must land before or with B.** While `quick_check` holds the main
    thread the RPC dispatcher cannot run, so no readiness message can be sent and
    no boot screen can animate. This is the ordering constraint `context.md`
    names, and the measurement confirms it.
  - 8 → 9, 10, 11, 12 (everything consumes the widened payload).
  - 9 → 11 (the handler reads the port). 10 → 12 (the push).
  - 11 → 12 (the pull). 12 → 13 (the screen binds the signal).
  - 6 and 7 depend on nothing and block nothing.
  - **14c → 14b, 14d** (both need `ActivityEventPayload` and the guard).
    **14d → 14e** (the ticker binds the service's signals).
  - **14 depends on component 8 and component 10, but only lightly.** 14d maps
    `BOOT_READINESS_CHANGED`, so it needs component 8's widened payload
    (specifically `phase` and `detail`) to compile; 14b's Electron half emits
    through component 10's broadcaster. It does **not** depend on component 12 —
    `BootStatusService` and `BackOfficeActivityService` are independent consumers
    of the same message, deliberately, because one gates a boot screen and the
    other feeds a scrolling log and merging them would give the boot screen a
    ring buffer it has no use for.
  - 14 does **not** depend on components 1–7. If A1 slips, the ticker still ships
    and simply never shows an integrity line.

- **Parallel-safe work (file-disjoint).**
  - **Lane P** — components 1, 2, 3 (`persistence-sqlite` only, plus one appended
    line in `migrations/index.ts`).
  - **Lane S** — components 6 and 7 (`skill-synthesis` only, plus
    `platform-core/src/file-settings-keys.ts`).
  - **Lane C** — component 8 (`libs/shared` only).
  - These three share no file and may run at once. Component 4 needs Lane P's
    port; component 5 needs Lane P's service; components 9–11 need Lane C;
    components 12–13 need 9–11.
  - **Conflict to flag:** components 6 and 9 both touch `platform-core` — 6 edits
    `file-settings-keys.ts`, 9 edits `di/tokens.ts` and `index.ts`. Different
    files, but the same project, so they must not be given to two agents in the
    same worktree.

  **Shared-file conflicts introduced by component 14 — five files, and each pair
  must stay in ONE batch:**

  | File                                                       | Shared by                                                                 | Why it collides                                                                                                                                                         |
  | ---------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `apps/ptah-electron/src/activation/boot-heavy-services.ts` | 10 (phase anchors) and 14b (harness / session-import emits)               | Both insert lines at the same four anchors (`:152`, `:176`, `:235-238`, `:319-330`). Two agents would conflict on every hunk. **Give 10 and 14b to the same executor.** |
  | `libs/shared/src/lib/types/messages/message-constants.ts`  | 8 (comment rewrite at `:112-118`) and 14c (new `ACTIVITY_EVENT` constant) | Same file, adjacent regions.                                                                                                                                            |
  | `libs/frontend/chat-ui/src/index.ts`                       | 13 (`SkeletonBlock`, `BootProgress`) and 14e (`ActivityTicker`)           | Three exports appended to one barrel.                                                                                                                                   |
  | `libs/frontend/core/src/lib/services/index.ts`             | 12 (`BootStatusService`) and 14d (`BackOfficeActivityService`)            | Same.                                                                                                                                                                   |
  | `apps/ptah-extension-webview/src/app/app.config.ts`        | 12 and 14d                                                                | Two `MESSAGE_HANDLERS` entries in the same provider array (`:112-125`).                                                                                                 |

  Practical batching that removes all five collisions: **one frontend batch
  carrying 12 + 13 + 14d + 14e**, and **one Electron batch carrying 10 + 14b**.
  14c joins the `libs/shared` batch with component 8.
  - Note that `apps/ptah-electron/src/activation/boot-heavy-services.ts` is now
    the single busiest file in the plan. Nothing else touches it, but the two
    components that do must not be split.

- **Files affected.**

  **CREATE**

  ```
  libs/backend/persistence-sqlite/src/lib/migrations/0042_db_integrity_check_state.ts
  libs/backend/persistence-sqlite/src/lib/migrations/0042_db_integrity_check_state.spec.ts
  libs/backend/persistence-sqlite/src/lib/integrity/integrity-check-state.store.ts
  libs/backend/persistence-sqlite/src/lib/integrity/integrity-check-state.store.spec.ts
  libs/backend/persistence-sqlite/src/lib/integrity/integrity-worker-protocol.ts
  libs/backend/persistence-sqlite/src/lib/integrity/integrity-worker.ts
  libs/backend/persistence-sqlite/src/lib/integrity/worker-process.port.ts
  libs/backend/persistence-sqlite/src/lib/integrity/integrity-check.service.ts
  libs/backend/persistence-sqlite/src/lib/integrity/integrity-check.service.spec.ts
  libs/backend/cli-engine/src/lib/thoth/cli-integrity-worker-factory.ts
  libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.boot-defer.spec.ts
  libs/backend/platform-core/src/interfaces/boot-readiness.interface.ts
  libs/backend/vscode-core/src/services/null-boot-readiness.ts
  libs/backend/rpc-handlers/src/lib/handlers/boot-rpc.handlers.ts
  libs/backend/rpc-handlers/src/lib/handlers/boot-rpc.handlers.spec.ts
  libs/backend/rpc-handlers/src/lib/handlers/boot-rpc.schema.ts
  libs/frontend/core/src/lib/services/boot-status.service.ts
  libs/frontend/core/src/lib/services/boot-status.service.spec.ts
  libs/frontend/chat-ui/src/lib/atoms/skeleton-block.component.ts
  libs/frontend/chat-ui/src/lib/molecules/boot-progress/boot-progress.component.ts
  libs/frontend/chat-ui/src/lib/molecules/boot-progress/boot-progress.component.spec.ts
  apps/ptah-electron/src/services/platform/electron-integrity-worker-factory.ts
  apps/ptah-electron/src/services/platform/electron-boot-readiness.ts
  apps/ptah-electron/src/activation/boot-readiness-broadcaster.ts
  apps/ptah-electron/src/activation/boot-readiness-broadcaster.spec.ts
  apps/ptah-electron/tsconfig.integrity-worker.json
  libs/backend/thoth-runtime/src/lib/activity-emitter.ts
  libs/backend/thoth-runtime/src/lib/activity-emitter.spec.ts
  libs/shared/src/lib/types/rpc/rpc-activity.types.ts
  libs/shared/src/lib/types/rpc/rpc-activity.types.spec.ts
  libs/frontend/core/src/lib/services/back-office-activity.service.ts
  libs/frontend/core/src/lib/services/back-office-activity.service.spec.ts
  libs/frontend/chat-ui/src/lib/molecules/activity-ticker/activity-ticker.component.ts
  libs/frontend/chat-ui/src/lib/molecules/activity-ticker/activity-ticker.component.spec.ts
  ```

  **MODIFY**

  ```
  libs/backend/persistence-sqlite/src/lib/migrations/index.ts
  libs/backend/persistence-sqlite/src/lib/di/tokens.ts
  libs/backend/persistence-sqlite/src/lib/di/register.ts
  libs/backend/persistence-sqlite/src/index.ts
  libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts          # 5 + 14b
  libs/backend/thoth-runtime/src/lib/start-thoth-cron.spec.ts     # 5 + 14b
  libs/backend/thoth-runtime/src/index.ts                         # 14b
  libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts
  libs/backend/skill-synthesis/src/lib/triggers/skill-trigger-config.ts
  libs/backend/skill-synthesis/src/lib/triggers/skill-trigger-config.spec.ts
  libs/backend/skill-synthesis/src/lib/skill-md-migration.ts
  libs/backend/skill-synthesis/src/lib/skill-md-migration.marker.spec.ts
  libs/backend/platform-core/src/file-settings-keys.ts
  libs/backend/platform-core/src/di/tokens.ts
  libs/backend/platform-core/src/index.ts
  libs/backend/vscode-core/src/di/register-platform-agnostic.ts
  libs/backend/vscode-core/src/messaging/rpc-handler.ts
  libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts
  libs/backend/rpc-handlers/src/index.ts
  libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts
  libs/shared/src/lib/types/rpc/rpc-readiness.types.ts
  libs/shared/src/lib/types/rpc/rpc-readiness.types.spec.ts
  libs/shared/src/lib/types/rpc/rpc.types.ts
  libs/shared/src/lib/types/messages/message-constants.ts         # 8 + 14c
  libs/shared/src/lib/types/messages/message-type.ts              # 14c
  libs/shared/src/lib/types/messages/payload-map.ts               # 14c
  libs/shared/src/index.ts                                        # 14c
  libs/frontend/core/src/lib/services/index.ts                    # 12 + 14d
  libs/frontend/chat-ui/src/index.ts                              # 13 + 14e
  libs/frontend/chat/src/lib/components/templates/app-shell.component.html
  libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts  # 14e
  apps/ptah-electron/project.json
  apps/ptah-electron/src/di/phase-2-libraries.ts
  apps/ptah-electron/src/activation/bootstrap.ts
  apps/ptah-electron/src/activation/boot-coordinator.ts
  apps/ptah-electron/src/activation/boot-coordinator.spec.ts
  apps/ptah-electron/src/activation/boot-heavy-services.ts        # 10 + 14b
  apps/ptah-electron/src/activation/post-window.ts
  apps/ptah-electron/src/activation/boot-order.spec.ts
  apps/ptah-electron/src/main.ts
  apps/ptah-cli/project.json
  apps/ptah-extension-webview/src/app/app.config.ts               # 12 + 14d
  apps/ptah-extension-webview/src/app/app.html
  apps/ptah-extension-webview/src/app/app.ts
  apps/ptah-extension-webview/src/app/thoth-message-routing.spec.ts  # 14d
  ```

  **REWRITE (deletion within an existing file)**

  ```
  libs/backend/persistence-sqlite/src/lib/sqlite-connection.service.ts
      — delete runBootChecks (:602-635) and its call site (:214)
  ```

- **Verification points.**

  _Contracts to honour_
  - `ALLOWED_METHOD_PREFIXES` (`rpc-handler.ts:44-90`) **and**
    `RpcMethodRegistry` + `RPC_METHOD_ENTRIES` in `libs/shared/.../rpc.types.ts`.
    Both, or the app crashes at boot.
  - The `manifest.ts` entry must keep the manifest a total, disjoint partition of
    `RPC_METHOD_NAMES` — `rpc-allowlist.spec.ts` is the gate.
  - `FILE_BASED_SETTINGS_DEFAULTS ⊆ FILE_BASED_SETTINGS_KEYS`
    (`file-settings-keys.spec.ts:162-170`).
  - `MIGRATIONS` is forward-only and append-only. `0042` uses
    `CREATE TABLE IF NOT EXISTS` only, no rebuild, no backfill, static SQL.
  - `SkillTriggerService`'s 17-argument constructor must not gain a parameter —
    two specs build it positionally.
  - `BootCoordinator` must keep every import type-only.
  - The message protocol is append-only: `MESSAGE_TYPES`, the `StrictMessageType`
    union and `payload-map.ts` all gain `activity:event` and nothing is renamed
    (`libs/shared/CLAUDE.md` guideline 5).
  - `chat-ui` stays presentational — the ticker takes inputs and emits an output;
    it must inject no service (`libs/frontend/chat/CLAUDE.md` guideline 2).
  - `chat-ui` gains **no** new external dependency; the ticker animates with CSS.
  - `thoth-runtime` must not learn what a ticker is: `activity-emitter.ts`
    resolves `TOKENS.WEBVIEW_MANAGER` lazily and broadcasts a generic payload, in
    the same guarded, non-fatal shape as `boot-thoth-runtime.ts:245-345`.
  - No subsystem that already broadcasts may gain a second broadcast.
  - `persistence-sqlite` must not import `electron`; `thoth-runtime` must not
    import `electron` or a renderer type; `skill-synthesis` must not import
    `cron-scheduler`.

  _Data changes_
  - Migration `0042` applies on top of `41` (confirmed live: `MAX(version) = 41`).
    Verify a boot against a **copy** of a real database, never the production
    file — a newer schema written into `~/.ptah/state/ptah.sqlite` leaves an older
    installed build unable to open it (`persistence-sqlite/CLAUDE.md`). Set
    `PTAH_DB_PATH` to a temp copy for every harness run.

  _Commands that must pass_

  ```
  npx nx run-many -t test -p @ptah-extension/persistence-sqlite @ptah-extension/skill-synthesis @ptah-extension/thoth-runtime @ptah-extension/platform-core @ptah-extension/vscode-core @ptah-extension/rpc-handlers @ptah-extension/shared @ptah-extension/cli-engine
  npx nx run-many -t test -p @ptah-extension/core @ptah-extension/chat-ui @ptah-extension/chat ptah-electron ptah-extension-webview
  npm run typecheck:all
  npm run lint:all
  nx build ptah-electron          # must produce dist/apps/ptah-electron/integrity-worker.mjs
  nx build ptah-cli
  ```

  Never `nx test a b c` — Nx runs the first project only and turns the rest into
  Jest path filters, which exits 0 having run nothing. Read the
  `Running target test for N projects` header and confirm N.

  _Acceptance measurement (senior-tester, after A1 lands)_
  - Cold-cache boot of the packaged Electron app against a copy of the 1 GB
    database: `openAndMigrate()` under 3 s, no lag warning above 500 ms before
    the first answered RPC, and no boot-scan enqueue inside the first 5 minutes.
  - On the same cold boot, the header ticker narrates the phases as they happen
    and settles into its collapsed form once the boot is done — the user-facing
    proof that the relocated work is running rather than missing.
  - Re-run `apps/ptah-electron-e2e/scripts/measure-boot-rpcs.mjs` **cold** and
    record whether any SQLite-backed method lands inside the window. If one does,
    that run — and only that run — authorises a readiness guard, on exactly the
    methods it names.
