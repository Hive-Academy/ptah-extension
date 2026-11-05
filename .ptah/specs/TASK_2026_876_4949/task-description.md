# Requirements - TASK_2026_876_4949

## Summary

After `ptah_session_handoff` succeeds, the session that handed off stays where
it already is in the session list and on the canvas rail, and it keeps its
history. Once that session's current turn has finished — the handoff tool
result has to come back first, and the stream has to flush that turn's last
chunks — the host stops that session's SDK process. Existing status
derivation then stops showing it as Running or as Background work. Nothing
in this task moves it, indents it, or labels it Handed off.

The durable link uses both sessions' SDK ids, written when the new session's
real id is known. The expanded stats sidebar, in the chat view and on the
canvas inspector dock, gains a Linked sessions section that lists the whole
handoff chain. Each other entry opens that session. That section is the only
new place the chain appears.

A handoff that fails or times out leaves the caller running, with its lanes
and child sessions given back, as it does today. A start that finishes after
the 30s deadline does not record a handoff and does not stop the caller.

## Current behavior

`SessionHandoffService.handoff` (`libs/backend/cli-agent-runtime/src/lib/session-children/session-handoff.service.ts:135-145`)
guards the caller and asks the chat host to start an ordinary top-level
session. The file header states the caller is not stopped (`session-handoff.service.ts:11-15`).

The new session is opened here:

- `SessionHandoffService.guardAndStart` mints the successor's tab id with
  `SessionId.create()` before the start is awaited
  (`session-handoff.service.ts:205-213`). That id is a placeholder. It is not
  the SDK session id.
- `SessionHandoffService.start` builds a `SessionHandoffOpenedPayload`
  (`tabId`, `fromTabId`, `fromSessionId`, `workspaceRoot`, `cwd`, `label`,
  `displayPrompt`, `startedAt`) and calls
  `IChildChatSessionHost.startHandoffSession`
  (`session-handoff.service.ts:255-328`). `fromSessionId` is the caller's SDK
  id (`record.realSessionId`, `session-handoff.service.ts:270`). The port is
  `child-chat-session-host.port.ts:38-71`.
- This worktree has one implementation of that port:
  `ChildChatSessionHostAdapter.startHandoffSession`
  (`libs/backend/rpc-handlers/src/lib/chat/session/child-chat-session-host.adapter.ts:139-188`).
  The `result.success` return is at `168`; the method continues through the
  failure path to `188`. It is registered as
  `CLI_AGENT_RUNTIME_TOKENS.CHILD_CHAT_SESSION_HOST` by `registerChatServices`
  (`libs/backend/rpc-handlers/src/lib/chat/di.ts:125-126`). Electron calls that
  from `apps/ptah-electron/src/di/phase-4-handlers.ts:96`. The CLI container
  calls it from `libs/backend/cli-engine/src/lib/container.ts:975`. No second,
  host-specific `startHandoffSession` was found.
- The adapter announces `sessionHandoff:opened` before
  `ChatSessionService.startHandoffSession` launches the SDK session
  (`child-chat-session-host.adapter.ts:142-167`,
  `chat-session.service.ts:1372-1446`). `{ success: true }` is returned at
  `1424`, as soon as `launchSdkSession` is awaited. The successor's canonical
  SDK id does not exist yet.
- That id arrives later. A new session is tracked by its tab id until the
  Claude CLI emits `system: 'init'` (`sdk-agent-adapter.ts:1087-1112`).
  `createSessionIdCallback` (`sdk-agent-adapter.ts:1635-1721`) writes
  `SessionMetadata` under `realSessionId` and then
  `sessionIdResolvedRegistry.notifyAll({ tabId, realSessionId, ... })`
  (`sdk-agent-adapter.ts:1708-1720`). `SessionSpawnerService` listens on that
  registry (`session-spawner.service.ts:226-229`) and only then binds
  `tabId → realSessionId` and writes durable lineage
  (`session-spawner.service.ts:863-909`). Handoff does not listen.
- The webview handler is `ChatMessageHandler` (`chat-message-handler.service.ts:76`).
  The `SESSION_HANDOFF_OPENED` switch arm is at `257-259`.
  `handleSessionHandoffOpened` is at `269-280`. It parses the payload
  (`agent-session-adoption.service.ts:97-125`) and adopts a tab.
  `TabManagerService.adoptHandoffTab` inserts that tab after the source and
  focuses it only when the source is active
  (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:1256-1286`).
  `buildHandoffTab` (`tab-manager.service.ts:1412-1433`) does not store
  `fromTabId` or `fromSessionId` on the tab.

Before the start is awaited, `adoptWork` (`session-handoff.service.ts:351-387`)
moves the caller's running CLI lanes (`AgentProcessManager.adoptLanes`,
`agent-process-manager.service.ts:2093-2118`) and live child sessions onto the
new tab id. `settleAdoption` (`session-handoff.service.ts:396-427`) keeps that
move only when the start succeeds. A timeout (`SESSION_HANDOFF_START_TIMEOUT_MS`,
30s, `session-handoff.service.ts:61` and `224-235`) or a failed start reverts
the move and returns `session-start-failed`. The in-flight `start()` is not
cancelled. When it later sees `outcome.started`, it still calls `remember`
(`session-handoff.service.ts:309-312`) even if `guardAndStart` already
returned the timeout refusal. The comment at `228-230` says a late success
adopts nothing; it does not stop `remember`.

The only durable-looking memory of a handoff is an in-process map, keyed by
the caller's tab id, capped at 64, holding the successor tab id and the
caller's SDK id (`session-handoff.service.ts:91-100`, `489-509`). It is
dropped on restart. It never stores the successor's SDK id.

`SessionMetadata.sessionId` is the SDK uuid from `system: 'init'`
(`libs/backend/agent-sdk/src/lib/session-metadata-store.ts:421-512`, field at
`433-437`). The interface has no handoff fields. `StoredOrganization.sessionId`
and `ISessionOrganizationRecorder` are also SDK uuids, never tab ids
(`session-organization.store.ts:108-116`,
`session-organization-recorder.interface.ts:8-15`). The recorder is optional
and is absent on VS Code. Organization persists `parentSessionId` and
`forkOfSessionId` for TASK_2026_580, not a handoff chain.
`session:list` builds rows from metadata `sessionId`
(`session-rpc.handlers.ts:558-592`). `livePhase` on that row is the in-memory
turn phase (`session-rpc.handlers.ts:558`), not a stored Handed off flag.

Why the old session still looks live after a handoff that does not stop it,
and why a stop alone can leave it looking live:

- The handoff tool runs inside the caller's turn. The tool reply is built in
  `sessionHandoffReply` and returned from the tool handler
  (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tool-handlers.ts:321-354`,
  `442-456`). Until that turn ends, the source tab stays `streaming`.
