# Batch 4 notes — hot spot 4, CLI agent output (4a-4e)

Implemented by the first Batch 4 developer. The finishing developer reviewed the work, fixed one defect, moved the helpers out of the store, ran the checks and wrote these notes.
All paths are under `D:\projects\ptah-wt-628`.

## Files per sub-batch

### 4a. Frame coalescing (store-owned), with R2 and R2.1
- MODIFIED `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts`
- CREATED `libs/frontend/chat-streaming/src/lib/agent-output-frame.ts`. It holds the private helpers
  `PendingAgentOutput`, `appendMergingProse` and `applyPendingOutput`, which were moved out of the
  store. It is not exported from the barrel.
- MODIFIED `libs/frontend/chat-streaming/src/lib/agent-monitor.store.spec.ts` (new `frame-coalesced output` block)
- MODIFIED `libs/frontend/chat-streaming/src/lib/agent-monitor.retention.spec.ts` (R2 and R2.1 tests)

### 4b. Amortized buffer cap (2x hysteresis)
- MODIFIED `libs/frontend/chat-streaming/src/lib/agent-output-retention.ts`. New exports:
  `appendToBuffer`, `trimPendingOutput` and `PendingBufferTrim`. `capBuffer` still trims at 1x, and only
  the restored-card path in the store calls it.
- CREATED `libs/frontend/chat-streaming/src/lib/agent-output-retention.spec.ts`

### 4c. Incremental stdout/stderr parsing in the agent card
- MODIFIED `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.utils.ts`. New exports:
  `createAgentOutputParser()` and `createStderrParser()`. These are stateful parsers, one per card instance,
  with no timers. `parseAgentOutput` and `parseStderr` remain as the reference implementation and the
  fallback for a full reparse.
- MODIFIED `.../agent-card/agent-card.component.ts`. `parsedOutput` and `parsedStderr` now go through the
  per-instance parsers.
- CREATED `.../agent-card/agent-card.utils.spec.ts`
- MODIFIED `.../agent-card/agent-card-truncation.spec.ts`

### 4d. Positional segment keys and throttled tail markdown
- MODIFIED `libs/frontend/chat-ui/src/lib/molecules/agent-card/agent-card-output.component.ts`.
  - Segment keys are now `${index}:${type}`.
  - The tail text markdown is throttled to 150 ms (`TAIL_MARKDOWN_THROTTLE_MS`) with one `setTimeout`
    per instance. `DestroyRef.onDestroy` clears it.
  - `segmentContentKey` has no remaining references.
- MODIFIED `.../agent-card-output.component.spec.ts`

### 4e. Tree builder: single-pass assembly and local JSON.parse cache
- MODIFIED `libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts`.
  - Accumulators are now grouped per message as events are folded: `textBlocksByMessage`,
    `thinkingBlocksByMessage`, `toolStartsByMessage` and `assistantMessagesByTool`. Assembly no longer
    scans every key or filters every tool start for each message.
  - `toolInputCache` (raw string -> parsed value) is local to each agent's accumulators.
  - `buildMessageChildren` and `buildToolNode` now take the `TreeAccumulators` object instead of 7-9
    separate maps.
- MODIFIED `.../agent-monitor-tree-builder.service.spec.ts` and `.../agent-monitor-tree-builder.cap-fold.spec.ts`

## Design summary

1. `onAgentOutput(delta)` no longer writes `_agents`. It merges the delta into the private queue
   `_pendingOutput: Map<agentId, PendingAgentOutput>` and schedules one `requestAnimationFrame` per store.
   - The queue holds raw stdout and stderr, segments merged by the card's text/thinking adjacency rule,
     every usage report in arrival order, stream events, and a count of stream deltas.
2. `flushPendingOutput()` applies the whole queue in a single `_agents.update`.
   - It copies the list once and clones only the agents that changed. Other agents keep their object
     identity.
   - Queued output for an agent the store does not hold is dropped.
3. Every other `_agents` writer goes through the private `updateAgents()`, which flushes first. This covers
   exit, expire, permissions, toggle-expanded, resets, clears, removals and resolve-parent. Queued output
   therefore keeps its order relative to those events.
4. When a queue passes `MAX_AGENT_SEGMENTS` segments or stream events, it flushes early. A hidden window
   runs no frames, so this keeps structured items within the store's own caps.
