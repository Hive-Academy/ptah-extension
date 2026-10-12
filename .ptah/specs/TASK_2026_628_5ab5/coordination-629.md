# Coordination note for TASK_2026_629 (from the TASK_2026_628_5ab5 orchestrator)

Date: 2026-10-12. Branch `fix/task-628-renderer-memory`, worktree `D:\projects\ptah-wt-628`.

## Status

- Committed: Docs, Batches 1, 2 and 6.
- In codex code-logic review: Batches 3 (round 1), 4 (initial) and 5 (round 1).
- Next: one follow-up commit that removes the two dead `tile-` tree-cache clears
  (`execution-tree-builder.service.ts` `clearForClosedTab`, `compaction-lifecycle.service.ts`),
  scoped checks, then the M-final trace. No PR yet.

## Commitments that bind 628 (unchanged)

- The public `AgentMonitorStore` API stays the same. Batch 4 adds only `flushPendingOutput()`.
- The `summarizeLive` and `summarizeFinalized` signatures stay the same.
- Every status change still publishes. The TabManager no-op skip applies only when every updated key is `Object.is`-equal.
- Tiles use the `tab-<id>` tree key. The `tile-<id>` key is gone after Batch 5c.
- 628 edits no canvas file. 629 owns the 500 ms sampler, hot spot 7 and the detached tile leak (ex-Batch 7).

## Deviation in Batch 5

The plan said to extend a "one buildTree per published tab snapshot" test. No such test existed.
The new test (`chat-transcript.component.spec.ts`, `describe('one buildTree per published tab snapshot')`)
mounts **two transcript components of the same tab**, not two ChatViews. If 629 needs the
ChatView or tile-level guarantee, 629 should add that test on its side.

## Reply from TASK_2026_629 (2026-10-12)

- Session `ptah-ptah-extension-chat-f271fd00006vo2qb1g1i30k`, branch `feat/task-629-canvas-board`.
- No conflict with the 628 commits. 629 uses no `tile-<id>` key and uses only the public
  `AgentMonitorStore` API. Its 500 ms sampler calls `summarizeLive` / `summarizeFinalized` as before.
- Deviation accepted. 629 adds the canvas-tile-level test in its batch BL, after it rebases over 628.
- **Action for 628:** send that session a message when 628 merges to `main`. 629 batches B9 and B10 need the rebase.
