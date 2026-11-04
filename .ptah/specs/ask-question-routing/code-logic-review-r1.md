# Code Logic Review — `ask-question-routing` (round 1)

## Summary

| Metric              | Value      |
| ------------------- | ---------- |
| Overall score       | 8/10       |
| Assessment          | APPROVED   |
| Blocking issues     | 0          |
| Serious issues      | 0          |
| Moderate issues     | 0          |
| Failure modes found | 1          |

Round 0 was 6/10 (1 serious, 2 moderate): the chat projection ignored `routingTargetRevision`, the lane ignored router targets and workflow claims, and a host snapshot could restore Needs you. All three are fixed in the current diff. The coordinator's move of the revision read to after the empty-question return is still correct.

Score is 8 rather than 9 because one bounded residual remains: the question tombstone is a 256-entry FIFO, and two router comments still describe the active-tile fallback this fix removed. It is not 7 or below: the reported in-flight snapshot is ignored, both surfaces use one ladder, and an empty list still repaints when a question arrives. No tests were re-run here; the coordinator is re-running them. Ptah symbol tools were not connected, so this pass used native file reads. No skill-loading tool was listed.

## Prior findings

| # | Round 0 | Fixed | Evidence |
| - | ------- | ----- | -------- |
| 1 | Serious. `resolvedQuestionRequests` never read `routingTargetRevision`, so a target attached on the next turn left a cached `[]`. | Yes | `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:1361-1364` reads `chatStore.routingTargetRevision()` after the empty return. `libs/frontend/chat-streaming/src/lib/permission-handler.service.ts:603-604` bumps that signal inside `attachQuestionTargets`. `libs/frontend/chat/src/lib/services/chat.store.ts:559` exposes the signal. |
| 2 | Moderate. Lane `pendingQuestions` compared raw ids only, so a target-only question stayed hidden on a chip, and a workflow-claimed question could still show. | Yes | `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts:290-301` reads the revision and calls `questionBelongsToTab` with `isQuestionClaimedByWorkflow`. The helper is `libs/frontend/chat/src/lib/services/question-visibility.ts:2-13`. The claim is `streamRouter.interactiveSurfaceOwning` (`chat.store.ts:561-562`). |
| 3 | Moderate. After a local resolve, `attention:getSnapshot` could upsert the host row again. | Yes | `libs/frontend/core/src/lib/services/notification.service.ts:75` drops a host question whose key is in `resolvedQuestions`. `notification.service.ts:138-144` records that key on an unscoped `resolve` of a `question:` key. Answer, cancel, drop, and cleanup all call that form (`permission-handler.service.ts:581`, `:666`, `:684`, `:741`). Host projections are `source: 'host'` (`chat-attention-host-message-handler.service.ts:294` and `:327`). |

### Empty-list revision read

Both computeds read `routingTargetRevision()` only after `questions.length === 0` returns (`chat-view.component.ts:1362-1364`, `canvas-lane-view.component.ts:292-293`). An Angular computed tracks the signals read on its last run. The empty run still reads `questionRequests()`, so the next arrival re-runs the computed, and that run subscribes to the revision. A later `attachQuestionTargets` then repaints. The lane also returns before any of those reads while `selectedKind() === 'orchestrator'` (`canvas-lane-view.component.ts:290`). Switching back to a chip reads `selectedKind`, so the next run sees the targets that attached in the meantime. The `chat-view.component.spec.ts:1242-1253` case (non-empty miss, then revision bump) is the path that used to stay blank.

## Five logic questions

### 1. How does this fail silently?

The reported silent miss is closed. A question that arrives with no targets, then gains targets in `queueMicrotask` (`stream-router.service.ts:563-577`), bumps the revision (`permission-handler.service.ts:604`). Both projections have already read that signal whenever the list was non-empty.

What still fails quietly is narrower. `NotificationService.resolve` keeps at most 256 question keys (`notification.service.ts:141-143`). `Set.add` of a key that is already present does not move it to the end, so the oldest insertion is dropped. `upsert` then accepts a host notice for that key again (`notification.service.ts:75`). This happens only if that notice is still in `attention:getSnapshot` after 256 later local resolves. The registry callback clears the host notice on answer (`ask-user-question.service.ts:172-173` and `:224-226`), so a normal answer is not in later snapshots.

### 2. What user action produces unexpected behaviour?

Select a subagent or CLI chip, then receive a question whose raw ids are stale. `pendingQuestions` uses router targets (`canvas-lane-view.component.ts:296-301`). The orchestrator transcript is `hidden` while that chip is selected (`canvas-lane-view.component.ts:125-130`), and the lane returns `[]` for the orchestrator (`:290`), so one card is visible. Answering calls `chatStore.handleQuestionResponse` (`canvas-lane-view.component.ts:145`), the same path as the transcript card (`chat-view.component.html:191`).