- The canvas rail treats `streaming` or `resuming` as Running, and a card
  whose lanes or background tasks are still running as Background work
  (`compact-session-card.component.ts:583-598`). `railStateValue` returns
  `background` when `laneSummary().counts.running > 0` or
  `hasRunningBackgroundTask()` (`593-594`). Those lanes come from
  `agentsOwnedBySession`, which keeps an agent only when `parentSessionId`
  equals that session (`compact-session-card.component.ts:313-322`,
  `agent-monitor.store.ts:1190-1192`).
- The running cap counts a tab whose turn is in flight, or a running agent
  whose `parentSessionId` equals that tab's SDK id
  (`canvas-running-cap.ts:33-61`).
- `adoptLanes` rewrites `parentSessionId` only inside `AgentProcessManager`
  (`agent-process-manager.service.ts:2105-2109`).
  `agent-monitor-message-handler.service.ts` does not mention
  `parentSessionId`. The webview store is not updated, so a lane can keep
  painting the old session as Background work, and can stay missing from the
  successor, after the backend has moved it. The same parent test keeps the
  old session in the running cap.
- The sessions list dot prefers `SessionLivenessRegistry`, then the row's
  `livePhase` (`session-live-phase-indicator.component.ts:47-74`, `125-130`).
  Registry `streaming` is the pulsing Running dot. `awaiting-background` is
  the moon icon, labeled "Waiting on background work" (`47-52`). The row
  phase `generating` is Running, and `awaiting-background` or `sleeping` is
  the same moon (`60-68`). `SessionLivenessRegistry` treats both
  `streaming` and `awaiting-background` as live
  (`session-liveness.registry.ts:9-12`).
- `settleTurn` sets `awaiting-background` when the Stop snapshot still lists
  background tasks (`session-turn-state.registry.ts:352-368`). The Stop hook
  only snapshots. The SDK runs that hook before the consumer has pulled the
  final assistant message (`session-turn-state.registry.ts:41-48`,
  `stop-hook-handler.ts:87-113`). `SessionLifecycleNotifier.handleTurnEnded`
  broadcasts that hook as `session:turnEnded`
  (`session-lifecycle-notifier.ts:116-141`). The phase flip is `settleTurn`
  on the stream `result`. `markTurnEnded` runs from `releaseTurnOnResult` /
  `onTurnTerminal` on that same `result`
  (`sdk-agent-adapter.ts:1133`, `2302-2310`,
  `session-lifecycle-manager.ts:716-723`).
- `ChatStreamBroadcaster` flushes before `chat:complete` on
  `message_complete` (`chat-stream-broadcaster.service.ts:286-303`). On a
  stream error it flushes, then `forceIdle` with `aborted_streaming` when the
  phase is not already `failed` (`chat-stream-broadcaster.service.ts:343-351`).
  `endSession` aborts `rec.abortController`
  (`session-control.service.ts:296-300`) and marks running subagents
  interrupted (`session-control.service.ts:303-307`,
  `session-lifecycle-manager.ts:726-736`). Calling that from the Stop hook
  cuts the stream before those flushes.
- On loop exit the broadcaster calls `forceIdle` only when the phase is still
  `generating` (`chat-stream-broadcaster.service.ts:387-389`).
  `ChatMessageHandler.handleSessionEnded` (`chat-message-handler.service.ts:750-758`)
  retires prompts and clears background tasks. It does not call
  `liveness.markIdle`. A stopped caller can keep the moon icon, and
  `session:list` can still expose `awaiting-background` from the turn-state
  registry.

A small status fix is required so the stop actually clears Running. It is
not an ordering change. `groupRailTiles` already buckets by the live state
above (`canvas-rail-grouping.util.ts:12-25`, `58-74`). Once the predecessor's
turn is idle and its adopted lanes no longer count toward it, that card
falls into the same bucket any other stopped session already uses. This task
does not add a bucket, an exception, or a pin under the successor.

How a session is stopped today:

- `ptah_session_stop` stops a child session the caller supervises
  (`session-tool-handlers.ts:295-311`, `442-447`). It is not the path that
  ends the handing-off chat.
- Closing a tab sends `chat:abort`
  (`closed-tab-session-ender.service.ts:12-29`, `49-64`). `abortSession`
  interrupts the SDK session and keeps resume state
  (`chat-session.service.ts:2115-2166`). It does not delete the transcript.
- `interruptCurrentTurn` (`session-lifecycle-manager.ts:697-713`) stops the
  turn and leaves the session usable. `markTurnEnded`
  (`session-lifecycle-manager.ts:716-723`) records that the streaming pump's
  turn finished. It is not `session:turnEnded`.
