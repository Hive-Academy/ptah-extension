# Code Logic Review — TASK_2026_559_8ca9

## Summary

Batch 25b r1, Lane H. Recommendation: APPROVE with three Moderate edge-case findings. The normal provider-to-tool path forwards both result arms and qualifies unexamined languages. The carried generation-retention correction bounds the map without losing the publication fence. The remaining findings involve malformed coverage, incomplete mixed-check metadata, and unusually long unavailable reasons; no Blocking/Serious failure was established for the current providers' normal payloads.

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 3 |
| Failure modes found | 3 |

The score reflects successful normal-path integration and independently verified rollover, with incomplete boundary validation and qualifier retention preventing a higher score. Source/spec files were not modified and no git operations were run. Read the executor report, batch/plan diagnostics requirements, namespace and formatter logic, coverage contract, budget/dispatcher integration, e2e cases and rollover regressions. The previously reviewed 25a provider is the baseline.

For brevity, F means `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts`; N means `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/core-namespace.builders.ts`; P means `libs/backend/workspace-intelligence/src/diagnostics/language-aware-diagnostics-provider.ts`.

## Five logic questions

### 1. How does this fail silently?

F:809 accepts any string as a census enum. With an unrecognized value and zero counts, coverageReasons returns no qualifying reason and F:832 permits a bare clean response. This requires an out-of-contract provider/payload, not an output seen from the current providers; see M1. Normal unknown, omitted, unchecked, syntax-only and no-coverage cases stay qualified.

### 2. What user action produces unexpected behaviour?

Receiving a diagnostics failure with a very long reason can remove its language-coverage disclosure after budgeting, because F:532 places the unbounded reason ahead of coverage. The answer remains explicitly unavailable and has a truncation/spool notice, but the stated guarantee that qualifiers survive the cut does not hold; see M2.

### 3. What input data produces a wrong answer?

`census:'unavailable'` with otherwise clean fields produces `No issues found` (M1). A typed `checks:'mixed'` coverage with omitted approximations produces `Coverage: qualified — .` plus a compact clean block (M3), giving no explanation of which checking limitation applies. The current language-aware provider supplies syntax approximation names, so this second case is a defensive compatibility gap.

### 4. What happens when a dependency fails or returns the wrong shape?

An unavailable provider result retains reason, coverage and notChecked through N:239–247. No coverage becomes provider-defined/unknown at N:295–309. Formatter exceptions fall back to raw JSON at F:588, but semantically invalid enum strings pass its shallow guard (M1). Budgeting still runs the real preformatted cut, with spooling, rather than a content reducer (`tool-result-budget.ts:88`).

### 5. What is missing that the requirements never mentioned?

The fallback validator needs an explicit policy for invalid runtime coverage and mixed metadata without language names. The e2e suite correctly tests forwarding, but does not test an over-budget unavailable reason or malformed coverage. These are targeted additions, not a reason to replace the scripted parser with actual grammars in this integration suite.

## Numbered findings

### 1. M1 — Moderate: unknown census enum passes the clean-answer gate

- **File:** `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts:809`; decision at :832.
- **Trigger:** `formatDiagnostics` receives available/empty diagnostics and a coverage object with `supportedLanguages:['typescript']`, `census:'unavailable'`, analyzed:null, unchecked/failed/unsupported/unrecognised/nonSource/omittedByCap all 0, excluded:null and checks:'type-check'.
- **Symptom:** The actual formatter prints `Errors: 0 | Warnings: 0 — No issues found.` and `Coverage: clean`, although the census is not complete.
- **Cause:** asCoverage checks only string/array shape. The shared coverageReasons helper assumes its typed enum contract and tests unknown/truncated explicitly; it is not a runtime validator. The formatter turns an invalid enum into a positive assertion.
- **Impact/severity:** Moderate boundary-hardening defect: reproducible silent false clean for malformed provider/legacy input, but no current production provider was found emitting that enum. Do not interpret this as a reproduced normal VS Code/Electron answer.
- **Recommendation:** Validate closed coverage enums and counts before using typed helpers; malformed coverage should become unknown/not reported, never a clean assertion. At minimum positively require census === complete before allowing bare output, and fail closed on unknown state/check kinds. Add runtime malformed-payload cases.

### 2. M2 — Moderate: unavailable reason can push all coverage qualifiers out of the budget

