# Code Logic Review — `TASK_2026_538_3ccf`

Verdict: NEEDS_REVISION

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 5/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 1 |
| Serious issues | 1 |
| Moderate issues | 2 |
| Failure modes found | 4 |

Scope: Batch 4 only. Read all four production files and all five named specs in full, the four Batch 1 dependencies, the supplied plan sections, Batch 4 and its carried items, the executor report, context, and Requirements 3–6. Also inspected the v1 validation/schema pattern. Production/spec citations below resolve under `libs/shared/src/mcp-apps-contracts/`; requirements and plan citations resolve under `.ptah/specs/TASK_2026_538_3ccf/`. No repository AGENTS.md/CLAUDE.md or task code-style-review.md was found. No production source was edited. No git command or build was run.

Evidence: scoped `ptah_get_diagnostics` returned zero errors/warnings. The authorized Jest command, with PowerShell `Select-Object -Last 30` replacing `tail -30`, passed **7 suites / 250 tests**. It emitted a Node module-loading warning but completed successfully. An in-memory TypeScript loader exercised the actual production functions without writing a test or build artifact; it reproduced findings 1–3 and the diagnostic behavior in finding 4. The marker search found no TODO/PLACEHOLDER/STUB in the surface files; full reads found no empty production bodies or mock logic.

The score is 5 rather than 7 because passing tests miss a silent selection change and an accepted but unwritable input. It is above the 3–4 band because the Q4 decision logic, normal patch operations, binding compatibility, request limits, and recursive-schema protection are implemented and exercised (`surface-concurrency.spec.ts:106`, `surface-patch.spec.ts:87`, `surface-bindings.spec.ts:82`, `surface-budgets.spec.ts:117`, `surface-validator.spec.ts:99`). Severity labels below map BLOCKER to Blocking, MAJOR to Serious, and MINOR to Moderate.

## Five logic questions

### 1. How does this fail silently?

A selection set on a newly added subtree can survive that subtree's removal and silently select a different row under a reused component id. The function looks only at the initial and final ancestor chains, losing the ancestry when selection was set (`surface-patch.ts:245`, `surface-patch.ts:407`). Finding 1 reproduces an `ok:true` result selecting Grace after selecting Ada.

### 2. What user action produces unexpected behaviour?

Entering any value into an accepted text input bound at `a.b.c.d.e.f.g` fails. The empty form validates, but storing the value requires seven object levels against a six-level model limit (`surface.validator.ts:333`, `surface-catalog.ts:98`, `surface-catalog.ts:100`, `surface-data-model.ts:239`). See finding 2. No UI integration was reviewed; this reproduces the underlying create-document/write behavior.

### 3. What input data produces a wrong answer?

The well-typed mixed state-op sequence in finding 1 produces the wrong selected data, even though the final document validates (`surface-patch.ts:285`, `surface-patch.ts:407`). Shared-path inputs and ancestor overlaps otherwise receive the specified compatibility decisions (`surface-bindings.ts:160`, `surface-bindings.ts:178`). Non-finite values are rejected through the boundary in the tested stat/chart/model/write positions (`surface-validator.spec.ts:337`).

### 4. What happens when a dependency fails?

An ordinary `Error` from the injected byte counter is converted to rejection (`surface-validator.spec.ts:567`). An arbitrary thrown object need not be string-convertible: the catch handler can itself throw (`surface.validator.ts:399`, finding 3). These modules have no network, process, timer, or disposal lifecycle; their dependency failure boundary is synchronous byte counting/schema/property access (`surface.validator.ts:415`, `surface-patch.ts:234`). Timeout, cancellation and host commit atomicity remain outside this batch.

### 5. What is missing that the requirements never mentioned?

The binding's maximum usable depth must be consistent with the model's representable depth, even when the model is empty (finding 2). Selection invalidation must retain intermediate ancestry, not just endpoint ancestry (finding 1). The stated bounded walk does not provide a constant upper bound on all work before rejection: wide object key enumeration and full JSON serialization still depend on the supplied payload size (`surface.validator.ts:260`, `surface.validator.ts:431`). See the explicit judgments below.

## Failure modes

1. **Transient ancestor removal retains selection:** a valid mixed state-op list returns success with an old index pointing to different data. Evidence and correction are in BLOCKER finding 1.
2. **Unwritable missing binding:** an empty document passes but its declared input can never store even a scalar value without exceeding model depth. Evidence and correction are in MAJOR finding 2.
3. **Exception while formatting an exception:** the validator throws instead of returning its rejection union when the thrown value cannot be coerced. Evidence and correction are in MINOR finding 3.
4. **Deep unwalked fields lose budget/path diagnostics:** malformed nesting reaches the byte counter and returns a generic rejection. Evidence and recommendation are in MINOR finding 4.

## Blocking issues

### 1. BLOCKER — Selection can silently move to different data through a temporary ancestor

- File: `surface-patch.ts:407` (endpoint-only ancestor set), `surface-patch.ts:418` (invalidation test), `surface-patch.ts:420` (final range check).
- Trigger/scenario: Start with a valid surface containing a stat and no selection. Apply these four `SurfaceStateOp`s in one list:
  1. Add stack `temporary`, containing table `t` with row `['Ada']`.
  2. Set selection to table `t`, row index 0.
  3. Remove component `temporary`.
  4. Add table `t` at the root with row `['Grace']`.
- Symptom/impact: Actual result is `ok:true`, selection `{ componentId:'t', target:{kind:'table-row',rowIndex:0} }`, and rows `[['Grace']]`. The resulting document also passes `validateSurfaceDocument`. A consumer reads a selection the user never made, violating Req 5.9 (`task-description.md:216`). Blocking severity reflects silent wrong-data selection; this is a mixed internal/wire state-op case, **not** a claim that an agent can author `set-selection` through the MCP patch schema (`surface.types.ts:229`, `surface.schemas.ts:497`).
- Current handling: `set-selection` is validated against the intermediate content (`surface-patch.ts:247`), but that content's ancestor chain is discarded. `revalidateSelection` skips ops before the last selection and reconstructs ancestry only from `prev` and `next` (`surface-patch.ts:403`). Neither endpoint contains ancestor `temporary`; checking that the new index exists cannot detect changed row identity.
- Fix/recommendation: Track/invalidate selection as each structure op applies, using the pre-op tree, and let a later explicit `set-selection` establish a new selection. Alternatively retain the selection-time tree and replay ancestry-changing ops. Add the four-op regression, plus replacement of the transient ancestor, and assert selection becomes null unless explicitly set again afterward.

