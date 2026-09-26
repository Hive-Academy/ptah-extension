# Code Logic Review — `TASK_2026_408`

Verdict: APPROVED
Score: 8/10
Scope: Batch 1 (Phase 1 part 1), reviewed in D:/projects/ptah-extension-task-408.

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 1 |
| Failure modes found | 1 |

All four assigned files were read in full: responses-error-mapping.ts, responses-error-mapping.spec.ts, responses-stream-collector.ts, responses-stream-collector.spec.ts, under libs/backend/auth-providers/src/lib/translation/. Locations below use that directory unless stated otherwise. Reviewed context.md, Batch 1 requirements and relevant implementation-plan components, the shared usage/error helpers and the proxy collector caller. No task-description.md or applicable AGENTS.md was found. The existing style review covers Batches 7/8, outside this review.

The evidence supports the sound 7–8 band: explicit terminal mapping, bounded regex scanning, synthesized messages, real rejection assertions and cleanup coverage. It does not support 9–10 because malformed argument types bypass the shared precedence rule, and cross-path integration remains Batch 2 work. The remaining defect changes error classification on malformed upstream data; it does not turn failure into successful tool execution.

Verification: scoped `npx nx run-many -t test,typecheck -p @ptah-extension/auth-providers --outputStyle=static` succeeded: 50 suites, 1,051 tests and 2 snapshots passed; typecheck passed. Nx reported one of two targets cached and an Nx Cloud organization warning after successful targets. `ptah_get_diagnostics` was unavailable because the requested worktree is outside its workspace root; the scoped typecheck is the fallback. Direct, in-memory transpilation probes exercised the actual classifier and collector without writing source or test files. No live provider checks were performed. No git operations were performed under the reviewer role restriction; this is a full-current-file review, not a baseline-diff audit.

## Five logic questions

### 1. How does this fail silently?

No newly introduced success-looking failure was demonstrated in scope. Failed/error frames throw at responses-stream-collector.ts:174 and :179; successful resolution requires a terminal snapshot and clean framing at :236. Incomplete arguments are checked before content building at :237. The malformed-type exception described in finding 1 still rejects.

### 2. What user action produces unexpected behaviour?

A request whose provider returns content_filter or max_output_tokens with null/object/numeric tool arguments receives a generic invalid-response error rather than the promised incomplete-input mapping (responses-stream-collector.ts:40, :186). Ordinary valid incomplete output maps to refusal/max_tokens through responses-error-mapping.ts:242.

### 3. What input data produces a wrong answer?

Finding 1 produces the wrong error classification, not a fabricated answer. HTTP overflow recognition is restricted to 400/413 and the five plan-approved patterns (responses-error-mapping.ts:65, :171). Generic TPM wording is not a pattern and has a real negative assertion at responses-error-mapping.spec.ts:105. Substring matching can still recognize quoted/negated overflow text; this is residual uncertainty in the explicitly approved pattern policy, not an implementation deviation.

### 4. What happens when a dependency fails?

Malformed JSON/schema failures reject as invalid_response (responses-stream-collector.ts:221). Upstream error/abort/premature close and downstream disconnect reject and clean listeners (:143, :151, :261). Observer exceptions reject separately (:245). The existing proxy catch accepts the same ResponsesStreamError class and call signature, but discards its mapping until Batch 2 (translation-proxy-base.ts:754, :764, :766).

### 5. What is missing that the requirements never mentioned?

No additional release-blocking implicit requirement was established. The contract should explicitly decide whether malformed non-string arguments are normalized as incomplete input or rejected by the structural schema (finding 1). The classifier's never-throws claim holds for the stated HTTP string input and JSON-derived values: JSON.parse is caught, string checks precede regex work, and parsed counts are safe positive integers (responses-error-mapping.ts:106, :110, :116, :173). Arbitrary accessor-bearing JavaScript objects are not a wire input exercised here.

## Failure modes

### 1. Non-string incomplete arguments bypass terminal precedence — Moderate, non-blocking

- Trigger: response.incomplete with reason content_filter/max_output_tokens and a function_call whose arguments is null, an object or a number.
- Symptom: ResponsesStreamError has code invalid_response and no mapping, instead of upstream_incomplete with the shared 502 mapping.
- Evidence: responses-stream-collector.ts:40 requires an optional string; :186 parses before terminalStopReason at :237. The shared predicate deliberately rejects all non-strings at responses-error-mapping.ts:154.
- Current handling: schema rejection becomes invalid_response at responses-stream-collector.ts:222. Both paths reject; neither fabricates tool input.
- Reproduction: actual collector probes with arguments null, {}, and 42 each returned `{code:'invalid_response'}`. Omitted arguments and the truncated string `{"x":` returned upstream_incomplete with the expected mapping.
- Recommendation: preserve raw argument values through incomplete classification, then validate completed/content output strictly; alternatively, perform the narrow incomplete-argument check before strict output parsing. Add null/object/number rows under both incomplete reasons. Keep completed non-string arguments rejected.

## Blocking issues

None established.

## Serious issues

None established.

## Moderate and minor issues

