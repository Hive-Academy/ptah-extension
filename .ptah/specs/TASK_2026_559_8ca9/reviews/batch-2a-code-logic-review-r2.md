# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

| Metric | Value |
| --- | --- |
| Round | 2 of 2 |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 2 |
| Failure modes found | 2 |

Final-round recommendation: **REVISE**. The original examples are fixed, but a requested prose boundary still fails and the new fence handling introduces a reproducible Markdown regression. The implementation works on the common fixtures; these routing gaps keep it below the 7–8 band. There is no evidence of corruption or a broadly broken implementation warranting the 3–4 band.

Scope: read the entire current content-detector.ts and content-detector.spec.ts and the revised selection/round-1 rulings in batches.md:230-239,290-306. Other Batch 2a files retain the round-1 review conclusions and were not re-reviewed as changed files. Only this deliverable was modified. Paths below are relative to libs/backend/tool-output-reducers/src/lib unless explicitly qualified.

## Round-1 finding status

| Finding | Status | Evidence and judgment |
| --- | --- | --- |
| D1: prose → log | PARTIALLY FIXED | The former case-insensitive anywhere-word match is replaced by structural candidates at content-detector.ts:35-48. All three prose fixtures at content-detector.spec.ts:115-120 now return text. However, line-start uppercase prose still returns log through :42; see defect 1. |
| D2: commented source → Markdown | ORIGINAL DEFECT FIXED; REGRESSION FOUND | The exclusion at content-detector.ts:131-135 applies before both heading rules and correctly recognizes both Python fixtures at spec :131-135; the shebang fixture at :138-140 avoids Markdown. The fence scanner used by that exclusion mishandles valid nested examples; see defect 2. |
| D3: JSON scalars → text | CLOSED BY CONTRACT DECISION | batches.md:230-231,301-304 explicitly selects text for scalars. content-detector.ts:91-103 and spec :76-83 agree. This is no longer a defect. |

The regression specs would catch the old implementation: the three prose fixtures at spec :115-120 previously matched bare error words; the two Python fixtures at :131-135 previously matched the first heading; the shebang fixture at :138-140 previously matched its two comment headings. Those six assertions necessarily fail against the round-1 bodies read in the preceding review. Additionally, the Traceback/ValueError fixture at :126 has none of the old marker shapes and previously returned text, accounting for the reported seventh failure. This is a source-based comparison, not a fresh checkout or execution of the historical code.

## Five logic questions

### 1. How does this fail silently?

Both defects return a valid but inappropriate kind without indicating uncertainty: log for prose (content-detector.ts:42,178) and code for fenced documentation (:134,154-155,78). The later reducer can therefore select the wrong treatment. This detector does not itself alter or lose text.

### 2. What user action produces unexpected behaviour?

Reading an unhinted document that demonstrates Markdown using an outer four-backtick fence routes the document to code (:154-155). Supplying a Markdown hint prevents this (:60-61), but fallback callers remain affected.

### 3. What input data produces a wrong answer?

`FAILED attempts are retried.\nThe next attempt uses a fresh connection.` returns log instead of text (:42). The complete valid fenced Markdown example in defect 2 returns code instead of Markdown (:134). Both were executed against the current transpiled source.

### 4. What happens when a dependency fails?

The changed detector has only a type import (:14); there is no new runtime dependency, asynchronous operation or resource to dispose. Malformed bracketed JSON still falls through after the caught parse failure (:104-109). No new exception-swallowing success path was found. Tokenizer/pipeline exception behavior is unchanged from round 1 and outside this delta.

### 5. What is missing that the requirements never mentioned?

The precise evidence separating an uppercase verdict word from uppercase prose remains underdefined (:42), despite the overarching ambiguity-to-text rule in batches.md:235-237. Fence tracking must retain delimiter character and opening length (:152-155); a boolean alone cannot determine whether a later fence closes the block. These are concrete gaps, not additional hypothetical findings.

## Failure modes / new numbered defects

### 1. Bare uppercase FAILED still classifies prose as a log — moderate

