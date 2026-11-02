# Code Logic Review — D9 fix batches 3+4 (native sub-agent card)

Review family: claude (in-process subagent); implementer: codex

Scope: `git diff` of codex-event-translator.ts, codex-runtime.types.ts, codex-context.ts, codex-chat-events.ts, codex-history-projector.ts and their specs. Read-only; nothing was executed (no test/typecheck), so spec type-checking is UNVERIFIED. `codex-chat-turn-lifecycle.spec.ts` has no diff (listed in the brief, not changed).

Score: 6/10. Verdict: REVISE.

## Contract identity (check 1): mostly matches
- `tool_start` Task with `isTaskTool:true`, `toolInput.subagent_type/description/prompt`, `agent_start` with `toolCallId`/`agentId`/`parentToolUseId = tool id`, and child events tagged `parentToolUseId` match Claude's producers (stream-event.transformer.ts:401-428, system-message.transformer.ts:284-301) and the frontend gate `isTaskTool || isAgentDispatchTool` + `agentStarts.find(parentToolUseId === toolCallId)` (agent-monitor-tree-builder.service.ts:710-760). The agents panel should list the card.
- Differences: `agentType` is invented constant `'codex'` (acceptable, neutral, not 'unknown'); spawn `tool_result.output` is `{receiverThreadIds}` JSON, not the sub-agent's final text as in Claude (see D7).

## Defects

1. **SERIOUS — history: duplicate event ids for multiple spawns in one turn.** codex-history-projector.ts (terminal push, `id: JSON.stringify([thread.id, turn.id, 'terminal', entry.eventType])`). Root `terminal` now returns `unresolvedAgentResults` (all held spawn `tool_result`s) plus `message_complete`; every `tool_result` gets the identical id. A turn that spawns 2+ agents (common) yields colliding ids; id-keyed dedupe in the replayer can drop results, leaving cards Running. Fix: include `toolCallId` (or index) in the id for non-`message_complete` terminal entries.
2. **SERIOUS — history/live ordering parity and fragility.** In history, root projection never receives child events, so the spawn result is always flushed at root terminal and then re-timestamped to `min(child message_complete)+1` (codex-history-projector.ts ordered map). Live waits for ALL receivers (`remaining` set, codex-chat-events.ts map terminal branch), history uses the FIRST child completion: different sequence for multi-receiver spawns. Also depends on timestamps being distinct/non-zero; `itemTime` fallbacks make ties likely and ordinal tie-break then keeps the original order (result may precede child completion). Fix: derive completion in history from the same "all receivers terminal" rule (max of linked child completions), and sort by explicit relationship rather than +1 ms.
3. **SERIOUS — no test of the live admission loop.** codex-context.spec.ts only tests the pure helper `childEventParent`. Nothing covers: childTools registration from toolStarted/toolCompleted, child terminal not touching `terminalTurns/activeTurn/state`, foreign thread dropped, nested grandchild registration, `childTools.clear()` on close. Core user rule (child must not end parent turn) is unproven. Add a context-level spec feeding frames.
4. **MODERATE — early child events dropped (report risk 1 is real).** Codex's `item/started` for spawnAgent normally has empty `receiverThreadIds`; IDs arrive at `item/completed`. Child `thread/started`/`turn/started`/first deltas can precede it, and codex-context.ts drops them (`parentToolUseId === null → continue`) with no trace. Fix: buffer events from unknown threads (bounded, e.g. 64 events / 8 threads, TTL until the root turn terminal), flush when linked, drop on terminal; or link on `thread/started` whose source parent thread equals an admitted thread (history already uses `parentThreadId`).
5. **MODERATE — child terminal can precede link/spawn completion.** If a fast child terminates before the spawn `toolCompleted` is processed, `pending.remaining` still contains it and is never cleared; the result is held until root terminal flush (card Running through the whole `wait`). Fix: track terminated child threads (`Set`) in CodexChatEvents and subtract them when creating `pendingAgentResults`; release immediately if all already terminal.
6. **MODERATE — root terminal before child terminal (report risk 3).** codex-chat-turn-stream.ts returns at root terminal (`if (terminal) return`), so later child events are never delivered and the flush at codex-chat-events.ts terminal closes the card early. Normal flow (parent calls `wait`) is fine; fire-and-forget spawn will show a closed card with truncated child output. Acceptable only if documented; otherwise keep draining until pending children terminate or a bounded timeout.
7. **MODERATE — spawn `tool_result` content.** Output is `{receiverThreadIds}` (translator:490), shown as the sub-agent's result in the card. No invented content, but not Claude-identical. Prefer the child's final assistant text when known (available at child terminal via the held result), else an empty/neutral result.
8. **MODERATE — child events leak into root-only side effects in the context loop.** codex-context.ts: child `compaction` completion calls `finishCompact()` (premature release of a root compaction waiter); child `userInputAsync` shares `asyncQuestionItems`. Guard `finishCompact` with `parentToolUseId === undefined`. Also `targets` (fileChange/mcpElicitation approval routing) is only populated for root-thread `item/started`, so approvals requested by a child thread may not resolve (UNVERIFIED: not in scope files; check).
9. **MINOR — unbounded/never-pruned `childTools`.** Entries persist until context close; bounded by spawn count only. Delete on child terminal after flush (keep nested descendants) or cap size.
10. **MINOR — nested spawn result not delayed (report risk 4).** `!this.nested` gate means grandchild spawn cards close at spawn completion, not child completion; inconsistent with depth-0 and with Claude. Real only for nested agents; make child projections own a `pendingAgentResults` and release on grandchild terminal.
11. **MINOR — history emits `agent_start` for every receiver id** even if the child thread is not in the snapshot (previous code filtered by `parentTool`), producing an empty card. Filter on linked threads or accept and document.
12. **MINOR — formatting/lines >100 chars** in codex-context.ts diff (e.g. `childEventParent(...)` call); no repo-style gate was run.

