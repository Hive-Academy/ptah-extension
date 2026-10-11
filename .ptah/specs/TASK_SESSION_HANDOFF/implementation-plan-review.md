# Implementation plan review — session hand-over

Verdict: REVISE

Checked `implementation-plan.md` against `defect-trace.md` and the source named below. No tests or builds were run. Line numbers are this worktree.

## Findings

1. **Blocking.** The SessionStreamPump gate does not cover the turn-source table until an operation is armed, and the plan never arms one when a turn ends at the limit. The gate text is "Once armed, existing queue entries and all new queue-mode input join the transfer FIFO" (plan, Queue and turn gate). `canSend` still runs only in `continueSession`, and the Ptah CLI branch returns before it (`chat-session.service.ts:852-857`). Lane completion (`lane-completion-notifier.service.ts:329` and `:447`), agent reports (`agent-report-router.service.ts:341` and `:502`), peer relay (`peer-session-messenger.service.ts:128`), and a Ptah CLI continue (`chat-ptah-cli.service.ts:274`) all call `sendMessageToSession` with no budget check. `markTurnEnded` still wakes `messageQueue` before `observe` (`session-budget.service.ts:30-34`). A limit result therefore keeps starting source turns until someone calls `beginHandover` or successor mode.

   Plan change: on the terminal result, if `blocked` (`stage === 'limit' && blockAtLimit`), arm the single-flight operation before the pump yields. Hold the already-queued message and every later send. The banner click confirms or cancels; it is not what first closes the gate.

2. **Blocking.** Three sources never enter that gate, even after arm. `ptah_session_send` mode `steer` calls `interruptCurrentTurn` and then `sendMessageToSession` with no admission (`session-spawner.service.ts:578-596`). The interrupt is `SdkAgentAdapter.interruptCurrentTurn` (`sdk-agent-adapter.ts:1472-1476`), not the pump. After a successful interrupt the session is idle, so a yield-only or queue-mode-only hold still starts a source turn, including during the coordinator's `/compact`. `require-idle` (`session-stream-pump.service.ts:219-221` and `:266-284`) refuses instead of queueing; that is `if-idle` (`session-spawner.service.ts:572-576`) and surface submit (`surface-submit-turn.service.ts:298`). Those calls do not start a turn, and their payload is not carried. `tab.queuedContent` is not on `session.messageQueue`. The plan sends it only from the frontend `beginHandover` (plan, Queue and turn gate). Successor mode arms the same coordinator from MCP and has no path that reads the composer, so closing the source drops that text.

   Plan change: from `armed` through `closing`, refuse `interruptCurrentTurn` on the source. Place steer text, require-idle text, and the source tab's `queuedContent` on the transfer FIFO inside the coordinator (the backend reads the composer; do not rely on the webview having called begin). Ptah CLI continues are covered only if the check sits in `SessionStreamPump.sendMessage` before `markActive` and before `push` (`session-stream-pump.service.ts:224-250`), not only before a later yield.

3. **Blocking.** Successor mode cannot carry the caller's handoff, and `/compact` then `SessionHandoffBuilder` does not read the post-compact summary. The plan's successor variant has no task or text field (plan, Successor mode). `extractSessionHandoffFacts` skips every non-user, non-assistant line (`session-handoff-builder.ts:317`), so a `compact_boundary` system message is invisible. `summary` is the first conversational user text after that boundary (`:323-325`), which a compact-then-immediate-build does not have. Render then writes "No compaction summary in the transcript." (`:447`). The same loop still collects changed files, todos, and `lastAssistantText` from the whole tail, including lines before the boundary (`:312-338`). `build` reads the jsonl file once (`:576-579`) and does not wait for the boundary. The history reader does wait (`session-history-reader.service.ts:502-516`). The calling agent has no other channel: the tool arguments are not a transcript line yet, and they are discarded by the schema.

   Plan change: add an optional handoff string on successor mode and on `beginHandover`. Prepend it to the seed under `SESSION_HANDOFF_LIMITS`. Keep task, branch, and worktree forbidden. Before the deterministic write, wait until a new `compact_boundary` is durable, then change the extractor to use that boundary's summary and to ignore lines at or before it. Do not treat today's builder as already reading the compacted transcript.

