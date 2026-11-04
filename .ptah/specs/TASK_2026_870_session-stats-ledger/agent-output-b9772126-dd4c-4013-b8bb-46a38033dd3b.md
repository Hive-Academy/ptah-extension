# Persistence lane report

## Completed

- Replaced complete `(session_id, producer, event_key)` row sets on newer revisions in one transaction, removing obsolete model and residual rows. Older or duplicate revisions remain ignored.
- Added S0003 columns for event workspace and host identity, plus a per-workspace first/last live capture table. Existing S0002 rows seed coverage during migration. Repository reads use the session binding when present and event identity for an orphan lane. The required `workspaceKey` parameters on all three session read methods remain unchanged.
- Changed the sink to serialize writes without capacity eviction. Each write returns a promise that rejects on failure; later writes continue. `flush()` waits for queued writes and reports failures.
- Added optional `flush(): Promise<void>` to the platform `SessionUsageSink` interface so Electron and CLI shutdown can call it through `PLATFORM_TOKENS.SESSION_USAGE_SINK`. The SQLite sink already implements this public method.
- Confirmed the repository already exposes `hasSessionStats(sessionId): Promise<boolean>` as an existence-only read. Added regression assertions that a missing identity returns false while an existing identity returns true even when `getSessionStats` is null for a foreign workspace. The handler owner can suppress JSONL fallback on that signal.
- Added regression tests for event row removal, orphan lane workspace isolation and coverage, and a 70-event queue with a failed write.

## Verification

- Direct Jest project config: 7 tests passed in `session-stats-repository.spec.ts`.
- `tsc --noEmit -p libs/backend/persistence-sqlite/tsconfig.lib.json`: passed.
- `ptah_get_diagnostics`: unavailable because the TypeScript service remained running after 45 seconds. Native project TypeScript check passed.
- Follow-up interface edit: scoped `ptah_get_diagnostics` returned 0 errors and 0 warnings.
- Follow-up security assertions: focused Jest suite passed 7/7. Scoped Ptah diagnostics timed out with two files unchecked; Jest compiled and ran the changed spec.
- Nx test could not start its plugins in the sandbox (`spawn EPERM`); direct Jest succeeded.

## Decisions

- Event revisions replace the whole event because residual and model rows can disappear between revisions. This follows the review and is reversible by a later migration if a different event version model is required.
- Workspace ownership from `sessions` takes precedence over event workspace identity; an orphan event uses its supplied workspace. This preserves the existing session authorization boundary and is reversible.
- A failed sink write rejects its caller and does not block later writes. This avoids silent eviction while keeping producer failure handling explicit. Reversible.

## Remaining integration work

- The lane producer currently sends neither `workspaceKey` nor `host`; its owner must populate the new optional contract fields for orphan lane rows to appear in workspace analytics. This dependency was reported to the parent session.
- The analytics consumer must use `getWorkspaceCoverage()` to mark ranges without proven historical coverage as partial. Captured first/last event times do not prove completeness.
- No host shutdown hook currently calls `flush()`, and the sink is not a durable outbox. Abrupt process exit before pending writes finish can still lose events. The parent session must connect lifecycle finalization or choose a durable outbox.
- External Codex overlap and producer cost correction behavior are outside this persistence assignment.

## SDK cost decrease handoff

The producer's `acceptedTurnCost()` returns `null` when a rate change lowers the accepted cumulative run cost. `ownerTurnContribution()` emits only nonnegative per-turn model and total deltas. Existing persisted positive turn costs therefore remain in `session_usage_turns`; persistence cannot reconstruct the corrected absolute run total from the current payload.

Recommended coordinated change: the SDK owner supplies each accepted run's absolute, base-adjusted per-model cost and total, with a stable run identity and monotone revision. Persistence stores these as replaceable per-run snapshots in the same transaction as the accepted turn, keeps turn rows for token and message counts, and excludes their costs once a snapshot exists. Every aggregate and day/range query must read the same effective cost facts; synthetic snapshot rows must not add message counts. A residual model row handles an authoritative total above attributed model costs. This requires a producer contract, a SQLite migration, and query updates together. It was sent to the parent session as a design decision before source edits. No snapshot mechanism was written in this turn.

Options for the parent: (1) **Recommended:** absolute per-run snapshot with model costs, preserving model attribution and replay safety; (2) absolute run total only, simpler but loses model cost attribution; (3) signed adjustments, smaller schema change but violates the requested replacement model and complicates replay. The choice is reversible through a later migration, but must be coordinated with the producer owner before source changes.
