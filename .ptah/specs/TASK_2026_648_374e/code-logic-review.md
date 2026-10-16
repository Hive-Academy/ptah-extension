# Code Logic Review — `TASK_2026_648_374e`

Review family: grok (implementer family: codex)

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Assessment | APPROVED WITH FINDINGS |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 3 |
| Minor issues | 1 |
| Failure modes found | 3 |

Score 7: the embed, index, and launcher do what the batch contracts require on the paths the specs exercise (scoped tokens, owner-counted visibility for two embeds, sanitized kinds, forget only after a successful delete, navigation cancel creates no tab). That is short of 8 because three moderate paths still produce a success-looking result: a history badge that will not survive reload, a visible-tab count left behind by the tribunal conductor, and a grid launch that reports `landed` when the draft never reaches a composer. It is above 6 because none of those corrupt tab state, render an unsanitized kind, or drop a session embed's own registration on hide, tab change, or destroy.

Evidence used: `implementation-plan.md`, `decisions.md` (D6–D8), `parity-inventory.md` is the preserve list the plan points at, batch reports were not required to score behaviour, and the diff `ad74df866..HEAD` for `libs/` (whitespace-insensitive for the reformatted canvas header and chat view). Compared `SessionEmbedComponent` with `git show ad74df866:libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.ts`. Ptah symbol tools are not connected in this lane, so this review used `git diff` and file reads. Tests were not re-run; the orchestrator report (chat 3948, canvas 374, chat-state 574) is noted and is not treated as proof of the failure paths below.

## Five logic questions

### 1. How does this fail silently?

A full localStorage write throws inside `WorkflowSessionIndexService.persist`. The in-memory kind stays, `warning` is set, and `console.warn` prints a fixed sentence (`workflow-session-index.service.ts:129-146`). No template reads `warning`. The open tab still shows its badge from `TabState`. After reload, a closed session's sidebar badge is gone and the user was not told.

`WorkflowTabLauncherService.open` returns `{ outcome: 'landed' }` after `requestCanvasTab` and `requestComposerPrefill` (`workflow-tab-launcher.service.ts:45-59`). `CanvasStore.adoptTab` returns null when the grid is already at `MAX_TILES` (`canvas.store.ts:326-327`). The prefill is stored with that tab id. The only consumer applies it when `SESSION_CONTEXT` equals that id, and an unscoped chat view applies it only when `tabId` is null (`chat-view.component.ts:1375-1388`). With no tile, nothing applies the draft, and switching to the single layout does not either. The caller still sees `landed`.

### 2. What user action produces unexpected behaviour?

Leave Tribunal after the conductor's correlation id changed during that same component instance. `ConductorTileComponent` registers once in `ngOnInit` and unregisters whatever `correlationId()` is at destroy (`conductor-tile.component.ts:227-236`). `TribunalRunService.prepare` replaces that id without recreating the tile (`tribunal-run.service.ts:161-179`). Under the old `Set`, any later `unregisterVisibleTab` of the original id removed it. Under the reference count (`tab-manager.service.ts:3046-3069`), the conductor's extra count survives the session embed's own unregister, so the tab stays in `visibleTabIds` after every embed has gone.

Open a workflow tab from the launcher while the rail grid is full. The new tab exists and is tagged, and the composer the user eventually sees is empty (see question 1).

### 3. What input data produces a wrong answer?

A restored index entry whose `kind` is not one of the five `WorkflowKind` values is dropped (`workflow-session-index.service.ts:34-44`, `tab-persistence.ts:238`). `WorkflowBadgeComponent` renders only `labels[kind]` after `isWorkflowKind` (`workflow-badge.component.ts:31-34`). An unknown or HTML-looking kind does not become badge text.

`workflowForSession(sessionId, '')` returns null because `isValidKey` rejects an empty workspace path (`workflow-session-index.service.ts:23-31,58-60`). Both delete call sites pass `activeWorkspacePath ?? ''` (`app-shell.component.ts:960-963`, `chat-view.component.ts:1929-1932`). They cannot delete an entry that was stored under a real path when the active path is null, and they also cannot have stored one: `rememberTab` returns on a missing path (`workflow-session-index.service.ts:67-72`). A delete while a workspace is active uses that path. No cross-workspace wipe.

### 4. What happens when a dependency fails?

Navigation `cancelled` or `failed`, and a thrown `navigateToSurface`, return a result and do not call `createTab` (`workflow-tab-launcher.service.ts:30-38`). An invalid `workflow` or a blank title throws `Invalid workflow tab request` instead of `{ outcome: 'failed' }` (`workflow-tab-launcher.service.ts:27-29`). That throw is the right behaviour for a caller bug; see Decisions.

