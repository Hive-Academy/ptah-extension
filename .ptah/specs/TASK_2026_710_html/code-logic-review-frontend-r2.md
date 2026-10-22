# Code logic re-review — `TASK_2026_710` frontend (round 2)

Read-only. Source was not modified. Jest was not re-run. `ptah_*` review tools were not connected (`search_tool` returned no `ptah_*` schemas; the connected MCP server is `tasks`). Evidence is the current uncommitted source, the original `code-logic-review-frontend.md`, and `revise-1-r3-report.md`. Host list handling was read only to check the session id the store now sends (`artifact-rpc.handlers.ts:43-60`).

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Verdict | APPROVED |
| Blocking issues | 0 |
| New defects | 4, all non-blocking |
| Original blocking defect | FIXED |

This is a 7, not an 8: one live frame is now real, and the two serious silent-success paths (wrong strip item, invisible open-link) now surface an alert, but `lastError` is one global flag, Escape still collapses the sheet when focus is outside the dialog, and a complete publish whose output is not JSON still draws nothing. It is not a 5–6: the blocking multi-frame path is gone in the template conditions below, and those alerts are in the open sheet.

## Original defects

| Original defect | Status | Evidence |
| --- | --- | --- |
| More than one live iframe while the sheet is open | FIXED | `display-panel.component.ts:243-250` creates `ptah-artifact-viewer` only when `item.key === activeKey() && open()`. Inactive artifact pills keep an empty `[hidden]` tabpanel (`228`). |
| Collapsed sheet keeps frames and `message` listeners | FIXED | `display-sheet.component.ts:83` renders the region and the panel only while `state().open`. Collapse destroys the panel, which runs `ArtifactViewerComponent.ngOnDestroy` (`artifact-viewer.component.ts:272-279`). `DisplayDockState.close` also clears the fullscreen request (`display-dock.state.ts:193-194`). |
| Escape on the viewer Full screen control also collapses the sheet | FIXED | Capture listener on the dialog calls `preventDefault` and `stopPropagation` (`artifact-viewer.component.ts:181-183`, `262-270`, `289-293`). The sheet ignores Escape whose target is inside `[role="dialog"]`, and ignores `defaultPrevented` (`display-sheet.component.ts:189-194`). Specs dispatch Escape on the toggle and on a dialog inside the region. |
| Card Open of an id missing from this tab shows another strip item | FIXED | `missingArtifact` is true when the selected key is `artifact:` and absent from `items` (`display-panel.component.ts:368-371`). `activeKey` then returns null (`380`) instead of `items[0]`. Alerts at `164` and `221`. |
| `artifacts:openLink` failure is console-only | FIXED | `display-sheet.component.ts:213-222` sets "Could not open the link." unless `result.success && result.data?.opened === true`. The alert is inside the open region (`86`). The viewer still never calls `window.open` (`artifact-viewer.component.ts:383-385`). |
| `artifacts:list` `{}` fills the tab from the wrong session | FIXED | `artifact.store.ts:20-21` reloads `TabManagerService.activeTabId()`, and `52` sends `{ sessionId }`. Rows whose `sessionId` differs are dropped (`66-69`). The sheet reads `records()[this.tabId()]` (`display-sheet.component.ts:122-124`). `resolvedTabId` is the routing tab id (`chat-view.component.ts:747-749`). The host resolves that id and lists `session.tabId` (`artifact-rpc.handlers.ts:51-60`). |
| Card "Full screen" only changes sheet height | FIXED | `tool-call-item.component.ts:176-182` opens the artifact, calls `requestFullscreenArtifact`, and sets sheet mode `full`. The panel binds `[fullscreen]="fullscreenArtifactId() === item.artifact.id"` (`display-panel.component.ts:246`). Exit emits false and the sheet clears the request (`display-sheet.component.ts:200-202`). |
| Complete publish with no store row renders nothing | PARTIAL | A parsed `id` with no `recordById` hit renders the title and "Not loaded yet" (`tool-call-item.component.ts:105-109`, `155-174`). A complete, non-error publish whose output is neither a JSON string nor a `content[]` text part still returns null (`163-169`) and renders nothing. Error and in-progress rows stay hidden (`157`). |
| A theme value longer than 200 characters drops the whole theme post | FIXED | `artifact-theme-bridge.service.ts:134-136` copies only values with length `<= 200`, then parses (`145-146`). An empty `vars` object still matches `z.record` (`artifact.schemas.ts:76-85`). |
| `contentWindow` null on `load` leaves a blank 160px frame | FIXED | `artifact-viewer.component.ts:307-310` sets `loadFailed` and returns before `attach`. The template then shows the error alert (`94-102`). |
| Load timeout has no retry | FIXED | Timeout still sets `loadFailed` (`326-333`). The alert's Retry button calls `resetFrame` (`101`, `299`), which clears the flag and arms the timeout again (`315-324`). |
| List RPC or invalid list payload is console-only | PARTIAL | Failure sets `lastError` to "Unable to load artifacts." and leaves existing rows (`artifact.store.ts:53-60`, `71-74`). The open sheet shows it (`display-sheet.component.ts:87`). The flag is global; see new defect 1. |
| Invalid `artifact:published` is console-only | NOT FIXED | `artifact-message-handler.service.ts:14-16` still warns and returns. No store flag, no sheet alert. |
| Dialog does not trap focus or mark the rest of the sheet inert | NOT FIXED | `artifact-viewer.component.ts:104-112` sets `role="dialog"` and `aria-modal` while fullscreen is on. No focus trap and no `inert` on the sheet. See the Escape limit under question 2. |
| Session buckets are never dropped when a chat tab closes | NOT FIXED | `forgetTab` clears the dock fullscreen request (`display-dock.state.ts:156-161`) and does not touch `ArtifactStore.records`. Cap remains 200 (`artifact.store.ts:7`, `87-89`). |
| Merge never removes an id the server no longer returns | NOT FIXED | `artifact.store.ts:82-86` only replaces an id when `revision >=` the stored row. A successful empty or smaller list keeps the old ids and clears `lastError` (`64-69`). |

