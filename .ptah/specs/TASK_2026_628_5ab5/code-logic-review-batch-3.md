# Batch 3 code logic review

## Verdict

CHANGES REQUESTED

## Score

5/10. The normal summary path coalesces and invalidates the owning tree correctly, but a queued summary can outlive a compaction replacement and restore obsolete streaming state. This is a correctness gap rather than a general failure of the design; the close and reset paths do clear their queues.

## Defects

1. **Blocking — compaction replacement can be overwritten by a queued state; pre-existing, with a new Batch 3 trigger.** `streaming-handler.service.ts:469-480` installs `replacementState` directly without clearing or replacing an older entry. `batched-update.service.ts:182-193` later publishes that entry as a fresh top-level object. Before Batch 3, an ordinary stream delta could leave the entry. Now `chat-lifecycle.service.ts:199-210` can create it with a summary chunk alone: summary arrives, compaction completes in the same frame, then rAF publishes the pre-compaction state over the empty replacement. The compacted transcript can reappear, and the UI gets no error. A subsequent summary arriving before the flush is appended to the old queued state (`chat-lifecycle.service.ts:196-210`), which does not repair the replacement. Batch 3 widens the trigger set, so the developer's “does not worsen” claim is too strong.

2. **Blocking — background-workspace direct writes can be undone after a workspace switch; newly exposed by Batch 3, rooted in the existing queue lifecycle.** An active tab's summary is queued at `chat-lifecycle.service.ts:199-210`. `tab-manager.service.ts:773-785` can then move that tab into the background partition without clearing the queued entry. A background `compaction_complete` writes a fresh state directly at `streaming-handler.service.ts:541-553`; the summary fallback also writes that partition directly at `chat-lifecycle.service.ts:212-226`. On return to the workspace, `batched-update.service.ts:195-226` drains the old deferred state and `:182-193` writes it through the workspace-aware `setStreamingState` (`tab-manager.service.ts:1792-1794`, `:1334-1384`), discarding the newer background replacement. This requires a switch and replacement before the pending frame drains, but hidden or inactive tabs can hold the entry much longer than one frame (`batched-update.service.ts:127-140`, `:174-180`). The direct-write deviation is safe only when that tab has no queued active-workspace state.

## Notes

- **Silent failure:** both defects publish an obsolete state successfully; `setStreamingState` reports no conflict (`tab-manager.service.ts:1792-1794`).
- **User action:** switching workspaces while a summary is pending, then returning after background compaction, restores old content (defect 2). Closing or resetting a tab clears its queue synchronously through `stream-router.service.ts:948-970`; the close/reset concern does not hold.
- **Wrong-answer input:** a valid summary immediately before `compaction_complete` is enough; the old state wins even though the replacement is newer (`chat-lifecycle.service.ts:199-210`; `streaming-handler.service.ts:469-480`). Empty summaries with no blocks still schedule a write (`chat-lifecycle.service.ts:25-34`, `:199-210`), expanding the race without adding content.
- **Dependency failure or unexpected shape:** `handleAgentSummaryChunk` assumes a valid session ID when calling `SessionId.from` (`chat-lifecycle.service.ts:190-193`) and `appendAgentSummary` assumes an array of blocks (`:25-35`). I found no Batch 3-specific recovery for a malformed payload; the typed ingress contract and its validation were outside the changed files reviewed. The state-overwrite defects require no dependency failure.
- **Missing requirement:** queue entries need an explicit invalidation or replacement rule when ownership moves to a background workspace or compaction installs a fresh state (`tab-manager.service.ts:773-785`; `streaming-handler.service.ts:469-480`). The plan specifies “never schedule an older one” for summaries but not how all direct writers arbitrate against existing queued entries (`implementation-plan.md:767-793`).
- **Verified path:** a normal summary picks `queuedState` before scheduling (`chat-lifecycle.service.ts:199-210`); the flush publishes `{ ...state }` (`batched-update.service.ts:182-193`); Batch 2 folds summary length and block count into the owning root/tool digests (`execution-tree-cache.ts:178-206`, `:349-365`). Thus a growing summary or block count can rebuild the owning root. The seven Batch 3 tests and project typechecks are reported as passing in `batch-3-notes.md`; I did not rerun them. `ptah_get_diagnostics` was unavailable for this separate worktree because its workspace root is `D:\projects\ptah-extension`.
