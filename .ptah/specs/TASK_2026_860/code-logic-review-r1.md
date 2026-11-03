# Code Logic Re-review — `TASK_2026_860`

| Metric | Value |
| --- | --- |
| Score | 9/10 |
| Verdict | APPROVED |
| New Blocking/Serious issues | None found |

1. **Resolved — concurrent Stop false success.** Per-target outcomes join same-target calls, and owner-only `finally` cleanup clears the map and flag (`conversation.service.ts:417-433`). Tests cover success, failure, same-target joins, different-target overlap, and final flag cleanup (`conversation.service.spec.ts:649-690`).
2. **Resolved — removal focus jumped to the first card.** The rail retains prior visible IDs and selects the next surviving displayed card, then the predecessor (`canvas-rail.component.ts:474-505`, `canvas-rail-grouping.util.ts:38-52`). The grouped-removal test checks roving focus and DOM focus (`canvas-rail.component.spec.ts:441-465`).
3. **Resolved — close used stored-order neighbours.** `close()` captures rendered IDs before removal and reuses the visible neighbour for selection and focus (`canvas-rail-board.component.ts:937-971`). Tests cover cross-group order and collapsed Finished cards (`canvas-rail-board.component.spec.ts:2750-2784`).
4. **Resolved — anchor geometry used stored order.** `anchor()` now measures the target card and scroll container (`canvas-rail-board.component.ts:679-699`). A group-header regression test checks the resulting `scrollTop` (`canvas-rail-board.component.spec.ts:967-985`).
5. **Resolved — collapsed Finished skipped scroll restoration.** Restoration now precedes the rendered-count guard (`canvas-rail-board.component.ts:644-654`). The collapsed-Finished test checks persisted scroll restoration (`canvas-rail-board.component.spec.ts:988-1001`).

The untargeted abort still captures one active target before awaiting (`conversation.service.ts:412-415`). All Stop paths return through the scoped `finally`; no stale stop state or leaked promise was found.

No checks ran in this read-only re-review. The fix reports record passing scoped verifies: chat 3/3 and canvas 3/3.
