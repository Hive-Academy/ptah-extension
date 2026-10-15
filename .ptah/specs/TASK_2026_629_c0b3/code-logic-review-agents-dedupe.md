# Code Logic Review - Agents dedupe and sub-agent click (decision 112)

Review family: Claude; implementer family: codex

Task: TASK_2026_629_c0b3. Reviewer: code-logic-reviewer (read-only on source and specs).
Paths below are relative to `libs/frontend/` unless stated.

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Verdict | REVISE (NEEDS_REVISION) |
| Blocking issues | 0 |
| Serious issues | 2 |
| Moderate issues | 2 |
| Minor issues | 3 |
| Failure modes found | 5 |

Part A (dock Agents removal) is clean and complete. Part B fixes the Rail tile click correctly. Two gaps remain: the
"Workflow launched" chip is a dead button in every Electron host (it may be the user's actual click), and the single
chat view in Electron now has no surface at all for CLI agents or their permission requests. Neither is covered by a spec.

### Checks run (lock, from W, one at a time, filtered)

| Label | Project / spec | Result |
| --- | --- | --- |
| dedupe-rev-1 | chat / display-dock.component.spec.ts | 1 suite, 14 passed |
| dedupe-rev-2 | chat / chat-view.dock.spec.ts | 1 suite, 23 passed |
| dedupe-rev-3 | canvas / canvas-detail-transcript.component.spec.ts | 1 suite, 10 passed |

No typecheck, lint or wider suite was run (CLAUDE.md STRICT). `ptah_get_diagnostics` was not used because the writer
reported the TypeScript pass exceeds the tool window; types were checked by reading (see finding 6).

## Five logic questions

### 1. How does this fail silently?

- Workflow chip: the button still renders ("Agents", `workflow-card.component.ts:56-66`, `title="Watch this workflow in
  the Agents panel"`) and calls `store.requestPanelOpen(...)` (`:108-110`). In Electron the only consumer, the
  ChatView effect at `templates/chat-view.component.ts:1352` (`if (this.dockEnabled) return;`), now ignores it. Click
  produces nothing, no notice, no focus change. This is the textbook "success-looking" dead control.
- Rail sub-agent tile whose lane does not exist yet or is not in the monitor store (restored history, record not yet
  registered): `CanvasDetailService.open` (`canvas/.../canvas-detail.service.ts:42-48`) sets lane `sub:x`, then
  `CanvasLaneTabs.selectedKey` (`canvas-lane-tabs.component.ts:164-171`) falls back to `orchestrator` and the effect at
  `:174-175` emits `laneSelected('orchestrator')`, which resets the lane. The user sees a focus change and no execution,
  with no message. The single chat path, by contrast, announces "This agent is not available in this conversation"
  (`chat-transcript.component.ts:~770`). Pre-existing, but it is exactly the user's complaint ("doesn't show its
  execution").
- Electron single chat: a CLI agent that asks for permission is no longer shown anywhere (finding 2).

### 2. What user action produces unexpected behaviour?

- Click "Agents" on a "Workflow launched" chip in Electron: nothing happens (finding 1).
- Click a sub-agent tile in a non-active split pane: `open` -> `store.focusTile(tabId)` -> board effect
  (`canvas-rail-board.component.ts:~373-378`) swaps the panes and the lane opens in the now-active pane. Verified by
  reading; correct and consistent with decisions 82/85.
- Running a CLI agent in Electron single chat view with the canvas hidden: no badge, no auto-open, no tab (finding 2).

### 3. What input data produces a wrong answer?

- `workflowSubagentsForSession`/`sessionSubagents` data is no longer consumed in Electron at all, so a Workflow run's
  sub-agents (SubagentRecords with `workflowRunId`, `agent-monitor.store.ts:922-930`) have no Electron surface in
  single chat, and appear only as generic "Sub-agents" lane tabs in the Rail (`canvas-lane-tabs.component.ts:117-130`
  does not filter on `workflowRunId`).
- A `bg:`/`sub:` key mismatch is tolerated (`canvas-lane-tabs.component.ts:164-171` maps `sub:` to `bg:`). OK.

### 4. What happens when a dependency fails?

- Dock chunk fails to load: ChatView now shows only `display-dock-load-failed` (`chat-view.component.html:298-309`);
  previously an eager monitor was the fallback. Acceptable under row 112 and covered by `chat-view.dock.spec.ts:728`.
- `CanvasDetailService` absent (`inject(..., {optional:true})`, `canvas-detail-transcript.component.ts:47`): both card
  actions become silent no-ops (`this.detail?.open`). In production the service is provided by
  `orchestra-canvas.component.ts:68`, so this is only a test/misconfiguration path. Minor.
- `open()` returns silently when the tile is gone (`canvas-detail.service.ts:43`): fine.

### 5. What is missing that the requirements never mentioned?

- A replacement for the dock's pending-permission surface in the single chat view (finding 2).
- A decision for the workflow chip (finding 1); the writer asked, this review recommends an answer.
- Any assertion that the dock stays closed in a mounted ChatView after a real Rail tile click (finding 4).

## Failure modes

### FM1 Dead "Workflow launched" chip

- Trigger: click the chip button in any Electron host (Rail focus area, single chat, Tribunal conductor).
- Symptom: nothing happens.
- Evidence: `chat/.../execution/workflow-card.component.ts:56-66,108-110`; `chat-view.component.ts:1352`.
- Current handling: request published to `AgentMonitorStore`, ignored.
- Recommendation: finding 1.

### FM2 Single chat has no CLI-agent surface (including permissions)

- Trigger: Electron, canvas hidden (single chat mode), a CLI agent (MCP `ptah_agent_spawn` or similar) runs or asks for
  permission.
- Symptom: no tab, badge, auto-open or count; the permission ask is unreachable until the user switches to the canvas
  (Needs-you queue only mounts there, `orchestra-canvas.component.ts:110`; compact card rows and lane tabs are
  canvas-only). The agent waits.
- Evidence: removed `chat-view.component.html:251-309` branch; `permissionQueue` consumers are only canvas
  (`canvas-lane-view.component.ts:80`, `canvas-needs-you-queue.ts:97`, `compact-session-card.component.ts:278,499`) and
  the VS Code/Tribunal monitor (`agent-monitor-panel.component.ts:442-490`).
- Current handling: none; `chat-view.dock.spec.ts:510,532` assert the absence.
- Recommendation: finding 2.

### FM3 Silent no-op for an unregistered lane in the Rail

- Trigger: tile click when no `SubagentRecord` with that `parentToolUseId` exists in the store.
- Symptom: focus moves, lane tab reverts to Orchestrator, no message.
- Evidence: `canvas-lane-tabs.component.ts:164-175`, `canvas-lane-view.component.ts:~206-216` (`selectedKind` falls back).
- Recommendation: finding 3.

### FM4 Vacuous negative assertions

- Trigger: n/a (test quality).
- Evidence: `canvas-detail-transcript.component.spec.ts:180`, `chat-transcript.component.spec.ts:1289` (finding 4).

### FM5 Stale doc strings describing removed behaviour

- Evidence: `workflow-card.component.ts:19-26,59` ("opens that panel"), `agent-monitor.store.ts:1020-1030`. Minor.

## Blocking issues

None.

## Serious issues

### 1. "Workflow launched" chip is a dead click in Electron and was probably the user's click (Serious)

- File: `chat/src/lib/components/organisms/execution/workflow-card.component.ts:56-66,72-79,108-110`
- Scenario: the chip's button carries a "panel-right-open" icon and reads "Agents" (`:56-66`), which matches the user's words
  "it tries to open the display right sidebar but it can't". The old path was `requestPanelOpen` -> ChatView effect ->
  dock Agents tab. After this change the same request is dropped (`chat-view.component.ts:1352`), so the control is
  visibly interactive and does nothing, in every Electron host.
- Impact: the second most likely candidate for the reported bug is now silently dead instead of fixed. A dead button
  with a "Watch this workflow in the Agents panel" tooltip also misleads users. An accessible name promising an action
  that never happens fails WCAG 2.1 SC 3.2.4 consistency in practice.
- Is a dead click acceptable? No. Row 112 says the click must show execution in the main view; a no-op contradicts it
  even if the tile redesign comes later.
- Fix (small, this PR; Option A, recommended): make the chip static in Electron.
  1. In `WorkflowCardComponent` add `private readonly isElectron = inject(VSCodeService).isElectron;` (same
     discriminator ChatView uses at `chat-view.component.ts:262`; `VSCodeService` is in `@ptah-extension/core`).
  2. Template: wrap the button in `@if (!isElectron) { ... }`. In Electron render the label only, and set the text
     line under the title to "Its agents appear as lanes of this session." so the user knows where to look. No
     `role="button"`, no click handler, so there is nothing to mislabel.
  3. Update the JSDoc at `:19-26` and the store comment `agent-monitor.store.ts:1020-1030` to say the request is
     VS Code only.
  4. Add `workflow-card.component.spec.ts` (none exists): Electron -> no button and `requestPanelOpen` never called;
     VS Code -> button calls `requestPanelOpen(tabId)`.
- Fix (Option B, only if the user wants it now): when `SESSION_CARD_ACTIONS` is present and the Rail is the host, open
  the first workflow lane: `workflowSubagentsForSession(sessionId)[0]` -> `actions.openLane(laneKey('subagent',
  record.parentToolUseId))`. Not recommended for this PR: `SESSION_CARD_ACTIONS` is also provided by `ChatTranscript`
  in single chat (`chat-transcript.component.ts:245-249`), where `openSubagentLane` needs a transcript tool node
  (`:~765-770`) that a workflow agent does not have, and the tab-id to session-id mapping is extra surface. Leave it to the
  tile redesign.
- Files touched: `chat/src/lib/components/organisms/execution/workflow-card.component.ts`, new
  `.../workflow-card.component.spec.ts`, comment-only edit in `chat-streaming/src/lib/agent-monitor.store.ts`.

### 2. Electron single chat lost every CLI-agent surface, including permission requests (Serious, needs user confirmation)

- File: `chat/src/lib/components/templates/chat-view.component.html:251-309` (removed branch), `chat-view.component.ts:1352,1387`
- Scenario: Electron single chat (canvas hidden). A CLI agent runs and asks for permission. Before: dock Agents tab,
  badge and auto-open on pending permission (decision 100). Now: nothing in the main view. CLI-agent rows and permission
  callouts exist only in the Rail card, lane tabs and Needs-you queue, all mounted by the canvas.
  `context.md` (Decisions section) said the monitor "stays in the single chat view"; row 112(a) overrides that "in every
  host" and the user chose it, but its text assumes "main view" shows agents once, which is true for the Rail only.
- Impact: an agent can wait on a permission the user cannot see. Background sub-agents still have the tray
  (`chat-view.component.html:60`), but CLI agents and workflow sub-agents have no strip.
- Fix: do not re-add the Agents tab. Ask the user before this ships (the writer's report did not raise it), and meanwhile
  add one minimal indicator in single chat only: a polite `role="status"` line above the composer in
  `chat-view.component.html` when `dockEnabled && !_sessionContext && pendingCliPermissionCount() > 0`, text "A CLI agent is
  waiting for your permission. Switch to the canvas to answer.", fed by the existing `sessionAgents()` computed
  (`chat-view.component.ts:~575`), which is now only used by VS Code. Spec in `chat-view.dock.spec.ts`: a pending request
  shows the line and still leaves the dock closed.
- Files touched: `chat/.../templates/chat-view.component.html`, `chat-view.component.ts`, `chat-view.dock.spec.ts`.

## Moderate and minor issues

### 3. Moderate - Rail sub-agent click is a silent no-op when the lane is unknown

`canvas-detail-transcript.component.ts:74` -> `canvas-detail.service.ts:42-48` -> `canvas-lane-tabs.component.ts:164-175`.
Single chat tells the user; the Rail does not. Fix: in `CanvasDetailService.open`, return a boolean or set a signal that
the lane is absent, and have the provider announce "This agent is not available yet." through the existing live region;
or only call `focusTile` and leave Orchestrator selected, with the announcement. Spec: `open` with an unknown lane key keeps
the previous lane and announces. Files: `canvas-detail.service.ts` (+ spec), `canvas-detail-transcript.component.ts`.

### 4. Moderate - two new negative assertions cannot fail

- `canvas-detail-transcript.component.spec.ts:180`: the dock sits under `@defer (when panelOpen())` and nothing opens
  it, so `ptah-display-dock` is null with or without the fix.
- `chat-transcript.component.spec.ts:1289`: `ChatTranscriptComponent` never renders the dock; it is a ChatView child.
The meaningful assertions are `open` called with `('parent','sub:tool')` (`:178`, fails on HEAD because HEAD called
`selectLaneFor`) and `chat-view.dock.spec.ts:532,739` (fail on HEAD: the old effect opened the dock). Fix: drop both
lines, or assert `DisplayDockState.tab('parent').open === false` in the mounted ChatView of the canvas spec. Files: both
specs.

### 5. Minor - cleanup residue

- `display-dock.component.ts:24-26` (single-name import split over three lines) and `:34-35` (double blank line):
  prettier will rewrite them; route to style.
- `chat-view.component.ts:1057-1059`: the JSDoc now reads "The main panel with no session gets none, never every
  session's runs" after a deleted `{@link}`; rewrite as a full sentence.
- Row 109 `hideAgents` plumbing is gone from the dock, template and spec (grep of `libs/frontend/chat/src`: no `hideAgents`).

### 6. Minor - types, console, boundaries (new-defect scan)

Read-only scan of all in-scope diffs: no `as any`, no new `console.*`, no new cross-lib imports (the dock dropped its
`chat-streaming` type import; `canvas` still imports only `@ptah-extension/chat`). Imports left in
`display-dock.component.ts` are all used (`signal`, `computed`, `ElementRef`, `afterRenderEffect`, `viewChild`,
`TurnChangeSet`). `DisplayDockState` keeps `activeTab: 'agents'`, `selectTab`, `requestAgentsOpen` and
`agentsUserClosed` (`display-dock.state.ts:22,187,269`); they are still needed because ChatView uses a private instance
for the VS Code sidebar (`chat-view.component.ts:~455`). Acceptable, but nothing stops an Electron caller from setting
`activeTab='agents'`, which the dock would now render as an empty `Displays` view. No Electron caller exists today.

### 7. Minor - `$agents` display reference still exists in the Displays dock

`ptah-ui-agents.source.ts` still feeds a user-requested `$agents` surface. Decision 77 protects it, so leave as is; flag it so
the tile redesign does not mistake it for a duplicate Agents tab.

## Data flow (sub-agent click)

1. Tile button `data-testid="subagent-open"` -> `SubagentTileComponent.openLane` (`subagent-tile.component.ts:99-102`),
   key `sub:<toolCallId>` or `bg:<toolCallId>`. OK.
2. `SESSION_CARD_ACTIONS` resolved on `ChatTranscript` (`chat-transcript.component.ts:245-249`): host token wins, else single
   chat. OK.
3a. Rail: `CanvasDetailTranscript` provider -> `CanvasDetailService.open(tabId, key)` (`:74`): validates tile and key,
    `focusTile` (swaps split panes, board effect), `selectLaneFor`, closes the detail overlay. OK; lane existence gap is
    finding 3.
3b. Single chat: `openSubagentLane` -> `ptah-single-chat-subagent-view` (R9n). Notice on a missing agent. OK.
4. Nothing on this path touches `DisplayDockState` or `AgentMonitorStore.requestPanelOpen`. OK.
5. Remaining caller of `requestPanelOpen`: workflow chip only (`workflow-card.component.ts:109`). Dead in Electron (finding 1).

## Click-surface trace (Electron)

| Surface | Handler | Rail destination | Single chat destination | Dock? | Status |
| --- | --- | --- | --- | --- | --- |
| Transcript sub-agent tile (`subagent-open`) | `subagent-tile.component.ts:99` | `detail.open` -> focus session + lane tab (`canvas-detail-transcript.component.ts:74`) | R9n full view (`chat-transcript.component.ts:728-732`) | No | LIVE (lane-absent case silent in Rail, finding 3) |
| Tile "Permission needed" badge | `subagent-tile.component.ts:104-107` | same as tile | same as tile | No | LIVE |
| Inline agent bubble (non-tile mode, nested inside full view) | `inline-agent-bubble.component.ts:1000-1005` | Transcript modal (`SubagentTranscriptViewerService`) | same modal | No | LIVE, not the dock |
| Background strip chips | `background-agent-tray.component.ts` | Transcript modal | same | No | LIVE (unchanged) |
| "Workflow launched" chip button | `workflow-card.component.ts:108` | none | none | Request ignored | DEAD (finding 1) |
| Rail card lane row | `compact-rail-card.component.ts:349` -> `compact-session-card.openLane` -> `canvas-rail-card.openLane` (`:272`) | `detail.open` | n/a | No | LIVE |
| Rail card `+N more` | `compact-rail-card:313,334` -> `requestLanes` -> `openFullView` + `lanesRequested` -> `onLanesRequested` (`canvas-rail-board.component.ts:806`) | focus session, focus lane tablist | n/a | No | LIVE |
| Lane tabs strip | `canvas-focus-area.component.ts:58` -> `detail.selectLaneFor` | lane tab (same focused session) | n/a | No | LIVE |
| Needs-you queue lane item | `canvas-needs-you-queue.component.ts:235-241` | CLI lane | n/a | No | LIVE (unchanged) |
| Dock Agents tab / badge / running count | removed | - | - | - | REMOVED (Part A) |

## Decision 77 checklist (dock after the change)

| Capability | Result | Evidence |
| --- | --- | --- |
| Dock mounts under `@defer (when panelOpen())`, display region only | PASS | `chat-view.component.html:290-297`; `display-dock.component.ts:62-112` |
| No Agents tab, tablist, new dot, badge, running count | PASS | `display-dock.component.spec.ts:140-146`; template read |
| No Agents auto-open in Electron | PASS | `chat-view.component.ts:1352,1387` early return; `chat-view.dock.spec.ts:532,739` |
| No embedded or fallback monitor in any Electron host (incl. `HIDE_AGENT_SIDEBAR`) | PASS | `chat-view.component.html:298-309`; spec `:510,728` |
| Row 109 `hideAgents` gone | PASS | grep: no remaining `hideAgents` |
| `ptah-ui display [id]` opens and updates in place | PASS | `chat-view.dock.spec.ts:510-530` (setSurfaces update re-binds panel); run green 23/23 |
| `$diff $tests $usage $agents $limits` references | PASS (unchanged code) | display sync and sources untouched |
| Pin / close | PASS | `display-dock.component.ts:69-91`; spec `:148-178` |
| Resize, width per tab, side vs overlay per pane | PASS | `chat-view.html:266-288`; `syncDockWidthPerTab` unchanged; keepalive 9/9 reported |
| Restore by tab id | PASS | `DisplayDockState` keyed by tab, spec `chat-view.dock.spec.ts:746` |
| Keyboard: header controls | PASS | pin and close are native buttons in DOM order; overlay open still focuses Close (`display-dock.component.ts:166-173`); separator is a focusable button with arrow/Home/End (`chat-view.html:267-283`); the removed tablist's roving tabindex has no remaining dependents |
| VS Code sidebar unchanged | PASS | `chat-view.component.html:310-347` identical; `chat-view.dock.spec.ts:492,503` |

## Requirements fulfilment

| Requirement (row 112) | Status | Gap |
| --- | --- | --- |
| (a) Remove Agents tab, badge, running count, auto-open, embedded monitor from Electron dock, every host | COMPLETE | None in the dock; Electron single chat loses its only agent surface (finding 2) |
| (b) Sub-agent click opens execution in the main view, Rail via `CanvasDetailService.open` | COMPLETE for the tile | Lane-absent case silent (3) |
| (b) Single chat: R9n full view | COMPLETE | Unchanged, verified |
| (c) VS Code sidebar unchanged | COMPLETE | None |
| (d) Row 109 `hideAgents` removed | COMPLETE | None |
| Every agent click in Electron shows execution or is not interactive | PARTIAL | Workflow chip (1) |

Implicit requirements not addressed: pending CLI permission reachability in single chat (2); workflow sub-agent surface in single chat.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Split pane, click tile in non-active pane | YES | `focusTile` + board effect swaps panes | none |
| Tile of a different session than focused | YES | `open` focuses owning tab | none |
| Sub-agent record absent | NO | lane reverts silently | finding 3 |
| Dock chunk fails | YES | alert only | acceptable |
| `HIDE_AGENT_SIDEBAR` host (Tribunal) in Electron | YES | dock shows displays only | conductor tile comment updated |
| VS Code workflow chip | YES | effect gated off Electron only | none |
| Electron workflow chip | NO | ignored | finding 1 |
| Electron single chat CLI permission | NO | no surface | finding 2 |
| Persisted dock state with `activeTab:'agents'` | YES | restore path resets to `displays` (`display-dock.state.ts:~350`) | none |

## Verdict

- Recommendation: REVISE (one fix round).
- Score 6/10: sound removal and a correct Rail tile fix (9-10 would need the chip and single-chat gaps closed with specs); 5-6
  band because two likely user paths now end in a silent dead control or an unreachable permission.
- Confidence: HIGH on Part A and the Rail tile path (code read in full, three specs re-run green); MEDIUM on which click the
  user originally hit (no repro available; the chip and the Rail tile are the two candidates and both were traced).
- Top risk: the visible-but-dead "Workflow launched" button in Electron.
- Fix round order: (1) chip static in Electron + new spec; (2) single-chat permission indicator after user confirmation;
  (3) Rail lane-absent announcement; (4) drop or strengthen the two vacuous assertions; (5) comments and formatting.

Findings and files for the one fix round:

| # | Severity | Files |
| --- | --- | --- |
| 1 | Serious | `chat/.../execution/workflow-card.component.ts`, new `workflow-card.component.spec.ts`, `chat-streaming/.../agent-monitor.store.ts` (comment) |
| 2 | Serious | `chat/.../templates/chat-view.component.html`, `chat-view.component.ts`, `chat-view.dock.spec.ts` |
| 3 | Moderate | `canvas/.../canvas-detail.service.ts` (+ spec), `canvas-detail-transcript.component.ts` |
| 4 | Moderate | `canvas-detail-transcript.component.spec.ts`, `chat-transcript.component.spec.ts` |
| 5-7 | Minor | `display-dock.component.ts`, `chat-view.component.ts` (comment) |
