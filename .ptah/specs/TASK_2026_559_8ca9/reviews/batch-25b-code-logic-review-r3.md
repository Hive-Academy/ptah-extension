# Code Logic Review — TASK_2026_559_8ca9

## Summary

Batch 25b r3, final revision review. APPROVE, 8/10. The remaining r2 finding is resolved: invalid census/state inputs are normalized before both prose reason generation and compact serialization. No new defect was established in the scoped correction or the independent 150-combination matrix.

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 0 |

This is a sound, narrowly verified correction with passing failure reproductions. The score does not imply exhaustive validation of arbitrary provider objects or all host runtimes; those residual limits distinguish it from 9–10. No source/spec edits or git operations were performed. Prior full-file/integration review remains the baseline; revised verdict construction, normalization and regression assertions were re-read on disk.

Anchors below use `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts` (F) and its `.spec.ts` (Spec).

## Prior-finding status

| Finding | Status | Evidence |
| --- | --- | --- |
| r1 M1: invalid census produces bare clean | RESOLVED | F:831 retains a qualifier naming the original value, F:832 normalizes, F:851 requires no qualifiers for bare output. Original probe and matrix remain non-bare for invalid enums. |
| r1 M2: long unavailable reason removes coverage under budget | RESOLVED, preserved | F:537–540 retains coverage before reason. Original real-budget probe still returns Coverage and census-unknown prose at a 7,940-character cut. |
| r1 M3: mixed check without names has empty qualifier | RESOLVED, preserved | approximationTexts still handles mixed/syntax-only explicitly; original probe names 'languages not named', with no empty qualifier. |
| R2-M1: malformed census/state gets compact clean:true | RESOLVED | F:880–888 converts invalid census to unknown and invalid state to incomplete, recomputing coverage. Both reason generation at :836 and compactCoverage at :853 consume that normalized object. The exact r2 reproduction now emits compact clean:false. |

### Regression sensitivity

Spec:1215–1242 tests the exact two r2 cases. It extracts the compact block, requires clean:false, requires the normalized census/state and matching reason, forbids clean:true anywhere, and requires matching prose. Those assertions fail on r2's observed output, which emitted clean:true and discarded the invalid census/state. The author's two-fail-before claim is consistent with the code and independently recorded r2 reproduction. No source substitution/base run was performed this round.

## Five logic questions

### 1. How does this fail silently?

No remaining census/state verdict contradiction was established. F:832 creates one normalized coverage object; F:836 and :853 use it for reasons and compact output. F:831 separately preserves the original malformed value in prose, so normalization does not silently erase why the answer is qualified.

### 2. What user action produces unexpected behaviour?

The original malformed-provider and long-failure actions now produce the expected qualified answer. Normal complete type-check coverage still allows a bare clean (F:843–851); the matrix includes those positive controls. No new action-specific regression was found in this correction.

### 3. What input data produces a wrong answer?

The tested census:'unavailable' and state:'frozen' values no longer produce a compact clean answer. The 150-case census/state/check matrix found no unexpected bare or compact decision. This matrix covers explicit enum alternatives, not every arbitrary nested runtime payload; malformed approximations and exotic non-JSON objects remain outside the claim.

### 4. What happens when a dependency fails or returns an unexpected shape?

Absent/unrecognized coverage shape still receives the not-reported qualifier through F:823–824. Recognizable objects with invalid census/state now fail closed through F:880–888. Long unavailable reasons remain after coverage in the output, so the original real-budget failure probe retains its disclosure. Existing exception-to-raw-JSON fallback is unchanged by this revision.

### 5. What is missing that the requirements never mentioned?

Nothing newly necessary to accept this bounded correction was established. A comprehensive runtime schema remains broader than the implemented enum normalization. The distinction between a clean census and permission to make a bare type-check claim remains important for interpreting the compact block; it is intentionally preserved rather than changing platform-core semantics here.

## New findings

None established. No numbered defect is added merely because the review's default stance is to refute. Scope examined: the normalization helper, both prose and compact consumers, original malformed-enum reproductions, normal/unknown/truncated state combinations, qualifier fallbacks, and the previous budget-cut reproduction.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

None newly established.

## Data flow and interpretation

1. F:822 obtains recognizable coverage; absence is qualified at :824.
2. F:831 names out-of-vocabulary values from the original object, retaining explanatory detail.
3. F:832 calls normalizedCoverage. F:883 returns valid census/state unchanged; otherwise :884–888 clones and overrides only invalid verdict inputs, using withCoverageVerdict. The caller's payload is not mutated.
4. F:836 obtains clean-answer reasons from the normalized fields. Approximation/check-kind qualifications are then added before the bare decision at :851.
5. F:853 serializes that same normalized coverage. Unknown/incomplete cannot collapse into a clean compact block in the reproduced cases.

