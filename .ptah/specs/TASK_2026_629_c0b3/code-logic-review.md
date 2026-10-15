# Code Logic Review - TASK_2026_629_c0b3 (Phase A: B2a, B2b, B2c)

Score: 6/10. Verdict: APPROVED WITH FIXES (no blocking defects; two serious items to fix before Phase A closes).
Scope: compact-lane-rows.ts, agent-permission-responder.ts, compact-session-card.component.ts, compact-session-activity.component.ts (lane/callout/metrics zones), AgentMonitorStore.clearPermission. Static read only; no tests run.

## Checked and correct
- Allow/Deny ids: respondLane posts `AGENT_MONITOR_PERMISSION_RESPONSE` with the request's own requestId, then `clearPermission(agentId, requestId)`. The store filters by requestId, so only that entry is removed and a second queued entry survives (agent-permission-responder.ts:25-36; agent-monitor.store.ts:1494-1511). Session path forwards `request.id` and `callout.tabId` (card:respond).
- Callout priority is session permission, then CLI permission, then error. CLI permissions come from `agentsForSession`, which applies `agentVisibleInSession` (agent-monitor.store.ts:856). buildLaneSummary filters again, so there is no double count.
- `moreCount` and chat-ui `remainingLanes` agree: `total - min(rows.length, 3)` equals `rows.length - visible.length` for max=3 (activity:998). The two sites hard-code 3 independently.
- Timer: one interval, created only when `counts.running > 0`, cleared when none run and in `onDestroy`. `now.set` is a write to a signal the effect does not read, so there is no effect loop. The effect re-runs on every store change because `counts` is a new object, which is harmless.
- `lanes=null` falls back through `remainingLanes` and the lane placeholder `—`. The activity component injects no store (AC 3.8).
- Unknown status maps to `running`. Sort order and cap follow spec.

## Findings

1. **Serious - session elapsed freezes when no lane is running.** card.component.ts:`elapsed` and the elapsed effect. `elapsed = now - agentOrigin.startedAt`, but `now` only ticks while `laneSummary().counts.running > 0`. A card with a streaming session and no running lane shows the elapsed value from construction or from the last tick, and never advances. A card mounted later shows the construction-time value. This is a silently wrong number, not an error. Fix: run the interval while the session is streaming or any lane runs (`streaming() || running > 0`), or recompute `now` when it is read in a non-ticking state. Keep the clear-on-destroy behaviour.

2. **Serious - CLI permission with an unresolved parent shows on every card.** card callout (CLI branch) and `agentsForSession` / `agentVisibleInSession` (session-scope.ts:60-66) treat `parentSessionId === undefined` as visible in all sessions. A pending CLI permission for an agent that has not resolved its parent produces an Allow/Deny callout on every compact card, and the user can approve it from the wrong session. This is the spec'd "tolerant" rule, but for permissions it is a safety concern, and the lane list has the same leak. Fix: for the callout (and ideally the lanes), use `agentsOwnedBySession` (exact parent match, store :869), or require a resolved parent before offering Allow/Deny. If the tolerant rule is kept deliberately, record it in decisions.md.

3. **Moderate - subagent lane timings are wrong.** compact-lane-rows.ts:`startedAt: agent.lastEventAt`. The lane's start time is its last event time. A running subagent's elapsed resets on every event, and a finished one shows 0 or near 0 (`endedAt` is the same field). Sorting by "newest" also uses last activity. Fix: use a real start field if SubagentRecord carries one. Otherwise show `—` for subagent elapsed rather than a misleading figure.

4. **Moderate - "on post failure do not clear" is not implemented.** agent-permission-responder.ts:24-36. `vscode.postMessage` is called and then `clearPermission` runs unconditionally. If postMessage throws, the exception skips the clear, which is fine. If the host drops the message silently, the card shows the request resolved while the CLI agent still waits. It also does not guard against a double click: the second click posts a duplicate response before the queue entry is cleared. Fix: confirm the entry is still queued before posting, and document that the clear is optimistic.

5. **Moderate - session Allow/Deny can silently do nothing.** card:respond. If `sessionPermissions()` no longer contains the request (the `find` returns undefined) or `callout.tabId` is falsy, the click is dropped with no feedback. Callout and list are the same computed, so this is only a race when the request is resolved elsewhere between render and click. Acceptable, but a no-op button is unobservable.

6. **Moderate - Retry is permanently absent, and `(retry)` is not bound in the card template.** The error callout has `canRetry: false` (decisions #5, A8) and the output is wired nowhere. This is an accepted decision, but AC 3.9 coverage for "error with retry" is not met. It is a latent dead path if `canRetry` is later set true without the template binding.

7. **Moderate - requirement gap not flagged to the user: todos and git +/- are missing from the metrics zone.** The prototype footer shows todos, context, cost, git changes. Only model, tokens, cost, agents, compactions and context % are rendered. decisions.md #6 admits there is no public card-level source. This should be escalated to the user as a scope decision before Phase A is declared done, not left as a lane open item. It is not a logic defect, but the board zone does not match the prototype and the spec/AC says it should.

8. **Minor - error callout text is `lastTerminalReason` with underscores replaced.** card callout. Raw SDK reason strings are shown to the user. Also the callout shows whenever the summary tone is error, including after the user has dismissed or resumed, until `lastTerminalReason` is cleared.

9. **Minor - lane summary recomputes and re-renders on any store change.** `counts` and `rows` are new objects each time and the computed has no `equal`. This is low cost with at most 3 rows, but the `sameItems`-style equality used for the other computeds would avoid card re-renders on unrelated agent updates.

## Five questions (short)
1. Silent failure: elapsed freeze (1); no-op respond (5); optimistic clear (4).
2. Unexpected user action: double click on Allow; Allow on an unresolved-parent permission from the wrong card (2).
3. Wrong answer from data: subagent elapsed from lastEventAt (3); unresolved-parent agents counted in every session's lanes (2).
4. Dependency failure: host drops the permission message; the queue is cleared anyway (4).
5. Missing: todos/git metrics (7); Retry (6).

## Verdict
APPROVED WITH FIXES. Fix 1 and 2 before Phase A closes; decide 7 with the user; 3-4 can follow in the same phase.
