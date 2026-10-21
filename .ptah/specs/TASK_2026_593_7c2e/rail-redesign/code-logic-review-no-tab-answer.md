# Code Logic Review — `TASK_2026_593_7c2e` (no-tab permission answer)

Review family: grok (implementer: codex)

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | REVISE (NEEDS_REVISION) |
| Blocking issues | 0 |
| Serious issues | 1 |
| Moderate issues | 1 |
| Minor issues | 2 |
| Failure modes found | 2 |

Verdict: **REVISE**. Score **6/10**.

Allow and Deny for a queued session permission with no live tab post the same `SDK_PERMISSION_RESPONSE` shape the badge posted, and a second answer is refused before another post. The change still deletes the only surface that could Always-allow, deny-with-message, or show the tool body for an unmatched request, and a closed-tab item never appears on the canvas rail. That is short of the preserve list and of the claim that the rail can answer the request.

What separates 6 from 7: one serious capability drop on the path this change removes, with file:line evidence, so it is not a sound pass. What separates 6 from 5: the Allow/Deny payload, the pending-queue guard, and the Unknown-tool disable are correct; the agent is not left without a once-allow or a hard deny.

Tests and builds were not run (review rule). `ptah_*` tools are not connected in this session (`search_tool` for `ptah` returned no tools). Evidence is `git diff`, `git show HEAD` of the badge, and reads of the answer path. No `code-style-review.md` exists in this folder; style findings are omitted.

## Decisions

- Treat lost Always / deny-with-message / tool-body as a defect, not as an implied narrowing. Options were to accept Allow/Deny as the whole contract, or to require the preserve list. The spawn focus says each badge capability must still exist or be listed as a removal. `lane-no-tab-answer.md` lists the component removal and does not list those decisions. Reversible by restoring the card actions on the attention item or by recording an explicit removal.
- Treat the canvas-rail miss as in scope even though `canvas-rail.component.ts` did not change. The new closed-tab item has no `tabId` and `workspacePath: ''`, and the rail drops that shape. Reversible by stamping the last known workspace and matching a session-less row.

## Numbered defects

1. **Major (serious).** Unmatched and closed-tab permissions lose Always, deny-with-message, and the request body, and that removal is not recorded.
   - `libs/frontend/chat-ui/src/lib/molecules/permissions/permission-request-card.component.ts:106-137` and `:387-399` emit `allow`, `always_allow`, `deny`, and `deny_with_message` (with `reason`). The deleted badge rendered that card for `chatStore.unmatchedPermissions`.
   - `libs/frontend/chat/src/lib/services/chat-attention-source.service.ts:158-159` offers only Allow and Deny for `kind === 'permission'`.
   - `libs/frontend/chat/src/lib/services/agent-permission-responder.ts:66-68` posts `{ id, decision }` only. There is no attention action id for `always_allow` or `deny_with_message`.
   - `libs/frontend/chat/src/lib/services/chat-attention-source.service.ts:144-168` puts a sanitized tool name in `detail` and does not copy `description` or `toolInput`. `chat-attention-source.service.ts:155` disables Show in canvas when no owner can open, so a closed tab cannot navigate to the transcript either.
   - `libs/frontend/chat/src/lib/components/molecules/tool-execution/tool-call-item.component.ts:105-110` still renders the full card only when the tool node is in the tree. `permission-handler.service.ts:291-300` defines unmatched as no `toolUseId` or a `toolUseId` absent from that tree. After the badge template left `chat-view.component.html`, nothing renders that card for those requests.
   - Impact: the user can still Allow once or hard-deny, so the SDK is not stuck, but they cannot create an always-allow rule or deny while continuing with feedback, and they approve or deny without the tool input the badge showed.

2. **Minor (moderate).** A closed-tab permission is answerable on the bell and the snackbar, and it is absent from the canvas rail.
   - `chat-attention-source.service.ts:121-123` sets `workspacePath` from the live owner only, so a missing tab becomes `''`. Line 165 sets `tabId` from `owner?.tab.id`, which is undefined.
   - `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts:347-352` keeps a row only when `item.workspacePath === this.workspacePath()` and some tile matches.
   - `canvas-rail.component.ts:387-392` matches a tab-less item only to a tile whose tab still has that `sessionId`. A closed tab has no such tile.
   - `libs/frontend/core/src/lib/services/notification.service.ts:42-53` does not filter `needsYou` or `snackbars` by workspace, and `chat-attention-source.service.ts:103-106` suppresses the snackbar only when `item.tabId` is set. Bell and snackbar still show the row.
   - Impact: the claimed rail answer path does not exist for the closed-tab case. The user is not blocked if they use the bell or the snackbar.