4. **Major.** B, C, and D do not share files with each other or with A, but B does not compile against A alone. `startSuccessorSession` is added on `child-chat-session-host.port.ts` only in D (the port today ends at `startChildSession`, `:37-40`). B edits `child-chat-session-host.adapter.ts` to call it. Run D's port change in A, or run D before B.

   Files the change needs and no batch lists:

   - `libs/backend/agent-sdk/src/lib/di/register.ts:746-749` registers `SessionBudgetService`. A's `index.ts` only re-exports. The coordinator is never constructed unless this file registers it.
   - `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts:302-305` is what mounts a handler (`methods: SessionBudgetRpcHandlers.METHODS`). `register-shared-rpc-handlers.ts:52-71` does not register budget or handover handlers. Without a manifest entry, `session:beginHandover` is absent on every host. Also export the handler from `libs/backend/rpc-handlers/src/lib/handlers/index.ts`.
   - `rpc-allowlist.spec.ts:133-143` should assert the new methods. The `session:` prefix is already allowed, so this is a test gap, not a second registration path.

   The plan cites `cli-agent-runtime/src/lib/lanes/lane-completion-notifier.service.ts` and `agent-reports/agent-report-router.service.ts`. Both classes live under `cli-agents/`.

5. **Major.** Close-after-confirm does not say what happens to a child worktree or to the tab the user is in. `releaseResources` (`session-spawner.service.ts:1278-1288`) does not delete the git worktree (`:745` keeps it) but it does `releaseMcpRoot` on that path. Child session end reaches it from `onGraceExpired` (`:936-942`). A successor that keeps working in the source child's worktree (`IChildChatSessionHost` takes `worktreePath` at `child-chat-session-host.port.ts:19-20`) loses that MCP root when the source child is closed. The host also mints a new `tabId` (`:15-16`). The plan closes the source with `endSessionIfTokenMatches` (`session-lifecycle-manager.ts:610-619`) and only "reserves one non-interactive target tab". The user's current tab is the source. Nothing moves focus onto the successor before that close.

   Plan change: `startSuccessorSession` copies the source child's `worktreePath` and its MCP-root retention. Source close must not `rollback` or `releaseMcpRoot` that path, and must not drop inherited-parent ownership. Bind and focus the successor in the source tab's slot before `endSessionIfTokenMatches`, or focus the pending tab first. A top-level source still gets no new worktree and no parent link. A child source's successor copies the closing child's parent ids and must not store the closing session as parent.

## Requirements the plan does meet

Single-flight per session, banner only when the turn is idle and only on the focused view, preview left read-only, `/compact` and `/clear` still exempt, depth-exceeded kept for mode `child`, and close only after a registered live successor. Those match the request. Removing the documented one-follow-up overshoot (`session-budget.service.ts:30-34`) also matches "queue behind the hand-over". No automatic retry and forbidding label/model on successor mode are extra and safe; they can stay.

## Turn-source answer

| Source | Through the planned pump gate? |
| --- | --- |
| Composer `chat:continue` (non-CLI) | Only after arm, and only if the check is inside `sendMessage` before push. |
| Frontend `tab.queuedContent` | No. Separate begin payload; missing when successor mode arms. |
| Lane completion, agent report, peer relay, default `ptah_session_send` queue, Ptah CLI continue, message already on `messageQueue` | Only after arm, and only via `sendMessage` / the terminal gate. Not armed at limit today. |
| `ptah_session_send` steer | No. Interrupt, then an idle send. |
| `if-idle` and surface submit | No turn, and not held. Refused at `session-stream-pump.service.ts:279`. |