## Checks
- Strict TS: no `any` seen; spec compile UNVERIFIED (not run).
- Logger/payload logging: none added. No new try/catch, so no degradation-audit comments required; the child `error`/`result` no-op callbacks (codex-chat-events.ts child construction) are intentional but carry no `// degradation-audit: optional-capability — ...` marker; add one.
- MCP not touched; no frontend change; foreign thread leakage prevented by linkage through admitted parent events only (context-instance scoped, so no cross-session leakage).
- Child terminal does not mutate `terminalTurns/activeTurn/permission level` (codex-context.ts child branch `continue`s before root handling) and the child projection's `result/error` callbacks are no-ops, so the stream's `settleTurn` stays root-driven (codex-chat-turn-stream.ts:126, `terminalStatus` only set by root result).
- `wait` completed emits a matching `tool_result` in both paths (translator toolCompleted with no pending gating since `agentThreadIds` is undefined for non-spawn).

## Verdict
REVISE: fix D1 (id collision) and D2/D3 before relying on parity claims; D4/D5 need a live Electron spawn+wait run to decide severity (promote to SERIOUS if Codex emits child thread events before spawn completion).

## Round 1

Read-only static re-review; nothing executed, so spec type-checking and runtime behaviour are UNVERIFIED (ts-jest not run). Score: 8/10. Verdict: APPROVE (with the moderate follow-ups below).

### Defect status
1. Duplicate history ids: FIXED (codex-history-projector.ts ~291-296, toolCallId in terminal id).
2. Live/history timing: FIXED (live waits for all receivers, codex-chat-events.ts:145-154,365-377; history places result after the max linked child message_complete by index, codex-history-projector.ts:107-147, no +1 ms). Residual: if a child's message_complete is not found, history falls back to the original index.
3. Live admission loop untested: FIXED in intent (codex-context.spec.ts:8-93 drives real frames through onNotification: foreign drop, early replay, nested link, child compaction, terminal isolation, cleanup). Spec type-check UNVERIFIED; it builds a partial RuntimeContext via Object.create, so any new field read by onNotification/admitEvent/emit that is missing from the stub fails at runtime, not compile time.
4. Early child events: FIXED (codex-context.ts:389-400 thread/started link, 495-518 bounded 64 events / 8 threads, replay in order in linkChild:498-501).
5. Child terminal before link: FIXED (terminated set, codex-chat-events.ts:366-371 and completedAgentResult).
6. Root terminal first: FIXED (context holds rootTerminalPending with 30 s timer, codex-context.ts:530-539; stream drains up to 30 s then finishBackground, codex-chat-turn-stream.ts:383-390). Ends cleanly: pending results closed isError with output null.
7. Result content: FIXED (final child text joined; empty string when missing).
8. Child compaction/approval: FIXED in context (only parentToolUseId===undefined compaction calls finishCompact, :545-547; child terminal returns before touching terminalTurns/activeTurn/state, :525-533; child approvals routed via childTurns, :170-176, isCurrent :303-305). Approval bridge acceptance is UNVERIFIED beyond the report's citation.
9. childTools cleanup: FIXED (deleted at child terminal :527-529, cleared in finishActiveTurn :580-582 and close; knownChildParents capped at 256, :484-492).
10. Nested spawn timing: FIXED (shared agentState across child projections).
11. History receivers: FIXED (receivers filtered to linked threads, projector ~196-210).
12. Long lines: PARTIALLY. A few remain over 100 chars (e.g. codex-chat-events.ts map(): `const mapped ... child.map(...)` line; admitEvent body indented 6 spaces, mis-indented relative to the method). Style only.