`chat:start` failure is outside this diff and is not counted as a finding. `MessageSenderService` already consumes `firstMessagePreamble` before the RPC (`message-sender.service.ts:420-424`) and does not put it back on the failure returns (`:467-488` and `:491-505`). A workflow seed uses that existing path, so a failed first start drops the framing and a retry is a normal continue. That predates 648 (Tribunal uses the same consume). It is recorded here so 649 does not treat "preamble once" as "preamble survives a failed start".

Index `setItem` failure keeps the memory map and sets `warning`. `getItem` / `JSON.parse` failure warns and leaves the map empty (`workflow-session-index.service.ts:104-127`). Neither path throws to the tab tag.

### 5. What is missing that the requirements never mentioned?

Nothing user-visible from the parity list is removed by this diff: the canvas notice, lane actions, and retention stay on `CanvasDetailTranscriptComponent` (`canvas-detail-transcript.component.ts:22-93`). D6's `addonOpen` / `addonTitle` / `addonDismissed` are absent on purpose; the embed projects `[sessionHeader]` and `[sessionAddon]` only (`session-embed.component.ts:39-44`).

The collapsed rail card does not show a workflow badge. That is called out as minor, not as a missing requirement the plan wrote down for the 56px rail.

## Failure modes

### History badge disappears on reload with no in-app notice

- Trigger: `localStorage.setItem` throws while `rememberTab` persists a new kind (quota, private mode, or a thrown storage shim).
- Symptom: the open tab still shows the workflow badge. After reload, the sidebar row for that closed session has no badge. The user sees no warning.
- Evidence: `libs/frontend/chat-state/src/lib/workflow-session-index.service.ts:129-146`. `warning` has no reader outside `workflow-session-index.service.spec.ts`.
- Current handling: memory map kept, fixed `console.warn`, signal set and cleared only by a later successful `persist`.
- Recommendation: read `warning` from a surface that is already dirty on storage failure (sidebar status or the existing toast path) and keep the fixed sentence. Do not log the thrown storage error.

### Tribunal conductor leaves a visible-tab count the embed cannot clear

- Trigger: `ptah-conductor-tile` is created while `correlationId()` is tab A, so `ngOnInit` registers A. A later `prepare` sets correlation to tab B without destroying the tile. A session embed also registers A (split pane or the same tab on the canvas) and later unregisters A.
- Symptom: A remains in `visibleTabIds` after no embed is showing it. Live delivery keeps targeting A (`StreamViewportController` reads this set). B is decremented at conductor destroy even if the conductor never registered B; a single canvas owner of B is removed while that embed is still mounted.
- Evidence: `libs/frontend/tribunal-panel/src/lib/components/conductor-tile.component.ts:227-236`, `libs/frontend/tribunal-panel/src/lib/services/tribunal-run.service.ts:161-179`, `libs/frontend/chat-state/src/lib/tab-manager.service.ts:3046-3069`. No other writer clears `_visibleTabIds` or `visibleTabOwners`.
- Current handling: reference count is correct for embed effects, which capture the id they registered (`session-embed.component.ts:101-106`). The conductor still registers and unregisters two different reads of a mutable id. Against the old `Set`, a second host's `unregisterVisibleTab(A)` deleted A outright, which cleared the conductor's orphan. The count does not.
- Recommendation: store the id passed to `registerVisibleTab` and pass that same string to `unregisterVisibleTab`, and re-bind when `correlationId` changes. Do not unregister an id this instance did not register.

### Grid launch reports landed when the draft has nowhere to land

- Trigger: `layoutMode()` is `grid`, the canvas already has `MAX_TILES`, `open` is called with `visiblePrompt`.
- Symptom: result is `{ outcome: 'landed', tabId }`. The tab is tagged. `adoptTab` returns null. No `ChatViewComponent` with that `SESSION_CONTEXT` is created, so the prefill effect never runs. The single-layout composer ignores a non-null `tabId`. The user gets an empty composer.
- Evidence: `libs/frontend/chat/src/lib/services/workflow-tab-launcher.service.ts:45-59`, `libs/frontend/canvas/src/lib/canvas.store.ts:326-327`, `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:1375-1388`.
- Current handling: both requests are fire-and-forget, matching `TaskPromptBridgeService`. `open` cannot see the adopt result. The plan's "report a safe failure" covers navigation, not a dropped adopt (`implementation-plan.md` risks paragraph).
- Recommendation: have the canvas adopt result feed back, or scope the single-layout prefill to the new tab id as well as null so a later unscoped view of that active tab still applies the pending draft. Do not return `landed` when the adopt was refused and the prefill had no consumer.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

### 1. Moderate — storage warning never reaches the user

