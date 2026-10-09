# Implementation plan review 2 — session hand-over

Verdict: REVISE

Checked revision 1 of `implementation-plan.md` against `implementation-plan-review.md` and the call sites below. No tests or builds were run. Line numbers are this worktree.

## Previous findings

### 1. Pump gate not armed at limit — Partly

Plan lines 41 and 49 require a synchronous `armAtTerminal` before `markTurnEnded`, and pump admission before `markActive` and `push` (`session-stream-pump.service.ts:224-250`). The result release is `sdk-agent-adapter.ts:1739-1742`, and that file is in batch A.

Unresolved: a successful interrupt releases the pump on its own. `session-control.service.ts:108-116` calls `markTurnEnded` when `query.interrupt()` returns, and `session-registry.service.ts:530-531` documents that path. `session-control.service.ts` is in no batch. Interrupt refusal starts only at `armed` (plan line 51). While the operation is `waiting-for-turn-end`, steer (`session-spawner.service.ts:585-596`) still interrupts, wakes the queue, and `sendMessageToSession` starts a source turn before any result hook can arm.

### 2. Steer, require-idle, and queuedContent — Partly

Plan lines 51-53 specify interrupt refusal, a FIFO hold for steer and for require-idle / if-idle / surface submit, and a terminal-plus-broadcast flush of `tab.queuedContent` through `chat:continue`, cleared only on `SESSION_HANDOVER_HELD`. The pump is in batch A and `session-spawner.service.ts` is in batch D.

Unresolved: that flush is an ordinary `chat:continue`. `continueSession` refuses a blocked budget at `chat-session.service.ts:856-857` before `sendMessageToSession` at `:971`. Only `/compact` and `/clear` are exempt (`:174-177`). The flush never reaches the pump, so `queuedContent` is never accepted as held. `chat-session.service.ts` is in no batch. Plan line 239 says handover admission is the earlier gate; this call order is the opposite.

The composer stop-intent caller is also uncovered (new defect 2).

### 3. Agent handoff and compact_boundary — Resolved

Plan lines 57-61 and the builder contract row: optional bounded `handoff` on begin and on successor mode, wait for a new durable `compact_boundary` (`session-history-reader.service.ts:502-516`), then take that summary and drop lines at or before the boundary (`session-handoff-builder.ts:312-338` and `:447`). Task, branch, worktree, label, and model stay forbidden. The builder, history reader, and successor schema are in batches A and D.

### 4. Batch order and registration files — Resolved

Plan lines 87 and 250-255: A, then B; C and D after A with no shared files. The child host port is in A (line 114). `register.ts` (112), `handlers/index.ts` (126), `manifest.ts` (127), and `rpc-allowlist.spec.ts` (128) are listed. Lane and report sends are no longer cited under `lanes/` or `agent-reports/`; they stay behind the pump gate.

### 5. Child worktree and tab focus — Resolved

Plan lines 67-69: `startSuccessorSession` adopts `worktreePath` and MCP-root retention; handover close does not rollback, does not `releaseMcpRoot` (`session-spawner.service.ts:1286`), and does not drop inherited-parent ownership. Bind and focus happen before `endSessionIfTokenMatches`. Batches B and D test that order. A child source's successor copies inherited parent ids and is not parented to the closing child (plan line 67).

## New defects

1. **Blocking.** The revision's composer flush cannot enter the FIFO at a blocking limit. Plan line 53 sends `queuedContent` via `chat:continue`; `chat-session.service.ts:856-857` returns the budget refusal first; pump admission at `session-stream-pump.service.ts:224-247` is never called. The pending composer message is not transferred, and the successor starts without it. The refusing file is not in a batch.

2. **Major.** The revision's interrupt refusal drops the autopilot stop-intent follow-up. `chat-session.service.ts:959-967` sends only when `interruptCurrentTurn` returns true; otherwise it returns an error and does not enqueue the prompt. The adapter contract is `Promise<boolean>` (`agent-adapter.types.ts:291`). Plan line 51 says the method returns `SESSION_HANDOVER_IN_PROGRESS` and does not interrupt, and it does not change this caller or that boolean contract. From `armed` onward the follow-up is neither interrupted nor held, and the error tells the user to retry, which hits the same refusal until the source closes.

## Why this is not approved

Findings 3, 4, and 5 are closed with file lists and call-site behavior. Finding 1 still lets an in-turn interrupt start one more source turn. Finding 2's flush is refused before the new gate, which loses composer text. Those two gaps are enough to keep the plan at revise.