## Serious issues

### 2. MAJOR — Accepted missing bindings can exceed the depth at which values are storable

- File: `surface.validator.ts:333` and `surface.validator.ts:336`; related constraints at `surface-catalog.ts:98`, `surface-catalog.ts:100`, `surface-data-model.ts:139`, `surface-data-model.ts:239`.
- Trigger/scenario: Validate a document with one text input whose path is `a.b.c.d.e.f.g`, and omit `dataModel`. Seven segments pass the eight-segment path budget. The same occurs with eight segments.
- Symptom/impact: Actual `validateSurfaceDocument` result is `ok:true` (193 document bytes, 2 model bytes). Applying `{op:'set-data',path:'a.b.c.d.e.f.g',value:'Ada'}` then returns `{ok:false,reason:'Data exceeds maxDataModelDepth 6.'}`. Such an input cannot be filled; making it required produces a form that cannot be completed without redefining its binding.
- Current handling: `boundPathBreach` returns success as soon as a parent is absent, checking existing values but not whether the path can ever hold the input's scalar empty/non-empty value. The root model counts as a container, so a scalar at N path segments requires N object levels. This is a semantic gap introduced at the new validator boundary, arising from existing Batch 1 budget choices.
- Fix/recommendation: Reject input bindings whose segment count exceeds the usable model container depth, naming the input, path and `maxDataModelDepth`; preserve empty drafts for representable missing paths. Do not change the already-reviewed general path grammar merely to patch this semantic check. Test a six-segment missing binding that can be written and seven/eight-segment bindings that fail document validation.

## Moderate and minor issues

### 3. MINOR — The validator's catch handler can throw

- File: `surface.validator.ts:399`, called outside protection at `surface.validator.ts:471` and `surface.validator.ts:547`.
- Trigger: Inject a byte counter that executes `throw Object.create(null)`; a throwing property accessor could supply the same thrown value.
- Symptom/impact: Both public validators throw `TypeError: Cannot convert object to primitive value` rather than `{ok:false}`. This breaks the explicitly documented never-throws contract (`surface.validator.ts:5`) for an unusual dependency/in-process failure. This is not a remote JSON code-execution claim.
- Current handling: `String(error)` and the `error.message` read are assumed safe inside the error formatter. The latter can also be a throwing accessor on an Error instance. Existing coverage throws ordinary Error/RangeError only (`surface-validator.spec.ts:567`, `surface-validator.spec.ts:578`).
- Fix/recommendation: Start with a constant safe detail and guard all exception inspection/coercion separately; return the fallback if inspection fails. Add regression assertions that both entry points return rejection for non-coercible thrown values.

### 4. MINOR — Deep nesting outside the walked keys loses the promised actionable diagnostic

- File: `surface.validator.ts:211`, `surface.validator.ts:294`, `surface.validator.ts:313`, `surface.validator.ts:320`, `surface.validator.ts:404`.
- Trigger: Attach a 10,000-level `{a:...}` value under an unknown document key, or under malformed `params`/`rows`.
- Symptom/impact: Reproduced rejection is `surface could not be validated: Maximum call stack size exceeded. ... Send a flat value.` It identifies neither the offending path nor a named depth budget, making correction harder. No schema parse is reached when the counter throws.
- Current handling: Only component `children`, envelope `dataModel`, and op `component`/`value` are prewalked. JSON.stringify recurses over everything else and the normal RangeError is caught.
- Recommendation: Add a bounded generic raw-JSON preflight or safe iterative byte-counting path if uniform depth diagnostics are required for all raw keys. Keep the dedicated component/model budgets. This diagnostic gap alone is non-blocking for this batch: the carried recursive-component requirement is satisfied, and the malformed fields fail closed. It is distinct from finding 3, which actually escapes the rejection union.

## Explicit judgments on points 1–4

### 1. Walking before byte counting

**Accept the order change, with a resource-bound qualification.** Raw op count comes first (`surface.validator.ts:423`); roots/children are checked before expansion (`surface.validator.ts:283`, `surface.validator.ts:213`); total tree visits stop at the component cap (`surface.validator.ts:209`); data depth, array width and visited-value count stop further traversal (`surface.validator.ts:242`, `surface.validator.ts:246`, `surface.validator.ts:249`). This protects the recursive schema and produces the required named depth rejection in the supplied 10,000-level cases (`surface-validator.spec.ts:122`). Bytes still precede schema parsing (`surface.validator.ts:431`, `surface.validator.ts:453`).

**Yes, input-size-dependent work remains before byte rejection.** `Object.keys(record)` materializes every key before checking the 100-key cap (`surface.validator.ts:260`); a huge shallow object is not bounded by the visit counter. The byte counter also serializes the full raw request, including huge strings and wide unknown fields, before its result can be compared (`surface.validator.ts:431`). The walk's node cap is therefore not a bound on total CPU/allocation. For ordinary parsed JSON this is linear extra work, not evidence of super-linear traversal introduced by the ordering deviation; the existing byte-count API already requires processing the payload. Do not claim a strict bounded-resource guarantee without a verified transport raw-byte cap or early-aborting measurement. Transport behavior was outside this review.

### 2. Must the walk be generic?

**Not mandatory for recursive-schema safety; desirable for uniform diagnostics and a stronger raw-input resource contract.** All schema-recursive component and model axes are covered (`surface.schemas.ts:187`, `surface.schemas.ts:426`, `surface.validator.ts:197`, `surface.validator.ts:230`). Other schema fields are fixed-shape, and ordinary deep JSON there fails closed during byte counting. The residual diagnostic defect is finding 4, accepted as non-blocking. The blanket statement that *every* 10,000-level raw payload names a budget is false; the tested component/data cases do name one.

### 3. Mutation descriptor instead of footprint

**Accept. Every Q4 row is represented.** The descriptor preserves the actor/operation distinction a footprint alone cannot express (`surface-concurrency.ts:53`). Agent and submit require exact current base (`surface-concurrency.ts:175`); v1 proposal is the explicit unconditional exception (`surface-concurrency.ts:170`); UI change checks structure/wildcard/overlap (`surface-concurrency.ts:132`); UI selection checks structure/selection (`surface-concurrency.ts:145`). Missing/non-integer/future bases and retained-history floors are handled (`surface-concurrency.ts:171`, `surface-concurrency.ts:179`). The algorithm assumes the documented complete, ordered internal log invariant (`surface-concurrency.ts:43`); it does not repair a corrupt/incomplete caller-supplied log.

