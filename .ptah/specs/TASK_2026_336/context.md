# Context — TASK_2026_336

## Where this came from

Flagged by the implementer of TASK_2026_333 as something they noticed but
deliberately did not chase, then given an independent reachability verdict by
the reviewer of that same change on 2026-08-28. Both are recorded in
`.ptah/specs/TASK_2026_333/`.

The verdict was **UNPROVEN**, and that is the honest rating. This carrier exists
so the gap is tracked rather than rediscovered, not because anyone has seen it
fail.

## The asymmetry

Two memos in the same service guard themselves differently.

`resolveIndexes` (`libs/frontend/chat-streaming/src/lib/execution-tree-builder.service.ts:479-492`)
checks `cached.indexState === streamingState`. Object identity. A fresh state
object can never be served a previous state's derived indexes.

`buildTreeWithIndexes` (`:290-300`) has no such check. Its reuse decision is the
compound fold: `globalEpoch` matches, `sameOrder` holds, and every per-root
digest matches. All three are computed from CONTENT, and all of the counters
feeding them restart at 1 for a new `StreamingState`.

## Why the precondition is real

The reviewer traced it rather than assuming it:

- `handleTabClosed` (`libs/frontend/chat-routing/src/lib/stream-router.service.ts:941-956`)
  calls `treeBuilder.clearForSession` / `clearForTab` on tab **close** and on
  **`/clear`** only. Never on resume.
- `SessionLoaderService.switchSession`
  (`libs/frontend/chat/src/lib/services/session-loader.service.ts:535-559`)
  never touches the tree builder at all.
- It calls `tabManager.openSessionTab(sessionId, title)`, which **reuses an
  existing tab** already bound to that session id
  (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:635-643`).
- `applyResumingSession` then installs a brand-new `createEmptyStreamingState()`
  onto that same tab (`tab-manager.service.ts:1669-1686`).
- The cache key is `tab-${tabId}`
  (`libs/frontend/chat/src/lib/components/.../chat-transcript.component.ts:220-223`),
  so it is unchanged across the swap.

The rewind/fork path reaches the same place: `chat-view.component.ts:1188` calls
`TabManagerService.rebindTabSession`, which rebinds an existing tab's
`claudeSessionId` to a forked session and drives it through `switchSession`.

So "same cache key, fresh state object, counters restarted at 1" is an ordinary
state this application reaches, not a contrived one.

## Why it is rated latent

The reviewer tried to build a failing sequence and could not. Every candidate
collapsed into one of two cases:

1. The message set or order genuinely differs — a rewind that drops trailing
   messages. That fails `sameOrder` and correctly forces a full rebuild.
2. The replayed content is byte-identical to what produced the cached entry — a
   fork with zero divergence, or a redundant re-resume of the same session. Then
   reusing the tree is not observably wrong, because both builds have the same
   inputs. Note `isBackground` is re-read live from `BackgroundAgentStore` on
   every build regardless, so TASK_2026_333's defect class does not apply here.

Producing a genuinely wrong tree would require a 32-bit hash collision across
the compound fold, or an SDK message id reused for different content. No
evidence was found for either.

## The fix

Add `cached.indexState === streamingState` — or the equivalent state-identity
condition — to the reuse check at `:290-300`, mirroring `resolveIndexes` at
`:479-492`.

This is cheap and it removes a whole class of reasoning. The current safety
argument depends on properties of a 32-bit hash and on SDK id uniqueness. The
guard depends on neither. Prefer the guard.

Watch the cost: a state-identity check that is too strict would defeat the
incremental rebuild entirely, since the ordinary streaming path mutates
`StreamingState` IN PLACE and keeps the same object (see the lib's `CLAUDE.md` —
in-place mutation is the contract). Confirm the guard rejects only a genuinely
REPLACED state object and not the normal in-place mutation, or the whole
TASK_2026_323 Phase 3 win is lost.

## Verification

TASK_2026_333 added an incremental-versus-full equivalence oracle to
`execution-tree-builder.service.spec.ts`. Extend it with a case that swaps in a
fresh `StreamingState` under an unchanged cache key and asserts the tree matches
a full rebuild. That case should fail before this fix if the collision is ever
made reachable, and it costs nothing if it is not.

The existing specs must keep passing unchanged, and in particular the perf-budget
assertion must still hold — if the guard forces a rebuild on every frame, that
test is where it will show.