Answer, cancel, idle auto-resolve, or session cleanup. The rail row drops, and a following host snapshot does not put it back, until the tombstone is evicted as in question 1. `dropQuestionRequest` is the auto-resolve path (`chat-message-handler.service.ts:965-976` to `permission-handler.service.ts:680-684`).

### 3. What input data produces a wrong answer?

`questionBelongsToTab` (`question-visibility.ts:9-12`): targets win; a workflow claim with no targets hides the question; otherwise `tabId` matches `request.tabId` or `request.sessionId`, or `sessionId` matches `request.sessionId`.

Backend shape (`ask-user-question.service.ts:62-72`): `sessionId` is the SDK id, and `tabId` is the routing tab id or that same session id when the caller omitted `tabId`. A chat turn's `tabId` equals `resolvedTabId()` (`chat-view.component.ts:935-937`), including a new tab whose `claudeSessionId` is null (`:924-930`). The lane's `sessionId` input is `tab()?.claudeSessionId ?? null` (`canvas-focus-area.component.ts:65`). While that is null, `request.tabId === tabId` still matches. When the SDK id arrives, `tabs()` changes and both computeds read the new session id.

Tribunal: `interactiveSurfaceOwning` returns null unless the correlation id is claimed and the surface is interactive (`stream-router.service.ts:618-629`). An unregistered conductor id is not a claim, so the helper falls through to id equality and does not hide a tab that actually owns that id. A claimed interactive surface gets targets synchronously before paint (`stream-router.service.ts:518-522`). Targets are checked first, so a claim does not hide a tab the router named.

A question whose ids match nothing, and whose microtask also finds no tab or interactive surface, still renders nowhere. That is the active-tile fallback staying removed. It is not a new miss.

### 4. What happens when a dependency fails?

`handleQuestionResponse` posts `ASK_USER_QUESTION_RESPONSE`, drops the local request, then tombstones the rail key (`permission-handler.service.ts:572-581`). If the post never reaches the host, the card is gone and the host can still list the notice. The tombstone blocks that list. The chat attention effect then sees the request gone and resolves only the `chat` source (`chat-attention-source.service.ts:121-124`), which does not add a second tombstone and does not upsert. `upsert` ignores the tombstone for `source !== 'host'` (`notification.service.ts:75`), so a later re-queue of the same id would show a chat row again. `generateRequestId` is `uuidv4()`, and `handleQuestionRequest` rejects an id that is still queued (`permission-handler.service.ts:553-556`).

`resolve(key, generation, 'host')` (`chat-attention-host-message-handler.service.ts:334`) does not tombstone. Creation and host-driven resolve do not call the unscoped form. `handleQuestionRequest` does not resolve. A host resolve still records `generationFloor` on `ATTENTION_CHANGED` (`chat-attention-host-message-handler.service.ts:107-115`). No creation path plants a tombstone ahead of a live question.

### 5. What is missing that the requirements never mentioned?

The revision signal and the shared ladder are in place. Not required for this fix, and not done: the tombstone does not refresh recency, and it is not tied to the snapshot generation the host handler already stores. Comments at `permission-handler.service.ts:591-592` and `stream-router.service.ts:497-500` still say the chat view falls back to the active tile. The filter does not.

## Failure modes

### Tombstone eviction restores a notice the host never dropped

- Trigger: local unscoped resolve of a question, the host snapshot still contains that notice, and 256 later question resolves evict the key (`notification.service.ts:141-143`).
- Symptom: Needs you / Show in canvas returns for that old question on a later focus reconcile (`chat-attention-host-message-handler.service.ts:203-207` calls `upsert`).
- Evidence: `notification.service.ts:75` and `:138-144`. The in-flight snapshot that round 0 named is inside the 256 and stays suppressed. `ask-user-question.service.ts:172-173` drops the host notice on the success path, so the usual snapshot no longer contains the key.
- Current handling: FIFO bound of 256, host source only. A chat-sourced row is a separate path and follows `questionRequests`.
- Recommendation: leave the bound. If this ever shows up in a long-lived window, move a re-resolved key to the tail, or ignore host generations at or below the generation already resolved. Not required to close the reported bug.

No other failure mode showed up on the paths below.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

- Minor. `permission-handler.service.ts:591-592` and `stream-router.service.ts:497-500` still document an active-tile fallback. `question-visibility.ts:11-12` does not implement it. A later edit that "restores" the comment reopens bug 1.
- Minor. `permission-handler.service.spec.ts:905-927` covers cancel and cleanup against a host row. Answer remains at `:568-584`. `dropQuestionRequest` (idle auto-resolve) uses the same unscoped resolve (`:684`) but has no twin assertion. `notification.service.spec.ts:50-58` covers the snapshot replay for `resolve` itself, not the 256 cap and not a `chat` upsert after a tombstone.