The accepted revision **is not computed in Batch 4**: `checkSurfaceConflict` returns only permission and explicitly assigns `current + 1` to its caller (`surface-concurrency.ts:160`); `SurfacePatchState` excludes revision (`surface-patch.ts:23`). Thus there is no `base + 1` bug here, but end-to-end current+1 is unverified and must be asserted in the store batch.

### 4. Executor semantic choices versus Requirements 3–6

| Choice | Judgment and evidence |
| --- | --- |
| set-title replaces the header | Compatible: the op carries title and optional description; requirements do not prescribe omission-as-retain. Behavior is explicit and tested (`surface-patch.ts:201`, `surface-patch.spec.ts:189`). Document it in tool descriptions. |
| Out-of-range insertion index rejected | Compatible; avoids silently choosing another insertion position (`surface-patch.ts:170`). |
| Empty select/radio is null, not empty string | Compatible with Req 3.6's one documented empty value; catalog specifies null and options exclude empty strings (`surface-catalog.ts:60`, `surface.schemas.ts:265`, `surface-bindings.ts:223`). |
| Required text trims before emptiness check | Compatible with required semantics; original value is retained, not silently trimmed (`surface-bindings.ts:268`, `surface-bindings.ts:320`). |
| Empty optional text ignores minLength | Reasonable documented optional-field semantics; non-empty text still enforces the hint (`surface-bindings.ts:270`, `surface-bindings.spec.ts:245`). No explicit requirement says optional emptiness must fail. |
| Mixed categories recorded as structure | Conservative, safe over-conflict (`surface-concurrency.ts:75`, `surface-concurrency.ts:97`). Legal agent patch ops mix structure/data only, so Q4 is unchanged there (`surface.types.ts:131`). Mixed data/selection internal lists can reject more pending UI changes than a composite footprint would; keep this documented. |
| Data-ref-backed component cannot be selected by index | Compatible with host-side verification in Req 7.5: the inline data needed to validate the index is absent (`surface-patch.ts:337`, `task-description.md:290`). No contradiction with Req 3–6. Supporting referenced-row selection later needs host-resolved data/identity. |

None of these choices itself warrants revision. Findings 1 and 2 are additional behavioral defects, not objections to these documented choices.

## Data flow

1. **Raw MCP input → op count / iterative walks:** OK for enumerated recursive axes; raw width/unknown-depth qualifications above (`surface.validator.ts:421`).
2. **Request bytes → versions → schema:** OK for normal JSON; all-or-nothing rejection precedes application. Error formatting has finding 3 (`surface.validator.ts:431`, `surface.validator.ts:453`, `surface.validator.ts:470`).
3. **Parsed document → ids / bindings / stored drafts / submit scopes:** Existing-value checks are correct; absent deep bindings escape feasibility checking (finding 2, `surface.validator.ts:348`, `surface.validator.ts:383`).
4. **Validated operation + stored state → conflict decision:** OK assuming complete internal log; host owns atomic commit and current+1 (`surface-concurrency.ts:43`, `surface-concurrency.ts:164`).
5. **Ops → copy-on-write state:** Normal structure/data edits preserve input and return failures atomically (`surface-patch.ts:140`, `surface-patch.ts:273`, `surface-data-model.ts:175`). Selection needs intermediate-state handling (finding 1).
6. **Candidate → document validation → host commit/log/push:** Full-result validation is provided, but invoking it and allocating the next revision belong to later batches (`surface.validator.ts:510`, `surface-patch.ts:7`). Batch 4 cannot establish the entire host transaction.
7. **Submit scope → draft and hint checks → values:** OK for validated inputs; required/length/option errors name paths and collect all issues (`surface-bindings.ts:297`, `surface-bindings.ts:374`).

## Requirements fulfilment

| Requirement | Status | Evidence / gap |
| --- | --- | --- |
| Q4 agent/UI asymmetry, exact submit, future rejection | COMPLETE | `surface-concurrency.ts:170`, `surface-concurrency.ts:175`, `surface-concurrency.ts:186`; table tests at `surface-concurrency.spec.ts:106`. |
| Accepted commit uses current+1 | PARTIAL | Correctly delegated but not executed/tested here; `surface-concurrency.ts:160`. Store verification required. |
| 32-entry log, 16-path wildcard, stale below floor | COMPLETE | `surface-concurrency.ts:114`, `surface-concurrency.ts:121`, `surface-concurrency.ts:179`; limits/+1 at `surface-concurrency.spec.ts:65`. |
| Req 3.7 shared/overlapping bindings | COMPLETE | `surface-bindings.ts:160`, `surface-bindings.ts:178`. |
| Req 3.6 drafts versus submit | COMPLETE | `surface-bindings.ts:201`, `surface-bindings.ts:258`; test evidence at `surface-bindings.spec.ts:159`. |
| Missing bindings usable as empty inputs | PARTIAL | Missing values read as empty; unrepresentable paths accepted, finding 2. |
| Req 5.3 missing ids named | COMPLETE | `surface-patch.ts:148`, `surface-patch.ts:161`, `surface-patch.ts:187`; rejection tests at `surface-patch.spec.ts:136`. |
| Req 5.9 clear selection, never remap | PARTIAL | Ordinary replace/remove/out-of-range covered (`surface-patch.spec.ts:295`); transient ancestry fails, finding 1. |
| Cancelling patch rejected on original bytes/count | COMPLETE | `surface.validator.ts:423`, `surface.validator.ts:431`; actual large-value/count tests at `surface-budgets.spec.ts:510`. |
| Req 1.3 named version mismatch / Req 1.4 v1 select rejection | COMPLETE | `surface.validator.ts:130`, `surface.validator.ts:151`; `surface-budgets.spec.ts:554`. |
| R12 prototype-pollution protection | COMPLETE for reviewed paths | Denied paths and nested keys rejected before writes/parsing (`surface-data-model.ts:49`, `surface-data-model.ts:155`, `surface.schemas.ts:448`); patch test at `surface-patch.spec.ts:214`. |
| Non-finite rejection | COMPLETE | Boundary tests at `surface-validator.spec.ts:337` cover all carried positions; schema numbers reject non-finite values. |
| 10,000-level recursion protection before schema parse | COMPLETE for component/data axes | Spies and named-budget assertions at `surface-validator.spec.ts:155`, `surface-validator.spec.ts:173`, `surface-validator.spec.ts:197`; arbitrary other keys have finding 4. |
| Pure functions preserve input / never throw | PARTIAL | Copy-on-write verified; validator exception formatting violates never-throws (finding 3). Typed traversal/binding helpers assume validated inputs (`surface-bindings.ts:4`); they are not additional unknown-input validators. |

