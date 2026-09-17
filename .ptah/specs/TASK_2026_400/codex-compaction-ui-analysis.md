# Compaction UI root-cause analysis

## Root cause

The frontend has a real identity mismatch in the compaction recovery path: `CompactionLifecycleService.handleCompactionComplete()` clears **every tab in the compaction fan-out** by tab ID, but collapses the reload work to a `Set<SessionId>` and calls `switchSession(sessionId)` without the tab IDs it just cleared (`libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.ts:386-424`). `SessionLoaderService.switchSession()` then independently resolves a destination through `openSessionTab(sessionId)` (`libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:540-568`), and every stats and transcript write uses that returned ID (`session-loader.service.ts:609-678`). `openSessionTab()` returns the **first** active-workspace tab whose `claudeSessionId` matches, switching to it as a side effect, or creates a new tab if none matches (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:722-750`). Therefore, when the fan-out contains two tab representations of one SDK session, both are cleared but only the first matching tab is reloaded/finalized; if the compaction originated in the other tile, the visible origin is left with only events that arrive after the clear (the observed stub user bubbles), zero/empty stats state, and no restored assistant history. The prime suspect is substantially correct, but its comment at `compaction-lifecycle.service.ts:401-406` is too broad: merely opening an unrelated second session cannot redirect `openSessionTab`; the mismatch requires duplicate/sibling representations of the same session/conversation, a rotated/null session ID in a widened fan-out, or other tab/session identity drift.

## Evidence chain

1. The backend chunk payload carries `tabId` separately from `sessionId`. `ChatMessageHandler` sends both into the streaming path, then gives `tabId` to `StreamRouter` as `originTabId` (`libs/frontend/chat/src/lib/services/chat-message-handler.service.ts:431-459`). This matches the log: tab `80ed...` owns SDK session `b3f09...`; they are intentionally different identities.

2. `StreamingHandlerService` prefers that explicit tab ID (`libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts:125-140`). On `compaction_complete`, it returns the actual processed `targetTab.id` plus the event's session ID (`streaming-handler.service.ts:290-303`). `ChatStore` forwards that exact pair to `handleCompactionComplete()` (`libs/frontend/chat/src/lib/services/chat.store.ts:350-369`). Thus `result.tabId` is the authoritative origin tab for this event.

3. Routing records a many-tab conversation relation, not a one-tab session relation. `StreamRouter.routeStreamEvent()` binds `originTabId` to the conversation containing the event session, or appends/creates the session record as needed (`libs/frontend/chat-routing/src/lib/stream-router.service.ts:143-184`). `TabSessionBinding` explicitly permits many tabs per conversation (`libs/frontend/chat-state/src/lib/tab-session-binding.service.ts:4-14,62-100`) and returns all of them from `tabsFor()` (`tab-session-binding.service.ts:141-151`).

4. `findTabsBySessionId()` follows `sessionId -> ConversationRegistry -> TabSessionBinding -> TabState[]`; when the registry is unknown it falls back to a single direct session match (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:423-460`). The compaction handler widens that result further with the origin tab, direct `claudeSessionId` matches, and every tab bound to the same conversation (`libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.ts:274-324`). This fan-out can legitimately contain more than one tab.

5. Every fan-out tab is synchronously cleared by its own tab ID. The handler calls `applyCompactionComplete(t.id, ...)` and `markTabIdle(t.id)` for each tab (`compaction-lifecycle.service.ts:374-392`). `TabManagerService.applyCompactionComplete()` writes `messages: []`, the supplied `preloadedStats`, `liveModelStats: null`, and `modelUsageList: []` (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:1724-1752`). This is the destructive half of the transaction.

6. The restorative half discards those tab IDs. It constructs `reloadIds: Set<SessionId>` from the fan-out and calls `switchSession(sid, { reason: 'compaction' })` once per unique session (`libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.ts:394-431`). The current unit test deliberately pins this behavior: two tabs with the same session are both reset, but `switchSession` is expected exactly once (`libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.spec.ts:526-549`). That test proves the implementation does not restore each cleared tab.

7. `switchSession()` does not retain or recover the compaction origin. It obtains `activeTabId = openSessionTab(sessionId, title)` (`libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:540-568`). `openSessionTab()` scans `_tabs()` with `.find(...)`, so the destination is the first active-workspace tab with that SDK session, not necessarily `result.tabId`; it switches to that tab and returns it (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:722-731`). If no match exists, it creates and activates a new tab (`tab-manager.service.ts:734-750`).

