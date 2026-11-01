# Code Logic Review, Phase 2 — `TASK_2026_856_d668`

Review family: claude reviewing codex (18 commits, `git diff 6f523472a..HEAD`; codex lanes plus orchestrator corrections #21-#26). Read-only. No tests run; I read the diffs, the surrounding whole components and the shared helpers.

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 6        |
| Failure modes found | 6        |

Evidence for 8 rather than 9: every focus point holds, but there is one cross-view inconsistency in the context % (M1), a loading-state flicker in the drawer (M3), and several beyond-plan `—` placeholders (M6). Evidence for 8 rather than 7: no stale-clock read feeds a value that matters, the clock service releases on every path, and each user-approved removal is gone with no remaining non-spec reference.

## Focus points

1. **Stale-clock reads.** `WallClockService.acquire` writes `Date.now()` into the tick (`wall-clock.service.ts` acquire), and a hidden document refreshes the tick on becoming visible (`visibilityChanged`). I checked every conditional consumer:
   - `agent-card.component.ts:265`, `inline-agent-bubble.component.ts:956`, `canvas-lane-tabs.component.ts:280`: `now()` is read only through `agentRunDurationMs` with `running` true. Finished runs use `endedAt` or `reportedMs`, never `now`. OK.
   - `subagent-lane.component.ts:270,325` (#21): `live ? now() : Date.now()` is correct. `label` (`:290-301`) passes `now()` with `running: live`, so it is unused when idle. OK.
   - `inspector-agents-section.component.ts:278-281`: same pattern, OK.
   - `permission-request-card.component.ts:214`, `question-card.component.ts:343`: the stale value at mount is old, so `expired` is false. The acquire effect then refreshes the tick before render, and the one-second error is harmless. OK.
   - `compact-session-card.component.ts:250-261`: the `mountedAt` floor stops a stale-old tick from shrinking elapsed. An idle card still shows a value frozen at mount time. Same as the old `signal(Date.now())` (#22).
   - `system-prompt-drawer.component.ts:338-339`, `provider-setup-wizard.component.ts:1747`, `overview-tab.component.ts:281`, `history-timeline.component.ts:348`, `stash-popover.component.ts:193`: each reads `now()` only in the state that activates its clock.
   - No consumer uses a stale value for a decision. The only decision made from the clock is the permission/question auto-deny (M4).
2. **B11 header total** (`cli-agent-output.component.ts` template). I traced the precedence: `a || b ? x : y` parses as `(a || b) ? x : y`, and `usage() && (...) ? '≥ ' : ''` as `(usage() && (...)) ? ...`.
   - `usage` null: "Reported total:", no `≥`.
   - Structured with `totalTokens`: "Reported total: N", no `≥`.
   - Structured without `totalTokens` (in+out sum): no label, `≥ N`.
   - Retained-segment fallback (`partial`): no label, `≥ N`.
   - `headerTokens` follows `usage().tokens` and `cliUsageTokenTotal` (`libs/shared/src/lib/utils/cli-usage.utils.ts:26-47`), so it agrees with `cliLaneStats`, `CliLaneUsageSummary` and `laneUsage`. Correct.
3. **#19, #21-#26.**
   - #19: `cliUsageTokenTotal` treats `totalTokens: 0` as exact. This is safe because `usageTotals` starts `null` (`agent-monitor.store.ts:1450,1486,1947`), so a 0 comes from the host and is not an initialised default. OK.
   - #21 is correct (see 1).
   - #22 is accepted. The `—` for an invalid author date is still beyond the plan (M6).
   - #23 is verified: `turn-activity-panel.component.ts` has no placeholder token row, and cache is shown only when `> 0`.
   - #24: the analysis dashboard elapsed derives from the root `analysisStartedAt` (`setup-wizard-state.service.ts:189`). The stream is append-only (`wizard-phase-analysis.ts:72`) and cleared at `:457`, so `[0].timestamp` is stable. OK.
   - #25 is test-only. #26 is verified: grep finds no non-spec reference to `SessionCostSummary*`, `CacheCountdownClock`, `TranscriptLiveClock`, `commandCenterClock`, `syncTick` or `monitor.tick`. The `SessionCostSummary` interface in `subagent-cost.utils.ts` is unrelated.
4. **B18 `tabById`.**
   - Reactivity: `backgroundTabsRevision` is read first. It is bumped on a workspace switch, on `updateBackgroundTab` (`tab-workspace-partition.service.ts:210,405,439,466`) and on workspace removal. The active tab set is read through `TabManagerService.findTabByIdAcrossWorkspaces`, which passes `this._tabs()` (`tab-manager.service.ts:710-715`). Both paths are tracked.
   - Per-node cost: see M5.
5. **B14.** `subagentToolCount` is `max(finite host toolUses, displayed tool nodes)` (`subagent-tool-count.ts`), non-monotonic, as plan Component 15 and D12 specify. The tile labels it "Current known count". OK.
6. **Context % end to end.** The formula is pinned: `contextFillTokens` is input + cacheRead + cacheCreation, output excluded (`context-fill.utils.ts:5-17`). `trustedContextWindow` accepts a window only from an `sdk-native` or provider-catalog route observed for the same model. `contextFillPercent` returns null for an invalid count or window and does not clamp. The consumers differ, see M1.
7. **Beyond-plan placeholders.** Found, see M6.
8. **NUL byte.** `session-loader.service.ts` contains exactly 1 NUL (`grep -aoP '\x00' | wc -l` gives 1), and the file is not in the Phase 2 diff.

## Five logic questions

1. **Silent failure.** `confirmRegenerate` swallows the RPC throw (`system-prompt-drawer.component.ts` `catch {}`), which is intentional because host status is authoritative. If `loadStatus()` then fails, nothing is announced and `changed` is not emitted. The user sees only the inline load error with Retry. The `provider-setup-wizard.component.ts` cancel `.catch(() => {})` also dropped its `console.error` diagnostic (Minor).
2. **Unexpected user action.** Minimizing or hiding the Electron window stops the second clock, so a pending permission or question auto-deny is deferred until visible (M4). Reopening the drawer during a run restores the banner from host status, which is correct.
3. **Wrong answer.** An inspector tab with no host `turnCount`, no cursor and no loaded messages shows `0 turns` (M2). The inspector and the compact card can disagree on context % (M1).
4. **Dependency failure.** A host status RPC failure during the 30 s reconcile keeps the banner and retries on the next tick (`checkRegenerate` returns early when `loadStatus` is false). A tab that disappears yields `tabById` null, and every consumer null-guards.
5. **Missing, never requested.** There is no cap on how often `childStats` recomputes under high-frequency background updates (M5). The drawer has no non-blocking status refresh (M3).

## Failure modes

### M1 Context % disagrees between views
- Trigger: `live.contextWindow !== trustedContextWindow(live.contextCapacity, live.model)`, for example after a model switch before `contextWindow` is refreshed.
- Symptom: the inspector shows a percent. The compact card and Command Center show `—`.
- Evidence: `session-inspector.store.ts` `orchestratorCard` computes `contextFillPercent(live.contextUsed, trustedWindow)` with no equality check. `compact-session-card.component.ts:~283-288` and `session-stats-view.ts:43-47` require `contextWindow === trustedWindow`. `sessionContextCue` also uses the host's `contextPercent`, while the card and inspector recompute it.
- Current handling: the three computations are independently correct, but the gate differs.
- Recommendation: route all three through `sessionContextCue` or one shared helper.

### M2 Inspector shows `0 turns` while history is unloaded
- Trigger: a restored tab with `sessionStats` absent, messages not yet loaded and `olderHistoryCursor` undefined.
- Evidence: `resolveTurns` returns `loadedTurns` (0) when `olderHistoryCursor == null` (`session-inspector.store.ts`, `resolveTurns`). This matches plan Component 12 step 2 but treats "not yet loaded" as "complete".
- Recommendation: return null when the tab has a `claudeSessionId` and no loaded messages and no host stats.

### M3 Drawer body flickers every 30 s during a run
- Trigger: the coarse reconcile calls `checkRegenerate`, which calls `loadStatus`, which sets `isLoading`.
- Evidence: `system-prompt-drawer.component.ts` effect near the constructor, and the template `@if (isLoading())` at `:143`. The whole body (metadata, preview and download buttons) is replaced by "Loading system prompt status…", so focus on the preview button is lost.
- Recommendation: use a background-refresh flag that does not set `isLoading`, or keep the body mounted.

### M4 Auto-deny deferred while the document is hidden
- Trigger: the window is minimized or hidden, so the second clock is stopped (`wall-clock.service.ts` `visibilityChanged`).
- Evidence: `permission-request-card.component.ts:214-221` and `question-card.component.ts:343` derive `expired` from the clock. The old `setInterval` kept running (throttled).
- Symptom: the client-side timeout response arrives only when the window is visible again. The host's own timeout still applies, so a late deny for an already-timed-out request is possible. Verify that the host ignores it.

### M5 `childStats` recompute cost
- Evidence: `command-center-page.component.ts:98-128`. Each background update bumps the revision, so `childStats` re-runs `findTabByIdAcrossWorkspaces` for every node. Each lookup scans the active tabs and then every workspace set, which is O(nodes × tabs). It returns a new object each time, so downstream rendering re-runs.
- Impact: noticeable only with many nodes and tabs under streaming background updates.
- Recommendation: build one id-to-tab map per revision, or give the computed an `equal` function.

### M6 Beyond-plan `—` placeholders (focus 7)
- `history-timeline.component.ts:66-67`: `relative` and `absolute` are `—` for an invalid date. Plan B19b is "UI: no". Accepted by #22 but still beyond the plan.
- `stash-popover.component.ts:87`: `age(entry) || '—'`.
- `workspace-indexing.component.ts:150`: null gives `—`, so `workspace-indexing.component.html:194` can render "— . Workspace is up to date".
- `analysis-stats-dashboard.component.ts` `elapsedTime` returns `—` when not started. The orchestrator restored the loading skeleton (#24), but the elapsed `—` remains.
- `token-badge.component.ts` `formatTokens` returns `—` for an invalid total. This is defensible as invalid data.
- The rule "missing renders `—` only for absent or invalid data" holds in all of these, but they add visible UI the plan did not ask for.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

- M1 to M6 above (Moderate).
- Minor: `cli-agent-output.component.ts` `headerStats` has a `usage() === null` path. It is dead, because the only consumer (`agent-card.component.ts:239`) always passes `[usage]`. If it were used, a segment sum would be labelled "Reported total" with no partial marker.
- Minor: `subagent-lane.component.ts:325` calls `Date.now()` for a non-live lane inside a computed, so the warm/cold state refreshes only when the record changes. This is the same limitation as before.
- Minor: `memory-diagnostics-accordion.component.ts:256` moves the event clock to the coarse tick, so `nextDueAt > now` in the storage-health panel can be stale by up to 30 s. Negative event ages already clamp to "just now" (`event-feed.component.ts:85`).
- Minor: the analysis dashboard elapsed keeps counting after the analysis finishes (as it did before).
- Minor: `provider-setup-wizard.component.ts` cancel failures no longer log.

## Data flow

1. Host `SessionStatsEntry` and `liveModelStats` arrive in the tab state. OK.
2. Token and cost totals come from `sessionTokenTotal`, `messageTokenTotal` and `cliUsageTokenTotal`. The frontend never sums across sessions, and partial data is marked `≥`. OK.
3. Context % comes from `contextFillPercent` with a trusted window. See M1 for the inconsistent gate.
4. Turns come from host `turnCount`, else the loaded count only if fully loaded. See M2.
5. Clocks go through `injectWallClock`, which is released on every path and refreshed when the document becomes visible. OK.
6. The Command Center reads tabs across workspaces with a revision dependency. OK, see M5 for cost.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| One shared clock, no per-component timers | COMPLETE | None found (grep for `setInterval` in the touched components) |
| Host is the source of truth for totals | COMPLETE | Retained-segment fallback is labelled partial |
| Context % correct and pinned | PARTIAL | Views gate the window differently (M1) |
| Persisted/derived turns | PARTIAL | M2 |
| Approved removals, nothing depends on them | COMPLETE | Verified by grep |
| "Missing renders `—`", not loading | PARTIAL | Extra placeholders (M6) |

Implicit requirements not addressed: a non-blocking background refresh for the drawer (M3).

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Host `totalTokens` 0 | YES | `cliUsageTokenTotal` exact | None (#19) |
| Clock inactive at mount | YES | acquire refreshes before render | None |
| Document hidden | PARTIAL | tick refreshed on visible | M4 |
| Background tab update | YES | revision signal | Cost M5 |
| Invalid author date | YES | `—` | Beyond plan (M6) |
| Subagent tool count lag or trim | YES | max of both | Non-monotonic by design |
| `session-loader.service.ts` NUL | YES | exactly 1 | None |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH on the clock and total logic, MEDIUM on the visual placeholder impact, because I did not run the UI.
- Top risk: the context % gate differs between the inspector and the card (M1).
- A robust implementation would add:
  - one shared context cue helper;
  - a non-blocking drawer status refresh;
  - an id-to-tab map in `childStats`;
  - a loaded-state guard for the inspector turn count.