Implicit requirements not addressed: representable missing binding paths; selection identity across intermediate trees; safely formatting arbitrary thrown values. Host integration, RPC byte budgets and commit ordering remain deliberately outside Batch 4 (`surface-budgets.spec.ts:7`, `surface-patch.ts:7`).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Empty required draft / absent representable path | YES | `surface-bindings.ts:205`, `surface.validator.ts:335` | Required enforced at submit. |
| Absent seven/eight-segment binding | NO | Initial document succeeds | Finding 2. |
| Same-type shared / prefix-only sibling paths | YES | `surface-bindings.ts:160`, `surface-data-model.ts:109` | Segment comparison prevents false ancestor matches. |
| Remove-missing / denied path | YES | `surface-data-model.ts:176`, `surface-data-model.ts:219` | No pollution or partial input mutation. |
| Selection ancestor removed during mixed list | NO | Endpoint-only ancestry | Finding 1. |
| Old disjoint UI base / old disjoint agent base | YES | `surface-concurrency.spec.ts:107` | Accept UI, reject agent. |
| Floor overflow / future base | YES | `surface-concurrency.spec.ts:77`, `surface-concurrency.spec.ts:176` | Fail closed subject to internal log invariant. |
| Huge cancelling request | YES | `surface-budgets.spec.ts:510` | Measured before application. |
| Deep known recursive field | YES | `surface-validator.spec.ts:122` | Named rejection, no schema parse. |
| Deep unknown field | NO for named diagnostics | Normal RangeError caught | Finding 4; rejection still safe. |
| Byte counter throws non-coercible value | NO | Catch handler throws again | Finding 3. |
| Repeated/concurrent host commits or process exit between writes | Not verified | Shared functions have no host transaction | Store/ledger review required; no claim of end-to-end atomicity. |

## Verdict

- Recommendation: **REVISE**.
- Confidence: **HIGH** for the reproduced function-level defects; host reachability of mixed state-op sequences was not reviewed.
- Top risk: A successful state-op application can retain a selection pointing to data that was never selected (`surface-patch.ts:407`).
- What a robust implementation would add: per-op selection invalidation with intermediate ancestry, binding-depth feasibility validation, exception-safe rejection formatting, and regression tests for those three cases. Keep the generic raw-JSON diagnostics/resource improvement as a separately identified follow-up rather than claiming the current walk covers every payload key.


---

# Re-review after Revision 1

Verdict: NEEDS_REVISION

# Code Logic Review — `TASK_2026_538_3ccf`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 1 |
| Moderate issues | 1 |
| Failure modes found | 2 remaining, introduced in Revision 1 |

Scope: Revision 1 of Batch 4, using the earlier review in `code-logic-review-batch-4.md` as the baseline. Re-read both changed production files in full, examined the new/changed spec blocks, and checked the concurrency and draft/submit paths against the previously reviewed implementation. Production/spec citations below are relative to `libs/shared/src/mcp-apps-contracts/`. Reviewed the executor's Revision 1 report at `.ptah/specs/TASK_2026_538_3ccf/batch-4-report.md:358`. No source files were modified, and no git commands or builds were run.

The four original defects have been corrected for their original reproductions. However, the generic preflight introduces uncapped expansion before its visit limit, and the standalone selection revalidator introduces order-sensitive equality. Score 6 rather than 7–8 reflects these two demonstrated gaps; it is above the earlier 5 because the wrong-data selection and unusable-binding defects are repaired. MAJOR below maps to Serious, MINOR to Moderate.

Verification:

- Scoped `ptah_get_diagnostics` for the two changed production files: zero errors and warnings.
- Authorized surface Jest command, using PowerShell `Select-Object -Last 30`: **7 suites / 265 tests passed**. The output also reported a Node module-loading warning and a worker that failed to exit gracefully and was force-exited. The latter was not attributed to these changes; no further suite was run to diagnose it.
- An in-memory TypeScript loader invoked the actual production functions for all reproductions below, without writing source, tests or build artifacts.
- No TODO/PLACEHOLDER/STUB marker was found in the surface files. The changed production functions contain implemented logic.

## Prior numbered findings — closure evidence

| Prior finding | Status | Fix and independently checked result |
| --- | --- | --- |
| 1. BLOCKER — transient ancestor selection | CLOSED | `surface-patch.ts:231` checks the pre-op ancestor chain; `surface-patch.ts:308` invalidates before each structure operation. The original four ops — add stack containing Ada, select table row 0, remove stack, add root table with Grace — now return `ok:true, selection:null`. Input remained unchanged. Standalone revalidation of a forged surviving selection also returned null (`surface-patch.ts:438`). A later explicit selection is retained. Regression specs: `surface-patch.spec.ts:419`, `surface-patch.spec.ts:437`, `surface-patch.spec.ts:453`. |
| 2. MAJOR — seven/eight-segment bindings | CLOSED | `surface.validator.ts:401` checks binding feasibility before the missing-parent early return. Both seven- and eight-segment missing bindings are rejected by document and create validation, naming input, path and `maxDataModelDepth`. A six-segment missing binding validates, accepts a scalar write through `applySurfaceOps`, and validates afterward. Specs: `surface-validator.spec.ts:622`, `surface-validator.spec.ts:636`; budget distinction retained at `surface-budgets.spec.ts:287` and `surface-budgets.spec.ts:303`. |
| 3. MINOR — catch formatter throws | CLOSED | `safeErrorDetail` starts from a constant, performs Error/proxy/message inspection inside try/catch, and never coerces arbitrary objects (`surface.validator.ts:484`). Both validators returned rejection for a null-prototype thrown object, an Error with a throwing message accessor, and a proxy with a throwing prototype trap. Specs: `surface-validator.spec.ts:655`. |
| 4. MINOR — deep unknown fields lose named diagnostic | CLOSED for original diagnostic failure; replacement has new finding 5 | `findRawDepthBreach` now traverses raw fields iteratively and rejects container depth above `SURFACE_MAX_RAW_JSON_DEPTH` (`surface.validator.ts:344`, `surface.validator.ts:351`). A 10,000-level unknown field in a document and create request returned the named budget with zero byte-counter calls and zero schema-parse calls. Coverage also exercises action params and rows (`surface-validator.spec.ts:726`). Its queue expansion is not bounded by the visit counter; see finding 5. |

## Five logic questions

### 1. How does this fail silently?

