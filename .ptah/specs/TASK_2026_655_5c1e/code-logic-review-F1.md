# Code Logic Review F1 — TASK_2026_655

Reviewer: Claude family (independent of the codex implementer). Read-only review.

| Metric | Value |
| --- | --- |
| Score | 6/10 |
| Verdict | REVISE |
| Blocking | 0 |
| Serious | 1 |
| Moderate | 3 |

Scope read in full: `persisted-content-filter.ts` (469 lines), `persisted-content-filter.spec.ts`,
`history-tool-result-patch.ts`, `history-tool-result-patch.spec.ts`, `batch-F1-report.md`; the
spec at addendum `:37-49`, `:936-1297`, `:1515-1729`; anchors `accumulator-core.service.ts:255-335`,
`tool-node.fn.ts:157-227`, `agent-node.fn.ts` (status at `:102,119,165`). I did not run the specs.
All rule P / P2 / P3 / I / S / H / R paths were traced by hand against the orderings below.

What holds (traced, no defect): rule P drop scope (`:121-124`); P2 flush-before-keep and
head/tail drop (`:269-299`); P3 absorb, passed, tool-identity, mismatch rebuild with anchor
first (`:301-324`); rule I post-snapshot-only tracking and the queue/L(X) hand-over
(`:129-138`); loose block continue at `ks` (`:364-387`), discard on complete copy
(`:408-410`, `:331`), rebuild on S (`:333-336`); both retirement branches (`:442-462`,
earlier = prefix, last = equality); release order (anchor before content, rebuilt delta
with fresh id, `thinking_start`/signature around it, `:219-236`); queue bound `4*|H|+4`
(`:180`); `decide` contract: `hold` is only returned when the event is queued in `state.queue`,
and that queue is either flushed, released on mismatch, delivered at retirement when X has kept
content or a released loose block, or discarded only when nothing of X was kept. I found no path
where a `hold`-ed event is neither released nor legitimately discarded.

## Defects

### 1. Serious — a tracked X absorbs a non-history `tool_start`/`tool_delta` as a "thinking" block and never releases it (content loss)

File: `persisted-content-filter.ts:383-387` (kind computation), `:246` (absorb), `:365-371`.

Line 383 is `const kind = event.eventType === 'text_delta' ? 'text' : 'thinking'`. For a stream
`tool_start`/`tool_delta` whose id is not in `H(X)` (so `historyTool` at `:346` is false), `kind`
is `'thinking'` and `joined` is `''`. If `H(X)[ks]` is a thinking block, `expected.kind === kind`
and `expected.value.startsWith('')` is true, so the tool event is absorbed (`:385`), `ks` is
advanced (`:386`), and `'drop'` is returned. `absorb` (`:246`) creates a "thinking" slot with no
`firstDelta` and no `thinkingStart`. Every later `tool_delta` of that tool hits the
`existing.position !== undefined` branch (`:365`) and is absorbed the same way
(`expected.kind === existing.kind`, `startsWith('')`). `rebuild` (`:227-236`) delivers nothing for
such a slot, retirement skips positioned blocks (`:446`), and `mismatch` rebuilds nothing.

Ordering that loses content: `H(X) = [thinking "t", ...]` with `seedStartK`/`ks` at the thinking
position (for example k0 = 0, or a stream that does not replay the thinking block); post-snapshot
stream `message_start X`, stream `tool_start toolu_9` (not in `H`), `tool_delta`s, then the turn is
aborted or no complete batch arrives. The tool_start and its input are dropped, its
`tool_result` (kept by rule T) has no live tool to attach to
(`streaming-indexes.ts:186-188`), and the history node does not contain the tool. The spec says
"a stream `tool_start` whose id is not `H(X)[pos]`'s → mismatch" (`addendum:1117-1118`). When a
complete batch does arrive the complete `tool_start` is kept via the mismatch path, so the loss is
transient in the normal case but permanent for an aborted turn.

Why the tests miss it: R-B3d uses `H = [text "n1", tool toolu_9]` and a stream `tool_start toolu_7`
at position 0; there `expected.kind === 'text'` and the mismatch fires by accident.

