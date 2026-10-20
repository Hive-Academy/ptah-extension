# Code Logic Review A1 — TASK_2026_685

Score: 7/10. Verdict: REVISE (two small fixes; the rule itself is correct).

## Rule (agent-duration.ts)
- `agentRunDurationMs` never computes `now - startedAt` for a finished run (the `now` branch is gated on `run.running`). Finished without end falls to `reportedMs`, else null. Negative and non-finite inputs return null. OK.
- A finished run with both ends present but non-finite does not fall back to `reportedMs` (returns null). Acceptable, spec says "both ends".
- Restored CLI lane without `completedAt`: `loadCliSessions` leaves it undefined (agent-monitor.store.ts:1719), roster maps `endedAt` null, and the inspector/dock give null and show `Worked`. dock-overflow-duration.spec.ts covers it. OK.
- Spec quality: agent-duration.spec.ts covers the rule cases. The restore spec (store.spec.ts:88-98) covers valid, absent and invalid `completedAt`. Good.

## Findings

### Serious
1. `onTaskToolResult` stamps `completedAt = Date.now()` (agent-monitor.store.ts:2441), while `startedAt` comes from `event.timestamp` (:2039). It is called from accumulator-core.service.ts:454, which also runs when history is replayed. A replayed foreground subagent that ended via tool_result gets historical start and wall-clock-now end, so the inspector shows "Worked for 3h" or similar. Fix: pass the tool_result `event.timestamp` through, i.e. `onTaskToolResult(id, isError, ts)`, falling back to `Date.now()` only when the timestamp is absent. This is the only wrong-answer path I found. `event.timestamp` is epoch ms (`FlatStreamEvent.timestamp: number`, store.ts:658). Date.now() is acceptable only for the live path, not as written.

### Moderate
2. inline-agent-bubble.component.ts:889-898: `Date.now()` is read inside `computed()` and is not reactive. For a running or pending record (`record.status` pending counts as running) the footer value is frozen at the last signal change. It may show a stale "1s" until the next record update, and a pending record without `startedAt` correctly yields null. The plan says no new timer, so freezing is tolerable, but it should be a known limitation or take the existing tick source.
3. Restart/resume: `completedAt` is carried forward by `existing?.completedAt` on start, progress and status events (:2040, :2136, :2172-2173, :2209). If a record goes completed -> running -> completed, the old `completedAt` is kept (`??`), so the second finish uses a stale end time. Clear `completedAt` on non-terminal status, or overwrite on terminal events.

### Minor
4. Bubble hides durations under 1 s (`formatAgentDuration` null), as the plan requires. `DurationBadgeComponent` formats differently ("1.2s" vs "1s"), so the footer and the other surfaces use different text. Not in A1 scope.
5. `cli-agent-output.component.ts`: the `@if` calls `fmtDuration` twice. Cosmetic.

## Checks of the focus list
- Call sites: inspector (component.ts ~325-360) uses the rule for both kinds. `formatElapsed` is gone from it, and `duration` null hides the badge. Dock delegates. Card-mode stats bar hides at null. Bubble hides at null.
- `node().duration` is milliseconds elsewhere (transcript-agent-facts.ts:120), so the `reportedMs` fallback is safe.
- Roster `startedAt`/`endedAt` for subagents are filled (roster.ts:144-145, 166-167, 189-190). `cliActivity` is exported as planned.
- Not run: no tests executed by me; relied on the orchestrator's passing results.

## Verdict
REVISE: fix finding 1 (use the event timestamp) and ideally 3 before accepting. Findings 2, 4 and 5 can be deferred.