- **File:** `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts:532` (coverage follows at :534).
- **Trigger:** An unavailable payload carries an approximately 19,500-character reason and unknown census. Reasons are not bounded here; a real upstream path forwards compiler exception messages in `libs/backend/workspace-intelligence/src/diagnostics/type-script-diagnostics-provider.ts:424–425`.
- **Symptom:** Actual formatDiagnostics plus applyToolResultBudget for ptah_get_diagnostics returns a truncated 7,940-character answer with neither `**Coverage:**` nor `census unknown`. Raw formatted text contained both. Source/Unavailable remains visible, so this is lost disclosure, not a false clean.
- **Impact/severity:** Moderate: unusually verbose failure output violates qualifier-survival acceptance. The ordinary long-result e2e covers a large diagnostics list, not this preceding free-text reason.
- **Recommendation:** Render a bounded status/source followed by coverage before the detailed reason, or bound/move the reason below the coverage block. Add an unavailable-arm test through the real budget, requiring census/check qualifiers to remain visible.

### 3. M3 — Moderate: mixed check without approximation names renders an empty qualifier

- **File:** `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts:908`, rendered at :936.
- **Trigger:** Otherwise clean coverage has checks:'mixed' and no approximations (the field is optional). This can arise from a provider returning only check-kind metadata.
- **Symptom:** Output says `not a clean answer` followed by `**Coverage:** qualified — .` and a compact `{clean:true,analyzed:null}` block. No syntax-only/type-check limitation is named.
- **Cause:** typeCheckOnly rejects mixed, but approximationTexts only enters its syntax explanation branch for syntax-only or a syntax-only approximation. A mixed check with no names has neither.
- **Impact/severity:** Moderate observability/compatibility gap; the current 25a provider includes names, so its normal mixed result is unaffected. It still avoids a bare clean, but fails the qualifier-naming requirement for this metadata shape.
- **Recommendation:** Always explain checks:'mixed', using an honest fallback such as 'some files syntax-only; language detail not reported' when names are absent. Keep missing-language detail qualified and test this exact shape.

## Blocking issues

None established on the current providers' expected payloads.

## Serious issues

None established.

## Moderate and minor issues

M1–M3 above. No style/naming findings are included.

## Carried R4-M1 status

RESOLVED. P:480 records the root generation and :481 rolls over beyond 256 entries. advanceGlobalGeneration at :487–490 clears completed censuses and historical records while advancing the global generation to the current monotonic invalidation counter. This value exceeds the generations held by existing readers. Pending walks remain shared; settlement and final-answer fences still compare their original generations.

Independent 10,000-root invalidation probe now leaves 234 records instead of 10,000, with zero pending/completed entries. Global invalidate clears the remainder. Original settlement and held-TS probes still return unknown after invalidation. New Spec:1117 asserts the bound after every invalidation; Spec:1134 holds TS across rollover and asserts old coverage unknown, then a fresh census counts Python. The bounds spec fails on the prior source; the fence case is correctly identified as a preservation/naive-eviction mutation test rather than a fails-before claim.

## Data flow and integration assessment

1. `DiagnosticsPayload` requires coverage and permits notChecked (`types.ts:205–220`) — supports both statuses.
2. N:226 invokes the provider with the resolved scope; N:233 keeps its coverage or supplies provider-defined unknown. N:244 and :273 forward coverage on unavailable and available arms; notChecked rides alongside both. Severity filtering only removes diagnostics (N:253), not coverage.
3. Namespace normalization is an acceptable location for absent coverage: the platform-core contract permits absence as provider-defined, and all current diagnostic tool methods use this builder. It also conservatively qualifies other providers that omit coverage. It does not infer actual VS Code language capabilities.
4. Dispatcher selects getErrors/getWarnings/getAll and passes the payload to formatDiagnostics (`protocol-dispatcher.ts:950–970`).
5. F:815 derives the verdict from coverage fields, rather than trusting a supplied clean flag. F:828 separately names syntax approximations, preventing clean syntax-only counts from being misrepresented as type checking.
6. F:689 places coverage ahead of diagnostic lists; F:709–724 keeps requested diagnostic entries ahead of siblings. Existing severity/file ordering within those groups is retained; the change does not introduce argument-order sorting. Requested entries remain uncapped by the formatter; a final tool-budget cut can still truncate a sufficiently large request, as before.
7. Diagnostics stay preformatted (`tool-result-budget.ts:88`): real budgeting cuts/spools but does not generically reorder/reduce their contents. M2 qualifies the blanket claim that coverage placement always survives.

## E2e and changed expectations

The scripted syntax parser is acceptable for the stated forwarding test. `diagnostics-coverage.e2e.spec.ts` uses the real LanguageAwareDiagnosticsProvider, namespace, dispatcher, formatter and tool-result budget. Its fake inner TS provider is explicitly required by the plan; controlled parser output tests both non-empty syntax and clean syntax cases. Disk-backed fixture discovery is real but does not implement glob excludes/limits, so this suite does not prove grammar accuracy or discovery bounds. Those remain 25a/provider/adapter responsibilities.

