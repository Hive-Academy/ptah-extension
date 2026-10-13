# Batch 2 notes: execution-tree reuse (hot spot 1)

## Files changed

- MODIFIED `D:\projects\ptah-wt-628\libs\frontend\chat-streaming\src\lib\execution-tree-builder.service.ts`
- MODIFIED `D:\projects\ptah-wt-628\libs\frontend\chat-streaming\src\lib\execution-tree-builder.service.spec.ts`
- CREATED `D:\projects\ptah-wt-628\libs\frontend\chat-streaming\src\lib\execution-tree-cache.ts`. This
  split was approved by the coordinator after the first pass. The file holds the pure reuse-key
  helpers:
  - `computeTreeDigests` (formerly the `computeDigests` / `foldAgentContent` methods);
  - `identityOf`, `sameStateIdentity`, `ancestorToolCalls`, `agentOwnerToolCalls`;
  - the agent memo key, slot and prune helpers;
  - the shared `HASH_SEED` and `mixNumber`;
  - the cache types.

  The service imports it directly, and it is not in the lib barrel. Behaviour is unchanged: the code
  moved verbatim, and methods became functions.

Not touched: `batched-update.service.ts` (the `{ ...state }` flush copy stays, D3),
`agent-node.fn.ts` (the memo lives in the service's deps closure), and every other file.

## Design summary

1. **Reuse is gated on container identity.** `TreeCacheEntry.indexState` became
   `indexIdentity: StreamingStateIdentity | null`, which holds the `events`, `eventsByMessage` and
   `messageRevisions` references. `sameStateIdentity()` requires all three to be `===`, including
   `messageRevisions` being `undefined` on both sides. A `null` identity never matches. The check
   gates the whole-tree return, the per-root reuse, the agent memo and `resolveIndexes`. A flush copy
   shares the three Maps, so it now hits the cache. Before this change every flush missed.
2. **Per-agent memo.** `computeDigests` replaces `computeRootDigests`. In the same pass over
   `eventsByMessage` it also builds `digestByToolCall`: each message's revision and bucket length are
   folded into every ancestor tool id. The chain is `message_start.parentToolUseId` →
   `toolStartByCallId` → owning message, memoized per build and capped at 32 hops.
   `deps.buildAgentNode` now goes through `buildAgentNodeMemoized`. Its memo is
   `TreeCacheEntry.agentNodeByToolCall`, keyed by the slot `toolCallId\0agentStart.id`, because one
   tool can carry several `agent_start` events. The key is
   `mix(globalEpoch, structuralRevision, digestByToolCall(toolCallId), summaryLength(agentId), blockCount(agentId), depth)`.
   `globalEpoch` carries `backgroundAgentStore.revision()`. A hit also requires the same
   `agentStart` object. The memo is bypassed, so the node is always built, when any of these holds:
   - there is no active build for this state;
   - `structuralRevision` or `messageRevisions` is undefined;
   - the tool has no digest;
   - `agentStart.agentId` is empty (the hook-match path).

   After the reuse walk, each memo entry built in this build is written back to the post-reuse node,
   the object the tree renders. This works the same way as the existing `nodeByRoot` write-back.
   `reuseUnchangedSubtree` returns a node without walking it when that node is the exact object
   recorded for its id. Nodes are immutable and the id→node and id→fingerprint maps are always
   written together, so the recorded fingerprint still describes the node. This is the same reasoning
   that already lets reused roots skip the walk, and it keeps a memoized sibling at O(1).
   `pruneAgentMemo` drops entries whose `agent_start` is no longer the live event for its id (evicted
   or replaced). A new identity starts an empty memo, and `releaseEntry` clears it.
3. **Summary and blocks left `computeGlobalEpoch`.** `foldAgentContent` folds each agentId's summary
   length and block count into its owning tool's digest, the digests of that tool's ancestors, and
   its root digest. An agentId is traced only when every possible reader is pinned to one tool:
   - A tool whose id equals the agentId is a placeholder read.
   - An `agent_start` with that agentId is traced only when its parent is a real `toolu_` id with a
     known `tool_start`. `collectTools`' type fallback can adopt any other parent.
   - A `hook` `agent_start` is untraceable while any `agent_start` has an empty agentId, because
     `agent-node.fn.ts` borrows it by type.
   - An owner that resolves to an orphan root is untraceable.

   Untraced content goes into the global epoch, which rebuilds every root, as before.

## How TASK_2026_336 is preserved

- `applyResumingSession` installs `createEmptyStreamingState()` (`session-loader.service.ts:842,906`).
  That state has fresh `events`, `eventsByMessage` and `messageRevisions` Maps
  (`chat-types.ts:168-184`), so `sameStateIdentity` fails. Nothing is reused: not the tree, not the
  roots, not the agent memo (a new memo Map) and not the indexes.
- A flush copy of the fresh state shares the **fresh** state's Maps, so the check still fails.
- The existing test `agrees with a full rebuild when a resumed tab swaps in a fresh StreamingState
  under the same cache key` is unchanged and passes. The new test `never reuses a fresh StreamingState
  delivered as a flush copy` runs the same scenario through `{ ...state }`.
- The residual risk is written in the code comment: a future writer that `clear()`s these Maps and
  restarts the counters on the same objects would defeat the check.

## Tests added (all under the existing oracle where applicable)

- `reuses the cached tree when the same state arrives as a new shallow copy`: `toBe` on the roots
  and zero `buildMessageNode` calls. A later delta still rebuilds the tree.
- `never reuses a fresh StreamingState delivered as a flush copy`
- `one sub-agent token delta does not rebuild sibling sub-agent subtrees` (acceptance test):
  - B's agent node is `toBe` the previous one;
  - `sub-b` is never passed to `buildMessageNode`, while `msg-root` and `sub-a` are;
  - A is rebuilt with `alpha more`;
  - the oracle agrees.
- `reuses a memoized sibling across repeated deltas` (5 deltas, oracle on each)
- `an agent summary chunk invalidates only the owning root`: `msg-b` is not built,
  `after[1]` is `toBe` `before[1]`, and A shows the summary.
- `an unattributed agent summary still invalidates (global fallback)`
- `expectEquivalent` now takes an optional `input` state, which defaults to the live `state`.
  Existing callers are unchanged.

## Check results

All checks ran from `D:\projects\ptah-wt-628`. Each one held the `.ptah\tmp\heavy-check.lock` lock,
and the lock was released in `finally`.

| Command | Result |
|---|---|
| `npx jest -c libs/frontend/chat-streaming/jest.config.ts libs/frontend/chat-streaming/src/lib/execution-tree-builder.service.spec.ts --coverage=false --maxWorkers=2` | 1 suite, 31/31 passed |
| `npx jest -c libs/frontend/chat-streaming/jest.config.ts …/execution-tree-builder.service.spec.ts …/batched-update.service.spec.ts …/batched-update.visibility.spec.ts --coverage=false --maxWorkers=2` | 3 suites, 58/58 passed |
| `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.display.spec.ts --coverage=false --maxWorkers=2` | 1 suite, 14/14 passed |
| `npx nx typecheck @ptah-extension/chat-streaming --parallel=1` | Successfully ran target typecheck |
| `npx nx lint @ptah-extension/chat-streaming --parallel=1` (first pass) | Passed: 0 errors. Showed a `max-lines` warning on `execution-tree-builder.service.ts` (788 > 700) |

### After the helper split (re-run, same lock rule)

| Command | Result |
|---|---|
| `npx nx lint @ptah-extension/chat-streaming --parallel=1` | Passed: 0 errors, 2 warnings, neither in a Batch 2 file. The warnings are `max-lines` on `agent-monitor.store.ts` and an unused var in `streaming-event-cascade-clean.spec.ts`, both owned by other batches. The service has no `max-lines` warning now. |
| `npx nx typecheck @ptah-extension/chat-streaming --parallel=1` | Successfully ran target typecheck |
| `npx jest -c libs/frontend/chat-streaming/jest.config.ts …/execution-tree-builder.service.spec.ts …/batched-update.service.spec.ts …/batched-update.visibility.spec.ts --coverage=false --maxWorkers=2` | 3 suites, 58/58 passed |
| `npx prettier --write` on `execution-tree-cache.ts` and the spec | Formatting only |

## Decisions

| ID | Decision | Why |
|---|---|---|
| B2-1 | Memo slot is `toolCallId + agentStart.id`, and a hit also requires the same `agentStart` object | One tool can carry several `agent_start` events, all of which produce `agent:${toolCallId}`. A backfill replaces the event object (it also bumps `structuralRevision`). |
| B2-2 | Fold `globalEpoch` into the agent key base instead of only `backgroundAgentStore.revision()` | It covers the background revision, the accumulator sizes and untraced agent content in one value, so the agent memo is never looser than root reuse. |
| B2-3 | Summary and blocks are folded into `digestByToolCall` (owner tool and its ancestors), not only into the agent's own key | A nested agent's summary is rendered inside its parent agent's node. Without the ancestor fold, the parent's memo would return a stale child. |
| B2-4 | Missing tool digest → bypass the memo (plan rule), not a `HASH_SEED` default | An agent without messages is cheap to build. This follows "rebuild when missing". |
| B2-5 | Identity short-circuit in `reuseUnchangedSubtree` plus post-reuse write-back of memo entries | Without them a memo hit still costs an O(subtree) fingerprint walk. The plan's goal is cost proportional to the changed agents. |
| B2-6 | The new helpers live in `execution-tree-cache.ts` (one file, not in the barrel) | They first stayed in the service, which raised a `max-lines` warning (788/700). The coordinator approved a single new file. The service now holds the cache and the reuse decisions, and the new file holds the pure key and digest functions. |
| B2-7 | A hook `agent_start` is untraceable only while some `agent_start` has an empty agentId | Only then can `agent-node.fn.ts` borrow it. The placeholder borrow is already excluded by the `toolu_` parent rule. |

## Unverified items (Batch 2) — results

- **`structuralRevision` behaviour.** The plan's assumption ("bumps on every write except text and
  token deltas") is **not exact**. `structuralRevision` bumps only in these cases:
  - for the five structural event types (`message_start`, `message_complete`, `tool_start`,
    `tool_result`, `agent_start`), including same-id replacements of them;
  - on cap eviction;
  - through `markStructuralChange` when a `textAccumulators` block key is added or removed
    (`chat-types.ts:224-251`).

  It does **not** bump in these cases:
  - for any other event type, including tool/text/thinking deltas and same-id replacements of
    non-structural events;
  - for `agentSummaryAccumulators` / `agentContentBlocksMap` writes (`chat-lifecycle.service.ts:186-195`);
  - for background-store changes.

  The design does not depend on the stronger assumption:
  - Every `setStreamingEventCapped` write bumps `messageRevisions[messageId]`, and the tool digest
    folds that revision plus the bucket length of every message under the tool.
  - Agent content and the background revision are folded explicitly.
  - Everything the agent builder reads outside its own messages is a structural event that does
    bump `structuralRevision`: the `agent_start`, the Task `tool_result`, the stats from
    `message_start` / `message_complete`, and the hook `agent_start`s.

  The oracle tests confirm equivalence.
- **Forked or replaced states get fresh Maps: confirmed.**
  - The fork/rewind flow resets the tab to `streamingState: null` (`tab-manager.service.ts` ~2470).
  - Resume installs `createEmptyStreamingState()` (`session-loader.service.ts:842,906`).
  - Finalization builds `new Map(state.events)` / `new Map(...)` (`message-finalization.service.ts:311,326`).
  - Compaction uses `createEmptyStreamingState()`.
  - A grep for reassignment or `.clear()` of `events`, `eventsByMessage`, `messageRevisions`,
    `messageEventIds` and the accumulator Maps outside specs finds only the lazy
    `state.messageRevisions = new Map()` in `chat-types.ts:302`. That write only produces a new
    identity, which means a rebuild.
