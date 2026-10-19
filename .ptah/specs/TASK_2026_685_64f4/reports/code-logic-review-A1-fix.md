# Code Logic Review: A1 fix round, TASK_2026_685

Review family: Claude reviewer, codex implementer

Scope: uncommitted diff vs HEAD 251940720 in `libs/frontend/chat-streaming` (accumulator-core, agent-monitor.store and specs), `libs/frontend/chat-ui` `agent-duration.ts`, and `libs/frontend/chat` `inline-agent-bubble.component.ts`. Orchestrator reported test, typecheck and lint passing for the four projects. I ran nothing.

| Metric | Value |
| --- | --- |
| Score | 8.5/10 |
| Verdict | APPROVED |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 1 |
| Minor | 3 |

## Finding 1 (Serious in the first review): fixed

- `accumulator-core.service.ts:454` passes `event.timestamp` to `onTaskToolResult`.
- `agent-monitor.store.ts:2432-2445` stores that value as `completedAt`. `Date.now()` is used only when the argument is undefined or non-finite.
- The pending/running guard at `:2436` is preserved. A tool_result that arrives after a real terminal event cannot overwrite `completedAt`.
- Specs prove it. `agent-monitor.store.spec.ts:838-852` covers a replayed old timestamp (completedAt becomes 2000) and the NaN fallback. `accumulator-core.service.spec.ts:989-999` covers forwarding.
- A replayed foreground agent therefore no longer gets a wall-clock end time, so its duration is no longer inflated.

## Finding 3 (carry-forward): fixed, no regression found

- Start (`:2039-2041`), progress (`:2136-2138`) and status (`:2173-2175`) cases:
  - A start or progress event on a record that is still pending or running yields `completedAt` undefined.
  - A start or progress event on a terminal record keeps `existing.completedAt`.
- A late idempotent progress or start on a terminal record keeps both the terminal status and its end time. Progress keeps `existing?.status ?? 'running'`. Start keeps a terminal status.
- A resume sequence (status `running` clears `completedAt`, a later completion sets a new one) is covered by `agent-monitor.store.spec.ts:767-781`.
- `agent_completed` (`:2211`) sets `completedAt` from `event.timestamp`. Restore (`:1702`, `:1719`) parses `ref.completedAt` safely.
- Paused or non-terminal statuses clear `completedAt`. The bubble then falls back to `reportedMs`, which is acceptable.

## Bubble `agentDuration` (`inline-agent-bubble.component.ts:889-898`): correct

- Pending and running records use `now - startedAt`. A missing `startedAt` returns null, so the badge is hidden rather than wrong.
- Finished records with both timestamps use `endedAt - startedAt`, so they do not grow with the wall clock.
- Finished records missing either timestamp use `reportedMs`, preferring `record.durationMs` over `node().duration`. All sources are milliseconds (`node.ts:194`).
- The `formatAgentDuration(...) !== null` filter hides sub-second runs. It also keeps the value at 1000 ms or more, so the shared badge's "below 100 means seconds" heuristic (`duration-badge.component.ts`) cannot misread it. The footer therefore agrees with the other surfaces on the hide-under-one-second rule.
- The known-limitation comment is accurate. `Date.now()` is not reactive, so a running badge freezes between events. The fix report states the same.

## Findings

### Moderate: running badge freezes with no timer (`inline-agent-bubble.component.ts:896`)

- Scenario: a running agent that is quiet for a while shows a stale "Working" duration until the next event.
- Impact: it is under-reported, not wrong, and it is documented. A replayed session with a never-terminated record shows a large duration computed from an old `startedAt`.
- Fix: a shared ticking `now` signal, or accept it and track it as follow-up.

### Minor: no spec for a late idempotent progress or start on a terminal record (`agent-monitor.store.spec.ts`)

- The carry-forward behaviour is correct in code (`:2039`, `:2136`). I verified it by reading only. A one-line spec would pin it.

### Minor: repeated terminal status event moves `completedAt` forward (`agent-monitor.store.ts:2173`)

- A duplicate `completed` status after `agent_completed` replaces the end time with the later timestamp. The spec at `:780-781` encodes this deliberately. Skew is small, but it is a last-writer-wins rule.

### Minor: `onTaskToolResult` never sets `startedAt` (`:2440`)

- A record created before a start event has no `startedAt`. Every other path sets one, so this is only an edge. The result is a fallback to `reportedMs`, not a wrong value.

## Five logic questions

1. Silent failure: none new. An invalid timestamp falls back to `Date.now()`, which is spec'd.
2. User action: resuming a completed agent clears the end time correctly.
3. Input data: NaN or non-finite timestamps are guarded in `onTaskToolResult` and in `agentRunDurationMs`. Negative values yield null.
4. Dependency failure: not applicable beyond the event shapes above.
5. Missing: a live tick for running durations (documented), and the spec noted above.
