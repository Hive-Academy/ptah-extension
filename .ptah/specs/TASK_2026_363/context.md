# TASK_2026_363 — No-activity watchdog kills idle sessions and long subagent generations

## Symptom

Subagents that write a large file (the `software-architect` writing
`implementation-plan.md`) show "Agent working" forever and never create the
file. The Agents panel reports `RPC timeout: subagent:send-message` when the
user tries to steer them.

## Diagnosis (2026-08-31, log `%APPDATA%\Ptah\logs\Ptah Electron-2026-08-31.log`)

`NoActivityWatchdog` (`libs/backend/agent-sdk/src/lib/helpers/no-activity-watchdog.ts`,
added by commit `5e5b82e61`, TASK_2026_190, first shipped in `electron-v0.1.68`)
is a 180 s timer that `StreamTransformer` kicks on every SDK message on the
PARENT stream (`stream-transformer.ts:269`). On timeout
`session-query-executor.service.ts:158-204` aborts the whole session. It is
held only around `canUseTool` (TASK_2026_317).

Two normal states are silent on the parent stream and were never considered:

1. **Idle between turns.** Session `314c9c90`: turn `result` at 00:37:02.841Z,
   kill at 00:40:02.842Z; `result` 00:51:13.086Z, kill 00:54:13.091Z. Both
   exactly 180 s. `chat:continue` resumes silently, so plain chat hides this,
   but every running subagent is marked interrupted.
2. **A subagent composing one long message.** The SDK forwards subagent
   activity only as COMPLETE messages (`forwardSubagentText`); partial deltas
   of a subagent never reach the parent. Session `9d72d406`: architect
   `a2f49d7` last record 01:01:56.301Z, kill 01:04:56.315Z. Architect `a1b509d`
   last text "Writing the plan." 01:56:11Z, kill 02:00:55Z. No `Write` was ever
   requested; the agent died while composing the tool call.

Controlled repro in session `08a58bca`: two `general-purpose` subagents, one
writing a 435-byte file (done in 15 s), one asked for a single 30 KB `Write`.
Parent stream silent from 02:43:36Z; kill at 02:46:38.856Z (log line 1692);
`large.md` never created.

Per-day kills (`no stream activity for` lines): 0 every day 07-07..08-24,
then 12, 19, 38, 29, 26, 14, 13 from 08-25 (v0.1.68) onward. Developer and
reviewer agents survive because they call a tool every few seconds; the
architect's last step is one multi-minute generation.

The `subagent:send-message` RPC hung 180 018 ms (line 1235) because
`SubagentMessageDispatcher.sendToSubagent` awaits `query.streamInput()` with no
bound; it settled only when the abort closed the transport. The CLI recorded
the message as a `queue-operation` (queued command, never delivered).

## Fix

- Hold the watchdog whenever no turn is in flight: `SessionRegistry.markTurnStarted`
  releases, `markTurnEnded` holds (transition-guarded), and the executor takes
  the initial idle hold for non-slash prompts.
- Hold the watchdog for the lifetime of every registered subagent:
  `SubagentHookHandler` holds on `SubagentStart`, releases on `SubagentStop`,
  keyed by `agent_id` so a stop without a start never releases the idle hold.
- Bound `sendToSubagent` with a 10 s timeout that throws `RpcUserError('SEND_TIMEOUT')`.

The abort itself stays: after these holds it can fire only when the root turn
is in flight, no subagent is registered, and the parent stream is silent for
3 minutes with partial streaming on — the case TASK_2026_190 was built for.

## Out of scope

- Replacing the abort with a UI notice (needs a new RPC event and frontend work).
- Delivering steer messages mid-turn (the CLI classifies them as queued commands).
