# Code Logic Review — TASK_SESSION_HANDOFF (f80136b99, b85f78b86)

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6.5/10 |
| Assessment | NEEDS_REVISION (minor) |
| Blocking | 0 |
| Should-fix | 3 |
| Nit | 4 |

Not run: tests (read-only review). Scope: full read of `adoptLanes`, `reparent`/`childrenOf`, `SessionHandoffService.start/adoptWork`, `takeHeldCompletions`, `transformTaskStarted`/`announceBackgrounded`/`takeBackgroundTerminalEvent`, `AgentMonitorStore.onSubagentEnded`/`onAgentCompleted`, `BackgroundAgentStore.resolveKey/onStarted`, `handleSubagentEnded`.

## Commit 1 — adopt work at handoff (f80136b99)

What holds up:
- Id matching: `adoptWork` matches on both `caller.tabId` and `caller.realSessionId` (session-handoff.service.ts adoptWork `fromIds`), and `adoptLanes` compares against `info.parentSessionId` which may hold either. Correct.
- Rekey after adoption: if the successor has no SDK id yet, lanes get the successor tab id. `sdk-callbacks.ts:271-285` computes `remappedAgentIds` from `parentSessionId === tabId` and calls `resolveParentSessionId`, so adopted lanes follow the rekey, including the re-persist of exited lanes. Correct.
- Children: `reparent` clears `parentSdkSessionId` when the successor has none. Readers fall back through `sdkIdOf(parentSessionId)` (spawner `recordOrganization` ~:892, `list` via `childrenOf([caller, sdkIdOf(caller)])` :639, ownership check :1120). Held completions drain via `takeHeldCompletions` :771 with the same lookup, so a held completion is taken exactly once by the successor and the `lastCompletion` is updated. Correct.
- Lanes: `status !== 'running'` skip is right. The only other statuses (`stopped`, `timeout`, exit states) have already signalled; moving them would be pointless.
- Fault isolation between lane and child halves is correct.

### Should-fix

1. **Handoff race window before adoption.** `session-handoff.service.ts` ~:240-262: `adoptWork` runs only after `await host.startHandoffSession(...)` returns. A lane or child that completes during that await (up to the start deadline) signals the OLD parent: paid turn in the full context, or lost if the tab is closed. Since the whole point of the commit is that case, either adopt before the await (then roll back on `session-start-failed`) or document the window in the skill. The same applies to a lane the caller spawns after the handoff; those stay with the caller, which is expected but the reply does not say so.
2. **Adoption is skipped when the start "times out but opens late".** On `start-timeout`/refusal paths nothing is adopted, but the late-opened session can still become the real successor, and `already-handed-off` is not recorded either. Work then stays stranded with no signal to the caller. Consider logging/including in the refusal detail that nothing was adopted.
3. **Test strength for children.** `session-handoff.service.spec.ts:88-94` stubs `registry.reparent` and `agents.adoptLanes` with fakes (`links.reparent`), so the handoff spec proves call wiring, not that a held completion reaches the successor. No test composes a real `SessionChildRegistry` + `SessionSpawnerService.takeHeldCompletions` after `reparent` with a tab-id-only successor (the SDK-id-cleared path, which is the riskiest). Add one integration-style test.

### Nits
- `adoptLanes` accepts any parent equal to a tab id, including a different tab that reused the SDK id after a resume. Low risk; note only.
- `adoptedLine` truncates nothing; a caller with many lanes gets a long reply. Fine.
- `sessionHandoffReply` places adoption text before the "tabOpened" instruction; OK.

## Commit 2 — settle background subagents (b85f78b86)

### Should-fix