Correction: compute `kind` as `'tool'` for `tool_start`/`tool_delta` and treat a tool event in the
new-block path as: mismatch unless `expected.kind === 'tool'` and `expected.value === toolCallId`
(that case is already handled by `historyTool` above, so any non-history tool event is a
mismatch). For the `existing.position !== undefined` branch, a tool key can never be absorbed.
Guard `absorb` so it only accepts text/thinking events.

### 2. Moderate — pre-snapshot complete `agent_start` (and other non-block complete events) keeps the whole batch, producing a live agent node, head and tail on top of the history node

File: `persisted-content-filter.ts:295-298` (`preComplete`).

Rule H drops a complete-source non-block event inside a batch whose block events were all dropped,
and drops `message_complete` and the head with it (`addendum:1141-1144`). `preComplete` has no such
branch: any non-content, non-`message_start`, non-`message_complete` complete event (an
`agent_start`) falls to `:295`, sets `preBatchDropped = false`, flushes and returns `'keep'`. The
following `message_complete` then takes the `!dropped` branch (`:283-284`) and is kept too.

Ordering: seeded X (`seedStartK = { X: k0 }`) with a Task tool block at position p < k0 in `H`;
pre-snapshot fence copy `message_start(complete)`, `tool_start(complete, Task)` (dropped, `:293`),
`agent_start(complete)` (kept, flushes the head), `message_complete` (kept). The history node already
shows the Task and its agent; the tab gets a second agent node and a head/tail that renders as a
bubble. Nothing is lost; this is a duplicate on a documented-drop path. P2's text is silent on
non-block events, so this is a spec gap that the implementation resolved in the duplicating
direction; the H rule is the consistent reading.

Correction: in `preComplete`, for a non-content, non-head/tail complete event inside an open
pre-batch, return `'drop'` when `preBatchOpen && preBatchDropped` (like `:415-423`), otherwise
flush and keep. Add the test.

### 3. Moderate — rule T stores the redelivery-drop record even when `reconcile` found no node, and a retired filter does neither

File: `persisted-content-filter.ts:144-147`, `:104`.

`reconcileHistoryToolResult` returns `false` when no history node matched
(`addendum:1260-1261`); `result()` ignores the return value and stores
`{ ..., synthetic: false }` anyway. The live `tool_start` of that tool was dropped by tool
identity, so the kept result has nothing to attach to; the one chance to patch the history node
was spent, and a redelivered copy is now dropped by `:143`. The user keeps a tool node that never
completes (loss of the result). Separately, after `retire()` (`:104`) every `tool_result`,
including one for an id in `historyToolIds`, is kept with no reconcile, with the same effect: a
Task whose real result arrives after the terminal `turn_state` (background agents) is never
written to the history node.

Correction: store the record only when `reconcile` returned `true`. For the post-terminal case,
either keep `result()` active for `historyToolIds` after retirement (needs a decision, since the
spec retires the whole filter) or record it as an accepted edge.

### 4. Moderate — a throwing `deliverToTab` leaves already-delivered events in the queue

File: `persisted-content-filter.ts:189-196` (`flush`), `:218-225` (`release`), `:452-461`.

`flush` assigns `state.queue = slots` only after the loop. If `deliverToTab` throws on event n, events
`0..n-1` were delivered but stay queued; the replayer's per-entry try/catch swallows the error and
the next flush or release delivers them again (a duplicated anchor/head; for `release` also a
duplicate rebuilt block, since `blocks.clear()` is not reached). Correction: shift each entry off
the queue before delivering it, or copy-and-clear the queue first.

## Missing tests

Rule/spec case -> what is absent. The existing 27 tests (filter spec 20 + patch spec 3 + others) cover
the happy paths named in the report; the following are not covered or pass by accident.

1. Defect 1: tracked X, `H = [thinking "t", ...]`, stream `tool_start toolu_9` not in `H` -> must
   be `keep` with the anchor flushed. Also a tool_start whose id differs from `H(X)[ks]` tool.
2. R-B3d as written (stream `tool_start toolu_7` and the stream `text_delta "zz"` variants against
   `H = [text "n1", tool toolu_9]`): not present.
