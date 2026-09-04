# Code Logic Review — TASK_2026_376

**Commit:** `eca2c155b` — "fix(agent-sdk,chat-streaming,memory-curator): repair background agent and curator lifecycles"
**Reviewer:** code-logic-reviewer (behavioural correctness only)
**Date:** 2026-09-04
**Test run:** `npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/memory-curator @ptah-extension/chat-streaming @ptah-extension/chat @ptah-extension/shared @ptah-extension/rpc-handlers` — `Successfully ran target test for 6 projects`, all green.

---

## Score and verdict

**6.5 / 10 — APPROVE WITH FIXES**

F1, F2 and F3 are correct and complete. F4 is correct and closes the data-loss
path it was filed for. F8 raised the turn budget correctly, but it did **not**
adapt the response collector to a multi-turn run. That one omission re-opens the
same silent data-loss class F4 just closed, on a different path. Fix finding 1
before this ships. Findings 2 to 6 are smaller and can follow.

---

## Findings

### 1. HIGH — A multi-turn curator run concatenates every assistant message, and the JSON reader takes the FIRST object it finds

**Files:**
`libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts:406` (`collected += block.text`)
`libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts:486-507` (`extractJsonObject`)
`libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts:179` (`CURATOR_MAX_TURNS = 6`)

`maxTurns` moved from 1 to 6. With one turn there is exactly one assistant
message, so `collected` held one blob and `extractJsonObject` read it. With six
turns the SDK emits up to six assistant messages, and line 406 concatenates the
text of every one of them. `extractJsonObject` then scans from index 0 and
returns the FIRST balanced `{...}` in that concatenation.

Both new prompts state the opposite rule to the model: "your FINAL message must
contain ONLY the JSON object" (`extract-prompt.ts`, `resolve-prompt.ts`). The
prompt promises the last message. The parser reads the first object.

**Failure scenario A — a wrong but valid parse.**
Turn 1 assistant text: `Let me check what is already stored. Draft so far: {"memories": []}` plus a `tool_use` block.
Turn 2 assistant text: `{"memories":[{"subject":"build","content":"nx run-many"}]}`.
`extractJsonObject` returns `{"memories":[]}`. `ExtractedResponseSchema` accepts
it, so `parseDrafts` returns `[]`. `doCurate` takes the `drafts.length === 0`
branch (`memory-curator.service.ts:495`) and returns
`outcome: 'ran', extracted: 0`. `MemoryTriggerService.invokeCurate` then calls
`this.observationQueue.markProcessed(ids)`
(`triggers/memory-trigger.service.ts:825`). The real draft is discarded and the
observation rows are consumed. That session can never be curated again.

**Failure scenario B — a parse failure.**
Turn 1 text: `I will search memory for {subject: X} first.`
`extractJsonObject` slices `{subject: X}`, `JSON.parse` throws, the function
returns `null`, `parseDrafts` returns `[]`, and the same consumption happens.

Both were reproduced against the exact function body:

```
parsed:  {"memories":[]}     <- scenario A
parsed2: null                <- scenario B
```

**Suggested fix.** Track the text of the LAST assistant message separately from
the running total, and hand that string to `parseDrafts` and `parseResolved`.
`collected` may stay for logging. A second option is to scan candidate objects
from the end of the string toward the start and return the first one that both
parses and satisfies the schema. The first option matches the contract the
prompt already states.

---

### 2. MEDIUM — `tools-only` and `silent` report a successful run, and the caller consumes the input on that report

**Files:**
`libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts:287-299`
`libs/backend/memory-curator/src/lib/memory-curator.service.ts:495`
`libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:814-825`

Both new arms return `{ status: 'extracted', drafts: [] }`. That reaches
`doCurate` as an empty extraction, which returns `outcome: 'ran'`, which tells
`invokeCurate` to call `markProcessed`.

**Failure scenario.** The curator spends all six turns on `ptah_memory_search`
and `Read` calls and ends without a JSON message — for example because
`error_max_turns` cut the run at the ceiling. `runQuery` returns
`{ kind: 'tools-only' }`. `extract` logs at INFO and returns zero drafts. The
pass reports `ran` with `extracted: 0`, and the observation rows for that session
are marked processed. Nothing was extracted and the input is gone.

The `silent` arm has the same outcome and existed before this commit
(`{ kind: 'text', text: '' }` produced the same zero drafts). What changed is
that `CURATOR_MAX_TURNS = 6` makes the tool-using path common rather than
theoretical, so the arm is now reachable in normal operation.

`b5-report.md` files this honestly as outside its write boundary. It is still an
open requirement from `context.md` F8: "make the collector tolerate a run whose
useful work happened in tool calls rather than in text."

