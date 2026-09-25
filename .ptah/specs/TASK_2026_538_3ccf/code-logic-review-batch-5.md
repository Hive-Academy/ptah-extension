# Code Logic Review — `TASK_2026_538_3ccf`

Verdict: NEEDS_REVISION

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 1 |
| Moderate issues | 1 |
| Failure modes found | 3 |

Scope: Batch 5 only. Read all six listed implementation/test files in full; read the task context, relevant requirements, Q1, Component 16, Batch 5 instructions/report, admission error, contract reasons and reference live check. No existing `code-style-review.md` was present. `ptah_search_files` returned no AGENTS.md or CLAUDE.md; no direct read/Write tool was listed, so native filesystem access was used. Source was not edited and no git command was run.

Verification: the authorized service-only Jest command (PowerShell `Select-Object -Last 30` equivalent) passed **1 suite, 20 tests**. It emitted a Jest-config ES-module warning. The DI tests were read, not rerun. The executor reports 30 passing service/DI tests and project checks (`batch-5-report.md:86`, `:118`). Scoped `ptah_get_diagnostics` and one completion check both reported unavailable because the compiler check was still running after 45 seconds; current diagnostics could not be obtained. This is not a clean diagnostic result.

The score is 6 rather than 7 because the central total-outcome contract has uncovered exception paths. It is above the significant-problems band because dispatch admission, alias exclusion, fixed returned details and no internal retry are implemented and covered (`surface-submit-turn.service.ts:119`, `:131`, `:179`; spec `:120`, `:251`, `:316`). Paths below are relative to the worktree; short service/spec names refer to `libs/backend/rpc-handlers/src/lib/chat/session/`.

## Numbered findings

### 1. MAJOR / Serious — The outcome boundary excludes preflight and successful-send logging