## New defects

1. **Non-blocking.** `ArtifactStore.lastError` is one signal for every tab (`artifact.store.ts:16`, `53-64`, `71-74`). `reload` does not remember which request is current. Failure scenario: tab A's list fails and sets the error; tab B's later success runs `lastError.set(null)` while A's rows were never refreshed. The sheet that is open shows whichever write finished last (`display-sheet.component.ts:87`), so B can display A's error, or A can lose the error after B succeeds. Rows stay in the correct bucket (`66-69`); the banner is what moves.

2. **Non-blocking.** Card Full screen leaves the sheet in height mode `full` after the viewer dialog closes. `tool-call-item.component.ts:180-182` sets the mode. `display-sheet.component.ts:200-202` clears the artifact request only when the viewer emits false, and does not return the mode to `peek`. Failure scenario: the user exits the dialog with Escape or "Exit full screen" and the transcript stays covered by the expanded sheet until they press Reduce or Collapse.

3. **Non-blocking.** `linkError` is not keyed by tab. `display-sheet.component.ts:149-150` and `203-206` hold one string and clear it after 5 seconds. The tab-change effect (`158-178`) resets the pulse only. One `ptah-display-sheet` swaps `tabId` (`chat-view.component.html:227-228`, `chat-view.component.ts:747-749`). Failure scenario: a failed open on tab A is still painted on tab B for the rest of that 5 seconds.

4. **Non-blocking.** The typed list contract still takes no fields. `rpc.types.ts:784` declares `artifacts:list` params as `Record<string, never>`, while `artifact.store.ts:52` passes `{ sessionId }` and `ArtifactListRequestSchema` requires that field (`artifact.schemas.ts:68-70`). `ClaudeRpcService.call` forwards the object it is given (`claude-rpc.service.ts:129-133`); it does not drop `sessionId`. Failure scenario: the store file does not typecheck against the registry. The runtime call still sends the id, which is why defect "list {}" is FIXED. A later edit that passes `{}` to satisfy the registry makes the host throw `INVALID_PARAMS` (`artifact-rpc.handlers.ts:44-46`) and the sheet shows the load error with no new rows.

