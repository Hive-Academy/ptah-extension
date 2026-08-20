# TASK_2026_277 — Gateway inbound survives restart

## Intent

Split out of TASK_2026_271 (medium/low finding "restart mid-turn loses the
in-flight message"). Decision taken 2026-08-18: **notify, don't replay.**

## Why not replay

A gateway turn at `auto-edit`/`yolo` may already have run `Write`/`Bash`
before the process died. Re-running the same prompt from the top would repeat
side effects with no idempotency guarantee. The watchdog path already models
the safe shape: stop, tell the user, let them resend.

## Shape

- Migration: `gateway_messages.turn_state` (`'queued' | 'running' | 'done' |
'failed' | 'interrupted'`), NULL for outbound rows.
- Bridge marks `running` when a turn starts, `done`/`failed` in the `finally`.
- On `GatewayChatBridge.start()`: select inbound rows still `queued`/`running`
  → set `interrupted` → send one notice per conversation via
  `gateway.sendNotice`: "Ptah restarted while working on your last message.
  Please send it again." (batch per conversation, not per message).
- No agent turn is started for interrupted rows.

## Out of scope

- Opt-in replay. If ever wanted, it needs a per-turn idempotency record and a
  user-visible confirmation on the chat side.

## Related

- TASK_2026_271 (parent), `gateway-chat-bridge.ts` watchdog path (pattern).
