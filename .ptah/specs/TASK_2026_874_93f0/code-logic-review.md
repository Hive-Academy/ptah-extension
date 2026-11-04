# Code Logic Review — TASK_2026_874_93f0

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 1 |
| Moderate issues | 3 |
| Failure modes found | 4 |

Scope: diff of cli-detection.service.ts, welcome-vitals.store.ts, skills-sh-rpc.handlers.ts (specs not run). Read: whole CliDetectionService, agent-rpc.handlers.ts 1215-1275, PlanLimitsStore load(), injectVitalsTick, HostInventoryCache, the two other skillsSh:listInstalled callers, RpcHandler catch.

## Five logic questions

1. Silent failure: an `agent:detectClis` refresh after a config change returns pre-change install state with no signal (S1). The old-generation scan never caches, so a joiner sees data that is then thrown away.
2. Unexpected user action: Cursor API key saved/removed (agent:setConfig -> invalidateCache, agent-rpc.handlers.ts:1229/1248) while a scan is running, then the user presses Refresh/redetect (agent:detectClis, :1258-1259). Refresh joins the stale scan and shows stale state.
3. Wrong-answer input: any adapter whose `detect()` result depends on state changed just before invalidate (credentials, PATH). The in-flight scan may have read the old state.
4. Dependency failure: skillsSh:listInstalled now throws; RpcHandler catch (vscode-core rpc-handler.ts:226+) turns it into `success:false`. All three callers handle it (see below). Plan limits RPC failure: loadError keeps the snapshot; ring errors only for generatedAt 0. OK.
5. Missing: no test or guard that a joiner must not receive a superseded scan; no cap on the welcome retry when discovery stays incomplete forever.

## Failure modes

### Stale join after invalidate (Serious)

- Trigger: scan in flight (e.g. startup plan-limit discovery, detectAll from plan-limit-owner-discovery.service.ts:247), then `invalidateCache()` (setConfig or detectClis), then `detectAll()`.
- Symptom: `detectAll` sees `detectionCache === null` and `detectionInFlight !== null` (cli-detection.service.ts:149-157) and returns the OLD scan. Previously invalidate nulled `detectionInFlight` (removed line), so a fresh scan started. `agent:detectClis` (agent-rpc.handlers.ts:1258-1259) calls invalidate precisely to force a fresh scan, so it now can return pre-change results; agent:setConfig followed by detectClis shows the old installed/auth state until a further refresh.
- Also: the old scan, being stale, does not cache, so the next caller after it settles starts yet another scan (extra cost, not wrong).
- Recommendation: store the generation with the in-flight promise and join only when it equals the current generation; otherwise start a new scan, make it the in-flight one, and let the old one finish uncached. The old finally already guards `detectionInFlight === inFlight`, so that part is safe.

### listModelsForAll writes a stale modelCache (Moderate, partly pre-existing)

- cli-detection.service.ts:255-280. `modelCache = cache` is written after awaits with no generation check. Invalidation during the model loop is overwritten by a cache built from the old detection. The new generation counter does not cover it. Capture generation at entry and skip the write when it changed.

### Welcome retry resets the store's bounded counter (Moderate)

- welcome-vitals.store.ts:120-132 calls `planLimits.load()` with the default `incompleteRetry=false`, which resets `incompleteRetryCount` and clears the store timer (plan-limits.store.ts:176-178). No double load occurs: the effect checks `!loading()`, and load() clears a pending timer. But if discovery stays incomplete, the effect reloads every 30 s tick (PLAN_LIMITS_CLOCK_TICK_MS) indefinitely with up to 3 follow-ups each, so the "bounded 3 retries" guarantee becomes a perpetual 4 RPC per 30 s while the welcome screen is open. Tolerable (bounded by the shared clock) but should be a stated decision, or cap it.
- The effect also fires at construction (before the first load settles). `injectVitalsTick` may already have started one; `loading()` is set synchronously in load(), so it is skipped. OK.

### Error placeholder detection by magic value (Minor/Moderate)

- welcome-vitals.store.ts:108 treats `generatedAt === 0` as the failure placeholder. Fine if applyLoadFailure() is the only producer of 0; a host that returned a valid snapshot with generatedAt 0 would be shown as error only when loadError is also true, so low risk. Rely on a spec that pins applyLoadFailure's placeholder.

## Serious issues

### S1 Stale join (above)

- File: libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts:149-166, 292-296
- Impact: refresh/redetect after config change can return outdated install state.
- Fix: per-generation in-flight (see above); add a spec: invalidate during scan, then detectAll must run a second adapter detect().

## Moderate and minor issues

- cli-detection.service.ts:246-280 modelCache stale write (above).
- welcome-vitals.store.ts:120-132 unbounded 30 s retry (above).
- cli-detection.service.ts:211-215: after an older scan finishes uncached, callers that joined it also receive its stale data; document that detectAll results may be pre-invalidation.
- Minor: `refreshCliTokens` nulls modelCache without bumping generation (:319); same stale-write window.

## Data flow (skillsSh:listInstalled)