- File: content-detector.ts:42; immediate acceptance at content-detector.ts:178-179.
- Trigger / failing input: `FAILED attempts are retried.\nThe next attempt uses a fresh connection.` with no hint.
- Symptom: returns `log`, reproduced in a read-only execution of the current source.
- Expected behavior: `text`. This is ordinary explanatory prose with no runner result, diagnostic delimiter, location or timestamp. Under batches.md:235-237, ambiguous text must not receive a structure-specific kind.
- Current handling: an uppercase FAILED plus a word boundary is sufficient; subsequent prose is not examined. The amended explicit examples at batches.md:295 name ERROR/FAIL/FATAL, but the implementation additionally accepts FAILED, and the user's requested FAILED prose probe fails.
- Impact: the future pipeline applies log selection/deduplication rules to narrative output. Raw spooling and the verbatim-line requirement at batches.md:237-239 mitigate semantic rewriting and permanent loss, but do not make the selected reduction appropriate. No present source in this batch drops the prose.
- Fix: do not accept a bare FAILED prefix as sufficient structural evidence. Require a recognizable test-runner verdict shape or corroborating log structure; add this exact negative fixture alongside real FAIL/FAILED runner output. Audit the related bare level prefixes under the same precision rule without regressing known runner fixtures.

### 2. Fence toggling leaks nested Markdown examples into code detection — moderate

- File: content-detector.ts:23 and content-detector.ts:152-155; consumed at :134.
- Trigger / failing input (valid Markdown showing a fenced TypeScript example):

~~~~~text
# Guide
````markdown
```ts
import a from "a";
export const b = 1;
export function c() {}
```
````
~~~~~

- Symptom: returns `code`, reproduced against the current source. The round-1 first-heading rule returned Markdown for this input.
- Expected behavior: `markdown`. The three-backtick lines are literal content inside the outer four-backtick block. All three source lines remain fenced and must not participate in the non-heading code predicate.
- Current handling: any line beginning with three backticks or tildes toggles the same boolean, regardless of opening character, opening length or whether the candidate is a valid closing fence. The inner opening incorrectly switches fenced off, so the source lines enter kept and veto Markdown. isCode on the complete input then returns true (:78,163-167).
- Impact: documentation containing a valid source-code example is routed to the code reducer, bypassing the intended heading/section preservation. This is a regression introduced by the D2 fix. An analogous mismatch occurs when a different fence character is treated as a closing delimiter.
- Fix: track the opening delimiter character and run length; only close on the same character with a run at least as long and an otherwise valid closing line. Add this four-backtick fixture and a mixed-delimiter fixture, while keeping ordinary bash/TypeScript fences passing.

## Blocking issues

None found in the changed scope.

## Serious issues

None found in the changed scope. The demonstrated failures are content routing, with downstream fallback/spool protections specified but not implemented in these two files.

## Moderate and minor issues

Two moderate defects above; no additional numbered defects. The requested Windows stack-frame and regex probes did not substantiate a performance or path-handling defect.

## Non-blocking notes

- D3 is coherent with the approved reducer contract: object/array JSON is compactable; scalar JSON takes text cut/spool, and top-level null or empty-string values must not disappear through drop-empty processing (batches.md:301-304; content-detector.ts:91-103). An 8,001-character JSON string was independently classified as text; its fixture is at spec :81-83. Downstream cut/spool itself remains a later-batch obligation.
- Standard fences work: a Markdown document containing a bash block with `# Build` and `# Test`, a short-prose README with 100 TypeScript declaration lines inside a normal fence, and CHANGELOG headings `## [1.2.0]` / `## [1.1.0]` all returned Markdown. This exercises content-detector.ts:134-143 without the nested-fence defect.
- Representative Jest and Nx failure logs returned log; `Worker stopped\n    at x (D:\a\b.ts:1:2)` returned log through the parenthesized-location marker (:37). The Windows drive colon is accepted.
- Inspected every regex literal in the changed source and executed each against seven adversarial candidates, each capped at 65,536 characters: whitespace, letters, repeated colon/digit groups, repeated x-colon groups, incomplete HTML plus whitespace, incomplete stack location plus digits, and repeated hashes. The slowest measured single match was approximately 0.87 ms; the new stack patterns (:37-38) were below 0.4 ms. No exponential nested quantifier or demonstrated catastrophic backtracking was found. This finite probe is not proof against every possible input; full JSON parsing remains outside the sniff window as previously reviewed (:67,105).
- The two changed modules remain small pure-function/spec modules with no new imports, I/O or registration requirements (content-detector.ts:14,56-84). No new structural boundary issue was found. Round-1 acceptance of all four executor deviations stands. Budget-boundary validation and timing-test policy were explicitly deferred/settled at batches.md:305-306 and are not reopened.

