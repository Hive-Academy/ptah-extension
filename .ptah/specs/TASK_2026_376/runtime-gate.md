# TASK_2026_376 — runtime gate

- Date: 2026-09-08
- Branch: `fix/in-review-blockers` (worktree branch; the task's own history
  ships through `fix/empty-assistant-bubbles` upstream of this worktree)
- Worktree: `D:\projects\ptah-extension\.claude-worktrees\in-review-blockers`
- `git rev-parse HEAD`: `a008d9841399a68e83b9fc7be39b3eed3eca50e5`
- Working tree was NOT clean: other lanes were editing this worktree
  concurrently while the build and the test runs in §A executed
  (uncommitted changes in `sdk-query-runner.service.ts`,
  `streaming-handler.service.ts`, `message-dispatch.service.ts`,
  `message-sender.service.ts`, `chat-input.component.ts` and their specs,
  plus `agent-generation`, `cli-agent-runtime`, `setup-wizard`). None of the
  files cited in §B is among them, but the numbers in §A are for HEAD plus
  that in-flight work, not for HEAD alone.
- The code under test includes commit `1bd7610d4` ("fix(chat-streaming): stop
  minting empty assistant bubbles from orphaned subagent messages",
  2026-09-06). `git merge-base --is-ancestor 1bd7610d4 HEAD` confirms it is
  already an ancestor of HEAD. Its own commit message states behaviours 2 and
  3 were still observed live three days after TASK_2026_376's original fix
  reached `main` — that is itself evidence the 2026-09-03 fix did not fully
  close the gate, so this gate evaluates the tree AFTER 1bd7610d4, not the
  original TASK_2026_376 diff alone.

## A. Electron e2e run

Command: `npx nx run ptah-electron-e2e:e2e --configuration=ci`, run from the
worktree root on 2026-09-08 (local time 01:57-03:20). The orchestrator ran it;
the lane agent did not.

**Environment fix needed before the build would run.** The worktree's
`node_modules` held only an `ng-packagr` tsbuildinfo cache. Jest resolves
packages by walking up to `D:\projects\ptah-extension\node_modules`, but the
Angular builder resolves `angular.json` `styles`/`scripts` entries such as
`node_modules/prismjs/themes/prism-tomorrow.css` relative to the workspace
root, so the first attempt failed with three `Could not resolve` errors and
never reached Playwright (`EXIT=130`). `package.json` in this worktree is
byte-identical to the main checkout's, so the cache dir was replaced with a
directory junction `node_modules -> D:\projects\ptah-extension\node_modules`
(gitignored; not a source change) and the run was repeated.

**Build (second attempt): green.**

```
NX   Successfully ran target build for project ptah-extension-webview and 3 tasks it depends on
NX   Successfully ran target build-main for project ptah-electron
NX   Successfully ran target build-preload for project ptah-electron
NX   Successfully ran target build-embedder-worker for project ptah-electron
NX   Successfully ran target build-voice-worker for project ptah-electron
Running 164 tests using 1 worker
```

`dist/apps/ptah-electron/main.mjs` written 2026-09-08 02:19:58.

