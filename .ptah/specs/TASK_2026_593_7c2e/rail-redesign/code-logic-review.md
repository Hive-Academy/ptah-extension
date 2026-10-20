# Code Logic Review — `TASK_2026_593_7c2e`

Review family: reviewer grok, implementer codex

## Summary

| Metric              | Value |
| ------------------- | ----- |
| Overall score       | 6/10 |
| Assessment          | REVISE |
| Blocking issues     | 0 |
| Serious issues      | 1 |
| Moderate issues     | 4 |
| Failure modes found | 5 |

Scope: uncommitted diff against `9c7dd338e` (14 source/spec files) plus `design-spec.md`, `lane-cards.md`, and `lane-rail.md`. Read in full: `attention.types.ts` field addition, both chat attention writers, `notification-snackbar.component.ts`, `notification-center.component.ts`, `canvas-rail.component.ts`, the attention block and click path in `canvas-rail-card.component.ts`, and the board wiring/geometry hunks. Also read `NotificationService` list/resolve/clear paths, `ChatAttentionActionDispatcherService.dispatchOutcome`, and `attention-context.util.ts`. No source edits. No Nx, Jest, tsc, lint, or build. `ptah_get_diagnostics` is not connected in this session.

What separates 6 from 7: untitled sessions render the kind title as the session name, and `+N more` can close the bell. What separates 6 from 5: rail, bell, and snackbar are projections of one `NotificationService` list; an allow/deny/answer still goes through `ATTENTION_ACTION_DISPATCHER` with key and generation; a disabled action cannot fire; workspace-plus-tile filtering is real.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Missing session metadata must say "Session unavailable", not `item.title` | Keep the lane's `item.title` fallback; show "Session unavailable" | `design-spec.md` line 25 forbids a blank or fabricated identity. Chat and host writers set `title` to the kind label (`chat-attention-source.service.ts:156-159`, `chat-attention-host-message-handler.service.ts:188-212`) and clear `sessionTitle` for "New chat" / "Untitled" (`chat-attention-source.service.ts:137-140`) | Yes |
| Desktop snackbar count stays at the retained contract (3), not the lane's cap of 2 | Cap at 2; keep 3 above 900px width | `design-spec.md` line 3 makes the retained contract authoritative; line 70 states three desktop snackbars and one at `<=900px`. The two-card cap exists only in `lane-cards.md` | Yes |

## Five logic questions

### 1. How does this fail silently?

`openNotifications` clicks the bell and ignores a missing button (`canvas-rail.component.ts:328-330`). The bell handler toggles (`notification-center.component.ts:147-149`). `+N more` while the panel is open closes it. If the test id is absent, the click does nothing and the user still sees the control.

After a stale or failed outcome the rail records a status and then clears `submitting` without disabling the buttons (`canvas-rail.component.ts:379-393`). A second click calls the dispatcher again. The dispatcher refuses a dead generation (`chat-attention-action-dispatcher.service.ts:38-42`), so this is not a second answer, but the UI presents a live control.

The snackbar's no-dispatcher branch sets no status (`notification-snackbar.component.ts:220-222`). Production binds `dispatchOutcome`, so this is the fallback only.

### 2. What user action produces unexpected behaviour?

`+N more` on the queue (`canvas-rail.component.ts:215`) and on a card (`canvas-rail-card.component.ts:178` → `otherRequests`) both call `openNotifications`. Opening is not idempotent.

A session whose safe title was rejected shows "Permission required" or "Question needs an answer" as the session name in the queue (`canvas-rail.component.ts:195`), the bell (`notification-center.component.ts:116-118`), and the snackbar (`notification-snackbar.component.ts:142-144`). The user can treat the kind label as the session.

When Allow is disabled, the rail still paints Allow as `btn-primary` (`canvas-rail.component.ts:201`). Show in canvas stays a ghost button. The snackbar and bell already promote `open` (`notification-snackbar.component.ts:155-158`, `notification-center.component.ts:131-135`).