5. `ngOnDestroy` cancels the frame and clears both queue maps.
6. **R2 / R2.1 ordered fold.**
   - **While queued:** pending text that passes 2x the cap is trimmed from the front by
     `trimPendingOutput`, which writes no notice. The removed count is added to the private
     `_pendingDropped: Map<agentId, { stdout: number; stderr: number }>`, separately for each stream.
   - **At the flush:** for each stream, `appendToBuffer` takes the buffer body without its head notice,
     appends the pending raw text, and trims once at 2x the cap. It then writes a single notice at
     index 0 with the cumulative count: earlier notice + queue drops + this trim.

## Public AgentMonitorStore API kept

- No signal names or shapes changed: `agents`, `agentsById` and the other public computeds.
- The `MonitoredAgent` fields keep their names and types. `stdout` and `stderr` are still strings.
- `agent.expanded` is still set only by the existing paths (spawn, `toggleAgentExpanded` and the
  others). A delta never touches it; the spec `a delta never changes how agent.expanded is set` covers
  this.
- One public method was added: `flushPendingOutput()`. Callers and tests use it when they need the applied
  state synchronously.
- Binding commitment to TASK_2026_629: met.

## `storeAgentIds` location

It is in `libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts:140`:

```ts
computed(() => new Set(this.agentStore.agentsById().keys()), { equal: sameMembers })
```

- It already compares equal by membership (this predates Batch 4), so frames that only carry output do not
  re-run the release effect.
- It is not in `agent-monitor.store.ts`. No change was needed.

## Fixes made while finishing

1. **Defect, R2: a gap in the middle of the buffer.** `appendToBuffer` kept the applied body when the queue
   had dropped bytes. The result was `body + kept pending`, and the dropped bytes sat between the two while
   the notice described them as a loss at the head.
   - In the store this showed up when the applied body plus the kept queue text stayed at or under 2x
     the cap.
   - Fix: when `pendingDropped > 0`, drop the applied body too and add its length to the count. Every
     loss now sits at the head.
   - The unit test `adds bytes dropped from the queue to the head notice ...` in
     `agent-output-retention.spec.ts` was updated: it now asserts that the body equals the pending text and
     that the count is earlier + old body + 33.
2. **Lint and size.** The three module-level helpers were moved from `agent-monitor.store.ts` into the
   new `agent-output-frame.ts`.
   - Store imports `addCliUsage`, `hasReportedCliCacheTokens` and `appendToBuffer` were dropped because
     nothing uses them any more.
   - The store's line count under `max-lines` is now 1759 (1829 before the move).

## Check results (run from `D:\projects\ptah-wt-628`, under the heavy-check lock, one at a time)

| Command | Result |
|---|---|
| `npx nx typecheck @ptah-extension/chat-streaming --parallel=1` | pass |
| `npx nx lint @ptah-extension/chat-streaming --parallel=1 --skip-nx-cache` | 0 errors, 2 warnings. Both are pre-existing; see below. |
| `npx jest -c libs/frontend/chat-streaming/jest.config.ts agent-monitor agent-output-retention --coverage=false --maxWorkers=2` | 4 suites, 174/174 passed. Suites: `agent-monitor.store`, `agent-monitor.retention`, `agent-monitor.empty-session-id`, `agent-output-retention` |
| `npx nx typecheck @ptah-extension/chat --parallel=1` | pass |
| `npx nx lint @ptah-extension/chat --parallel=1 --skip-nx-cache` | 0 errors, 34 warnings. None are in Batch 4 files. |
| `npx jest -c libs/frontend/chat/jest.config.ts molecules/agent-card agent-monitor-tree-builder --coverage=false --maxWorkers=2` | 12 suites, 125/125 passed. Includes `agent-card.utils`, `agent-card-truncation`, `agent-card-unified`, `stdout-visibility` and both tree-builder specs. |
| `npx nx typecheck @ptah-extension/chat-ui --parallel=1` | pass |
| `npx nx lint @ptah-extension/chat-ui --parallel=1 --skip-nx-cache` | 0 errors, 7 warnings. None are in Batch 4 files. |
| `npx jest -c libs/frontend/chat-ui/jest.config.ts molecules/agent-card --coverage=false --maxWorkers=2` | 1 suite, 7/7 passed (`agent-card-output.component`) |
| `npx eslint <the 12 Batch 4 files, without agent-monitor.store.ts>` | no output: 0 warnings, 0 errors |

The two chat-streaming lint warnings:
- `agent-monitor.store.ts` `max-lines` (1759 > 700). This warning was already there before Batch 4: the
  base file counts 1713 lines by the same non-blank, non-comment measure. Batch 4 adds net lines but no
  new warning.