1. Handler throws (skills-sh-rpc.handlers.ts:323-326) after logging: OK.
2. RpcHandler catch returns `success:false` with a generic message (rpc-handler.ts:226+): OK.
3. HostInventoryCache: settleVitalsRpc maps failure to error and VitalsLoadCache retries after 5 s on re-read (vitals-load.ts:28); welcome tick re-read: OK, no hot loop.
4. SkillShBrowserComponent.loadInstalled (skill-sh-browser.component.ts:638-650): non-success ignored, try/catch: OK, badges keep last list.
5. MarketplaceInventoryStore.readCommunity (marketplace-inventory.store.ts:737-743): returns `{ok:false,error}` with fallback: OK; the community slice now shows an error rather than a false empty list, which is the intended behaviour.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Generation counter; invalidate keeps in-flight | COMPLETE | stale join (S1) |
| Old-generation scan does not write cache | COMPLETE | modelCache not covered |
| Plan retry on shared clock while error/incomplete | COMPLETE | unbounded across ticks |
| Plan ring error only for generatedAt 0 | COMPLETE | magic value |
| listInstalled rethrows | COMPLETE | callers verified |

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Invalidate during scan, then detectAll | NO | joins old scan | S1 |
| Two invalidates then scan finishes | YES | generation mismatch, no cache | extra scan next call |
| Concurrent detectAll | YES | shared in-flight | |
| Scan throws | YES | finally clears only if same promise | |
| Plan load fails with prior snapshot | YES | snapshot kept, retried | |
| skills RPC fails | YES | all callers handle | |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: a detectClis refresh right after a config change joins a superseded scan and returns pre-change state.
- What a robust implementation would add: generation-tagged in-flight promise, generation guard on modelCache, a spec for invalidate-then-detect, and an explicit cap or documented decision for the welcome plan-limit retry.

## Re-review

Scope: fix round for S1 (stale join) and the modelCache Moderate only. Read the diff of cli-detection.service.ts and the agent:detectClis change in agent-rpc.handlers.ts; specs not run.

- S1 resolved. `currentInFlight()` (cli-detection.service.ts) returns the in-flight promise only when `inFlightGeneration === generation`, so after `invalidateCache()` a new `detectAll()` starts a fresh scan. `inFlightGeneration` is set synchronously after `doDetectAll()` begins (no await between, so no generation change can slip in). The old scan's `finally` only clears `detectionInFlight` when it is still its own promise, so it cannot null a newer scan; a superseded scan returns to its own joiners but does not write `detectionCache`.
- `refresh()` is correct: joins a current-generation scan, otherwise invalidates and rescans. setConfig's invalidate bumps the generation, so the next `agent:detectClis` cannot join a pre-change scan. It also drops `modelCache` via `invalidateCache()` on the rescan path.
- modelCache resolved: generation captured before `detectAll()`, write skipped if it changed (listModelsForAll). Callers of the stale call still get a result, uncached; acceptable.
- Residual (Minor, no action): `refresh()` joins a current-generation scan that started moments earlier, so a CLI installed on disk in that exact window (no invalidate) shows on the next refresh. `refreshCliTokens` still nulls `modelCache` without bumping the generation (cli-detection.service.ts, near the end), leaving a small stale-write window for `listModelsForAll`; pre-existing and low impact.
- Retry-bound Moderate deferred by the coordinator: acknowledged, no data loss.

Verdict: APPROVED

## Re-review 2

Scope: the two PR #922 fixes only (diff read; specs not run).

1. Welcome retry throttle (welcome-vitals.store.ts). Correct. `lastPlanRetryAt` starts at -Infinity so the first failed/incomplete state reloads at once; later runs need `now - lastPlanRetryAt >= PLAN_LIMITS_CLOCK_TICK_MS`, so the `now` moves caused by the retry's own load (and by loads from other surfaces) no longer trigger a reload and no longer cancel the store's 1 s incomplete timer (load() clears that timer). `loading()` guard still prevents overlap.
   - Minor (no action): cadence is 30-60 s, not exactly 30 s. If the recorded value came from a load-completion `now` (later than the last clock tick), the next clock tick is under 30 s after it and is skipped; the one after passes. No permanent starvation, since the clock keeps ticking while the store has a clock running (load() starts it).
   - The deferred counter-reset behaviour (load() with incompleteRetry=false) is unchanged and now rate-limited to the above cadence.
2. Stuck-scan join age (cli-detection.service.ts). Correct. A current-generation scan older than 15 s is not joined by `refresh()`; it calls `invalidateCache()` (generation++) then `detectAll()`, which sees `currentInFlight()` null, starts a new scan and overwrites `detectionInFlight`, `inFlightGeneration` and `inFlightStartedAt`. The old stuck scan's `finally` only clears the slot when `detectionInFlight === inFlight`, so it cannot clear the new slot; if it later finishes, the generation mismatch stops it caching. `inFlightStartedAt` is set at scan start together with the generation, so it always describes the current slot.
   - Minor (no action): plain `detectAll()` still joins a stuck current-generation scan (pre-existing; only refresh got the age cap). Date.now is wall-clock: a system clock jump backward makes the age negative (joins), forward makes it large (starts a new scan); both harmless. A spec spying Date.now must restore it (mockRestore) so other specs are not affected.

Verdict: APPROVED
