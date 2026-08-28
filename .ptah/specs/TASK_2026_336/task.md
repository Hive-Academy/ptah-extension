---
id: TASK_2026_336
status: backlog
type: BUGFIX
title: >-
  The execution-tree reuse check has no state-identity guard, so a resumed tab
  can in principle be served the previous session's tree
description: >-
  `resolveIndexes` guards its memo on object identity
  (`execution-tree-builder.service.ts:479-492` checks `cached.indexState ===
  streamingState`). `buildTreeWithIndexes` does not (`:290-300`) — its reuse
  decision rests only on the compound fold of `globalEpoch`, `sameOrder` and the
  per-root digests. The precondition for that asymmetry to matter is real and
  unguarded: `handleTabClosed` (`stream-router.service.ts:941-956`) calls
  `clearForSession` / `clearForTab` only on tab close and on `/clear`, never on
  resume, and `SessionLoaderService.switchSession`
  (`session-loader.service.ts:535-559`) never touches the tree builder at all —
  it reuses the existing tab for that session id
  (`tab-manager.service.ts:635-643`) and then `applyResumingSession` installs a
  brand-new `createEmptyStreamingState()` onto that SAME tab
  (`tab-manager.service.ts:1669-1686`), under the SAME cache key `tab-${tabId}`
  (`chat-transcript.component.ts:220-223`). The rewind/fork path
  (`chat-view.component.ts:1188` via `rebindTabSession`) drives the same flow.
  So a fresh state object meets a stale cache entry with counters that restart
  at 1. Rated latent rather than live: an independent reviewer could not
  construct a sequence where the compound digest matches while the rendered
  content differs — every candidate either changed the message set or order and
  correctly forced a rebuild, or replayed byte-identical content where reuse is
  not observably wrong. Producing a wrong tree would need a 32-bit fold
  collision or an SDK message id reused for different content, and no evidence
  was found for either. The fix is one condition, mirroring the guard that
  already exists ten lines away.
relates_to:
  - TASK_2026_333
  - TASK_2026_323
labels:
  - chat-streaming
  - cache-invalidation
  - latent
executor: frontend-developer
estimate: S
---

# No state-identity guard on the execution-tree reuse check

Machine-owned metadata carrier. Prose lives in `./context.md`.