### 3. What input data produces a wrong answer?

`sessionTitle` omitted or cleared, with `title` equal to the kind label. That is the normal output for a default tab title, not a rare payload.

`matches` is an OR of tab id and session id (`canvas-rail.component.ts:362-364`). One item whose `tabId` is tile A and whose `sessionId` is tile B's `claudeSessionId` is rendered on both cards. Both chips dispatch the same key, so the permission target is still the live request, but two sessions look like they need a decision.

`actionStatus` is keyed only by `item.key` and is never removed (`canvas-rail.component.ts:395-397`). A later item that reuses the key shows the previous "Request changed..." or "Action unavailable" line.

### 4. What happens when a dependency fails?

Dispatcher missing on the rail: status "Action unavailable", focus restore cancelled (`canvas-rail.component.ts:376-378`). Dispatcher throw: same status (`canvas-rail.component.ts:388-390`). `dispatchOutcome` stale: rail shows "Request changed. Open the current request." and does not move focus (`canvas-rail.component.ts:381-383`). Snackbar stale copy is "Already answered" and does not add the action to `unavailable` (`notification-snackbar.component.ts:215-218`), so the button stays enabled.

`TabManagerService.findTabByIdAcrossWorkspaces` returning null drops the session-id clause. The item still matches when `item.tabId === tile.tabId`. If both fail, the item stays in the bell because `localNeedsYou` requires a tile (`canvas-rail.component.ts:334-339`).

Focus router failure is unchanged for failure/open snackbars (`notification-snackbar.component.ts:208-212`).

### 5. What is missing that the requirements never mentioned?

Nothing beyond the approved design. The gaps below are rules the design stated and this diff left out. They are not extra product ideas.

## Failure modes

### Kind title shown as the session

- Trigger: `sessionTitle` absent. Chat and host both do this for default or unsafe titles.
- Symptom: the main line repeats "Permission required", "Question needs an answer", or "Lane permission required". A failure with no `sessionTitle` repeats "Could not complete action" (`chat-attention-action-dispatcher.service.ts:113-119` does not copy `sessionTitle`).
- Evidence: `notification-center.component.ts:116-118`, `notification-snackbar.component.ts:142-144`, `canvas-rail.component.ts:195`.
- Current handling: `item.sessionTitle || item.title || 'Session unavailable'`. The middle term wins whenever a title exists.
- Recommendation: use `item.sessionTitle` or the literal "Session unavailable". Do not fall back to `item.title`.

### Overflow control closes the bell

- Trigger: `+N more` while `[data-testid="notification-center-bell"]` is expanded, or when that button is not in the document.
- Symptom: the panel closes, or nothing happens.
- Evidence: `canvas-rail.component.ts:328-330`, `notification-center.component.ts:147-149`.
- Current handling: synthetic `click()` on the first match.
- Recommendation: call the center's `openPanel()` (or a core signal) and no-op when it is already open. Surface a status if the bell cannot be opened.

### Stale status sticks to the key

- Trigger: outcome `stale` or `unavailable`, then the same key is upserted again, or the row is still visible.
- Symptom: a live row says the request changed or the action is unavailable, and the buttons still submit.
- Evidence: `canvas-rail.component.ts:381-397`; snackbar stale branch `notification-snackbar.component.ts:215-218`.
- Current handling: rail map grows only. Snackbar prunes by `key:generation` (`notification-snackbar.component.ts:112-116`) but does not disable on `stale`.
- Recommendation: key status by `key:generation`, delete it when the item leaves `needsYou()`, and disable the row's actions while the stale message is showing.

### Two cards, one request

