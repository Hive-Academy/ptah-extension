# Phase 6 code-logic review — Batches 26–28

Verdict: **REVISE**

Score: **6/10**. The happy path and the intentionally specified interaction contracts are substantially implemented, but the explicit CRLF boundary in the row-estimate contract gives a wrong expand/collapse result. This is above the 3–4 band because the affected text remains reachable and no data is lost; it is below the 7–8 band because the result is a user-visible failure of a named R7/R9 interaction at a normal cross-platform input boundary.

## Findings

| Severity | File:line | Defect | Concrete failure scenario | Required fix |
| --- | --- | --- | --- | --- |
| Moderate | `libs/frontend/chat-ui/src/lib/molecules/tool-execution/code-output.component.ts:183-187` | The row estimator splits only on `\n`, leaving the preceding `\r` in each CRLF line. That extra character makes an otherwise exactly-100-character line estimate as two wrapped rows. | A Windows/CLI tool returns six CRLF-terminated, 100-character output lines. It should be exactly the six-row threshold and stay non-collapsible, but each line counts as two rows and the UI unnecessarily clips the block and shows “Show full output.” | Normalize `\r\n` (and ideally lone `\r`) before splitting/counting, and add threshold tests for CRLF, empty output, and a long single line. |
| Moderate | `libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-input-display.component.ts:321-325` | The Write-preview estimator has the same CRLF off-by-one error. | A Write request whose content is eleven CRLF-terminated lines of exactly 100 characters is treated as 22 rows instead of exactly 11, incorrectly becoming clipped and expandable. | Share a newline-normalized row-estimate helper with `code-output`, or normalize before the loop; add the same CRLF boundary coverage. |

## Explicit checks

1. **PASS — R9.5 wrapping/no horizontal scroll.** `code-output.component.ts:85-88,118-122`, `tool-input-display.component.ts:136-139,204-208`, and `diff-display.component.ts:84-89,121-124` use vertical-only scrolling and wrapping; no scoped code/diff/input/output block carries the prohibited horizontal-scroll or nowrap classes.
2. **PASS — Escape ownership and order.** `code-output.component.ts:217-224` and `tool-input-display.component.ts:425-432` claim Escape only while expanded; `tool-call-item.component.ts:169-180` checks `defaultPrevented`, consumes pending-permission Escape, otherwise collapses/refocuses only an expanded item. `chat-view.component.ts:514-519` returns for a claimed event and closes an unclaimed narrow overlay.
3. **PASS — accessibility of constrained regions and controls.** Regions are focusable/named at `code-output.component.ts:80-88`, `tool-input-display.component.ts:131-140`, and `diff-display.component.ts:84-89`; toggles provide `aria-expanded`/`aria-controls` at `code-output.component.ts:67-76` and `tool-input-display.component.ts:110-124`; signs have accessible names at `diff-display.component.ts:102-108`. Clipped source remains rendered, rather than removed, at `code-output.component.ts:90-93` and `tool-input-display.component.ts:141-147`.
4. **PASS — text injection containment.** Diff rows interpolate `row.text` at `diff-display.component.ts:110`; Write content is fenced using `fenceCodeBlock` at `tool-input-display.component.ts:395-409`, whose fence exceeds the longest backtick run at `code-fence.ts:1-7`.
5. **PASS — truncation/routing/retention.** Bash and Write exceptions are explicit at `tool-input-display.component.ts:268-282,434-439`; other strings retain the 60-character limit at `:461-476`; trivial inputs, retention notices, routing, and error alert remain at `:353-371`, `:249-265`, and `tool-output-display.component.ts:48-81`.
6. **PASS — clipboard/lifetime.** One shared language map lives in `tool-language.utils.ts:16-59`; copying uses CDK Clipboard rather than a direct browser call and visibly reports failure at `copy-text-button.component.ts:53,67-96`; its timer is cleared on destruction at `:80-84`.
7. **FAIL — row-estimate edges.** Exactly-at-threshold and non-collapsible/readable behavior are correct for LF at `code-output.component.ts:182-197` and `tool-input-display.component.ts:321-332`; empty strings are not clipped. CRLF is miscounted as described in the findings. A single long line correctly contributes multiple rows.
8. **PASS — diff counts/order/speech.** Empty strings become zero lines at `diff-display.component.ts:23-26`; old rows precede new rows at `:151-163`; the screen-reader count grammar is correct at `:169-175`.
9. **PASS — host parity/open failure path.** The Phase-6 specs use `describe.each([true, false])`; no Phase-6 production path gates on `isElectron`. Header and diff use `FILE_LINK_OPENER` (`tool-call-header.component.ts:275,532-540`, `diff-display.component.ts:57` through the path-link atom); the header catches and logs an opener rejection at `:535-539`, matching the stated D15 failure behavior.
10. **PASS — parity inventory rows 120–136.** File open, command, statuses, input rules, output routing, retention, stripping, language detection, diff and height-limited behavior remain represented by the reviewed components, with no silent removal found.
11. **PASS — signal/event/lifetime review.** Header opening reads the current computed path at click time (`tool-call-header.component.ts:532-539`); item collapse uses signal updates and its sole effect enforces pending-permission expansion (`tool-call-item.component.ts:140-145`). No effect loop or un-disposed listener/timer was found in scope.
12. **PASS — stub scan.** No TODO/PLACEHOLDER/STUB, empty implementation body, or fabricated mock-data implementation was found in the scoped production files.

## Five logic questions

1. **Silent failure:** no success-looking dependency failure was found; clipboard failure becomes the visible “Copy failed” status (`copy-text-button.component.ts:67-96`) and opener rejection is logged (`tool-call-header.component.ts:535-539`).
2. **Unexpected user action:** pasting/rendering normal CRLF text at a threshold produces an unnecessary clipped preview and toggle (findings above).
3. **Wrong-answer input:** CRLF content with physical lines at a 100-character wrapping boundary is counted as more visual rows than it has.
4. **Dependency failure/shape:** Clipboard throws and false results are handled; opener Promise rejection is observed. MCP parsing falls back to original text on malformed JSON (`code-output.component.ts:266-291`).
5. **Missing requirement detail:** R7/R9 specified the row threshold but did not state newline normalization; cross-host text requires it for the threshold to be stable.

## Evidence and uncertainty

Read the scoped production components and Phase-6 specs, the requested batch/decision/plan/parity requirements, and the scoped diagnostics. `ptah_get_diagnostics` reported no diagnostics in the requested files; it also reported unrelated sibling baseline errors. No test suite was run, per the memory-safe instruction and because the source/spec inspection established the CRLF defect.
