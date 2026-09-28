# Code Logic Review — `TASK_2026_408`

Verdict: APPROVED
Score: 8/10

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Minor issues | 1 |
| Failure modes found | 0 |

Scope: Batch 3 only, in `D:\projects\ptah-extension-task-408`. Read all four reviewed files in full, plus the complete request translator. Requirements came from `context.md`, `task.md`, implementation-plan component 5, and `batches.md:157`. No `task-description.md`, exact `code-style-review.md`, or applicable AGENTS.md/CLAUDE.md was present in this worktree. The user-provided repository guidance applies. Production wiring and streaming/JSON reverse mapping belong to Batch 4 (`batches.md:191`); their absence is not a Batch 3 defect. No source edits or git operations were performed.

All code locations below are relative to `libs/backend/auth-providers/src/lib/translation/` unless otherwise stated.

## Five logic questions

### 1. How does this fail silently?

No supported silent failure found in the reviewed change. Distinct originals sharing an alias throw at `responses-tool-names.ts:65`; an alias matching a valid original throws after both collections have been scanned at `responses-tool-names.ts:83`. Thus tool order and history-only membership cannot silently redirect reverse lookup. The collector catches resolver exceptions before resolving content or publishing usage (`responses-stream-collector.ts:248`, `responses-stream-collector.ts:250`).

### 2. What user action produces unexpected behaviour?

Removing a tool between turns still leaves its historical calls eligible for aliasing and reverse lookup (`responses-tool-names.ts:75`; regression at `responses-tool-names.spec.ts:125`). Choosing a valid tool name equal to another tool's alias rejects the request, as required, in either order (`responses-tool-names.spec.ts:167`). Repeating the same invalid original reuses its entry rather than throwing (`responses-tool-names.ts:58`). No unexpected action-dependent behaviour found.

### 3. What input data produces a wrong answer?

No wrong mapping found for string inputs. Empty strings, 64 valid characters, 65 valid characters, Unicode, emoji at the truncation boundary, and lone surrogates obey the specified algorithm (`responses-tool-names.ts:19`, `responses-tool-names.ts:39`). The non-Unicode replacement regex operates on UTF-16 code units: an emoji becomes two underscores before slicing. Different lone surrogates can hash identically after UTF-8 replacement; their identical aliases are rejected together at `responses-tool-names.ts:65`, rather than producing an ambiguous reverse map. Unknown upstream names deliberately pass through (`responses-tool-names.ts:89`).

### 4. What happens when a dependency fails?

The guard has no asynchronous dependency or retained global state; `createHash` errors propagate synchronously (`responses-tool-names.ts:41`). The injected resolver runs inside the collector's translation try/catch; a thrown exception rejects as `invalid_response`, destroys upstream, and removes listeners (`responses-stream-collector.ts:153`, `responses-stream-collector.ts:161`, `responses-stream-collector.ts:250`). Existing stream error, abort, close and downstream-cancel handlers still reject (`responses-stream-collector.ts:271`). The hook adds no timers or subscriptions. Timeout policy belongs to the surrounding proxy and was not changed or revalidated by this batch.

### 5. What is missing that the requirements never mentioned?

No additional name-bearing field is currently emitted: `OpenAIResponsesRequest` has tools and input, and the translator constructs an explicit body without `tool_choice` (`responses-request-translator.ts:104`, `responses-request-translator.ts:147`). Consequently there is no current tool-choice rewrite gap. If that field is later introduced, named selections will need the same mapping. The internal guard relies on the typed translator contract; validation of malformed, non-string tool names is outside this post-pass (`responses-request-translator.ts:59`, `responses-request-translator.ts:90`).

## Failure modes

No functional failure mode supported by the evidence was found in Batch 3. Examined alias construction, collisions in both directions and both collections, history-only names, duplicate names, absent tools, request-local reverse maps, mutation, replay pairing, collector name ingress, resolver failure propagation, and default-parameter compatibility.

Verification:

- `npx --no-install nx run-many -t test -p @ptah-extension/auth-providers --outputStyle=static` exited 0 and reported the project's test target successful; Jest reported all suites ran, in 14.639 seconds. The retained tail did not contain suite/test counts, so no exact counts are claimed. Nx Cloud separately printed an organization-disabled/401 warning; it did not fail the test target. No live-provider checks were run.
- An in-memory TypeScript transpilation of the actual guard passed 10 edge-name round trips, checking exact alias, reverse lookup, history rewrite and unchanged input. Cases included empty, 64/65 ASCII, accented Unicode, emoji, a surrogate-pair prefix boundary, two lone surrogates, a trailing newline, and `__proto__`. Three additional history-only collision probes passed, including both valid-original orderings and a real lone-surrogate alias collision. No probe files were written.
- `ptah_get_diagnostics`, scoped to the two production files, returned unavailable: requested files were outside its workspace root. This is not a clean diagnostics result. No separate typecheck or lint result is claimed.

Remaining uncertainty: the Unicode/boundary probes are not persistent regression tests, and this batch does not establish end-to-end production wiring.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