- Trigger: `tabId` matches one current tile and `sessionId` matches another tile's `claudeSessionId`.
- Symptom: two Needs you chips and two sets of Allow/Deny for one authoritative item.
- Evidence: `canvas-rail.component.ts:359-364`.
- Current handling: `submitting` is per key, so the second click is ignored while the first is in flight. Resolution removes both because both read `needsYou()`.
- Recommendation: if `tabId` matches a current tile, do not also match other tiles by session id.

### Desktop stack is not the retained stack

- Trigger: three or more snackbars, window wider than 900px, or height at or under 620px.
- Symptom: two cards on a tall desktop; one card on a short desktop. The retained rule is three and one.
- Evidence: `notification-snackbar.component.ts:96-103`. Locked in by `notification-snackbar.component.spec.ts:110-116`.
- Current handling: overflow still opens the bell from the snackbar's own output (that path does not use `openNotifications`).
- Recommendation: `limit` 3 when `innerWidth > 900`, else 1. Drop the height gate unless the retained contract is changed.

## Blocking issues

None. No path found that writes a second allow/deny, drops a resolved item from only one surface, or renders `detail` through HTML.

## Serious issues

### Session line fabricates an identity

- File: `libs/frontend/notification-center/src/lib/notification-center.component.ts:116-118`; `libs/frontend/notification-center/src/lib/notification-snackbar.component.ts:142-144`; `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts:195`
- Scenario: a pending request whose tab title is empty, "New chat", "New session", "Untitled", or rejected by `isUnsafeAttentionContext`. The writers set `sessionTitle` to undefined and `title` to the kind label.
- Impact: bell, snackbar, and the rail queue name the session after the request kind. The approved rule is the explicit fallback "Session unavailable".
- Fix: `return item.sessionTitle || 'Session unavailable'`. Keep the kind in `kindLabel` only.

## Moderate issues

### Snackbar cap contradicts the retained contract

- File: `libs/frontend/notification-center/src/lib/notification-snackbar.component.ts:96-103`
- Scenario: desktop width above 900px, or any width with `innerHeight <= 620`.
- Impact: the authoritative contract says three desktop snackbars and one at `<=900px` (`design-spec.md` lines 3 and 70). This build shows two, and also collapses on height. Fewer cards reduce overlap with Stats; they are still a behavior change, and two cards can still cover a top-right control. Not visually measured here.
- Fix: restore 3 / 1 by width only.

### `+N more` toggles or no-ops

- File: `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts:328-330`
- Scenario: bell already open, or bell not in the document. Card `+N` uses the same method (`canvas-rail-card.component.ts:178`).
- Impact: the control that should reveal the rest of the queue hides it, or does nothing.
- Fix: open, do not toggle. Do not depend on `querySelector` without a result.

### Stale and failed outcomes leave a live, mislabeled row

- File: `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts:381-397`; `libs/frontend/notification-center/src/lib/notification-snackbar.component.ts:215-218`
- Scenario: `dispatchOutcome` returns `stale` or `unavailable`, or the same key returns later.
- Impact: buttons stay enabled; a reused key keeps the old status. Card inline buttons also ignore `submitting` (`canvas-rail-card.component.ts:171`), so during the in-flight window they look clickable while `activate` returns at `canvas-rail.component.ts:370`.
- Fix: disable on stale, prune status with the generation, and bind card `disabled` to the rail submitting set.

### One request can attach to two tiles

- File: `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts:362-364`
- Scenario: `tabId` and `sessionId` identify different current tiles in the same workspace.
- Impact: duplicate Needs you chips. The dispatcher still applies the action to the live request, not to whichever card was clicked.
- Fix: session-id match only when no current tile has this `tabId`.

### Disabled Allow stays the primary rail action

- File: `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts:201`; card actions are all `btn-ghost` at `canvas-rail-card.component.ts:171`
- Scenario: Allow or Answer has `disabledReason`, and Show in canvas is enabled.
- Impact: the disabled control keeps the primary treatment. The approved rule makes Show in canvas the only primary action. The disabled button does not fire.
- Fix: share the snackbar `isPrimary` check. On the card, mark Answer/Allow primary only when enabled.