**Suggested fix.** Add a third arm to `CuratorExtraction` in
`libs/backend/memory-contracts/src/lib/curator-llm.port.ts` — for example
`{ status: 'no-output'; usedTools: boolean }` — and map it in `doCurate` to the
same `stalled` outcome `recordCuratorDeferral` already returns, so the input is
left for the next pass.

---

### 3. MEDIUM — `CuratorJobQueue` gives the one human-driven call site an unbounded wait with no cancellation

**Files:**
`libs/backend/memory-curator/src/lib/memory-curator.service.ts:294-306`
`libs/backend/memory-curator/src/lib/curator-llm/curator-job-queue.ts:59-72`
`libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts:623`

Every `curate()` call now joins one FIFO promise chain. The chain has no depth
limit, no wait ceiling, and no abort check before a queued job starts. Before
this commit each query carried its own 60-second queue budget, so a caller could
not wait longer than that per query.

**Failure scenario.** Three sessions trip their triggers at the same time.
`inFlightCurates` is keyed per session, so all three enter the queue. Each pass
now runs up to six turns per window across up to eight windows. The user then
clicks the control behind `memory:runNow`. That RPC calls `curate()` with no
`signal` (`memory-rpc.handlers.ts:623`), so its promise cannot be cancelled and
does not resolve until the three background passes finish. The RPC hangs, and
the user sees a spinner with no ceiling and no way to stop it.

**Suggested fix.** Give `CuratorJobQueue.run` a queue-wait ceiling, and reject a
waiter that exceeds it with the same `deferred` semantics
`recordCuratorDeferral` already carries. Also check `input.signal?.aborted` at
the top of `doCurate`, so a withdrawn caller does not run a full pipeline.

---

### 4. MEDIUM — `CURATOR_MAX_TURNS = 6` takes the curator out of the F6 compaction-hook guard

**Files:**
`libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts:538` (working tree, not part of this commit)
`libs/backend/memory-curator/src/lib/memory-curator.service.ts:158`

The uncommitted F6 work guards the compaction hooks with `maxTurns > 1`. Its own
comment states the hazard the guard exists to remove: if a `PreCompact` hook
does fire on a one-shot query, it fans the synthetic `internal-query-<epoch>` id
to `CompactionCallbackRegistry`, whose one subscriber is `MemoryCuratorService`.
With `maxTurns: 1` the curator was inside the guard. With `maxTurns: 6` it is
outside it, on exactly the pipeline the guard names.

**Failure scenario.** A curator window plus several `Read` tool results crosses
the 100 000-token compaction threshold within its six turns. `PreCompact` fires.
The `MemoryCuratorService.start()` callback receives
`sessionId: 'internal-query-1757…'`, `transcriptReader.read` fails on an id that
names no session, and the fallback calls
`this.curate({ sessionId: 'internal-query-1757…' })`. That queues a job on the
now-serial `CuratorJobQueue` behind the real pass. The job resolves to
`TRANSCRIPT_PLACEHOLDER` and returns `curator-skipped-no-data`, so the cost is
bounded — but the loop is real, and the log gains a false curation event.

This is a cross-batch interaction: B5 chose the number, and the F6 guard was
written against the old number.

**Suggested fix.** Guard the compaction hooks on the presence of a real Ptah
session id rather than on `maxTurns`, or reject the synthetic `internal-query-*`
id inside the `MemoryCuratorService` registry callback.

---

### 5. LOW — An invalid optional `toolCallId` now drops the whole terminal payload

**Files:**
`libs/shared/src/lib/types/sdk-hook.parsers.ts:234-237`
`libs/frontend/chat/src/lib/services/chat-message-handler.service.ts:331-338`

`readOptional` returns `false` when the key is present and fails
`isNonEmptyWireString`, and the parser then returns `null`. The message handler
drops the entire payload.

**Failure scenario.** A backend of a different version, or the CLI host, sends
`toolCallId: ''` on `session:subagentEnded`. Before this commit the field did
not exist and the payload was accepted. Now every such payload is dropped, so
`handleSubagentEnded` never runs: no background agent is stopped, and no
`backgroundTasks` snapshot reaches any tab. A malformed OPTIONAL field therefore
produces the exact symptom F1 was filed to fix, for every subagent in the
session.

The current producer (`session-lifecycle-notifier.ts:180-189`) attaches only
non-empty strings, so this cannot fire on today's in-process path. It is a wire
boundary, and the two sides ship independently.

**Suggested fix.** Ignore an invalid optional `toolCallId` instead of rejecting
the payload — assign `undefined` and continue. The required fields keep their
strict rules.

---

### 6. LOW — F1 has no repair when `SubagentStop` arrives before `background_agent_started`