3. The tracked "block beyond the page" branch (`:375-380`): the only test that expects "anchor then
   content" (`:157`) runs in the pass state (`k0 = 1 = |H|`). Missing: tracked X, absorbed block 0,
   then stream block 1 beyond `H` flushes the anchor and keeps; with a loose block it must rebuild
   first.
4. R-B1s (c): block in flight not persisted, pre-snapshot "par" a prefix of no history block ->
   P3 keeps it at once; anchor, "par", "tial" in that order. No test.
5. R-B1s (a) end to end: pre-snapshot stream anchor + "partial" + complete batch, deferred anchor
   passes through, later stream block 2 reaches the tab once after both queued anchors. Only the
   fragments at `:47`, `:224`, `:236` exist.
6. R-B6 case 2: `H = [thinking "t"]`, batch `[thinking "t", text "b"]` -> thinking dropped, head
   released before "b", text and `message_complete` kept.
7. R-B5: stream text of a live subagent X dropped after kept subagent thinking (only the complete
   text is asserted, `:221`).
8. R-B3c: large absorbed prefix (thousands of deltas), then exact complete batch dropped, then
   terminal discards the anchor; and the "n1 n3" variant after a long wait. Only the short case
   exists.
9. Rebuild with thinking: `thinking_start` + `thinking_delta`s + `signature_delta` absorbed, then a
   mismatch -> delivered in the order start, one merged delta with a new id, signature.
10. Rule P3 `thinking_start`/`signature_delta` as the first event, and a passed block (`passed` set)
    keeping later events.
11. Tool identity in tracked X advances `ks`/`k` (stream tool at `ks`, complete tool at `k`) and the
    next text block lands at the right position.
12. Pre-snapshot complete non-block event (defect 2); `message_complete` of a pre-batch with zero
    block events.
13. Retirement ordering: the retiring `turn_state` is returned `keep` after released events (the
    test at `:119` checks delivery but the queue-discard-when-nothing-kept case with a loose
    earlier/last mix and `released` only is thin); retirement with `keptContent` true and queued
    `message_delta`.
14. Rule T: `isError` mismatch only, `jsonEqual` negative cases (array vs object, extra key,
    `undefined` fields), reconcile returning `false` (defect 3).
15. `deliverToTab` throwing (defect 4).
16. Test `:204` ("keeps an uncovered suffix") reaches the pass state (k = ks = 3), not the
    beyond-page path it names; rename or add the tracked variant (item 3).

## Notes

- Duplicate risk, accepted by spec: `discardLoosePrefix` (`:259-262`) matches by "same kind and
  prefix" only. A loose in-flight block "I" would be wrongly discarded by an unrelated earlier
  complete block that starts with "I" if that block's own stream copy is not in `L(X)` (for
  example evicted by the fence cap). That is a loss path, narrow, and the spec text mandates the
  prefix rule. Complete events carry `blockIndex` and the accumulator keys on it
  (`accumulator-core.service.ts:311-319`), so requiring the complete event's block key to equal the
  loose block's key (or to skip keys of a different index) would remove it. Decision for the
  orchestrator.
- `history-tool-result-patch.ts`: field set matches `tool-node.fn.ts:213-226`
  (`status`, `toolOutput`, `isError`, `isPermissionRequest`) and the agent node status
  (`agent-node.fn.ts:119`). Copy-on-write along the changed path and array identity when nothing
  changes are correct (`:11-14`, `:37`, `:53`). `toolOutput !== event.output` compares by
  reference, so a structurally equal but new output object produces a new array and an extra
  `setMessages`; harmless. `toolInput` is not touched; it only matters if a history tool node was
  finalized without a result while its input accumulator was still streaming (the replay path
  emits full inputs, so I do not expect it).
- Early `keep` list at `:111-116` includes `agent_progress`, `agent_status`, `agent_completed`;
  the spec's rule O does not name them. They bypass rule P and the queue; correct only if those
  events never carry a history X's messageId in a way that matters. Not a defect on the evidence
  read.
- A pre-snapshot terminal `turn_state` (arrival < prefixMark) retires the filter via `:106-110`,
  because rule R is not arrival-gated. This matches the spec's text and its accepted edge (turn
  boundary between claim and read); later events of X then show twice.
- `warned` is a single flag per filter, so the "one console.warn" covers all messages. Matches the
  spec wording.