3. **Minor.** A lane permission with no live tab and no tool name now reports "Unknown tool" instead of "Session unavailable". The button stays disabled.
   - `chat-attention-source.service.ts:158`. The old reason preferred `!tabId`. The new reason prefers `!canAllow`. A lane Allow/Deny with a tool name and no tab still says "Session unavailable". No answer is sent.

4. **Minor.** The pop-out regression no longer locks the fallback-display assertion.
   - `permission-handler.service.spec.ts:508-516` used to expect `unmatchedPermissions()` to contain the request after the only target tab closed. It now expects only `permissionRequests()` to contain it. Production `unmatchedPermissions` (`permission-handler.service.ts:275-301`) was not changed, and no template reads `ChatStore.unmatchedPermissions` after the badge binding was removed (`chat.store.ts:117` only forwards the computed). The new assertion would still pass if the request stayed queued and became invisible to every fallback reader.

## Five logic questions

### 1. How does this fail silently?

Allow and Deny do not report success when the post is refused. `permission-handler.service.ts:432` returns false before `postMessage` when the id is gone, and `agent-permission-responder.ts:65` returns that false. `chat-attention-action-dispatcher.service.ts:33-37` returns `{ kind: 'stale' }` when the same check fails before `dispatch`.

The silent case is the missing request body (defect 1): the bell shows Allow as enabled, the click succeeds, and the host receives `allow` for a tool whose input the user could not read. The UI looks like a completed answer.

A closed-tab row also disappears from the rail with no error (defect 2). That is hidden work, not a false success.

### 2. What user action produces unexpected behaviour?

- Always, or Deny with message, on an unmatched or closed-tab prompt. Those controls are gone. Hard Deny remains, and the card's own comment (`permission-request-card.component.ts:419-421`) says hard deny stops execution while deny-with-message continues.
- Looking at the canvas Needs you list after the owning tab closes. The row is not there. The snackbar and the bell still have it.
- A lane prompt whose tab is gone and whose tool name is empty. Allow shows "Unknown tool" (defect 3).

### 3. What input data produces a wrong answer?

A permission with a non-empty `toolName`, a dangerous `toolInput` or `description`, and no live tab. `canAllow` is `!!request.toolName` (`chat-attention-source.service.ts:69`), so Allow is enabled. `description` and `toolInput` are not copied onto the attention item (`:144-168`). The posted decision is whatever the user clicked; the decision is under-informed.

`toolName` that fails `/^[\w .:-]{1,50}$/` (`:145`) is omitted from `detail` as well, so the row can read "Permission required" with no tool name and still enable Allow and Deny.

An empty `toolName` disables Allow with "Unknown tool" and leaves Deny enabled (`:158-159`). That part matches the requested Unknown-tool rule.

### 4. What happens when a dependency fails?

`handlePermissionResponse` posts before it removes the queue entry (`permission-handler.service.ts:432-457`). If `postMessage` throws, the request stays pending. `dispatch` catches it (`chat-attention-action-dispatcher.service.ts:81-82`) and `reportActionFailure` (`:115-125`) upserts a fixed "Could not complete action" notice and does not include the error text. A later click can send once. That order matches the previous handler; this change does not add a new catch around the post.

If the request is already gone, nothing is posted (`:432`, responder `:65`, dispatcher `:33-37`).

There is no timeout or cancel token on the answer itself. The host either gets the message or the post throws.

### 5. What is missing that the requirements never mentioned?

The badge had no keyboard shortcut (`git show HEAD` of `permission-badge.component.ts`). Count and a list survive as the bell badge and the Needs you list (`notification.service.ts:42-43`), not as a permission-only count.

Not replaced, and not listed in `lane-no-tab-answer.md`: `always_allow`, `deny_with_message` plus `reason`, expiry countdown, and tool-input summary. `modifiedInput` on `PermissionResponse` (`libs/shared/src/lib/types/permission.types.ts:96`) was also only reachable from the card, not from attention.

`unmatchedPermissions` remains computed and is no longer bound to a template. Keeping it does not preserve a user-visible fallback.

## Failure modes

### Closed-tab answer drops the rule and the feedback deny

- Trigger: the only tab for a queued session permission closes, or the permission is unmatched, and the user needs Always or deny-with-message.
- Symptom: only Allow, Deny, and a disabled Show in canvas are offered. Allow/Deny still post. Always and deny-with-message cannot be sent.
- Evidence: `permission-request-card.component.ts:116-137`, `chat-attention-source.service.ts:158-159`, `agent-permission-responder.ts:66-68`.
- Current handling: the attention path sends `{ id, decision: 'allow' | 'deny' }`.
- Recommendation: add those two decisions to the attention item for `kind === 'permission'`, including `reason` for deny-with-message, or put the full card back for unmatched requests and record any intentional cut in the lane note.

