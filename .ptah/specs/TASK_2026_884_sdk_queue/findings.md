# TASK_2026_884 — mid-turn follow-up messages: verified findings

Live runs on 2026-11-05 from the coordinator shell (the Codex lane sandbox blocked
network and child-process spawn). Logs: `spikes/*.jsonl`.

## Claude Agent SDK (0.3.318 and 0.3.278 behave the same)

`SDKUserMessage.priority?: 'now' | 'next' | 'later'` decides what a message sent
during a turn does.

| Mid-turn send | Result |
|---|---|
| `priority: 'later'` | Clean FIFO: turn 1 finishes (`FIRST_DONE`), then the message runs as its own turn (`PINEAPPLE`). |
| `priority: 'next'` | Folded into the running turn inside a tool result. Haiku called it prompt injection and ignored it. No separate turn: the message is lost. |
| no priority | Same as `'next'` (control run). This is the 57c5f909e failure. |
| no priority + `includePartialMessages` (spike S1-S4) | Turn 1 ended `error_during_execution`, then the message ran as its own turn. Cause not found. |
| `interrupt()` with a queued message | Receipt `{ still_queued: [uuid] }`; the message then ran. |
| Resume + `streamInput` | Same as fresh session. |

- Capabilities 0.3.318: `interrupt_receipt_v1`, `interrupt_cancel_queued_v1`,
  `interrupt_send_now_v1`, `interrupt_requeue_taken_v1`, `msg_lifecycle_v1`, ...
  0.3.278: `interrupt_receipt_v1`, `interrupt_cancel_queued_v1`, `msg_lifecycle_v1`.
- `command_lifecycle` messages are emitted per queued uuid.
- Public `Query` has no `cancel_async_message` method and `interrupt()` takes no
  `cancel_queued` option (control types exist).
- Each reply carries `user_message_uuid` = the uuid of the send it answers.

Conclusion: the SDK queue works as a backend-owned FIFO only with
`priority: 'later'`. Mid-turn steering on Claude is not reliable.

## Codex app-server (codex-cli 0.166.0)

| Request during a turn | Result |
|---|---|
| `turn/steer` + correct `expectedTurnId` | Delivered into the running turn ("ORANGE PINEAPPLE"). |
| `turn/start` while busy | Folded into the running turn (same turn id returned); no new turn. |
| `turn/steer` + wrong `expectedTurnId` | Refused: `-32600 expected active turn id ...`. |
| `turn/steer` then `turn/interrupt` | Turn `interrupted`; steered text lost. |

## Codex lane sandbox

`resolveCodexLevelPolicy` (`libs/backend/codex-runtime/src/lib/codex-execution-profile.ts:176`)
forces lanes to `workspace-write`, `networkAccess: false`, approval `never`, since
34d675d62 (2026-10-30). Not shown to the user. PR #945 does not change it.