- Automatic budget handoff can close the source tab after the turn leaves
  `streaming`, `resuming`, or `switching`, and only when
  `closeSourceAfterAutoHandoff` is on
  (`auto-handoff-source-closer.service.ts:17-28`, `36-63`, `121-134`). A
  manual handoff does not arm that closer. History is not deleted on that
  path (`auto-handoff-source-closer.service.ts:59-62`).

Session list and canvas rail, left as they are:

- The previous-sessions modal defaults grouping to none, and forces `none`
  when `organizationAvailable()` is false
  (`previous-sessions-modal.component.ts:216-222`). That flag is false on VS
  Code (`session-list-view.store.ts:30-34`).
- `groupSessionRows` indents only for `groupBy === 'parent'`
  (`session-row-groups.ts:44-62`, `90-126`). `applySessionListQuery` keeps a
  parent next to its children only for `groupBy: 'parent'`
  (`session-list-query.ts:73-91`, `147-153`). The row indent is
  `session-list-row.component.ts:151-154` and `333-334`.
- The canvas rail does not nest. It buckets by live state
  (`canvas-rail-grouping.util.ts:58-74`, `canvas-rail.component.ts:245-269`).
- Supervised children (`SessionChildRegistry`) are a different relationship:
  a child is refused from handing off
  (`session-handoff.service.ts:167-174`).
- Workflow statuses are only `active`, `waiting`, `in_review`, `done`, and
  `archived` (`session-organization.types.ts:23-31`). None is Handed off.

The stats sidebar is `ptah-session-inspector`
(`session-inspector.component.ts:53-64`). One component serves the chat view
(docked or sheet) and the canvas rail aside. The canvas host is
`ptah-canvas-inspector-dock`: the 14px rail is `presentation="rail"`
(`canvas-inspector-dock.component.ts:125-136`), the expanded dock is
`presentation="embedded"` (`193-208`), and the compact sheet is
`presentation="sheet"` (`239-254`). The expanded body renders
`ptah-inspector-session-stats` with `data-testid="inspector-session-stats"`
and `aria-label="Session statistics"`
(`inspector-session-stats.component.ts:39-48`,
`session-inspector.component.html:162-182`). The compact inspector is a 14px
rail of metric buttons (`session-inspector.component.html:1-72`) and has no
section list. The success tool text still tells the user to close the old
session (`session-tool-handlers.ts:333-346`). The skill says the same
(`plugins/ptah-core/skills/session-handoff/SKILL.md`).

`ptah_code_search_symbols` returned an empty index (symbol count 0) on the
original pass and again on this revision. `ptah_ast_analyze` and
`ptah_search_files` located the handoff files on the original pass. This
revision checked the running-status lines with Read and one Grep after that
empty index: `railStateValue`, `agentsOwnedBySession`, `adoptLanes`,
`settleTurn`, `handleSessionEnded`, and `fromLiveness` / `fromTurnPhase`.

## Classification

- Type: FEATURE — stop the handed-off session after its turn, and add a
  sidebar section. Matches `task.md`.
- Estimate: M — stop timing, a restart-safe chain keyed by SDK ids, the
  running-status derivation, and the inspector, on the shared webview. List
  and rail layout are out. The earlier L estimate included that layout.
- Priority: not defined here.

## In scope

- Successful `ptah_session_handoff` only: after the caller's current turn has
  ended on the stream-result boundary below, stop that caller's SDK session
  and keep the session and its history. It stays in the previous-sessions
  list and, when its card is open, on the canvas rail, in the place the
  existing sort and the existing live-state buckets already give a stopped
  session.
- Clear the Running and Background-work signals on that stopped caller,
  including when adopted lanes or a Stop snapshot of background tasks would
  still point at it. That is a derivation fix (lane parent in the webview
  store, turn phase, liveness). It is not a new label and not a new group.
- A restart-safe handoff chain covering every hop. Both ends of a stored link
  are SDK `realSessionId`s. The successor's id is written when
  `SessionIdResolvedCallbackRegistry` reports it for the successor tab, not
  when `handoff()` returns the placeholder tab id. The chain is readable for
  any session in the chain, including on a host with no
  `SessionOrganizationStore` (VS Code). The session list row shape does not
  gain handoff fields for this.
- If the successor ends without an init id, the caller is still stopped after
  a successful handoff's turn terminates, and no durable chain row is written.
- A Linked sessions section on the expanded stats sidebar only. That sidebar
  is `ptah-session-inspector` in the chat view and inside
  `ptah-canvas-inspector-dock` (embedded dock and compact sheet). The section
  lists the full chain, marks the session on screen as this session, and
  opens any other entry. Direction copy is continued from and continued in.
- After a kept adoption, the webview `AgentMonitorStore` shows those lanes
  and child sessions on the successor and not on the predecessor, including
  the running cap and the inspector AGENTS section.
- After the caller is stopped, its live phase is idle. That includes clearing
  `awaiting-background` left by adopted background work.
- The handoff tool's success text, and the session-handoff skill text that
  repeats it, so they agree that the old session was stopped and kept. They
  do not tell the user to close it.
- Electron first. The shared webview is the VS Code UI for this. The CLI
  host must keep booting and must not throw if a handoff cannot show a tree.

## Out of scope

- Changing who may hand off, the handoff-file check, the 30s start deadline,
  lane adoption, or child-session adoption. Those stay as they are. A session
  the host still opens after that deadline is not cancelled by this task. It
  is not recorded as a handoff.
- Deleting a session, its transcript, its metadata row, or its organization
  row. Removing the session from the previous-sessions list.
- `ptah_session_stop` as the way to stop the handing-off chat. That tool
  stops a supervised child.
- The automatic budget closer and `closeSourceAfterAutoHandoff`. When that
  setting closes the source tab, this task does not turn that close into a
  delete.
- A new workflow-status value in `SESSION_WORKFLOW_STATUSES`.
- Making `parentSessionId` mean "handed off", or treating the predecessor as
  a `SessionChildRegistry` child. Re-parenting an adopted lane onto the
  successor is in scope. Re-parenting the predecessor session is not.