## Data flow

1. Chat `add` and host `upsertProjection` build one `AttentionItem` with safe `sessionTitle`, `provider`, and (local only) `detail`. OK for sanitizer use (`chat-attention-source.service.ts:137-168`, host `192-213`). Host leaves `detail` unset. OK.
2. `NotificationService.upsert` stores that object. `needsYou` is request kinds, newest first (`notification.service.ts:42`). `resolve` drops the key for every reader. OK. No second copy of the request body on the rail.
3. Snackbar and bell read `snackbars` / `needsYou` directly. OK, same key and generation.
4. Rail `localNeedsYou` keeps `workspacePath` equality and a current tile, then reverses to oldest-first (`canvas-rail.component.ts:334-339`). Three-row slice is the three oldest. OK. `workspacePath === ''` matches only items whose path is also `''`. A named board does not show unpartitioned items. OK.
5. `matches` can attach one item to two tiles. Gap, see above.
6. Queue and card actions call `activate`, which re-reads key+generation and refuses a missing or disabled action (`canvas-rail.component.ts:368-370`). OK.
7. Production dispatcher is `dispatchOutcome`. The rail spec stubs only `dispatch` (`canvas-rail.component.spec.ts:51`), so it never enters `canvas-rail.component.ts:379-383`.
8. Success `resolve` removes the row from rail, bell, and snackbar together. OK. `clearAll` skips non-recent items (`notification.service.ts:180-186`, `isRecent` at `240-242`). OK. Snackbar X calls `dismissPresentation` only (`notification-snackbar.component.ts:196-200`). OK.
9. Focus: Escape on the panel still closes and returns to the bell (`notification-center.component.ts:34`, `164-168`). Outside click still closes (`171-173`). Snackbar arrival still does not take focus. Bell open focuses the first enabled `.notification-row button` in document order (`157-160`), which can be a Recent notice when every Needs you action is disabled. That is narrower than "first enabled request action, otherwise the heading".

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Same items by key+generation on rail, bell, snackbar | COMPLETE | Shared `NotificationService` |
| Answer/allow/deny in one place clears all | COMPLETE | `resolve` deletes the key |
| Disabled actions cannot fire | COMPLETE | Native `disabled` on all three surfaces; rail re-checks `disabledReason` |
| Stale generation not applied | PARTIAL | Dispatcher returns stale; UI does not disable or clear status |
| Workspace-local projection | COMPLETE | Path equality plus a current tile |
| Unpartitioned `''` not mixed into a named workspace | COMPLETE | Strict `===` |
| Safe title/detail helpers, interpolation, no innerHTML | COMPLETE | No `innerHTML` in the five components. No `text-base-content/NN` |
| Canvas does not import notification-center | COMPLETE | Overflow uses a DOM test id |
| Canvas tags | COMPLETE | `scope:webview`, `type:feature`. Chat and core are `scope:webview`. `TabManagerService` is an existing canvas dependency, not a new library |
| Snackbar never covers primary actions, 900px rule | PARTIAL | Still top-right, width cap, one card at `<=900`. Desktop count is 2 and height `<=620` also forces 1. Overlap not measured |
| Escape / focus return / no snackbar autofocus | COMPLETE | Recent-row focus steal only when every request action is disabled |
| Specs fail without the new behavior | PARTIAL | See below |

