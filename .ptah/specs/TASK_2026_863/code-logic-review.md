# Code Logic Review — `TASK_2026_863`

## Summary

| Metric              | Value            |
| ------------------- | ---------------- |
| Overall score       | 4/10             |
| Assessment          | NEEDS_REVISION   |
| Blocking issues     | 1                |
| Serious issues      | 1                |
| Moderate issues     | 2                |
| Failure modes found | 3                |

Score 4, not 5–6: requirements 1, 2, and 4 are present in the authored diff, but requirement 3 (a background session leaves Running on its own) is not met. The classifier only helps after `tab.status` is already `loaded`, and a non-active rail session never receives that write until the user opens it. Score is not 1–2: the density default, the preview removal, and the active tint are real changes, and `applyTurnState` itself does write `loaded` for any tab once a terminal `turn_state` arrives.

No skill was loaded. The host listed skills; none is assigned for a read-only logic review, and none of the catalogue descriptions is the review method. This role's template is the method.

Diagnostics: `ptah_get_diagnostics` on the changed card and layout files returned unavailable twice (TypeScript check still running after 45s). Tests were not run here. The batch report's `npm run verify` exit 1 (`spawn EPERM`) is not evidence that the new rail behaviour holds.

## Decisions

- Reviewed the authored working-tree delta (`git diff HEAD`, 9 files) as the implementation. `git diff main` also looks like a deletion of `CanvasRailSort`, layout record v4, and `:host([data-state='background'])`, because this branch's HEAD `dd380c449` is behind `main` `ddd89a62e` (those landed in `6396aeb4b` and `222fd6d56`). They are not in the authored patch. A three-way merge must keep them. Not scored as an authored defect. Reversible by rebasing before merge.
- Treated "open the session" as focus / reveal of that tab, which is what the stream viewport implements. The card test that assigns `status: 'loaded'` by hand does not represent that path.

## Five logic questions

### 1. How does this fail silently?

A session the user is not looking at finishes its turn and stays in the Running group with a running chip. Nothing errors. `ChatStreamDeliveryCoordinator.route` keeps the terminal `turn_state` in a hidden tail (`libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-delivery-coordinator.service.ts:171-184`). `StreamFlushScheduler` does not run work queued for tier `hidden` (`libs/frontend/chat/src/lib/services/stream-flush-scheduler.service.ts:43-45`). `railStateValue` then returns `'running'` because `status` is still `'streaming'` (`libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts:541-546`). The tile looks healthy and busy.

A second silent success: `status === 'loaded' && hasLiveSession` with an empty `messages` array is classified `'done'` (`compact-session-card.component.ts:547-549`). A live session whose transcript was never finalized looks Finished.

### 2. What user action produces unexpected behaviour?

