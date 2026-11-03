# Code Logic Review - Batch 7, round 2

Scope: round-1 findings re-checked against the current worktree diff (service, codex-runtime.ts, composition, registration.ts for typing). No checks were run.

| Metric | Value |
| --- | --- |
| Score | 7/10 |
| Verdict | REQUEST CHANGES (one small, likely compile error) |
| Blocking | 1 (static type, medium-high confidence) |
| Serious | 0 |
| Moderate | 2 |

## Round-1 findings

| Finding | Status | Evidence |
| --- | --- | --- |
| B1 released context poisoned forever | FIXED | `codex-runtime.ts` open(): `usage.onContextOpened` runs after `context.open` (before `observer.activate()`); composition wires it to `openRateLimitsContext` (codex-runtime-composition.ts, onContextOpened). `openRateLimitsContext` (service ~l.327) clears the released marker and drops pending reads of that context. An in-flight read from the old generation captured `context` before its await and `liveContexts` was cleared on release, so it returns null (`liveContexts.get() !== context`). Spec "accepts an update after release and reopen" added. Order is safe: the `contexts.has` guard means the old context's onClosed (dispose then release) runs synchronously before the next open. |
| S1 cold-cache first notification lost | FIXED | `performLiveRead`: `cached.fetchedAt >= update.observedAt` maps directly; only a refreshed result with `fetchedAt < observedAt` is rejected. |
| Refresh per notification | FIXED, with a new gap (M1) | 1 s per-home interval (`LIVE_REFRESH_MIN_INTERVAL_MS`). |
| Buffer survives respawn | FIXED | `spawnProcess` wrapper clears buffer; callback re-checks `active/disposed` after the microtask. |
| releasedLiveContexts unbounded | FIXED | cap 256, oldest evicted (`releaseRateLimitsContext`). Eviction can re-admit a very old id; harmless. |
| sharedUsage.client assigned before attach | FIXED | composition assigns after `attachCoreClient` returns. |
| Shared client scope lifetime (unverified) | RESOLVED | `di/registration.ts:86-102`: the client closes over plain host ports (`ports.spawner/executable/binary/clock`), not container-resolved objects, and has no `dispose()`, so first-scope `container.dispose()` does not break it. `closeSharedUsage` detaches then closes on binding dispose. |

## New defects

### B-R2-1 (blocking for CI, medium-high confidence): weak-type mismatch in registration
- `codex-runtime.ts` now declares `RuntimeOptions = CodexRuntimeOptions & { usage?: { onRateLimitsUpdated?, onContextClosed?, onContextOpened? } | null }`. `libs/backend/codex-runtime/src/lib/di/registration.ts:63` still does `new CodexRuntime(ports)` with `ports: CodexRuntimeRegistrationPorts`, whose `usage` is `{ auth; profileForHome } | null` (registration.ts l.20-24). The source `usage` shares no property with the all-optional target (weak type), so TS2559 is expected on that call. Composition passes the extra callbacks through a spread, which hides the excess-property error there but not this one.
- Fix: add the three optional callbacks to the `usage` member of `CodexRuntimeRegistrationPorts` (export one shared hooks type from codex-runtime.ts or the types file and use it in both places). `registration.ts` is not in the batch-7 file list, so add it.
- Without it the callback wiring is also untyped end to end.

## Moderate
- M1: Leading-edge throttle has no trailing refresh. A second notification within 1 s of the last read maps the cached data (fetchedAt about 1 s older than the notification) and is not retried, so the last notification of a burst can leave the ledger one notification behind until the next push or pull (`performLiveRead`, `lastReadAt` branch). Add a trailing timer or schedule one refresh after the interval.
- M2: `close()` does `await Promise.all(this.liveReads.values())`; a rejected live read (client.read abort) makes `close()` reject before `closeChild`. Use `allSettled`.

## Specs
- plan-limits-broadcaster.spec and provider-rpc.handlers.spec additions are consistent with unchanged production code (push of provider-neutral snapshot; repeated pull reuses cache with `refresh: false`). Not run.

## Verdict
REQUEST CHANGES only for B-R2-1 (small type plumbing). All round-1 logic findings are genuinely fixed.

## Final file list (batch 7)
- apps/ptah-electron/src/di/codex-runtime-composition.ts
- libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.ts (+ .spec.ts)
- libs/backend/codex-runtime/src/lib/codex-runtime.ts
- libs/backend/rpc-handlers/src/lib/handlers/plan-limits-broadcaster.spec.ts
- libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.spec.ts
- To add for B-R2-1: libs/backend/codex-runtime/src/lib/di/registration.ts
