# Phase 2 implementation report

## Files changed

- `libs/backend/platform-core/src/interfaces/session-usage-sink.interface.ts`
- `libs/backend/persistence-sqlite/src/lib/session-store/session-store-migrations.ts`
- `libs/backend/persistence-sqlite/src/lib/session-store/session-stats-repository.ts`
- `libs/backend/persistence-sqlite/src/lib/session-store/session-stats-repository.spec.ts`
- `libs/backend/persistence-sqlite/src/lib/session-store/sqlite-session-usage-sink.ts`
- `libs/backend/persistence-sqlite/src/lib/session-store/register-session-store.ts`
- `libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts`
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.ts`
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts`
- `libs/shared/src/lib/types/rpc/rpc-analytics.types.ts`
- `libs/backend/usage-analytics/src/lib/usage-summary.service.ts`
- `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-summary-fold.ts`
- `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-summary.view-model.ts`
- `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-summary.view-model.spec.ts`
- `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-dashboard.component.html`
- `libs/frontend/dashboard/src/lib/services/analytics-usage.store.ts`
- `libs/frontend/chat/src/lib/services/vitals/usage-vitals.cache.ts`

## Finalizer lifecycle

True ends are `SdkAgentAdapter.endSession`, successful token-matched stream end, workspace disposal, config reinitialization, and adapter disposal. Those paths request finalization for both provisional and canonical session keys after teardown succeeds. `interruptSession` (Stop/clear), turn abort, and compaction do not request it. The usage sink queues the request behind accepted usage writes. S0003 adds `finalize_revision`, `finalize_attempts`, and `finalize_retry_at_ms`; S0002 is unchanged. A resumed contribution restores `active`, clears `finalized_at_ms` and retry metadata.

Electron and CLI already call `registerSessionStoreServices` in their composition roots. That registration now starts a single background worker without awaiting it. It handles up to 32 rows each pass, initially and every 60 seconds, with an unref'd timer and at most one pass running. Rows in `finalize_pending` are eligible when due; active rows are eligible after **30 minutes without captured usage**. Sealing requires unchanged session revision, state, and the maximum stored turn revision. Duplicate passes are harmless. Failures are logged as real `Error` objects through the injected logger; a row update failure attempts to retain pending state with exponential retry metadata. A SQLite busy failure before metadata can be saved leaves the row pending for a later pass. The sink's existing host shutdown drain stops the timer. No JSONL backfill was added.

## Frontend and contract

The SQL summary already supplies session/message counts and top sessions, which remain authoritative. The dashboard keeps provider/day/model folding needed to render chart series and rows; the RPC does not return those presentation shapes. The shared response gains optional `knownCostUsd` for the priced portion of mixed groups and `coverageStart` for the ledger source. The backend producer supplies both. The view model preserves unknown cost and displays known mixed cost as a lower bound. The dashboard shows the capture start and a partial-coverage empty state. `sessionCostEstimate` remains because legacy session-list readers still use it. Chat vitals cache behavior is unchanged; its source comment was corrected. A view-model regression case covers mixed cost and partial coverage.

## Decisions

- Extend the existing optional usage sink and stats owner for finalization requests. The same sink already serializes accepted writes and is registered by Electron and CLI. Reversible.
- Use a 30-minute idle threshold and a 60-second, 32-row worker pass. These bounds permit eventual crash recovery without per-session timers. Reversible.
- Keep chart-oriented folding because the RPC only supplies grouped facts, not chart geometry. Reversible.

## Verification exactly observed

- The single scoped `npm run verify -- -p @ptah-extension/platform-core,@ptah-extension/persistence-sqlite,@ptah-extension/agent-sdk,@ptah-extension/usage-analytics,@ptah-extension/shared,@ptah-extension/dashboard,@ptah-extension/chat,@ptah-extension/cli-engine,ptah-electron` invocation acquired a slot, then Nx reported daemon socket `connect EPERM` and plugin loading `spawn EPERM`. The verify wrapper reported exit code **1**. No lint, test, or typecheck pass was established. Per instruction, Nx was not retried.
- Scoped `ptah_get_diagnostics` calls were **unavailable** after 45 seconds with the requested TypeScript files unchecked. This is not a pass.
- No build, serve, e2e, package, or workspace-wide command was run.

## Known gaps

- Automated verification did not complete because of the observed sandbox `spawn EPERM`; a coordinator CI run is needed. The final small adapter key-resolution edit happened after the failed verify invocation and likewise has no compiler result.
- The Angular template was not rendered or screenshot inspected because serving the app was outside this lane's allowed commands.
- The optional `angular-frontend-patterns` skill could not be loaded: this host lists no skill-loading tool. The frontend lane applied the repository's Angular guidance directly.
