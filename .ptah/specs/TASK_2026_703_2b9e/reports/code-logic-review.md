# Code Logic Review - TASK_2026_703_2b9e (reviewer: code-logic-reviewer)

Verdict: APPROVE WITH FIXES (REVISE for finding 1 only if the lane can render without a tray context). Score 7/10.
0 blocking, 1 serious, 3 moderate, 2 minor.

Scope read: composer, follow-up prompt, lane-stats adapters and bar, lane/single-chat/canvas wiring, monitor and
execution stores, and the whole summary-chunk removal diff. Jest was not run (read-only review).

## Summary-chunk removal: verified clean
- `grep` for summary-chunk, AGENT_SUMMARY_CHUNK, agentSummaryAccumulators, agentContentBlocks, bufferAgentChunk
  over apps and libs finds only a comment in `apps/ptah-electron-e2e/src/specs/task-337-agent-card-refresh.spec.ts:15`.
- No producer exists (watcher is a stub; `forwardSubagentText` defaults to true, sdk-query-options-builder.ts:1318).
- Tree cache memo keys, finalization copies, replayer copies, IPC batch set and router set are consistent.
  `ExecutionNodeSchema` is not `.strict()`, so old persisted `summaryContent` is stripped, not rejected.
- The large replayer diff is prettier churn plus map-copy removal; no behaviour change found.

## Findings

1. SERIOUS - `libs/frontend/chat/src/lib/components/organisms/subagent-lane/subagent-lane-composer.component.ts:121-124`
   `mode()` is `'steer'` only when the tray context is steerable; otherwise `'follow-up'` whenever any session id is known.
   A LIVE agent (running/pending/background) whose tray context is missing (tray not yet populated, `sessionId` input
   null/mismatched in canvas, agent not in `contextsFor`) silently becomes a main-chat follow-up. The user believes they
   are steering; the text is queued into the main chat and the status says "Sent to the main chat".
   Fix: derive mode from `record().status`: live and no steerable context -> `'unavailable'` (or disabled with a hint),
   follow-up only for finished statuses.

2. MODERATE - `libs/frontend/chat-streaming/src/lib/subagent-execution.store.ts` (`adoptRecordSession` ~l.252, `loadHistory` ~l.590)
   Session adoption swaps `entry.sessionId` while a load may be in flight. `loadHistory` re-reads `entry.sessionId!`
   per page and `valid()` ignores the session, so later pages request the NEW session with the OLD cursor, and the
   result is stored as `loaded`. A `loaded` history from the wrong session is also not in `RETRYABLE_HISTORY`.
   Fix: capture `sessionId` at load start, and in `adoptRecordSession` bump `entry.generation` (and abort) when
   `history === 'loading'`; reset `loaded` too when the session actually changed.

3. MODERATE - composer.ts:`followUp` -> `ChatAgentFeedbackSender.send` (`chat-agent-feedback-sender.service.ts`)
   `sendOrQueueMessage` queues when the owning tab is busy yet the composer shows "Sent to the main chat" and clears the
   draft. Also `switchTab` yanks the user to the owning tab in the active workspace, leaving the lane view. Fix: wording
   "Queued/Sent" if the outcome exposes queueing; consider not switching tabs for lane follow-ups.

4. MODERATE - `libs/frontend/chat/src/lib/utils/subagent-follow-up-prompt.ts:19`
   `taskDescription` is interpolated inside double quotes unescaped, with no length cap. A long multi-line or quoted task
   description makes the main-chat message large and ambiguous. Fix: collapse whitespace, strip quotes, truncate (~200 chars).

5. MINOR - Send button label is "Send steer message" in follow-up mode (`agent-steer-input.component.ts`, `sendLabel`
   input exists but the composer does not set it in follow-up mode). Known handoff item 6.

6. MINOR - `libs/frontend/chat/src/lib/utils/lane-stats.adapters.ts` `subagentLaneStats`: `tokens` prefers
   `record.totalTokens` and otherwise sums usage including cache read/write; the two are different bases, so the number can
   jump when `totalTokens` first arrives. No double count within one source. Label the sum or exclude cache reads.

## Checked, no defect
- Draft reset and generation guard on agent change (composer constructor and onSubmit): correct; a late reply for agent A
  cannot clear agent B's draft or pending flag.
- `keyRevisions.delete` after bump (store.ts ~l.530): consumers re-subscribe to a fresh signal; no leak, no stale read.
- `taskDescription` only written by agent_start; the other three record builders carry it forward.
- CLI stats: structured totals preferred, segment fallback marked partial; no double count.
- Canvas CLI continue input is below the card and absent for sub-agent lanes (spec covers it).
- Single chat falls back to the live node when no monitor record exists.
