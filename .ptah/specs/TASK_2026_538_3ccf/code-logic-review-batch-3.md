# Code Logic Review — `TASK_2026_538_3ccf`

Verdict: APPROVED

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Minor issues | 2 |
| Failure modes found | 0 new admission failures |

Scope: Batch 3's eight named files, read in full, plus the registry, message factory, error precedents, activity registry and relevant memory/skill listener paths. Paths below are workspace-relative. “Pump” means `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.ts`; “spec” means its adjacent `.spec.ts`.

The four-condition post-await guard and synchronous enqueue implement the requested admission invariant (pump:234, :244, :247, :268, :279). The score is in the sound band because the required race tests exercise actual deferred execution and assert the retained queues (spec:278, :316, :355). It is below 9 because factory rejection and registry-side-effect assertions remain unpinned, and baseline equivalence was not independently diffed. Neither gap demonstrates a production admission failure.

Verification:
- Ran the single permitted Jest file: **1 suite, 16 tests passed**. Node emitted an ES-module configuration warning; it did not prevent the tests from running.
- Scoped `ptah_get_diagnostics` to the pump and shared provider types: TypeScript compiler reported 0 errors and 0 warnings.
- Executor/leader verification is recorded at `batches.md:376` (both changed projects passed typecheck, lint and tests). This is reported evidence, not a second test run by this reviewer.
- No existing style review was present in the task folder. Read root `CONVENTIONS.md`; `ptah_search_files` found no AGENTS.md, and native checks found no applicable CLAUDE.md.
- No git command was run: the higher-priority reviewer contract prohibits git operations. Consequently, exact baseline statement-order equivalence is **not independently verified**.
- No `Write` tool is exposed. Used native PowerShell file writing for this deliverable only. The higher-priority output contract requires `code-logic-review.md`, so the requested `code-logic-review-batch-3.md` was not created.

## Numbered findings

### 1. MINOR — The fail-fast justification claims a false equivalence

- File: `.ptah/specs/TASK_2026_538_3ccf/batch-3-report.md:157`; pump:222; `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:480`.
- Scenario: a turn is busy at entry, but its result clears `turnInFlight` before a hypothetical message-factory await would finish. The pre-check refuses immediately; a post-check-only implementation would accept.
- Impact: the report obscures the actual admission policy and can lead to an incorrect future regression test. The stricter policy is safe and consistent with rejecting a submit made while busy (`task-description.md:388`).
- Fix: describe this as deliberate fail-fast rejection at entry plus mandatory revalidation at enqueue, not an observationally equivalent optimization. Add a policy test if this distinction must remain stable.

### 2. MINOR — Factory rejection is not pinned by the new specs

- File: spec:172, :180, :221; pump:234, :247.
- Scenario: `createUserMessage` throws synchronously or its returned promise rejects after the initial check.
- Impact: current code correctly propagates the failure and never pushes, but the deferred helper only resolves, so the suite would not guard against a future catch that converts the failure into a typed refusal or success.
- Fix: add a rejecting-factory case asserting the original error identity, no queued message, no wake callback, and unchanged registry activity on the require-idle path. Keep the later submit-service test asserting generic errors become `indeterminate` (`implementation-plan.md:705`).

## Explicit answers to points 1–4

### 1. Additional pre-await check

Sound as a stricter fail-fast policy; **not equivalent** to checking only after the await. A busy-to-idle transition can make the pre-check refuse what a post-only implementation would accept. Conversely, an initially idle record can be removed, displaced, aborted or become busy while the factory is pending; the pre-check passes and the post-check refuses (pump:222, :234, :244). The tests reproduce those latter transitions (spec:278, :295, :316, :334, :355).

An already-aborted record cannot become un-aborted. Re-registering under the same id produces a different object, so identity comparison still refuses the originally captured record (`session-registry.service.ts:194`, :209; pump:268). There is no path where adding the pre-check permits an enqueue that the final guard refuses. If a busy record would have ended during the hypothetical await, the earlier check also reports `busy` rather than the later `session-ended`; both outcomes remain truthful at their observation point.

### 2. markActive placement and the default path