- CLI tree UI or a CLI inspector. The CLI has neither.
- A VS Code-only host adapter. None exists in this worktree; the shared
  adapter is the one both desktop hosts use.
- User scope change 2026-11-04: any change to the session list
  (previous-sessions), the canvas rail, nesting, grouping, or ordering. No
  Handed off row, card, label, indent, or sr-only label on either surface.
  No `groupBy` rule for handoff (`none`, `parent`, `status`, or `task`). No
  use of `nestByParent`, `MAX_SESSION_ROW_DEPTH`, or the row indent for a
  handoff. No predecessor-not-loaded fallback that still shows Handed off at
  the top of the list. No attaching an open predecessor card under its
  successor, inside the successor's rail group or any other group. No new
  rail bucket and no handoff exception in chip counts or the running cap.
  The cap changes only because adopted lanes no longer name the predecessor
  as `parentSessionId`. No persisted Handed off marker whose job is to paint
  the list or the rail. The compact 14px inspector rail does not grow a
  chain list. Linked sessions is not added to the session list.

## Acceptance criteria

1. When `ptah_session_handoff` returns success, the system shall deliver that
   tool result to the caller before it stops the caller. The caller stays
   able to finish that turn, including the final assistant message and the
   terminal stats for that turn.
2. When that successful handoff's turn then terminates, the system shall stop
   the caller's SDK session only after the stream has flushed that turn's
   terminal chunks. The trigger is the stream `result` boundary
   (`markTurnEnded` / `settleTurn`) followed by the broadcaster flush
   (`message_complete` / `chat:complete`, or the error path's flush and
   terminal turn state). The system shall not stop from `session:turnEnded`
   or from any other Stop-hook listener. The same stop shall run when that
   turn terminates by failure or error after the tool already returned
   success. The previous-sessions list shall still contain that session, its
   transcript shall still open, and no delete of the session record shall
   run. The stop shall not abort the caller's stream before that flush.
3. When the caller's SDK session has been stopped after that handoff, the
   existing Running indicator shall be clear. The canvas rail shall not show
   that session as Running because of the ended turn, and shall not show it
   as Running or Background work because of a lane or child session the new
   session adopted. The sessions-list live dot shall not show Running or
   Waiting on background work for that session. Its liveness shall be idle
   for both the tab id and the SDK id, including when the Stop snapshot had
   listed background tasks. The row and the card shall then follow the same
   place and the same live-state bucket a session that simply stopped
   already uses. They shall gain no Handed off label, indent, or sr-only
   text, and they shall not be moved under the successor. A derivation fix
   is in scope because the stop by itself does not clear those signals:
   `railStateValue` is `background` while `laneSummary().counts.running > 0`
   (`compact-session-card.component.ts:583-594`), that count is
   `agentsOwnedBySession` matching `parentSessionId`
   (`agent-monitor.store.ts:1190-1192`), `adoptLanes` rewrites the parent
   only in the process manager
   (`agent-process-manager.service.ts:2105-2109`), the running cap uses the
   same parent test (`canvas-running-cap.ts:46-50`), and `settleTurn` leaves
   `awaiting-background` when the snapshot still lists background tasks
   (`session-turn-state.registry.ts:362-365`), which the list dot renders
   (`session-live-phase-indicator.component.ts:47-68`).
   `handleSessionEnded` does not call `markIdle`
   (`chat-message-handler.service.ts:750-758`). The fix updates attribution
   and phase. It does not change `groupRailTiles`, `groupSessionRows`, or
   `applySessionListQuery`.
4. When a lane or child session was adopted and the adoption was kept, the
   system shall leave that lane process and that child session running under
   the new session. Stopping the caller shall not stop them, and shall not
   mark them interrupted. `AgentMonitorStore` shall attribute those adopted
   lanes to the successor, so the successor's running cap and inspector
   AGENTS section include them, and the predecessor's do not. When the
   successor's `realSessionId` resolves, that attribution shall follow the
   resolved id, the same way other tab-id liveness aliases do.
5. When the handoff times out, the host reports that the new session did not
   start, or the tool returns any refusal, the system shall not stop the
   caller. Lanes and child sessions moved provisionally shall go back to the
   caller, as they do today. If `start()` still resolves after that 30s
   deadline, the system shall not call `remember`, shall not persist a
   handoff chain, and shall not arm the caller stop. A later `realSessionId`
   for that late session shall not record the chain either.
6. When the user opens the expanded session inspector on any session in a
   handoff chain, the system shall show a section named Linked sessions in
   the stats area. Expanded means the chat-view docked body, the chat-view
   sheet, the canvas dock (`presentation="embedded"`), and the canvas
   compact sheet (`presentation="sheet"`). The section shall list every
   session in that chain, including the session on screen. The session on
   screen shall be marked as this session and shall not be labeled continued
   from or continued in. Each earlier session shall say this session
   continued from it. Each later session shall say this session continued in
   it. Activating another entry shall open that session. Activating the
   current entry shall leave the open session in place. The section shall
   not appear on the session list or the canvas rail.
7. When the open session has no handoff link, the Linked sessions section
   shall be absent. The compact 14px inspector rail (`presentation="rail"`)
   shall not grow a list and shall not overflow.
8. When the app restarts, the Linked sessions section for a session in a
   chain shall show the same sessions, the same current mark, and the same
   continued-from / continued-in direction as before the restart. The stored
   keys shall be the SDK `realSessionId`s. This shall hold on Electron and
   on the VS Code host, where `SessionOrganizationStore` is absent. Restart
   shall not add a Handed off label to the list or the rail.
9. When a chain is A → B → C, the section on A, on B, and on C shall list
   A, B, and C. On B, A is continued from, B is this session, and C is
   continued in. A later successful handoff from C to D shall include D on
   every session in that chain, once D's `realSessionId` is stored.
