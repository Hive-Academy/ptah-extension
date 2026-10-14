# Code logic review — subagent handoff notice

| Score | Verdict | Blocking | Serious | Moderate | Minor | Failure modes |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 4/10 | NEEDS_REVISION | 2 | 2 | 1 | 0 | 5 |

The branch implements the intended foreground/background split and subagent-specific warning route, but the hard-stop handoff is still lossy in reachable failure and concurrency cases. A score of 4 reflects two silent-loss paths after a successful stop; a 5 would require a reliable delivery fallback. It is above 3 because the normal routes are wired through the executor, monitor, queues and hook handler (`session-query-executor.service.ts:268-295`, `subagent-budget-monitor.ts:679-716,870-891`, `post-tool-use-hook-handler.ts:82-89,140-160`).

## Blocking

1. **Five simultaneous foreground stops silently discard an earlier handoff.** `main-thread-notice-queue.ts:52-65` drops the oldest notice once four are pending. `subagent-budget-monitor.ts:887-890` records each foreground handoff as pending, but `subagent-budget-monitor.ts:703-715` only falls back to a user turn when `withdrawMainThreadNotice` returns true. Trigger: five parallel foreground Agent calls each hit the limit before any main-thread PostToolUse drains the queue. The fifth post evicts the first; when its Agent result arrives, withdrawal returns false and the parent receives no handoff for the first stopped subagent. Preserve a per-handoff delivery acknowledgement or fall back when the queue evicts a notice; do not treat an absent notice as proof it was delivered.

2. **A failed background send leaves a stopped task with no parent handoff.** `subagent-budget-monitor.ts:801-808` commits `stopFired` and marks the registry record completed before delivery. `subagent-budget-monitor.ts:880-885,899-914` catches a rejected `pushParentMessage` and only logs it. `subagent-message-dispatcher.ts:219-231,254-285` can reject when the query is inactive or does not read input within 10 seconds. Trigger: the parent input channel is unavailable or slow after `stopTask` succeeds. The notice is lost with no retry or durable pending state, while subsequent subagent messages cannot retry because `stopFired` is true (`subagent-budget-monitor.ts:370-373`). Retain the handoff until acknowledged, with a bounded retry or a session-level pending delivery mechanism that survives this failure.

## Serious

3. **A slow handoff-file operation can hold the notice indefinitely after the subagent is stopped.** `subagent-budget-monitor.ts:801-823` stops first, then awaits `prepareHandoffFiles`; `subagent-budget-monitor.ts:854-867` waits for both file operations without a bound. `subagent-handoff-files.ts:63-65,81-83` performs asynchronous workspace filesystem calls. Trigger: a network or stalled workspace filesystem does not settle `mkdir`, `writeFile` or `stat`. The monitor never reaches `deliverHandoff` (`subagent-budget-monitor.ts:827-847`), leaving the parent unaware of the stop. Bound file preparation time and send a degraded handoff when the bound expires; ensure late writes cannot cause a second notice.

4. **The hard-stop message does not name the stopped task's output file.** `subagent-handoff-message.ts:88-89` gives only a generic reference to “the task notification”; `subagent-budget-monitor.ts:832-847` constructs the message without an output path or task id, though the stop path has the task id at `subagent-budget-monitor.ts:750-770`. Trigger: more than one task notification appears, or the notification is delayed, omitted or out of context. The parent cannot reliably locate which output file contains this task's partial work, contrary to the stated hard-stop contract. Correlate the stopped task id with its `task_notification.output_file` and deliver the concrete path (or explicitly report unavailable with the task id).

## Moderate

5. **An unknown session workspace omits the notes status entirely.** `subagent-handoff-files.ts:42-50` returns no paths when the workspace is unknown; `subagent-handoff-message.ts:81-87` then skips the notes line instead of saying the notes path is missing or unavailable. The existing test explicitly expects this branch (`subagent-budget-monitor.spec.ts:1123-1132`). Trigger: a session has no workspace at stop time. The parent receives no notes location or status, so a fresh agent cannot tell whether to look for progress notes. State that the notes file is unavailable because the workspace is unknown, and include any recoverable path if it becomes known.

## Five logic questions

1. **Silent success:** queue eviction and caught send failure leave `stopFired` true without a delivered handoff (findings 1–2).
2. **Unexpected user action:** starting five foreground subagents that hit the budget concurrently loses one handoff (finding 1).
3. **Wrong answer from valid input:** a stop with an unknown workspace produces a message that omits notes status; multiple task notifications make the generic output-file instruction ambiguous (findings 4–5).
4. **Dependency failure or timeout:** `pushParentMessage` rejection is swallowed and workspace file I/O has no time bound (findings 2–3).
5. **Requirement gap:** the contract does not define how to report a task output path before its SDK notification arrives; the implementation needs a correlated pending state or an explicit unavailable status (finding 4).

## Scope and verification

Reviewed the `origin/main..HEAD` changed-path list and production paths for monitor, handoff files/message, both notice queues, PostToolUse hook, DI registration and stream tap, plus relevant changed specs and dispatcher behavior. Task folder contains `HANDOFF.md`; no `context.md`, `task-description.md`, `implementation-plan.md`, batch file or `code-style-review.md` was present. Scoped `ptah_get_diagnostics` reported zero TypeScript errors for the monitor and stream tap. The handoff notes report 3,344 passing agent-sdk tests and one unrelated timeout; no tests, builds or Nx commands were run during this static review. SDK scheduling and filesystem stalls were reasoned from code, not reproduced at runtime.
