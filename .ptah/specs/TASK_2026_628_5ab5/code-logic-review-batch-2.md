## Verdict

APPROVED

## Score /10

8/10. The cache keys cover the observed production mutation paths and the new regression cases pass. The adjacent 9–10 band would require stronger evidence for unusual replacement and cancellation sequences beyond this targeted suite; 7 would require a concrete stale-render or retention gap, which this review did not find.

## Defects

None demonstrated in Batch 2.

## Notes

- Silent failure: whole-tree reuse at `execution-tree-builder.service.ts:356-369` requires matching container identity, epoch, root order, and root digests. Per-agent reuse at `execution-tree-builder.service.ts:669-696` also checks the exact `agent_start` object. I found no production write that changes rendered content while preserving all of these keys.
- User action: an unchanged shallow flush copy returns the same tree (`execution-tree-builder.service.ts:356-369`; `execution-tree-builder.service.spec.ts:251-271`). A fresh resumed state, including a flush copy, has fresh Maps and rebuilds (`execution-tree-cache.ts:235-245`; `execution-tree-builder.service.spec.ts:1025-1042`). A sub-agent delta changes its ancestor tool digest while the sibling memo survives (`execution-tree-cache.ts:102-113`; `execution-tree-builder.service.spec.ts:1063-1088`).
- Input data: the root digest includes each message revision and bucket length (`execution-tree-cache.ts:102-113`). Traceable summary length and block count enter the owning root and tool digests (`execution-tree-cache.ts:178-207`); untraceable content enters the global epoch (`execution-tree-cache.ts:187-218`; `execution-tree-builder.service.ts:631-640`). The current summary writer appends text and pushes blocks (`chat-lifecycle.service.ts:31-36`), so its in-place changes advance those folds. A hypothetical size-preserving edit of a summary or block would evade them; no such production writer was found.
- Dependency failure or malformed shape: `buildTree` propagates builder exceptions and clears its active build context in `finally` (`execution-tree-builder.service.ts:279-296`). The cache makes no external asynchronous call. This suite does not inject malformed `StreamingState` containers; the caller contract supplies Maps and arrays.
- Missing requirements: no specific stale-output case emerged beyond the stated criteria. The per-entry agent memo prunes events no longer live (`execution-tree-cache.ts:381-390`), cache entries are capped at 50 (`execution-tree-builder.service.ts:179-182,481-500`), and `clearCache`/closed-tab cleanup releases the memo (`execution-tree-builder.service.ts:889-930`). The existing unmatched-tool logging set is only cleared by global `clearCache` (`execution-tree-builder.service.ts:185-189,899-903`); it stores IDs rather than old states and predates Batch 2.
- Verification: targeted Jest command passed, 31 tests in one suite. The `ptah_*` tools, including `ptah_agent_report` and `ptah_get_diagnostics`, were unavailable in this session; native read/search was used. No source files were edited and no git command was run.
