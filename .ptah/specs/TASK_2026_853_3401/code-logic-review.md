# Code Logic Review — `TASK_2026_853_3401`

Scope read in full or in the relevant ranges: `apps/ptah-electron/src/windows/display-window.ts`, `window-guards.ts`, the `ipc-bridge.ts` and `ipc-sender-policy.ts` diffs, `activation/bootstrap.ts` diff, `display-window-rpc.handlers.ts`, `display-window-sync.service.ts`, `display-window-state.handler.ts`, `display-window.component.ts`, `display-window.config.ts`, `main.ts` diff, `artifact-message-handler.service.ts`, `artifact.store.ts` diff, `display-dock.state.ts` diff, `display-sidebar-wiring.ts`, the `chat-view.component.ts/.html` diffs, `electron-layout.service.ts` diff, `published-artifact.ts`, and the transcript reply-card wiring. Not read line by line: the spec files, the per-host contract/registration changes (platform-cli, platform-vscode, desktop-only host), `display-window-wire.ts`. No checks were run; I relied on the batch reports for test evidence.

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 1              |
| Moderate issues     | 7              |
| Failure modes found | 9              |

The security-relevant parts hold up: sender trust, the method allowlist, window lifetime and bounds persistence are sound. The weak spot is the dock-to-window sync. Its publish step is gated on `requestAnimationFrame` in the main renderer, which Chromium stops when the main window is minimized or occluded. That is the normal state while someone works in a detached window.

## Five logic questions

### 1. How does this fail silently?

- **Frame-gated publish stalls.** `display-window-sync.service.ts:190-196` calls `scheduleFrame`, and `:62-69` uses `requestAnimationFrame` whenever it exists. The main `BrowserWindow` sets no `backgroundThrottling: false` (`main-window.ts:55-61`). While the main window is minimized, hidden, or covered on Windows or macOS, rAF does not fire. Child actions such as select still reach the dock through IPC, because that path does not use rAF. The echo back to the child never happens, so the window looks dead and no error is shown anywhere.
- **Failed or oversized publish.**
  - A failed RPC clears `lastPublished` (`:213-229`) but schedules no retry. The child keeps its old state until some unrelated dock change happens.
  - An oversized snapshot (`:204-207`) only sets `error`, and that text shows in the main rail. The child shows the old content as if it were current.
- **Dropped actions report success.** `handleMessage` returns silently when `push.tabId` is not the bound tab (`:153-165`). The child's `send()` has already seen `relayed: true` (`display-window.component.ts:150-160`), so it shows no error. `relayAction` returns `bridge.sendToRenderer(...)`, which only says the message was handed over, not that it was applied.
- **Window creation without a document.** `loadFile(...).catch` only logs (`display-window.ts:223-230`). The sender stays trusted and the main renderer believes the panel is detached, with the sidebar already replaced by the rail (`chat-view.component.html` rail branch). The user sees a blank child window.
- **Stale unbound view.** When `source` becomes null (ChatView unmounted) or the tab is null, `publish()` returns early (`:200-201`). The child keeps showing the previous tab's panel, and its actions are dropped as in the case above.

### 2. What user action produces unexpected behaviour?

- Minimize or cover the main window, then click an item in the detached Display window: nothing visibly changes (see above).
- Switch chat tabs in the main window, then click Re-attach in the child before the next republish. The `attach` action carries the old `tabId` and is dropped at `:162-164`. The button does nothing; the child's fallback `displayWindow:close` path is only used when no snapshot exists (`display-window.component.ts:137-146`).
- Publish two artifacts in quick succession. Each `handleMessage` awaits `settings:get` independently (`artifact-message-handler.service.ts:35`), so the older artifact can win `requestAutoOpen` if its read resolves last.
- Publish an artifact while the user is on a non-chat route. The auto-open request is deliberately not replayed (`display-sidebar-wiring.ts` docs, `lastSeq` seeded from the current request). The panel never opens for that artifact, but the card still appears in the reply.

### 3. What input data produces a wrong answer?

- A record whose `sessionId` is not a tab id gets no auto-open, which the plan specifies. The reply card for the same artifact does work.
- A re-publish of the same artifact id with a higher revision re-selects it in an unpinned open dock (`display-dock.state.ts` `requestArtifactAutoOpen`). That can pull the user off the surface they were reading. It is consistent with the stated rules, but it is a behaviour to confirm.
- A publish tool result that is not JSON, or is truncated, gives no card and no log entry (`published-artifact.ts:44-49` returns `null`).
- `revision` in the snapshot is incremented by the sender but never checked by the host or the child. Ordering rests on IPC FIFO only. A main-renderer reload resets the counter to 0 without effect today, but nothing would catch a future reordering.

### 4. What happens when a dependency fails?