- File: `libs/frontend/chat-state/src/lib/workflow-session-index.service.ts:141-146`
- Scenario: `persist` catches a storage throw after `entries.set`. `get` still returns the kind. The next webview load runs `restore` against the previous blob, which does not contain the new entry.
- Impact: the batch-1 rule "storage failure does not lose the in-memory tag" holds. The plan sentence "exposes a nonsecret warning for history-badge persistence" does not: the signal stops at the service.
- Fix: bind `warning` in the sidebar (or the app toast) using the fixed string already in `warn`.

### 2. Moderate — conductor register/unregister is not one id, and the new count makes the mismatch stick

- File: `libs/frontend/tribunal-panel/src/lib/components/conductor-tile.component.ts:227-236` and `libs/frontend/chat-state/src/lib/tab-manager.service.ts:3046-3069`
- Scenario: init id A, later correlation B, plus one session embed of A. Embed cleanup decrements A from 2 to 1. A stays visible with no owner. Destroy then decrements B.
- Impact: live chunks keep flowing for a tab that is off screen, and a still-mounted embed of B can lose its only count when the tribunal page closes.
- Fix: remember the registered id on the conductor instance; unregister that id; register the new id when correlation changes. `unregisterVisibleTab` should keep ignoring ids that were never registered (it already returns when `owners` is missing, line 3059).

### 3. Moderate — `landed` does not mean the grid composer received the draft

- File: `libs/frontend/chat/src/lib/services/workflow-tab-launcher.service.ts:45-59`
- Scenario: grid at the tile cap, `visiblePrompt` set, `firstMessagePreamble` set. Tab and preamble exist. Prefill waits for a `ChatView` whose context signal equals `tabId`. That view is never created. `{ outcome: 'landed' }` is returned.
- Impact: 649's first caller will treat `landed` as "the user can see and edit the seed". On a full grid they cannot.
- Fix: surface adopt refusal as `failed` (tab may already exist; the plan allows an inspectable tab in that case) or apply a pending prefill when the active unscoped composer is that tab.

### 4. Minor — collapsed rail card has no workflow name

- File: `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.ts:104-131` and `:133-137`
- Scenario: rail collapsed, tab has `workflow: 'harness-configure'`. The expanded branch is the only one that mounts `ptah-workflow-badge`. The collapsed button's `aria-label` is title, state, and focus (`:118-120`).
- Impact: a collapsed rail does not say which sessions are workflow sessions. Expanded cards still do. The badge's `absolute bottom-1 left-2 z-10` sits on the card's 22px footer row (todo/git text, not a control). Lane buttons live in the 70px row above that footer (`compact-rail-card.component.ts:86-94` and `:358-370`) and keep `pointer-events: auto`. A click on the badge bubbles to the card host and still calls `openSession` (`canvas-rail-card.component.ts:303-312`). The footer text is covered; the lane controls are not.

## Data flow

