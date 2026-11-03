# Persistence Phase 1 deliverable

## Implemented

- Added S0002 to `sessions.sqlite` with per-event usage rows, session aggregates, and workspace/time indexes.
- Added `SessionStatsRepository`: Zod checked inputs and rows, revision-aware idempotent upserts, atomic multi-model event writes, recomputed session totals, safe-integer rollback, and SQL workspace groups, top sessions, and distinct session counts.
- Added `SqliteSessionUsageSink` implementing the agent SDK public port. It maps accepted model deltas and reported cost residuals to one transaction, keeps a bounded retry queue, and never throws into the stream.
- Registered the sink through `SDK_TOKENS.SDK_SESSION_USAGE_SINK`, exposed repository and sink from the registration result and persistence public index.
- Added integration coverage for migration SQL, duplicate and older revisions, workspace scope, null cost, and aggregate overflow rollback.

## Decisions

- Event keys are stored as the JSON encoding of `[runId,eventKey]` because the SDK port scopes event identity to a run while the table key does not include run ID. This is reversible with a later schema migration.
- Missing model and session residual use reserved model IDs `__unattributed__` and `__session_residual__` so the SQLite primary key remains deterministic. This is reversible by mapping to nullable display labels in the query layer.
- No JSONL backfill or finalizer was implemented, following the user override and Phase 1 scope.

## Verification

- Scoped `ptah_get_diagnostics`: zero TypeScript errors after the SDK public export appeared.
- `npm run verify -- -p @ptah-extension/persistence-sqlite`: exit 0 with `NX_DAEMON=false` and `NX_ISOLATE_PLUGINS=false`. The initial foreground attempt failed before checks because sandboxed Nx plugin worker spawning returned `EPERM`.

## Integration notes

- The query owner can use `RegisteredSessionStore.stats` or `SessionStatsRepository` from the persistence public alias. `getWorkspaceUsageGroups(workspaceKey, fromMs, untilMs)` returns day/provider/model/source/cost-authority groups, `getWorkspaceTopSessions` returns five sessions, and `getWorkspaceSessionCount` returns the distinct count. All ranges use UTC milliseconds with an exclusive upper bound.
- The source event port is imported only from the platform-core public alias. The adapter is fire-and-forget; a failed queued event retries when another event arrives. A host close hook is not wired in this assigned file set.

## Follow-up from parent coordination

- Registration now uses the existing `PLATFORM_TOKENS.SESSION_USAGE_SINK` from platform-core. Its current source value is `Symbol.for('PlatformSessionUsageSink')`.
- Exact repository API was sent to the parent: `recordUsage`, atomic `recordEvent`, `getSessionStats`, `getWorkspaceUsageGroups`, `getWorkspaceTopSessions`, and `getWorkspaceSessionCount`. Query methods take an exact workspace key and `[fromMs, untilMs)` UTC milliseconds.

## Nx dependency correction

- Persistence now imports the `SessionUsageSink` and `SessionUsageContribution` types from the platform-core public alias. The adapter validates incoming contributions with its own Zod schema. All agent-sdk imports were removed from persistence to satisfy the `type:util` to `type:feature` boundary.
- Registration uses `PLATFORM_TOKENS.SESSION_USAGE_SINK`. Scoped diagnostics report zero errors and `npm run verify -- -p @ptah-extension/persistence-sqlite` exits 0 with Nx daemon and plugin isolation disabled.
- A later parent message described `SessionUsageTurn`, but the platform-core file on disk still exports `SessionUsageContribution` and `recordUsage(contribution)`. The adapter follows the current public source contract. A future port change would require a corresponding adapter update.

## Final handoff

- Current platform-core source still exports `SessionUsageContribution` and `PLATFORM_TOKENS.SESSION_USAGE_SINK`; persistence imports and registers exactly those public symbols.
- Per the latest parent instruction, this lane did not run another verification after the handoff. The parent owns one foreground scoped verification after integration. Earlier scoped diagnostics and persistence verification passed before this handoff.
- Reinspected the latest platform-core interface: the batch has `models[]`, nullable total cost, and residual authority. `SqliteSessionUsageSink` maps every model to a row, adds only a positive total-cost residual, and registers under `PLATFORM_TOKENS.SESSION_USAGE_SINK`. No agent-sdk import or source change was needed for this final inspection.
