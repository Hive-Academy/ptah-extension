# Decisions: TASK_2026_632_a6b1

## D1 — What is already done on main

Commits e9eb86525 and d41cb2c01 (2026-10-14, after the symptom of
2026-10-12) changed the parent handoff message
(`subagent-handoff-message.ts:81-83`). It now says "Ptah's subagent budget
monitor stopped subagent ... The user did not stop it; a task notification
that reports it as stopped by the user refers to this automatic stop." Both
reasons (handoff size, weighted safety budget) use it. Acceptance item 1 is
therefore met for the model-facing parent message.

## D2 — What is still wrong

The SDK `task_notification` (status `stopped`, summary "...stopped by user")
goes through `SystemMessageTransformer.buildAgentCompleted`
(`system-message.transformer.ts:656-673`) unchanged. The `agent_completed`
event carries `summary: msg.summary` into the UI, the transcript and every
reader of the stream, child sessions included. That is the "stopped by user"
text this task removes.

## D3 — Fix

- The monitor records `taskId -> Ptah stop notice` when it starts a stop
  (before `dispatcher.stopSubagent`), because the SDK notification can
  arrive before the stop promise resolves. The record is dropped on session
  release.
- The transformer reads that record. For a `stopped` notification of a
  recorded task id, the event summary is the Ptah notice (agent type, reason,
  N of M tokens, "cannot be resumed; start a fresh agent with a handoff").
  Any other notification keeps the SDK summary, so a real user stop still
  says "stopped by user".
- The model-facing SDK text cannot be changed by the host. The handoff
  message (D1) is the correction for the model.

## D4 — Out of scope

- The default `compaction.subagentHandoffTokens` (150,000). Changing a
  default is a scope change; it is noted as an open item for the user.
- History replay after a host restart (the record is in memory only).

## D6 — Review round 1 (code-logic-review.md, NEEDS_REVISION)

Fixed in the one fix round: B1 (spec arity), S1 (child-session coverage
rests on D1 + the `agent_completed` rewrite; a monitor test proves the
parent handoff text says the user did not stop it; the unrelated
history-reader assertion is removed), S2 (an `SdkMessageTransformer`
level test joins writer and reader), the optional transformer injection
(now required), notice figures from `preparedState`, rekey-then-release
test.

Accepted, not changed: a notice is kept after all stop attempts fail,
because a rejected stop may still have ended the subagent (the more likely
case). A later real user stop of that same task would show the Ptah text.
A notice is also lost when the session is released before the late SDK
notification; the stream is torn down then. Both are rare.

The `marked` load failures in the agent-sdk Jest target are environmental:
the Jest `moduleNameMapper` points to `<worktree>/node_modules/marked`,
which this worktree does not have. They are not caused by this change.

## D5 — Executor

Implementation runs on one CLI lane (codex first). Review: one Claude
code-logic-reviewer subagent, one fix round, one short re-review.