Implicit requirements not addressed: "Request resolved" is never announced. Empty rail queue is hidden (`canvas-rail.component.ts:185`) rather than a one-line All clear. No relative time, because `AttentionItem` has no timestamp. Compact sheet (`canvas-rail-board.component.ts:326-338`) is the session inspector and does not host the queue; below `RAIL_AUTO_COLLAPSE_PX` (640) the queue is not rendered because the rail is collapsed. Card `+N` opens the bell, which the design allows.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Empty local queue | YES | Section omitted | Design also asked for All clear. Gap |
| Null dispatcher | YES | Rail status; snackbar silence | Snackbar fallback looks like a no-op |
| Disabled allow | YES | `disabled` plus reason text | Still styled primary on the rail |
| Very long detail | YES | `truncate` plus `title` | Card preview is an inline span (`canvas-rail-card.component.ts:167`); ellipsis needs a bounded width |
| Concurrent double click | YES | `submitting` set before await; dispatcher `inFlight` | Card button stays enabled |
| Repeated same key | NO | Status map retains the old message | Moderate finding |
| Workspace path case or slash mismatch | NO | Strict string equality | Not seen in the writers; residual risk |
| Collapse at 900 vs 640 | YES | Existing `RAIL_AUTO_COLLAPSE_PX` is 640. Design says follow existing collapse | Queue hidden while auto-collapsed |

## Specs

- `canvas-rail.component.spec.ts:59-76` fails if the queue does not render `sessionTitle` or if `dispatch` is not called with key, generation, and `allow`. It still passes if the workspace filter is removed, if a second workspace's item is also shown, or if the generation guard is deleted. The stub has no `dispatchOutcome`, so the production branch is untested.
- `canvas-rail-card.component.spec.ts` new test fails if the chip is missing, if the inline click does not emit, or if that click selects the session. It does not cover disabled, `+N`, or collapsed "Needs you" count.
- `notification-center.component.spec.ts` fails if the row omits session, provider, or detail, or if open focuses the row instead of the first enabled button. It does not cover a Needs you row whose actions are all disabled.
- `notification-snackbar.component.spec.ts:110-116` fails if three desktop cards are shown. That asserts the contract deviation. The identity test does fail if the session line or detail disappears, and `querySelector('private')` fails if detail is parsed as HTML.
- Chat specs fail if `sessionTitle`, `provider`, or `detail` are dropped on the happy path, and if a generic host title still sets `sessionTitle`. They do not render the fallback string.

## Gaps (approved design left out)

- Empty rail section is hidden, not "All clear" plus a check (`design-spec.md` line 48).
- No "Request resolved" announcement (line 37).
- No relative time (line 27). Lane is right that the item has no timestamp.
- Compact Sessions sheet does not show the queue (line 50). Collapsed cards do show a needs dot and an accessible count (`canvas-rail-card.component.ts:130-141`).
- Card inline actions omit Show in canvas. The queue includes it. The design asks for Show in canvas on the queue row; the card rule is Answer or Allow/Deny. That part matches.
- Host projections have no `detail`. Preview falls back to `context` or `title` (`canvas-rail.component.ts:197`). Lane choice, and it avoids inventing a tool name.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for the identity fallback, the bell toggle, the shared list, and the workspace filter. MEDIUM for whether two snackbar cards still cover Stats, because this review did not render Electron.
- Top risk: untitled sessions display the kind label as the session name, so the new identity line misstates who the request belongs to.
- What a robust implementation would add: the "Session unavailable" fallback, an open-only overflow path, generation-scoped status that disables on stale, a single-tile match, and the retained 3/1 snackbar limit. Extend the rail spec with a foreign workspace, a `''` workspace, a disabled click, and a `dispatchOutcome` stale result.

## Re-review (round 1)

Reviewed the uncommitted tree again after `lane-cards-r1.md` and `lane-rail-r1.md`. Read the current session-name helpers, snackbar limit, `openNotifications`, rail outcome state, `matches`, `rail-attention-action.ts`, the card action row, and the new spec cases. No tests or builds were run.