The new standalone selection comparison clears a valid unchanged selection solely because object properties were inserted in another order (`surface-patch.ts:416`). It returns null without distinguishing representation order from an actual selection change. This is finding 6. The original silent switch from Ada to Grace is closed by per-op invalidation (`surface-patch.ts:308`).

### 2. What user action produces unexpected behaviour?

A caller that reconstructs or schema-parses `next.selection` can lose the existing selection during revalidation despite identical target fields and unchanged table data (`surface-patch.ts:419`, `surface-patch.ts:442`). The reproduction uses valid table-row targets; it does not depend on malformed input. Host/renderer reachability was not investigated in this delta review.

### 3. What input data produces a wrong answer?

Equivalent targets `{rowIndex:0,kind:'table-row'}` and `{kind:'table-row',rowIndex:0}` produce a false inequality and null selection (finding 6). Seven/eight-segment bindings now correctly reject, while a six-segment binding remains writable (`surface.validator.ts:401`).

### 4. What happens when a dependency fails?

The byte-counter exception cases from the original review now safely produce `{ok:false}` (`surface.validator.ts:484`, `surface.validator.ts:566`, `surface.validator.ts:644`). The new raw preflight can allocate and read a whole huge collection before reaching either the byte counter or its own visit rejection (`surface.validator.ts:372`, finding 5). Ordinary catch protection does not establish protection against process memory exhaustion. No actual process exhaustion was induced.

### 5. What is missing that the requirements never mentioned?

The visit budget must account for scheduled traversal work, not just popped entries, and selection equality must compare semantic fields independently of JSON key order (`surface.validator.ts:364`, `surface.validator.ts:372`, `surface-patch.ts:419`). Both are introduced by the fixes. The prior limits around unverified transport byte caps and host commit allocation remain outside this review.

## Failure modes

### Unbounded pending traversal work

- Trigger: A wide array/object under an unknown key, `rows`, or another field not rejected by the dedicated component/data walks.
- Symptom: Entire collection is read and queued before the generic preflight checks its budget again.
- Evidence: `surface.validator.ts:365`, `surface.validator.ts:372`, `surface.validator.ts:381`.
- Current handling: The cap limits stack pops, not child reads or enqueued entries.
- Recommendation: Bound expansion before reading/queuing children; details in finding 5.

### Order-sensitive selection equality

- Trigger: Same valid target values, different object property insertion order.
- Symptom: Standalone revalidation clears an unchanged selection.
- Evidence: `surface-patch.ts:419`, `surface-patch.ts:442`.
- Current handling: JSON serialization is used as semantic equality.
- Recommendation: Compare the discriminant and its defined indices explicitly; details in finding 6.

## Blocking issues

None established in this revision. The original wrong-data selection reproduction is repaired at `surface-patch.ts:308` and confirmed by `surface-patch.spec.ts:419` plus independent execution.

## Serious issues

### 5. MAJOR — The generic walk expands an entire collection before enforcing its cap

- File: `surface.validator.ts:372` and `surface.validator.ts:381`; the visit check is at `surface.validator.ts:365`.
- Scenario: Send a request with a large dense numeric array under `extra` (or malformed table rows). The dedicated walks ignore that field. The generic walk pops the array, then `forEach` reads every item and allocates a stack entry and path string for each item. It checks the visit limit only after finishing that whole expansion. The object branch similarly queues every property.
- Reproduced evidence: A proxy used only to count numeric reads wrapped an ordinary dense array of **614,400 zeroes**. `validateSurfaceUpdateInput({operation:'delete',surfaceId:'s',baseRevision:1,extra:array}, counter)` read **614,400 elements** against a **307,200 visit cap**, before any counter call. It eventually returned the named `maxUpdateRequestBytes` rejection. The proxy changes observability, not the underlying dense-array expansion: normal parsed arrays follow the same `forEach` and `stack.push` path. No memory-exhaustion test was run.
- Impact: An oversized request can cause arbitrary pending queue/path allocations before rejection. In contrast to the already acknowledged full `Object.keys` enumeration and JSON serialization, this new code materializes an additional traversal record for every raw array element/property. A larger payload can stall or exhaust the host/renderer despite the advertised visit guard. No transport size cap was verified that would make this safe.
- Current handling: `visits` counts only entries popped from the stack. It does not bound array expansion or pending entries. The implementation is iterative and caps pops, but does **not** meet the requested bounded-preflight check.
- Fix: Check array length against the remaining total-work budget before iterating. Bound scheduled plus processed entries before pushing object/array children, or use bounded cursor frames that read children incrementally. After object key enumeration, reject excessive width before reading property values or creating per-property traversal records. Preserve named byte/depth diagnostics. Add wide-array and wide-object tests proving that values beyond the cap are not read/queued; retain deep and shared-subtree tests.

## Moderate and minor issues

### 6. MINOR — Equal selections are treated as different when target keys are reordered

- File: `surface-patch.ts:416`, specifically `surface-patch.ts:419`, consumed at `surface-patch.ts:442`.
- Scenario: `prev.selection` points at table `t` using target `{rowIndex:0,kind:'table-row'}`. `next` has the same table and selection values, with target `{kind:'table-row',rowIndex:0}`. Call `revalidateSelection(prev,next,[])`.
- Reproduced result: `applySurfaceOps(prev,[])` keeps the selection; `revalidateSelection(prev,next,[])` returns **null**. Both targets are valid `SurfaceSelectionTarget` objects. This can occur when a consumer reconstructs/parses an otherwise unchanged state; it does not represent a row change.
- Impact: A valid selection disappears on a representation-only change. The new standalone helper disagrees with the apply helper even when data and selection identity are unchanged. This is an edge case in caller state construction; it does not revive the previous wrong-row bug.
- Current handling: `JSON.stringify` preserves insertion order, so string equality is stricter than equality of the target's kind and indices.
- Fix: Compare `componentId`, `target.kind`, and the relevant index fields in a discriminated switch (`rowIndex`, `itemIndex`, or `seriesIndex` plus `pointIndex`). Add reordered-key cases, including an unrelated data write, and a different-index negative control.

## Data flow

