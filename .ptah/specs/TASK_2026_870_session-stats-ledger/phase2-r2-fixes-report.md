# Phase 2 round-2 fixes report

## Findings and fixes

| Finding | Fix | Regression spec |
| --- | --- | --- |
| Startup scan races provider registration | `libs/backend/persistence-sqlite/src/lib/session-store/sqlite-session-usage-sink.ts:117-155` keeps the guarded startup scan pending until the provider is installed. The zero-delay fallback reconciles pending rows only; it cannot seal active IDs without a provider. Registration during an in-flight pass schedules the startup scan afterward. | `session-stats-repository.spec.ts:69` covers provider-first and timer-first orders and preserves a live row. |
| Electron closes SQLite before slow interruption queues finalization | `apps/ptah-electron/src/activation/shutdown.ts:303-315` snapshots and queues end requests before chat disposal starts; the bounded request wait and existing bounded disposal/drain remain. `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:818-821` queues its own terminal requests before `disposeAllSessions` waits, so a late disposal completion does not first request after close. | `shutdown.spec.ts:380` holds chat disposal open and asserts the request was queued first, then verifies drain before close. |
| Higher revision reopens a true end indefinitely | `libs/backend/persistence-sqlite/src/lib/session-store/session-stats-repository.ts:205-210` preserves finalization state whenever a finalization revision exists. Only explicit `resumeSession` clears it; late usage still updates revision and totals. | `session-stats-repository.spec.ts:93` checks late higher revision, explicit resume, and a later true end. |

## Decisions

- Queue the terminal snapshot before slow teardown. Shutdown is already terminating these sessions, and the sink serializes requests behind accepted usage writes. This is reversible.
- Preserve a true end across every late revision until explicit resume. The existing owner calls `resumeSession` before a new run. This is reversible.
- The existing retry-metadata catch already logs the real error and leaves the row eligible for a later pass; no additional change was needed.

## Verification

Ran exactly once: `npm run verify -- -t test -p @ptah-extension/persistence-sqlite,@ptah-extension/agent-sdk,@ptah-extension/cli-engine,ptah-electron`. The verifier acquired a slot, then Nx failed loading default and ESLint/Jest plugins with `spawn EPERM` (exit code 1). No tests ran; it was not retried. Scoped `ptah_get_diagnostics` was attempted after edits; TypeScript checking remained unavailable after 45 seconds, so the changed files were unchecked.