**Files:**
`libs/frontend/chat/src/lib/services/chat-store/turn-end-handler.service.ts:143-153`
`libs/frontend/chat-streaming/src/lib/background-agent.store.ts:288-296`

`adoptRealAgentId` returns `null` when `findByToolCallId` finds nothing, and
`handleSubagentEnded` then does nothing.

**Failure scenario.** A very short background agent stops before its placeholder
tool_result is transformed. `session:subagentEnded` reaches the webview first,
the store is empty, and the re-key is declined. `background_agent_started`
arrives afterwards, and by then the registry record has been deleted by
`SubagentRegistryService.update` (`subagent-registry.service.ts:301-318`), so
`event.agentId` is undefined and `resolveKey` files the entry under its
`toolCallId` again. Nothing ever stops it. The card stays `running` for the life
of the process.

This is the original F1 symptom in the opposite order. It is pre-existing and is
not made worse by this commit, so it is recorded rather than blocking.

**Suggested fix.** Keep a small bounded map of `toolCallId` to `agentId` pairs
seen on `SubagentStop` but not yet matched, and consult it in
`BackgroundAgentStore.onStarted`.

---

## Checked and found CORRECT

The items below were traced end to end. The next reader does not need to
re-check them.

### F1 — background agent terminal state

- `SubagentStopHookHandler` reads the SDK `toolUseID` positional argument
  (`subagent-stop-hook-handler.ts:46`, `:87-103`) and forwards it only when it
  is a non-empty string. `HookCallback` types it `string | undefined`
  (`sdk.d.ts:785`), and `SubagentHookHandler` already logs and consumes it on
  the same hook, so the source is real.
- The comment's claim that the registry cannot serve as a second source is
  correct. `SubagentRegistryService.update` DELETES the record on `'completed'`
  and `'background_completed'` (`subagent-registry.service.ts:301-318`), and the
  `SubagentHookHandler` twin performs that update on the same hook.
- `SdkSubagentEndedPayloadSchema` does not declare `toolCallId`, so `safeParse`
  strips it, and `SessionLifecycleNotifier` re-attaches it under the same
  non-empty-string rule the webview parser applies
  (`session-lifecycle-notifier.ts:180-189`). Validation of every REQUIRED field
  is unchanged. The divergence is documented in both files. It is a maintenance
  hazard, not a defect — see finding 5 for its one behavioural consequence.
- `adoptRealAgentId` leaves the store consistent. It declines the write in all
  four stated cases and returns the SAME map, so `applyMutation` does not bump
  `revision` on a no-op. When it does write, it builds a NEW `Map`, so the
  identity check fires and `revision` increments exactly once — which is what
  `ExecutionTreeBuilderService.computeGlobalEpoch` requires.
- `isBackgroundAgent(originalToolCallId)` still returns `true` after the re-key.
  The re-keyed entry keeps its `toolCallId` field, and `isBackgroundAgent` scans
  that field rather than the map key (`background-agent.store.ts:240-245`).
- `backgroundToolCallIds` does not change across a re-key, and its custom
  equality correctly suppresses a notification. The tree cache still
  invalidates, through `revision`.
- The follow-on `onStopped` call resolves its key through
  `resolveKey(event.agentId, …)`, and `payload.agentId` is present, so it
  addresses the entry at its new key. Consistent.

### F2 — inline agent card terminalising early

- `background_agent_started` is now pushed at
  `assistant-message.transformer.ts:277-288`, ahead of the `tool_result` event
  at `:300-312`. Both live inside the SAME `isToolResultBlock` branch of the
  per-block loop, so the ordering holds per block. A message carrying several
  `tool_result` blocks produces a correct pair for each one, and the events do
  not interleave across blocks.
- No stage reorders the array. `StreamingAccumulatorCore.process` handles one
  event at a time in array order, and `background_agent_started` writes through
  `BackgroundAgentStore.onStarted` to `applyMutation` to `signal.update`, which
  is synchronous. So by the time the `tool_result` case reads
  `isBackgroundAgent(event.toolCallId)` at `accumulator-core.service.ts:435`,
  the entry is present. The guard is now true by construction, which is the
  inverse of the filed defect.
- The `isBackgroundedToolResult` substring match is retained as a second guard
  for the mid-run backgrounding path, which emits no `background_agent_started`.
  Keeping it is correct. It is no longer load-bearing.

### F3 — empty assistant bubbles

- `if (block.text)` at `assistant-message.transformer.ts:136` mirrors the
  `if (block.thinking)` guard at `:126` exactly.