8. All loaded data lands on that re-derived ID. Resume initialization clears that tab (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:1990-2018`); `chat:resume` is called with the same re-derived `tabId` (`libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:583-592`); loaded stats, live context stats, and model usage are written to it (`session-loader.service.ts:597-650`); returned events are replayed with it and history is finalized only for it (`session-loader.service.ts:652-668`); the legacy message fallback also writes only to it (`session-loader.service.ts:669-678`). The backend's correct `totalCost: 35.668` and `totalTokens: 226728` cannot repair a different cleared tab because no write targets that tab.

9. History replay has an additional multi-tab weakness. `StreamingHandlerService.processStreamEvent()` fans a replayed event to every tab resolved for the session (`libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts:179-200`), but `SessionLoaderService` calls `finalizeSessionHistory()` only for `activeTabId` (`session-loader.service.ts:652-664`). `finalizeSessionHistory()` ultimately writes its rebuilt array only to the passed tab (`libs/frontend/chat-streaming/src/lib/message-finalization.service.ts:206-220,305-322`; `libs/frontend/chat-state/src/lib/tab-manager.service.ts:1577-1587`). Session-level replay is therefore not a substitute for explicitly restoring every tab that was cleared.

10. `ConversationService` does not participate in compaction reload or completion. Its only session-loader interaction is abort bookkeeping (`libs/frontend/chat/src/lib/services/chat-store/conversation.service.ts:166-285`), so it is not a competing writer in this failure.

## Why it is intermittent

With one tab for the compacting session, the tab cleared at `compaction-lifecycle.service.ts:386-392` is also the only tab `openSessionTab()` can return at `tab-manager.service.ts:724-731`; the destructive and restorative writes coincide, so the bug is hidden.

With multiple representations of the same session/conversation, selection depends on array order and on which tile originated `/compact`. `openSessionTab()` always chooses the first direct session match, while the event origin can be any bound tile. If the first tab is the origin, that visible tile recovers; if a later sibling is the origin, the first tab receives the history and the origin remains cleared. Widening for rotated/null session IDs (`compaction-lifecycle.service.ts:284-320,394-399`) adds more cases where the tab selected by session lookup differs from the tab that was reset. The `Set<SessionId>` makes the loss deterministic once two cleared tabs share a session because one reload cannot finalize both.

Two unrelated tabs with distinct session IDs are not sufficient by themselves: `_tabs().find(t => t.claudeSessionId === requestedSessionId)` cannot return a tab for another session (`tab-manager.service.ts:723-726`). If the reporter truly reproduced with two unrelated conversations and no duplicate/rotated binding, the retained `[compaction-diag]` logs are needed to demonstrate the missing identity drift; the static code does not support the stronger claim that arbitrary tab count alone changes the destination.

There is also a concurrency amplifier: `SessionLoaderService` suppresses a second load whenever the same session is already in `_inFlightSessions` and returns successfully without restoring anything (`libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:69-75,498-508`). A coincident same-session load can therefore turn the clear into a no-reload outcome. This is secondary to the tab/session mismatch but should be fixed as part of the targeted API.

## Why the stats header vanished

The disappearance follows directly from the cleared origin tab:

1. The compaction handler synthesizes `preloadedStats` with every token field set to zero (`libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.ts:359-383`) and gives that snapshot to every fan-out tab (`compaction-lifecycle.service.ts:386-390`).
2. `applyCompactionComplete()` also clears `messages`, `liveModelStats`, and `modelUsageList` (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:1737-1752`).
3. The chat view mounts the entire stats strip only when that tab has at least one message (`libs/frontend/chat/src/lib/components/templates/chat-view.component.html:20-35`). Immediately after the clear it cannot render at all.
4. If one or two post-clear stub messages arrive, the child component still renders no stats content: its `hasStats` predicate requires positive cost, duration, tokens, or non-null live model stats, and does not consider `compactionCount` (`libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.ts:760-783`). The zero snapshot plus `liveModelStats: null` therefore hides the row.
5. `chat:resume` would replace this with the authoritative backend snapshot through `applyLoadedSessionStats()` (`libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:609-645`; `libs/frontend/chat-state/src/lib/tab-manager.service.ts:1830-1857`), but only on the re-derived destination tab. The cleared origin continues to show zero even though the backend returned lifetime totals.