4. **Likely duplicate background_agent_started / terminal events for explicit `run_in_background: true` spawns.** `system-message.transformer.ts` ~:246-262 now calls `announceBackgrounded(origin: 'task_started')` even though the Task tool_use already ran the assistant path (`assistant-message.transformer.ts:205-214` `markPendingBackground`, and `:278-315` which later emits its OWN `background_agent_started` from the placeholder tool_result with no `isBackgroundAnnounced` check; `background-started-event.ts:44-73`). The guard in `announceBackgrounded` only sees `record?.isBackground` / `status==='background'`; `markPendingBackground` only adds an id to a pending set (`subagent-state-store.ts:261`), and the record usually does not exist yet at `task_started` (the code comments say SubagentStart fires after). So: task_started announces (agentId undefined, keyed by toolCallId in `BackgroundAgentStore.onStarted` via `resolveKey`), then the tool_result emits a second started event with `placeholderAgentId` (different key) = possible duplicate tray entry. Further, origin `'task_started'` now makes `takeBackgroundTerminalEvent` (:530-545) emit an extra `background_agent_completed` for these spawns, which that function's own doc says caused duplicate tray entries when SubagentStop already ended the entry. The new test "stays silent when the spawn was already classified as background" sets up the record as already background; it does not cover the realistic ordering (pending flag set, no record yet). Fix: in the dedup branch, skip when `state.hasBackgroundTaskToolUseId(toolUseId)` or when `registry.consumePendingBackground`-style pending state is set, or have the assistant path honour `isBackgroundAnnounced`. Add a test for that ordering.
5. **Backstop marks `completed` for failed/stopped agents until task_notification arrives.** `AgentMonitorStore.onSubagentEnded` (agent-monitor.store.ts ~:2494-2514) always writes `completed`. `onAgentCompleted` (:2209-2240) overwrites unconditionally, so the later `task_notification` with `failed`/`stopped` corrects it; this ordering is fine. But if `task_notification` never arrives (the very scenario the commit targets: "agent_completed can be missing") a failed or killed agent shows green. Acceptable trade-off; call it out in the doc comment, or carry the stop reason from the hook if available.

### Verified OK
- SubagentStop-before-task_notification: backstop only moves `pending/running`; later `agent_completed` wins with the true status. Reverse order: backstop is a no-op on a terminal record (spec "does NOT override" covers `failed`, `killed`, `agent_completed`).
- `handleSubagentEnded` calls the monitor store before the tab lookup, so it runs even when no tab matches the session; unknown toolCallId is a no-op.
- `markTaskStartedEmitted` moved below the early returns, which preserves previous behaviour for skip_transcript / no tool_use_id.
- Background store ids: `BackgroundAgentStore` terminal resolve has a toolCallId fallback after `adoptRealAgentId`, so the terminal event's real `agentId` does not strand the entry in the normal SubagentStop-first ordering.

### Nits
- `turn-end-handler.background.spec.ts` mocks `AgentMonitorStore` entirely; the integration (real store terminalising a record from the real payload) is only covered by the store spec in isolation. Acceptable.
- `subagent-hook-handler.ts:400-410` doc change is accurate but unverifiable from this diff; no behaviour change.
- Unverified assumption: SubagentStop fires on actual finish for default-backgrounded Tasks, not at launch. If it fires at launch, `onSubagentEnded` would flip tiles to completed early. Worth one manual check in Electron.

## Five logic questions (short)
1. Silent failure: adoption faults are logged only; reply lists nothing (acceptable, documented). Backstop mis-labels failed as completed if notification missing.
2. User action: closing the old tab right after the reply while a late-completing lane (race #1) signals it.
3. Wrong answer: duplicate tray entries (#4).
4. Dependency failure: `startHandoffSession` timeout leaves work un-adopted (#2).
5. Missing: Task-tool subagents are not adopted (documented in SKILL.md); lanes spawned after handoff by the caller.

## Verdict
REVISE (minor). Commit 1 is sound on id matching, rekey and held-completion drain; fix the pre-await race or document it. Commit 2 fixes the stuck-running tile but #4 risks duplicating background tray entries for explicit `run_in_background` spawns and needs a test of the real event ordering. Confidence MEDIUM (no runtime execution).