Start a session, switch to another tab before the turn ends, leave the first tile in the rail. The first tile stays under Running until that tile is focused. Focusing it changes the viewport, `reveal` sends `CHAT_STREAM_SNAPSHOT` (`chat-stream-delivery-coordinator.service.ts:301-341`), `applyTurnState` writes `status: 'loaded'` (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:1897-1920`), and only then can the new classifier emit `'done'`.

On a visible tab whose parent turn is already `loaded` while a CLI lane or subagent is still `running`, the same classifier emits `'done'` immediately. The tile moves to Finished while that lane is still working.

### 3. What input data produces a wrong answer?

- Tab `status: 'streaming' | 'resuming'` with a completed backend turn that was never delivered. Lane counts do not matter. Result: `'running'`.
- Tab `status: 'loaded'`, `hasLiveSession: true`, `messages: []`, any lane count including `running > 0`. Result: `'done'` (`compact-session-card.component.ts:544-549`). The old condition treated `laneSummary().counts.running > 0` as Running even after `loaded`.
- Malformed stored `railDensity` now falls through to `'dense'` (`canvas-layout-persistence.service.ts` `.catch('dense')`). An explicit `'comfortable'` still parses. That part matches the request.

### 4. What happens when a dependency fails?

`session:status` probes in `SessionLivenessReconcilerService` run for restored tabs and history candidates (`session-liveness-reconciler.service.ts:38-107`), not on each hidden turn end. A probe failure is logged and the tab stays as it was (`session-liveness-reconciler.service.ts:171-176`). A hidden live tab therefore has no second writer. `TurnStateApplier` is the only stream writer of `status` (`tab-manager.service.ts:1814-1821`), and it never sees the event.

Viewport declaration failure sets `v2Accepted` false (`stream-viewport-controller.service.ts:118-120`), and `tierFor` then returns `'focused'` for every tab (`:46-48`), so events flush. The bug is the success path of v2, which Electron negotiates.

### 5. What is missing that the requirements never mentioned?

The rail does not register its tiles with `visibleTabIds`. `registerVisibleTab` is called from the session embed, the harness controller, and the command-center turn status, not from `canvas-rail-card.component.ts`. `deriveViewport` adds the active tab only when the surface is `'chat'` (`stream-viewport-controller.service.ts:75-87`). A rail neighbour is hidden by design of the stream coordinator. The request assumed the tile could observe turn completion. It cannot, until reveal.

The 500ms stream sampler was removed with the preview. `summary()` still walks the live stream on every flush for the agent-count badge and for `summarizeTodos` (`compact-session-card.component.ts:401-406`, `520-525`). That cost was not in the request.

## Failure modes

### Hidden turn completion never reaches the tile

- Trigger: v2 viewport is accepted; the session's tab is not `focusedTabId` and not in `visibleTabIds`; its turn ends.
- Symptom: the rail group stays Running until the user opens that session.
- Evidence: `chat-stream-delivery-coordinator.service.ts:171-184` (suppress), `:301-341` (deliver on reveal); `stream-flush-scheduler.service.ts:35-45`; `stream-viewport-controller.service.ts:46-53`; `compact-session-card.component.ts:541-546`. `applyTurnState` would set `loaded` for idle/failed (`tab-manager.service.ts:1897-1899`) and `updateTabInternal` updates any tab in the active workspace signal (`:1705-1743`), including a non-active tab. The event is dropped before that.
- Current handling: the card prefers `loaded` over a running lane. The regression test assigns `status: 'loaded'` in the test (`compact-session-card.component.spec.ts:1419-1430`). It never builds a hidden tab.
- Recommendation: deliver terminal `turn_state` (or an equivalent status write) for every rail tab without waiting for focus. Register each mounted rail tile with `registerVisibleTab`, or exempt `turn_state` from the hidden tail. Do not treat a card-side override of lane counts as the fix.

### A live lane is classified Done

- Trigger: parent tab `status` is `'loaded'` (turn phase idle/failed) and `laneSummary().counts.running > 0` because a CLI agent or subagent is still running.
- Symptom: the tile leaves Running and shows Finished while that lane is still working. After the user opens a hidden tab, the same rule applies to whatever lanes are still running.
- Evidence: `compact-session-card.component.ts:541-549`. `buildLaneSummary` counts CLI and subagent rows whose status word is running (`compact-lane-rows.ts:81-143`). `awaiting-background` is protected only when that count is already > 0; a `loaded` tab is not.
- Current handling: terminal tab status wins over lanes, unconditionally.
- Recommendation: keep `counts.running > 0` as `'running'` for a live monitor entry. Clear or ignore a lane only when that lane's own completion has been applied, which for a hidden tab is the same delivery bug as above.

### Empty live session reported Done

- Trigger: `status === 'loaded'`, `hasLiveSession === true`, `messages.length === 0`.
- Symptom: Finished, including a session whose assistant text never made it into `messages`.
- Evidence: `compact-session-card.component.ts:547-549`.
- Current handling: that pair is an explicit Done shortcut so a completed live session with no finalized messages leaves Running.
- Recommendation: require a terminal phase that also finalized or cleared `streamingState`, and do not treat `hasLiveSession` alone as completion. `hasLiveSession` is sticky from the first `markStreaming` (`tab-manager.service.ts:1787-1795`).

## Blocking issues

### Background sessions stay Running until opened

- File: `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts:541-546`, with the cause at `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-delivery-coordinator.service.ts:171-184` and `libs/frontend/chat/src/lib/services/stream-flush-scheduler.service.ts:43-45`
- Scenario: a rail session that is not the focused tab, and not a registered visible embed, finishes while the user is on another session.
- Impact: the reported bug remains. The Running group is wrong until the user opens the tile, which is the behaviour the request asked to remove.
- Fix: make terminal turn state apply to background rail tabs without activation. Include mounted rail tab ids in the v2 viewport (`registerVisibleTab` from the rail card for as long as the tile is mounted, and include them in `deriveViewport`), or route `turn_state` to `TurnStateApplier` even when the chunk tail is suppressed. Add a test that never assigns `status: 'loaded'` itself: start `streaming`, deliver only a hidden-tier terminal event through the scheduler/coordinator, and expect the emitted rail state to become `'done'`. The current test at `compact-session-card.component.spec.ts:1427` skips that path.

The claimed root cause (stale lane activity after `loaded`) is a real classifier bug for a tab that is already terminal. It is not why a background tab stays Running. For that tab, `status` stays `'streaming'`, and the new condition returns `'running'` before the lane clause.

## Serious issues

### Loaded parent plus a running lane shows Finished

- File: `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts:544-549`
- Scenario: the parent turn is idle (`loaded`) and `AgentMonitorStore` still has a running CLI lane or subagent for that session.
- Impact: a session that is still working moves to Finished on its own. This is the inverse of the bug, and it is the direct result of ignoring `counts.running` whenever `status === 'loaded'`.
- Fix: return `'running'` when `laneSummary().counts.running > 0` unless those rows are known complete. Fix stale rows by applying their completion events (same delivery path as the blocking issue), not by discarding the count.

## Moderate and minor issues

- Moderate. Removing the preview row did not change the card height. Comfortable grid rows are now `26+16+70+22 = 134` inside a 176px host; dense rows are `26+22+18 = 66` inside 96px (`compact-rail-card.component.ts:91-96`, `compact-lane.types.ts:77-82`). The removed row was 20px. The host height is unchanged, so every tile keeps a blank band where "Now …" was.
- Moderate. `CARD_SUMMARY_SAMPLE_MS` and the per-card sampler were deleted (`compact-session-card.component.ts` diff). `summary()` and `liveTodos` now read `tab().streamingState` on every flush (`:401-406`, `:522`). A visible session rebuilds the summary at chunk rate again. The preview was the sampled text; the badge and todos still pay for the unsampled walk.
- Minor. `holdText` is still an input on `canvas-rail-card.component.ts:459` and is still bound from `canvas-rail.component.ts:235`. The compact card no longer accepts it and the rail card no longer reads it. Dead after the preview removal.
- Minor. `canvas-rail-card.component.ts:133-138` sets `background: transparent` on `ptah-compact-rail-card` inside `.rail-attention-frame`. An active tile that also needs input loses `bg-primary/25`. The frame still paints its own fill and the focus border remains.

Checked and not filed:

- Host `[class]` does not clobber the static host classes. Angular 22 `ɵɵclassMap` (`node_modules/@angular/core/fesm2022/_debug_node-chunk.mjs:17292-17349` and `findStylingValue` at `:17555-17586`) keeps static host classes in the styling key / `residualClasses` and only adds or removes tokens from the bound string. `bg-primary/25` replaces `bg-base-200`. `rc-card`, the border utilities, and `[class.rc-focused]` stay. The spec asserts the two background tokens (`compact-rail-card.component.spec.ts:223-233`) and was not executed in this review.
- The old focused `background-color: color-mix(...)` declaration was removed from the live `:host(.rc-focused)` rule (`compact-rail-card.component.ts:177-179`), which still sets border and inset shadow. No selector was left pointing at a deleted rule. Other `color-mix` uses in that file are lane ink, still referenced.
- `bg-primary/25` on anubis-light was not measured. The file's own comment (`compact-rail-card.component.ts:55-58`) says that theme's primary ink is 1.40:1 on cream, which is why the focus frame uses `--pc`. The new fill is a 25% primary wash behind `text-base-content`, not primary-as-text. Contrast of the wash is unverified. Not raised as a defect.

## Data flow

1. User sends on tab A. `markStreaming` sets `status: 'streaming'` and `hasLiveSession: true` (`tab-manager.service.ts:1787-1795`). Rail emits `'running'`. OK.
2. User focuses tab B. `StreamViewportController.deriveViewport` puts B in the viewport and, on the chat surface, sets `focusedTabId` to B (`stream-viewport-controller.service.ts:75-87`). A is not registered by the rail card. A is tier `hidden`. Gap.
3. Backend `publish` → `route` retains A's chunks, including terminal `turn_state` (`chat-stream-delivery-coordinator.service.ts:171-184`). Gap.
4. If a chunk were still posted, `StreamFlushScheduler.enqueue` would store it and not schedule it (`stream-flush-scheduler.service.ts:43-45`). Gap.
5. `railStateValue` reads `tab().status` from `findTabByIdAcrossWorkspaces`, which does read `_tabs()` (`tab-manager.service.ts:710-714`), so a real status write would repaint. The write does not happen. Card returns `'running'`. Gap.
6. User opens A. Viewport reveal flushes the snapshot (`:301-341`). `processStreamEvent` intercepts `turn_state` before the accumulator (`streaming-handler.service.ts:257-264`). `TurnStateApplier.apply` finalizes, then `applyTurnState` sets `loaded` for idle/failed. OK once the user has opened the tab.
7. Card emits `'done'` even if lanes are still running (`compact-session-card.component.ts:544-549`). Gap for a live lane.
8. `CanvasRailComponent` groups `'done'` under Finished (`canvas-rail-grouping.util.ts:18`). The new grouping spec only checks that a map already containing `'done'` sorts into Finished (`canvas-rail-grouping.util.spec.ts` new test). OK as a pure function, not as proof of step 5.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Compact tile density is the default | COMPLETE | `DEFAULT_BOARD_STATE.railDensity` is `'dense'`; Zod `.catch('dense')` only for a missing or invalid value. Stored `'comfortable'` still loads. |
| Remove the streamed-text preview line | PARTIAL | The "Now …" row and its latch are gone. The 20px row's height remains in `COMPACT_RAIL_CARD_HEIGHT`. `holdText` is still passed in. |
| A non-active session leaves Running when its turn completes | MISSING | Classifier assumes `status` is already terminal. Hidden delivery never updates that status until focus. |
| Active tile distinct by background, border kept | COMPLETE | Focused host gets `bg-primary/25` plus the existing `rc-focused` frame. Inactive stays `bg-base-200`. Attention-frame tiles force the inner card transparent (minor). |

Implicit requirements not addressed: rail tiles are not stream-visible, so "the tile updates on its own" needs a delivery change, not only a classifier change. Branch is behind `main`; merge must preserve rail sort v4 and the `background` rail state.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Hidden tab, turn ends | NO | Status stays `streaming`; classifier returns `running` | The reported bug |
| Visible tab, `loaded`, stale running lane | YES | Lane count ignored when `loaded` | Also hides a lane that is actually running |
| `awaiting-background` or `sleeping` with `counts.running > 0` | YES | Status is not `loaded`, so the lane clause still returns `running` | |
| `awaiting-background`, no running lane, messages exist | YES | Falls through to `done` | Same as before this patch |
| `loaded`, no messages, `hasLiveSession` | YES | Forced `done` | Looks finished with an empty transcript |
| Permission or question callout | YES | Returns `needs` before the status check | |
| Error tone on the summary | YES | Returns `error` before the status check | |
| Stored density `comfortable` | YES | Enum parse keeps it | |
| Absent or bad density | YES | `.catch('dense')` | |
| Active tile class list | YES | `ɵɵclassMap` keeps static host classes | Tests not executed |
| Attention frame + focused | NO | Inner background forced transparent | Border and frame fill remain |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: shipping the classifier makes the suite assert the bug is fixed while a background session still sits in Running until it is opened, and a `loaded` parent with a live lane moves to Finished too early.
- What a robust implementation would add: viewport or `turn_state` delivery for every mounted rail tab; a test that does not inject `status: 'loaded'`; lane-running still means Running until that lane's own completion is applied; drop the unused 20px from `COMPACT_RAIL_CARD_HEIGHT` or put the grid back in agreement with 176/96; stop binding `holdText`.