1. Moderate, non-blocking: incomplete argument-type precedence gap, responses-stream-collector.ts:40 and :186. The current tests cover non-string arguments only for completed at responses-stream-collector.spec.ts:107; the incomplete matrix at :181 uses strings.
2. Non-blocking integration dependency, not an additional Batch 1 defect: translation-proxy-base.ts:766 still sends 502 api_error and prefixes upstream_failed. Batch 2 must honor mapping.status/type/message before Phase 1 can be considered complete. Batch 1 approval does not waive this requirement.

## Data flow

1. HTTP status/body → JSON parse → candidate text extraction: OK; statuses gated, malformed JSON returns undefined (responses-error-mapping.ts:171).
2. Candidate text → bounded pattern scan → synthesized overflow message: OK; scanned strings capped at 16 KiB, no nested exponential regex quantifiers, positive safe integer validation (:74, :79, :110, :146). JSON parsing itself remains proportional to body size; the scanner cap is not a body cap.
3. Responses error code/message → overflow/rate-limit/request/generic mapping: OK; upstream message text is never copied, allowed codes are validated (:193). Tests assert exact messages and sentinel exclusion (responses-error-mapping.spec.ts:120, :168).
4. SSE chunks → persistent frame state → JSON event: OK; multiline data joins with newline, held CR handles split CRLF (responses-stream-collector.ts:135, :165, :215).
5. Failed/error dispatch → classified rejection: OK; top-level fields win via nullish fallback, bare frames reject (:174, :179).
6. Incomplete snapshot → schema → terminal precedence → content: GAP for non-string arguments before precedence (:186, :237). Valid/truncated string paths work.
7. Content → usage → observer → cleanup → resolve: OK for examined paths; no usage observer on terminal errors (:237, :248). Existing cache accounting delegates to the same helper.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| HTTP overflow only on 400/413; malformed body safe | COMPLETE | responses-error-mapping.ts:167 |
| Synthesized messages, sanitized codes, parsed integers | COMPLETE | responses-error-mapping.ts:106, :116, :146 |
| CLI predicate and numeric gap format | COMPLETE | responses-error-mapping.spec.ts:20, :87, :96 |
| Responses error mapping table | COMPLETE | responses-error-mapping.ts:193 |
| Incomplete tool input takes precedence for any reason | PARTIAL | Non-string inputs fail earlier structural validation |
| Max-output/refusal/other terminal outcomes | COMPLETE | responses-error-mapping.ts:237 |
| Standalone/nested/bare failures | COMPLETE | responses-stream-collector.spec.ts:209, :221, :234 |
| Split/multiline/byte/CRLF framing | COMPLETE | responses-stream-collector.spec.ts:265 |
| Existing callers remain callable | COMPLETE | translation-proxy-base.ts:754; mapping plumbing deferred |
| Three-path parity | PARTIAL | Intentionally deferred to Batch 2; collector-only matrix at responses-stream-collector.spec.ts:196 |

Implicit requirements not addressed: no additional ones established beyond the malformed-type policy above.

Executor deviations: (1) unknown error fields are acceptable because classification narrows them (responses-stream-collector.ts:54; responses-error-mapping.ts:106). (2) A separate failed schema correctly permits missing output (:56, :180). (3) The tools object and cause discriminator correctly carry stop/legacy-code information (responses-error-mapping.ts:223; responses-stream-collector.ts:115). (4) Removing the builder's incomplete branch is valid for arguments reaching the classifier (:237 before :238), subject to finding 1. (5) Nullish reason mapping is explicitly covered (responses-error-mapping.spec.ts:213). (6) Collector-only parity is acceptable for this batch, with cross-path evidence still due in Batch 2.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Empty/non-JSON HTTP body | YES | Caught parse, undefined | None observed |
| Generic TPM wording | YES | No generic token-count pattern | Policy remains assumption-based |
| Very large error text | YES | Regex scan capped at 16 KiB | Later overflow wording intentionally missed |
| Missing/bare failed event | YES | Generic classified error | No success fallback |
| Truncated/omitted incomplete args | YES | Shared incomplete mapping | Tested and directly probed |
| Null/object/numeric incomplete args | NO | Generic structural rejection | Finding 1 |
| Multiple calls, one truncated | YES | some() checks every supplied argument | responses-error-mapping.ts:237 |
| Split UTF-8/CRLF/multiline | YES | Decoder and retained frame state | Real assertions in collector spec |
| Premature EOF/disconnect | YES | Reject, destroy, cleanup | No live socket fault injection |
| Duplicate terminal | YES | Rejects duplicate snapshot | responses-stream-collector.ts:185 |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for Batch 1 unit behavior; no claim of completed Phase 1 integration.
- Top risk: Batch 2 must wire the already-produced mappings into HTTP/SSE responses consistently.
- What a robust implementation would add: normalize incomplete argument-type handling, cover those malformed types in the matrix, and complete the scheduled three-path parity tests.

Artifact naming: the reviewer role contract requires code-logic-review.md. The requested code-logic-review-b1.md was not written because that conflicts with the role's output restriction.
