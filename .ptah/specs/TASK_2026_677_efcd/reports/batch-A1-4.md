# Batch A1-4 report: finalization message-start timestamp (chat-streaming)

Executor: frontend-developer (Claude). Task A1-4.1 (decision A1-D1). Wave 2.

## Files changed

- MODIFIED `libs/frontend/chat-streaming/src/lib/message-finalization.service.ts`
  - New module function `messageStartTimestamp(state, rootId)`. It returns the timestamp of the
    `message_start` event with id `rootId` from `state.events` when that timestamp is finite, and
    `undefined` otherwise (the event was evicted by the cap, has a different type, or its time is
    not finite).
  - `finalizeCurrentMessage`, new-message loop: `createExecutionChatMessage` now receives
    `timestamp: <message_start timestamp>` when one is found. On `undefined` the key is omitted,
    so the `Date.now()` default in `factories.ts:37` still applies.
- No spec files changed (see "Specs" below).

## Validation note: is `tree.id` the `message_start` id? Yes

- `buildMessageNode` (`libs/frontend/chat-execution-tree/src/lib/builders/message-node.fn.ts:44-50`)
  builds each root with `id: startEvent.id` and `startTime: startEvent.timestamp`. `startEvent` is
  the message's `message_start` event.
- `StreamingState.events` is keyed by event id (`chat-types.ts:276`, `:300`
  `state.events.set(event.id, event)`), so `stateCopy.events.get(tree.id)` returns that
  `message_start` event.
- The history path uses the same identity: `history-message-builder.service.ts:169`
  `treeById.get(messageStartEvent.id)`, and it stamps `timestamp: messageStartEvent.timestamp`
  (`:216`). A live-finalized assistant message and its reloaded copy therefore carry the same
  `timestamp`, so `timestamp + duration` ("Worked for") is the same live and after reload.
- `placeFinalizedTrees` (same file, `:69-75`) already relies on the same identity
  (`messageById.get(start.id)`).

## Decisions

- Read from `stateCopy.events` (the deep copy that built `finalTree`), not from the live
  `streamingState`. Options: the copy, the live state, or `tree.startTime`. Evidence: the copy is
  the snapshot the tree was built from, and it is isolated from concurrent stream writes
  (`deepCopyStreamingState` doc). Using `tree.startTime` would give the same value, but the plan
  names the event and the history path reads the event, so the event is the single source.
  Reversible.
- Reuse branch (`finalTree.length === 0`, stats folded onto the last assistant message): no change.
  It spreads `...last`, so an existing finite `timestamp` is never overwritten. That is what the
  plan asks for ("do not overwrite an existing finite start timestamp").
- Messages already present (`existingIds.has(tree.id)`) are skipped as before, so their stored
  timestamps are untouched.

## Deviations

None. One file was changed, and the fallback keeps `Date.now()`.

## Specs

I checked `message-finalization.service.spec.ts`, `message-finalization.session-history.spec.ts`,
`message-finalization.retention.spec.ts` and `message-finalization.cross-workspace.spec.ts`. None
asserts a `Date.now()` / wall-clock `timestamp` on a live-finalized message, and none compares
whole finalized message objects (`toEqual`/`toStrictEqual`/snapshot). Assertions check single
fields (ids, tokens, cost, duration, role). The `timestamp:` hits are event fixtures (for example
`service.spec.ts:111` `timestamp: index`) or the history-path mirror in `session-history.spec.ts`.
No spec update was needed.

## Checks

As instructed (decisions.md row 59), I ran no nx check.

- `ptah_get_diagnostics` with `files = [.../message-finalization.service.ts]`:
  "No diagnostics in the requested files." The tool also listed 131 errors, all in sibling
  `*.spec.ts` files of chat-streaming (for example `accumulator-core.service.spec.ts`,
  `agent-monitor.empty-session-id.spec.ts`, and 23 in `message-finalization.service.spec.ts`).
  No non-spec file has an error. These come from strict type-checking of loosely typed spec
  fixtures (`as` casts, branded `AgentId` strings) and are unrelated to this change, which adds no
  type that those specs use. The team-leader's `nx typecheck @ptah-extension/chat-streaming` is the
  authoritative check for spec typing.
- Left for the team-leader after the wave: `nx test`, `nx typecheck` and `nx lint` for
  `@ptah-extension/chat-streaming` (commands in batches.md A1-4 "Scoped checks").

## Out-of-scope observations

None.
