# Code Logic Review (Phase F) — TASK_2026_629_c0b3

Scope: `git diff a1114b8df..4208fc840` (B10, BM1, BM2, BM3), non-spec source read in full for the touched logic. No tests, typecheck or lint were run (orchestrator results taken as given).

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Verdict | PASS (with follow-ups; no blocking defect found) |
| Blocking | 0 |
| Serious | 1 |
| Moderate | 5 |
| Minor | 4 |

Score reasoning: the cap guard, the git store lifecycle (A2 identity/generation checks, refcounting, debounce, concurrency cap, queue removal on release) and the compaction handling (A1) are sound and hold up against the failure cases I injected. The score is held below 8 because the running-cap guard covers only one of several composer-adjacent send entry points, and the details column reuses the todo selector without the throttling and snapshotting that the card needed.

## Five logic questions

1. Silent failure. A git read that fails shows `unknown/failed` and logs a warn (store `read`), with no retry until the next turn end, push or track. A non-registered folder returns `isGitRepo:false` (git-rpc.handlers.ts:205-216) and renders as `—`, the same as "unknown". After the compaction reset the todo cell is `—` for the rest of the turn (intentional per A1, but see M2).
2. Unexpected user action. Clicking "Resume agent" or "Resume all" from the transcript banner in a capped canvas starts a turn from an idle tile and skips the guard (S1).
3. Wrong answer from data. A finalized turn that was compacted mid-turn loses its pre-compaction TodoWrite from `streamingState`, so the selector can show an older turn's list as current (M2). While a new TodoWrite input is still streaming (partial JSON) the card shows `—` instead of the last good list (M1).
4. Dependency failure. `git:info` rejection, timeout (15 s) and malformed payload all map to `unknown` and do not leak `inFlight`/`activeReads` (finally block). Stale replies after release/retrack are discarded by entry identity plus generation (store `read`). OK.
5. Missing from the requirements. No equality on git state, so unchanged results still re-render every card (M4). No `isSessionRunning` check for tiles whose tab is not in a canvas workspace map (returns false, so a stray caller is blocked at cap; acceptable).

## Findings

### Serious

**S1. Running-cap guard misses other composer-adjacent send paths**
- Files: `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:1434-1457` (`handleResumeAgent`, `handleResumeAllAgents`), also `services/agent-feedback/chat-agent-feedback-sender.service.ts:50` and `services/session-budget-actions.service.ts:158`. Guard is only consulted in `chat-input.component.ts:1467` (`handleSend`).
- Enter key, button and slash commands all converge on `handleSend` (checked: `handleKeyDown` -> `handleSend`, button `(click)="handleSend()"`), and a queued send for an already-running tile is correctly allowed (`startBlockReason` returns null when `isSessionRunning`). But the resume banner calls `chatStore.sendOrQueueMessage(prompt, { tabId })` directly. In the detail transcript (and tile card) with 9 other sessions running and this tile idle, one click starts a 10th turn, and the banner entries are removed (`removeResumableSubagent`) regardless.
- Fix: enforce the guard at the dispatch boundary rather than the composer: inject `SESSION_START_GUARD` into `chat-view` and short-circuit the two resume handlers (keep the banner entries, surface the reason), and pass the same guard to feedback/budget senders when the tab is canvas-hosted. A cleaner option is a `tabId`-keyed start-guard in `MessageDispatchService.sendOrQueueMessage` for non-queue outcomes.

### Moderate

**M1. Live todo list flickers to unknown while a new TodoWrite input streams** — `compact-session-metrics.ts` `summarizeTodos` (live branch). When the marker moves to a new TodoWrite whose `toolInput` is `{}` or whose accumulator is partial JSON, `toolInputOf` returns `{}`/undefined, `parseTodoList` returns null, and the previously valid list is replaced by `unknown` (`—`) until the JSON completes. Fix: when the live marker's input does not parse, fall back to the previous summary (hold last-known in the card computed) or to the finalized scan.

**M2. Older list shown as current after a compacted turn finalizes** — `accumulator-core.service.ts:575` carries the marker across `compaction_complete`, but the replaced state has no events or accumulators, so live shows `unknown` (as A1 intended). Once the turn finalizes, the message's `streamingState` only contains the post-compaction events; `summarizeTodos` then scans back and shows a list from an earlier turn as current. Fix: when a finalized assistant message has a compaction boundary (or the marker existed and finalization lost it), return `unknown` rather than continuing the scan; or snapshot the last parsed list into the carried marker (store the parsed todos, not just the id).

**M3. Details column recomputes todos on every tab change without throttle** — `canvas-session-details.component.ts` `todos` computed calls `summarizeTodos(tab.messages, tab.streamingState)`, which does `[...streaming.events.values()].find(...)` (O(events), allocation of the whole array) whenever `tab()` changes, i.e. on streaming deltas. The card avoids this with `sampledStreaming` plus a throttle. Also the details column reads `tab.streamingState`, an object mutated in place by `setStreamingEventCapped`; if the tab object is not replaced for a given event the computed will not re-run and the count can lag. Fix: iterate the events map directly (no spread) or look the event up by id via an index, and reuse the card's sampling signal.

