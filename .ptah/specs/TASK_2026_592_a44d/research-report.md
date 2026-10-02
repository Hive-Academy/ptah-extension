# Research Report - TASK_2026_592

Decision: where and how tab close ends the backend session. Method: read code on main 95cb1de78. Nothing was run; "inferred" marks that.

## Lifecycle summary
- One tab = one `claudeSessionId` (null until the first stream event). One backend `SessionRecord` (one claude.exe) is keyed by tabId, and `find()` resolves by tabId or realSessionId (`session-registry.service.ts:346`).
- `closeTab` (`tab-manager.service.ts:909`) aborts the in-flight controller, unregisters the session, emits `closedTab{tabId,sessionId,kind:'close'}` (`:950`) and removes the tab. The only `chat:abort` is the listener in `message-sender.service.ts:216-237`, and `markTabIdle` deletes the controller at turn end (`:2613`). An idle close therefore sends nothing.
- `chat:abort` is not an interrupt. `abortSession` (`chat-session.service.ts:967`) calls `sdkAdapter.interruptSession` (`sdk-agent-adapter.ts:1337`), which calls `sessionLifecycle.endSession`, then `endRecord` (`session-control.service.ts:211-299`). `endRecord` does permissions cleanup, marks subagents interrupted, runs `query.interrupt()` in a 5 s race, aborts the AbortController and removes the record. The abort is what stops the CLI process (comment at `session-registry.service.ts:607-612`; inferred, not run).
- Workspace switch never touches any of this (Q2).

## Q1 Close paths
| Caller file:line | Kind | End session? | Notes |
|---|---|---|---|
| `tab-bar.component.ts:195` | user close | YES | goes through `closeTab` |
| `keyboard-shortcuts.service.ts:77` | user close | YES | same |
| `canvas.store.ts:243` (`removeTile`, from `canvas-workspace-grid.component.ts:132`) | user close of a tile | YES | the tile is a tab; `closeTab` is awaited so the confirm decides |
| `chat-view.component.ts:1418` (`deleteOriginalSession`, rewind with delete-original) | programmatic, then `deleteSession` | YES | the old session is being deleted; ending first is right |
| `app-shell.component.ts:621` | cleanup after the user deleted a session | YES | the session is deleted; `findTabBySessionId` finds one tab only |
| `tribunal-run.service.ts:207` (`endRun`) | user ends run, closes the conductor tab | YES | the conductor may hold lanes; the user chose to end the run |
| `tribunal-run.service.ts:227` (`rollback` via `forceCloseTab`) | failed launch cleanup | NO as designed | only happens before the first send (inferred); recheck |
| `app-shell.component.ts:423` (`openInEditor`, `forceCloseTab`) | pop-out transfer (VS Code only) | NO | the panel re-attaches (`:866-870`) |
| `closeOtherTabs` `:2351`, `closeTabsToRight` `:2380` | dead | n/a | zero non-spec callers. They do `_tabs.set(...)` with no abort, no `closedTab`, no unregister. Delete them or route them through the same path. Only `tab-manager.lifecycle.spec.ts:395-425` calls them |
| `duplicateTab` `:2324` | n/a | n/a | no UI caller; it would create a same-session twin |
| `electron-layout.service.ts:334-413` + `tab-workspace-partition.service.ts:373` | workspace folder removal | see Q2 | `removeWorkspaceState` deletes the partition and localStorage with no `closedTab` |
| `harness-workflow.service.ts:427`, `apps-session-rpc.ts:30`, `conversation.service.ts:229` | own `chat:abort` stop paths | no change | not tab close |

## Q2 Workspace switching
- Tabs are partitioned per workspace in `TabWorkspacePartitionService._workspaceTabSets`; `switchWorkspace` (`tab-workspace-partition.service.ts:168-202`) only swaps the `_tabs` signal. Background tabs stay in the map and keep receiving stream events (`updateBackgroundTab`). The coordinator's switch fan-out (`workspace-coordinator.service.ts:131-216`) never calls `closeTab`, `forceCloseTab` or `chat:abort`. A `closedTab` hook therefore cannot end other projects' sessions on a switch.
- Folder removal today: `removeFolder` (`electron-layout.service.ts:334`) confirms and sends `chat:abort` only for tabs with `status==='streaming'` (`workspace-coordinator.service.ts:307-314`). Then `workspace:removeFolder` (`workspace-rpc.handlers.ts:260-305`) ends no sessions, and `removeWorkspaceState` drops every tab with no event. Idle tabs of a removed workspace leak a claude.exe, the same bug.
- Recommendation: this is removal, not switching, and the tab state is destroyed (localStorage key removed, `:397`). End every session of the removed workspace (all `claudeSessionId`s, not only streaming). Keep the confirm prompt for streaming only. Do it in `ElectronLayoutService.removeFolder` next to the existing abort loop, by widening the coordinator method (for example `getSessionIds`). The user can still resume from disk.

