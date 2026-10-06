# Code Logic Re-review — `TASK_2026_614_327a`, Stage F + G fix round

Scope: only the fix commits `2b066cb08` (fix A), `5d96127c9` (fix B) and `2b8866511` (fix C). I read the source hunks of each commit and the surrounding code they depend on: `subagent-hook-handler.ts` `handleSubagentStop`, `subagent-state-store.ts` `lazyCleanup`, `main.ts` `deactivate` and `killRunningChecksWithin`, and `session-budget-settings.component.ts` `commit`, `commitPartner` and `write`. I did not re-run the test suites; the fix reports record exit-0 runs.

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0 (new)  |
| Moderate issues     | 0        |
| Minor issues        | 4        |
| Failure modes found | 4 (all Minor) |

## Finding status

| Finding | Status | Evidence |
| --- | --- | --- |
| Review A S1 (F.5 B1 / F-F unbound foreground start) | PARTIAL, recorded and accepted | Hold: `subagent-hook-handler.ts:332-350`. Bind: `task-result-agent-binding.ts:43-68`, called at `user-message.transformer.ts:52` and `assistant-message.transformer.ts:289`. Registry: `subagent-registry.service.ts` `bindHeldStartToToolCall`. Residual recorded as NL-F2 at `batches.md:1337` and `:1371`, and in the commit message. |
| Review A M5 (eviction releases a shared realSessionId) | FIXED | `session-registry.service.ts:608-611` deletes the `bySessionId` entry only when it points at the evicted record. `:634-644` passes the real id only when `isSessionIdHeldByAnotherRecord` (`:660-674`) is false. That function checks both the `bySessionId` index and every remaining `byTabId` record. |
| Review B M1 (flush starved by the check kill) | FIXED | `main.ts:182` `await agentsReaped;` → `:184-193` CLI registry dispose → `:200` `await flushSessionMetadataStores()` → `:204` `await checksKilled;`. |
| Review B M2 (win32 retry on a reused pid) | FIXED | `run-check.tool.ts` `rootPidReleased` is set only by `child.on('exit')` on win32 (`:592-599`). `settle` lists `retryKill` only when `killFailure !== undefined && !closed && !rootPidReleased` (`:536-538`). |
| Review C Serious S1 / FM-1 (percent draft lost after focus moved into it) | FIXED | `session-budget-settings.component.ts:438-441` `blurred()` commits a pending draft. |
| Style review Serious S1 (620-line inline template) | FIXED | `session-stats-summary.component.ts:85` `templateUrl: './session-stats-summary.component.html'`. |

### S1: checking the PARTIAL claim

- **Foreground timing.** `handleSubagentStop` (`subagent-hook-handler.ts:433-456`) first tries the hook's `toolUseId`, then the agentId fallback. A held start has no record, so both miss. `:458-462` then discards the held start. A synchronous foreground Task's tool_result arrives after the stop, so by then nothing is held and nothing binds. The agent was unreachable for its whole run. This matches the report's residual, and NL-F2 records it. It also matches the claim that F-F (exact `agentId:` match only) gives no earlier link.
- **Bounded and released.** The map is keyed by agentId, and a new start for the same `(agentId, parentSessionId)` replaces the old one (`subagent-state-store.ts` `holdUnboundStart`). Entries leave on four paths:
  - bind (`discardHeldUnboundStarts` before `register`);
  - `already-registered` with the same agentId;
  - SubagentStop with no record (`subagent-hook-handler.ts:458-462`);
  - the `TTL_MS` (24 h) sweep in `cleanupExpired`, plus `clear()`.
  
  `holdUnboundStart` calls `lazyCleanup()`. The sweep is gated to once an hour (`subagent-state-store.ts:381-389`). No path leaks an entry permanently. The worst case is an aborted subagent that never stops: its entry stays for up to 24 h (Minor 2).
- **No wrong agent bound.** Binding needs four things:
  - exactly one distinct `agentId:` in the result (`task-result-agent-binding.ts:55-61`);
  - no existing record on that toolCallId;
  - exactly one held start with that id (`ambiguous` otherwise);
  - an exact string match.
  
  A start held under one id cannot be bound by a result that names a different id. The remaining imprecision is the toolCallId, not the agent: the seam runs on every tool_result, not only Task results (Minor 1).

### M1: checking the fix