1. **Input → dedicated walks:** OK; existing component/model depth and width guards remain before parsing (`surface.validator.ts:517`, `surface.validator.ts:612`).
2. **Input → generic raw preflight:** Deep unknown-field diagnostic fixed; queue expansion not bounded (finding 5, `surface.validator.ts:351`). It contains no recursive calls.
3. **Bytes → versions → schema:** Existing order retained (`surface.validator.ts:526`, `surface.validator.ts:537`, `surface.validator.ts:548`). Exceptions are now safely formatted (`surface.validator.ts:484`).
4. **Parsed document → bindings/drafts:** Binding feasibility checked before reading absent parents; existing compatibility and draft checks retained (`surface.validator.ts:398`, `surface.validator.ts:450`).
5. **State + ops → next state:** Pre-op ancestry invalidates selection at the correct time, then post-op/final resolution checks run (`surface-patch.ts:308`, `surface-patch.ts:312`, `surface-patch.ts:315`). Input copying behavior is retained.
6. **Standalone revalidation → replay → equality:** Replay now captures intermediate ancestors correctly, but equality rejects reordered equivalent targets (finding 6, `surface-patch.ts:438`).
7. **Conflict and submit checks:** No regression observed in the reviewed paths or independent probes (`surface-concurrency.ts:175`, `surface-bindings.ts:258`). Host commit/revision allocation is not performed by this batch.

## Requirements fulfilment

| Requirement | Status | Gap / evidence |
| --- | --- | --- |
| Original four-op selection reproduction clears | COMPLETE | Independent replay returned null; `surface-patch.ts:308`, regression `surface-patch.spec.ts:419`. |
| Explicit new selection after replacement retained | COMPLETE | Independent execution and `surface-patch.spec.ts:453`. |
| Seven/eight-segment input binding rejected | COMPLETE | Both document/create reject with named depth; `surface.validator.ts:401`, `surface-validator.spec.ts:636`. |
| Six-segment missing binding is draft-valid and writable | COMPLETE | Actual write and resulting document passed; `surface-validator.spec.ts:622`. |
| Catch formatter never coerces arbitrary thrown objects | COMPLETE | Six hostile-counter executions rejected cleanly; `surface.validator.ts:484`. |
| Generic depth check iterative and names budget | COMPLETE | While/stack traversal and named 24-level cap; `surface.validator.ts:344`, `surface.validator.ts:361`, `surface.validator.ts:370`. Unknown-depth probes reached neither counter nor schema. |
| Generic preflight work bounded | PARTIAL | Pop count capped, expansion uncapped; finding 5. |
| Deepest valid component payload still accepted | COMPLETE | Existing new depth-8 chart tests passed for document/create/patch; `surface-validator.spec.ts:697`. |
| Q4 asymmetry / exact submit | COMPLETE within shared decision function | Independent probe: old-base agent false, disjoint UI true, old-base submit false. `surface-concurrency.ts:175`, `surface-concurrency.spec.ts:107`. |
| Draft versus submit | COMPLETE | Required empty/short strings accepted as drafts and rejected at submit; independent probe plus passing specs (`surface-bindings.ts:205`, `surface-bindings.ts:268`, `surface-bindings.spec.ts:159`). |
| Semantically equal selection retained | PARTIAL | New standalone equality depends on key order; finding 6. |

Implicit requirements not addressed: bounded pending traversal storage and order-independent target equality. End-to-end host atomicity, current+1 revision allocation, transport request caps, and the Jest worker shutdown warning are outside the established evidence for this delta.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Transient selected ancestor removed/replaced | YES | Pre-op ancestry (`surface-patch.ts:244`) | Original blocker closed. |
| Later explicit selection | YES | Ordered `set-selection` (`surface-patch.ts:269`) | Preserved after invalidation. |
| Same selection, reordered target keys | NO | Serialization comparison (`surface-patch.ts:419`) | Finding 6. |
| Six-segment binding with absent model | YES | Feasibility check permits it (`surface.validator.ts:401`) | Actual write validated. |
| Seven/eight-segment binding | YES | Named rejection before absent-parent success | Original major closed. |
| Non-coercible/hostile thrown value | YES | Guarded inspection (`surface.validator.ts:486`) | Original minor closed. |
| 10,000-level unknown field | YES | Generic depth limit before bytes (`surface.validator.ts:369`) | No schema/counter call in probes. |
| Very wide raw collection | NO for bounded expansion | Entire collection pushed (`surface.validator.ts:372`) | Finding 5. |
| Old disjoint UI vs agent base | YES | Actor-specific conflict rules (`surface-concurrency.ts:175`) | Probe and tests passed. |
| Empty/short required draft | YES | Draft accepts; submit rejects (`surface-bindings.ts:201`, `surface-bindings.ts:268`) | No regression. |

## Verdict

- Recommendation: **REVISE**.
- Confidence: **HIGH** for closure of the four original reproductions and the two new function-level findings. Caller reachability and transport limits were not re-reviewed.
- Top risk: The new generic preflight can create an unbounded pending traversal queue before its visit-limit rejection (`surface.validator.ts:372`).
- What a robust implementation would add: cap child expansion/pending work before reads and allocations, replace JSON serialization equality with field comparisons, and add targeted regressions for wide collections and reordered selection keys. Retain all Revision 1 regressions.


---

# Re-review after Revision 2

Verdict: APPROVED

# Code Logic Review — `TASK_2026_538_3ccf`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 0 remaining in the reviewed delta |

Final re-review of Batch 4, Revision 2. All six previously reported defects are closed in the exercised cases. No new reproducible defect was found in this delta. Production/spec citations below resolve under `libs/shared/src/mcp-apps-contracts/`.

Read both changed production files in full, the Revision 2 spec additions, the executor report's Revision 2 section, and the earlier review context. Rechecked earlier regression cases and the unchanged Q4/draft-submit paths. No source files were modified, no git commands or builds were run, and only this deliverable was written.

Verification:

- Scoped `ptah_get_diagnostics`: zero errors and warnings for the changed production files.
- Authorized surface Jest command, using PowerShell `Select-Object -Last 30`: **7 suites / 271 tests passed**.
- Independent execution of actual production functions through an in-memory TypeScript loader confirmed all six closures, Q4 asymmetry, draft versus submit, and preservation of the original state in the four-op reproduction. No test/build artifacts were written.
- Marker search found no TODO/PLACEHOLDER/STUB in the surface files; full production reads found no placeholder implementations.
- **NIT — verification observation:** Jest again emitted a Node module-loading warning and reported a worker that failed to exit gracefully and was force-exited. All tests passed. The cause was not investigated or attributed to this delta; this is not a new code finding.

Score 8 reflects repaired behavior, direct adversarial reproductions and regression coverage rather than only a passing suite. It is above 6–7 because no demonstrated logic gap remains in this delta, and below 9–10 because transport-wide resource guarantees and host commit integration were not verified, and the test-worker shutdown warning remains unexplained. Approval is for Batch 4's reviewed logic, not later store/RPC integration.

## Numbered findings — final disposition

