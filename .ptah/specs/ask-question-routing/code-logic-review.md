# Code Logic Review — `ask-question-routing`

## Summary

| Metric              | Value            |
| ------------------- | ---------------- |
| Overall score       | 6/10             |
| Assessment          | NEEDS_REVISION   |
| Blocking issues     | 0                |
| Serious issues      | 1                |
| Moderate issues     | 2                |
| Failure modes found | 3                |

The three reported bugs are fixed when the request already carries this view's tab id or resolved session id. They are not fixed for a question whose router targets arrive on the next turn. `resolvedQuestionRequests` never reads `routingTargetRevision`, and the active-tile fallback that used to paint that frame is gone. A card can therefore render nowhere until the 5-minute idle auto-pick.

Score is 6 rather than 7 because that drop is the path `routeQuestionPrompt` documents for a session that is not bound yet, and the sibling surface filter in `apps-transcript.component.ts` already treats the revision signal as mandatory. It is not 4 or below: an owning chat tab still matches `request.tabId`, the lane card is session-scoped, `attentionRequestKey('question', id)` is the rail key, and the new specs fail on the old source.

Scope: the uncommitted diff in the three components and their specs, plus the producer and consumer of question identity (`ask-user-question.service.ts`, `sdk-permission-handler.ts` `createCallback`, `stream-router.service.ts` `routeQuestionPrompt`, `NotificationService.resolve`, `ChatAttentionSourceService`, `ChatAttentionHostMessageHandler`, `canvas-rail.component.ts` `localNeedsYou`). The symbol index was empty (`symbolCount: 0`); symbol lookup fell back to search. No tests were re-run. `fix-report.md` records Nx `EPERM`, which disagrees with a claimed 9/9 verify. Style findings are omitted.

## Five logic questions

### 1. How does this fail silently?

A question with no router targets yet, and whose `tabId` / `sessionId` match neither `resolvedTabId` nor `resolvedSessionId`, is filtered out at `chat-view.component.ts:1390-1392`. `routeQuestionPrompt` then attaches targets in `queueMicrotask` (`stream-router.service.ts:563-577`) and bumps `routingTargetRevision` (`permission-handler.service.ts:594-604`). The chat computed does not read that signal, so the cached `[]` stands. The user sees no card. The backend still waits in `awaitQuestionResponse` until `ASK_USER_QUESTION_IDLE_TIMEOUT_MS` (5 minutes) and auto-picks (`ask-user-question.service.ts:183-213`). The old active-tile return covered this frame; the comment at `chat-view.component.ts:1364-1367` still says that net must stay because a drop hangs the tool.

### 2. What user action produces unexpected behaviour?

Select a subagent or CLI chip, then receive a question whose raw ids are stale but whose router targets name this tab. The orchestrator transcript, which would show the card via targets, is `hidden` (`canvas-lane-view.component.ts:125-130`). `pendingQuestions` (`canvas-lane-view.component.ts:288-295`) never consults `questionTargetTabsFor`, so the lane stays empty. The user has to switch back to Orchestrator. That is bug 2 for the stale-id case.

Answer the card, then focus the window while `attention:getSnapshot` is still in flight and the host coordinator has not yet dropped the notice. `reconcile` upserts the host row again (`chat-attention-host-message-handler.service.ts:203-207`). Nothing emits `attention:changed` (the constant has no sender). The Needs you / Show in canvas row returns and stays until the next focus reconcile.

### 3. What input data produces a wrong answer?

`request.sessionId` set to a live SDK id, `request.tabId` omitted. CLI lane callbacks pass `tabId: undefined` (`claude-sdk-lane-options.ts:303-309`), so `AskUserQuestionService` copies `sessionId` into `tabId` (`ask-user-question.service.ts:62-72`). If that id is not yet `tab.claudeSessionId`, both the chat filter and the lane filter miss. A normal chat question is safe: `createCallback` is given `routingTabId` (`sdk-query-options-builder.ts:1272-1278`), and `q.tabId === resolvedTabId()` still matches a brand-new tab whose `claudeSessionId` is null.

A workflow question whose live `sessionId` equals this canvas tab's `claudeSessionId` is withheld from chat once surface targets exist (`chat-view.component.ts:1386-1388`) but is shown on the lane, because the lane filter has no `isClaimedByWorkflowSurface` check.

### 4. What happens when a dependency fails?

`handleQuestionResponse` posts `ASK_USER_QUESTION_RESPONSE`, drops the local request, then resolves attention (`permission-handler.service.ts:572-581`). If `postMessage` does not reach the host, the card is already gone and the next snapshot can put the rail row back with no card under it. Host `resolve` itself is correct on the success path: the registry callback calls `hostAttention.resolve(attentionRequestKey('question', requestId), request.timestamp)` (`ask-user-question.service.ts:172-173`), and `cleanupBySession` / idle auto-pick / abort use that same callback (`pending-response-registry.ts:107-120`).