The seven e2e cases exercise empty mixed and TS-only workspaces, non-empty mixed scope, clean Python scope, severity filtering with unsupported files, budget-cut long results, and requested-before-sibling behavior. The long-result test checks actual reduction/cut trailer and qualifier survival. That is genuine integration evidence for those boundaries, with the unavailable-long-reason gap recorded separately.

Changing the old no-coverage/legacy empty expectation is intentional: absence of diagnostics says nothing about which languages were checked. Qualifying that answer follows the new contract. The plain TS clean fixture still verifies the retained bare-clean behavior.

Author FB evidence is plausible: forwarding/qualification tests would fail without the payload fields and formatter changes. The temporary ts-jest diagnostics:false setting described for the old-source run allows runtime assertions despite old types; it is not evidence for old-source type safety. I did not perform source substitutions or independently reproduce the base run. The Batch 1 order preservation and rollover fence tests are correctly not described as failing on base.

## Requirements fulfilment

| Requirement | Status | Evidence / gap |
| --- | --- | --- |
| Coverage/notChecked both arms | COMPLETE | N:233–245, :273–274; builder cases for every severity and unavailable. |
| Bare clean only for complete type-check coverage | COMPLETE for expected provider outputs; boundary gap | Normal matrix passes; malformed enum M1. |
| Syntax-only, unknown, omitted, unchecked qualified | COMPLETE in expected outputs | Formatter cases and independent probe. |
| Qualifiers name limitation | PARTIAL | Mixed with missing approximation names: M3. |
| Qualifiers survive budget | PARTIAL | Available list survives; long unavailable reason: M2. |
| Preformatted and Batch 1 ordering | COMPLETE | Budget hint unchanged; formatter and e2e preservation cases. |
| VS Code provider-defined unknown | COMPLETE | Namespace fallback on both arms. |
| Real forwarding chain e2e | COMPLETE for listed cases | Scripted parser does not bypass forwarding or budgeting. |
| R4-M1 retention and generation fence | COMPLETE | Bound/rollover implementation plus probes and specs. |

## Edge cases

| Case | Outcome |
| --- | --- |
| Legacy empty array / absent coverage | Qualified, coverage not reported. |
| Unknown census / omittedByCap | Qualified with named reason. |
| Clean syntax-only | Qualified, not type-checked explicitly stated. |
| Normal mixed metadata | Qualified, languages named. |
| Mixed without approximations | Empty qualifier, M3. |
| Invalid census enum with zero counts | False bare clean, M1; out-of-contract input. |
| Long unavailable reason | Status survives; coverage does not, M2. |
| 10,000 distinct invalidated roots | Bounded records, no old census revived. |

## Verification

Personally ran once:

```powershell
node_modules/.bin/nx run-many '-t=test,lint,typecheck' -p '@ptah-extension/vscode-lm-tools' '@ptah-extension/workspace-intelligence' --skip-nx-cache
```

NX_ISOLATE_PLUGINS=false; NX_DAEMON=false. Header confirms exactly two projects. All six targets passed in 1m42s. One completion check; no suites rerun. Log: `%TEMP%/task559-25b-r1-checks.log`.

Scoped ptah_get_diagnostics on formatter and namespace: TypeScript compiler, zero errors/warnings.

Independent current-source probes:

```powershell
node "$env:TEMP/task559-25b-r1-format-probe.cjs"
node "$env:TEMP/task559-25a-r4-retention-probe.cjs"
node "$env:TEMP/task559-25a-r3-settlement-probe.cjs"
```

The format probe uses the actual formatter, compact coverage helpers, token reducers and applyToolResultBudget loaded from disk, with a real mkdtemp spool root. Initial loader attempts had incorrect surface-module paths and failed before probing; after locating surface-catalog.ts the probe ran successfully. No budget function was stubbed. Outputs directly establish M1–M3 and the normal qualification controls. Rollover/probe outcomes are recorded above.

No source/spec edits, git operations, cross-platform runtime checks, or independent validate-deps/degradation-audit runs this round. Author reports those broader checks; they are not presented as reviewer-run evidence.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for tested normal integration and rollover; MEDIUM for malformed/oversized provider payload handling.
- Score: 7/10
- Top risk: formatter runtime validation can turn an invalid census enum into a clean assertion; current providers do not emit that shape.
- What a robust implementation would add: fail-closed coverage validation, a mixed-kind fallback qualifier, and an unavailable-arm budget test with coverage placed before arbitrary-length detail.
