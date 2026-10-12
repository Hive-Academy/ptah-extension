# Code-logic review — curator rebind fix
Reviewer: antigravity gemini-3.1-pro (cross-family)

## Verdict: REVISE (4/10)

## Logic Questions

1. **How does this fail silently — where does a failure produce a success-looking result?**
   When `mem.liveness` runs, `MemoryTriggerService.invokeCurate()` uses the old `MemoryCuratorService` which holds the real adapter. The test can pass by making a real network call, silently violating the bench's isolation and replay constraints.
2. **What user action produces unexpected behaviour?**
   Running the bench host with the `mem.liveness` suite in record or replay mode.
3. **What input data makes this produce a wrong answer rather than an error?**
   In record mode, the liveness suite's model interactions will bypass the `RecordReplayDouble` entirely and fail to be recorded in the cassette, producing an incomplete test record.
4. **What happens when a dependency fails, times out, or returns a shape it should not?**
   If the network is disconnected (e.g., during replay mode where auth endpoints are seeded as unreachable), the liveness suite will fail with a real network timeout or error instead of using its locally mocked `ScriptedLivenessCurator` or failing closed correctly.
5. **What is missing that the requirements never mentioned?**
   The fix only rebinds `MEMORY_CURATOR`, missing that downstream singleton dependents (such as `MemoryTriggerService`) already captured the stale curator reference during engine boot.

## Defects

1. **Stale Singleton Bypass**
   - **Severity:** Blocking
   - **File:Line:** `tools/mcp-bench/src/memory-skills/host/doubles-override.ts:107-113`
   - **Problem:** The fix rebinds `MEMORY_TOKENS.MEMORY_CURATOR` but does not rebind its consumers. `MemoryTriggerService` is instantiated during engine boot and captures the pre-override curator. In `tools/mcp-bench/src/memory-skills/suites/memory/liveness-harness.ts:324`, the suite resolves `MemoryTriggerService` from the parent container, retrieving this stale singleton. When the suite calls `invokeCurate()`, it hits the real adapter—bypassing both the `RecordReplayDouble` and the suite's `ScriptedLivenessCurator`. This breaks the fail-closed guarantee.
   - **Fix:** Install the `RecordReplayDouble` earlier in the lifecycle, such as in `beforeEngineBoot`, so that no singletons ever capture the real adapter, or ensure all dependent singletons are also rebound.

2. **Undisposed Singleton Resource**
   - **Severity:** Minor
   - **File:Line:** `tools/mcp-bench/src/memory-skills/host/doubles-override.ts:107`
   - **Problem:** The old `MemoryCuratorService` is left undisposed in memory. While the `thoth: 'oneshot'` boot tier skips calling `startMemory()`—preventing compaction callback registration and DB contention—it still leaves an unreferenced instance holding resources.
   - **Fix:** Call `dispose()` or `stop()` on the old instance if it exists before rebounding.

3. **Shallow Test Verification**
   - **Severity:** Minor
   - **File:Line:** `tools/mcp-bench/src/memory-skills/host/doubles-override.spec.ts:125-143`
   - **Problem:** The new spec proves that resolving `MEMORY_CURATOR` directly yields the new instance, but it does not test whether downstream dependents like `MemoryTriggerService` resolve correctly or whether the real adapter remains unreachable. It passes despite the blocking defect above.
   - **Fix:** Add an assertion verifying that a downstream consumer (like `MemoryTriggerService`) resolved after `installRecordReplayDoubles` also uses the new double.

## Checked and OK

- **Direct Consumers:** Bench suites like `extraction.suite.ts`, `merge-update-ports.ts`, and `scope-write.suite.ts` correctly resolve `MEMORY_CURATOR` after `afterContainerReady` and successfully receive the new singleton with the installed double.
- **No Background Harm from Duplicate Singleton:** The old `MemoryCuratorService` instance is never `start()`ed because the bench uses the `oneshot` mode. Consequently, it does not register compaction callbacks, it does not create duplicate background queues, and it causes no SQLite contention.

## Orchestrator disposition (2026-10-08)

- **Defect 1 (blocking) — rejected, with evidence.** `MemoryTriggerService` is `@injectable()` (transient,
  `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:87`) and is registered only under the
  token `MEMORY_TOKENS.MEMORY_TRIGGER_SERVICE` (`libs/backend/memory-curator/src/lib/di/register.ts:172-176`).
  `liveness-harness.ts:324` resolves the CLASS from a child container, so tsyringe constructs a new transient
  instance in the child, injecting the child's `MEMORY_CURATOR` override (`liveness-harness.ts:318-323`, the
  scripted curator) — never the parent's stale singleton. The harness doc comment (`:300-304`) states this design.
- **Defect 2 (minor) — no change.** The old instance is never `start()`ed in the `thoth: 'oneshot'` bench (the
  reviewer confirms this under "Checked and OK"); disposing it adds no protection.
- **Defect 3 (minor) — no change.** The proposed downstream assertion targets the rejected defect 1.
- Result: the fix stands. Weaker evidence note: the reviewer's only blocking claim was disproved by the
  orchestrator, not by a second reviewer (Glm was at its limit).
