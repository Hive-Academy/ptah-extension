# Code Logic Review — `TASK_2026_860`

## Summary
| Metric | Value |
| --- | --- |
| Overall score | 5/10 |
| Verdict | REVISE |
| Issues | 1 Blocking, 3 Serious, 1 Moderate |
| Failure modes found | 5 |
The score is 5 because one silent Stop failure and three likely keyboard defects remain. It is not lower because target capture, dock planning, grouping, and pulse behavior are implemented.

## Five logic questions
1. **How does this fail silently?** Two Stop requests can pass the guard before either query resolves. The later request can return `true` without an abort and clear the first request's flag (`libs/frontend/chat/src/lib/services/chat-store/conversation.service.ts:520-557`, `:413-416`, `:483-485`).
2. **What user action produces unexpected behavior?** Removing or closing a card can select a non-adjacent displayed card. Status navigation can also scroll to the wrong position (`libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts:490-500`, `canvas-rail-board.component.ts:954-981`, `:694-705`).
3. **What input data produces a wrong answer?** Stored tile order that differs from grouped display order produces wrong close neighbors and scroll indices. A collapsed Finished group also suppresses scroll restoration (`canvas-rail-board.component.ts:955-957`, `:694-705`, `:637-670`).
4. **What happens when a dependency fails?** Abort RPC errors are logged and use captured-target local cleanup. Tab replacement prevents stale cleanup (`conversation.service.ts:443-461`, `:496-503`). The overlapping-request guard still loses the abort as described in Finding 1.
5. **What is missing that the requirements never mentioned?** Overlapping Stop requests need ownership semantics. The current single boolean cannot identify which request may clear the stop state (`conversation.service.ts:413-416`, `:483-485`).

## Findings
1. **Blocking — Concurrent Stop can report success without sending an abort.**
   - Evidence: `conversation.service.ts:520-557` checks `_isStopping` before an await. `conversation.service.ts:413-416` returns when another request owns the flag, and `:483-485` clears that flag in every `finally`.
   - Impact: The second caller receives `true` although its target can remain active. Its `finally` also permits further overlapping aborts.
   - Fix: Use per-target stop state with an ownership token. Return the actual abort outcome. Let only the owner clear its own state. Add a two-query regression test.
2. **Serious — Card removal moves focus to the first visible card.**
   - Evidence: `canvas-rail.component.ts:490-493` searches with `indexOf(current)`. A removed ID returns `-1`, so the first visible ID satisfies the comparison.
   - Impact: Keyboard users lose their expected next-or-previous position after removal.
   - Fix: Retain the prior displayed list. Calculate the successor from the removed index, then use the predecessor. Add the planned removal-focus test.
3. **Serious — Close selects a stored-order neighbor instead of a displayed neighbor.**
   - Evidence: `canvas-rail-board.component.ts:954-957` derives `neighbour` from `orderedTiles()`, and `:976-981` focuses it after removal.
   - Impact: Grouped cards can move selection across sections or to a collapsed Finished card.
   - Fix: Derive next and previous candidates from the pre-close visible display order. Reuse that candidate for selection and DOM focus.
4. **Serious — Rail anchoring calculates geometry in stored order.**
   - Evidence: `canvas-rail-board.component.ts:694-705` finds the index in `orderedTiles()` and assumes uniform card positions.
   - Impact: Group headers, regrouping, and collapsed Finished cards make the calculated `scrollTop` wrong.
   - Fix: Use the located card's actual bounds for every anchor operation. Alternatively, calculate offsets from displayed groups and headers.
5. **Moderate — Collapsed Finished cards prevent persisted scroll restoration.**
   - Evidence: `canvas-rail-board.component.ts:637-654` counts all tiles but only rendered cards. The early return skips restoration at `:662-670`.
   - Impact: A rail with more than three Finished cards can reopen at the wrong scroll position.
   - Fix: Restore scroll before the geometry-count guard. Keep the guard only around geometry sampling.

## Data flow
- Stop: captured target → query → confirmation → targeted abort → guarded local fallback. Capture and fallback are OK. Concurrency has Finding 1.
- Dock: full roster → five-chip planner → running-first display → in-place overflow menu. Cap, selected exception, and focus freeze are OK.
- Rail: stored order → display-only groups → same-group persisted swaps. Grouping is OK. Removal, close, and scroll have Findings 2-5.
- Pulse: determinate values remain intact. Reduced motion retains static indicators. Angular template backticks parse in the reviewed sources.

## Requirements fulfillment
| Requirement | Status | Gap |
| --- | --- | --- |
| Captured Stop target and failure fallback | PARTIAL | Finding 1 |
| Five-chip dock, order, freeze, overflow | COMPLETE | None confirmed |
| Rail groups, moves, collapse, roving focus | PARTIAL | Findings 2-3 |
| Status jumps and scroll restoration | PARTIAL | Findings 4-5 |
| Pulse and reduced motion | COMPLETE | None confirmed |

## Edge cases
| Case | Handled | Concern |
| --- | --- | --- |
| Cancel confirmation | YES | No abort is sent |
| RPC failure or rebound tab | YES | Captured-target fallback remains guarded |
| Unknown dock width | YES | Planner starts with one chip |
| Reduced motion | YES | Static running indicators remain |

## Decisions
- The overflow menu does not release dock focus freeze. `native-dropdown.component.ts:67-100` renders its panel in place rather than through a portal.
## Verification
No checks ran because this review was read-only. Batch reports B-D record earlier exit-1 runs and later unverified edits. They do not establish current verification.

## Verdict
- Recommendation: **REVISE**
- Confidence: **HIGH**
- Top risk: Stop can report success while the target remains active.
- Required fixes: Resolve Findings 1-5 and add regression coverage for overlapping Stop requests and displayed-order keyboard behavior.
