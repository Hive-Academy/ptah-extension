# Code Logic Review — TASK_2026_559_8ca9

## Summary

Batch 25b r2, Lane H. APPROVE, 8/10. All three r1 findings are resolved for their original symptoms. The independently rerun budget probe retains coverage, the original malformed-census case no longer prints a bare clean, and unnamed mixed/syntax-only checks now name their limitation. One Moderate residual consistency issue remains for malformed coverage: the prose rejects it but the compact block can still say clean:true.

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 1 |
| Failure modes found | 1 |

The higher score reflects fixed normal and edge rendering with real-budget verification, rather than only additional tests. It is below 9 because malformed metadata still has inconsistent representations and the probes are not exhaustive validation of arbitrary runtime objects. No source/spec edits or git operations were performed. The full formatter and integration review from r1 remains the baseline; revised branches and added tests were re-read on disk.

Anchors below refer to `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts` (F), its `.spec.ts` (Spec), and `diagnostics-coverage.e2e.spec.ts` (E2E).

## r1 finding status

| Finding | Status | Evidence |
| --- | --- | --- |
| M1: malformed census value becomes bare clean | RESOLVED for bare-clean symptom | F:830 adds closed-vocabulary qualifiers before F:846 computes bare. Original census:'unavailable' probe now qualified. Runtime matrix of 150 census/state/check combinations produced no unexpected bare decision. Compact serialization residual is R2-M1 below. |
| M2: unavailable reason removes coverage under budget | RESOLVED | F:537–540 places status, coverage and notChecked before reason. Original real-budget probe now retains Coverage and census unknown at the same 7,940-char cut. |
| M3: mixed check without approximation names has empty qualifier | RESOLVED | F:958–970 always explains mixed/syntax-only; missing names use 'languages not named'. Original probe no longer renders 'qualified — .'. |

### Regression sensitivity

Spec:1191–1210 tests invalid census/state/check values with zero counts, requiring named qualifiers and no bare clean. The census case would regress to the r1 false clean, while the other values would lose their named explanation. Spec:1214–1230 requires mixed and syntax-only fallback wording and forbids an empty qualifier. Spec:1255–1263 asserts the revised unavailable layout and coverage/notChecked ahead of reason.

E2E:336–355 exercises the actual provider, namespace, dispatcher, formatter and budget with a long unavailable reason. It checks the budget trailer, coverage, notChecked and Python group. This directly catches the r1 ordering defect. The author's seven-fail-before evidence is plausible from the old behavior and matches the independent r1/current probe contrast. No source substitution or fresh base run was performed by this reviewer.

## Five logic questions

### 1. How does this fail silently?

No new false bare-clean case was found in the exercised enum/count scenarios. Invalid census/state metadata can still be serialized as compact clean:true at F:848, despite the new prose qualifiers at F:830. That mixed message is the remaining Moderate boundary issue, not a reproduced clean claim from a current provider.

### 2. What user action produces unexpected behaviour?

A user encountering a malformed provider result can see 'treated as census unknown' beside a machine-readable clean:true block. An agent relying on the block gets a different interpretation than the prose (R2-M1). Ordinary long compiler failures now preserve the coverage header because the reason comes last (F:537–540).

### 3. What input data produces a wrong answer?

Otherwise clean counts with census:'unavailable' or state:'frozen' produce a correct qualified prose warning but an incorrect compact clean block. Missing coverage and legacy arrays remain qualified; unknown/truncated/updating/incomplete states remain qualified; syntax-only and mixed kinds remain explicitly non-type-check claims (F:820–848, :958–970).

### 4. What happens when a dependency fails or returns the wrong shape?

The unavailable arm renders failure status before coverage and reason (F:531–541). The budget can cut its detailed reason without suppressing the tested coverage. Shallow asCoverage validation still delegates valid-looking objects to typed helpers (F:811–817); the added closed sets stop bare claims for invalid top-level enum values but do not normalize the object passed to compactCoverage. Formatter exceptions retain the existing raw-JSON fallback. No broader runtime schema guarantee is inferred.

### 5. What is missing that the requirements never mentioned?

A shared validated interpretation for both prose and compact serialization. Naming an invalid field is insufficient if the machine-readable verdict still uses the unvalidated value. This can be resolved locally by omitting compact output for malformed metadata or normalizing it to an unknown report before both renderers use it.

## Numbered new findings

### 1. R2-M1 — Moderate: rejected enum metadata still emits compact clean:true

