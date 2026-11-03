# Code Logic Review — `TASK_2026_856_d668` (Phase 1, waves 1-6)

Review family: claude (reviewer) vs codex (implementer)

Scope: `git diff 9e797082e..HEAD -- libs apps` (18 commits), read in full for the files named in the brief, plus the call paths around them. Scoped check run: `npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="session-loader.service.spec|session-live-stats.util"` passed (1 task, exit 0). This covers the CX4 final guard that the lane report says was never retested. `session-loader.service.ts` still has its one pre-existing literal NUL at line 1356 (the `${sessionId}\0${agentId}` key); the same count exists at the base commit and the phase did not touch it.

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 7/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 1              |
| Moderate issues     | 5              |
| Failure modes found | 8              |

Score rationale: the shared helpers, ledger prompt detection, `WallClockService` and the owner turn counting are sound, and the three plan deviations (#12, #13, #15) are correct. Two behaviours fall short of the goal that "nothing is wrong or stale". The first is the CX4 carry-forward, which can show a stale percent as a known one. The second is the live/raw turn-count drift. Neither loses data, so the score stays above 6. It stays below 8 because of the Serious finding and the unretested CX4 guard history.

## Verdicts on the numbered points

1. **CX4 carry-forward (session-loader.service.ts:1255-1325).**
   - Cross-session carry: no reachable path today. The only callers are line 1083 (inside `loadSession`) and line 1742 (restored tab).
     - Line 1742 first checks `restoredTab.claudeSessionId === sessionId`.
     - Line 1083 uses either `openSessionTab(sessionId)`, which returns a new tab or the tab already owning that session, or `requireTargetTab`, which rejects a tab owning a different session (`:1217-1221`). The rebind path resets `liveModelStats` to null (`tab-manager.service.ts:2882`), and `resetTab` does so at `:1641`.
     - The only adoptable case is a null-owner target tab. That tab can hold a live reading from a first, not-yet-bound turn, and it is then adopted. This is not session confusion, but it is not blocked either.
   - The guard is implicit: `LiveModelStatsPayload` has no session identity, and `sameModel` compares model names only. See Moderate M1.
   - Real defect: stale carry across compaction. See Serious S1.
   - Variant defect: `normalizeModelKey` strips `[1m]`-style variant tags (`pricing.utils.ts:292-295`). A trusted 200k window observed for the base model is therefore reused for the 1M variant (M2).
2. **`contextFillTokens({ input: numerator })` (session-live-stats.util.ts:79-81).** Cosmetic only. `numerator` is already guarded as finite and `>= 0`, so the helper returns `numerator` unchanged. It does not change behaviour, but it reads as if it sums token classes, which misleads a later reader (Minor).
3. **TC1 ledger prefilter (session-usage-ledger.ts:157-161): correct.**
   - Every real user prompt line contains the literal `"user"` (`"type":"user"` and/or `"role":"user"`), so no prompt is lost.
   - A line is dropped only when it contains an unescaped `"tool_result"`. That string appears only as a block type. Prompt text that mentions tool_result is JSON-escaped (`\"tool_result\"`) and does not match, so a user pasting that text is still counted.
   - Prompts whose content array has both text and a tool_result block are excluded by the same test and again in `prompt` (`:213-222`).
   - The extra parse cost is limited to user and attachment-style lines that carry `"user"` and no existing marker. `tool_result` lines stay skipped. Perf: `session-stats-reader.perf.spec.ts` is opt-in (`PTAH_PERF_SPECS=1`) and its fixture has only short user lines (`:81-87`) and no tool_result-heavy transcript, so it cannot show the benefit or any regression of this prefilter (Minor, M5).
4. **turnCount parity: mostly correct, with drift (S/M findings below).**
   - Resume/raw overlap: no double count. `prepareRun` loads the prefix before the query launches (`session-stats-owner.service.ts:455-470`), and later runs reuse the frozen prefix, so each run counts only its own accepted results.
   - Prefix consistency: raw ledger and resume both use `SessionUsageLedgerBuilder` through `ledgerFromMessages` (`session-history-reader.service.ts:1326-1352`).
   - Drift: live counts only `accepted` results (plus `markRunIncomplete`, #13). It skips `ignored-error`, `duplicate`, `rejected-non-monotonic` and `rejected-invalid` results (`:1016-1032`), while the ledger counts every prompt. See M3.
5. **B3b `regenerationsInFlight`.**
   - The token-guarded `finally` is correct: a late completion after the ceiling cannot delete a newer run's entry.
   - Ceiling: `ENHANCED_PROMPTS_RUN_CEILING_MS` is the service's own lock timeout plus grace (`enhanced-prompts.service.ts:229-235`), so it matches the longest possible lock hold.
   - Forced run: deviation #12 is correct. It does not delete in the invalidate gap, and it deletes only on the ceiling or by token. It leaves a double-click window (M4).
6. **B1 `WallClockService`.**
   - Idempotent release: correct (`released` flag, per-cadence count).
   - Visibility: correct. The interval is stopped when the document is hidden, and the tick is refreshed and restarted on show. The listener is added on the first acquire and removed on the last.
   - Effect predicate: `onCleanup(untracked(() => acquire))` releases on false and on destroy. Signal writes inside an effect are fine on Angular 22.
   - Interval: `setInterval` runs in `runOutsideAngular`.
   - Gap: the `now` signal holds a stale value (the last tick) until the effect acquires, so the first render of a newly active consumer can see an old `now` (Minor, m1).
7. **B4 `backgroundTabsRevision`.** The four mutation points in the plan are bumped (`switchWorkspace :210`, `updateBackgroundTab :405`, `addTabToWorkspace :439`, `removeWorkspaceState :465`). The no-op early return in `updateBackgroundTab` correctly does not bump. No required bump is missing. One caveat: nothing in Phase 1 reads the signal (M6).
8. Silent failures, stale state and stubs: see the sections below. No stubs and no empty catches were found in the diff.

## Five logic questions

### 1. How does this fail silently?

- The tab shows a pre-compaction context percent as a *known* value after resuming a compacted session (S1, `session-loader.service.ts:1279-1295`).
- Live `turnCount` quietly drops a turn whose result is ignored, a duplicate or non-monotonic (`session-stats-owner.service.ts:598-604`, `:1016-1032`). `turnCount` stays present and looks complete; no `incomplete` flag is raised.
- `getStatus` reports "not regenerating" for a whole run when a second `regenerate` lands in the force-invalidate gap (M4, `enhanced-prompts-rpc.handlers.ts:535-545`, `:602-612`).

### 2. What user action produces unexpected behaviour?

- Double-clicking Regenerate with `force` (the default) inside the cache invalidate await (M4).
- Resuming or reloading a session in a tab that still holds a reading from before an out-of-band compaction (S1).
- Switching model from base to the 1M variant of the same family, then resuming (M2).

### 3. What input data produces a wrong answer?

- A turn whose SDK result carries zero usage or an error flag: the ledger counts the prompt, the live owner does not. Turn count differs between a live session and the same session after a reopen (M3).
- A session whose last assistant record is a `compact_boundary`: the host gives no `contextSnapshot`, and the frontend substitutes the old reading (S1).

### 4. What happens when a dependency fails?

- Prefix read fails: `failedSessionStats` has no `turnCount`, `hasAllTurnCounts` becomes false, and the field is omitted (`session-usage-aggregator.ts:343-350`). Correct.
- Invalid snapshot in the resume reply: `isValidSessionStatsSnapshot` rejects it whole and the tab keeps its reading (`:1245-1251`). The new `turnCount` check requires a non-negative safe integer (`session-stats-snapshot.ts:49`). Correct.
- Regenerate throws before the lock: the `finally` deletes the entry by token. Correct.

### 5. What is missing that the requirements never mentioned?

- A session identity on `LiveModelStatsPayload`, so a carried reading cannot be applied to a session it was not measured for (M1).
- A consumer of `backgroundTabsRevision` (planned for Phase 2; see M6).
- A perf fixture with large tool_result lines, so the new prefilter has a measured baseline (M5).

## Failure modes

### Stale carry across compaction

- Trigger: tab holds a reading from before a compaction (compaction ran while the tab was not receiving events, or ran in another process); the tab is resumed or resynced.
- Symptom: Host `extractContextSnapshot` returns `undefined` at a `compact_boundary` (`session-history-reader.service.ts:1286-1288`), and the loader carries the prior `contextUsed` (`session-loader.service.ts:1279-1295`). The tile shows for example 90% instead of the post-compaction value or a dash.
- Evidence: `session-loader.service.ts:1279-1295`.
- Current handling: the only gate is same model plus a trusted prior window. Nothing records that the reading predates the boundary.
- Recommendation: carry only when the resume reply states no compaction since the reading (for example compare `compactionCount` or the boundary position), or when `preserveCompactionContextSeed` is set. Otherwise show the unknown placeholder.

### Variant-blind window reuse

- Trigger: prior reading's capacity is for the base model, the new snapshot is for the `[1m]` variant, and the host gave no trusted capacity for it.
- Symptom: percent computed against 200k for a 1M session (inflated, possibly above 100%).
- Evidence: `sameModel` uses `normalizeModelKey` (`session-loader.service.ts:1323-1329`) and the snapshot branch reuses `prior.contextCapacity` (`:1313-1320`).
- Current handling: window is reused when the normalised names match.
- Recommendation: also require `prior.contextCapacity.model === snapshot.model` (exact), as `trustedContextWindow` already does for `prior.model`.

### Live vs raw turn count drift

- Trigger: error result with zero usage, a duplicate cumulative result, a non-monotonic rejection, or an invalid result.
- Symptom: live count lower than the count after reopening the same session.
- Evidence: `session-stats-owner.service.ts:603` (increment only on `accepted`) versus `session-usage-aggregator.ts:228-236`.
- Current handling: no flag.
- Recommendation: count a turn on every result that reaches the owner, or mark the run `incomplete` for the skipped outcomes so the field is omitted instead of low.

### Regenerate guard lost in the invalidate gap

- Trigger: two `regenerate` requests inside the `await cacheService.invalidate()` window (`enhanced-prompts.service.ts:826-828`).
- Symptom: `liveEntry` returns null in the gap (deviation #12), so the second request overwrites the entry with its own token. The service lock then refuses one of them; its `finally` deletes the entry, and `getStatus` reports no regeneration for the rest of the other run.
- Evidence: `enhanced-prompts-rpc.handlers.ts:535-545` (guard), `:602-612` (`liveEntry`), `:578-582` (finally).
- Current handling: the service lock is the real guard, so no double run happens. Only the status is lost.
- Recommendation: when `set` finds an existing non-expired entry whose lock is not yet held, keep it and reject the new call; or give the entry an `acquired` flag rather than relying on `generationInProgress`.

### Wall clock first-frame staleness

- Trigger: a consumer becomes active after the clock was idle.
- Symptom: one frame computed with an old `now` (negative or understated elapsed in `chat-transcript` and `lane-transcript`; the cache tile can show a stale remaining time).
- Evidence: `wall-clock.service.ts:25-26` (initial value), `:112-115` (effect acquire), `chat-transcript.component.ts:834-837`.
- Current handling: the effect runs after the render and sets the tick; `boot-progress` clamps with `Math.max(0, ...)`, others rely on the next tick.
- Recommendation: have `now()` return `Date.now()`-fresh values on read when the cadence has no subscribers, or refresh the tick when the active predicate flips.

### Per-delta revision bumps

- Trigger: streaming into a background workspace.
- Symptom: every `updateBackgroundTab` bumps the revision (`tab-workspace-partition.service.ts:405`), so every computed that reads it recomputes per chunk once consumers exist.
- Evidence: `:402-406`.
- Recommendation: acceptable now; revisit when Phase 2 adds readers.

### Prefilter measured nowhere

- Trigger: a transcript dominated by `tool_result` lines.
- Symptom: none today; benefit and regression unknown.
- Evidence: `session-stats-reader.perf.spec.ts:81-87` (only short user lines).
- Recommendation: add a large-tool_result fixture to the perf spec.

### Revision signal has no reader

- Trigger: any reactive lookup in a background workspace.
- Symptom: `findTabByIdAcrossWorkspaces` is intentionally untracked (plan D9), so the lookup stays stale unless a caller reads `backgroundTabsRevision()` first. Commit 8cda65b2b's message ("make cross-workspace tab lookups reactive") overstates the change.
- Evidence: `tab-manager.service.ts:245`, `:710-715`; no non-spec reader in `libs`.
- Recommendation: land the readers in the batches that need them (plan lines 453 and 492) and keep the contract comment on the finder.

## Blocking issues

None.

## Serious issues

### S1. Pre-compaction reading shown as known after resume

- File: `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:1279-1295` (host side `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:1286-1288`)
- Scenario: the transcript ends at a compact boundary, so the host intentionally sends no `contextSnapshot`. The tab still holds an older reading for the same model, and the new `carried` branch re-applies its `contextUsed`.
- Impact: context percent is wrong and presented as known (the opposite of the task goal). Before this change the result was the unknown placeholder.
- Fix: gate the no-snapshot carry on evidence that no compaction happened since the reading, or restrict it to the `preserveCompactionContextSeed` case.

## Moderate and minor issues

- M1 (Moderate) `session-loader.service.ts:1255-1258`, `:1323-1329`: the carry has no session identity check of its own. It relies on `requireTargetTab` and the rebind reset to guarantee same-session. Add the session id to the reading, or compare `tab.claudeSessionId === sessionId` explicitly before carrying.
- M2 (Moderate) `session-loader.service.ts:1313-1320`: variant-blind window reuse (see failure mode).
- M3 (Moderate) `session-stats-owner.service.ts:603`, `:1016-1032`: live turn count skips non-accepted results, so it drifts from the raw ledger.
- M4 (Moderate) `enhanced-prompts-rpc.handlers.ts:535-545`, `:602-612`: double-click race in the invalidate gap. Also, `generationInProgress` is service-wide, so a lock held by another operation (a runWizard) would make a pending regenerate entry look live.
- M5 (Moderate/Minor) `session-stats-reader.perf.spec.ts`: no fixture exercises the prefilter's skip path.
- M6 (Moderate) `tab-manager.service.ts:245` and the commit message for 8cda65b2b: signal exists but is unread; the wording claims more than the code does.
- m1 (Minor) `wall-clock.service.ts:25-26`, `:112-115`: stale first frame.
- m2 (Minor) `session-live-stats.util.ts:79-81`: `contextFillTokens({ input: numerator })` is an identity wrapper. Replace with `numerator` or a comment.
- m3 (Minor) `session-usage-aggregator.ts:225-231`: in `range` scope a prompt without a timestamp is dropped silently; only usage records count toward `untimestampedCount`.
- m4 (Minor) `session-usage-ledger.ts:213-222`: synthetic prompt text such as "[Request interrupted by user]" and slash-command wrapper messages count as prompts. Consecutive-prompt merging softens this, but a standalone one adds a turn.
- m5 (Minor) `lane-report-CX4.md`: the final guard was not retested by the lane; I reran the two spec groups and they pass, but no spec pins the cross-compaction case (S1).

## Review of deliberate deviations

- **#12 (B3b `liveEntry` keeps the entry when the lock is not held):** correct and necessary. Deleting in the gap would hide the run for its whole duration (`enhanced-prompts.service.ts:826-828` before `:509-511`). The cost is the residual race in M4, which is smaller than the failure it avoids.
- **#13 (TC2 counts a turn in `markRunIncomplete`):** correct. `applyResult` clears `incomplete` on the next accepted result (`:1031`), so without the increment that turn would vanish once the field reappears. While `incomplete` is true the field is omitted, so nothing wrong is shown. The same reasoning should extend to the other non-accepted outcomes (M3).
- **#15 (CX2 extra sidechain skip in `seedLiveUsageBaseline`):** correct. It applies the same C4 fix to the same backward scan (`session-history-reader.service.ts:845`). The seed keeps output tokens because it models `compact_metadata.pre_tokens`, so no change to `contextFillTokens` is needed there.

## Data flow

1. Transcript JSONL line to `visit()` prefilter: OK (prompt shapes covered; tool_result skipped).
2. Prompt to `MutableRecord.prompt` to `UsageRecord.prompt`: OK (meta, sidechain, compact summary and tool_result blocks excluded).
3. Ledger to `aggregateLedgers` `turnCount` (consecutive prompts merge): OK. Range scope drops untimestamped prompts (m3).
4. History reader to `ledgerFromMessages` to the same builder: OK, same rules as the sessions list.
5. Owner prefix + per-run turns to `build()` to `turnCount` in the snapshot: OK for accepted results; M3 for the rest. Omitted when `incomplete` or any part lacks a count.
6. Snapshot to RPC to `isValidSessionStatsSnapshot` (turnCount integer >= 0): OK.
7. Resume reply to `applyResumeStats` to `setLiveModelStats`: gap S1/M1/M2 on the carry branches.
8. Tab state to views via `trustedContextWindow` / `contextFillPercent`: OK, behaviour identical to the removed inline copies.
9. Clock: `injectWallClock` to `WallClockService.acquire` to interval: OK; first-frame stale (m1).
10. Regeneration: handler map to `getStatus.regenerationStartedAt`: OK except M4.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| One shared clock for client timers | COMPLETE for the migrated sites (boot progress, cache tile, transcripts) | `commandCenterClock` / `AgentMonitorStore.tick` removals belong to later batches |
| Context % calculated once, host as source | PARTIAL | S1, M2 carry paths can show a wrong known value |
| Host lifetime `turnCount` | PARTIAL | Live path drifts from raw (M3) |
| Regeneration state from host | COMPLETE with a narrow race | M4 |
| Reactive cross-workspace tab lookup | PARTIAL | Signal exposed; no reader yet (M6) |
| Shared token helpers (`contextFillTokens`, `trustedContextWindow`, `contextFillPercent`) | COMPLETE | m2 cosmetic wrapper |

Implicit requirements not addressed: session identity on live context readings; a perf fixture for the prefilter.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Prompt text mentioning tool_result | YES | JSON escaping avoids the prefilter match | none |
| Prompt with text plus tool_result block | YES | excluded as a result carrier | none |
| Prompt with only an image block | YES | `image` accepted | none |
| Resume after the owner was replaced | YES | prefix read once, before launch | none |
| Resume prefix fails to load | YES | `turnCount` omitted | none |
| Run with only `markRunIncomplete` results | YES | field omitted, counted once complete (#13) | none |
| Error / duplicate / non-monotonic result | NO | not counted | M3 |
| Resume at compact boundary with stale prior | NO | stale value carried | S1 |
| Base to `[1m]` variant | NO | window reused | M2 |
| Document hidden then shown | YES | interval stopped, tick refreshed | none |
| Release called twice | YES | idempotent | none |
| Regenerate past ceiling | YES | entry deleted, token-guarded `finally` | none |
| Two regenerates in invalidate gap | NO | status lost | M4 |
| Background tab updated with identical streaming state | YES | no bump | none |

## Verdict

- Recommendation: REVISE
- Confidence: MEDIUM-HIGH (all cited code read; one scoped spec run; no live UI run)
- Top risk: the CX4 no-snapshot carry shows a pre-compaction context percent as a known value (S1).
- What a robust implementation would add: a compaction/session guard on every carry branch with a pinning spec; exact capacity-model match for window reuse; counting or flagging every non-accepted result for `turnCount`; an `acquired` flag on regeneration entries; a tool_result-heavy fixture in the perf spec; first-frame freshness in `WallClockService.now()`.
