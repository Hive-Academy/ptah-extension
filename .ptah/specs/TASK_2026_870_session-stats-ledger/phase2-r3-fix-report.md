# Phase 2 round-3 fix report

## Fix

`libs/backend/persistence-sqlite/src/lib/session-store/session-stats-repository.ts:264-292` adds keyset paging over 32-row startup batches. The cursor advances by the selected row's original timestamp and session id, including live rows that must remain active. The existing SQL still requires both usage and update timestamps to be idle and skips live ids before sealing.

`libs/backend/persistence-sqlite/src/lib/session-store/sqlite-session-usage-sink.ts:143-163` scans startup pages until a short page, yielding with `setImmediate` between full pages. It stops after 128 pages and logs a real `Error` when that bound is hit. The periodic path continues to reconcile pending rows only.

## Spec

`libs/backend/persistence-sqlite/src/lib/session-store/session-stats-repository.spec.ts:69` creates 70 eligible idle rows plus a live row and checks that every idle row is finalized while the live row stays active.

## Verification

Scoped `ptah_get_diagnostics` reported 0 errors and 0 warnings for the three changed TypeScript files. Ran exactly once: `npm run verify -- -t test -p @ptah-extension/persistence-sqlite`. It waited for a memory slot, acquired one, then Nx failed while loading default and ESLint/Jest plugins with `spawn EPERM` (exit code 1). No tests ran; the command was not retried.

## Decisions

- Use keyset paging because sealed rows leave the candidate set and a live row can remain in it. This avoids offset skips and repeated selection of the same live row. Reversible.