## Q3 Shared sessions
- Within a workspace one session maps to one tab: `openSessionTab` (`:762`) dedups. Canvas tiles are tabs, so a duplicate needs `duplicateTab`, which is dead code. `findTabsBySessionId` (`:485`) is the plural lookup for tiles.
- VS Code: the sidebar and each editor panel are separate webviews with separate `TabManagerService` instances and localStorage keys (`ptahConfig.panelId`, `:564-576`). The frontend cannot see across them. `openFullPanel` is a VS Code command only; Electron has a single main window (`main-window.ts:115`).
- Guard in the close handler, after the tab is already removed (effects run after `closeTab` returns): `tabManager.findTabBySessionId(sid) == null`. It scans the active tabs, then all background partitions (`:450-461`, partition `:236-279`). For a cross-webview twin, accept the residual risk: ending is recoverable because the next send to an inactive session auto-resumes (`autoResumeIfInactive`, `chat-session.service.ts:~1311`).

## Q4 Backend end contract
- No `session:end` or `chat:end` RPC exists (grep over `libs`). `SdkAgentAdapter.endSession` (`:801`) is void and fire-and-forget, and is only used by gateway, Ptah CLI and memory-curator.
- On an idle session `chat:abort` finds the record. The streaming-input query is alive, so `interrupt()` returns fast (an interrupt on an idle process is expected to be quick; inferred), capped at 5 s. Then it aborts and removes the record. With no record, `endSession` returns `'already-ended'` (`session-control.service.ts:162-167`) and the RPC still returns success.
- Return: `{success, resumableSubagents?}`. Only `ConversationService.abortCurrentMessage` acts on it (`conversation.service.ts:264-279`). The backend persists it itself via `saveResumeState` (`chat-session.service.ts:992`). The close path can ignore the return, and tab state is gone anyway.
- Side effect to know: `abortSession` always calls `saveResumeState(sessionId, {resumableSdkSubagents: []})` when there is nothing resumable. For an idle close this may overwrite a list saved by an earlier interrupt (`session-metadata-store.ts:587-612`; whether it overwrites or merges was not checked).
- Nothing the user needs is lost: the transcript is on disk and `chat:resume` / `--resume` rebuilds the session.
- Recommendation: reuse `chat:abort`. It is registered and allowed (`rpc.types.ts:700,3567`) and needs no backend or contract change. A new RPC would only be warranted to avoid the `saveResumeState` overwrite. Add an optional param to `chat:abort` only if tests show the overwrite matters (see Unknowns).

## Q5 Background work
- The turn-end snapshot lives on the tab: `pendingBackgroundTasks` and `pendingSessionCrons`, with statuses `awaiting-background` and `sleeping` (`tab-bar.component.ts:114-123`, `turn-end-handler.service.ts:104-125`). These mean "agent idle, session live".
- `closeTab` confirms only for `isDirty`, `streaming` or `resuming` (`:916-917`). Add `awaiting-background` and `sleeping` to the confirm: the tab already announces live background work and its own indicator, and a silent kill breaks the user's expectation.
- CLI lanes: `LaneCompletionNotifier` delivers only if `isSessionActive(parent)`. Otherwise it returns `parent-session-not-active` and the poll-based `ptah_agent_read` path remains (`lane-completion-notifier.service.ts:177-181`). Ending the parent loses only the push-back, not the lane output.
- Resumable-subagents: `saveResumeState` keeps only `interrupted`, non-background, non-CLI subagents (`:603-611`). Background and CLI agents are not resumable; ending the session kills them (`markAllInterrupted`). This matches today's mid-stream close.
- Behaviour: end after the confirm (or immediately when the tab is idle and has no pending tasks or crons). Tribunal and harness conductor tabs are hidden (`claims.surfaceFor`), not user-closed, except through `endRun`.

