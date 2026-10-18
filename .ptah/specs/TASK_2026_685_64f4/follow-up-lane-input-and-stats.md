# Follow-up (separate PR after #751): lane message input and stats header

USER DECISION 2026-10-18: do this as a new task on its own branch after #751 merges, not in #751.

## 1. Visible message input for sub-agent and CLI lanes

- Today the sub-agent lane shows `ptah-agent-steer-input` only behind a header toggle, and only
  while the agent runs (`steerable: isRunning`, `session-agent-tray.ts:229`).
- `subagent:send-message` reaches only a running sub-agent; the sub-agent resume RPC was removed.
- USER DECISION: keep the input visible. A message to a finished sub-agent goes to the main chat
  as a follow-up that asks the main agent to continue that sub-agent.
- CLI lanes: the backend has `agent:continue` / `agent:resumeCliSession`, wrapped by
  `AgentMonitorStore.continueAgent` and `AgentFollowUpQueueService`. Only the agent monitor
  panel renders `ptah-agent-continue-input` (`agent-monitor-panel.component.ts:543`), and the
  Electron dock does not mount that panel. The canvas and chat CLI lanes need the input.

## 2. Shared lane stats header

- The lane top today is the raw `ptah-subagent-usage-summary` mono row plus a plain
  `Model / Task / Parent` list.
- The main agent's compact stats bar is `ptah-session-stats-summary` (chat-ui), fed by the backend
  `SessionStatsEntry` snapshot that lanes do not have. Build an adapter or a sibling component
  with the same look for sub-agent and CLI lanes (model, context, tokens, cost, tools).
- Fold in visual-review defects D3 (`out N` token near-invisible in light theme) and D6 (`Task:`
  shows the latest progress line instead of the task), `reports/visual-review-final.md`.

## 3. Open defects from #751 reviews to consider in the same task

- `reports/code-logic-review-final-fix-and-b5c.md`: Major 1 (bubble history states never render,
  OnPush + same mutable entry), Major 2 (`retain()` tracks `agentMonitorStore.subagents()` inside
  component effects), Minors m1-m5.
- `reports/visual-review-final.md`: D2 restored lane loses header facts, D4
  restored main-chat agent has no Load control, D5 silent history paths.

## 4. Gap found while fixing the task-337 e2e spec

- The old inline agent card showed the `agent:summary-chunk` text (parent
  `StreamingState.agentSummaryAccumulators`). The store-backed lane does not: its live peek reads
  `SubagentRecord.latestSummary`, which only `agent_progress` writes, and its `summaryContent` input
  is not bound by the canvas lane view. The e2e spec now asserts the `agent_progress` path. Decide
  whether the lane should also show the summary-chunk stream.