| Round-1 defect | Status | Evidence |
| --- | --- | --- |
| Serious: session line uses the kind title | Fixed | `notification-center.component.ts:116-118`, `notification-snackbar.component.ts:142-144`, and `canvas-rail.component.ts:196` all use `sessionTitle` or `Session unavailable`. Kind stays on its own line (`canvas-rail.component.ts:198`, snackbar `kindLabel`). Specs: `notification-center.component.spec.ts:105-114`, `notification-snackbar.component.spec.ts:47-53`, `canvas-rail.component.spec.ts:91-100`. |
| Moderate: snackbar cap 2 and height `<=620` | Fixed | Limit starts at 3 and becomes 1 only when `innerWidth <= 900` (`notification-snackbar.component.ts:96-103`). Specs at `notification-snackbar.component.spec.ts:119-131`, `:177-190`, and `:193-203`. |
| Moderate: `+N more` toggles or no-ops | Fixed | `canvas-rail.component.ts:333-340` clicks the bell only when `aria-expanded` is not `true`, and sets "Notifications are unavailable." when the button is missing (`:219`). Queue and card both call it (`:217`, `:266`). Spec `canvas-rail.component.spec.ts:106-123`. |
| Moderate: stale status sticks and buttons stay live | Fixed on the rail | Status is `{ generation, message }` (`canvas-rail.component.ts:344`, `:426-427`). `isBlocked` disables every row and card action (`:204`, `:395`, card `:172`). A new generation drops the old status (`:355-360`). Spec `canvas-rail.component.spec.ts:125-143` and card spec `:273-277`. |
| Moderate: one request on two tiles | Fixed | A tab id that is on the board matches only that tile. Otherwise the first ordered tile with that session id matches (`canvas-rail.component.ts:383-388`). Spec `:145-152`. |
| Moderate: disabled Allow stays primary | Fixed | `rail-attention-action.ts:3-12` promotes `open` when Allow/Answer is missing or disabled. Queue `:203` and card `:172`. Card now includes the `open` action (`:171`). Specs `canvas-rail.component.spec.ts:101-104` and card spec `:255-272`. |

### Regressions checked

- Workspace equality and the oldest-first reverse are unchanged (`canvas-rail.component.ts:346-351`).
- `activate` still re-reads key and generation and still refuses a disabled action (`:399-401`). The rail spec now stubs `dispatchOutcome` (`canvas-rail.component.spec.ts:48-53`) and resolves the item on completion (`:74-77`).
- Bell `aria-expanded` is the panel flag (`notification-center.component.ts:26`), so the overflow check matches the real control.
- Card inputs `submittingKeys` and `blockedKeys` default to empty sets (`canvas-rail-card.component.ts:353-354`), so existing card mounts do not throw.
- A blocked stale row also disables Show in canvas. That matches the requested "disable the row" fix and the new spec (three disabled buttons). The session card itself still selects. Not a new defect.
- No new `innerHTML` or `text-base-content/NN` on these paths.

### Still open (not a new defect)

Snackbar stale still only sets the status "Already answered" and does not disable the buttons (`notification-snackbar.component.ts:215`). `unavailable` does disable that action (`:216-218`). A second click calls `dispatchOutcome` again; the dispatcher returns stale and does not send another answer (`chat-attention-action-dispatcher.service.ts:38-42`). Fix, if wanted: on `stale`, record every action id in `unavailable` the same way the rail sets `isBlocked`.

### New defects

None. The card's action label still falls back to `current.title` (`canvas-rail-card.component.ts:175`). That is the tab title on the owning card, not the kind label, so it does not revive the serious identity bug.

### Score

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking | 0 |
| Serious | 0 |
| Moderate still open | 1 (snackbar stale buttons only) |
| New defects | 0 |

8 rather than 9: the snackbar stale path is still live, and three desktop cards can still cover the Electron Stats pane. That overlap was not rendered here. 8 rather than 7: every filed rail and identity defect is fixed in source, and the leftover cannot apply a second allow or deny.

- Recommendation: APPROVE
- Confidence: HIGH on the six filed defects. MEDIUM on Stats overlap.
- Top residual: snackbar stale actions stay enabled.