1. **Minor — persist exact boundary and Unicode regression cases.** `responses-tool-names.spec.ts:78` tests 80 valid characters, while `responses-tool-names.spec.ts:85` tests 64. The alias suite does not pin exactly 65, emoji/UTF-16 replacement and slicing, or lone-surrogate collision behaviour. Impact: a future regex Unicode-flag or truncation change could break the contract without these committed tests catching it. Current implementation passed the independent probes above. Add table-driven cases with explicit expected prefix lengths and reverse lookup, plus the actual lone-surrogate collision pair. This is a coverage suggestion, not a current runtime defect.

## Data flow

1. **OK:** Typed translator emits definitions and historical calls with original names (`responses-request-translator.ts:258`, `responses-request-translator.ts:365`).
2. **OK:** Per-request maps memoize originals, retain valid names, and hash each distinct invalid name once (`responses-tool-names.ts:54`, `responses-tool-names.ts:57`).
3. **OK:** Tools and every historical function call share that mapper; unchanged entries are shared and renamed entries are copied (`responses-tool-names.ts:71`, `responses-tool-names.ts:75`). No IDs, arguments, results or ordering change.
4. **OK:** The final collision pass includes originals encountered anywhere in tools/history before the request escapes (`responses-tool-names.ts:83`). Complexity is linear in entries plus processed name characters, with request-local memory.
5. **OK:** Reverse lookup closes over the request-local alias map; unknown names pass through, including empty-string originals via nullish coalescing (`responses-tool-names.ts:89`).
6. **OK:** The collector accepts an optional identity-default resolver (`responses-stream-collector.ts:142`). Its terminal snapshot is the content source; every output function call reaches the single resolver invocation (`responses-stream-collector.ts:106`, `responses-stream-collector.ts:98`). Both accepted completed and incomplete snapshots use that path (`responses-stream-collector.ts:247`). No delta-based name bypass exists in the collector.

## Requirements fulfilment

| Requirement | Status | Evidence / gap |
| --- | --- | --- |
| Valid names unchanged and request deep-equal | COMPLETE | `responses-tool-names.ts:60`; frozen strict-equality regression at `responses-tool-names.spec.ts:85` |
| Exact deterministic compliant alias | COMPLETE | `responses-tool-names.ts:39`; edge probes passed |
| Rewrite definitions and all historical calls | COMPLETE | `responses-tool-names.ts:71`, `responses-tool-names.ts:75` |
| Pure, linear processing | COMPLETE | Local maps, copied changed entries at `responses-tool-names.ts:54`, `responses-tool-names.ts:71` |
| Reverse map per request; unknown passes through | COMPLETE | `responses-tool-names.ts:89`; isolation regression at `responses-tool-names.spec.ts:144` |
| Reject ambiguous aliases including valid/history names | COMPLETE | `responses-tool-names.ts:65`, `responses-tool-names.ts:83` |
| Collector optional resolver and unchanged default | COMPLETE | `responses-stream-collector.ts:98`, `responses-stream-collector.ts:142`; regressions at `responses-stream-collector.spec.ts:337`, `responses-stream-collector.spec.ts:350` |
| Preserve replay pairing and order | COMPLETE | `responses-tool-names.spec.ts:218` |

Implicit requirements not addressed: none necessary for this batch. Batch 4 retains responsibility for HTTP 400 collision mapping and production resolver threading (`.ptah/specs/TASK_2026_408/batches.md:191`).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Empty name | YES | Hash suffix ensures nonempty alias; reverse map preserves empty original (`responses-tool-names.ts:42`, `responses-tool-names.ts:89`) | Probe passed |
| Exactly 64 / 65 valid characters | YES | Regex boundary / 53-character prefix plus suffix (`responses-tool-names.ts:19`, `responses-tool-names.ts:42`) | Finding 1 |
| Unicode, emoji, lone surrogates | YES | Code-unit replacement, UTF-8 hash, collision rejection (`responses-tool-names.ts:40`, `responses-tool-names.ts:65`) | Finding 1 |
| No tools, history-only names | YES | Optional tools and independent input pass (`responses-tool-names.ts:71`, `responses-tool-names.ts:75`) | Covered by unit tests |
| Duplicate names / concurrent requests | YES | Memoized within call; no shared maps (`responses-tool-names.ts:54`, `responses-tool-names.ts:58`) | No session growth |
| Alias equals valid original | YES | Post-pass detects either order, including history (`responses-tool-names.ts:83`) | Throws as required |
| Resolver throws | YES | Rejects before usage/success and cleans up (`responses-stream-collector.ts:250`) | Does not preserve arbitrary resolver error details |
| Resolver omitted | YES | Identity default (`responses-stream-collector.ts:142`) | Existing callers remain compatible |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for the Batch 3 module and collector hook; no production-wiring claim.
- Top risk: future Unicode/truncation regressions are not pinned by committed cases (`responses-tool-names.spec.ts:78`).
- What a robust implementation would add: the persistent edge cases in finding 1 and a resolver-throw cleanup regression beside `responses-stream-collector.spec.ts:327`.
- Score rationale: 8/10 reflects correct data flow, explicit collision rejection, request isolation, mutation protection and passing scoped tests. No observed functional gap justifies the 5–6 band; missing durable edge regressions and unavailable diagnostics prevent an exemplary 9–10 assessment.