**Full suite: NOT completed.** 37 of 164 specs ran in ~55 minutes (25 passed,
12 failed) before the orchestrator stopped the run. At ~90 s per spec the
remaining 127 would have needed ~3 more hours. Every failure sat at the 60 s
spec timeout (reported at 1.2-1.3 m including teardown) and they were
scattered across unrelated areas — `auto-updater` (2), `canvas` (1),
`clipboard` (2), `electron-browser-capabilities` (1), `git/*` (5),
`chat/streaming-message-handlers` (1). During that window two other Jest runs
were competing for the same machine (the lane agent's `run-many` and the
orchestrator's own, §B below), and the main-process log shows
`SDK supportedModels() timed out after 15000ms` during boot. Read the 12
failures as host contention, not as verdicts on the specs: the one chat spec
among them passed cleanly when re-run alone (next paragraph).

**Task-relevant subset, re-run alone after the full run was stopped
(`npx playwright test --config=playwright.config.ts --reporter=list src/specs/chat`,
cwd `apps/ptah-electron-e2e`):**

```
ok 1 chat/empty-assistant-envelope.spec.ts:117 › a naked message_start/message_complete envelope sharing a message id with a real text delivery renders one visible bubble, not an empty "Assistant response" placeholder (13.6s)
ok 2 chat/empty-assistant-envelope.spec.ts:161 › the naked envelope alone (no follow-up ever) reproduces the pre-fix empty "Assistant response" bubble — proving the assertions above are falsifiable (12.7s)
ok 3 chat/streaming-message-handlers.spec.ts:63 › valid payloads for all six rewritten schemas are accepted (no reject warning), with the app never having opened a chat session (11.8s)
ok 4 chat/streaming-message-handlers.spec.ts:190 › invalid payloads for turnEnded and permission:request are rejected (reject warning fires), proving the reject path still works too (13.7s)
4 passed (52.5s)
```

And `src/specs/thoth/memory.spec.ts` alone: `3 passed (1.0m)`.

**Which specs touch this task's behaviours, and how far they reach.**

- `chat/empty-assistant-envelope.spec.ts` — behaviour 3, rendering half only.
  Injects `chat:chunk` events over IPC via `ui.pushEvent`; no SDK. Passed.
- `chat/streaming-message-handlers.spec.ts` — adjacent to behaviour 1: proves
  the real app accepts and rejects `session:subagentEnded` payload shapes.
  Never omits `agentId`, never sends `toolCallId`, never reads
  `BackgroundAgentStore`. Passed.
- `thoth/memory.spec.ts` — adjacent to behaviour 4 only in that it renders
  the Memory tab over mocked RPC. Never reaches the curator. Passed.
- No e2e spec pushes `background_agent_started`, a backgrounded-placeholder
  `tool_result`, an orphaned post-turn subagent message, or a curation
  window. Behaviours 1, 2 and 4 have zero e2e coverage; behaviour 3 has
  e2e coverage of the TASK_2026_366 envelope shape, not of the
  `1bd7610d4` orphaned-subagent path.

**Unit suites, run by the orchestrator on this tree**
(`npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/memory-curator @ptah-extension/chat-streaming @ptah-extension/chat @ptah-extension/shared --skip-nx-cache`):

```
NX   Running target test for 5 projects
Test Suites: 54 passed, 54 total                 Tests: 1254 passed
Test Suites: 2 skipped, 30 passed, 30 of 32      Tests: 60 skipped, 478 passed
Test Suites: 1 skipped, 86 passed, 86 of 87      Tests: 2 skipped, 1442 passed
Test Suites: 22 passed, 22 total                 Tests: 1 skipped, 451 passed
Test Suites: 64 passed, 64 total                 Tests: 2 skipped, 1008 passed
NX   Successfully ran target test for 5 projects
```

5 projects requested, 5 reported. 4633 passed, 0 failed. Each project printed
Jest's "worker process has failed to exit gracefully" warning — the leaked
queue waiters the gate review's O4 describes — but no test failed on this
run. Every spec cited in §B is inside this set.

## B. Per-behaviour evidence

### Behaviour 1 — the missing-`agentId` warning stops, or the agent still reaches a terminal state

**(i) Code.**

- `libs/shared/src/lib/types/sdk-hook.types.ts:161` — `SdkSubagentEndedPayload.toolCallId` is now `readonly toolCallId?: string`, an optional field, with a doc comment (`:151-156`) explaining `agentId` and `toolCallId` are two identity spaces.
- `libs/shared/src/lib/types/sdk-hook.schemas.ts:109` — `toolCallId: z.string().min(1).optional().catch(undefined)`, so an invalid value degrades to absent instead of rejecting the whole payload (R2's resolution of the finding-1/finding-5 conflict in the review round).
- `libs/shared/src/lib/types/sdk-hook.parsers.ts:244-245` — `readOptionalCaught(payload, 'toolCallId', isNonEmptyWireString, ...)` carries the field through the hand-rolled parser.
- `libs/backend/agent-sdk/src/lib/helpers/subagent-stop-hook-handler.ts:87-103` — the producer. It reads the SDK hook's `toolUseID` (`:93`) and includes it on the payload only when present (`:103`), with a comment recording that this is the ONLY place the `agentId` ↔ `toolCallId` pairing is still available, because the `SubagentHookHandler` twin deletes the registry record on the same hook first.
- `libs/frontend/chat-streaming/src/lib/background-agent.store.ts:301-330` (`adoptRealAgentId`) — re-keys a `toolCallId`-filed entry onto the real `agentId` once it arrives, flipping `hasRealAgentId` to `true` (`:326`). The console warning itself is unchanged and still fires at `:226-227` (`[BackgroundAgentStore] background_agent event missing agentId; falling back to toolCallId as storage key`) — the fix does not silence the warning, it gives the entry a repair path afterwards.
- `libs/frontend/chat/src/lib/services/chat-store/turn-end-handler.service.ts:145-151` — the consumer. `findByAgentId(payload.agentId)` is tried first; on a miss, and only when `payload.toolCallId` is present, it falls through to `adoptRealAgentId(payload.toolCallId, payload.agentId)` before finalising the stop.

**(ii) Unit specs.** `libs/frontend/chat/src/lib/services/chat-store/turn-end-handler.rekey.spec.ts`:
- `'reaches a terminal state when the started event had no agentId'` (line 131)
- `'keeps isBackgroundAgent(originalToolCallId) true after the re-key'` (line 147)
- `'marks the re-keyed entry with hasRealAgentId'` (line 159)
- `'bumps revision once for the re-key and once for the stop'` (line 174)
- `'behaves exactly as before when the payload carries no toolCallId'` (line 185)
- `'leaves an entry that already had a real agentId on the existing path'` (line 200)
- `'does not adopt an entry belonging to a different Task tool call'` (line 215)

Pass/fail: all seven passed in the 5-project run recorded in §A (`@ptah-extension/chat`).

**(iii) Electron e2e.** `apps/ptah-electron-e2e/src/specs/chat/streaming-message-handlers.spec.ts` sends a `session:subagentEnded` payload with `agentId: 'agent-1'` set (line 118-128) and asserts the schema accepts it without a reject warning — that is a **parser-shape test** (Unit 10, TASK_2026_187), not a test of the missing-`agentId` → `toolCallId` fallback → `adoptRealAgentId` re-keying path. It never omits `agentId`, never supplies `toolCallId`, and never inspects `BackgroundAgentStore` state. It exercises an adjacent surface (payload validation), not this behaviour. `empty-assistant-envelope.spec.ts` and `apps/ptah-electron-e2e/src/specs/thoth/memory.spec.ts` do not touch this behaviour at all.

**(iv)** Observed live: NO — requires a human-driven Electron session with a real SDK background subagent whose `SubagentStart` hook fires after the placeholder tool_result; nothing in this tree drives the real SDK.

### Behaviour 2 — the inline agent card tracks real state instead of showing `completed` early

**(i) Code.**

- `libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.ts:288-324` — `background_agent_started` is pushed at `:299` (`events.push(bgEvent)`), strictly before the `tool_result` push at `:324` (`events.push(toolResultEvent)`), for the same `tool_use_id`. The comment at `:277-287` states the ordering is load-bearing (TASK_2026_376 F2) and must not be reversed — this is the Style-3 WHY comment the orchestrator closed after the review round.
- `libs/frontend/chat-streaming/src/lib/accumulator-core.service.ts:442-443` — the guard: `backgroundAgentStore.isBackgroundAgent(event.toolCallId) || isBackgroundedToolResult(event.output)`. With the ordering above, the first half is now true by construction when the store has registered the agent.
- `libs/frontend/chat-streaming/src/lib/accumulator-core.service.ts:179` — `BACKGROUNDED_TOOL_RESULT_MARKER` was broadened from the literal `'running in the background'` to the bare substring `'in the background'` by commit `1bd7610d4`, because Claude Code 2.1.259 words its placeholder "working in the background" and omits `run_in_background` from the tool input on its own default background-spawn path, so the narrower marker missed it and every such agent was terminalised on its own placeholder — a second live occurrence of the same symptom F2 named, three days after the original fix.

**(ii) Unit specs.**
- `libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.spec.ts:624` — `'emits background_agent_started BEFORE the tool_result for the same toolCallId'`.
- `libs/frontend/chat-streaming/src/lib/accumulator-core.service.spec.ts:868` — `'background_agent_started → onStarted'`; `:876` `'background_agent_stopped → onStopped'`.
- `libs/frontend/chat-streaming/src/lib/accumulator-core.service.spec.ts:921` — `'skips the SDK "running in the background" placeholder tool_result'`; `:931` — `'skips the Claude Code 2.1.259 "working in the background" placeholder (default background spawn)'`, added by `1bd7610d4`.

**(iii) Electron e2e.** None of the three named specs drive a real Task tool_use / tool_result pair through the transformer or exercise `BackgroundAgentStore`'s card-state transitions. `streaming-message-handlers.spec.ts` only validates the `session:subagentEnded` payload shape (see behaviour 1). No e2e spec pushes a `background_agent_started` or a backgrounded-placeholder `tool_result` chunk and asserts on a rendered card's status. This behaviour has unit coverage only.

**(iv)** Observed live: NO — requires a live session where a background subagent (Task tool) keeps running past its placeholder tool_result; nothing in this tree drives the real SDK.

### Behaviour 3 — no empty `Assistant response` bubbles

**(i) Code.**

- `libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.ts:136` — the text branch is now guarded with `if (block.text)`, matching the thinking-branch guard immediately above it, so a text block whose `text` is `''` no longer unconditionally pushes a `text_delta`.
- `libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.ts:344` — `if (events.length === 0)` still skips a content-free delivery entirely (the pre-existing, correct guard F3 confirmed was never the cause).
- `libs/frontend/chat-streaming/src/lib/message-finalization.service.ts` empty-tree branch, rewritten by `1bd7610d4`: when `finalTree.length === 0`, if there is a `pendingStats` and the last message in the tab is an assistant message that is not already finalised, the pending token/cost/duration stats are folded onto that LAST assistant message instead of minting a new one with `streamingState: null`; otherwise the branch now only calls `clearStreamingForLoaded` and returns. Before this commit, that branch minted an empty assistant message carrying the orphaned subagent's 2-5 token usage whenever `messageId` was not already known — the literal empty "Assistant response" bubble.

**(ii) Unit specs.**
- `libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.spec.ts:198` — `'suppresses envelopes for an empty-string text block'`; `:141` `'suppresses envelopes for signature-only empty thinking'`; `:222` `'still emits text_delta with the correct blockIndex for a non-empty text block'`.
- `libs/frontend/chat-streaming/src/lib/message-finalization.service.spec.ts:287` — `'does not mint an empty assistant message when the tree has no root'`; `:307` — `'folds pending stats onto the last assistant message when the tree has no root'`. Both added by `1bd7610d4`.

**(iii) Electron e2e.** `apps/ptah-electron-e2e/src/specs/chat/empty-assistant-envelope.spec.ts` is purpose-built to pin this exact defect shape (its own header comment cites "23 real transcripts, 265/612 signature-only-empty thinking blocks"). It injects `chat:chunk` (`MESSAGE_TYPES.CHAT_CHUNK`) `FlatStreamEventUnion` payloads directly over the `to-renderer` IPC channel via `ui.pushEvent` — there is no real SDK anywhere in this harness — and asserts on `[data-testid="chat-tool-output"]` for the literal fallback title `'Assistant response'`. It is real coverage of the RENDERING half of behaviour 3 (a content-free delivery reaching the UI as a titled bubble) but it does not exercise the orphaned-background-subagent PRODUCER path `1bd7610d4` fixed (`message-finalization.service.ts`'s empty-tree branch folding pending stats) — that path only fires when a background task settles after its parent turn ended, a timing this harness's synthetic chunk injection does not reproduce. `streaming-message-handlers.spec.ts` and `thoth/memory.spec.ts` do not touch this behaviour.

**(iv)** Observed live: NO for the `1bd7610d4` orphaned-subagent-message path specifically — requires a live session with a background subagent still streaming after its parent turn ends and a settling turn_state on another task, which needs a real SDK. The narrower empty-content-block rendering path IS exercised by `empty-assistant-envelope.spec.ts` against injected events, which is closer to observed-in-the-app than the other three behaviours, but it is still not a real SDK session.

### Behaviour 4 — a multi-window curation completes without an `extracted: 0` from a sibling timeout

**(i) Code.**

- `libs/backend/memory-curator/src/lib/curator-llm/curator-job-queue.ts:61` — `CURATOR_QUEUE_WAIT_CEILING_MS = 180_000`, replacing the destructive 60 s `InternalQueryQueueTimeoutError` wait that F4 diagnosed. `CuratorJobQueue.run` (`:118-159`) gives the CALLER its own promise, separate from the serialising chain, so a waiter past the ceiling rejects with the new `CuratorQueueWaitTimeoutError` (`:70-77`) without breaking the chain or letting two passes run at once.
- `libs/backend/memory-curator/src/lib/curator-llm/queue-slot-timeout.ts` — recognises `InternalQueryQueueTimeoutError` (the GLOBAL-ceiling timeout from `agent-sdk`) by error name through a bounded `cause` walk, feeding `QueueSlotRetryBudget` (one allowance of 2, shared across every extract window plus the resolve call of a single pass) so one congested window can retry against the same query instead of failing the whole pass.
- `libs/backend/memory-curator/src/lib/curator-llm/curator-window-runner.ts:209-221` — a `no-output` window (§ see behaviour-4-adjacent defect below) and a `stalled` window both abandon the pass rather than unioning the remaining windows' drafts into a result the caller would read as complete.
- `libs/backend/memory-curator/src/lib/memory-curator.service.ts:360-367` — `curate()` catches `CuratorQueueWaitTimeoutError` and returns `recordCuratorDeferral(..., 'curator-queue-wait-timeout')`, mapped to `outcome: 'stalled'`.
- `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:814-825` — `stats.outcome === 'stalled'` reattaches the detached episode and returns WITHOUT calling `observationQueue.markProcessed`, so a deferred pass keeps its drained observations for the next drain.

**(ii) Unit specs.**
- `libs/backend/memory-curator/src/lib/curator-llm/curator-job-queue.spec.ts:70` — `'rejects a waiter that never gets its turn within the ceiling'`; `:152` `'ships a bounded default ceiling'`; plus (not individually re-quoted here) the sibling specs for "lets a later pass run normally after an abandoned one" and "never rejects a pass that gets its turn inside the ceiling".
- `libs/backend/memory-curator/src/lib/curator-llm/curator-window-runner.spec.ts:139-236` — the queue-slot-timeout describe block: `'re-queues the window that lost its slot and keeps its drafts'`, `'a sibling window still runs after the first one had to wait'`, `'defers rather than failing once the allowance is spent'`, `'shares ONE allowance across the whole window set'`, `'still reports a non-congestion failure as failed'`, `'does not re-queue a window whose pass was aborted'`. Line `283` — `'carries the arm to the caller and stops spending windows'` (the `no-output` abandonment case).
- `libs/backend/memory-curator/src/lib/memory-curator.service.spec.ts:1211` — `'a stalled window stops the loop and takes the stall path'`; `:1677` — `'maps a NO-OUTPUT extraction to stalled, so the observations survive'`.

**(iii) Electron e2e.** `apps/ptah-electron-e2e/src/specs/thoth/memory.spec.ts` mocks `memory:stats`, `memory:list` and `memory:searchSymbols` RPCs with fixture data (lines 50-60) to render the Memory tab — it never invokes `MemoryCuratorService.curate`, never drives `CuratorWindowRunner`, and never touches the curator LLM path. **There is no e2e coverage of the curator LLM path**, congested or otherwise, anywhere in `apps/ptah-electron-e2e`.

**(iv)** Observed live: NO — requires a live session that splits into multiple curation windows AND a concurrent competing pass on the `memory-curator` lane (the exact two-session collision the original F4 capture showed), which is not reproducible without a real multi-window transcript and a real internal-query concurrency contest.

## C. What cannot be observed without a human

- All four acceptance behaviours require a live Electron session with a real `@anthropic-ai/claude-agent-sdk` connection: a background `Task` subagent whose `SubagentStart` hook can race its own placeholder tool_result (behaviour 1), a subagent that keeps streaming past its parent turn's terminal `turn_state` (behaviours 2 and 3's `1bd7610d4` path specifically), and a transcript that plans multiple curation windows while a second session's pass is queued behind it on the same lane (behaviour 4).
- None of the three named Electron e2e specs drives the real SDK; all three inject synthetic IPC payloads or mock RPC responses. This is a structural property of the current e2e harness (documented in its own spec comments), not a gap introduced by this task.
- The curator LLM path (`InternalQueryService` → `SdkInternalQueryCuratorLlm` → the real provider) has zero e2e coverage of any kind, congested or not.

## D. Follow-up filed

`TASK_2026_391` — the curator's `extract()` fall-through arm (`sdk-internal-query.curator-llm.ts:315`) still cannot distinguish an honest empty extraction from a final assistant message that is prose or truncated/malformed JSON, so `MemoryTriggerService` consumes the session's observations on a pass that never actually read anything extractable — the same data-loss shape F4/R1 just closed on the `tools-only`/`silent`/queue-timeout arms, left open on this one arm.

## E. Recommendation

**No — TASK_2026_376 cannot move to `done` on this evidence.** Keep it at
`in_review`.

Why, in order of weight:

1. **The task's own gate is a live-session gate, and no live session has been
   run.** `context.md:385-401` names four behaviours that must be confirmed
   in one Electron session with a real background subagent and a compaction.
   This lane established that nothing in the tree can produce that
   observation: every e2e spec injects synthetic IPC payloads or mocks RPC,
   and the curator LLM path has no e2e coverage at all (§C). All four
   behaviours are recorded above as **Observed live: NO**. A unit spec that
   passes proves the code does what it says; it does not prove the symptom a
   human watched on 2026-09-03 is gone, which is the distinction the task's
   author drew when refusing `done` the first time.
2. **The code under test already needed a second fix for two of the four
   behaviours.** `1bd7610d4` (2026-09-06) re-fixed behaviours 2 and 3 three
   days after the 376 fixes reached `main`, and its commit message records
   that both were still observed live: the placeholder marker did not match
   Claude Code 2.1.259's wording, and orphaned subagent messages still minted
   empty bubbles. That is direct evidence the original 376 fix did not close
   the gate, and it is the strongest argument for insisting on a live run
   now rather than inferring one: the shape that broke was a runtime wording
   change and a cross-turn timing that no unit spec anticipated.
3. **What this lane DID establish, so the live run is the only thing left.**
   The Electron app builds from this tree; the 4 chat e2e specs and the 3
   memory-tab specs pass; 4633 unit tests across the five relevant projects
   pass, including every spec that pins the 376 and `1bd7610d4` logic; and
   every file:line cited in §B was re-read in this tree. The engineering
   evidence is complete. The product evidence is absent.
4. **The curator follow-up is filed** (`TASK_2026_391`, §D), so gate Blocker
   1 no longer needs to hold 376 hostage — but that does not substitute for
   the session.

What would flip this to `yes`: one human-driven Electron session on a build
from this tree (or later), with a `Task` subagent spawned in the background
under Claude Code 2.1.259 or newer and a `/compact` mid-session, recording
for each of the four behaviours what the console and the transcript showed.
Append that record to this file. If behaviours 1-3 hold and behaviour 4 can
only be partially provoked (it needs two sessions contending for the
`memory-curator` lane), say so and let the reviewer decide whether the
`curator-job-queue.spec.ts` ceiling proof is enough for 4.

Caveat on the e2e evidence itself: the full 164-spec suite was stopped at 37
with 12 timeouts under host contention (§A). Those failures are outside this
task's surface and were not diagnosed here; a quiet-machine run of the full
suite is worth doing before the next Electron release, but it is not a
condition on 376.
