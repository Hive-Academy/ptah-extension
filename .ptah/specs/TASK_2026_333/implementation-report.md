# Implementation report — TASK_2026_333

Date: 2026-08-28
Implemented by a `frontend-developer` subagent. Reviewed by an independent
`code-logic-reviewer` subagent that did not write the code. Revised once in
response to that review, then re-verified.

## The fix

`BackgroundAgentStore` gained a monotonic `revision` signal and a single
`applyMutation` write path. `_agents.update(` now appears exactly once in the
file (`background-agent.store.ts:201`), so no mutator can bypass the counter.
`computeGlobalEpoch` folds `backgroundAgentStore.revision()` in place of
`backgroundToolCallIds().size`.

It stays a **signal read** deliberately: that read is also what keeps the tree's
`computed` subscribed to the store. A plain field would have severed the
subscription silently.

The counter bumps only when a reducer genuinely replaced the map, so a duplicate
`background_agent_started` for an already-running agent forces no rebuild.

## Why the old code was wrong

Folding a cardinality is correct for a collection that only grows. It is wrong
for a **set whose membership can change while its size does not**. Three ways to
hit that, all now covered by tests: eviction of the oldest completed agent as a
new one starts, `clearCompleted` followed by `onStarted`, and `clearSession`
followed by `onStarted`.

## Proof the tests are not vacuous

Reverting only the epoch line to `backgroundToolCallIds().size` produces
`2 failed, 4 passed` — exactly the two background-swap cases, both on a mirrored
`isBackground` diff:

```
-  "isBackground": false,   +  "isBackground": true,
-  "isBackground": true,    +  "isBackground": false,
```

Both cards render the exact opposite of the full rebuild. That is the defect
verbatim. The other four oracle cases pass before and after, which is the
correct signal — they pin behaviour the epoch bug did not touch.

## The oracle, and why it is a real one

The reviewer verified the bypass rather than taking it on trust. `freshKey` is
unique per call, so `treeCache.get(freshKey)` is always `undefined`, which forces
every `reusable` lookup to `undefined` and starts `nodesById` / `fingerprintsById`
empty. `AgentStatsService.agentStatsCache` is cleared at the start of every
cache-miss build, so it cannot smuggle a matching result between the two
derivations. It is a genuine independent second derivation, not a
self-comparison.

**The first review round rejected the oracle as too shallow.** `shapeOf`
originally omitted seven fields that production `fingerprintNode` folds into its
reuse decision, including `cost`, `duration` and `agentDescription`. A future
invalidation bug staling those while leaving `isBackground` correct would have
passed silently — contradicting the whole point of the oracle.

The revision fixed that structurally rather than by extending a list:

1. `shapeOf` enumerates the node's own keys, skipping `children` (recursed) and
   `undefined` values. A field added to `ExecutionNode` is compared with no spec
   change.
2. `expectEquivalent` additionally asserts `fingerprintTree` equality, computed
   by calling the **private production `fingerprintNode`** over both trees. If
   that method is renamed or its signature changes, the helper throws a named
   error rather than degrading quietly. It is a second opinion, not the verdict —
   a fingerprint is lossy by design, so it can miss a difference but never invent
   one.

Cases covered: background swap by eviction, background swap by tray clear, child
`message_start` before its owning `tool_start`, a node updated after finalize, a
duplicate event id replayed, and a resumed session replayed from persisted
history.

`Date.now` is pinned inside the describe. The reviewer confirmed this is sound
rather than masking: it neutralizes `message-node.fn.ts:151`'s fallback for a
text block with no anchoring delta, which exists in production for a real reason.

## Direct counter coverage

The first review also found nothing tested `revision()` directly — every bump was
verified only indirectly through `isBackground`. `background-agent.store.spec.ts`
now asserts bump and no-bump per mutator, including that `clearCompleted` and
`clearSession` do **not** bump when they removed nothing, and that a duplicate
`onStarted` does not bump.

## A behaviour change, and its blast radius

`clearCompleted` now returns the original map and skips the notification when it
removed nothing. The reviewer checked every call site: production code calls only
`AgentMonitorStore.clearCompleted`, a **different class** untouched here.
`BackgroundAgentStore.clearCompleted` is invoked solely from tests. The one
production consumer, `background-agent-tray.component.ts`, reads `agents()`
reactively and never calls it. Blast radius is zero.

## Verification

`npx nx run-many -t test -p @ptah-extension/chat-streaming @ptah-extension/chat-execution-tree @ptah-extension/chat`
— 3 of 3 projects ran. `chat-streaming` 19 suites / 358 passed, `chat` 58 suites
/ 864 passed, `chat-execution-tree` 2 suites / 22 passed. Zero failures.
`typecheck` green for all three. `eslint` clean on all changed files.

## Left open, deliberately

- **`fingerprintNode` may under-fold.** It folds neither `summaryContent` nor
  `toolCount`, both of which render on agent cards. Excluding timestamps looks
  deliberate — folding them would invalidate node identity on every history
  replay — but these two look like omissions. The implementer declined to widen
  a production reuse key on their own judgement inside a bugfix, which was the
  right call. Filed as TASK_2026_337.
- **No oracle case for a same-id replacement carrying a new timestamp.** With the
  all-fields shape that case fails today, and it fails on _intended_ behaviour,
  because `fingerprintNode` does not fold `startTime`. Adding it would have
  forced either weakening the shape or widening the reuse key. Neither was done.
  Covered by TASK_2026_337.
- **No state-identity guard on the reuse check.** Rated UNPROVEN by the reviewer
  after a genuine attempt to build a failing sequence. Filed as TASK_2026_336.

## Outcome

Status `in_progress` → `done`.