### Degradation-audit comments
The callbacks `result: () => undefined` and `error: () => undefined` (codex-chat-events.ts child callbacks) and history `live/compaction/error` no-ops are pure no-ops: no try/catch, no promise, nothing is swallowed. Plain comments are correct; markers would indeed be orphaned. Not a defect. The one real drop is that a child's `error()` callback is not forwarded, but the child's failed terminal still yields a message_complete with CODEX_FAILURE_NOTICE under the child card, so the failure is visible.

### Contract / safety checks
- Claude-identical contract (tool_start isTaskTool + toolInput, agent_start, parentToolUseId nesting, completion): matches in live and history (same translator path; history filters receivers before translation so isTaskTool/agent_start agree). Per-spawn ids: agent_start id keyed by agentId, result ids by toolCallId. One release rule (all receivers terminal) is shared. No payload/prompt logging: logger calls carry fixed text only.
- Foreign threads: only admitted via spawn agentThreadIds or thread/started with a pending-spawn parent (exactly one candidate). No leakage observed in the spec path.

### New defects
A. MODERATE - codex-context.ts:459-461,504-517: every event from any unlinked thread (foreign, or a linked child's late events after its terminal deleted childTools at :527) is buffered; once 64 events or 8 threads are reached, every further event calls logger.error (log flood, no dedupe) and legitimate early child events from a real new child are dropped, starving the buffer. Also buffered stale events from a finished child are replayed if that thread is relinked on a later turn. Fix: do not buffer threads already terminal (keep a small terminatedChildren set), log the overflow once per turn, and clear the buffer at idle turn start.
B. MODERATE - codex-context.ts:535-539: during the drain (up to 30 s) state stays 'running' and activeTurn stays the completed root turn, while the chat generator keeps open. A follow-up send or interrupt in that window sees a busy/completed turn (interrupt targets an already-terminal turn id). UNVERIFIED how startTurn/interrupt react; verify with a test, or reset state to idle for the root and keep only child routing (childTools/childTurns) alive during the drain.
C. MINOR - codex-chat-events.ts live receivers never linked by the context (e.g. an id the context rejects at :476) keep `remaining` non-empty; turn finalization then waits the full 30 s before the error-closed card. Bounded, but a user-visible delay; consider closing receivers not in childTools at root terminal.
D. MINOR - codex-context.ts:393-398: thread/started links on a sole pending spawn by parentThreadId alone; a concurrent unrelated child of the root (not spawned via this tool) would be mis-linked. Low likelihood.

No blocking or serious defects remain. Residual: no live Electron check of native notification order (report acknowledges).

## Round 1

Scope: read-only re-review of the uncommitted diff (codex-context.ts, codex-event-translator.ts, codex-runtime.types.ts, codex-chat-events.ts, codex-history-projector.ts, codex-chat-turn-stream.ts and their specs). Nothing was executed; spec compilation and behaviour are UNVERIFIED.

Score: 8/10. Verdict: APPROVE (no serious findings; moderate items are acceptable with a live Electron check).

### Original defects

| # | Status | Evidence |
| --- | --- | --- |
| 1 id collision | FIXED | codex-history-projector.ts:291-296 id carries `toolCallId`; per-array `index` keeps multi-receiver `agent_start` ids distinct (projector :223-226). Spec "keeps two spawn results distinct". |
| 2 parity | FIXED (residual minor) | Live waits for all receivers (codex-chat-events.ts:145-152, 182-189); history releases after the max linked child `message_complete` by event position, no +1 ms (projector :107-147). Contract-equality specs added. Residual: live output joins the child's whole-turn text (`lastResultText`, chat-events:420), history uses only the last `agentMessage` item (projector :116-124), so multi-item child answers differ. Also the splice index is not clamped to follow the spawn `tool_start` if child timestamps sort earlier than the parent (unlikely with real timestamps). |
| 3 context spec | FIXED | codex-context.spec.ts "native child event admission" drives real frames: child isolation, foreign drop, root state/activeTurn unchanged, childTools pruning, finishCompact not called. Not covered: `thread/started` parentThreadId linking, buffer overflow, failed spawn. |
| 4 early child events | FIXED | `thread/started` link via sole pending spawn (context :389-400) plus bounded 64/8 buffer replayed in `linkChild` (:495-501). |
| 5 child terminal first | FIXED | `terminated` set subtracted at spawn completion (chat-events:373-376); spec "completed after its child already terminated". |
| 6 root terminal first | FIXED, bounded | Context holds root scope while `childTools` non-empty (context :536-538, 30 s); stream drains linked children and force-closes cards with `isError:true` on expiry (stream :383-390). Documented; see M1. |
| 7 spawn result | FIXED | Output is child final text, '' when unknown (chat-events:149-151); not Claude-identical for multi-item answers (see D2 residual). |
| 8 compaction/approval | FIXED | `finishCompact` root-only (context :541, :545-547); child `fileChange`/MCP targets registered (:415-434); approvals for linked child turns routed (:161-165, :289-293); async-question key includes thread id (:552). |
| 9 childTools growth | FIXED | pruned on child terminal (:527-529) and in `finishActiveTurn` (:580-582); `knownChildParents` capped at 256 (:483-492). |
| 10 nested result timing | FIXED | shared `AgentResultState`; spec "holds a nested spawn until its grandchild completes". |
| 11 missing receiver | FIXED | receiver ids filtered by `parentTool` in history (projector :196-205). |
| 12 long lines | PARTIAL | still >80/100 and mis-indented blocks: context :159-160, :394, `admitEvent` body (:524-569) indented 6 spaces. Prettier/lint gate will decide. |

### Findings

- M1 MODERATE - busy window after a fire-and-forget spawn. When the root completes while a linked child is still running, the stream yields `message_complete` and `settleTurn` (codex-chat-turn-stream.ts:371-379) so the UI shows idle, but `session.busy` is only released in `finally` after the drain (<= 30 s, :383-384, :439-453), and the context stays `running` (context :536-538, :588). A user message sent in that window can be rejected as busy. Normal spawn+wait is unaffected because children terminate before the root. Live check needed; if confirmed, settle `busy`/admission at root terminal and keep only the event drain.
- M2 MODERATE - context/stream mismatch. `linkChild` runs for any `agentThreadIds`, including a spawn whose `toolCompleted` is failed or cancelled (context :473-479), but the stream only keeps draining when the projection holds a pending result (chat-events:368, stream :385). Then the stream returns at root terminal while the context holds `rootTerminalPending` until its own 30 s timer, with `state === 'running'`. Rare (failed spawn that still reports receivers). Fix: link only on completed status, or drain on `childTools.size`.
- m1 MINOR - late events from an already-terminated child (usage, trailing items) get `null` parent and enter `bufferEarlyChild` (context :459-461, :504-518); they consume the 64/8 budget until root terminal and, when full, each further unknown-thread event logs `logger.error` (log spam). Dropping events for threads in `knownChildParents` with no active link, or logging once per overflow episode, would be cleaner.
- m2 MINOR - `turn/started` relinks any `knownChildParents` thread (context :440-442) even when the root is idle, so a resumed child's events could be tagged into a later root turn's stream. Acceptable for the `sendInput` case; verify live.
- m3 MINOR - child `result`/`error` no-op callbacks carry plain comments, not a degradation-audit marker (implementer documents that the audit treats the marker as orphaned; baseline preserved, so acceptable).
- m4 MINOR - specs reach private state via `Reflect.get`; brittle but compile-safe. `thread/started` linkage, overflow and failed-spawn paths have no spec.

### Checks
- Strict TS: no `any`, `@ts-ignore` or `as unknown as` seen in the reviewed diffs. Logger used (`options.logger.error`), no `console`. MCP untouched, no frontend Codex special case. Contract (isTaskTool, agent_start parentToolUseId, tagged children, child terminal never settles root) matches the Claude producers.
- Child `terminal` still `return`s before root handling (context :524-533) and child result/error callbacks are no-ops, so a child terminal cannot end the parent turn.

### Needs live Electron check
1. Real notification order: whether Codex reports `receiverThreadIds` at `item/started`, `item/completed`, or only via `thread/started.parentThreadId`, and whether child events can precede `agent_start` (thread/started path emits tagged child events before the card's `agent_start`; confirm the agents panel still renders it).
2. M1: send a message right after a fire-and-forget spawn turn completes.
3. Spawn + wait, spawn + sendInput + wait, and a nested spawn: card closes once, output text matches between live and reload.
4. Child-thread file-change/MCP approval resolves and the card stays open while it is pending.