## Q6 Same-tab replacement
- `/clear`: `chat:complete{command:'clear'}` makes the frontend call `resetTabToFresh` (`chat-message-handler.service.ts:321`). The backend slash query does its own unconditional `endSession`, and the `chat-session.service.ts:1296-1349` comments say it ends the dead record first (inferred, not run). The `reset` event has `sessionId` but a streaming-only abort.
- Rewind: `rebindTabSession` (`:2127`) then `switchSession(newId,{activate:true})`, whose `chat:resume` carries the same `tabId` (`session-loader.service.ts:693-703`). Registration under the same tabId runs `displaceExisting` (`session-registry.service.ts:619-645`), which aborts the old query's controller. This covers rewind and `/clear` when the next message or resume registers. The gap is only "never sends or activation fails" (the old process lingers until tab close, which then targets the new id).
- Do not end the old session in `rebindTabSession`. The fork reads the transcript from disk and the old session may be deleted-original or kept by the user.
- A `kind:'reset'` end is optional. If added, only when `sessionId` is non-null. Safe (the tab state is already wiped), but it duplicates the slash-query teardown, so leave it out in v1.

## Q7 VS Code vs Electron
Both host the same `ptah-extension-webview` bundle (`apps/ptah-electron/project.json:7,278`), so TabManager, MessageSender and the router are shared. Differences: pop-out is VS Code only, and folder removal (`ElectronLayoutService`) is Electron only. Panel dispose in VS Code (`angular-webview.provider.ts:170`) closes the webview, not the tabs, so sessions there are not ended (out of scope).

## Q8 Tests
Pin `closeTab`: `tab-manager.lifecycle.spec.ts:105-140,395-425`, `tab-manager.service.spec.ts` (7 refs), `canvas/orchestra-canvas.component.spec.ts`, `tribunal-run.service.spec.ts` (8), `transcript-retention.service.spec.ts`, `stream-router.service.spec.ts` (7), `message-sender.service.spec.ts:946,1038`, `conversation.service.spec.ts` (13), `electron-layout` spec. Backend: `session-control.service.spec.ts` (asserted call order) and `session-registry*.spec.ts`. No e2e test for tab close was found in this tree.

## Recommended design
1. Add a small chat-lib service (it has `ClaudeRpcService`; `chat-state` must stay RPC-free) that effects on `tabManager.closedTab()`.
2. Fire only when `kind==='close'`, `sessionId` is a real id, `tabManager.findTabBySessionId(sid)==null` (after removal) and no streaming abort was just dispatched for that tab. The streaming abort already sent `chat:abort`, and a second one risks overwriting its `saveResumeState`. Capture "was streaming" in the handler, or have `abortStreamingForTab` return a boolean.
3. Call `claudeRpc.call('chat:abort',{sessionId})` fire-and-forget, with `.catch` and `console.warn`. Never await it in `closeTab`.
4. Never act on `forceClose` or `reset`, and never on workspace switch.
5. Extend `closeTab`'s confirm to `awaiting-background` and `sleeping`.
6. Extend folder removal (Q2) to idle sessions.
7. Handle the dead code (`closeOtherTabs`, `closeTabsToRight`): delete, or loop `closeTab`.

## Risks and tests
- `closedTab` is a single-value signal, so two same-tick closes can coalesce in the effect. This is real: the existing consumers share it. Current callers await each close, so one per tick. Add a test for sequential closes, or use an event array.
- Double end on a streaming close: test that exactly one `chat:abort` is sent.
- Tests: unit for the new service (idle close sends one RPC; forceClose, reset and shared session send none; null sessionId none; the RPC rejecting does not throw); a `closeTab` confirm test for `awaiting-background`; a coordinator test that all session ids come back; a workspace-switch test that no `chat:abort` or `closedTab` fires. A backend test for `chat:abort` on an idle record (end, registry empty) would be new.

## Follow-ups (out of scope)
App-quit disposal and crash orphans; a backend idle reaper (`evictStale` skips live queries, `session-registry.service.ts:578`); VS Code panel-dispose session end; merge-versus-overwrite in `saveResumeState`.

## Unknowns
- Whether `saveResumeState([])` overwrites an earlier non-empty list. Smallest experiment: read `session-metadata-store.ts:612+` and unit test an interrupt followed by an idle abort.
- Real idle-interrupt latency and whether claude.exe exits on abort. Smallest experiment: close an idle tab in dev and watch the process list.
- Whether `tribunal rollback` can follow a first send. Smallest experiment: trace `tribunal-run.service.ts` launch order.
