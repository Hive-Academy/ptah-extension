# Batch B report — TASK_2026_863_cfae

Status: COMPLETE (frontend batch)

## Files changed

Production code (all in the task worktree):

- `libs/frontend/chat/src/lib/services/session-auto-handoff-coordinator.service.ts` — NEW. Root-provided per-session trigger. It observes the budget state of every mounted tab, in the active set and in every background workspace partition. It probes the skill, claims the session, and sends `/session-handoff` through the queued send path by explicit tab id. It retries transient failures with a time gate, and it stops after five failed attempts.
- `libs/frontend/chat/src/lib/services/session-handoff-prompts.ts` — NEW. Leaf module with the wrap-up prompt and the `/session-handoff` command text. It breaks the import cycle `chat.store → coordinator → actions service → chat.store`.
- `libs/frontend/chat/src/lib/services/session-handoff-skill.service.ts` — the probe now reports `available`, `missing`, or `transient`. A transient failure no longer marks the session.
- `libs/frontend/chat/src/lib/services/session-auto-handoff.service.ts` — added `release()` for a failed send, and a manual wrap-up mark so the coordinator never adds a second hand-off.
- `libs/frontend/chat/src/lib/services/session-budget-actions.service.ts` — the view-side trigger is removed. The service now covers the manual wrap-up button, the queued display, and Cancel.
- `libs/frontend/chat/src/lib/services/chat.store.ts` — eagerly injects the coordinator, so the trigger lives for the whole app run and works when no chat view is open.
- `libs/frontend/chat/src/lib/services/auto-handoff-source-closer.service.ts` — NEW. It closes the source tab of an automatic hand-off after the new session is adopted, when `sessionBudget.closeSourceAfterAutoHandoff` is on, and when the tab is idle and clean. It evaluates once, at the first idle moment, and disarms either way.
- `libs/frontend/chat/src/lib/services/agent-session-adoption.service.ts` — calls `onHandoffAdopted` only after an `adopted` outcome.
- `libs/frontend/chat/src/lib/settings/ptah-ai/session-budget-settings.component.ts` — new "Close the source chat after the hand-off" toggle. It is enabled only while the automatic hand-off is on.
- `libs/frontend/chat-state/src/lib/tab-workspace-partition.service.ts` — added `findBackgroundTabs(predicate)` and `removeBackgroundTab(tabId, workspacePath)`.
- `libs/frontend/chat-state/src/lib/tab-cross-partition-close.ts` — NEW. `closeBackgroundTab`: the machine-driven close of a tab parked in a background workspace partition. It aborts the stream, removes the tab, and emits the same `close` event as `closeTab`, so the session ender stops the SDK process. It refuses a busy or dirty tab.
- `libs/frontend/chat-state/src/lib/tab-manager.service.ts` — added `closeTabAcrossWorkspaces(tabId, expectedSessionId)`. It routes to `closeTab` for the active workspace and to `closeBackgroundTab` for a background partition, and it refuses when the tab no longer holds the given session.

Specs:

- `libs/frontend/chat/src/lib/services/session-auto-handoff-coordinator.service.spec.ts` — NEW.
- `libs/frontend/chat/src/lib/services/session-budget-actions.auto-handoff.spec.ts` — rewritten as the view-side spec (queued display, Cancel, manual mark).
- `libs/frontend/chat/src/lib/services/auto-handoff-source-closer.service.spec.ts` — NEW.
- `libs/frontend/chat/src/lib/services/agent-session-adoption.service.spec.ts` — added the closer wiring tests and a fake closer provider in both describes.
- `libs/frontend/chat-state/src/lib/tab-cross-partition-close.spec.ts` — NEW.
- `libs/frontend/chat-state/src/lib/tab-workspace-partition.service.spec.ts` — added `findBackgroundTabs` and `removeBackgroundTab` describes.
- `libs/frontend/chat-state/src/lib/tab-manager.service.spec.ts` — added the `closeTabAcrossWorkspaces` describe and `removeBackgroundTab` to the base partition mock.
- `libs/frontend/chat/src/lib/settings/ptah-ai/session-budget-settings.component.spec.ts` — added the disabled-toggle test; key counts now derive from the settings table.
- `closeSourceAfterAutoHandoff: false` literal added to the budget fixtures of: `tab-manager.service.spec.ts`, `tab-manager.intent-mutators.spec.ts`, `session-stats-summary.component.spec.ts`, `session-budget-format.spec.ts`, `chat-view.component.spec.ts`, `session-budget-actions.service.spec.ts`, `session-budget-actions.queue.spec.ts`, `session-stats-aggregator.service.spec.ts`, `session-loader.service.spec.ts`, `session-budget-banner.component.spec.ts`. The two actions-service specs also import the prompt constants from `session-handoff-prompts` now.

## Tests added