**M4. Git state objects are new on every read** — `session-git-stats.store.ts` `toState` and `setState` produce a new object and a new `Map` each time, and neither the card `gitStats` computed nor the details `gitStats` has an `equal`. Every turn end (forced read), push and track refresh re-renders all cards and replaces the whole map (O(roots) copy) even when numbers are unchanged. Fix: in `setState` skip the write when the previous state is structurally equal; add `equal` to the computeds.

**M5. Release-then-track on tab id change deletes state and forces a re-read** — release at count 0 deletes the entry and its state (`track` return closure), then the effect re-runs `track`, creating a new entry and a new read (1 s debounce). Between, cards show `NONE` (`—`) and one extra `git:info` is issued per churn. With effects keyed on both root and tabId, tile re-ids or detail panel switching between tiles of the same root produce this flicker. Fix: keep entry/state for a short grace period (e.g. delete on next macrotask if still at 0), or key the effect on root only and track by tab separately.

### Minor

- m1. Cap overshoot is possible in a narrow window: the guard reads `tab.status` which flips to `streaming` only after the send awaits start (`handleSend` -> `sendOrQueueMessage`); two tiles sent in the same tick can both pass. Human-driven, so low likelihood.
- m2. Hidden-workspace tabs are non-signals, so a hidden turn that starts after the snapshot is computed is undercounted until another signal changes; the poller only runs when the cap is already reached (`canvas.store.ts` interval block). Pre-existing design, now also affects the guard.
- m3. `gitTitle` for the details column does not distinguish `unavailable` from `failed`; card does. Cosmetic.
- m4. `findTabByIdAcrossWorkspaces?.` optional call in the details column (`canvas-session-details.component.ts` gitRoot) hides a missing method rather than failing; remove the `?.`.

## Items hunted and cleared

- Effect loops: `track` writes no signal (only timers and plain maps); release writes `states` via `untracked(this.states)` in effect cleanup, which is legal and does not retrigger the creating effect. `handleMessage` and `read` run outside reactive contexts. The `untracked` read in `release` and `setState` is sufficient; I found no path where either runs inside a computed.
- Refcount leaks: closure checks `entries.get(key) === captured`, decrements per tabId, deletes at zero, clears timer and queue slot; an in-flight read of a released entry fails the identity check and only decrements `activeReads` (finally). Double invocation of a release closure after the entry is deleted is a no-op; a double call while another tracker holds the entry would over-decrement that tab's count, but callers use Angular `onCleanup`, called once.
- A2: identity plus generation guard confirmed in `read` (try, catch and finally branches all check).
- Push for a non-tracked root: ignored (`!entry` return); push always carries `workspaceRoot` (git-watcher.service.ts:1211-1215); the `config().workspaceRoot` fallback only applies to payloads without a root.
- Windows root normalization: slashes unified, trailing slash stripped, drive-letter paths lowercased; POSIX paths untouched; UNC becomes `//host/share`. Key `''` for root `/` is an edge only.
- Turn-end mapping: matches `claudeSessionId` lazily per tab, so a tab that gained its session id after `track` is still matched; forced request is debounced and coalesced (`rerun` when in flight).
- DestroyRef on a root service: clears timers, entries, queue; `destroyed` stops `drain`. Late `track` after destroy only arms a timer that no-ops through `drain`'s `destroyed` check.
- Cap counting: draft tabs (`claudeSessionId` null) are keyed by `tab.id` and counted while streaming; the key switches to the session id once assigned without double counting (Map dedupe); hidden workspaces are included via `getWorkspaceTabs`.
- Blocked send keeps the draft: the guard returns before any clear of `_currentMessage`, files and images, and before `draftStore.clear`. Reason is shown through `showComposerError` for 4 s.
- Sub-agent todo lists: marker excludes `parentToolUseId`; finalized scan skips `agent` nodes.

## Data flow (git stats)

track (effect) -> entry created, debounced 1 s read OK -> queue (max 2 concurrent) OK -> `git:info` RPC (15 s timeout) OK -> shape guard `isGitInfo` OK -> `toState` OK -> states map -> `stateFor` -> card/details. Gaps: M4 (no equality), M5 (state dropped on churn). Push path and turn-end path both reach the same entry and invalidate in-flight reads by generation. OK.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| B10 cap guard in composer send (Enter/button/slash) | COMPLETE | S1: resume/feedback/budget senders bypass |
| B10 running session may still queue | COMPLETE | none |
| BM1 latestTodoWrite marker, eviction-safe | COMPLETE | M1 flicker |
| BM1 compaction (A1) | PARTIAL | live safe; finalized case M2 |
| BM2 git store, A2, push, failure to unknown | COMPLETE | M4, M5 |
| BM3 details column | COMPLETE | M3 |

## Verdict

- Recommendation: PASS with follow-ups (REVISE only if S1 is deemed in scope for decisions rows 17/33).
- Confidence: MEDIUM-HIGH (static reading; the in-place mutation question in M3 depends on how `TabManagerService` replaces `streamingState`, which I did not trace to the end).
- Top risk: a tile can start a 10th running session through the resume-agent banner, bypassing the cap.
- A robust implementation would add: guard at the dispatch boundary; hold-last-known todo list while a new TodoWrite streams; parsed-todo snapshot in the carried marker; structural equality on git state; grace period before dropping a root entry.
