# Context: report budget-monitor subagent stops as Ptah stops

## Symptom

During TASK_2026_628_5ab5 (2026-10-12), four `software-architect` subagents
stopped at about 150k context tokens. Each stop arrived in the parent as a
task notification with `status: killed` and the summary
"Agent "…" was stopped by user". The user did not stop them.

- The parent session also received the real reason, but only as separate
  PostToolUse hook context: "Subagent `software-architect` was stopped at 150454
  context tokens (handoff size 150000). It cannot be resumed."
- A child session (TASK_2026_629, started with `ptah_session_start`) read only
  the SDK text. It told the user "The user stopped the software-architect call
  again" two times and waited for instructions. The user had to confirm that
  they did not stop it.

## Cause

- `SubagentBudgetMonitor` stops the subagent through the SDK
  (`libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-budget-monitor.ts:616`,
  `this.dispatcher.stopSubagent(session.sessionId, taskId)`), when the context
  reaches `compaction.subagentHandoffTokens` (default 150,000,
  `libs/backend/platform-core/src/file-settings-keys.ts:523`) or the weighted
  budget `compaction.subagentStopWeightedTokens`.
- The SDK reports every stopped background task with the same generic
  "stopped by user" text. It cannot know that Ptah requested the stop.
- The reason message is streamed separately (see the spec
  `subagent-budget-monitor.spec.ts:172`, "streams one parent message, once"),
  so the misleading notification and the correct reason are two unrelated
  messages. A reader that sees only the first gets the wrong conclusion.

## Expected behaviour

1. When the monitor stops a subagent, the parent sees one clear message, for
   example: "Ptah stopped `<agent>`: context reached the handoff size (N of M
   tokens). It cannot resume. Start a fresh agent with a handoff; its partial
   output is in the transcript."
2. The text "stopped by user" never appears for a monitor stop. Either rewrite
   the notification for task ids that the monitor stopped, or attach the reason
   to it so the two cannot be read apart.
3. The same applies to child sessions (`ptah_session_*`) and to the weighted
   budget stop (with its own reason text).
4. A real user stop still says "stopped by user".

## Pointers

- `libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-budget-monitor.ts`
  (`stop()` at :586, reason text at :751).
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-subagent-context-injector.service.ts:280-294`
  (resume advice "fresh (context at handoff size)").
- Where SDK task notifications reach the parent transcript (find the handler
  that renders `task-notification` / `status: killed`).

## Acceptance

- Unit test: a monitor stop produces a parent-visible message with the reason
  and no "stopped by user" text.
- Unit test: a user stop of the same task type still says "stopped by user".
- Child session case covered (the completion summary of a child does not claim
  a user stop).

## Related settings change (done, not part of this task's code)

The user's `~/.ptah/settings.json` now sets
`compaction.subagentHandoffTokens = 250000` (backup:
`settings.json.bak-task628`). Consider whether the default of 150,000 is too low
for planning and review agents that read code across many libraries; the one
broad architect that finished needed 138k tokens for 56 tool calls.

## Verification rules

Follow CLAUDE.md: test only the changed projects (`npx nx test agent-sdk`,
`npx nx test rpc-handlers`), Jest `--maxWorkers=2`, Nx `--parallel=1`, one heavy
check at a time, no build, serve or e2e targets unless the user asks.