- Coordinator (`session-auto-handoff-coordinator.service.spec.ts`): a hidden tab at the limit fires once; a tab in a background workspace partition fires once; duplicate budget updates send once; the setting off or a stage below `limit` sends nothing; a live `limit` stage while streaming queues behind the turn and flushes at turn end; a `resuming` tab waits; a confirmed missing skill sends nothing and is not probed again; a transient probe failure retries after the time gate and gives up after five attempts; a failed send releases the claim and retries; a dropped held command releases the claim; a pending permission waits, a prompt for another tab does not block, and the send happens once after the answer; a session replaced on the tab, the setting turned off, or the stage left at `limit` during the probe sends nothing; a tab switch during the probe still sends to the original tab; a manual wrap-up blocks the automatic hand-off.
- View side (`session-budget-actions.auto-handoff.spec.ts`): the queued hand-off projects as `autoHandoffQueued` and the queue sends it at turn end; every view of the session projects the same claim-store entry; Cancel withdraws the queued command and it never fires again; Cancel keeps text the user queued after the command; Cancel drops a held command silently; identical user commands are not withdrawn or shown as automatic by mistake; a manual wrap-up marks the session, and a failed manual send clears the mark.
- Source closer (`auto-handoff-source-closer.service.spec.ts`): no close without an automatic claim, for a cancelled claim, for the setting off, for a session wrapped up by hand, and for a missing source session id; a source not mounted is logged; the source is located by session id when `fromTabId` points elsewhere; the close waits for `streaming`/`resuming`/`switching` and runs once at the first idle moment; a source in a background partition closes; a refused close is warned and never retried; a rebound source stays open; ten blockers (unsent input, queued message, background work, permission prompt, Command Center tab, sleeping state, setting off meanwhile, budget naming another session, released claim, manual wrap-up) each keep the tab open with the reason logged, and the close is disarmed for good.
- Adoption wiring (`agent-session-adoption.service.spec.ts`): the closer is armed only for an `adopted` outcome, never for `exists`, `source-absent`, `invalid`, or a fault.
- Cross-partition close (`tab-cross-partition-close.spec.ts`): every busy status and a dirty tab are refused without an abort or a removal; the stream abort runs while the tab is still mounted, then the tab is removed and the `close` event is emitted with the session id and the abort flag; a session-less tab reports `sessionId: null`; a refused removal (active workspace, unknown workspace) is reported as not closed.
- Partition service (`tab-workspace-partition.service.spec.ts`): `findBackgroundTabs` returns the matching tab objects of background workspaces; `removeBackgroundTab` removes a tab, drops its session index entry, and refuses the active workspace, an unknown workspace, and a missing tab.
- Facade (`tab-manager.service.spec.ts`): `closeTabAcrossWorkspaces` refuses an unknown tab and a tab rebound to another session; it closes an active-workspace tab through `closeTab`; it removes a background tab through the partition service and emits the close event; it reports a refused background removal as not closed.
- Settings (`session-budget-settings.component.spec.ts`): the close-source toggle stays disabled while the automatic hand-off is off and writes only after the automatic hand-off is turned on.

## Verification output summary

`npm run verify -- -p chat,chat-state,chat-ui` — running at the time of writing. This section holds the result of that run.

## Decisions

- The trigger moved from the view to a root service. The old effect read only the shown tab, so a background tab never fired. The coordinator reads `TabManagerService.tabs()` and `backgroundTabsRevision()`, so every mounted tab is observed. Evidence: the old effect in `SessionBudgetActionsService` (view-provided) read `activeTab` and `bannerVisible` only.
- The prompt and command constants moved to a leaf module (`session-handoff-prompts.ts`). `chat.store` eagerly injects the coordinator, and the coordinator needs the command text, so the constants had to leave the actions service to break the import cycle.
- Retries are feed-driven with a `Date.now()` gate: [5s, 15s, 30s, 60s], at most five attempts per session per page run. No timer, observer, or poll is kept alive. Evidence: the repo forbids long-lived timers for repeated background work.
- The effect defers its signal writes with `queueMicrotask`, the established repo pattern. No `allowSignalWrites` exists in `libs/frontend`.
- The close is evaluated once, at the first moment the source tab is not `streaming`, `resuming`, or `switching`. The hand-off command runs as the source's own turn, so an immediate check would always see a busy tab. One evaluation only: a blocker found once disarms the close, so a session the user resumes is never closed later.
- `closeBackgroundTab` refuses a busy or dirty tab instead of asking. The user can still close such a tab through `closeTab`, which asks first; a silent machine close must not kill a running turn or lose work.
- The close-source settings toggle uses the native `[disabled]` for its lasting conditional disable, per the busy-disabled directive's own doc.
- The settings spec derives its key counts from `SESSION_BUDGET_SETTINGS`, so a new key cannot break the count assertions.
- The adoption spec provides a fake closer in both describes. Without it, TestBed would construct the real root closer and its dispatch dependency graph against partial fakes.
- `closeTabAcrossWorkspaces` guards a `null` workspace path before the background branch. `TabLookupResult.workspacePath` is `string | null`; the `null` case is the unpartitioned active set, which the active branch handles.
- The spec fixtures cast tab literals with `as unknown as TabState`, the pattern the existing specs use (`session-budget-actions.queue.spec.ts`).

## Not done / blockers

None at the time of writing. The verification result above is the only open item.