## Data flow

1. Caller hint → immediate kind: OK, including an empty body (:60-61).
2. Normalize BOM/whitespace → empty text: OK (:63-65,87-89).
3. Validate only object/array JSON → JSON, otherwise continue: OK under the revised contract (:96-109).
4. Sample 64 KiB → HTML check: unchanged (:70-73).
5. Markdown check → exclude shebang or source outside fences: original D2 fixed, but fence-state gap in defect 2 (:131-155).
6. Code predicate → log predicates → text: deterministic order retained (:78-84); log acceptance still too broad for defect 1 (:42,178).
7. Return kind only: no content mutation, spooling or reduction is performed by this module (:56-84).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| D1 original prose cases no longer log | COMPLETE | spec :115-120; independently reproduced original case |
| Positive structural log evidence; ambiguity → text | PARTIAL | FAILED prose accepted; defect 1 |
| D2 source comments excluded from both heading rules | COMPLETE | detector :131-142; spec :131-140 |
| Ignore code inside Markdown fences when excluding Markdown | PARTIAL | Opening character/length not tracked; defect 2 |
| D3 scalars deliberately text | COMPLETE | detector :91-103; spec :76-83; revised batches.md:301-304 |
| Preserve ordinary Markdown/bash/long code examples/CHANGELOG | COMPLETE | Direct probes passed; detector :134-143 |
| Preserve Jest/Nx logs and Windows stack locations | COMPLETE | Direct probes passed; detector :37,42,178 |
| Scoped test/lint/typecheck | COMPLETE | All three targets reported success with cache skipped |

Implicit requirements not addressed: correct fence closure semantics and distinguishing standalone uppercase prose from a runner verdict.

## Edge cases

| Case | Handled | Evidence | Concern |
| --- | --- | --- | --- |
| Original lowercase error prose | YES | spec :115-120; direct execution | No residual failure for these fixtures |
| Commented Python | YES | spec :131-135; direct execution | Original D2 fixed |
| Shebang script | YES | detector :131; spec :138-140 | May become text, as permitted |
| Ordinary fenced bash / long code README | YES | detector :134-143; direct execution | None reproduced |
| CHANGELOG headings | YES | detector :137-143; direct execution | None reproduced |
| Four-backtick block containing triple fences | NO | detector :154-155 | Defect 2 |
| FAILED at start of prose | NO | detector :42 | Defect 1 |
| Jest/Nx failure log | YES | detector :42,178; direct execution | Representative fixtures only |
| Windows stack-frame path | YES | detector :37; direct execution | Parenthesized location accepted |
| JSON scalar and long string | YES | detector :99-103; spec :76-83 | Intended text fallback |
| 64 KiB regex adversarial candidates | YES | All regex literals exercised | No pathological timing found in tested candidates |

## Verification evidence

- ptah_get_diagnostics scoped to the two changed files: zero errors, zero warnings from typescript-compiler.
- Ran the authorized project-scoped Nx test/lint/typecheck command once, using nx.cmd and a quoted target list for PowerShell, with --skip-nx-cache. Nx reported all three targets successful, cache skipped, duration 3.4 seconds. The command wrapper returned exit code 1 despite that success summary; the retained tail contains no failure reason. Do not describe the process exit as clean. The tail does not independently establish the executor's exact 37-test count.
- Read-only execution of the current TypeScript transpiled in memory reproduced both defects and the positive fixtures described above. No test/source files, git state or task status were changed.
- Historical failing-first behavior was checked against the previously reviewed bodies, not by changing the working tree. No integration, packaging or downstream reducer execution was performed.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for both reproduced defects and original-finding disposition; MEDIUM for downstream effects pending reducer integration.
- Top risk: the detector still assigns structure-specific reducers to ambiguous prose and to Markdown whose fence nesting it misreads.
- What a robust implementation would add: a FAILED-prose negative fixture with stricter verdict evidence, and delimiter-aware fence tracking with nested-example regression fixtures.