- `settings:get` failing or timing out: falls back to the default (on) after up to 5 s (`artifact-message-handler.service.ts:8-9, 48-51`). The open is delayed and then happens even if the user had set it off, because the read failed.
- Child window creation throws: contained, returns `not-ready` (`display-window.ts:197-205`). Good.
- State storage unavailable: bounds are neither read nor saved, with a logged error on a rejected write (`:283-293`). Good.
- Main window closes while the child is open: the child is closed through `main.once('closed')` and the listener is removed when the child closes first (`:211-220`). Good.
- Child renderer crash (`render-process-gone`) is not handled, so there is no recovery path other than the user closing the window.

### 5. What is missing that the requirements never mentioned?

- Nothing tells the child that the main window is hidden or that its snapshot is stale.
- No clearing of the child's content when no tab is bound.
- No handling of `render-process-gone` or `did-fail-load` on the child.
- Maximized state of the child is not persisted, only bounds.
- Pre-existing `clipboard:read-text` and `clipboard:write-text` (`activation/post-window.ts:77-82`) have no sender check. The Display window's preload exposes them too, so a second window now has that reach. This is not new behaviour, but the new window widens it slightly.

## Failure modes

### Publish never fires while the main window is not rendering

- Trigger: main window minimized, hidden, or occluded; user works in the detached window.
- Symptom: selecting, scrolling view state or fullscreen changes in the child never come back; the child looks frozen.
- Evidence: `display-window-sync.service.ts:62-69, 190-196`; no `backgroundThrottling` in `main-window.ts:55-61`.
- Current handling: none.
- Recommendation: do not gate on rAF. Use a timer (about 16 ms; timers are still throttled to 1 s when hidden but do fire), or set `backgroundThrottling: false` on the main window. Keep the "once per frame, only when JSON changed" coalescing.

### Failed publish is not retried

- Trigger: `displayWindow:publishState` rejects or returns `success: false`.
- Symptom: child stays on an older state until another dock change.
- Evidence: `display-window-sync.service.ts:213-229`.
- Current handling: clears `lastPublished` only.
- Recommendation: reschedule once (bounded) after failure, or mark the window as stale and republish on the next frame.

### Oversized snapshot is not visible in the child

- Trigger: view JSON above `DISPLAY_WINDOW_STATE_MAX_BYTES`.
- Symptom: main rail shows an error; child shows old content as current.
- Evidence: `display-window-sync.service.ts:204-207`.
- Recommendation: publish a small "too large" marker state so the child can say so.

### Stale-tab actions are dropped but reported as relayed

- Trigger: the child acts on a snapshot whose `tabId` is no longer the bound tab.
- Symptom: nothing happens, no error; Re-attach can be dead.
- Evidence: `display-window-sync.service.ts:162-164`; `display-window.component.ts:150-160`; `display-window-host relayAction` (`display-window.ts:265-271`).
- Recommendation: always honour `attach` regardless of tab; have the main renderer republish immediately on a dropped action so the child resyncs.

### Child shows a previous tab after the source unbinds

- Trigger: ChatView destroyed (route change) or no active tab while detached.
- Symptom: child keeps displaying and acting on a tab the main window no longer shows.
- Evidence: `display-window-sync.service.ts:111-113, 198-201`; `display-sidebar-wiring.ts` unbind.
- Recommendation: publish an empty or "waiting" state when the view becomes null.

### Auto-open order inversion

- Trigger: two `artifact:published` messages within the settings read latency.
- Symptom: the earlier artifact ends up selected.
- Evidence: `artifact-message-handler.service.ts:34-35`.
- Recommendation: read the setting once up front and cache, or sequence `handleMessage` calls; at minimum apply the request in publish order.

### Blank child window after a failed load or renderer crash

- Trigger: `loadFile` rejects or the renderer process dies.
- Symptom: empty window while the main sidebar is replaced by the rail.
- Evidence: `display-window.ts:223-230`; no `render-process-gone` listener.
- Recommendation: on load failure close the child and report `not-ready`; on crash, send `closed` to the main renderer.

### Delayed auto-open when settings are slow

- Trigger: `settings:get` takes up to 5 s.
- Symptom: the panel opens seconds after the card appears, or after the user disabled the feature if the read finally times out.
- Evidence: `artifact-message-handler.service.ts:9, 41-47`.

### Bounds saved while minimized or maximized

- Trigger: user closes the child while it is minimized or maximized.
- Symptom: Windows reports off-screen bounds for a minimized window; restore falls back to default placement (`usableSavedBounds` filters it). Maximized state is lost.
- Evidence: `display-window.ts:216, 283-293`.
- Current handling: acceptable fallback.

## Blocking issues

None.

## Serious issues

### Detached window updates depend on requestAnimationFrame in the main renderer

- File: `libs/frontend/chat/src/lib/services/display-window/display-window-sync.service.ts:62-69, 190-196`; `apps/ptah-electron/src/windows/main-window.ts:55-61`
- Scenario: the user detaches the panel to a second monitor or minimizes the main window.
- Impact: the child stops reflecting state changes from its own actions and from the agent. This defeats the main use of the feature.
- Fix: schedule with `setTimeout` (or both, whichever fires first) and keep the dedupe by JSON; or disable background throttling on the main window.

## Moderate and minor issues