10. When the handoff succeeds, the tool result and the session-handoff skill
    shall not tell the user to close the old session. They shall say that
    the old session was stopped and that its history was kept. They shall
    not describe a list or rail label this task does not add.
11. When the CLI host (`platform-cli` / `cli-engine`) handles a handoff
    refusal or a successful handoff with no webview, the system shall not
    throw, and the CLI process shall keep running. The CLI gains no session
    tree and no inspector section. A chain stored for a CLI handoff shall
    use the same real-id rule, or shall be skipped when the CLI has no
    session row, without throwing.
12. When a new message, RPC payload, or stored handoff record crosses a
    boundary, the system shall reject a malformed value with the existing
    refusal or drop path and shall not cast it. New code shall typecheck
    with strict TypeScript and shall not use `any`.
13. When `ptah_session_handoff` returns success, the system shall keep an
    in-memory binding from the successor tab id to the caller's
    `realSessionId`. The system shall write the durable chain link only when
    `SessionIdResolvedCallbackRegistry` reports that tab's `realSessionId`.
    Both stored ends shall be SDK ids. The system shall not write the link
    under the successor tab id into `SessionMetadataStore`,
    `SessionOrganizationStore`, or `session:list`. Until the successor id is
    stored, Linked sessions shall stay absent. If the successor session ends
    with no `realSessionId`, the system shall not write the link and shall
    not invent a successor row. The caller is still stopped under criterion
    2. No Handed off marker is stored for the list or the rail.

## Non-functional constraints

- Electron is the first host to satisfy the criteria. The shared webview is
  what the VS Code host renders; a change that satisfies Electron and breaks
  the VS Code webview fails the task. The chain must persist where VS Code
  already stores session metadata. It must not require SQLite organization.
- `platform-cli` and `cli-engine` have no session tree and no inspector.
  They must still compose and must tolerate the new stored fields.
- Sessions are not deleted. History stays openable.
- The session list and the canvas rail keep their current ordering,
  grouping, and labels. Stopping a session may change which existing
  live-state bucket its card is in, because that bucket is already derived
  from Running versus stopped. This task adds no other placement rule.
- New code is strict TypeScript. No `any`, `@ts-ignore`, or `as unknown as`.
  New tool, IPC, RPC, and stored payloads are parsed with Zod at the
  boundary.
- Logging uses the injected logger. A stop failure is logged with a real
  `Error` and does not report the caller as stopped when the stop failed.
- No new latency number. The stop waits for the turn's stream-result flush.
  It does not add a second deadline that stops the caller. The existing 30s
  start deadline is unchanged.
- The Linked sessions section uses the inspector's existing type, focus,
  and contrast patterns. The visual spec for that section is a design-gate
  input, not a layout invented here. It does not specify list or rail chrome.

## Stakeholders

| Stakeholder | What they need from this change | How they will judge it |
| ----------- | ------------------------------- | ---------------------- |
| Person handing off a chat | The old session stops looking live, stays where a stopped session already sits, and the sidebar shows the chain | Criteria 2, 3, 6, 8 |
| Person opening a session after restart | The chain is still in the stats sidebar, on Electron and VS Code, and the list has no new label | Criteria 8, 9, 13 |
| Reviewer | Each criterion is visible in the product or in a focused test | Criteria 1-13 |
| CLI user | A handoff on the CLI does not crash the process | Criterion 11 |

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| Stopping the caller inside `handoff()` or before the tool result is written drops the result and can kill the turn that is delivering it | HIGH | HIGH | Stop only after that turn's tool result has been returned and the stream has flushed the terminal chunks. Criterion 1 and criterion 2. Owner: the implementation that schedules the stop. |
| Stopping from `session:turnEnded` (the Stop hook) aborts `rec.abortController` before the final assistant message, `SESSION_STATS`, and the terminal turn-state chunk are flushed. The broadcaster then records `aborted_streaming` | HIGH | HIGH | Do not listen to the Stop hook for this stop. Wait for `markTurnEnded` / `settleTurn` and the broadcaster's terminal flush, including the failure path. Criterion 2. Owner: the stop scheduler. |
| `endSession` marks running subagents of that session interrupted (`session-lifecycle-manager.ts:731-733`, `session-control.service.ts:303-307`). Adopted lanes still share process history with the caller | HIGH | HIGH | The stop path shall target the caller's SDK session only. Adopted lane ids and reparented child ids are excluded. The webview store re-parents them onto the successor. Criteria 3 and 4. Owner: the stop implementation, with a test that a kept lane is still running afterward and shows on the successor. |
| The 30s start timeout returns while `start()` may still complete and call `remember` (`session-handoff.service.ts:224-235`, `309-312`). A late success would persist a chain and could arm a stop the tool already refused | HIGH | HIGH | Arm the stop, `remember`, and the durable chain only for the success result that was returned to the tool. A late `start()` sees that the deadline already won and writes nothing. Criterion 5. Owner: the handoff service change. |
| Writing the chain at `handoff()` return uses the successor tab id. `session:list` and the metadata store key by the SDK id created at `init`. The link would never match | HIGH | HIGH | Bind on `SessionIdResolvedCallbackRegistry`, the way `SessionSpawnerService.onSessionIdResolved` does. Criterion 13. Owner: the handoff persistence change. |
| The webview agent store can keep a lane parented to the old session after `adoptLanes` rewrites the backend. The predecessor then stays Background work, and the successor's cap and AGENTS section stay empty | MEDIUM | MEDIUM | Re-parent the adopted lanes in `AgentMonitorStore` to the successor, and rekey that parent when the successor's real id arrives. Criterion 4. Owner: the webview monitor change. |
| `settleTurn` can leave `awaiting-background`, and `handleSessionEnded` does not mark the session idle, so the moon icon and the list dot survive the stop | MEDIUM | MEDIUM | The stop path marks the caller idle in the turn-state registry and in `SessionLivenessRegistry` for the tab id and the SDK id. Criterion 3. Owner: the liveness change. |
| `AutoHandoffSourceCloserService` may close the source tab when the budget setting is on. A second stop or a tab close must not delete the session | MEDIUM | MEDIUM | This task does not change that setting. Whatever close it performs stays the existing non-deleting close. The chain remains. Owner: the handoff stop path. |
| Reusing `organization.parentSessionId` would make the predecessor look like a supervised child, which `ptah_session_handoff` refuses and `ptah_session_stop` stops. Storing the chain only there also drops it on VS Code | MEDIUM | HIGH | The chain is not a `SessionChildRegistry` membership and is not `parentSessionId`. It is stored where session metadata already exists on both hosts. See Decisions. Owner: the architect. |
| A turn that never ends never reaches the stop. The old session stays live | LOW | MEDIUM | No extra timer stops the caller. The session stays as it is until the turn ends or the user stops it. Owner: the stop scheduler. |

