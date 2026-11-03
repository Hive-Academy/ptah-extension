# Phase 1 implementation report

## Status

Phase 1 code is present in the worktree. Full scoped verification is **not established**: Nx worker creation failed with `spawn EPERM` in this sandbox, despite the verify wrapper returning exit code 0. The coordinator should rerun the scoped command in an environment that permits Nx workers before merging.

## Decisions

- The sink contract lives in `platform-core` because `persistence-sqlite` is tagged `type:util` and cannot import `agent-sdk` (`type:feature`). This keeps the Nx dependency direction acyclic. Reversible by moving the contract within the shared util layer.
- Electron and CLI both call `registerSessionStoreServices` during composition, so binding the sink and repository there reaches both hosts. No VS Code DI root was found in this worktree; optional injection lets that host resolve without persistence.
- Every model row uses the idempotent `(session_id, producer, event_key, model_id)` key; the adapter encodes the run ID in the event key. Higher revisions replace earlier rows atomically with session aggregate recomputation. This is reversible with a migration.
- Unknown cost is `NULL` with `has_unpriced`; money is integer micro-USD.
- SQL answers range stats. Current-context stats retain JSONL because the SQL aggregate cannot identify the post-compaction boundary.
- JSONL backfill is permanently excluded by the user's PR 1 decision; finalization and frontend cleanup remain PR 2 work.

## Files changed

- `libs/backend/platform-core/src/interfaces/session-usage-sink.interface.ts`, `src/di/tokens.ts`, `src/index.ts`: port and token.
- `libs/backend/persistence-sqlite/src/lib/session-store/session-store-migrations.ts`, `session-stats-repository.ts`, `session-stats-repository.spec.ts`, `sqlite-session-usage-sink.ts`, `register-session-store.ts`, and `src/index.ts`: S0002, atomic upsert, scoped SQL queries, sink, registration and tests.
- `libs/backend/agent-sdk/src/lib/session-stats/session-usage-sink.ts`, `session-stats-owner.service.ts`, `session-stats-owner.service.spec.ts`, `src/lib/session-metadata-store.ts`, and `src/index.ts`: accepted Claude/Codex deltas and stream-safe logging.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts` and `lane-completion-outcome.ts`: terminal lane capture.
- `libs/backend/usage-analytics/src/lib/usage-summary.service.ts` and `usage-summary.service.spec.ts`: SQL Ptah summary, external adapters retained.
- `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts` and `session-stats-ledger-reader.ts`: range stats SQL first, JSONL fallback for absent IDs.
- `apps/ptah-electron/src/di/expected-resolvable.ts`: sink DI guard. Existing Electron and CLI registration calls bind the sink. No RPC surface change required other guard edits.

## Provider coverage

| Provider | Capture | Reason |
| --- | --- | --- |
| Claude SDK | Yes | Accepted owner results yield per-turn model deltas; provisional estimates, Stop and compaction yield no rows. |
| Codex | Yes | Accepted non-regressing native checkpoints yield deltas. |
| CLI lanes | Conditional | Terminal usage is captured only when an adapter declares a turn total; currently the Codex app-server lane does so. |
| Cursor | No | Normalized adapter output has no reliable accepted turn usage total. |
| ACP | No | Normalized updates contain no usage; `max_tokens` is a setting. |

Parent and subagent streams use separate producer/event identities; lane totals are not folded into parent turn totals.

## Verification

- Persistence subtask ran `npm run verify -- -p @ptah-extension/persistence-sqlite` with `NX_DAEMON=false`, `NX_ISOLATE_PLUGINS=false`: exit 0 before final integration edits; scoped diagnostics reported zero TypeScript errors.
- Final foreground command: `npm run verify -- -p @ptah-extension/platform-core,@ptah-extension/persistence-sqlite,@ptah-extension/agent-sdk,@ptah-extension/cli-agent-runtime,@ptah-extension/usage-analytics,@ptah-extension/rpc-handlers,ptah-electron` with the same two environment settings. Wrapper exit **0**, but output contains repeated `Error: spawn EPERM` from `ForkedProcessTaskRunner`; lint/test/typecheck completion is **not demonstrated**. Log: `%TEMP%/task870-phase1-verify.log`.
- `ptah_get_diagnostics` after edits: zero errors for `usage-summary.service.ts` and `session-usage-sink.ts`. Other scoped checks reported unavailable after 45 seconds, not a pass.
- Added tests for old-DB S0002 migration, duplicate/older revision, null cost, workspace isolation, overflow rollback, UTC day boundary/mixed provider/unpriced SQL facts, and sink failure preserving accepted owner results. These await successful scoped verification.

## Known gaps for PR 2

- Finalizer job and frontend dashboard cleanup.
- Historical sessions remain absent from SQL analytics permanently; no backfill exists.
- The bounded sink retry queue has no host shutdown flush. A failed final write can be lost at exit.
- CLI lane rows use their own session or lane ID. If that ID has no `sessions` row, the workspace join omits it from analytics. Parent linkage reaches the port but is not persisted in S0002.
- SQL facts and top sessions cannot report exact subagent counts; the Ptah source is marked partial when facts exist. Range stats are partial for sessions with earlier uncaptured history.
- External Codex and other adapters remain. Overlap between a Ptah Codex session and external Codex source has not been proven absent; deduplication needs source identity evidence.