## Data flow

1. Backend builds `sessionId` and `tabId = tabId ?? sessionId` (`ask-user-question.service.ts:62-72`). OK for a chat tab and for a CLI callback that only has a session id.
2. `handleAskUserQuestion` stores the request, then `routeQuestionPrompt` (`chat-message-handler.service.ts:962-963`). Sync targets, including a claimed interactive surface (`stream-router.service.ts:518-522`), are visible on the first computed run. A microtask attach bumps the revision. OK.
3. Chat filter: empty list returns; otherwise revision, then targets, claim, then ids (`chat-view.component.ts:1360-1375`). OK.
4. Lane filter: orchestrator returns `[]`; otherwise the same helper (`canvas-lane-view.component.ts:289-301`). The transcript wrapper is `hidden` while a chip is selected (`:125-130`). One visible card. OK.
5. Answer posts, drops the request, tombstones `question:<id>`, then `cancelPendingQuestionOnOtherTabs`. Targets were already deleted, so the cancel usually does not run again. The row is already gone. OK.
6. Cancel, auto-resolve, and `cleanupSession` tombstone the same key. A later host upsert is ignored. OK inside the cap.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Card only on the owning session, not the focused tile | COMPLETE | Targets, then workflow claim, then tab or session id. Unmatched ids render nowhere. |
| Card visible on the selected subagent or CLI lane | COMPLETE | Same helper. Orchestrator does not also show the lane card. |
| Needs you / Show in canvas clears on answer, cancel, timeout, cleanup | COMPLETE | All four call unscoped `resolve(attentionRequestKey('question', id))`. Host snapshot upserts of that key are ignored until eviction. |

Implicit requirements from round 0: invalidate when targets attach; keep a workflow-claimed question off the chat lane; do not let an in-flight host snapshot restore the rail row. All three are met. `apps-transcript.component.ts:181-190` still has its own target filter and its own revision read, so a surface the router named still paints.

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Revision read after the empty return | YES | Empty run depends on `questionRequests()`. The next non-empty run reads the revision (`chat-view.component.ts:1361-1364`). | None |
| Lane while orchestrator, targets attach, then user picks a chip | YES | `selectedKind` is the dependency that wakes the computed (`canvas-lane-view.component.ts:290`). | None |
| Brand-new chat, `claudeSessionId` null | YES | `request.tabId === tabId` on both surfaces | None |
| Lane `sessionId` input null | YES | Session clause is false; tab id still matches (`question-visibility.ts:11-12`, `canvas-focus-area.component.ts:65`) | None |
| Late router target | YES | `attachQuestionTargets` bumps the revision both computeds read | Covered by the two new specs |
| Workflow claim | YES | Empty targets hide; non-empty targets must include this tab | Lane spec flips the claim and expects `[]` |
| Tribunal unregistered conductor | YES | `interactiveSurfaceOwning` is null (`stream-router.service.ts:618-629`), so id equality stands | A conductor id that matches no tab still has no card. That is the removed active-tile net |
| Two visible cards | YES | Lane list is empty on orchestrator; transcript wrapper is `hidden` on a chip | A second card exists in the hidden transcript DOM. `display: none` keeps it out of the a11y tree. Split panes match per tab id |
| Same question id reused | YES | `uuidv4()`. Host upsert of a tombstoned key stays blocked; a chat upsert is allowed if the request is queued again | Negligible collision |
| Unscoped `resolve` at creation | YES | Not on `handleQuestionRequest`. Host resolve passes `'host'` and does not tombstone | None |
| Tombstone cap 256 | PARTIAL | Oldest key can be upserted from the host again | Only if that notice is still in the snapshot |

## Decisions

- The revision read after the empty return is correct, not a hole. Options were: read the revision unconditionally; keep the post-empty read; restore the active-tile net. Evidence: both computeds read `questionRequests()` on the empty path, and `selectedKind` on the orchestrator path. Unconditional read is unnecessary. Reversible by moving one line.
- The 256 cap is residual, not a revise. Options were: reject until the cap is gone; accept it as the same bound the host handler uses for `generationFloor` (`chat-attention-host-message-handler.service.ts:111-114`). The reported bug is the in-flight snapshot, which the tombstone blocks. Reversible by changing the set.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: a host notice that survives 256 later question resolves can show Needs you again. The answer path's registry resolve makes that notice leave the snapshot first.
- What a robust implementation would add: refresh tombstone recency on repeat resolve; delete the active-tile sentences in `attachQuestionTargets` and `routeQuestionPrompt`; one assertion that `dropQuestionRequest` leaves `needsYou()` empty after a host upsert.
