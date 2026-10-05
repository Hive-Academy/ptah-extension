# Batch 30, Task 30.2 — Curator PreCompact coalescing (TASK_2026_597, S4 wave A)

Task 30.1 not done (WAITS-FOR-#639).

## What changed

- MODIFIED `libs/backend/memory-curator/src/lib/memory-curator.service.ts`
  - New exported constant `CURATOR_PRECOMPACT_MIN_INTERVAL_MS = 900_000`. The barrel `src/index.ts` uses named exports, so the constant is not added to the public API.
  - New private map `preCompactWatermarks: Map<sessionId, { lastFiredAt }>`.
  - In the PreCompact reactor (`start()`), the new `coalescePreCompact(sessionId, trigger)` check runs after the internal-query guard. A PreCompact that arrives within the interval of the last one that fired for the same session is skipped and logged at info, with `sessionId`, `trigger`, `sinceLastMs` and `minIntervalMs`. Otherwise the check stamps `lastFiredAt` and the pass runs as before. The reactor is never unregistered. A blank session id is never throttled, matching `coalesceKey`.
  - New public `forgetSession(sessionId)` deletes the entry.
  - `rekeySession(from, to)` also moves the watermark. It uses the same refuse-overwrite rule as the `inFlight` keys.
- MODIFIED `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts`: `flushSessionEnd` calls `this.curator.forgetSession(sessionId)`. Both session-end paths (SDK hook and in-process registry) reach it, and it runs even when session-end curation is disabled.
- MODIFIED `memory-curator.service.spec.ts`: new describe `PreCompact coalescing (TASK_2026_597 A7)` with 6 tests:
  - two PreCompacts within the interval fire once, the skip is logged, `register` was called once and the disposer was never called;
  - after the interval, it fires again;
  - the interval is measured from the last fired PreCompact, not the last skipped one;
  - each session has its own watermark;
  - `forgetSession` resets the watermark;
  - `rekeySession` carries the watermark.
- MODIFIED trigger specs (`memory-trigger.service.spec.ts`, `.boot-defer.spec.ts`, `.boot-scan-budget.spec.ts`, `.coalesce.spec.ts`, `.integration.spec.ts`): added `forgetSession: jest.fn()` to the curator mocks. Added one test in `memory-trigger.service.spec.ts`: session end calls `forgetSession('s1')` even with `sessionEnd.enabled=false`.

## Checks (run in the worktree)

- `npx nx run-many -t typecheck,lint -p @ptah-extension/memory-curator`: 2/2 passed.
- `npx nx run-many -t test -p @ptah-extension/memory-curator --maxWorkers=2`: passed. 47/47 suites, 864/864 tests. The new tests were confirmed to run with a `-t` filter.
- `npx nx run-many -t typecheck -p ptah-extension-vscode ptah-electron @ptah-extension/cli-engine @ptah-extension/rpc-handlers @ptah-extension/skill-synthesis @ptah-extension/thoth-runtime`: 6/6 passed.
- `npx nx run di-lint:lint`: passed.
- `npx nx run degradation-audit:lint`: FAILED, but not because of this task. The only directory over baseline is `libs/backend/cli-agent-runtime: 1 FAIL (baseline 0)`, at `cli-adapters/codex/codex-rollout-usage.reader.ts:167`. That file is untracked and new, from Batch 32. `libs/backend/memory-curator: 20 ok (baseline 20)`.

## Deviations from the plan

- The batch lists only `memory-curator.service.ts` (+ spec) as files. The quality requirement "entry deleted on session end" needs a session-end signal, and the curator service has none: session end is handled by `MemoryTriggerService` in the same library, which already calls `curator.rekeySession`. I added a one-line `curator.forgetSession(...)` call in `flushSessionEnd`, plus the mock and one test in the trigger specs. These are all in `@ptah-extension/memory-curator`, so there is no overlap with Batches 24 and 32.
- I added watermark migration in `rekeySession`, which the plan does not mention. Without it, a session rekeyed from tabId to UUID would lose its throttle, and the UUID entry would never be freed if session end arrives under the other id.

## Out-of-scope observations

- The degradation-audit failure above belongs to the Batch 32 owner.