- `streaming-event-cascade-clean.spec.ts:8` has an unused `SeedTextDelta`. That file is not part of
  Batch 4 and was not touched.

## Decisions

- **`capBuffer` kept at 1x, new `appendToBuffer` for live output.** The plan's 4b text says to put the
  hysteresis into `capBuffer` itself. Instead, live output goes through `appendToBuffer` (2x hysteresis),
  and the restored-card path keeps calling `capBuffer` (1x), so a restored card states its loss at once.
  Both paths share the same cut and the same notice code.
- **No queue-only notice.** R2 forbids a notice before the fold, so no notice is ever written into queued
  text. The count lives only in the private per-stream map.
- **A queue drop also drops the applied body.** The order follows R2 (body without notice, then pending,
  then one trim). In addition, when the queue lost bytes, the whole applied body is counted as dropped:
  it is older than the lost bytes, and keeping it would put the loss in the middle of the buffer. This
  makes "notice only at index 0" true of the content, not just of the notice text.
- **Helpers in one new file.** The store's flush helpers now live in `agent-output-frame.ts`, which is not
  in the barrel. It has a type-only import of `MonitoredAgent` from the store, so there is no runtime
  cycle.
- **`updateAgents()` flushes before every write.** Every non-output writer flushes first instead of using
  the plan's per-agent `flushPendingOutput(agentId)`. The flush is a single write either way, and this
  keeps ordering correct for writers that touch several agents (clears, resolve-parent).

## Left open

- The `agent-monitor.store.ts` `max-lines` warning (pre-existing) needs a separate extraction task.
- The lane hidden-window behaviour has only unit-level coverage (fake rAF). Nobody has checked it by eye in
  a real hidden webview.
- Nothing is committed. The working tree also holds changes from Batches 3 and 5, which were not touched.

## Review round 1

### Changes
- `agent-monitor.store.ts` `ngOnDestroy`: calls `flushPendingOutput()` before clearing the queues, so the
  output queued before teardown is applied. The flush also cancels the scheduled frame.
- `agent-output-frame.ts` `PendingAgentOutput`: new `segmentChars` field (characters of segment content
  queued since the last flush). This is an internal type, not exported from the barrel.
- `agent-monitor.store.ts` `onAgentOutput`: adds each incoming segment's content length to `segmentChars`.
  The early flush now also runs when `usages.length > MAX_AGENT_SEGMENTS` (500) or
  `segmentChars > MAX_FRONTEND_BUFFER` (50 KiB), as well as on the existing segment and stream-event
  counts. The fold (`applyPendingOutput`) is unchanged. Every usage report is applied exactly once, and
  the rule that a restored card keeps `usageTotals` null still holds.

### Decisions
- Bounds reuse existing caps: 50 KiB (`MAX_FRONTEND_BUFFER`, the per-stream text cap) for queued
  structured characters and 500 (`MAX_AGENT_SEGMENTS`) for queued usage reports. A suspended queue
  therefore never holds more than one buffer's worth of content or one card's worth of reports before the
  store's own caps apply.
- An early flush was chosen over changing the fold, as the review asked. No public members were added.

### Tests
- Changed: the destroy test now expects the final buffer (`'pending'`) after `ngOnDestroy`, with the frame
  cancelled and nothing left to apply twice.
- Added (suspended frame clock): 1300 adjacent usage-bearing text deltas. The queued segment count stays at
  1 or less, queued usages stay at 500 or less, and the store applies them before any frame runs. The
  final `usageTotals` are exactly 1300 input and 2600 output, and all of the content is present.
- Added: 10 adjacent 20 KiB text deltas. Queued characters stay at 50 KiB or less, and all of the content
  is present after the frame.

### Check results
- `npx jest -c libs/frontend/chat-streaming/jest.config.ts <store, retention, output-retention specs> --coverage=false --maxWorkers=2`:
  3 suites, 159 tests passed.
- `npx nx typecheck chat-streaming --parallel=1`: passed.
- `npx nx lint chat-streaming --parallel=1`: passed, 0 errors and 2 warnings. One warning is the known
  `max-lines` warning on the store. The other is an unused `SeedTextDelta` at 8:11 in a file outside this
  batch.

### Open items
- The merged prose in the card's last `text` or `thinking` segment (`agent.segments`) has no character
  bound at store level. `capSegments` bounds only the segment count. This was already true before Batch 4
  and is outside this fix.