The zero-token interim snapshot is itself a secondary defect. It converts a recoverable reload failure into a false zero state. Preserve the existing lifetime snapshot (or leave `preloadedStats` unchanged) until the authoritative resume result atomically replaces it; do not manufacture `{ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }` for a session whose lifetime totals are known.

## Why the model selector reverted

The compaction clear does **not** erase either per-tab model field: `applyCompactionComplete()` has no `overrideModel` or `sessionModel` key (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:1737-1752`). Therefore the selector reset is not caused directly by that mutation.

The logged `config:models-list` response provides a separate, code-supported cause. `ModelStateService.fetchModels()` publishes the returned model list and unconditionally assigns `_currentModel` from whichever entry has `isSelected` (`libs/frontend/core/src/lib/services/model-state.service.ts:284-303`). In the failing log that selected entry was `default`. `ModelSelectorComponent.effectiveModel` uses a tab's `overrideModel` only when `SESSION_CONTEXT` is present; otherwise it falls straight back to the global `currentModel()` and never reads the tab's `sessionModel` restored from history (`libs/frontend/chat/src/lib/components/molecules/chat-input/model-selector.component.ts:176-190`). Thus a models-list refresh can visibly change a running/resumed tab from Fable to Default even though `applyLoadedSessionStats()` records Fable in `tab.sessionModel` (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:1830-1857`).

