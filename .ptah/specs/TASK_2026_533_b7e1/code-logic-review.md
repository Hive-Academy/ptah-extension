# Code Logic Review — `TASK_2026_533_b7e1`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 1 |
| Failure modes found | 1 remaining |

Final re-review, round 2 of 2. Scope: frontend Revision 1 and the uncommitted backend duration changes. Paths below are relative to `D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement`.

## Verdict

**REVISE — 7/10.** All four original reproductions now pass. One new, reproduced malformed-input failure remains in the snapshot validator. The normal paths and required compatibility cases passed the scoped source-method checks, supporting the sound 7–8 band rather than the earlier 5–6 band. The remaining validation hole and absence of host/browser integration verification prevent a higher score.

- Recommendation: REVISE.
- Confidence: HIGH for the reproduced methods and duration arithmetic; MEDIUM for integration.
- Top risk: a malformed primary-model field is accepted as a valid snapshot and then throws during display or resume.
- What a robust implementation would add: validate the primary model before asserting `SessionStatsEntry`, and add a regression covering both consumers.

## Re-review of Defects 1–4

| Original defect | Status | Evidence and rerun result |
| --- | --- | --- |
| 1. Unrevisioned history overwrites newer live accounting | **FIXED** | `libs/frontend/chat-state/src/lib/session-stats-snapshot.ts:71` admits unrevisioned data only before a floor exists; line 72 rejects lower revisions. The tab uses it at `tab-manager.service.ts:2079`; the surface at `surface-session-stats.registry.ts:102`. Executed actual methods: revision 15/$15 followed by unrevisioned $2, including `applyLoadedSessionStats`, retains $15. Surface 15 → unrevisioned → 10 retains 15; clearing its display does not clear the floor. Equal revision installs into a second tab. |
| 2. Snapshot-only event erases footer fields | **FIXED** | `libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts:125` installs the snapshot and returns at line 133, before compaction/footer/refresh/queue handling. Executed actual aggregator and streaming methods: finalized footer and streaming `pendingStats` retain object identity and values; none of those side effects runs. Surface-only delivery installs the snapshot. Full results with `cost: null` or `cost: 0`, zero tokens and duration still forward and refresh; the predicate checks absence, not truthiness (line 65). |
| 3. Malformed revision bypasses ordering | **FIXED** | `libs/frontend/chat-state/src/lib/session-stats-snapshot.ts:24` validates supplied revisions through the safe-integer check at line 90. Tab/surface checks run before admission (`tab-manager.service.ts:2070`, `surface-session-stats.registry.ts:100`); broadcast/resume boundaries validate at `session-stats-aggregator.service.ts:246` and `session-loader.service.ts:865`. Executed the original string revision `"9"` after 15, plus null, NaN, Infinity, negative and fractional revisions: none replaces the accepted value. The newly found primary-model hole below is separate from this fixed revision defect. |
| 4. Live Time chip disappears | **FIXED** | `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:650` forwards per-turn duration. `session-stats-owner.service.ts:479` adds it only for accepted results, with finite/nonnegative checking at line 484. New-session prefix duration is zero (line 385); cold resumed prefix duration is null (line 407), preserved by publication at line 659. Executed the complete owner with the actual contribution aggregator: 1000 + 1500 = 2500 ms; duplicate, non-monotonic, invalid and zeroed-error results add nothing; another run's 300 ms yields 2800. An accepted result on a cold resumed session still publishes null. The component displays positive duration and hides null (`libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.ts:768`). |

The orchestrator's `>=` rule, rejection of unrevisioned history after a floor exists, and page-lifetime floors are accepted decisions, not findings.

## New defects

### N1. Moderate — the validator accepts a primary model that crashes its consumers

- **File:** `libs/frontend/chat-state/src/lib/session-stats-snapshot.ts:38`.
- **Trigger:** a JSON snapshot with valid session ID, cost, tokens and revision, but `model: 42` instead of string/null. No unusual JavaScript values are required.
- **Current handling:** the validator checks numeric accounting fields and rows but never checks the top-level `model`. It returns true. The declared DTO requires string/null (`libs/shared/src/lib/types/rpc/rpc-session.types.ts:196`).
- **Display symptom:** with no live model and at most one row, `session-stats-summary.component.ts:740` selects 42 as the primary model. The formatter at line 855 reaches `libs/shared/src/lib/utils/pricing.utils.ts:521` and throws `modelId.replace is not a function`.
- **Resume symptom:** the new boundary check passes (`session-loader.service.ts:865`), then line 881 calls `applyLoadedSessionStats`. Its model-window lookup (`tab-manager.service.ts:2045`) reaches `pricing.utils.ts:457` and throws `modelId.toLowerCase is not a function`, rather than rejecting the snapshot and retaining a functioning resume path.
- **Impact:** a malformed response can break model rendering or abort resume processing. No normal backend producer emitting numeric model IDs was identified; this is an uncommon boundary failure, hence Moderate rather than a blocker.
- **Minimal fix:** validate top-level `model` as string/null before returning the type predicate. Preserve legitimate null models and optional accounting fields. Add a malformed-model regression at the shared validator and resume/display boundary.
- **Verification:** an in-memory harness ran the actual validator and both actual pricing consumers. Both errors reproduced. A second harness executed the extracted loader → tab-manager → actual model-window lookup chain: validator returned true; resume threw; no validation warning or tab write occurred. Source files were not changed.