**Check-kind distinction:** checks is deliberately not part of the shared census-clean rule. With otherwise complete/clean coverage, checks:'mixed', syntax-only, provider-defined or an invalid check kind can have compact clean:true while the prose disallows a bare type-check claim. This is the pre-existing explicit separation of census cleanliness from check scope, not the r2 invalid-census/state defect. The matrix evaluates those predicates separately. The source comment at F:829–830 is broader than that distinction; this is not counted as a behavioral finding.

## Requirements fulfilment

| Requirement | Status | Evidence |
| --- | --- | --- |
| R2-M1 original reproduction resolved | COMPLETE | Invalid census/state now compact clean:false with matching reasons. |
| Regression would fail on old behavior | COMPLETE by assertions and recorded probe comparison | Spec:1237–1241 contradicts the prior clean:true output. No fresh base mutation claimed. |
| No new inconsistency across 150 combinations | COMPLETE within matrix | No unexpected bare decisions or compact census decisions. |
| Prior long-reason and missing-name fixes | PRESERVED | Original probe rerun; correct qualifier text and budget survival. |
| Other forwarding/order/rollover contracts | Prior acceptance retained | Revision limited to formatter normalization/spec; unchanged integration exercised by scoped suite. |

## Edge cases

| Case | Outcome |
| --- | --- |
| Invalid census string | Named original value; normalized unknown; compact clean:false, census? reason. |
| Invalid state string | Named original value; normalized incomplete; compact clean:false, stale reason. |
| Both invalid census and state | Both normalized and qualified in the matrix. |
| Null census | Coverage not reported rather than a fabricated complete census. |
| Unknown/truncated/updating/incomplete | Remain qualified and compact non-clean. |
| Complete/current type-check | Bare clean remains possible when counts pass. |
| Syntax-only/mixed without names | Explicit non-type-check limitation retained. |
| Long unavailable reason | Coverage survives the real budget cut. |

## Verification

Personally ran these current-source probes:

```powershell
node "$env:TEMP/task559-25b-r2-matrix-probe.cjs"
node "$env:TEMP/task559-25b-r3-matrix-probe.cjs"
node "$env:TEMP/task559-25b-r1-format-probe.cjs"
```

- Original r2 reproduction: census:'unavailable' and state:'frozen' are qualified with compactClean:false, previously true.
- Extended matrix: 5 census × 5 state × 6 check values = 150 combinations. It parses the compact JSON when present and compares its clean flag with the normalized census/state predicate. `unexpectedBareDecisions:[]`, `unexpectedCompactDecisions:[]`.
- Original formatter/budget probe: legacy, missing coverage, unknown, omittedByCap and syntax/mixed outputs remain qualified. Unavailable long reason: truncated true, 7,940 characters, Coverage present and census-unknown prose present. The probe uses the actual formatter, coverage helpers, reducers and applyToolResultBudget, with an OS-temp spool root.
- Scoped ptah_get_diagnostics on the formatter: TypeScript compiler, zero errors/warnings.

Scoped command: `node_modules/.bin/nx run-many '-t=test,lint,typecheck' -p @ptah-extension/vscode-lm-tools --skip-nx-cache`, with NX_ISOLATE_PLUGINS=false and NX_DAEMON=false. Header confirms only vscode-lm-tools. Lint and typecheck passed; test failed: 70 suites passed, 1 failed; 2,078 tests passed, 1 failed. The sole failure is `protocol-dispatcher.spec.ts:6417`, dependency-graph background build / delivers a slow empty build to the next call, then rediscovers: graph.isBuilt(root) was false after slowEmpty.resolve and flush. This graph-readiness assertion is outside the changed formatter path; the formatter/e2e suites passed. Nx marked the task flaky, but no isolated/base rerun was performed, so flakiness is not asserted as proven. The same project run passed in r2. This is a verification limitation to track, not an anchored defect in this normalization correction. Log: `%TEMP%/task559-25b-r3-checks.log`; duration 28.7s. Run once, one completion check; failure details read from the existing log.

No source/spec edits, git operations, workspace-wide checks, fresh base substitution, cross-platform runtime execution, or independent audit/dependency validation this round. Earlier provider rollover work was not redundantly re-reviewed beyond the retained baseline and unchanged scoped-suite integration.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for the scoped correction and reproduced edge cases.
- Score: 8/10
- Top residual uncertainty: arbitrary malformed provider objects beyond the exercised enum matrix are not exhaustively validated.
- What a robust implementation would add: retain the compact/prose consistency tests and extend them whenever new coverage enum values or verdict fields enter the contract; no additional correction is required by an established finding in this review.

