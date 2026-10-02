# Code Review: Batch 13 — Lifecycle Reachability Integration Spec

**Reviewer:** Antigravity CLI Lane (Cross-Side Review)  
**Task:** TASK_2026_578_3b00  
**Branch:** `feat/task-578-skill-lifecycle`  
**Commit Reviewed:** `eb7693b19` (`test(skill-synthesis): batch 13 - add lifecycle reachability integration spec through production entry points`)  
**Key File:** [`libs/backend/skill-synthesis/src/lib/skill-lifecycle.reachability.integration.spec.ts`](../../../libs/backend/skill-synthesis/src/lib/skill-lifecycle.reachability.integration.spec.ts)

---

## 1. Analysis & Verification

### Production Entry Reachability & Failure Seams
Each proof enters through a genuine production interface and tests a distinct lifecycle seam:

1. **Proof 1 — Startup Reconcile:**
   - *Production Entry Call:* [`synthesis.start()`](../../../libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts#L426)
   - *Behavior Reached:* Reaches [`SkillCuratorService.start`](../../../libs/backend/skill-synthesis/src/lib/skill-curator.service.ts#L224), which triggers `this.startReconciliation(settings)` to find accepted suggestions lacking a promoted candidate row and link them to newly registered promoted rows matching their on-disk materialized slug.
   - *Failure Seam:* If `startReconciliation` is removed from `curator.start()`, `ids.acceptedSuggestion` remains unlinked (`promotedCandidateId == null`), causing the `settle()` loop to time out and assertions on `store.findByName` and `registry.getBySlug` to fail.

2. **Proof 2 — Recurring Curator Interval (Umbrella, Purge, Retirement):**
   - *Production Entry Call:* Fake-timer advancement [`jest.advanceTimersByTime(HOUR_MS)`](../../../libs/backend/skill-synthesis/src/lib/skill-lifecycle.reachability.integration.spec.ts#L499) triggering the `setInterval` handle scheduled in `curator.start()`.
   - *Behavior Reached:* Executes [`SkillCuratorService.runPass`](../../../libs/backend/skill-synthesis/src/lib/skill-curator.service.ts#L267), running `runRetirementStep()`, `runUmbrellaStep()`, and `runPurge()`.
   - *Failure Seam:* Fails if the interval schedule is omitted in `curator.start`. If `runUmbrellaStep` is removed, no umbrella suggestion is produced and clustered candidates are not rejected with `merged-into:<id>`. If `runPurge` is removed, the 40-day orphan candidate remains active and no purge state marker is persisted. If `runRetirementStep` is removed, the 45-day idle skill is not marked dormant, and the 100-day idle skill is neither marked retired nor deleted from disk and the registry.

3. **Proof 3 — Accept Suggestion at Collision Slug & Invocation Telemetry (Acceptance 2 & 4):**
   - *Production Entry Call:* [`curator.acceptSuggestion(umbrellaId, settings, { userInitiated: true })`](../../../libs/backend/skill-synthesis/src/lib/skill-curator.service.ts#L564) (the direct service entry point invoked by the `skillSynthesis:acceptSuggestion` RPC handler).
   - *Behavior Reached:* Exercises `SkillPromotionService.promoteSuggestion` -> `commitResidentPromotion`, detecting the pre-existing directory collision to name and materialize the skill as `<slug>-2`. Updates `store.getStats()` counters (`promoted` and `active`), and verifies via [`recorder.recordSkillEvent`](../../../libs/backend/skill-synthesis/src/lib/skill-invocation-recorder.ts) that invocation events are strictly attributed to `<slug>-2` and ignored for `<slug>`.
   - *Failure Seam:* Fails if `acceptSuggestion` is skipped or if collision resolution improperly assigns the un-suffixed base slug to the candidate row.

4. **Proof 4 — Weekly Drain Judge-Panel Gate:**
   - *Production Entry Call:* [`drain.drain({ tier: 'weekly', signal: liveSignal(), onBattery: false })`](../../../libs/backend/skill-synthesis/src/lib/queue/skill-drain.service.ts)
   - *Behavior Reached:* Executes the `judge-panel` stage handler registered during `synthesis.start()`. The evaluator evaluates the rubric score (3.0 < 6.0 threshold) and applies `rejectIfStatus(candidate.id, 'candidate', 'rejected', 'below-judge-score')`.
   - *Failure Seam:* Fails if `drain.drain` is not executed, or if `applyJudgePanelGate` records judge scores without updating candidate status.

---

### Test Isolation & Teardown
- **Filesystem Isolation:** `node:os` is mocked to redirect `homedir()` to a dedicated path inside `os.tmpdir()` (`ptah-lifecycle-reachability-home`), preventing any curator report writes to the real user home directory.
- **Timer Isolation:** `jest.useFakeTimers` explicitly configures `doNotFake` for `Date`, `setTimeout`, `setImmediate`, `nextTick`, etc., selectively isolating only `setInterval` and `clearInterval`. In `afterAll`, `synthesis?.stop()` invokes `curator.stop()` which clears the interval handle before `jest.useRealTimers()` restores real timers.
- **Cleanup:** `afterAll` thoroughly removes both the test's `tempRoot` and the mocked homedir directory in a `finally` block, closing the SQLite connection and resetting the DI container.

---

### Acceptance Criteria Coverage (2, 4, 5)
- **Acceptance 2 (Accept increases Promoted & Active in UI):** Verified in Proof 3 (lines 562–580), where accepting the umbrella suggestion increments both `store.getStats().promoted` and `store.getStats().active` by 1.
- **Acceptance 4 (Invocation events join on materialized slug with collision):** Verified in Proof 3 (lines 582–605), checking that a materialized skill with collision suffix `-2` reflects invocations logged under `-2`, while invocations under the base slug are not attributed to the promoted candidate.
- **Acceptance 5 (Reachability proof for every new pass):** All four passes (startup reconcile, hourly curation, suggestion accept, weekly judge drain) have verified reachability proofs through production entries.

---

### Spec Conventions Comparison
The spec faithfully mirrors [`skill-synthesis.reachability.integration.spec.ts`](../../../libs/backend/skill-synthesis/src/lib/skill-synthesis.reachability.integration.spec.ts):
- Gated execution via `describeWithDatabase` using `resolveReachabilityDatabaseFactory()`.
- Production DI bootstrapping via `registerSkillSynthesisServices(child, logger)` with isolated child containers.
- Query stubbing via `makeQueryStub` returning streaming async iterables.
- SQLite migration executed via production `SqliteConnectionService.openAndMigrate()`.

---

## 2. Findings

*(Note: In accordance with review guidelines, existing findings recorded in `code-logic-review.md` regarding proof order dependence, missing positive control for proof 4, brittle log string matching for report completion, unchecked `settle()` return values, `describe.skip` fallback, and execution runtime are omitted).*

- **MINOR:** [`skill-lifecycle.reachability.integration.spec.ts:612`](../../../libs/backend/skill-synthesis/src/lib/skill-lifecycle.reachability.integration.spec.ts#L612)  
  *Statement:* Proof 4 reassigns the suite-level closure variable `judgeCriterion = 3` without an `afterEach` or `afterAll` reset.  
  *Scenario:* If additional tests are appended to this suite or tests are executed in a modified sequence, subsequent evaluations will unexpectedly score 3 rather than the default 8.

- **MINOR:** [`skill-lifecycle.reachability.integration.spec.ts:84-85`](../../../libs/backend/skill-synthesis/src/lib/skill-lifecycle.reachability.integration.spec.ts#L84-L85)  
  *Statement:* The mock `homedir()` returns a static path in `os.tmpdir()` (`ptah-lifecycle-reachability-home`) that is cleaned up in `afterAll` but not initialized or cleaned before the suite runs in `beforeAll`.  
  *Scenario:* If a prior test execution aborts abruptly before `afterAll` completes, residual curator reports in `ptah-lifecycle-reachability-home` could affect initial state checks on subsequent runs.

- **MINOR:** [`skill-lifecycle.reachability.integration.spec.ts:273`](../../../libs/backend/skill-synthesis/src/lib/skill-lifecycle.reachability.integration.spec.ts#L273)  
  *Statement:* `seedCandidate` assigns a virtual `bodyPath` under `tempRoot/candidate-bodies` without writing corresponding files to disk, unlike `seedPromoted` and `seedAcceptedSuggestion`.  
  *Scenario:* If future extensions to the backlog purge or umbrella merge inspect candidate body files on disk, the test will encounter unexpected `ENOENT` filesystem errors.

---

## 3. Verdict

### **APPROVED**

The integration spec in commit `eb7693b19` provides high-confidence reachability proofs for the skill lifecycle subsystem through production DI and entry points. All four proofs satisfy their design requirements, timer and filesystem isolation are respected, and Acceptance Criteria 2, 4, and 5 are thoroughly verified.