### 1. BLOCKER (previous severity) — Transient ancestor selection: CLOSED

Evidence: `surface-patch.ts:231`, `surface-patch.ts:244`, `surface-patch.ts:308`, `surface-patch.ts:312`.

Re-ran the original four operations against the real function: add stack `temporary` containing table `t` with Ada; select row 0; remove `temporary`; add root table `t` containing Grace. Result: `ok:true`, **selection null**. Standalone revalidation of an attempted surviving selection also returned null (`surface-patch.ts:454`). A subsequent explicit `set-selection` retained the new selection. The input state's JSON was unchanged.

The pre-op ancestor check occurs at each structure operation, so ancestry that exists only between operations is no longer lost. Regression tests remain at `surface-patch.spec.ts:419`, `surface-patch.spec.ts:437`, and `surface-patch.spec.ts:453`.

### 2. MAJOR (previous severity) — Unwritable seven/eight-segment bindings: CLOSED

Evidence: `surface.validator.ts:410`, `surface.validator.ts:413`.

Re-ran document and create validation with absent models and paths of six, seven and eight segments. Seven/eight reject with `maxDataModelDepth`, input id and path named. Six passes, accepts a scalar write through `applySurfaceOps`, and passes resulting-document validation. The feasibility check still runs before the absent-parent early return at `surface.validator.ts:418`.

Regression evidence: `surface-validator.spec.ts:622`, `surface-validator.spec.ts:636`. This preserves representable empty drafts without changing the general eight-segment request-path grammar.

### 3. MINOR (previous severity) — Catch formatter can throw: CLOSED

Evidence: `surface.validator.ts:496`, `surface.validator.ts:498`, `surface.validator.ts:507`.

Both validators returned clean rejection for each of: a thrown null-prototype object, an Error with a throwing message accessor, and a proxy with a throwing prototype trap. All six executions completed without throwing and used the safe `unexpected error` fallback. Arbitrary thrown objects are not string-coerced; inspection remains guarded. Regression evidence: `surface-validator.spec.ts:655`.

### 4. MINOR (previous severity) — Deep unwalked fields lose named diagnostic: CLOSED

Evidence: `surface.validator.ts:344`, `surface.validator.ts:358`, `surface.validator.ts:375`, `surface.validator.ts:532`, `surface.validator.ts:625`.

An unknown field containing a 10,000-level object in both a document and create request was rejected with **SURFACE_MAX_RAW_JSON_DEPTH**, before either the byte counter or schema parse. Instrumented calls were zero for both. Known deep component and data-model inputs still name `maxTreeDepth` and `maxDataModelDepth`, respectively, also before counting/parsing.

The generic traversal uses an explicit stack and no recursive call. The depth-8 legal chart document/create/patch cases still pass (`surface-validator.spec.ts:697`); unknown fields, action params and rows have depth regressions at `surface-validator.spec.ts:726`.

### 5. SERIOUS (previous severity) — Pop cap did not bound child reads/enqueues: CLOSED

Evidence: `surface.validator.ts:369`, `surface.validator.ts:378`, `surface.validator.ts:391`.

The root consumes one scheduled slot. Arrays compare their length to the remaining budget and reserve those slots before reading any element. Objects charge each own key before reading its value and queuing it. The scheduled count is monotonic; popping an entry does not refund it. Consequently total scheduled traversal entries, and therefore pending entries, cannot exceed `maxValues` for ordinary JSON input. This addresses the specific new allocation amplification identified in Revision 1.

Re-ran the **614,400-element dense-array** reproduction, using a proxy to count numeric reads and a temporary, restored in-memory `Array.prototype.push` wrapper to count traversal enqueues. No source was changed. Actual result:

| Measurement | Result |
| --- | --- |
| Array element reads | **0** |
| Array child enqueues | **0** |
| Total generic scheduled entries, including root/envelope | **5** |
| Cap | **307,200** |
| Byte-counter calls | **0** |
| Rejection | `request.extra`, naming `maxUpdateRequestBytes` |

Also exercised a real object with 307,201 own numeric-valued properties under `extra`. It read/queued **307,195** property values; including the request root and its four fields, total scheduled work was **307,200**, exactly the cap. It rejected with the named budget and zero byte-counter calls. This verifies the shared budget is charged for both envelope and child entries rather than reset per container.

Regression tests exercise unknown-key arrays, table rows, wide objects and a legal 1,000-row table (`surface-validator.spec.ts:815`, `surface-validator.spec.ts:838`, `surface-validator.spec.ts:859`, `surface-validator.spec.ts:892`).

### 6. MODERATE (previous severity) — Selection equality depended on key order: CLOSED

Evidence: `surface-patch.ts:417`, `surface-patch.ts:424`, `surface-patch.ts:428`, `surface-patch.ts:458`.

The comparison now checks component id, target kind and the fields defined by that kind. No serialization is involved. Re-ran targets `{rowIndex:0,kind:'table-row'}` and `{kind:'table-row',rowIndex:0}`: standalone revalidation retained the provided next selection, both with no operations and after an unrelated data write. A different valid row index correctly returned null.

Regression tests also cover reordered chart-point fields and different-kind rejection (`surface-patch.spec.ts:528`, `surface-patch.spec.ts:549`). The switch compares both chart indices and fails closed on unknown kinds.

### 7. NIT — Scope of the resource guarantee

This is an observation, not an open defect: the fixed traversal bounds its own scheduled entries and child-value reads, but JavaScript key enumeration and full byte serialization can still cost input-sized work. That qualification is documented at `surface.validator.ts:30` and `surface.validator.ts:355`. No transport cap, malicious proxy execution-time bound, or whole-process memory guarantee is inferred from the local queue cap. The earlier accepted transport-level caveat remains unchanged.

## Five logic questions

### 1. How does this fail silently?

No remaining silent failure was reproduced in the delta. Intermediate ancestor changes clear selections (`surface-patch.ts:308`); semantically identical reordered targets now survive (`surface-patch.ts:417`). Both prior silent cases were re-executed, including a different-index negative control.

### 2. What user action produces unexpected behaviour?

None established in the reviewed fixes. Explicit reselection after invalidation works (`surface-patch.ts:269`), and an unrelated data write preserves a reordered but equivalent selection (`surface-patch.ts:454`). Six-segment inputs remain writable; impossible seven/eight-segment bindings are rejected before a form is accepted (`surface.validator.ts:413`). UI/store integration is outside this delta review.

### 3. What input data produces a wrong answer?