1. `WorkflowTabLauncherService.open` validates kind and title. Invalid input throws. Navigation cancel/fail returns and stops. OK.
2. `createTab` then `setWorkflow`. `setWorkflow` writes `TabState.workflow` and `rememberTab` only when a workspace path and SDK session id both exist. A brand-new tab has no session id yet, so the index stays empty until `updateTabInternal` sees `claudeSessionId` or `workflow` (`tab-manager.service.ts:1570-1588`). OK.
3. Optional preamble stored on the tab. First `chat:start` consumes it once (`message-sender.service.ts:420-424`). A failed start does not restore it (pre-existing; not a finding).
4. Grid: `requestCanvasTab(tabId, activeWorkspacePath, title)`. Single: no canvas request. Prefill tab id is `tabId` in grid and `null` in single, matching `TaskPromptBridgeService`. Gap when adopt returns null (finding 3).
5. `SessionEmbedComponent` builds one child injector for the component lifetime. `SESSION_CONTEXT`, `SESSION_VISIBLE`, `SESSION_FOCUSED`, `RAIL_MIN_CONTENT_WIDTH`, and `SURFACE_ACTIVE` are the live signals. `SESSION_START_GUARD` and `SESSION_CARD_ACTIONS` factories return the input's current function or object at first inject, not a snapshot of the guard's string. Canvas passes a stable function that calls `startBlockReason(this.tabId())` (`canvas-detail-transcript.component.ts:61`) and a stable actions object whose methods read `tabId()` at click time (`:62-71`). OK for this host.
6. Registration effect depends on `tabId` and `active` (`parent SURFACE_ACTIVE` and embed `visible`, not `contentVisible`). Cleanup unregisters that same id. Canvas binds pane visibility to `contentVisible` and leaves embed `visible` at its default `true` (`canvas-detail-transcript.component.ts:22-29`), which matches the old injector: register while the parent surface is active, and drive `SESSION_VISIBLE` / `SESSION_FOCUSED` / child `SURFACE_ACTIVE` from parent-active AND pane-visible. OK.
7. Sidebar badge calls `workflowForSession` during the same template pass as `isSessionOpen`, which reads `_tabs()` (`app-shell.component.ts:871-872`, `app-shell.component.html:296-302`). `attachSession` updates `_tabs` before `rememberTab` returns (`tab-manager.service.ts:1531-1578`), so the next change detection sees the new map entry. The map itself is not a signal; a write that touches neither `_tabs` nor `sessions()` would not repaint. No such write exists on the active workspace after startup. OK.
8. Delete from the sidebar and delete-original in chat view call `forgetWorkflowSession` only after the delete RPC succeeds, with the active workspace path. Tab close does not forget. OK.
9. Restore of tabs and of the index both drop unknown kinds before any badge binding. OK.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Unknown stored kind becomes a plain tab / no badge text | COMPLETE | `sanitizeRestoredTab` and `parseEntry` |
| Tag survives save/restore, attach, close/reopen, workspace switch | COMPLETE | Index is separate from tab close; `switchWorkspace` re-remembers |
| Delete clears the index for that workspace | COMPLETE | Both success-only call sites |
| Storage failure keeps the in-memory tag | COMPLETE | Warning is not shown (finding 1) |
| Same chat view inside the embed; canvas guard, lanes, retention, notice stay | COMPLETE | Guard function identity is live |
| Visibility unregisters on hide, tab change, destroy; two hosts | COMPLETE | Embed effect. Conductor is the remaining unbalanced caller (finding 2) |
| Navigation cancel creates no tab | COMPLETE | |
| Single vs grid prefill target | PARTIAL | Targets match the bridge; a refused adopt still returns `landed` (finding 3) |
| Preamble once, seed not logged by the launcher | COMPLETE | Launcher does not log title, prompt, or preamble. Failed-start consume is pre-existing |
| Badges in tab bar, sidebar, rail card, focus header, from a fixed label map | COMPLETE | Collapsed rail omits it (minor) |
| D6 minimal slots | COMPLETE | No addon open/title/dismiss inputs |

Implicit requirements not addressed: the public `warning` signal has no UI consumer.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Empty tab id | YES | Effect returns before register (`session-embed.component.ts:103`) | None |
| Second embed of the same tab unmounts first | YES | Count decrements; set entry remains until the last owner | Conductor orphan can be that last count |
| `unregister` of an id never registered | YES | Return when `owners` is missing (`tab-manager.service.ts:3059`) | Conductor destroy of a new id still hits this only when nobody else registered it |
| Unknown kind, object kind, script-like kind | YES | Dropped before render | None |
| Index over 500 | YES | Oldest map key evicted; restore keeps the last 500 | Same kind does not refresh recency (`workflow-session-index.service.ts:89`) |
| Workspace path null | YES | Remember and get both no-op | Forget with `''` is also a no-op, so it cannot clear a real key |
| `startGuard` / `cardActions` / retention changed after the child is created | YES for canvas | Only host binds stable function, object, and `true` | A later host that replaces the function is stuck with the first inject. No such host in this task |
| Blank title, unknown kind to `open` | YES | Throw, no tab | Callers must catch; see Decisions |
| Collapsed rail | NO | Badge not mounted | Minor |

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Throwing on an invalid `WorkflowTabOpenRequest` is accepted, not a contract defect | Return `{ outcome: 'failed' }`; throw | The plan requires a result for navigation cancel/fail, not for a blank title or a kind that fails `isWorkflowKind`. The launcher spec expects the throw. A 649 caller that passes a bad request has a programming error, and no tab is created | Yes |
| `useFactory: () => this.startGuard()` is not a stale-guard bug for the canvas host | Snapshot the reason string; pass the function | `SessionStartGuard` is `() => string \| null`. The factory returns that function at first inject (after inputs are bound, before `ChatView` calls it). Canvas's function reads `tabId()` and `startBlockReason` on every send. The embed spec's `guard()` expectation passes because the token is the function, not the string `'Wait for capacity'` | Yes |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: a full grid makes `open` report `landed` while the visible prompt never reaches a composer.
- What a robust implementation would add: show `warning` in the sidebar, pair conductor register/unregister on one stored id, and fail or retarget prefill when `adoptTab` returns null.

Scope read in full for behaviour: `session-embed.component.ts`, `workflow-tab-launcher.service.ts`, `workflow-session-index.service.ts`, `workflow-badge.component.ts`, `canvas-detail-transcript.component.ts`, the tab-manager workflow and visible-tab methods, the sidebar delete and badge bindings, chat-view delete-original, the rail card and focus-header badge branches, conductor-tile init/destroy, and the pre-change canvas transcript injector. Specs were used only to see which failures they do not assert.