For require-idle, `markActive` occurs only after successful final admission (pump:244–247). It contains synchronous field assignments and a clock read; it has no await, event emission or production callback into session control (`session-registry.service.ts:169`, :430). Therefore it does not open an interleaving window before the queue push.

A typed refusal does not change this pump's queue, wake callback, last-activity timestamp or last-active pointer. This does **not** mean no observable activity anywhere: the adapter notification and logging are separate effects.

Current default execution order is: find → missing-record generic SdkError → markActive → sending log → await factory → push → wake/reset → queued/held log (pump:209, :217, :224, :227, :234, :247, :248, :253). The require-idle branch is skipped at both admission sites. The default missing-session and held-message tests pass (spec:250, :372). Exact comparison with the prior revision remains unverified because git operations were prohibited; the executor's statement that the order is unchanged is not substituted for a diff.

### 3. R10 / notifyActivity

**Acceptable for this batch's explicit policy, with a more precise effect statement than the executor report.** The notification remains first (`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1074`), before forwarding admission at :1083. A rejected click is still user activity; this notification is not a successful-turn signal. Listener failures are isolated (`helpers/session-activity-registry.ts:27`; adapter:1237).

The listeners update their foreground activity timestamp and arm/reset idle timers (`libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:283`, :299; `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts:241`, :256). These handlers do **not** reset the turn-complete debounce timer. They can also create a listener state entry when one is absent (memory:288; skill:246), so “at most a deferred run” is too narrow: a refused call with no current record can still arm an idle timer using the adapter's fallback id and empty workspace (adapter:1217). Skill idle expiry attempts analysis enqueue (skill:734, :745); empty memory episodes are skipped (memory:699).

This is an existing notification policy explicitly retained by `batches.md:114`, :435, not an admission bypass or evidence that the rejected content reached the transcript. Treat “no side effect” in Component 17 as no message/turn admission and no pump registry activation, with this documented activity exception. A future policy change could move notification only on the opt-in path without changing default callers; it is not necessary to implement this batch.

### 4. Factory failure and indeterminate

**Yes, a spec should pin it** (finding 2). The factory await precedes both the final check and push, and there is no catch, so rejection propagates unchanged with no message admitted (pump:234–247). The factory may await attachment processing (`libs/backend/agent-sdk/src/lib/helpers/sdk-message-factory.ts:128`). No factory timeout/cancellation wrapper is added: an unresolved factory keeps this call pending, and abort is noticed when it resolves.

The pump should not label an arbitrary construction/dependency failure `busy` or `session-ended`. A later service conservatively maps any non-admission error to `indeterminate` (`implementation-plan.md:705`), because the same public send can also throw after queue insertion, for example from subsequent logging (pump:247, :253). This batch need not implement that classifier or automatically retry.

## Five logic questions

### 1. How does this fail silently?

No new success-looking refusal was found: both refusal branches throw before the push (pump:274, :283 versus :247). Default mid-turn holding is intentional and verified (spec:372). A resolved send proves queue admission, not eventual SDK completion; the iterator claims the turn later (pump:82–92). Lifecycle failure after admission remains outside this guard's promise.

### 2. What user action produces unexpected behaviour?

Submitting just before a busy turn ends still returns busy because of the pre-check (pump:222); this is the policy distinction in finding 1. Repeated submissions can reset background idle scheduling even when refused (adapter:1074; memory-trigger:299; skill-trigger:256), as accepted under R10.

### 3. What input data produces a wrong answer?

No new data-dependent wrong answer found within the typed internal API. Identity and abort checks take precedence over busy when both apply (pump:268, :279), so an aborted busy record correctly reports session-ended. Unknown admission strings supplied outside TypeScript would follow the default path because the check is exact equality (pump:208); this is an internal typed option (`libs/shared/src/lib/types/ai-provider.types.ts:109`), not a newly exposed unvalidated renderer boundary.

### 4. What happens when a dependency fails?

Factory errors propagate before enqueue; a never-settling factory leaves the promise pending (pump:234). Activity subscribers have isolated error handling (`session-activity-registry.ts:27`). No new dependency, timer, subscription or disposal obligation was introduced by the admission check itself (pump:208–285).

### 5. What is missing that the requirements never mentioned?