- `blockIndex` semantics are preserved. `contentIndex` is the loop counter over
  `content` (`:118-119`) and is computed independently of whether an event is
  pushed. Skipping an empty block does not shift the index of any later block,
  so `AccumulatorKeys.textBlock(messageId, blockIndex)` and the
  `textParts.sort((a, b) => a.blockIndex - b.blockIndex)` in
  `message-finalization.service.ts:565` are unaffected.
- The guard cannot drop a block the frontend needs. A text block that streamed
  content is not empty in the complete message, so the `pendingTextClear` and
  `setBlockAccumulator` path at `accumulator-core.service.ts:298-303` still
  receives a complete event for every block that has content.
- ACCEPTED TRADE, not a finding: a message whose only block is empty text now
  produces zero events and is skipped at `:333`, so its `message_complete` — and
  with it `tokenUsage` and `cost` — is not emitted. `SESSION_STATS` is the
  authoritative cost source (`chat-message-handler.service.ts:287`), so no
  user-visible number becomes wrong. The same skip already applied to zero-block
  messages before this commit.

### F4 — curator losing a curation window

- The fix does close the filed defect. `CuratorJobQueue` is a field of a
  `Lifecycle.Singleton` service (`memory-curator/src/lib/di/register.ts:135-139`),
  so "one pass at a time" is host-wide. With one pass in flight the
  `memory-curator` lane is empty when window N+1 calls `acquire`, and
  `InternalQueryConcurrencyGate.admissible` passes immediately on both ceilings
  (`internal-query.service.ts:272-276`). The `blockedBy: "lane"` wait recorded in
  `context.md` cannot recur.
- `lane: 'memory-curator'` still has exactly one call site
  (`sdk-internal-query.curator-llm.ts:387`), and skill-synthesis deliberately
  shares ONE lane across its four routes
  (`lanes/lane-runner.service.ts:568-579`). So the global ceiling of 2 admits at
  most one competitor. The premise `CuratorJobQueue` rests on holds.
- `drain` scans the waiter queue rather than taking its head
  (`internal-query.service.ts:157-166`), so a blocked skill-synthesis waiter
  cannot head-of-line-block a curator window.
- The failure is now reported honestly. `recordCuratorDeferral` returns
  `outcome: 'stalled'`, and `invokeCurate` reacts to `'stalled'` by reattaching
  the episode and NOT calling `markProcessed`
  (`triggers/memory-trigger.service.ts:814-825`). `drainForSession` is a pure
  read (`observation-queue.store.ts`, and the comment at
  `memory-trigger.service.ts:766`), so the rows survive for the next drain. The
  boot scan makes the same distinction at `:1007`.
- The whole-job budget is bounded and shared. `QueueSlotRetryBudget` is created
  once per pass (`memory-curator.service.ts:459`) and passed to BOTH
  `extractAcrossWindows` and `resolveWithinBudget`, so a pass can wait at most
  `CURATOR_QUEUE_RETRY_BUDGET + 1` slot cycles in total, not per window.
- `CuratorJobQueue.run` cannot break its chain on a rejection: `tail` is the
  settled-either-way continuation, and the caller receives the real promise.
  `depth` is decremented on both settlement paths.
- `isQueueSlotTimeout` walks the `cause` chain to a fixed depth of 8, so a cycle
  in caller-supplied error data cannot hang the curator. Matching by `name`
  rather than `instanceof` is required here, because importing the class would
  close a dependency cycle back into `agent-sdk`.
- Coalescing is checked BEFORE the enqueue (`memory-curator.service.ts:285-287`),
  so a second trigger for a session already queued joins the existing entry
  rather than adding a duplicate.

### F8 — the curator turn budget

- The `maxTurns` semantics cited in the docblock match the installed SDK.
  `HookCallback`, `Options.maxTurns` and `error_max_turns` as a RESULT subtype
  are all present in `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`. One
  turn is one API round-trip, so `maxTurns: 1` genuinely could not carry a
  `tool_result` back to the model.
- `hitTurnCeiling` reads `subtype === 'error_max_turns'` off the `result`
  message. That is the correct signal, and it is the only place an exhausted
  budget is visible, because the SDK does not throw on it.
- `includePartialMessages: true` is set on one-shot options
  (`sdk-query-runner.service.ts:409`), but the collector filters on
  `msg.type === 'assistant'`, so partial `stream_event` messages do not
  double-count text or tool uses.
- Six turns does NOT re-open F4. Windows within a pass are sequential, the lane
  is released between them, and `CuratorJobQueue` removes the only other
  `memory-curator` competitor. A longer run therefore delays the next window,
  but it cannot make that window time out.

### Other

- `isTerminalTurnPhase` in
  `libs/shared/src/lib/types/execution/stream-background.ts:233-252` is unrelated
  carry-in from TASK_2026_371. The set matches its documented contract — every
  phase except `'generating'`.
- All six projects' tests pass on the working tree.