- Moderate: failed publish has no retry (`display-window-sync.service.ts:213-229`).
- Moderate: oversized snapshot invisible in the child (`:204-207`).
- Moderate: dropped stale-tab actions report `relayed: true` (`:162-164`, `display-window.component.ts:150-160`).
- Moderate: child content not cleared when the source unbinds (`:198-201`).
- Moderate: auto-open order inversion (`artifact-message-handler.service.ts:34-35`).
- Moderate: no `did-fail-load` / `render-process-gone` handling (`display-window.ts:223-230`).
- Moderate: re-publish of a known artifact re-selects it in an unpinned dock and can steal the user's selection (`display-dock.state.ts` `requestArtifactAutoOpen`).
- Minor: `revision` is generated but never checked (`display-window-sync.service.ts:218`).
- Minor: clipboard IPC channels have no sender check (`activation/post-window.ts:77-82`), pre-existing and now reachable from a second window.
- Minor: maximized state of the child is not persisted.
- Minor: a malformed publish result produces no card and no log (`published-artifact.ts:44-49`).

## Data flow

1. Agent calls `ptah_artifact_publish` → `artifact:published` push → `ArtifactMessageHandler.handleMessage` validates with `ArtifactPublishedNotificationSchema`. OK.
2. `store.upsert(record)` always runs, whatever the setting says. OK.
3. `settings:get display.autoOpenArtifacts`, default on, per publish so changes apply live. Gap: timeout delay and order inversion.
4. `requestAutoOpen` → seq-based signal; `wireArtifactAutoOpen` applies each seq once per view and ignores earlier requests. OK. The main view resolves the tab across workspaces; other views only their own tab; an unknown tab does nothing. OK.
5. `dock.requestArtifactAutoOpen` follows the stated open, pin and user-close rules. OK.
6. `DisplayWindowSync.view` computed → effect → rAF → `publish`. Gap: rAF gating and stale-state cases above.
7. `displayWindow:publishState` → strict zod parse, 4 MiB cap → host caches and forwards to the child with `webContents.send`. OK. Child pulls `displayWindow:getState` at boot and ignores older replies (`display-window-state.handler.ts`). OK.
8. Child action → `displayWindow:action` → allowlisted in `IpcBridge`, schema-parsed, `relayAction` → main renderer push → applied only for the bound tab. Gap: silent drop.
9. Child close or main close → `closed` handler untrusts the sender id, clears the snapshot, pushes `displayWindow:closed`. OK. The reopen race is handled by the `this.window !== child` check (`display-window.ts:295-303`).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Artifacts open in Display sidebar on publish | COMPLETE | Order inversion under concurrent publishes |
| `display.autoOpenArtifacts` setting, default on, live | COMPLETE | Read failure opens despite an "off" intent; 5 s delay |
| Open once per request, unknown tab ignored | COMPLETE | Not replayed when ChatView is not mounted (by design) |
| Artifact card in the reply flow | COMPLETE | Appears only when the turn is finalized |
| Sidebar resize persisted | COMPLETE | None found; persisted at drag end, key step and reset only |
| Detach to a separate window without affecting chat | PARTIAL | Stalls when the main window is not rendering; no crash or load-failure recovery |
| Electron child IPC allowlist and sender validation | COMPLETE | Clipboard channels unchanged |
| Window layout persistence | COMPLETE | Maximized state not kept |

Implicit requirements not addressed: staleness indication in the child, recovery from a failed child load, behaviour with the main window hidden.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Open twice | YES | Raises the existing window | None |
| Close then immediately reopen | YES | `this.window !== child` guard | None |
| Main window closes first | YES | `closeWithMain` | None |
| Display window calls a non-allowlisted method | YES | RPC error reply; fire-and-forget and `set-state` refused | None |
| Sender is a subframe or foreign webContents | YES | `isTrustedIpcSender` | None |
| Stored bounds off-screen | YES | `usableSavedBounds` | None |
| Main renderer reload while detached | YES | `displayWindow:status` restore | Child stale until the next publish |
| Main window minimized | NO | rAF stops | Serious issue above |
| Child load failure | NO | Logged only | Blank window |
| Oversized state | PARTIAL | Main-side error only | Child shows stale |
| Two quick publishes | PARTIAL | Last-resolved wins | Order inversion |
| Drag cancelled with Escape or blur | YES | Reverts, no commit | None |

## Verdict

- Recommendation: REVISE
- Confidence: MEDIUM (read-only review, no runtime check; the rAF behaviour follows from Chromium's documented throttling of hidden or occluded pages)
- Top risk: the detached window stops updating when the main window is minimized or covered, because publishing is tied to the main renderer's animation frames.
- What a robust implementation would add:
  - A timer-based, coalesced publish that fires when the main window is hidden.
  - One bounded retry after a failed publish.
  - A visible stale or too-large state in the child.
  - An empty state published when the source unbinds.
  - `attach` honoured regardless of the tab, and a republish after a dropped action.
  - `did-fail-load` and `render-process-gone` handling on the child.
  - Ordered, or once-read, handling of the auto-open setting.