- **File:** `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts:848`; qualification at :830, invalid-census explanation at :874.
- **Trigger:** An available/empty payload has zero qualifying counts and census:'unavailable' (or state:'frozen'). The malformed metadata is the same boundary shape challenged in r1.
- **Symptom:** Prose correctly says 'not a clean answer' and `census "unavailable" not recognised (treated as census unknown)`, but the following compact block is `{"clean":true,"analyzed":null}`. The invalid enum and reasons disappear from the compact block.
- **Cause:** diagnosticsVerdict adds independent prose qualifiers, then still passes the original object to compactCoverage. That typed helper assumes valid enum values and is not a runtime validator.
- **Evidence:** Original format probe and the new matrix probe both reproduce the contradictory block for invalid census and state. An invalid check kind also retains compact clean:true, though check-kind qualifications and census cleanliness are intentionally distinct for valid syntax-only checks.
- **Impact/severity:** Moderate: inconsistent observability for malformed provider metadata, with risk to agents parsing the embedded JSON. The primary prose is now honest and current providers were not found emitting these enum values; no Blocking/Serious normal-path failure is claimed.
- **Recommendation:** For invalid census/state values, normalize to unknown/non-clean coverage before creating both representations, or omit the compact block and explicitly identify invalid coverage. Preserve the intentional distinction for valid syntax-only clean counts. Add assertions that malformed census/state cannot emit a compact clean:true block, not only that 'No issues found' is absent.

## Blocking issues

None established.

## Serious issues

None established.

## Moderate and minor issues

R2-M1 above; no additional counted failure mode.

## Data flow

1. Existing namespace forwarding retains coverage/notChecked on both arms; it is unchanged by this revision (r1 evidence retained).
2. F:528 derives a verdict. Absent coverage uses the no-coverage qualifier at :823; malformed top-level enums now add explicit qualifiers at :830.
3. F:837 and :958–970 explain syntax-only/mixed and approximation limitations. The final non-type-check guard at :840 prevents an empty qualifier list.
4. F:846 permits bare output only when no qualifier exists and the check is type-check/absent. Tested enum combinations all match that decision rule.
5. F:848 creates compact output separately — R2-M1.
6. Unavailable layout at :537–540 protects coverage from a long reason. Diagnostics remain preformatted in the unchanged budget pipeline.

## Requirements fulfilment

| Requirement | Status | Evidence / gap |
| --- | --- | --- |
| Original M1 no bare clean for invalid census/state/checks | COMPLETE | Closed vocabulary checks; 150-case matrix. |
| M2 coverage survives long unavailable reason | COMPLETE for reproduced case | Same real-budget probe now retains coverage; added E2E case. |
| M3 unnamed mixed/syntax-only qualifier | COMPLETE | Always enters explanatory branch; tests and original probe. |
| No contradictory compact interpretation of invalid census/state | PARTIAL | R2-M1. |
| '(all)' wording compatibility | COMPLETE within searched scope | No exact 'syntax-only check (all)' reference found under libs/apps; scoped suite passes. This is display wording, not a structured contract field. |
| Other 25b forwarding/order/rollover behavior | Prior acceptance retained | Revision changes only formatter and its formatter/e2e tests; no new provider or namespace behavior. |

## Edge cases

| Case | Result |
| --- | --- |
| Legacy empty array / no coverage | Qualified, no bare clean. |
| Invalid census/state/checks enum | Named prose qualifier, no bare clean; compact inconsistency remains. |
| Syntax-only without names | 'languages not named', explicit syntax-only limitation. |
| Mixed without names | Named mixed limitation; no empty qualifier. |
| Unknown census / omittedByCap | Named qualifier remains. |
| Long unavailable reason | Coverage and unknown-census reason survive the real budget cut. |
| Valid complete type-check, zero counts | Bare clean still allowed; matrix includes positive controls. |

## Verification

Personally ran:

```powershell
node "$env:TEMP/task559-25b-r1-format-probe.cjs"
node "$env:TEMP/task559-25b-r2-matrix-probe.cjs"
```

The original probe loads the actual formatter, coverage helpers, reducers and applyToolResultBudget from current source. It writes only an OS-temp spool fixture. All original r1 symptoms are fixed. Long-reason result: truncated true, 7,940 chars, Coverage present, census-unknown prose present (both absent in r1).

Matrix: 5 census values × 5 state values × 6 check kinds = 150 combinations. No unexpected bare decision. Separate inspection records qualified:true with compactClean:true for invalid census/state, establishing R2-M1. This is a bounded enum matrix, not a claim to exhaust arbitrary payloads.

`ptah_get_diagnostics` scoped to the formatter: TypeScript compiler, zero errors/warnings. Targeted search under libs/apps found no remaining exact consumer/spec reference to the old '(all)' phrase.

Scoped command: `node_modules/.bin/nx run-many '-t=test,lint,typecheck' -p @ptah-extension/vscode-lm-tools --skip-nx-cache`, with NX_ISOLATE_PLUGINS=false and NX_DAEMON=false. Header confirms only vscode-lm-tools. All three targets passed in 39.4s. Log: `%TEMP%/task559-25b-r2-checks.log`. Run once, one completion check.

No source/spec edits, state-changing operations, fresh base mutation, workspace-wide verification, or cross-platform execution. Previously accepted 25a/25b rollover behavior was not redundantly rerun in this formatter-only revision.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for the three targeted corrections; MEDIUM for arbitrary malformed-provider payloads.
- Score: 8/10
- Top risk: invalid census/state can leave a clean:true compact block beside qualified prose.
- What a robust implementation would add: one normalized, fail-closed coverage interpretation used by both prose and compact JSON, with a compact-verdict regression assertion.