- **The flush cannot be skipped by the reap or the kill.** `agentsReaped` is an async IIFE with its own try/catch (`main.ts:170-181`), so it never rejects. The CLI-registry dispose sits in a try/catch (`:184-193`). The flush is reached unconditionally (`:200`).
- **The kill keeps its 5 s bound.** `checksKilled` starts at `:166`, before the reap, at the same moment as before. `killRunningChecksWithin` (`:241-262`) races `killRunningChecks()` against a `budgetMs` timer and clears that timer in `finally`. There is no catch, but `killRunningChecks` is documented never to reject, so the promise left unawaited during the reap and the flush raises no unhandled rejection.
- **Total wall time is still bounded.** The deactivate path takes max(reap + flush, 5 s), plus the extension dispose.

### M2: checking the fix

A live root never emits `exit`, so `rootPidReleased` stays false and `settle` still registers `retryKill` (`:536-538`). On POSIX the `exit` listener returns early (`:593`), so the process-group retry is unchanged. If `exit` arrives after settle, only this run's entry is dropped (`if (settled) unregister()`). If `exit` arrives before settle, no retry is ever listed. A reused pid cannot be targeted by this run's retry once its root exit is observed.

### Fix C: checking the fix

- **No double write.**
  - A text input fires `change` before `blur`. `commit` from `change` reaches `write()`, which calls `this.savingKey.set(key)` synchronously (`:539`) before its first await. The `commit` from `blurred` then sees `busy()` and returns (`:446`).
  - If the change hit the "unchanged" branch, the draft is already cleared, so `blurred` does nothing.
  - If the user blurs while a partner write is in flight, `blurred` returns on `busy`. But `focusedKey` is now null, so `commitPartner` (`:470-478`) commits the draft after the write resolves. That is still exactly one write.
- **No markup change.** I extracted the old inline template from `2b8866511^`, removed the 4-space indent and diffed it against the new `.html`. The only difference is the leading blank line after `` template: ` ``. The new file contains no `\` and no `${`, so no template-literal escape was carried over wrongly. `styles` and `changeDetection: OnPush` are unchanged (`:86`, `:162`).

## New Blocking or Serious issues introduced by the fixes

None.

## Minor

1. **The seam is not limited to Task results.** `bindTaskResultToHeldStart` runs for every tool_result (`user-message.transformer.ts:52`, `assistant-message.transformer.ts:289`). Suppose a non-Task tool's output contains `agentId: <hex>` for a held agent before that agent's Task result arrives, for example a Bash or Read of a transcript. The record is then registered under that tool's toolCallId. The agent is correct, but the card and toolCallId link are wrong. This is rare: it needs a held start plus that text in an unrelated result. Fix: gate on the tool_use being a Task/Agent call. `TransformerState` already tracks Task tool_use ids for background detection.
2. **Held starts can stay for up to 24 h.** If a subagent is aborted and never stops, its held start stays for up to `TTL_MS`, and the sweep runs at most hourly. While anything is held, `hasHeldUnboundStarts()` is true, so every tool_result in every session pays a `JSON.stringify` and a regex scan (`task-result-agent-binding.ts:23`). This is bounded but wasteful. Clearing held starts on parent-session teardown would tighten it.
3. **The `no-held-start` WARN is noisy** (`task-result-agent-binding.ts:63-67`). Take a foreground Task whose start was held and then discarded at stop. If any other start is held when its result arrives, the WARN fires for a normal, expected sequence, and it also fires for any agentId-bearing result unrelated to a held start. Consider DEBUG level, or WARN only when the toolCallId is a known Task call.
4. **`checksKilled` is not awaited if the flush throws** (`main.ts:200-204`). If `flushSessionMetadataStores()` throws, `deactivate` rejects before `await checksKilled`. The kill still runs and never rejects, so the only loss is the bounded wait. This is unchanged in kind from before the fix.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for M1, M2, fix C and M5; MEDIUM for the S1 seam, because SDK ordering of the background result against the stop is taken from the report and spec, not observed live.
- Top risk: a foreground subagent whose SubagentStart lacks `toolUseId` is still unreachable for stop, steer and budget stop during its run. This is the recorded PARTIAL, NL-F2.
- What a robust implementation would add: restrict the binding seam to Task tool_use ids; discard held starts on parent-session teardown; lower the `no-held-start` log level.