## Five logic questions

### 1. How does this fail silently?

The former accounting/footer silent failures no longer reproduced. The remaining N1 failure throws rather than silently changing accounting (`pricing.utils.ts:457`, line 521).

### 2. What user action produces unexpected behaviour?

Opening a session whose resume response contains the malformed model described in N1 aborts at `session-loader.service.ts:881`.

### 3. What input data produces a wrong answer?

The original stale/malformed-revision examples are rejected (`session-stats-snapshot.ts:24`, line 71). No new wrong accounting answer was established. Numeric `model` instead produces a runtime error.

### 4. What happens when a dependency fails?

Malformed revision/token snapshots are rejected before installation (`session-stats-aggregator.service.ts:246`, `session-loader.service.ts:865`). The model-type failure escapes that validation; see N1. Duration from rejected owner results is not accumulated (`session-stats-owner.service.ts:479`).

### 5. What is missing that the requirements never mentioned?

A validator that asserts the entire DTO also needs to cover fields consumed outside numeric accounting. Primary-model presentation and resume lookups require a string (`pricing.utils.ts:457`, line 521).

## Failure modes

N1 above records the sole remaining established trigger, symptom, current handling, evidence and recommendation. The four original findings are closed by the reruns, not carried forward as open defects.

## Blocking issues

None established in this re-review.

## Serious issues

None established in this re-review.

## Moderate and minor issues

N1: unchecked primary-model type, `session-stats-snapshot.ts:38`.

## Data flow

1. Broadcast/resume snapshot → validation: numeric accounting checks work; primary model remains unchecked (N1).
2. Valid snapshot → session guard → revision floor → assignment: original stale-data reproductions pass (`tab-manager.service.ts:2070`; `surface-session-stats.registry.ts:98`).
3. Snapshot-only notification → installation → return: no footer effects (`session-stats-aggregator.service.ts:125`). Full null/zero-cost results continue to the footer branch at line 185.
4. SDK duration → accepted result → per-run sum → session sum: verified; cold-resume prefix keeps duration unknown (`stream-transformer.ts:650`; `session-stats-owner.service.ts:486`, line 659).
5. Snapshot model → formatter/resume lookup: malformed-model gap described in N1.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Original defects 1–4 | COMPLETE | All original source-method reproductions pass. |
| Legitimate optional snapshot shapes remain accepted | COMPLETE for tested matrix | No false rejection found. |
| Snapshot-only handling preserves real turn-result processing | COMPLETE for tested inputs | Null and zero-cost results retain footer/refresh handling. |
| Malformed snapshots rejected before consumer errors | PARTIAL | N1. |

Implicit requirements not addressed: complete validation of fields covered by the snapshot type predicate.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Optional fields omitted | YES | Validator and loader accepted | No invented zero/fallback. |
| Null knownCost/totalCost/durationMs | YES | Nullable checks | Accepted by loader. |
| Empty modelUsageList; status empty/error | YES | Empty array accepted; status does not reject | No compatibility issue found. |
| Row cache fields omitted; row cost null | YES | Optional cache checks | Accepted by loader. |
| Equal publication across tabs | YES | `>=` floor | Accepted decision. |
| Delayed unrevisioned history / lower revision | YES | Retains installed live value | Original reproduction passes. |
| Snapshot-only update during streaming or after finalization | YES | Returns before footer mutation | Object identity retained. |
| Accepted/duplicate/rejected turn duration | YES | Only accepted result contributes | Tested with actual owner. |
| Cold resumed duration | YES | Null prefix keeps null total | Tested after accepted usage. |
| Numeric primary model | NO | Passes validator, consumer throws | N1. |

## Not verified

- No full suite, lint, build, browser test or real SDK session was run. Developer-reported project checks remain reported evidence, not independently repeated. The checks above used transpiled source modules/methods in memory, with UI/service dependencies stubbed; the duration check used the complete owner, actual contribution aggregator and actual primary-model selector. No temporary test/source files were written.
- Scoped `ptah_get_diagnostics` for the new validator and backend owner returned 16 errors, all in chat-state spec files, and no production errors in that response. Example: `libs/frontend/chat-state/src/lib/tab-manager.intent-mutators.spec.ts:75`. No diagnostic is counted as a new defect here.
- Host restart transport behavior and visual rendering were not re-exercised. The agreed page-lifetime floor policy was not re-raised.
- Large orchestration files were traced at the revised methods and their relevant callers; unrelated behavior is not certified. Existing single-snapshot display findings from round 1 were retained, not replaced by a new whole-application audit.