### Closed-tab row never reaches the canvas rail

- Trigger: the owning tab closes, so `findTabId` returns undefined (`chat-attention-source.service.ts:110-114`).
- Symptom: the canvas rail has no row to Allow or Deny. The snackbar and the bell do.
- Evidence: `chat-attention-source.service.ts:121-123`, `canvas-rail.component.ts:347-352` and `:387-392`.
- Current handling: rail equality on workspace path plus a live session tile.
- Recommendation: keep the last workspace path on the item when the tab disappears, and let the rail show a tab-less permission that belongs to that workspace.

## Blocking issues

None. A pending Allow or Deny is posted once, or refused when the id is no longer queued. No second `SDK_PERMISSION_RESPONSE` is sent by the checks below.

## Serious issues

### Badge decisions and tool body are not on the replacement path

- File: `permission-request-card.component.ts:106-137`, `chat-attention-source.service.ts:158-168`, `agent-permission-responder.ts:66-68`, `tool-call-item.component.ts:105-110`
- Scenario: unmatched permission, or any queued permission whose tab has closed.
- Impact: the user can unblock the SDK with Allow or hard Deny only, without the tool input, and cannot persist an always-allow rule or send feedback with the deny.
- Fix: surface the card actions (and the tool summary) on the attention item, or restore a fallback card and list the cut capabilities in the lane note.

## Moderate and minor issues

- Moderate: closed-tab item is missing from the canvas rail. `chat-attention-source.service.ts:121-123`, `canvas-rail.component.ts:347-352`, `:387-392`.
- Minor: lane with no tab and no tool name is labeled "Unknown tool". `chat-attention-source.service.ts:158`.
- Minor: pop-out spec no longer asserts `unmatchedPermissions()`. `permission-handler.service.spec.ts:508-516`.

## Data flow

1. Queue entry exists on `PermissionHandlerService._permissionRequests` (`permission-handler.service.ts:326`). OK.
2. `ChatAttentionSourceService.reconcile` builds one item per queued permission (`chat-attention-source.service.ts:66-70`). OK for bell and snackbar. Gap: workspace and tab are cleared when the tab is gone (`:121-123`, `:165`), so the rail filter drops it.
3. Allow/Deny are enabled for `kind === 'permission'` even when `tabId` is missing, unless Allow is blocked by an empty tool name (`:158-159`). OK for the two decisions. Gap: no other decisions, no tool body.
4. Bell (`notification-center.store.ts:100-107`), snackbar (`notification-snackbar.component.ts:212-214`), and rail (`canvas-rail.component.ts:414-416`) call `dispatchOutcome` when it exists. This service implements it. OK.
5. `dispatchOutcome` returns `stale` when `isSessionPending` is false (`chat-attention-action-dispatcher.service.ts:33-37`). OK. It calls `unavailable('Already answered')`, which sets the status line.
6. `dispatch` for Allow/Deny calls `respondSession(request, actionId, target.tabId)` with no tab requirement (`:80`). `actionId` is `'allow'` or `'deny'`. OK.
7. `respondSession` checks the queue again and calls `handlePermissionResponse({ id, decision }, tabId)` (`agent-permission-responder.ts:65-68`). OK. Same method the badge reached through `chat.store.ts:482-484`, which omitted `tabId`. Passing `undefined` matches that.
8. Handler posts `{ type: SDK_PERMISSION_RESPONSE, response }` then removes the id (`permission-handler.service.ts:432-457`). OK for one answer.
9. A repeat click sees an empty pending check and does not post. OK.

Check-then-act: `dispatchOutcome`'s pending check and `respondSession` run with no `await` between them on the Allow/Deny path. `dispatch` is `async`, but the Allow/Deny branch does not await before `respondSession` (`:75-80`). `inFlight` is taken and released in that same synchronous stretch (`:51-85`). Two clicks in one turn cannot both pass the pending check. A click after the host, another card, or auto-resolve has removed the id is refused. `respondLane` also records answered ids (`agent-permission-responder.ts:18-38`); session answers rely on queue removal instead. That is enough while removal stays in the same turn as the post.

If `respondSession` returned false after the outer check had passed, `dispatchOutcome` would report `{ kind: 'unavailable', reason: 'Could not complete action' }` (`:38-40`) rather than `stale`. On this path that happens only if the queue changes inside `dispatch` before `respondSession`. Nothing there awaits or removes the request. Residual, not observed.