Explicit policy wording for busy-at-entry becoming idle during construction, failure-path regression coverage, and the distinction between no queue mutation and the accepted activity-notification effect (findings 1–2; adapter:1074). The pump does not add operation-id deduplication; that belongs to the later host layer (`task-description.md:237`).

## Failure modes

No new production admission failure supported by the inspected code. Reviewed entry forwarding, missing/aborted/replaced records, queued and in-flight competitors, message-factory failure, and iterator wakeup. Residual uncertainty: no baseline diff, no full RPC/SDK integration execution, and no rejecting-factory regression spec. Those limitations do not negate the synchronous guard observed at pump:244–247.

## Blocking issues

None found in Batch 3.

## Serious issues

None found in Batch 3.

## Moderate and minor issues

No moderate issue. Two minor findings above; neither requires a production change before accepting the batch.

## Data flow

1. **OK:** Shared option is optional and readonly (`ai-provider.types.ts:109`).
2. **OK, accepted activity exception:** adapter notifies listeners, then forwards origin and admission (adapter:1074, :1083).
3. **OK:** lifecycle facade forwards options unchanged (`session-lifecycle-manager.ts:531`, :546).
4. **OK:** pump captures the record; missing opt-in records throw the typed error; present records get a fail-fast check (pump:209–222).
5. **OK; coverage gap:** factory is awaited; its errors propagate (pump:234).
6. **OK:** identity, abort, turn and queue are re-read synchronously; markActive is synchronous; queue insertion follows with no await (pump:244–247, :268, :279; registry:430).
7. **OK:** push precedes waking the iterator; iterator claims the turn before yield (pump:247–250, :82–92).
8. **OK:** typed refusal extends SdkError with readonly reason (`errors/session-admission-refused.error.ts:16`, :18) and is exported through both barrels (`errors/index.ts:6`; `libs/backend/agent-sdk/src/index.ts:96`), satisfying R6.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Optional shared admission and forwarding | COMPLETE | Types:109; adapter:1083; manager:546 |
| Typed missing/ended/busy refusal | COMPLETE | Pump:212, :274, :283; error:16 |
| Atomic post-await four-condition guard | COMPLETE | Pump:244–247, :268, :279 |
| R6 public package export | COMPLETE | Package entry:96 |
| Three real deferred race tests | COMPLETE | Spec:172, :278, :316, :355; each asserts no submit in the queue |
| Default behavior preserved | PARTIAL verification | Missing/default-held tests pass; no independent git baseline comparison |
| R10 disposition | COMPLETE | Explicitly retained and assessed above |
| No any / ts-ignore / TODO / STUB in batch files | COMPLETE | Search found only English “any” in comments, no such type/suppression/placeholder |

Implicit requirements not fully pinned: factory error identity and unchanged activation/wakeup state on refusal (spec:172; pump:234–250).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Live idle record | YES | Admitted and yielded, spec:222 | Acceptance is enqueue, not completion |
| Missing record | YES | Typed opt-in / generic default, spec:235, :250 | None found |
| Busy turn at entry | YES | Fail-fast, spec:261 | Document stricter timing policy |
| Removed during await | YES | Captured record queue remains empty, spec:278 | None found |
| Replaced during await | YES | Both old/new queues remain empty, spec:295 | None found |
| Competing queued message | YES | Only competitor retained, spec:316 | None found |
| Competitor already drained | YES | turnInFlight still refuses, spec:334 | None found |
| Abort during await | YES | Typed refusal, empty queue, spec:355 | Does not cancel factory work |
| Concurrent require-idle calls | YES by inspection | Second final guard sees queue or turn, pump:279 | No direct two-opt-in test |
| Factory rejects | YES by inspection | Await exits before push, pump:234 | Missing spec |
| Factory never settles | NO timeout here | Send remains pending, pump:234 | Caller outcome policy belongs to later batch |
| Empty/large content | No new constraint | Factory receives content unchanged, pump:235 | Host validation/budgets are later scope |

## Verdict

- Recommendation: APPROVE
- Confidence: MEDIUM
- Top risk: future changes around the factory await could blur typed refusal versus indeterminate dispatch unless the rejection path is tested.
- What a robust implementation would add: a factory-rejection regression case, refusal assertions for wake/activity state, precise fail-fast documentation, and a baseline diff check by the accepting leader.

