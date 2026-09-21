---
id: TASK_2026_472_a7e2
status: in_review
type: BUGFIX
title: >-
  Keep slash-command sessions alive so background subagents keep their tools
description: >-
  A slash-command session passes a finite raw string as the SDK prompt, so the
  SDK marks it single-turn and closes the input after the first result. Claude
  Code then checkpoints the session and aborts every background subagent
  controller with reason `background`. The abort renders as the literal
  user-denial string, so the failure reads as a permission denial although no
  permission gate ran. Measured 2026-09-18: three subagents lost every tool call
  2.8 seconds after the parent turn ended, while Ptah autopilot was in yolo mode
  and had auto-approved the same tools seconds earlier. A live experiment on SDK
  0.3.150 proved a slash command still executes when delivered as an
  SDKUserMessage through an open stream, so the session can stay alive. The fix
  is to route slash commands through the persistent stream that resumed sessions
  already use.
---

# Keep slash-command sessions alive

## Read in this order

1. `experiment-slash-over-streaminput.md` — the live SDK evidence. This is the
   foundation of the task.
2. `diagnosis-subagent-permissions.md` in
   `.ptah/specs/TASK_2026_471_b3d1/` — why the failure looks like a permission
   denial and is not one.
3. `implementation-plan.md` — SUPERSEDED in its conclusion. Read it for the
   confirmed mechanism and the blast radius only.

## What is proven

- The SDK sets `isSingleUserTurn` from `typeof prompt === "string"` and calls
  `transport.endInput()` on the first result.
- `session-query-executor.service.ts:308-320` sends a slash command as a raw
  string. `:339-348` attaches a persistent stream for resumed non-slash sessions
  only.
- On SDK 0.3.150, `/context` and `/usage` delivered as `SDKUserMessage` objects
  execute as commands, with `num_turns=0` and zero cost, through both an initial
  open iterable and `streamInput()`. The session then accepts a second turn.
- The comment at `slash-command-interceptor.ts:4-5` that claims otherwise was
  written 2026-05-15 against SDK 0.2.140. It is false for the installed version.

## The fix

Route a slash-command session through the same persistent pattern a resumed
session uses: start the query with an idle iterable, deliver the command as an
`SDKUserMessage`, and keep the stream open.

## Watch these, each already has evidence behind it

- **The no-activity watchdog.** A slash-command string takes no idle hold today,
  so the watchdog arms on `start()` (`agent-sdk/CLAUDE.md`, watchdog bullet).
  Routing through the pump moves that accounting. A persistent slash session
  must take an idle hold after its last turn, or the watchdog aborts it after
  180 seconds of healthy idle time.
- **Turn settlement.** `markTurnEnded` must still fire from the `result` branch.
- **`streamInput()` resolving is not proof of liveness.** In the control case it
  resolved after the query had already ended. The regression test must observe a
  second SDK `result` in the same session.
- **Blast radius**, from the superseded plan: initial `chat:start` slash
  prompts, `chat:continue` slash follow-ups, `/context`, `/cost`, `/compact`,
  `/review`, plugin commands. Native `/clear` does not reach this path. Prompts
  with attachments are excluded from slash classification. All three hosts
  consume `agent-sdk`.
- **Do not test `/compact` or `/clear` against a live session.** Both mutate
  state.

## Acceptance

1. A spec fails without the fix and passes with it. It asserts the mechanism:
   the first streamed message produces a zero-turn command result, and a later
   message produces a second result in the same session. It asserts no timing.
2. `npx nx run-many -t typecheck -p @ptah-extension/agent-sdk` passes.
3. `npx nx run-many -t test -p @ptah-extension/agent-sdk` passes. The baseline
   before the change was 111 suites and 1,984 tests passing.
4. The stale comment at `slash-command-interceptor.ts:4-5` is corrected or
   deleted. Leaving it would send the next reader down the same dead end.
5. A real background subagent survives the end of a slash-command parent turn.
   The experiment proved the input stays open; it did not prove the downstream
   Claude Code checkpoint no longer aborts an agent. Verify this before closing.

If item 5 fails, the remaining half is in Claude Code, not in Ptah. Record the
evidence and file it upstream rather than working around it.