## Affected files map

Backend

- `libs/backend/cli-agent-runtime/src/lib/session-children/session-handoff.service.ts` — success path, `remember`, the 30s race. Stop is not armed here today.
- `libs/backend/cli-agent-runtime/src/lib/session-children/child-chat-session-host.port.ts` — `startHandoffSession` port.
- `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts` — `onSessionIdResolved` is the bind pattern. Handoff must not register the predecessor as one of its children.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts` — `adoptLanes` / `settleLaneAdoption`. The webview does not see this parent rewrite today.
- `libs/backend/rpc-handlers/src/lib/chat/session/child-chat-session-host.adapter.ts` — the one host adapter (`139-188`).
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts` — `startHandoffSession` (`1372-1446`), `abortSession`.
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` — init callback, `releaseTurnOnResult`.
- `libs/backend/agent-sdk/src/lib/helpers/session-id-resolved-callback-registry.ts` — the resolve signal the chain waits on.
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts` — `endSession`, `interruptCurrentTurn`, `markTurnEnded`.
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.ts` — `endSession` aborts the controller.
- `libs/backend/agent-sdk/src/lib/helpers/stop-hook-handler.ts` — Stop hook emits `turnEnded` before the result is consumed. Not the stop trigger.
- `libs/backend/agent-sdk/src/lib/helpers/session-turn-state.registry.ts` — snapshot vs `settleTurn`, including `awaiting-background`. The stopped caller must end idle.
- `libs/backend/rpc-handlers/src/lib/handlers/session-lifecycle-notifier.ts` — `session:turnEnded` from the Stop hook.
- `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts` — terminal flush, `forceIdle`, `session:ended`.
- `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts` — `chat:abort`.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tool-handlers.ts` — handoff reply text.
- `libs/backend/agent-sdk/src/lib/session-metadata-store.ts` — session rows keyed by SDK id; no handoff fields today. The host-neutral place a chain can survive without SQLite organization.
- `libs/backend/session-organization/src/lib/session-organization.store.ts` — durable organization; parent and fork only. Optional. Not the only store for this chain, and not a nesting source for this task.
- `libs/backend/platform-core/src/interfaces/session-organization-recorder.interface.ts` — SDK ids only; absent on VS Code.
- `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts` — `session:list` already exposes `livePhase` from turn state. Do not change row order or add a handoff field to the row. A chain read for the inspector is separate.
- `libs/backend/cli-engine/src/lib/container.ts` — CLI composition must still boot.
- `plugins/ptah-core/skills/session-handoff/SKILL.md` — user-facing close instruction.

Shared

- `libs/shared/src/lib/types/messages/session-handoff.ts` — `SessionHandoffOpenedPayload`.
- `libs/shared/src/lib/types/messages/message-constants.ts` — `sessionHandoff:opened`.
- `libs/shared/src/lib/types/session-organization.types.ts` — workflow statuses and `parentSessionId`. Do not add a status and do not overload `parentSessionId`.
- `libs/shared/src/lib/types/execution/node.ts` — `ChatSessionSummary`. The list row shape stays as it is. The chain is not carried by adding a handoff field to that row.

Frontend

