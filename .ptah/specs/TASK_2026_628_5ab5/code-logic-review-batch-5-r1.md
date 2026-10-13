# Batch 5 code logic review — round 1

Score: 8/10  
Verdict: APPROVED

## Round-0 defects

| Round-0 defect | State | Evidence and impact |
| --- | --- | --- |
| Stale structural message list reaches turn snapshots | RESOLVED | `D:\projects\ptah-wt-628\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.ts:594-612` reads `view.slots.map((slot) => slot.record())` inside the snapshot computed. The presentation store writes changed same-id messages to the slot record at `D:\projects\ptah-wt-628\libs\frontend\chat\src\lib\services\stream-presentation-store.service.ts:190-200`; the computed therefore tracks current message content despite stable `structure.messages`. The replay-tree regression test at `D:\projects\ptah-wt-628\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.ptah-ui.spec.ts:503-549` checks a newly added Bash node appears in the turn snapshot. |
| Count-only tool-input parse cache retains large payloads | RESOLVED | `D:\projects\ptah-wt-628\libs\frontend\chat-types\src\lib\tool-input-parse-cache.ts:33-75` caps entries at 256, skips raw inputs above 32,768 characters, accounts `raw.length * 3` against 1,048,576 retained characters, and removes oldest entries until both bounds hold. A hit requires the same id and identical raw string, and refreshes Map order; replacement and `clearToolInputParseCache` decrement or reset accounting at lines 55-89. `D:\projects\ptah-wt-628\libs\frontend\chat-execution-tree\src\lib\builders\tool-input-parse-cache.spec.ts:23-112` covers oversize, exact cap, byte-budget eviction, changed raw, and LRU eviction. The size is an estimate for the parsed object, as specified in the fix. |

## New defects

None found in the reviewed Batch 5 paths.

## Logic checks

1. **Silent failure:** The old stale-snapshot path is closed by the record reads at `chat-transcript.component.ts:599-610`. Malformed tool JSON still produces a failure result at `tool-input-parse-cache.ts:92-101`, which the builder converts to its existing fallback or parse-error node at `tool-node.fn.ts:170-195`.
2. **User action:** Replaying a turn while its existing tree grows now refreshes the snapshot; the test asserts the new command at `chat-transcript.ptah-ui.spec.ts:503-549`. Repeated no-op tab updates keep the same array while status transitions publish at `tab-manager.service.ts:1335-1385` and `tab-manager.service.spec.ts:1019-1088`.
3. **Wrong input data:** Same-id input with changed raw is reparsed at `tool-input-parse-cache.ts:55-66`; the test checks replacement at `tool-input-parse-cache.spec.ts:74-80`. The shared result is only read when assigned to a node at `tool-node.fn.ts:168-226`; the searched frontend consumers read fields and showed no mutation of the cached data.
4. **Dependency failure or malformed shape:** Invalid JSON and non-object input return failure shapes at `tool-input-parse-cache.ts:92-101`, tested at `tool-input-parse-cache.spec.ts:83-98`. A `buildTree` throw after `source` assignment can still prevent retry for the same tab object at `stream-presentation-store.service.ts:158-175`; round 0 identified this as pre-existing, and Batch 5 did not change that path.
5. **Requirements gap:** The plan's count cap omitted payload size. The added per-entry and total estimates at `tool-input-parse-cache.ts:33-75` address that gap. The cache does not claim an exact JavaScript heap-byte ceiling.

The tile fallback uses `tab-${id}` at `chat-transcript.component.ts:404-409`; the store uses the same key at `stream-presentation-store.service.ts:242-250`. The two-transcript test at `chat-transcript.component.spec.ts:941-965` demonstrates one `buildTree` call for each of two published snapshots, with both surfaces rendering. It is sufficient for that assertion. The supplied diff contains no canvas path. The two known dead `tile-` clears are outside this review.

## Verification and score

The batch notes report 24 passing execution-tree tests, 200 passing chat tests, and scoped typecheck/lint success for chat-types, chat-execution-tree, and chat. I did not run checks, as the task forbids them. `ptah_get_diagnostics` returned unchecked coverage because its TypeScript pass was still running after 45 seconds; it supplied no diagnostic verdict.

8/10 reflects two resolved material defects and direct tests for the changed behavior. It stays below 9 because the one-build test covers two transcript instances rather than the full ChatView composition, and the retained-size bound is deliberately estimated rather than measured heap usage. No changed-path logic defect warrants a blocking finding.