No new wrong-answer reproduction was found. Wide raw collections reject before over-budget expansion (`surface.validator.ts:379`, `surface.validator.ts:391`); changed target indices are distinct, while property order is irrelevant (`surface-patch.ts:424`). Existing legitimate width/depth boundary tests pass (`surface-validator.spec.ts:697`, `surface-validator.spec.ts:892`).

### 4. What happens when a dependency fails?

Byte-counter exceptions, including hostile thrown values, return a rejection with a safely bounded detail (`surface.validator.ts:496`, `surface.validator.ts:578`, `surface.validator.ts:656`). These functions have no network timeout/disposal lifecycle. No claims are made about arbitrary in-process proxy code terminating; the reviewed trust boundary principally receives JSON.

### 5. What is missing that the requirements never mentioned?

No additional blocking implicit requirement emerged in Revision 2. The new fixes now account for scheduled work and semantic selection equality. End-to-end raw-byte limits and atomic host revision allocation still require their owning integration reviews (`surface.validator.ts:30`, `surface-concurrency.ts:160`); they were not added to this batch's scope.

## Failure modes

No open failure mode established in the reviewed delta. The audit covered both current production files in full, all six historical reproductions, new spec assertions, independent wide-array/object instrumentation, selection negative controls, Q4 asymmetry and draft-submit distinctions. Residual uncertainty is confined to unreviewed host/transport integration and the unexplained test-worker shutdown warning, not a reproduced defect in these fixes.

## Blocking issues

None. The previous blocker is closed with pre-op selection invalidation and direct reproduction evidence (finding 1).

## Serious issues

None. The previous child-enqueue budget defect is closed with charge-before-read logic and measured counts (finding 5).

## Moderate and minor issues

No open defect. Finding 7 and the test-output note are NIT observations only; neither is counted as a failure mode.

## Data flow

1. **Raw input → dedicated component/data walks — OK:** existing semantic depth/width guards run first (`surface.validator.ts:529`, `surface.validator.ts:624`).
2. **Raw input → generic preflight — OK:** iterative traversal, bounded scheduled entries, named depth/byte rejection before child reads exceed the cap (`surface.validator.ts:358`).
3. **Preflight → byte count → versions → schema — OK:** order preserved; no parse/counter reached for reproduced excessive-depth cases (`surface.validator.ts:532`, `surface.validator.ts:538`, `surface.validator.ts:560`).
4. **Parsed document → bindings/drafts — OK:** path feasibility precedes missing-parent acceptance, and existing draft checks remain (`surface.validator.ts:413`, `surface.validator.ts:426`).
5. **State + operations → candidate state — OK:** selection invalidates against each pre-op tree, then resolution is checked; input copy-on-write behavior retained (`surface-patch.ts:308`, `surface-patch.ts:315`).
6. **Standalone selection revalidation → replay → field comparison — OK:** intermediate ancestry and semantic target identity agree (`surface-patch.ts:447`).
7. **Candidate → caller-owned validation/commit — outside delta:** host must validate the result and allocate current+1 (`surface-patch.ts:7`, `surface-concurrency.ts:160`). No end-to-end transaction approval is implied.

## Requirements fulfilment

| Requirement | Status | Evidence / practical limit |
| --- | --- | --- |
| Findings 1–4 remain closed | COMPLETE | Independent reproductions and closure evidence above. |
| 614,400-element reproduction bounded | COMPLETE | Zero element reads/enqueues; `surface.validator.ts:379`. |
| Wide-object reads/enqueues bounded | COMPLETE | Exactly 307,200 total scheduled entries at rejection; `surface.validator.ts:391`. |
| Reordered-target equality | COMPLETE | Retained under empty and unrelated-data ops; changed valid index rejected; `surface-patch.ts:417`. |
| Q4 asymmetry and exact submit | COMPLETE within shared logic | Independent old-base agent=false, disjoint UI=true, submit=false probe; existing table specs passed (`surface-concurrency.ts:175`, `surface-concurrency.spec.ts:107`). |
| Draft versus submit | COMPLETE | Empty/short required strings accepted as drafts, rejected on submit; valid text accepted (`surface-bindings.ts:201`, `surface-bindings.ts:268`). |
| Named depth budgets before schema | COMPLETE | Raw/component/model names preserved with zero schema/counter calls in probes (`surface.validator.ts:375`, `surface.validator.ts:212`, `surface.validator.ts:252`). |
| Safe error detail | COMPLETE | Six hostile-counter cases returned rejection; `surface.validator.ts:496`. |
| Valid depth/width boundaries | COMPLETE | Depth-8 chart and 1,000-row table tests pass (`surface-validator.spec.ts:697`, `surface-validator.spec.ts:892`). |

Implicit requirements not addressed by this batch: transport-wide resource ceilings and host commit atomicity/current+1 allocation. These remain integration responsibilities, not new Revision 2 findings.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Transient selected ancestor removed/replaced | YES | Pre-op ancestor test (`surface-patch.ts:244`) | Prior regression tests and direct removal reproduction pass. |
| Explicit reselection after removal | YES | Later op establishes selection (`surface-patch.ts:269`) | No observed regression. |
| Equivalent reordered selection / different valid index | YES | Kind-specific comparison (`surface-patch.ts:424`) | Both positive and negative probes pass. |
| Seven/eight-segment absent binding | YES | Named feasibility rejection (`surface.validator.ts:413`) | Six segments still writable. |
| Hostile thrown object | YES | Constant fallback, guarded inspection (`surface.validator.ts:496`) | No coercion escape observed. |
| 10,000-level raw/component/model input | YES | Iterative prechecks with named budgets | Schema/counter not called in probes. |
| Huge array / wide object | YES for local scheduling bound | Budget charged before reads (`surface.validator.ts:379`, `surface.validator.ts:391`) | Engine enumeration/transport limits remain separate. |
| Old-base disjoint agent versus UI write | YES | Actor-specific conflict rule (`surface-concurrency.ts:175`) | Direct probe and existing tests pass. |
| Required empty/short draft | YES | Draft accepted, submit rejected (`surface-bindings.ts:268`) | No observed regression. |

## Verdict

- Recommendation: **APPROVE** Batch 4 after Revision 2.
- Confidence: **HIGH** for the reviewed function-level fixes and historical reproductions.
- Top residual risk: callers still must enforce host commit and transport constraints outside these shared functions (`surface-patch.ts:7`, `surface.validator.ts:30`).
- What a robust implementation would add: no further source change is required for the reviewed findings. Preserve these regressions in downstream integration checks; investigate the test-worker shutdown warning separately if it persists.