Bell and snackbar set the "Already answered" status on `stale` and do not add the action to the unavailable map (`notification-center.store.ts:102-106`, `notification-snackbar.component.ts:214-218`). The buttons stay enabled. A second click is refused and does not post. This snackbar behavior was already recorded for the rail redesign; this change uses that same outcome. The rail, when it has a row, blocks on status (`canvas-rail.component.ts:399`, `:416`).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| No-tab Allow/Deny enabled for a queued session permission | COMPLETE | Unknown tool still disables Allow. `chat-attention-source.service.ts:158-159`, spec at `chat-attention-source.service.spec.ts:102-118` |
| Show in canvas stays disabled when nothing can open | COMPLETE | Spec asserts `Session unavailable` on `open` |
| Unknown tool stays disabled | COMPLETE | Allow reason is `Unknown tool` when `toolName` is empty |
| Same message type, payload, id, and allow/deny values as the badge | COMPLETE | See focus a |
| Stale or second answer refused and not posted twice | COMPLETE | See focus b |
| Badge removed and nothing else rendered it | COMPLETE | See focus c. Bench JSON still names the deleted path; it is not a runtime import |
| Preserve every badge capability or list the removal | MISSING | Always, deny-with-message, tool input, expiry |
| Canvas rail shows enabled Allow/Deny for the closed tab | MISSING | Rail filter drops the item |
| Specs exercise the new behavior | PARTIAL | Unit checks are real; pop-out assertion was weakened; no test runs |

Implicit requirements not addressed: showing enough of the tool request to decide, and keeping Always / deny-with-message for the queue the badge existed to serve (`permission-handler.service.ts:266-267`).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Second Allow on the same key | YES | Queue removal before the next turn; `isSessionPending` then handler guard | Buttons on bell and snackbar stay enabled after `stale` |
| Answer after auto-resolve or cancel | YES | Id absent from `_permissionRequests`; dispatcher returns `stale` and does not call `respondSession` | Reported as "Already answered", not as a disabled control, on bell and snackbar |
| Empty tool name, no tab | YES | Allow disabled "Unknown tool"; Deny enabled | Lane with the same shape says "Unknown tool" even though the tab is also gone |
| Permission with a live tab | YES | Previous Allow/Deny path kept; `tabId` still passed through | Full card remains only for a tool node in the tree |
| `postMessage` throws | YES | Queue kept; failure notice; retry can send | Pre-existing post-then-mutate order |
| Very large permission list | YES | One attention item per request, same as before | No new per-item timer. The badge's per-card expiry interval is gone with the card |
| Concurrent bell and snackbar clicks | YES | First call removes the id synchronously before it yields | Not covered by a test |

## Focus a — backend response matches the badge

HEAD badge (`permission-badge.component.ts`) emitted the card's `PermissionResponse` and did not post itself. `chat-view.component.html` at HEAD bound `(responded)="chatStore.handlePermissionResponse($event)"`. `chat.store.ts:482-484` calls `permissionHandler.handlePermissionResponse(response)` with no tab.

The card's Allow and Deny emit `{ id: request.id, decision: 'allow' | 'deny', reason: undefined }` (`permission-request-card.component.ts:395-399`). The attention path calls `handlePermissionResponse({ id: request.id, decision }, tabId)` (`agent-permission-responder.ts:66-68`) with `decision` `'allow'` or `'deny'` and `tabId` undefined when no live tab was resolved (`chat-attention-action-dispatcher.service.ts:80`).

`handlePermissionResponse` posts `MESSAGE_TYPES.SDK_PERMISSION_RESPONSE` with that `response` object (`permission-handler.service.ts:433-436`). `reason: undefined` is not kept by structured clone or `JSON.stringify`, so the allow/deny body on the wire is `{ id, decision }` either way. `decidingTabId` falls back to the active tab when the argument is omitted (`:458`), which is what the badge did by omitting it.

This holds for `allow` and `deny` only. `always_allow` and `deny_with_message` are not produced.

## Focus b — stale refusal

`dispatchOutcome` checks `responder.isSessionPending(live.target.request.id)` before `dispatch` (`chat-attention-action-dispatcher.service.ts:33-37`). `isSessionPending` reads `permissionRequests()` (`agent-permission-responder.ts:72-74`), the readonly view of the same signal the handler checks (`permission-handler.service.ts:113`, `:432`).

`respondSession` checks again and returns false without calling the handler when the id is gone (`agent-permission-responder.ts:65`). The handler returns false before `postMessage` (`permission-handler.service.ts:432`). Specs: dispatcher `chat-attention-action-dispatcher.service.spec.ts:74-78` (mocked pending flag), responder `agent-permission-responder.spec.ts:98-101`, handler `permission-handler.service.spec.ts:170-172`.