A newly created tab is only an alternative cause when `openSessionTab()` finds no active-workspace session match; that new `TabState` contains neither model field (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:734-747`). It is not the normal multi-tab case, and `openSessionTab()` itself does not call `refreshModels()`. For an existing tile with a populated `overrideModel`, the selector prefers that override and a global models-list refresh cannot change it (`model-selector.component.ts:180-189`). The observed reset therefore points to the unscoped/main-panel fallback (or a tile whose override was never initialized), not to `applyCompactionComplete()` deleting the model.

## Stream-exit race assessment

There is no frontend evidence that the 16:21:57 stream exit/session cleanup can clobber a successfully loaded transcript:

- Ordinary `CHAT_COMPLETE` notifications are explicitly ignored; only `command: 'clear'` resets a tab (`libs/frontend/chat/src/lib/services/chat-message-handler.service.ts:285-321`). A normal slash-command stream exit is not `/clear`.
- `markTabIdle()` removes the tab from the spinner set and drops its abort controller; it does not write messages, stats, or models (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:2336-2351`).
- A terminal `turn_state` invokes `finalizeCurrentMessage()` before applying status (`libs/frontend/chat-streaming/src/lib/turn-state-applier.service.ts:115-139`). That finalizer returns immediately when `streamingState` or `currentMessageId` is absent (`libs/frontend/chat-streaming/src/lib/message-finalization.service.ts:55-67`). Successful history replay ends by setting `streamingState: null` (`message-finalization.service.ts:305-322`; `libs/frontend/chat-state/src/lib/tab-manager.service.ts:1582-1587`), so a later terminal event cannot replace the loaded messages.
- The deferred half of live finalization only clears streaming/status fields, not messages (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:1563-1574`).

Interleaving live post-compaction chunks with the asynchronous resume can cause transient states, but the final authoritative history write wins when it targets the correct tab. The persistent bad state is explained by that write targeting/finalizing another tab (or being skipped by `_inFlightSessions`), not by cleanup erasing it afterward.

## Proposed fix

Make compaction recovery an explicit tab-targeted operation and treat `(sessionId, tabId)` as the load identity. Do not let the loader call `openSessionTab()` during compaction.

Concrete diff sketch:

```ts
// session-loader.service.ts
type SwitchSessionOptions = {
  reason?: 'compaction';
  activate?: boolean;
  targetTabId?: TabId;
};

async switchSession(sessionId: SessionId, opts?: SwitchSessionOptions) {
  const targetTabId = opts?.targetTabId;
  const loadKey = targetTabId ? `${sessionId}:${targetTabId}` : sessionId;
  // guard _inFlightSessions by loadKey

  const destination = targetTabId
    ? this.tabManager.findTabByIdAcrossWorkspaces(targetTabId)?.tab
    : null;
  if (targetTabId && (!destination || destination.claudeSessionId !== sessionId)) {
    throw new Error('Compaction reload target no longer owns the session');
  }
  const resolvedTabId = targetTabId ?? this.tabManager.openSessionTab(sessionId, title);

  // Every applyResumingSession/applyLoadedSessionStats/replay/finalize/fallback
  // call below uses resolvedTabId. Do not activate/switch a targeted tab.
}
```

```ts
// compaction-lifecycle.service.ts
const reloadTargets = fanoutTabs.map((tab) => ({
  tabId: tab.id,
  sessionId: tab.claudeSessionId ?? compactionSid,
}));

for (const target of reloadTargets) {
  this.sessionLoader
    .switchSession(target.sessionId, {
      reason: 'compaction',
      targetTabId: target.tabId,
    })
    .finally(onSettle);
}
```

The implementation must also make replay target-only. Today `processStreamEvent()` automatically fans each replay event to every conversation-bound tab (`libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts:179-200`), which would allow parallel targeted reloads (especially rotated session groups in one conversation) to cross-write. Add an explicit replay option such as `{ isReplay: true, fanOut: false }`, or extract a public single-tab replay method around `processEventForTab()`, and finalize that same target. Key the in-flight guard by `(sessionId, tabId)` for targeted loads. A more efficient variant may load a session once, build one finalized immutable history, and apply cloned history/stats to a validated list of target tab IDs; either design is correct if every cleared tab receives an explicit final write and no session lookup re-selects the destination.

Additional corrections:

- Preserve `preloadedStats` during the reload window instead of replacing its token totals with zeros. On successful resume, overwrite it with the backend's authoritative lifetime stats. On failure, retain the previous non-zero snapshot and surface the reload error.
- Make the model selector tab-aware in both canvas and main-panel contexts. Resolve the relevant tab (`SESSION_CONTEXT` tab when present, otherwise the active tab) and prefer `overrideModel ?? sessionModel ?? modelState.currentModel()`. When the user changes a model for a live tab, update an intentional per-tab selection field so a later global `config:models-list` refresh cannot rewrite the displayed/routed model for that session.
- Remove the temporary `[compaction-diag]` logging only after the new regression tests pass with the origin tab different from the first session match.

## Existing specs to update

1. `libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.spec.ts`
   - Replace the test at lines 526-549 that expects one session-only reload with assertions that every cleared fan-out tab is an explicit reload/apply target.
   - Extend the N1/N2 cases at lines 486-714 to cover: origin is the second same-session tab; two rotated session IDs in one conversation; a null-session widened tile; and no activation of another tile.
   - Change the B2 zero-token expectation at lines 337-384 to require preserved lifetime stats during reload/failure.

2. `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts`
   - Add a compaction-target test proving `targetTabId` bypasses `openSessionTab`, is used for `chat:resume`, stats, replay, finalization, and legacy message fallback.
   - Add ownership-validation, target-disappeared, and `(sessionId, tabId)` in-flight cases.

3. `libs/frontend/chat-streaming/src/lib/streaming-handler.service.spec.ts`
   - Add a replay test proving target-only mode does not fan into sibling/rotated tabs. Existing multi-tab live fan-out coverage at lines 733-772 should remain unchanged.

4. `libs/frontend/chat-state/src/lib/tab-manager.service.spec.ts` and/or `tab-manager.intent-mutators.spec.ts`
   - Update compaction-reset assertions (`tab-manager.service.spec.ts:123-185`) if `preloadedStats` preservation moves into `applyCompactionComplete()`.
   - Retain coverage that `overrideModel` and `sessionModel` survive compaction.

5. Add `libs/frontend/chat/src/lib/components/molecules/chat-input/model-selector.component.spec.ts` (none exists today).
   - Prove a main-panel resumed tab displays `sessionModel` after a global models-list refresh selects `default`.
   - Prove canvas `overrideModel` remains highest priority and a fresh tab still falls back to the global default.

6. `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts`
   - Add a regression that the origin tile receives restored messages/stats and the stats strip remains present after targeted compaction recovery.

7. `apps/ptah-electron-e2e/src/specs/chat/streaming-message-handlers.spec.ts` or a new adjacent Electron spec
   - Exercise two visible tiles with the same conversation/session, issue `/compact` from the non-first tile, and assert both transcripts, lifetime stats, compaction marker/count, and selected model after the reload settles.
