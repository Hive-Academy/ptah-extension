# Context — TASK_2026_333

## Where this came from

The cross-vendor review of TASK_2026_323 on 2026-08-28. Two independent
reviewers examined Phase 3 and **disagreed**: an internal `code-logic-reviewer`
reported `DIVERGENCE FOUND`, an `ollama cloud` reviewer reported `UNPROVEN`. The
claim was verified by hand against the source. The internal reviewer was right.

Full review: `.ptah/specs/TASK_2026_323/cross-vendor-review.md`.

## The three facts that compose into the defect

Each is individually reasonable. The defect only exists where they meet.

1. **The epoch folds a size.**
   `libs/frontend/chat-streaming/src/lib/execution-tree-builder.service.ts:518-521`

   ```ts
   hash = mixNumber(hash, this.backgroundAgentStore.backgroundToolCallIds().size);
   ```

   The comment above it at `:499-500` states the intent: "Accumulator map sizes
   are folded in too so this subsumes every field the pre-TASK_2026_323 memo
   fingerprint checked." That is true for `textAccumulators` and
   `toolInputAccumulators`, which only grow. It is false for a SET whose
   membership can change while its cardinality does not.

2. **Background events bump no digest.**
   `libs/frontend/chat-streaming/src/lib/accumulator-core.service.ts:568-576`

   `background_agent_started`, `background_agent_completed` and
   `background_agent_stopped` each call the store and return
   `this.mutated(event.eventType)`. None calls `setStreamingEventCapped` or
   `indexEventByMessage`. `computeRootDigests` (`:535-551`) folds only
   `messageRevisions.get(messageId)` and `bucket.length`, so neither moves.

3. **`isBackground` is read live at build time.**
   `libs/frontend/chat-execution-tree/src/lib/builders/agent-node.fn.ts:114`
   and `libs/frontend/chat-execution-tree/src/lib/builders/tool-node.fn.ts:397`
   both call `deps.backgroundAgentStore.isBackgroundAgent(toolCallId)`.
   Membership, not size.

## The failure

`BatchedUpdateService` coalesces event mutations into one signal flush per frame,
so two background events in one frame are one build cycle.

Starting state: agent A on root R1, not backgrounded. Agent B on root R2,
backgrounded. `backgroundToolCallIds` is `{B}`, size 1. The cache holds R1
without `isBackground` and R2 with `isBackground: true`.

In one frame: A moves to background, B completes and leaves the set.
`backgroundToolCallIds` becomes `{A}`. **Size is still 1.**

Next `buildTree()`:

- `epochUnchanged === true` — the size did not move.
- `digestByRoot` for R1 and R2 unchanged — neither event touched a revision or a
  bucket.
- `reusableRootNode` (`execution-tree-builder.service.ts:459-469`) returns both
  cached nodes verbatim.

Result: agent A's card still shows as not backgrounded though it is. Agent B's
card still shows as backgrounded though it completed. Both stay wrong until an
unrelated delta happens to touch that specific root — on a quiet node, possibly
for the rest of the session.

User-facing shape: the user presses the background shortcut on a running
subagent at the moment a different backgrounded subagent finishes. Both cards
show the opposite of the truth.

## Fix direction

Fold **membership**, not cardinality. Options, in preference order:

1. Give `BackgroundAgentStore` a monotonic revision counter that every mutation
   bumps, and fold that counter into `computeGlobalEpoch` instead of the size.
   Cheapest, and it cannot be defeated by a size-preserving swap.
2. Fold a cheap order-independent hash of the id set. Correct, but O(set size)
   on every build, which is the per-build cost the incremental rebuild exists to
   avoid.

Prefer option 1. Note the same size-folding reasoning applies to
`agentSummaryAccumulators` and `agentContentBlocksMap` at `:503-511` — those fold
total content length and total block count rather than size, so they are already
sensitive to in-place change. Check whether any other input to
`computeGlobalEpoch` can change without changing the number folded.

Do NOT solve this by removing the cache. The incremental rebuild is the whole
point of TASK_2026_323 Phase 3 and it works.

## The real deliverable is the missing oracle

This defect shipped because nothing could have caught it. No test builds a tree
incrementally and asserts equality against a full rebuild of the same event
sequence. `execution-tree-builder.service.spec.ts` (406 lines) only compares
before and after snapshots taken from the SAME cache key, so it has no
independent baseline. `builders.spec.ts` in `chat-execution-tree` calls the pure
builders directly and never touches the incremental cache. The old full-rebuild
path was deleted, so no oracle remains anywhere.

Add the equivalence test as part of this task, not as a follow-up:

- Replay one event sequence through the incremental `buildTree`, and through a
  fresh build on a never-before-seen cache key, then assert structural equality.
- Cover at least: the background-swap sequence above, a child `message_start`
  arriving before its owning `tool_start`, a node updated after it was finalized,
  a duplicate event id replayed, and a session resumed from persisted state.

The `ollama cloud` reviewer noted a related invariant worth pinning while the
test harness is being built: the digest contract assumes every write goes
through `setStreamingEventCapped`. A direct `state.events.set` would bump neither
`messageRevisions` nor `bucket.length` and would silently reuse a stale root.
Today that invariant is enforced only by a guideline in the lib's `CLAUDE.md`.

## Verification

`@ptah-extension/chat-execution-tree` currently has 2 test suites and 22 tests
for the library Phase 3 rewrote. That is the thinnest coverage on the riskiest
change in the task. The equivalence test above is the fix for that too.

Existing specs must keep passing unchanged:
`execution-tree-builder.service.spec.ts`, `builders.spec.ts`.