The Allow/Deny path does not await before the post, so the pending check and the send do not interleave with another click. A false return from `respondSession` after the outer check had passed would be labeled "Could not complete action" rather than `stale` (`chat-attention-action-dispatcher.service.ts:38-40`). No await sits in that window.

Session answers do not use the lane `answeredRequestIds` set. Correctness depends on queue removal in `handlePermissionResponse` after a successful post. That removal is in the same turn as the post.

## Focus c — badge removal and preserve list

Repository search for `ptah-permission-badge`, `PermissionBadgeComponent`, and `permission-badge` found three lines, all path strings in `tools/mcp-bench/questions/7910f34cf/dependents.json` and `file-tools.json`. No `apps/` or `libs/` TypeScript or HTML reference remains. The component file is deleted. Exports were removed from `libs/frontend/chat-ui/src/index.ts` and `libs/frontend/chat/src/lib/components/index.ts`. `chat-view.component.ts` no longer imports it. Electron and the VS Code webview consume these libraries; there is no second badge component.

| Badge capability | Still present | Notes |
| --- | --- | --- |
| Allow | Yes | Attention Allow, enabled with no tab for `kind === 'permission'` |
| Deny | Yes | Attention Deny, including when the tool name is empty |
| Always allow | No | Not listed as a removal |
| Deny with message | No | Not listed as a removal |
| Tool display | Partial | Tool name only, and only when it matches the safe pattern. No input, description, or expiry |
| Count | Yes | Bell `badgeCount` counts every Needs you row, not permissions alone |
| Expand list | Partial | Bell lists attention rows. It does not expand the permission cards |
| Keyboard shortcut | Not on the badge | No shortcut in the HEAD component |

`unmatchedPermissions` is still computed and still exposed on `ChatStore` (`chat.store.ts:117`). Specs still read the computed. No template reads the store field anymore. Other readers of the queue are `permissionRequests()`, which the attention source uses (`chat-attention-source.service.ts:66`).

## Focus d — specs

The new tests assert behavior, not an identity tautology:

- `chat-attention-source.service.spec.ts:102-118` closes the owner and expects Allow and Deny to have no `disabledReason`, Open to be "Session unavailable", and an empty tool name to disable Allow with "Unknown tool".
- `chat-attention-action-dispatcher.service.spec.ts:69-78` expects `respondSession({ id: 'closed-tab' }, decision, undefined)` and expects `stale` with no responder call when `isSessionPending` is false. The pending flag is mocked, so this does not prove the handler queue.
- `agent-permission-responder.spec.ts:90-96` expects `handlePermissionResponse({ id, decision }, undefined)` and a true return. The handler is a mock that returns true.
- `permission-handler.service.spec.ts:160-168` expects `SDK_PERMISSION_RESPONSE` with `{ id: 'req-1', decision }` and an empty queue. `:170-172` expects false and no post when the id was never queued.

Not covered: a second `handlePermissionResponse` after a successful one (the missing-id test is the same guard), Always, deny-with-message, rail visibility of a `workspacePath: ''` item, and any execution of the specs. The pop-out test was weakened (defect 4).

## Focus e — silent failure and enablement

- Allow/Deny for a no-tab session permission are enabled. Confirmed at `chat-attention-source.service.ts:158-159`.
- Allow stays disabled when `canAllow` is false, with "Unknown tool", including when the tab is also missing, because `!canAllow` wins the reason ternary. Confirmed.
- Deny for a session permission is enabled without a tab, including an unknown tool. That matches a deny that does not need a tool name.
- Show in canvas stays disabled when `open` is false (`:155-161`).
- Lane permissions still require a tab (`kind !== 'permission' && !tabId`). They are not given the no-tab answer path.
- Stale answers are not posted. Bell and snackbar leave the buttons enabled after reporting "Already answered" (see data flow). That does not send a second response.
- No empty `catch` was added on the answer path. A thrown post becomes the fixed failure notice (`chat-attention-action-dispatcher.service.ts:115-125`).

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for the Allow/Deny payload and the stale guard. MEDIUM for rail visibility, which is inferred from the rail filter and the item fields, not from a running canvas.
- Top risk: an unmatched or closed-tab prompt can be allowed from a row that does not show the tool input, and Always / deny-with-message are gone.
- What a robust implementation would add: the two missing decisions and a tool summary on the attention row, a rail row for a closed tab in the last workspace, and a handler-level test that a second answer does not post.