`NotificationService.resolve(key)` with no source deletes every source (`notification.service.ts:135-149`). That is the right call. `ChatAttentionSourceService` still resolves with source `'chat'` only (`chat-attention-source.service.ts:121-124`); the explicit unscoped resolve is what actually clears a host row.

### 5. What is missing that the requirements never mentioned?

The filter must invalidate when targets attach. `apps-transcript.component.ts:181-182` already reads `routingTargetRevision()` before `questionTargetTabsFor`. Chat view and the lane view do not. Also unstated: a hidden `ptah-session-embed` under the lane still mounts `resolvedQuestionRequests` (`chat-view.component.html:182-192` inside the hidden wrapper). It is `display: none`, so the user does not see two cards. Both would call `chatStore.handleQuestionResponse`, and the second call returns at `permission-handler.service.ts:573`.

## Failure modes

### Late targets never repaint

- Trigger: `routeQuestionPrompt` finds no tab synchronously and attaches targets in a microtask, or compaction calls `refreshStaleQuestionTargets` after the computed has already cached.
- Symptom: no Input needed card on any tile. The tool sits until the 5-minute auto-pick.
- Evidence: `chat-view.component.ts:1378-1393`; `stream-router.service.ts:563-577`; `permission-handler.service.ts:594-604`. Contrast `apps-transcript.component.ts:181-182`.
- Current handling: id equality only. The active-tile fallback is gone. The comment at `chat-view.component.ts:1357-1367` still describes that fallback as required.
- Recommendation: read `routingTargetRevision` inside `resolvedQuestionRequests` (expose it on `ChatStore` if the view must not inject the handler). Recompute when targets attach.

### Lane ignores the router

- Trigger: a chip is selected and the question matches only via router targets, or a workflow claim withheld it from chat while `sessionId` still equals this tab.
- Symptom: empty lane while the hidden orchestrator transcript holds the only card, or a surface question appears on the lane.
- Evidence: `canvas-lane-view.component.ts:125-130` and `:288-295`. `sessionId === null` does not show every question: the session clause requires `sessionId !== null`, and `request.tabId === tabId` still matches a chat question whose `claudeSessionId` is not set yet (`canvas-focus-area.component.ts:65`).
- Current handling: raw id compare only. Orchestrator correctly returns `[]` so the lane card and the transcript card are not both visible.
- Recommendation: use the same target-then-id ladder as chat, including the workflow-claim exclusion, and read the revision signal.

### Host snapshot restores Needs you

- Trigger: `attention:getSnapshot` returns a notice that the local `resolve` already cleared, and the host coordinator has not dropped it yet (or the RPC was already in flight).
- Symptom: the rail row disappears on answer, then comes back with Show in canvas, and stays until the next focus or visibility reconcile.
- Evidence: `chat-attention-host-message-handler.service.ts:79-86` and `:203-207`; `canvas-rail.component.ts:351-356` renders `notifications.needsYou()`. No producer sends `attention:changed`. Local resolve does not set `generationFloor` (`:223-225`), so a repeated notice is accepted.
- Current handling: answer, `cancelQuestion` (`permission-handler.service.ts:662-666`), `dropQuestionRequest` (`:680-684`), and `cleanupSession` (`:737-742`) all call `notifications.resolve(attentionRequestKey('question', id))`. The key format matches `attention-identity.ts:4-5` (`question:<id>` for a uuid). Steady state after the host callback is clear. The in-flight snapshot is not.
- Recommendation: set the generation floor from the request timestamp when resolving locally, and ignore snapshot notices at or below that floor. The same one-liner belongs on the four lifecycle methods; only the answer path is tested.

## Blocking issues

None.

## Serious issues

### Question card stays invisible after the router binds it

- File: `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:1378-1393`
- Scenario: first change-detection read happens before `attachQuestionTargets`. For a chat turn that already has `routingTabId`, `q.tabId === resolvedTabId()` still shows the card, including a new session with `claudeSessionId === null` (`ask-user-question.service.ts:62-72`, `chat-view.component.ts:925-938`). The miss is a request whose ids match nothing yet: CLI callback with no tab id, or a session id the registry only resolves on the microtask. `isClaimedByWorkflowSurface` moving above the id compare does not hide an owning tab. Targets are checked first (`:1386-1388`). A claimed interactive surface gets those targets synchronously (`stream-router.service.ts:518-522`) before the computed is read. Tribunal's unregistered conductor id still fails the claim (`stream-router.service.ts:621-629`) and falls through to id equality.
- Impact: the user cannot answer. The agent takes the recommended option five minutes later with no card on screen.
- Fix: depend on `routingTargetRevision` in this computed. Keep id equality as the pre-target owner. Do not restore "whoever is active".

## Moderate and minor issues