- `libs/frontend/chat-state/src/lib/tab-manager.service.ts` — `adoptHandoffTab`, `buildHandoffTab`. Tab order rules stay as they are.
- `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts` — `ChatMessageHandler.handleSessionHandoffOpened` (`269-280`) and `handleSessionEnded` (`750-758`).
- `libs/frontend/chat/src/lib/services/agent-session-adoption.service.ts` — payload parse.
- `libs/frontend/chat/src/lib/services/agent-monitor-message-handler.service.ts` — webview lane events. No parent rewrite today.
- `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts` — `parentSessionId`, `agentsOwnedBySession`. This is the attribution fix for criterion 3.
- `libs/frontend/chat/src/lib/services/auto-handoff-source-closer.service.ts` — existing auto close; do not retarget it.
- `libs/frontend/chat/src/lib/services/closed-tab-session-ender.service.ts` — tab close ends the SDK session.
- `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts` — `railStateValue` already derives Running and Background. Change it only if attribution and phase still leave a stopped caller in those states. Do not add a label or a nest.
- `libs/frontend/canvas/src/lib/canvas-running-cap.ts` — existing parent test. Do not add a handoff exception. Re-parenting is what drops the predecessor.
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-inspector-dock.component.ts` — hosts the inspector as rail, embedded dock, and sheet. The chain section is on the expanded presentations only.
- `libs/frontend/chat/src/lib/components/atoms/session-organization-chips/session-live-phase-indicator.component.ts` — Running dot and moon icon. Consumers of liveness and `livePhase`. No new label.
- `libs/frontend/chat-state/src/lib/session-liveness.registry.ts` — liveness that wins over `livePhase`; `awaiting-background` is live. The stopped caller must be idle on both ids.
- `libs/frontend/chat/src/lib/components/organisms/session-inspector/session-inspector.component.html` — stats sidebar body and the 14px rail.
- `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-session-stats.component.ts` — session statistics section. Linked sessions sits with this block.

Not in this map, because user scope change 2026-11-04 leaves them unchanged:
`session-list-query.ts`, `session-row-groups.ts`,
`previous-sessions-modal.component.ts`, `session-list-view.store.ts`,
`session-list-row.component.ts`, `canvas-rail-grouping.util.ts`,
`canvas-rail.component.ts`.

## Decisions

1. Stop only after the successful handoff's own turn has flushed on the stream `result` boundary.
   Options: stop inside `handoff()` before return; stop on `session:turnEnded` (the Stop hook); stop after `markTurnEnded` / `settleTurn` and the broadcaster's terminal flush, including a turn that fails after the tool succeeded.
   Evidence: the tool result is the return value of the tool handler (`session-tool-handlers.ts:450-456`), and the user required that result to return first (`context.md`, the 2026-11-04 answer, still in force for the stop). The Stop hook runs before the consumer pulls the final assistant message (`session-turn-state.registry.ts:41-48`). `endSession` aborts the controller (`session-control.service.ts:299`). `markTurnEnded` is the pump's result boundary (`session-lifecycle-manager.ts:716-723`), and the broadcaster flushes before `chat:complete` (`chat-stream-broadcaster.service.ts:286-303`).
   Reversible: yes, until a release depends on the timing.

2. Timeout and failure do not stop the caller, and a late `start()` records nothing.
   Options: stop whenever a handoff was attempted; let a late `start()` call `remember` and arm the stop; ignore every write from a start whose deadline already answered the tool.
   Evidence: a timeout reverts adoption and tells the caller the session may still open late (`session-handoff.service.ts:228-235`), then `start()` still calls `remember` when `outcome.started` (`309-312`). Cancelling that late session is out of scope.
   Reversible: yes.

3. The chain is stored on the host under SDK `realSessionId`s, written when the successor id resolves. It is not a list-row field and not a supervised-child membership.
   Options: keep the in-memory map; store the successor tab id at `handoff()` return; persist both directions only after `SessionIdResolvedCallbackRegistry` reports the successor's `realSessionId`.
   Evidence: the map is capped at 64, dies on restart, and stores the successor tab id (`session-handoff.service.ts:91-100`, `502-509`). Metadata and `session:list` key by the SDK id (`session-metadata-store.ts:433-437`, `session-rpc.handlers.ts:558-592`). The spawner already waits for the registry before writing lineage (`session-spawner.service.ts:863-870`). Organization SQLite is absent on VS Code (`session-organization-recorder.interface.ts:12-15`), so the chain cannot live only there. Child sessions are refused from handing off (`session-handoff.service.ts:167-174`). The caller's SDK id is already known at handoff return (`session-handoff.service.ts:270`).
   Reversible: yes, with a migration if the column or key is renamed.

4. Linked sessions is a section of the expanded inspector only, titled Linked sessions, placed with the session statistics block. The 14px rail is unchanged. The session list and the canvas rail do not get the section, a Handed off label, or a nest.
   Options: show the chain in the list and under the new session on the rail; show it in the list as tiles and in the sidebar; show it only in the expanded inspector.
   Evidence: `context.md` scope change and `decisions.md` decision 9 (user, 2026-11-04). The stats surface is one component (`session-inspector.component.ts:53-56`) hosted by the chat view and by the canvas dock (`canvas-inspector-dock.component.ts:125-136`, `193-208`, `239-254`). The rail presentation is 14px of metric buttons (`session-inspector.component.html:1-72`).
   Reversible: yes. The visual spec can move the section within the expanded inspector. Putting it back on the list or the rail needs a new user decision.

5. The tool reply and the skill stop telling the user to close the session. They say the old session was stopped and kept. They do not name a Handed off chrome label.
   Options: leave the close instruction; say the session was stopped and kept.
   Evidence: `sessionHandoffReply` says "ask them to close this session" (`session-tool-handlers.ts:333-334`). The user still wants the session kept (`context.md`). The same scope change forbids a Handed off label on the list and the rail.
   Reversible: yes.

6. The open session is a current entry in its own Linked sessions list, marked as this session. Direction labels apply only to the other entries.
   Options: omit the open session; label it continued from and continued in; list it and mark it as this session.
   Evidence: the user asked for the full chain on the stats sidebar (`context.md`, decision 9). An entry cannot be both continued from and continued in for the session on screen.
   Reversible: yes.

7. A successor that never receives a `realSessionId` does not get a durable chain row. The caller is still stopped if the tool succeeded and the turn terminated. No Handed off marker is written in that gap.
   Options: persist the successor tab id anyway; wait to stop the caller until init; stop the caller and skip the durable link when init never arrives.
   Evidence: there is no metadata row to join until init (`sdk-agent-adapter.ts:1692-1720`). The stop is tied to a successful handoff, which returns before init (`chat-session.service.ts:1408-1424`).
   Reversible: yes, until stored rows exist.

8. Running clears through the existing status derivation. Adopted lanes are attributed to the successor so the predecessor is not Background work and is not a running-cap key. The list and the rail are not reordered to express the handoff.
   Options: add a Handed off group or pin the card under the successor; leave adopted lanes painting the predecessor; re-parent lanes and set the caller idle, then let the existing buckets apply.
   Evidence: `railStateValue` and the list dot are derived (`compact-session-card.component.ts:583-594`, `session-live-phase-indicator.component.ts:125-130`). `adoptLanes` does not update the webview store (`agent-process-manager.service.ts:2105-2109`, `agent-monitor.store.ts:1190-1192`). `decisions.md` decision 9 forbids list and rail ordering changes and still requires the old session to stop showing Running.
   Reversible: yes. It is attribution and phase, not a stored display order.

## Handoff

- Next specialist: software-architect.
- Why: the stop has to be scheduled against the stream-result flush, the chain has to be stored under SDK ids when the successor resolves without becoming a supervised child, and the running signals have to follow that stop without a list or rail layout change. The file layout is that specialist's call.
- The Linked sessions section is new UI on a Full feature. A ui-ux-designer pass on the expanded inspector is required before the section is built. This description does not specify spacing, color, or component structure. That pass does not cover the session list or the canvas rail.

## Review responses

Items 1-7 record the Gate 1 / Gate 1.7 revision. Where they required list or
rail nesting, a Handed off label, `groupBy` indent, or a missing-successor
fallback in the list, the scope change log supersedes them.

1. Fixed. Current behavior (placeholder tab id, init callback, store keys), criterion 13 (was 15), decision 3 (was 5), decision 7 (was 11), and the successor-id risk.
2. Fixed. Criterion 2, risk row for the Stop hook, and decision 1. Failure after a successful tool result is included.
3. Fixed. Criterion 5, the late-`start()` risk, and decision 2. `remember`, the chain, and the stop stay disarmed when the deadline already won.
4. Superseded for layout. The `groupBy` indent, A → B → C list depth, rail attachment, chip-count exclusion, and the missing-successor Handed off fallback are out of scope (user scope change 2026-11-04). Criterion 3 keeps the "not Running" outcome through the stop and the derivation fix.
5. Fixed. Criterion 3 requires idle, including clearing `awaiting-background`. Criterion 4 requires `AgentMonitorStore` re-parenting onto the successor, including the running cap and AGENTS. Current behavior cites `handleSessionEnded` and `agentsOwnedBySession`.
6. Fixed for the inspector. Criterion 6 marks the open session as this session and names the canvas embedded dock and compact sheet. Decisions 4 and 6. The 14px rail stays without the list (criterion 7). The section is not added to the list or the rail.
7. Fixed. Citations for `ChatMessageHandler` (`76`, switch `257-259`, handler `269-280`), the adapter method (`139-188`), `ChatSessionService.startHandoffSession` (`1372-1446`), `SessionMetadata` (`421-512`), and the full `session-list-query.ts` path. The list-query path stays evidence that this task does not change it.

## Scope change log

User scope change 2026-11-04 (`context.md` "Scope change", `decisions.md` decision 9). Supersedes the nesting half of the earlier user answer and of `decisions.md` decision 2. The stop, the chain, the stats sidebar, the tool text, and the CLI constraint stay.

Removed from acceptance criteria, then renumbered:

- Former criterion 6. Nest the stopped session one level under its immediate successor in the previous-sessions list, with the visible label Handed off, for `groupBy` `none` and `parent`, including after restart. A → B → C depth. In `status` or `task`, keep the row in its group at depth 0 and still show Handed off. On the canvas rail, sit the open predecessor card under the open successor, inside the successor's group, show Handed off, and drop it from chip counts and the running cap. A chain of open cards stacks inside the newest session's group.
- Former criterion 7. When the loaded page has no immediate successor, or the successor has no `realSessionId`, keep the predecessor visible at the top level and still show Handed off.
- Former criterion 5, the clause that a late `start()` shall not mark the caller Handed off. The late start still must not stop the caller or record a chain (criterion 5).
- Former criterion 11, the sentence that tree placement follows the immediate-successor rule. The chain contents stay (criterion 9).
- Former criterion 15, the Handed off marker stored when the caller stops, the rule that the list does not nest until the successor id exists, and the rule that a missing init leaves the caller at the top level with Handed off. The real-id write stays (criterion 13).

Removed from in scope:

- Show Handed off and nest under the new session in the canvas rail and the previous-sessions list.
- Attach the open rail cards by tab id while the successor's real id is pending.
- Nest in the previous-sessions list only once both real ids are on the loaded page.

Removed decisions (old numbers):

- 3. Nest under the immediate successor using a separate link rendered with the existing indent.
- 4. Persist a Handed off marker that the row and the card render as those words, distinct from workflow status.
- 8. Indent in `groupBy` `none` and `parent`; leave `status` and `task` unindented; cap drawn depth at `MAX_SESSION_ROW_DEPTH`.
- 9. Attach an open handed-off card under its open successor inside that successor's rail group, and do not count it.

Removed risk:

- Nesting only in `groupBy: 'parent'` hides the tree; nesting inside `status` or `task` pulls a row out of its group; a Finished card sits apart from its Running successor. Mitigation was to nest in `none` and `parent` and to pin the rail card. Withdrawn with the layout.

Removed from the affected-files map (now listed as unchanged):

- `session-list-query.ts`, `session-row-groups.ts`, `previous-sessions-modal.component.ts`, `session-list-view.store.ts`, `session-list-row.component.ts`, `canvas-rail-grouping.util.ts`, `canvas-rail.component.ts`.

Kept on purpose:

- Criterion 3, rewritten. The stopped session must not show Running or Background work. The reason a derivation fix remains is cited at `compact-session-card.component.ts:583-594`, `agent-monitor.store.ts:1190-1192`, `agent-process-manager.service.ts:2105-2109`, `canvas-running-cap.ts:46-50`, `session-turn-state.registry.ts:362-365`, `session-live-phase-indicator.component.ts:47-68`, and `chat-message-handler.service.ts:750-758`.
- Stop after the stream-result flush, adopted work keeps running, failed and late handoffs do not stop the caller, the chain is keyed by the resolved SDK id, the expanded inspector shows the full chain, tool and skill text, and the CLI host must not break.
