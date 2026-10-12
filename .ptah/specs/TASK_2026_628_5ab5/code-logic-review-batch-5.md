# Batch 5 code logic review

**Verdict:** CHANGES REQUESTED  
**Score:** 5/10

## Defects

1. **Serious — structural message list stays stale after a streaming tree changes.** `D:\projects\ptah-wt-628\libs\frontend\chat\src\lib\services\stream-presentation-store.service.ts:182-185,203-210`. A same-ID tree update creates a new merged message and updates its record, but `structuralChange` is false, so `records.structure` still exposes the previous `messages` array. `chat-transcript.component.ts:495-500,594-605` passes that old list to Electron turn snapshots. A streamed tool or agent fact can therefore be absent from the turn snapshot even though the message bubble's record has updated. The test at `stream-presentation-store.service.spec.ts:122-128` asserts that the structure remains identical but does not exercise this consumer.

2. **Serious — the parse cache has no byte budget.** `D:\projects\ptah-wt-628\libs\frontend\chat-types\src\lib\tool-input-parse-cache.ts:25-28,46-52`. The 256-entry limit constrains count only; each cached Write/Edit JSON input retains its full raw string and parsed object. Hundreds of large file edits in one session can retain hundreds of megabytes after those tools finish, aggravating the renderer memory issue. Skip oversized inputs and enforce a total cached-character budget, as the Batch 6 fix does.

## Notes

- **Silent failure:** Defect 1 leaves a current-looking structural snapshot with old content. The parse helper reports malformed JSON as a failure result; `tool-node.fn.ts:168-198` preserves fallback/error behavior.
- **User action:** Watching a live Electron turn while its existing tree grows can leave turn-source snapshots stale; repeatedly running large Write/Edit calls grows retained cache memory.
- **Wrong input data:** An updated tree with the same ID is enough for defect 1. Reusing a tool-call ID with different raw input reparses correctly. Shared parse results have no observed mutating consumer in the reviewed frontend call sites.
- **Dependency failure:** A `buildTree` throw leaves `source` assigned before completion at `stream-presentation-store.service.ts:163-175`; this predates Batch 5, so it is not scored as a Batch 5 defect. No retry occurs for the same published tab object.
- **Unspecified case:** The plan treats 256 entries as bounded memory but does not account for the size of Write/Edit payloads. The current code needs the per-entry and total-size policy described above.
- **Other checks:** `updateTabInternal` publishes every changed status or new streaming-state reference and saves changed tabs; its same-reference streaming-state skip is consistent with the prior fast path. The batch publisher makes a new outer state object at `batched-update.service.ts:191`. The tab key is unified at `chat-transcript.component.ts:404-409`, and `execution-tree-builder.service.ts:916-930` clears that key on close. Memo maps are per-tab and pruned on close. The targeted presentation-store Jest spec passed: 4/4 tests. The specs do not cover the stale structural consumer or large cache entries.