No new blocking defect. Sandbox remains the literal `allow-scripts` (`artifact-viewer.component.ts:146`). `src` is still bypassed only after `VIEWER_URL_PATTERN` (`38`, `206-209`). Incoming messages still require `event.source`, `ArtifactPageToHostMessageSchema`, and the current nonce (`372-378`).

## Five logic questions

1. **Silent success.** A list failure now sets `lastError`, and an open-link failure now sets `linkError`, but only inside the open sheet (`display-sheet.component.ts:83-87`). A collapsed sheet and the "Not loaded yet" card (`tool-call-item.component.ts:105-109`) do not say why the row is missing. An invalid `artifact:published` still stops at `console.warn` (`artifact-message-handler.service.ts:14-16`). A successful list that omits an id keeps the old card (`artifact.store.ts:82-86`) and clears the error (`64`).

2. **User action.** Escape whose target is inside the dialog closes fullscreen and leaves the sheet open (`artifact-viewer.component.ts:289-293`, `display-sheet.component.ts:191`). Escape whose target is a strip pill or the sheet bar does not go through that capture listener. The bar handler collapses the sheet (`183-184`). The region handler collapses it for any target that is not inside `[role="dialog"]` (`189-194`). Tab can move focus there because the dialog does not trap it (`104-112`). Card Full screen also leaves focus on the card; a collapsed tool row does not stop Escape (`tool-call-item.component.ts:247-254`), and the document listener then exits fullscreen without stopping the event (`artifact-viewer.component.ts:286-288`). If the agents overlay is open, `ChatViewComponent.onEscapeKey` (`chat-view.component.ts:503-508`) closes that overlay on the same key.

3. **Wrong answer from input.** A complete publish with an unparsed result still looks like a non-artifact (`tool-call-item.component.ts:163-169`). `recordById` still searches every bucket (`artifact.store.ts:35-40`). Open on the active tab then hits the missing-artifact alert when that id is not in `records[tabId]` (`display-panel.component.ts:368-380`). The user sees the failure. Theme values over 200 characters are omitted; other tokens still post (`artifact-theme-bridge.service.ts:134-151`).

4. **Dependency failure.** List RPC `success: false`, an invalid payload, a throw, or the 30s RPC timeout (`claude-rpc.service.ts:154-164`) set `lastError` and keep the previous bucket. A later reload for another tab can clear that flag (new defect 1). `openLink` rejection and `opened !== true` show the link alert (`display-sheet.component.ts:216-221`). A null `contentWindow` and a 10s load both reach the Retry alert (`artifact-viewer.component.ts:307-333`).

5. **Unspecified.** Still absent: a focus trap, dropping session buckets on tab close, deleting ids the list no longer returns, a visible error for a rejected publish notification, and a list retry that does not require changing `activeTabId`. `reload` runs only from the active-tab effect (`artifact.store.ts:19-22`). A canvas sheet uses `SESSION_CONTEXT` as `tabId` (`chat-view.component.ts:747-749`). Whether selecting a tile updates `activeTabId` was not traced; if it does not, that tile's bucket is filled only by notifications until the tab is the active one.

## Decisions

- Verdict is APPROVED. Options were REVISE on the remaining Escape path, or APPROVE because the original blocking bar was multiple live frames and that path is closed. Evidence: one viewer at `display-panel.component.ts:244`, panel unmounted at `display-sheet.component.ts:83`. The Escape remainder needs a focus trap; it does not mount a second frame. Reversible.
- The stale `RpcMethodRegistry` entry is non-blocking. Options were to treat the type error as blocking, or to judge the runtime call. Evidence: `call` sends the argument object unchanged, and the host schema reads `sessionId`. Reversible by updating the registry type.

## Unknowns

- R3's Jest counts (chat-ui 41, chat 47) were not re-executed here.
- No browser pass. Clipping of `position: fixed` fullscreen inside the sheet's `overflow-hidden` region was not measured.
- Canvas tile versus `activeTabId`, as in question 5.
- `DisplayDockState` methods other than fullscreen, `openArtifact`, `close`, and `forgetTab` were not re-read.

## Verdict

APPROVED. Top remaining risk: `lastError` and `linkError` are not per tab, and Escape outside the dialog still collapses the sheet while the overlay is up.
