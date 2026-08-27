# TASK_2026_331 — Context

## User intent (verbatim)

> these are very poor decisions we made before and we need to have a more performant and stable fixes not pain-aid fixes ? basically we should be utilizing the worker process or utility process and intelligently decide what to do with these features and boot time work so we don't loose them but also we make our application performant ? (use codex cli to help you do that work intelligently)

Interpretation: an architectural redesign of the Electron boot path. Keep every feature. Move heavy work off the main event loop into `utilityProcess` / `worker_threads`. Open the window first. No patch-level fixes.

## Orchestration

- Task type: REFACTORING
- Workflow: Partial (Architect -> Team-Leader -> Developers -> QA)
- cli_delegation: enabled — `codex` (user requested). Max 3 concurrent.
- Branch: `fix/electron-update-check-timeout` (carries TASK_2026_323 instrumentation)

## Measured evidence (installed build 0.1.68, log 2026-08-27)

Boot timeline, seconds from launch:

| t (s)     | Item                                                                                                                       | File                                                                                                                                                                                                                       |
| --------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2 -> 20   | `PRAGMA quick_check` on 951 MB db, synchronous                                                                             | `libs/backend/persistence-sqlite/src/lib/sqlite-connection.service.ts:604` (`runBootChecks`)                                                                                                                               |
| 20 -> 22  | SKILL.md migration `readdirSync`/`readFileSync` over 2391 + 2390 files, all skipped every boot                             | `libs/backend/skill-synthesis/src/lib/skill-md-migration.ts:47,81-93`; called from `skill-synthesis.service.ts:304,311`                                                                                                    |
| 22        | memory + skills boot scans start (63 sessions, 200 ms throttle)                                                            | `memory-curator/src/lib/triggers/boot-scan-runner.ts`, `memory-trigger.service.ts:894` (no `tailBytes` -> whole transcript, up to 36 MB), `skill-synthesis/src/lib/trajectory-extractor.ts:168` (full `readJsonlMessages`) |
| 22 -> 40  | user-layer mirror, `reconcileUserLayer` (walk + sha256), `reconcileHarness('activation')` (no abort signal), CLI detection | `apps/ptah-electron/src/activation/wire-runtime.ts:309,317,360`                                                                                                                                                            |
| 40 -> 73  | `sessionImporter.scanAndImport(root, 50)` awaited; prune iterates every stored session                                     | `wire-runtime.ts:429`; `agent-sdk/src/lib/session-importer.service.ts:107,136,157-224`                                                                                                                                     |
| 73        | **window created**                                                                                                         | `apps/ptah-electron/src/activation/post-window.ts:108`                                                                                                                                                                     |
| 75 -> 96  | `workspace:switch` runs a second `scanAndImport` + file re-index                                                           | `rpc-handlers/src/lib/handlers/workspace-rpc.handlers.ts:445-540`                                                                                                                                                          |
| 22 -> 480 | boot scans continue; 10 haiku internal queries spawn `claude.exe`                                                          | log                                                                                                                                                                                                                        |

Additional blockers found by trace:

- Workspace file index (`@`-picker) built right after Thoth boot: `boot-thoth-runtime.ts:386` -> `workspace-intelligence/src/file-indexing/workspace-indexer.service.ts:386-408` -> `ignore-pattern-resolver.service.ts:225-239` (async with zero I/O, microtask-only, never yields) -> `pattern-matcher.service.ts:146` (`JSON.stringify` cache key per call). ~1.5 M pattern checks on a 15k-file workspace, one unbroken run.
- Two `SELECT COUNT(*)` scans awaited before the window: `memory-curator/src/lib/control/indexing-control.service.ts:226-239`, called from `boot-thoth-runtime.ts:135`. Only feeds a UI badge.
- Cron cold-start catch-up can run `@ptah/daily-backup` at boot: full-file copy + synchronous `incremental_vacuum` + `optimize` (`thoth-runtime/src/lib/start-thoth-cron.ts:215-244`, `cron-scheduler.ts:111`).
- Pre-migration backup copies the whole db on the boot path when a migration is pending (`migration-runner.ts:88-101`).
- Network awaited before window: `bootstrap.ts:230` (`verifyLicense`), `bootstrap.ts:302` (`agentAdapter.initialize`).
- `registerRpcSurface` eagerly resolves ~30 handler graphs synchronously (`wire-runtime.ts:224`).
- Structural: `main.ts:70-197` awaits `bootstrapElectron` -> `wireRuntime` -> `registerPostWindow` in series; `wire-runtime.ts:569` awaits the whole `bootHeavyServices` before the window.

Database facts (`~/.ptah/state/ptah.sqlite`, 951 MB):

- `observation_queue` ~684 MB, 142,834 rows, 140,504 processed, oldest 2026-06-01. `ObservationQueueStore.purgeOlderThan` (`observation-queue.store.ts:650`) has NO production caller. Rows accumulate forever.
- `memories` 23 MB, `memory_chunks` 10 MB, `code_symbols` 4.5 MB.

Already off the main thread (keep as reference patterns):

- Embedder: `utilityProcess` via `apps/ptah-electron/src/services/platform/electron-embedder-worker-factory.ts` + `memory-curator/src/lib/embedder/embedder-worker-client.ts` + `embedder-worker-protocol.ts`; separate esbuild target `build-embedder-worker`.
- Voice: `electron-voice-worker-factory.ts`.
- TS diagnostics: `worker_threads` in `workspace-intelligence/src/diagnostics/ts-diagnostics-worker-source.ts`.
- Tree-sitter symbol indexer does not run at boot (RPC-triggered).

Constraints:

- Hexagonal rule: backend libs depend on `platform-core` ports; host-specific process spawning goes through a port implemented in `platform-electron` / the app (like `IEmbedderWorkerProcessFactory`). VS Code and CLI hosts must keep working (worker_threads or in-process fallback).
- `better-sqlite3` connection is single, owned by `persistence-sqlite`. A worker may open its own read-only connection for scans, but writes stay on the owner, or the design must justify otherwise.
- Existing event-loop lag monitor + CPU profile (`vscode-core/src/diagnostics`) on this branch should be the verification instrument.
- No feature may be removed: boot scans, session import, harness reconcile, file index, integrity checks, backups all stay — relocated, deferred, bounded, or made incremental.

## Decisions log

- 2026-08-27: user chose architectural redesign over patches; codex CLI as helper.
- 2026-08-27: codex hit its usage limit mid-audit. User directed: continue with Claude sub-agents only. `cli_delegation: disabled` from here on.
