# Phase 6 Fix-Round Logic Re-review — Batch 28F

Verdict: **APPROVED WITH NOTES**  
Score: **8/10**

The two original Moderate CRLF row-estimation defects are closed. This is in the 7–8 band rather than 9–10 because the single allowed scoped Jest invocation could not complete: its mandated `marked` mapper resolves to a missing worktree-local file. The examined logic and all targeted source/spec evidence otherwise support approval; no defect was found.

## Scope and evidence

Reviewed the complete scoped production components and the Phase-6 delta in `f96a6d5a7..1527efcc1`, plus `context.md`, `task-description.md`, `implementation-plan.md`, `batches.md` Batch 28F, `batch-28F-report.md`, decisions #119/#131/#132/#133/#134, the original Phase-6 logic review, and the Phase-6 style review.

`ptah_get_diagnostics` reports **0 diagnostics in the eight requested source/spec files**. It reports eight baseline sibling diagnostics outside scope. `git diff --check` is clean. No TODO, PLACEHOLDER, STUB, empty implementation body, mock implementation, or newly introduced logging was found in the four scoped components.

| Check | Result | Evidence |
| --- | --- | --- |
| CRLF row estimate | PASS | `code-output.component.ts:184-192` splits CRLF/CR/LF before measuring; `plainOutput()` normalizes its trailing terminator through `stripSystemReminders(...).trim()` at `:149-154,242-246`. Thus six 100-character CRLF lines total six rows and seven total seven. `tool-input-display.component.ts:299-336` removes precisely one trailing terminator and measures the normalized lines. Boundary/spec coverage is at `code-output.component.spec.ts:353-388` and `tool-input-display.component.spec.ts:516-555`. |
| Write count and preview consistency | PASS | `writeLines` removes one final CRLF/CR/LF then splits at `tool-input-display.component.ts:299-303`; both `writeLineCount` (`:305`) and `writePreviewCollapsible` (`:330-336`) read it. The 11/12 boundary and longer-line toggle checks are in `tool-input-display.component.spec.ts:516-548`. |
| Collapsed header path | PASS | The streaming guard remains at `tool-call-header.component.ts:127`; the path span is `flex-1 min-w-0`, has `truncate` only when collapsed and `break-all` only when expanded, and preserves the full `title` at `:128-143`. The focused Read/Write/Edit cases are at `tool-call-header.component.spec.ts:366-394`. |
| No horizontal scroll / nowrap | PASS | Code/output and input preview wrap at `code-output.component.ts:118-126` and `tool-input-display.component.ts:204-212`; diff wraps at `diff-display.component.ts:133-136`. The reviewed code/diff/input/output blocks have no `whitespace-nowrap` or horizontal-overflow class. |
| Diff gutter and CRLF split | PASS | `splitLines` removes CRLF/CR delimiters at `diff-display.component.ts:30-32`; caption is visibly snippet-relative at `:88-93`; the aria label is likewise accurate at `:190-194`. The LF/CRLF equivalence test is `diff-display.component.spec.ts:176-201`. |
| Existing diff assertion | PASS | The only modified pre-existing assertion is the aria-label expectation in `diff-display.component.spec.ts:136-151`; it still tests the case’s focusable, labelled, bounded, wrapping block contract. |
| Constraints | PASS | All new cases are lexically inside their existing `describe.each([true, false])` suites (for example `code-output.component.spec.ts:128-130,353-388` and `diff-display.component.spec.ts:9-11,154-201`). No production `isElectron` gate or new export was added; `chat-ui/src/index.ts` is absent from the range. |

## Findings

No numbered defects. The pre-existing `console.error` at `tool-call-header.component.ts:541` is outside this fix delta and remains the established observed failure path for an opener rejection; it is not logging substituted for the Batch 28F implementation.

## Five logic questions

1. **Silent failure:** None introduced by this fix. The row calculations feed the visibility control directly, and exact threshold tests target the former silent misclassification path.
2. **Unexpected user action:** Pasting Windows CRLF output/content at the six/seven and eleven/twelve boundaries now gives the expected toggle state (`code-output.component.ts:184-192`; `tool-input-display.component.ts:299-336`).
3. **Wrong-answer input:** CRLF and lone-CR inputs no longer contribute `\r` to a measured line; the diff’s CRLF rendering equals LF counts (`diff-display.component.ts:30-32`, `diff-display.component.spec.ts:176-201`).
4. **Dependency failure, timeout, or malformed shape:** This narrowly scoped presentation fix adds no dependency call. Existing malformed MCP extraction still returns the original content on parse failure at `code-output.component.ts:268-293`; the known file-opener rejection remains observed at `tool-call-header.component.ts:535-542`.
5. **Missing requirement detail:** The requirements do not define how an empty Write `content` should be labelled in the line-count badge (`writeLines` yields one empty display line at `tool-input-display.component.ts:299-305`). This does not affect the required toggle boundary or conceal content, so it is recorded as residual uncertainty rather than a defect.

## Verification note

The one permitted scoped Jest command was invoked once. It ran six suites; three passed (78 tests) and three stopped before tests because the mandated `^marked$` mapper resolves to `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\node_modules\marked\lib\marked.umd.js`, which does not exist. This is verification-environment evidence only, not a source finding; no rerun was performed under the one-run limit.