- File: `libs/backend/rpc-handlers/src/lib/chat/session/surface-submit-turn.service.ts:102`, `:110`, `:129`, `:142`.
- Trigger: `lifecycle.find`, `isSessionActive` or either `isStreaming` throws; alternatively, `logger.info` throws after `sendMessageToSession` resolves.
- Symptom: `dispatch` rejects its promise instead of resolving a `SurfaceSubmitTurnOutcome`. The post-send case has already crossed the acceptance point but never returns `applied` or `indeterminate`.
- Current handling: the try covers only the awaited send. Preflight executes before it; success logging executes after it. The documented “never throws” guarantee at `:95` is false.
- Impact: a caller following the planned `beginSubmit -> dispatch -> settleSubmit` chain cannot rely on reaching settlement (`implementation-plan.md:708`). A raw dependency error escapes the service's fixed-detail boundary. This is not evidence that the future RPC handler already leaks errors; it is a broken service contract it would have to compensate for.
- Fix: cover lookup, liveness and busy checks with the outcome boundary; keep release conditional on **this invocation** acquiring the guard, so a rejected second call cannot clear the first call's guard. Make logging best-effort so it cannot replace an established outcome. Add injected-throw cases for each preflight collaborator and post-send logging, asserting fixed outcomes and zero/one sends respectively.
- Probability qualification: the current registry lookup is two Map reads (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:303`) and the broadcaster probe is Set.has (`libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts:120`), so ordinary missing-session input does not throw. The finding concerns the explicit dependency-failure contract, not a claim that these reads commonly fail.

### 2. MINOR / Moderate — Error classification can itself throw on valid JavaScript rejection values

- File: `libs/backend/rpc-handlers/src/lib/chat/session/surface-submit-turn.service.ts:137`, `:175`, `:190`, `:193`.
- Trigger: the send rejects with `Object.create(null)` or an object whose primitive conversion throws. `String(error)` then throws. A throwing logger also escapes from the classifier, including the typed-refusal branch.
- Symptom: a send failure that must become `indeterminate` instead rejects `dispatch`; a logging failure can similarly hide a known admission refusal.
- Current handling: the classifier runs from the catch with no protected conversion/logging boundary. The send's finally still releases the guard; it does not catch errors raised inside catch.
- Impact: arbitrary non-Error throws are not fully supported. The existing `'boom'` case exercises only a safely stringifiable primitive (`surface-submit-turn.service.spec.ts:342`).
- Fix: determine the fixed outcome independently of diagnostics; protect both error formatting and host logging, with a constant fallback when formatting fails. Add a null-prototype rejection test asserting the exact fixed `indeterminate` outcome and send count 1. This is an uncommon edge case, hence Moderate rather than Serious.

No TODO/PLACEHOLDER/STUB implementation markers, production mock data, missing implementation bodies, `any` types or `@ts-ignore` were found in the six reviewed files. Empty constructor bodies perform DI assignment; `{}` values in DI specs are intentional test stand-ins (`di.spec.ts:189`).

## Explicit answers to points 1–4

1. **Must move inside the outcome boundary.** Preflight failure is currently an unhandled promise rejection, contrary to the requested ANY-other-throw rule and `dispatch` documentation. See finding 1. Moving just these calls is insufficient unless diagnostic failures are also contained (finding 2).
2. **Both deviations are acceptable.** Skipping the real-ID probe when `realSessionId === null` preserves the tab probe and avoids treating an empty-key stream as live (`surface-submit-turn.service.ts:161`; spec `:152`, `:198`). Registry binding rejects blank real IDs (`session-registry.service.ts:248`). The existing live rule requires active registration plus a stream under either identity (`chat-session.service.ts:1138`). `TOKENS.LOGGER` supplies the required host-only diagnostics and matches the sibling constructor (`chat-subagent-context-injector.service.ts:52`); DI resolution includes it (`di.spec.ts:189`). This adds no new library dependency beyond the already-required TOKENS import. Logging must still be isolated as noted above.
3. **Yes, for two calls through the singleton targeting the same record.** Both resolve to `record.tabId`; checking and adding that key occur without an intervening await (`surface-submit-turn.service.ts:122`, `:127`). Registry alias lookup returns the indexed record (`session-registry.service.ts:303`). The service is registered as a singleton (`libs/backend/rpc-handlers/src/lib/chat/di.ts:78`), and the tab-then-real-ID pending test asserts one send (`surface-submit-turn.service.spec.ts:251`). This is concurrent per-record exclusion, not operation-ID deduplication after settlement; the latter belongs to later batches.
4. **No current mismatch.** Both local literals (`surface-submit-turn.service.ts:53`) appear in `libs/shared/src/mcp-apps-contracts/surface.types.ts:251` and `:252`. SDK `session-ended` is deliberately mapped to contract `session-unavailable` (`surface-submit-turn.service.ts:179`; `libs/backend/agent-sdk/src/lib/errors/session-admission-refused.error.ts:18`). Task 11.3 already carries the contract-derived alias/membership follow-up (`batches.md:1104`); no separate current defect is counted.

## Five logic questions

### 1. How does this fail silently?

No success-looking result on a rejected send was found: `applied` is after the awaited send (`surface-submit-turn.service.ts:131`, `:147`). Logging can suppress that successful outcome by throwing, leaving the caller without a classified result (finding 1). Actual turn execution after acceptance is outside this service's observation, explicitly documented at `:10`.

### 2. What user action produces unexpected behaviour?

Submitting while a preflight collaborator or logging dependency throws produces a rejected promise instead of the promised outcome (findings 1–2). Concurrent submits through tab and real IDs are handled: second call returns busy with one total send (spec `:251`).

### 3. What input data produces a wrong answer?

No incorrect classification of ordinary valid inputs was found. A non-stringifiable thrown value produces no outcome at all (`surface-submit-turn.service.ts:193`). This service intentionally accepts already-validated/frozen content; form validation is its caller's responsibility (`:5`).

### 4. What happens when a dependency fails?

Typed admission refusal becomes busy/session-unavailable (`:174`); ordinary send rejection becomes fixed indeterminate with no resend (`:187`). Lookup/probe failures escape (finding 1), and formatting/logging failures can defeat classification (finding 2). An unresolved send leaves dispatch pending and holds the key (`:128`, `:131`); the deferred-promise test verifies pending behaviour (spec `:232`).

### 5. What is missing that the requirements never mentioned?

Diagnostic code also needs failure containment for a total-outcome API (findings 1–2). A permanently unresolved send retains its guard indefinitely (`:128`, `:139`); no local timeout/cancellation policy is specified. Do not add a timeout that releases the guard and permits redispatch while acceptance is unknown. This is a residual integration question, not another defect charged to Batch 5.

## Failure modes

1. Preflight dependency throws -> raw rejected dispatch, no classified settlement (finding 1, service `:102`, `:158`).
2. Success logger throws after acceptance -> accepted message without a returned applied outcome (finding 1, service `:142`).
3. Failure diagnostics throw -> original send/refusal classification lost, although finally releases the guard (finding 2, service `:137`, `:193`).

## Blocking issues

None established in the reviewed scope.

## Serious issues

Finding 1: incomplete outcome boundary.

## Moderate and minor issues

Finding 2: unsafe failure diagnostics. No separate style findings.

## Data flow

1. Resolve record by routing ID — normal missing-record rejection OK; exception boundary gap (`:102`).
2. Check active registration and either stream key — live semantics OK; exception boundary gap (`:157`).
3. Reject running, queued or pending submit — OK, no send (`:119`).
4. Acquire canonical tab guard before first await — OK (`:127`).
5. Await exactly one require-idle send — OK; authoritative pump admission is the prior batch's contract, not re-proven here (`:131`).
6. Classify typed refusal / other rejection — correct for normal errors; diagnostic gap (`:174`, `:193`).
7. Release acquired guard in finally — OK for both send settlement branches (`:138`).
8. Return applied after resolution — timing OK; success logging can interrupt (`:142`).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Resolve session and reject non-live | PARTIAL | Correct normal decisions; thrown checks escape |
| Reject busy, never queue; require-idle dispatch | COMPLETE | Service call verified; pump implementation outside scope |
| One concurrent dispatch per record across aliases | COMPLETE | Canonical key plus singleton and alias test |
| Applied only after send resolves | COMPLETE | Deferred-send test; logging can still prevent the result |
| Typed refusal mapped; any other throw indeterminate | PARTIAL | Findings 1–2 |
| Fixed returned error text; raw errors host-only | PARTIAL | Constructed outcomes use literals; escaping exceptions bypass them |
| No redispatch | COMPLETE | Single send site; untyped rejection test asserts one call |
| Token, singleton registration and barrel | COMPLETE | `tokens.ts:28`, `di.ts:78`, `session/index.ts:18` |

Implicit requirement not addressed: diagnostic failure isolation.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Missing/inactive/no-stream record | YES | Fixed session-unavailable, spec `:162` | Throwing dependency is separate |
| Unbound real ID | YES | Tab-only live probe, spec `:152` | None established |
| Running/queued turn | YES | Busy without send, spec `:212` | Pump race handling delegated |
| Concurrent aliases | YES | Shared tab guard, spec `:251` | Singleton scope required |
| Ordinary untyped createUserMessage-style rejection | YES | Fixed indeterminate, count 1, spec `:316` | Mock pins host boundary; not a pump integration test |
| Null-prototype rejection / throwing logger | NO | Diagnostic exception escapes | Finding 2 |
| Preflight throw | NO | Outside try | Finding 1 |
| Never-settling dependency / host exit | NO | Guard remains until settlement; process state is volatile | No timeout or restart outcome promised here |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for the inspected control-flow defects; runtime admission and future RPC/ledger integration remain outside this review.
- Top risk: an exceptional dependency path escapes instead of supplying the terminal outcome needed to settle a submit operation.
- What a robust implementation would add: a complete outcome boundary, guard ownership preserved across early exits, best-effort diagnostics, and focused regression cases for preflight throws and unsafe thrown values.

﻿Verdict: APPROVED

# Code Logic Review — `TASK_2026_538_3ccf`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 0 unresolved |

Revision 1 closes both previous findings. This review assesses only the delta in `libs/backend/rpc-handlers/src/lib/chat/session/surface-submit-turn.service.ts` and `surface-submit-turn.service.spec.ts`, reading both current files in full and the executor's Revision 1 report. Earlier context and requirements remain applicable. No source files or task states were changed; no git commands were run.

Verification: the authorized service-only Jest command, using PowerShell `Select-Object -Last 30`, exited 0: **1 suite, 31/31 tests passed**. Jest emitted an ES-module configuration warning but completed successfully. Scoped `ptah_get_diagnostics` returned **0 errors, 0 warnings**. Broader rpc-handlers checks were not rerun; the executor records their success at `batch-5-report.md:198`.

Score rationale: 8/10 reflects sound failure handling supported by focused regression tests. The revision no longer has the substantive outcome gaps that justified 6/10. A higher exemplary score would require broader integration evidence than this two-file re-review establishes: the specs mock runtime acceptance and do not prove ledger settlement or actual pump execution (`surface-submit-turn.service.spec.ts:5`, `:90`).

In the references below, service/spec filenames are relative to `libs/backend/rpc-handlers/src/lib/chat/session/`.

## Numbered findings and disposition

### 1. MAJOR / Serious — Previous incomplete outcome boundary: CLOSED

- Evidence: `surface-submit-turn.service.ts:151` places lookup, live probes and busy checks inside `admit`'s try; `:179` catches their failures and returns the fixed `rejected/session-unavailable` detail at `:187`.
- Success is assigned immediately after the awaited send at `:120`. Acceptance logging uses `safeLog` at `:130`; the logger invocation is caught at `:239`. A logging failure therefore cannot replace `applied` or reject dispatch.
- Regression evidence: `surface-submit-turn.service.spec.ts:445`, `:458` and `:471` independently throw from find, isSessionActive and isStreaming, asserting the exact fixed outcome and zero sends. `:500` combines preflight and logger failure. `:514` asserts that successful send plus throwing logger remains applied with exactly one send.
- Impact of the fix: these dependency failures now return a usable outcome to the settlement caller; raw errors no longer escape through the reviewed preflight or success-log paths.
- Semantic judgment: **rejected/session-unavailable is correct for a preflight exception**. `admit` returns before dispatch's sole send at `:115`; no message was sent, so there is no uncertainty about whether this invocation started a turn. The fixed text accurately says the session could not be checked, rather than claiming it was definitely absent. This is an acceptable refinement of the earlier blanket “any other throw is indeterminate” wording, consistent with the known-no-side-effect rule in `task-description.md:383`. An untyped error from the send itself must still be indeterminate (`surface-submit-turn.service.ts:282`).

### 2. MINOR / Moderate — Previous unsafe classification/diagnostics: CLOSED

- Evidence: `surface-submit-turn.service.ts:122` computes the send outcome before logging. `classifySendFailure` protects both instanceof and the reason read (`:266`) and falls back to the fixed indeterminate outcome (`:282`). `describeError` protects conversion and Error-property access (`:299`), returning constant fallback fields on failure (`:306`). Logger failures are contained by `safeLog` (`:239`).
- Regression evidence: `surface-submit-turn.service.spec.ts:534` rejects with `Object.create(null)` and asserts exact fixed indeterminate, one send and fallback host text. `:550` covers throwing conversion; `:565` covers a throwing instanceof proxy trap; `:523` preserves a typed busy refusal even when its logger throws.
- Impact of the fix: non-coercible rejection values no longer turn failure classification into a rejected dispatch promise. Diagnostic failure does not change or retry the send outcome.

No new actionable defect was established in the revised paths. The severity labels above describe the historical findings; neither is counted as an open issue.

## Five logic questions

### 1. How does this fail silently?

A broken logger is intentionally swallowed (`surface-submit-turn.service.ts:239`), so diagnostic visibility can be lost, but the operation outcome is preserved. No success-looking result on a failed send was found: applied is assigned only after the awaited send resolves (`:115`, `:120`). Acceptance remains distinct from observing the eventual turn (`:10`).

### 2. What user action produces unexpected behaviour?

No new unexpected submit behaviour was found. A second submit through the other session ID remains busy while the first is pending (spec `:249`). A later preflight failure cannot clear the first call's guard (spec `:584`), so a third submit remains busy with one total send (`:611`).

### 3. What input data produces a wrong answer?

The previous non-coercible thrown-value cases now produce fixed indeterminate outcomes (spec `:534`, `:550`, `:565`). No wrong answer was found for the documented input contract: content is an already validated, frozen string supplied by the host caller (`surface-submit-turn.service.ts:5`, `:101`). Form validation remains outside this service.

### 4. What happens when a dependency fails?

Preflight throws return fixed session-unavailable with zero sends (`:179`). Typed busy/session-ended send refusals map to fixed rejected outcomes (`:273`, `:276`); other send failures become fixed indeterminate (`:282`). Formatting and logging failures are contained (`:299`, `:239`). An unresolved send remains pending with its guard held (`:111`, `:115`); resolution or rejection runs finally (`:124`). No automatic redispatch exists.

### 5. What is missing that the requirements never mentioned?

No additional missing requirement is needed to close these findings. Diagnostic isolation is now explicit (`:230`). A permanently unresolved send still retains the guard; timeout, cancellation and restart recovery are not implemented by this delta. Releasing that guard merely because a caller timed out would risk a second send while acceptance remained unknown. The executor explicitly preserves this limitation (`batch-5-report.md:213`).

## Failure modes

None unresolved in the reviewed delta. Checks covered preflight failure, simultaneous logger failure, logging after successful send, typed refusal with failed diagnostics, null-prototype rejection, throwing conversion, hostile instanceof and concurrent guard ownership. Evidence is the implementation and 31 passing tests cited above. Residual uncertainty: adapter/pump integration and future operation-ledger settlement are mocked or outside this review, not proven by this suite.

## Blocking issues

None established.

## Serious issues

None open; previous finding 1 is closed.

## Moderate and minor issues

None open; previous finding 2 is closed. No TODO/PLACEHOLDER/STUB markers, `as any`, `any` annotations or `@ts-ignore` were found in the two reviewed files. The intentional diagnostic catch is implemented failure containment, not a stub (`surface-submit-turn.service.ts:241`).

## Data flow

1. **OK:** `dispatch` calls the synchronous protected preflight (`surface-submit-turn.service.ts:103`, `:151`). Refusal returns before acquisition or send (`:104`).
2. **OK:** successful preflight supplies canonical tabId; the same call adds its guard without an intervening await (`:110`). Concurrent aliases remain covered by the existing test (spec `:249`).
3. **OK:** exactly one require-idle send is awaited (`:115`). Resolution sets applied (`:120`); rejection enters protected classification (`:122`).
4. **OK:** failure diagnostics cannot overwrite the outcome (`:123`, `:234`, `:299`).
5. **OK:** every acquired guard is released in finally when the send settles, including synchronous send throws, rejected promises and classification/logging paths (`:124`). Preflight exits acquired nothing and intentionally do not delete another call's guard (`:104`). Tests cover settled refusal release (spec `:265`), sequential successful reuse (`:135`) and failed-preflight ownership (`:584`). A never-settling send does not reach finally yet.
6. **OK:** success logging is best-effort; the established outcome is returned (`:128`, `:140`).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Preflight exceptions return fixed outcome with zero sends | COMPLETE | Tests independently cover all three collaborators |
| Successful send survives throwing logger | COMPLETE | Applied and one send asserted |
| Non-coercible rejection becomes indeterminate, one send | COMPLETE | Null-prototype, conversion and instanceof cases |
| Guard ownership and finally cleanup | COMPLETE | Early exits do not own a guard; acquired guards release on settlement |
| Known preflight failure classified truthfully | COMPLETE | Rejected/session-unavailable accurately indicates no send |
| Fixed returned details and no redispatch | COMPLETE | Pure outcome classification and sole send site |

Implicit requirements not addressed by this delta: no new omission found; indefinite dependency hangs retain the existing integration limitation.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| find/active/stream probe throws | YES | Exact fixed rejection, zero sends; spec `:445` | None found |
| Preflight and logger both throw | YES | Guarded formatting/logging; spec `:500` | Host diagnostics may be lost |
| Success logger throws | YES | Applied survives; spec `:514` | Host diagnostics may be lost |
| Typed-refusal logger throws | YES | Busy survives; spec `:523` | None found |
| Null-prototype/throwing conversion/proxy rejection | YES | Fixed indeterminate, one send; spec `:534` | None found |
| Second call fails preflight while first is pending | YES | First guard retained; spec `:584` | None found |
| Settled send, success or refusal | YES | Finally deletes owned guard; service `:124` | No dedicated post-indeterminate reuse test; same finally covers it |
| Send never settles | NO terminal outcome | Pending guard remains; service `:115` | Deliberate unchanged limitation |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for closure of both findings and the reviewed guard paths.
- Top risk: a permanently unresolved adapter send retains pending state; the revision does not add an unsafe timeout retry.
- What a robust implementation would add: no further change is required in this delta. Later integration tests should exercise actual admission and operation settlement; this suite verifies the host boundary with a mocked adapter.
