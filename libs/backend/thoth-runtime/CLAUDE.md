# @ptah-extension/thoth-runtime

[Back to Main](../../../CLAUDE.md)

## Purpose

Runtime-agnostic boot of the **Thoth channel** — the persistence + memory + skills + cron half of a Ptah host. Extracted verbatim from `apps/ptah-electron/src/activation/wire-runtime.ts`, which remains the reference implementation.

Owns: SQLite open/migrate + `sqlite-vec` diagnostics, memory curator + memory trigger, memory/vec/embedder push bridges, skill synthesis + skill trigger, code-symbol indexing run-deps, the workspace file index, and the cron scheduler with its built-in daily backup job and nightly database integrity-check job.

## Boundaries

**Belongs here**: anything on the Thoth lifecycle path that only needs DI tokens to do its job.

**Does NOT belong**: host activation (content download, plugin loader, CLI detection, session import, git watcher, application menu), transport wiring, and the messaging gateway. Those stay with the host.

No `electron`, `vscode`, or app-local imports. Every collaborator is resolved from the `DependencyContainer` passed in by the host.

## Public API

```ts
bootThothRuntime(container, { workspaceRoot, logPrefix?, signal? }): Promise<ThothRuntimeRefs>
startThothCron(container, refs, { logPrefix? }): Promise<void>

emitVecLoadDiagnostic(container, diagnostic, logPrefix?)
serializeVecDiagnosticForBridge(diagnostic)
serializeEmbedderSnapshotForBridge(snapshot)
resetVecLoadDiagnosticForTest()      // test-only latch reset

createActivityEmitter(container, logPrefix?): ActivityEmitter
withActivityEmit(emit, handlerName, handler): JobHandler

emptyThothRuntimeRefs(): ThothRuntimeRefs
DEFAULT_THOTH_LOG_PREFIX
```

## Guidelines

- **Cron is a separate call on purpose.** Hosts run their own activation work between the Thoth boot and the cron start; folding cron into `bootThothRuntime` would let scheduled jobs fire during content download / session import. Do not merge them.
- **Every block is individually guarded and non-fatal.** A failure degrades that feature to `PERSISTENCE_UNAVAILABLE`; it never aborts host activation. Keep new blocks in the same shape.
- **`openAndMigrate()` is the only awaited step, and it stays first.** The memory boot scan, the skill-synthesis walk, the `IndexingControlService.getStatus` probes and the file index are STARTED, not awaited, so a host can open its window before them (TASK_2026_331). Each attaches its own `.catch` and each honours `signal`. Do not re-await one of them, and do not move work in front of `openAndMigrate()`.
- **The daily backup runs OUT OF PROCESS and takes no database handle** (TASK_2026_383). `@ptah/daily-backup` (`0 3 * * *` UTC, handler `backup:daily`) calls `backupSvc.backup('daily')` — one argument; the worker opens the file itself, read-only — then `rotate('daily', 7)`. **The `refs.sqliteConnection` guard sits BELOW that call and gates only the two write pragmas** (`incremental_vacuum(100)`, `optimize`), which are the only part of the job that still needs a live handle. It used to sit above the backup, which silently skipped the daily backup on every host with no live connection — the host that most needs one. Do not move it back up, and do not re-add a `db` argument. A `null` return is not an error: the summary reads `backup not taken; see the database.backup degradation report`, and the reason is a `'critical'` degradation event from `SqliteBackupService`, not a throw here.
- **The integrity check is dispatched, never awaited.** `startThothCron` upserts `@ptah/db-integrity-check` at `30 3 * * *` UTC (deliberately off the backup's `0 3` — a full-file read must not contend with a full-file write) and arms one `unref`'d 60 s boot dispatch. Both call `dispatchIfDue()` with a bare `void`: the check costs 20–26 s cold on a gigabyte file and never throws. Both live behind the `SQLITE_INTEGRITY_SERVICE` registration guard, so a host without it gets no job and no timer.
- **Shipped cron handlers emit one `activity:event` each** — wrap them in `withActivityEmit(emit, handlerName, handler)`, built from one `createActivityEmitter(container, logPrefix)` per `startThothCron` call. A thrown handler emits nothing and rethrows; the scheduler's run row is the failure channel (there is no `'error'` level). User-defined jobs emit nothing today — that needs an event surface on `CronScheduler`, which is a follow-up.
- **`ThothRuntimeRefs` field names are load-bearing** — hosts capture them for their LIFO teardown chain. Renaming a field is a breaking change for every host.
- **`logPrefix`** exists so hosts keep their existing console signature (`[Ptah Electron]`). It is not a logging abstraction; do not grow it into one.
- `libs/backend/cli-engine` has its own `activateThoth`/`disposeThoth` for the CLI tier model. Converging the two is a separate task — do not partially merge them.

## Cross-Lib Rules

`scope:extension`, `type:feature`. Depends on `platform-core`, `vscode-core`, `shared`, `persistence-sqlite`, `memory-curator`, `skill-synthesis`, `cron-scheduler`, `workspace-intelligence`, `rpc-handlers`. No frontend imports.

## Test

`nx test @ptah-extension/thoth-runtime`. Specs drive a hand-rolled `DependencyContainer` stub (`isRegistered` + `resolve`) rather than a real tsyringe graph, so they assert boot behaviour rather than registration.