- Moderate. `canvas-lane-view.component.ts:288-295` does not use router targets or the workflow claim. `sessionId === null` is safe only because of the `tabId` clause. A target-only question is invisible on the chip the bug was meant to fix.
- Moderate. `permission-handler.service.ts:581` clears the rail row, and `canvas-rail.component.ts:351-356` reads that store, but `chat-attention-host-message-handler.service.ts:207` can upsert the host notice again. `attention:changed` is never sent, so there is no push to undo that upsert.
- Minor. `chat-view.component.ts:1357-1367` still documents the removed active-tile rung, including the claim that a drop hangs forever (`timeoutAt: 0`). The idle timer is 5 minutes.
- Minor. Specs do not cover cancel, auto-resolve, cleanup, a null lane `sessionId`, or a question that matches only `tabId`. They do fail on the old source: `chat-view.component.spec.ts:1222-1236` uses `sessionId: 'owner-session'` with `questionTargetTabsFor` stubbed to `[]`, so the old active-tile return showed the unrelated question too; `canvas-lane-view.component.spec.ts:178-192` expects a `ptah-question-card` the old template did not render; `permission-handler.service.spec.ts:569-583` expects `needsYou()` empty after answer, which the old code left as the host row. The lane spec's `NO_ERRORS_SCHEMA` override still counts the unknown element, so it checks the `@for`, not the answer binding.

## Data flow

1. Backend builds the request with `sessionId = resolveSessionId()` (live SDK id, else the build-time routing id) and `tabId = tabId ?? sessionId`. OK for chat tabs.
2. `ChatMessageHandler.handleAskUserQuestion` stores it, then `routeQuestionPrompt`. Sync targets are visible to the first read. OK. Microtask targets are not. Gap.
3. Chat filter: targets, else workflow claim, else tab id or session id. OK when ids or sync targets match. Gap when both are late.
4. Lane filter, only while a chip is selected: session id or tab id. OK for a chat `tabId`. Gap for target-only and workflow-owned questions. Hidden transcript does not add a second visible card. OK.
5. Answer calls `chatStore.handleQuestionResponse`, which posts the response, drops the request, resolves `question:<id>`, then `cancelPendingQuestionOnOtherTabs`. OK on the happy path. Snapshot can restore the host row. Gap.
6. Cancel, idle `ASK_USER_QUESTION_AUTO_RESOLVED` → `dropQuestionRequest`, and `PERMISSION_SESSION_CLEANUP` → `cleanupSession` resolve the same key. Host pending is cleared by the registry callback before the cleanup broadcast. OK, aside from the snapshot race.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Card only on the owning session, not the focused tile | PARTIAL | True when `tabId` or `sessionId` matches. Late router targets do not repaint. Unmatched ids now render nowhere instead of on the active tile. |
| Card visible on the selected subagent/CLI lane | PARTIAL | Visible when raw ids match. Hidden when only router targets match. Not shown twice while Orchestrator is selected. |
| Needs you / Show in canvas clears on answer, cancel, timeout, cleanup | PARTIAL | All four methods resolve the rail key, and the key matches the projection. An in-flight host snapshot can restore the row. Tests cover answer only. |

Implicit requirements not addressed: invalidate question visibility when `attachQuestionTargets` runs; do not show a workflow-claimed question on a chat lane.

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Brand-new chat, `claudeSessionId` null, backend `tabId` is the tab uuid | YES | `q.tabId === resolvedTabId()` and the lane's `request.tabId === tabId` | None on this shape |
| Unrelated session focused | YES | No active-tile fallback | Covered by `chat-view.component.spec.ts:1230-1235` |
| Lane `sessionId` input null | YES | Session clause is false; tab id still matches | Untested |
| Workflow claim vs owning tab | YES | Targets win; unregistered conductor id is not a claim | Reorder does not hide the owning tab |
| Router microtask / compaction retarget | NO | Computed ignores `routingTargetRevision` | Card stays missing |
| Two visible cards (chat + lane) | YES | Transcript wrapper is `hidden`; lane returns `[]` for Orchestrator | A second card exists in the hidden DOM only |
| Answer / cancel / timeout / cleanup attention | YES | `attentionRequestKey('question', id)` | Snapshot can resurrect |
| Host re-emit after a completed answer | YES | Registry resolve drops `pendingNotices` | Only an overlapping snapshot republishes |

## Decisions

- Late-bound targets are a defect, not an accepted tradeoff of "the active tab does not own the question". Options were: leave the fallback removed and require id equality only; restore the active-tile net; track `routingTargetRevision` and keep id equality. Evidence: `stream-router.service.ts:497-505` and `:563-577`, and `apps-transcript.component.ts:181-182`. Tracking the revision keeps bug 1 fixed. Reversible by deleting that read.
- The in-flight snapshot is moderate rather than serious. After the host callback, the next focus reconcile removes the row. The reported stuck-until-click path is the source-scoped chat resolve, which the unscoped `resolve` fixes.

## Verdict

- Recommendation: REVISE
- Confidence: MEDIUM
- Top risk: a question the router binds one turn late never paints, and the 5-minute auto-pick answers it for the user.
- What a robust implementation would add: `routingTargetRevision` in both filters; the lane uses the chat ladder, including workflow claims; local attention resolve records a generation floor so a stale snapshot cannot restore Show in canvas; specs for cancel, auto-resolve, cleanup, and a target that appears after the first read.
