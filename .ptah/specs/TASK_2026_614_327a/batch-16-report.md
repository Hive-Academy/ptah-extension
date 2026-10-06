# Batch 16 report — Session budget entry lifetime and action guards (F.1 M5, M7)

Executor: backend-developer (Opus). No git operations run. `batches.md` not edited.

## Tasks

| Task | State | Summary |
| --- | --- | --- |
| 16.1 (M5) | DONE | `write-handoff` / `preview-handoff` with no entry → `{ success: false, error: 'No budget state for this session' }`; no transcript read, no file written, no prune |
| 16.2 (M7) | DONE | Released ids are remembered (capped set); a late result or compaction for one creates no entry until a new run owns the session (its stats owner exists) or the user loads it |
| 16.3 (M7) | DONE | Idle eviction releases the budget through the adapter's `releaseBudget` helper; headless children release on a true end, after the interrupt settles. A3 holds: `session-spawner.service.ts` already imports `@ptah-extension/agent-sdk` (SDK_TOKENS etc.). The only addition is a type import of `SessionBudgetService` plus an optional `SDK_TOKENS.SDK_SESSION_BUDGET` injection. No new lib edge. |

## Files changed

Batch files:

- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget.service.ts`
  - `released: Set<string>` (insertion order, capped at `RELEASED_IDS_CAP = 1024`; the oldest id is dropped first). `release` adds the id. `clearAll` empties the set.
  - New `trackedEntry(sessionId, source)`: returns an existing entry, else creates one. For a released id it returns `undefined` on `live` (late result or compaction) while `statsOwner.leaseOf(id) === null`. A new run (owner exists) or a `loaded` snapshot clears the mark. It is used by `recordCompaction` and `acceptOrThrow`. The `accept` catch now reads `entries.get` (no `entryFor`).
  - `acceptOrThrow` resolves the entry before `getConfig()`, so the existing once-per-session WARN on a throwing config read still dedupes.
  - `SessionBudgetStatsSource` is now `Pick<…, 'snapshot' | 'leaseOf'>`.
  - `writeHandoffAction` / `previewHandoff` return `noState()` when there is no entry.
- MODIFIED `…/session-budget/session-budget.service.spec.ts`: the harness now has `ownerLease` (`leaseOf`). Two existing tests now call `observe` first: preview without a kept copy, and a throwing collaborator. New tests: M5 unknown id (both actions, no build/workspace/write); M5 released id; M7 release → late result → no entry; release → late compactions dropped; new run tracked again; load tracks again; a compaction before the first result still counts for a never-released id.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts`: adds `SessionEvictionListener` and `onEvicted(listener) → disposer`. `evictStale` calls `notifyEvicted(rec)` with `[tabId, realSessionId?]`. A throwing listener is WARNed and does not stop the sweep or the other listeners.
- MODIFIED `…/session-lifecycle/session-registry.service.spec.ts`: three tests. They cover the keys passed for evicted records only, a disposed listener not being called, and a throwing listener being isolated.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts`:
  - Adds the optional `@inject(SDK_TOKENS.SDK_SESSION_BUDGET)` `sessionBudget: Pick<SessionBudgetService,'release'> | null`, as the last constructor parameter.
  - New `releaseBudget(childSessionId)`: releases the tab id and the SDK id once bound. A failure is logged and never blocks the end.
  - When it is called on each true end:
    - `stop()`: after the awaited interrupt.
    - `onGraceExpired`: the session already ended outside the spawner.
    - `interruptInBackground` (runtime cap, dispose): in `.finally` after the interrupt settles, so a result emitted meanwhile cannot bring the entry back.
  - A session end still inside the grace period releases nothing.
- MODIFIED `…/session-spawner.service.spec.ts`: the harness passes `sessionBudget`. Four tests:
  - stop releases the tab and SDK ids only after the interrupt;
  - an already-ended stop releases nothing;
  - grace expiry releases;
  - runtime cap releases only once the background interrupt settles.
  - One assertion is also added to the existing grace-expiry test.

Outside the file list (plan deviation, see below):

- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`: adds `onSessionEvicted(listener)`, which passes through to `_registry.onEvicted` (the registry is a private plain class), plus the type import.
- MODIFIED `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`: the constructor subscribes `sessionLifecycle.onSessionEvicted((keys) => this.releaseBudget(keys))`. The disposer is stored in `stopEvictionRelease` and called in `dispose()` before `sessionBudget.clearAll()`.
- MODIFIED `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts`: the mock lifecycle gets `onSessionEvicted`. One test checks that each evicted key reaches `sessionBudget.release` and that `dispose` unsubscribes.

## Checks (exit codes)

- `npx nx run-many -t typecheck,lint -p agent-sdk cli-agent-runtime --parallel=2` → **0**
- `npx nx run-many -t test -p agent-sdk cli-agent-runtime --parallel=1 -- --maxWorkers=2` → **1**
  - cli-agent-runtime: pass. The changed spec was also run directly: 69/69.
  - agent-sdk: 3079 passed, 3 skipped, 1 suite failed to compile. The failing suite is `session-query-executor.service.spec.ts:991`: TS2554 `new StreamTransformer(...)` is missing `planLimits` (`stream-transformer.ts:375`).
  - Neither file is modified in this worktree (`git diff --stat HEAD` is empty for both), so this failure is **pre-existing on 55f245619 and unrelated to Batch 16**. Every Batch 16 spec passes. A direct run of the session-budget, session-registry and sdk-agent-adapter specs gave 231/231 after the final fix.
- `npx nx run di-lint:lint --skip-nx-cache` → **0**
- `npx nx run degradation-audit:lint --skip-nx-cache` → **0**
- No PNGs changed (`git status -- '*.png'` is empty).

## Plan deviations

- 16.3 says the eviction release goes "through the existing release seam (`sdk-agent-adapter.ts:876-880` helper)". The registry is a private plain class inside `SessionLifecycleManager`, so reaching that seam needed a pass-through on the lifecycle manager and a subscription in the adapter. The adapter is also where the risk table expects Batch 16 to touch release paths.
  - Subscribing inside `SessionBudgetService` was rejected: a constructor side effect would break `rpc-handlers/…/chat-session-budget.spec.ts`, which builds the service with a two-method session-control fake.
  - None of the three extra files is in Batch 17's or 18's file list.
  - Batch 22 (adapter) and Batch 27 (`session-lifecycle-manager.ts` docs) come later and should rebase onto this.
- 16.2: the "a new run registers it" signal is the stats owner's existence (`leaseOf`). The adapter releases the stats owner and the budget together on every end path, and a new run prepares its owner before the query starts. Explicitly loading a session (`observeLoaded`) also re-tracks the id.

## Open notes

- Residual (accepted, fail-open): if a new run's first result arrives while its stats owner is still keyed by the provisional tab id, that one figure is dropped for a released id. The next result is accepted. In practice the init rebind happens before any result.
- `rpc-handlers/…/chat-session-budget.spec.ts` builds the real service with a stats fake that has only `snapshot`. That fake is reached only for a released id, which the spec never creates. It still passes with no change: `npx jest -c libs/backend/rpc-handlers/jest.config.ts --maxWorkers=2 …/chat-session-budget.spec.ts` → exit 0, 15/15.
- The pre-existing `session-query-executor.service.spec.ts` compile error needs an owner. It is not in any Stage F/G batch file list I read.
