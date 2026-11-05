# Codex app-server active-turn input research

## Scope and result

Installed CLI: `codex-cli 0.166.0`. The repository declares `@openai/codex-sdk: ^0.165.0` at `package.json:92`; that is a separate package/version range, not proof that its bundled binary equals the installed CLI. The installed CLI generated the checked-in-to-task schema bundle in `spikes/codex-schema/` with `codex app-server generate-json-schema --out ...`.

**A live protocol outcome was not obtained.** The required Node stdio spike exists, but this workspace's process sandbox returned `spawn EPERM` before any JSON-RPC exchange, both via shell launch and via the Node executable. The JSONL contains these two harness failures. Therefore no claim below that `turn/start` queues, steers, replaces, or refuses is experimentally established. This is an unmet requirement of this lane.

## Installed protocol relevant to active input

Generated files: `spikes/codex-schema/v2/{TurnStartParams,TurnStartResponse,TurnSteerParams,TurnSteerResponse,TurnInterruptParams,TurnInterruptResponse}.json`, plus `ClientRequest.json` and `ServerNotification.json`.

| Method | Exact required params | Optional relevant params | Response |
| --- | --- | --- | --- |
| `turn/start` | `threadId: string`, `input: UserInput[]` | `clientUserMessageId?: string|null`, `effort?: ReasoningEffort|null`, `model?: string|null`, `cwd?: string|null`, `approvalPolicy`, `sandboxPolicy`, `parentTurnId?: string|null`, `rootTurnId?: string|null`, other turn settings | `{turn: Turn}` |
| `turn/steer` | `threadId: string`, `expectedTurnId: string`, `input: UserInput[]` | `clientUserMessageId?: string|null` | `{turnId: string}` |
| `turn/interrupt` | `threadId: string`, `turnId: string` | none | empty object `{}` |

`expectedTurnId` is explicitly an active-turn precondition: a mismatch fails. The schema's `parentTurnId`/`rootTurnId` descriptions say they are ignored when `turn/start` adds input to an active turn. The generated `ErrorNotification` schema describes a `turn/start` or `turn/steer` request during a turn that cannot accept same-turn steering (such as review or manual compact). This suggests busy `turn/start` may act as same-turn input, but does not prove its runtime behavior. Relevant notifications are `turn/started`, `turn/completed`, and `error`; the generated method list has no dedicated queued-input or pending-input notification.

## Live spike evidence

`spikes/codex-app-server-queue-spike.mjs` uses plain Node, starts the app-server over line-delimited stdio JSON-RPC, logs every send/receive, initializes, starts a thread and long turn, sends `turn/steer` with `PINEAPPLE`, sends busy `turn/start` with `BANANA`, then interrupts. It records responses, notifications, and terminal status in adjacent JSONL. It sets low reasoning effort. Execution was wrapped in `node scripts/verify.mjs --exec --task codex-app-server-queue-spike -- node ...` as required.

| Probe | Observed outcome | Evidence |
| --- | --- | --- |
| Start app-server | Refused by OS/sandbox before initialize | `{"step":"spawn codex app-server via node executable","error":"spawn EPERM","status":"no JSON-RPC exchange"}` |
| Steer during active turn | Not reached | No `send` or `recv` JSON-RPC lines in JSONL |
| Busy `turn/start` | Not reached | No `send` or `recv` JSON-RPC lines in JSONL |
| Interrupt with input pending | Not reached | No `send` or `recv` JSON-RPC lines in JSONL |

`codex --version` and schema generation succeeded from PowerShell, so the blocker is subprocess creation from the Node spike, not missing Codex. No production changes, tests, lint, or typecheck were run.

## Ptah chat provider path

`libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:786-815` checks `admission === 'require-idle'` and refuses a busy/blocked/pending session. Peer-origin messages use `peerQueue.send(session, ...)`; ordinary chat messages are refused if peers are pending, and `turn()` rejects busy/blocked sessions at `:703-705`. `codex-chat-peer-queue.ts:20-22,29-53,60-80,102-142` keys FIFO queues by the **session object**, admits one at a time, advances on idle, and rejects pending entries when that session closes. `codex-chat-adapter.ts:744` wires turn completion to `onIdle`. This binds peer messages to their original session object rather than a global queue. The caller's peer send promise resolves on turn admission, not completion. The adapter does not use native same-turn steer for general chat follow-ups; `libs/backend/codex-runtime/src/lib/codex-context.ts:879-905` does expose `turn/steer` with thread and expected-turn IDs for explicit steering.

## Ptah CLI lane path

`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.ts:154` advertises `{steer:false, interrupt:false, continuation:true}`. Its handle's `continue` at `:569-588` rejects active turns and calls `runTurn` with `resumeSessionId: sessionId`, producing a new turn. `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-message-router.service.ts:128-149` therefore parks a message to a running Codex lane. `:211-236` stores at most eight strings in `tracked.pendingMessages` and immediately returns `mode: 'queue-next-turn'` with position. `:271-315` shifts one message after the prior turn settles and calls `continueConversation(agentId, next)`; on delivery failure it logs and drops that message. `agent-process-manager.service.ts:2992-2996` invokes this flush at the single settle point; `:2221-2256` resolves `agentId` to the tracked record before routing. The MCP dispatcher at `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:1382-1416` validates tool args, calls `ptahAPI.agent.message`, and returns the mode/detail or a coded error for absent/restored/not-running agents.

Session binding is indirect: pending queue entries are **strings on one tracked agent record**, not tuples containing `threadId`. The continuation uses that record's `sdkHandle` (`agent-process-manager.service.ts:2331-2355,2399-2405`), whose `sessionId` is captured by the Codex adapter (`codex-app-server-lane.adapter.ts:261,569-588`). The adapter validates resume identity fields at `:593-606` and has a writer registry keyed by thread ID (`:357-380,403-436`). The reviewed path has no global queue or lookup by CLI name that would route a pending string to another agent. However, because the entry itself contains no immutable thread ID, the queue cannot independently reject a hypothetical handle/session replacement on the same record; this is a defense-in-depth gap, not an observed cross-session delivery.

## Gaps and recommendation

1. **High, verification gap:** runtime behavior of busy `turn/start`, steer, and interrupt is unverified because the sandbox blocked the live app-server (`spikes/codex-app-server-queue-spike.jsonl`). Rerun the supplied script in an environment that permits `child_process.spawn`, inspect actual JSON-RPC responses, and only then choose native same-turn behavior.
2. **Medium, delivery gap:** CLI `queue-next-turn` is an admission receipt, not a delivery receipt. If continuation fails or the subprocess is released, the queued string is dropped and logged (`agent-message-router.service.ts:278-315`), without notifying the original caller. Return a stable queued-message ID and emit delivered/failed events, or state this limitation clearly in the tool response.
3. **Low, session invariant:** store expected `cliSessionId` with each pending entry and verify it at flush (`agent-message-router.service.ts:228,293-297`) before calling continuation. Existing record/handle ownership appears to keep messages on one session in normal operation, but this makes the invariant explicit.

For chat, retain the per-session FIFO for peer next-turn messages and the `require-idle` refusal when requested. For CLI, retain per-agent FIFO next-turn delivery until a real experiment proves native steering is desired and safe; do not call busy `turn/start` speculatively. If native steering is adopted, use `turn/steer` with both `threadId` and `expectedTurnId`, and only report `steer` after the app-server acknowledges the matching turn ID. For queued messages, report `queue-next-turn` as pending and give a later delivery/failure signal.

An end-to-end CLI lane test was not possible here: its adapter also starts the app-server subprocess, and the same `spawn EPERM` blocks it. No claim of end-to-end delivery is made.
