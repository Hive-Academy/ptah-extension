# Requirements - TASK_2026_629

## Context

Today every canvas tile mounts a full `ChatViewComponent` and renders its
stream live (`libs/frontend/canvas/src/lib/canvas-tile.component.ts:20`,
`:578`). An unfocused but visible tile keeps rendering. Only decorative
animations pause (`canvas-tile.component.ts:141-148`). A tile transcript
freezes only when its workspace is hidden (`SESSION_VISIBLE`, read by
`mainPanelShowing` in `chat-view.component.ts:842-846`). CLI lanes show only
name, task and status in the tile mini panel
(`tile-agent-mini-panel.component.ts:36`). Their output is only in the agent
monitor sidebar.

With 5–6 streaming sessions, a 26 s trace measured 18.1 s of Recalculate
Style (about 224 ms per run) over a DOM of about 105,000 nodes (see
TASK_2026_628_5ab5 `context.md`). The cost scales with mounted elements. The
user agreed the "mission board" design (`prototypes/01-board.html`): one live
view, status cards for the other sessions, a detail row under the clicked
card with lane tabs, and a cross-session "needs you" queue. `02` and `03` are
rejected alternatives.

Reusable parts exist. `CompactSessionCardComponent` is summary only, and
`ChatViewComponent` swaps to it in compact mode (`chat-view.component.html:4`).
The card recomputes the summary on every `streamingState` change
(`compact-session-card.component.ts:136-138`). `AgentMonitorStore` holds CLI
agents and their `permissionQueue` (`chat-streaming/src/lib/agent-monitor.store.ts:437`,
`clearPermission` at `:1494`). `PermissionHandlerService` exposes
`permissionRequests`, `questionRequests`, `targetTabsFor` and
`questionTargetTabsFor` (`chat-streaming/src/lib/permission-handler.service.ts:111,123,360,575`).
`HIDE_AGENT_SIDEBAR` (`chat/src/lib/tokens/session-context.token.ts:20`) is
already provided by Tribunal (`tribunal-panel/.../conductor-tile.component.ts:221`).

### Reference check against context.md

| context.md says | Code today | Correction |
| --- | --- | --- |
| Transcript freezes at `chat-view.component.ts:735` | Line 735 is resize-handle cleanup | `mainPanelShowing`, `chat-view.component.ts:842-846` |
| Animation pause at `canvas-tile.component.ts:144` | Rules span 141-148 | `canvas-tile.component.ts:141-148` |
| `agentVisibleInSession()` at `agent-monitor-panel.component.ts:799` | Calls at 808 and 813; defined in `chat-streaming/src/lib/session-scope.ts:60` | Use `:808,813` |
| Session cap is "9 tiles" | `MAX_CANVAS_TILES = 20` (`canvas-layout-intent.ts:13`); `canvas.store.ts:85-91` comment still says nine (stale) | The current tile cap is 20 |
| (628) tile tree cache key at `chat-transcript.component.ts:~405` | `tile-${tabId}` is at `chat-transcript.component.ts:416` | Use `:416` |
| (628) `tab-manager.service.ts:1321-1338` | Region is the doc comment and start of `updateTabInternal` (`:1332`) | Treat `updateTabInternal` as the 628-owned region |
| Verify with `npx nx test canvas` / `chat` / `chat-ui` | Project names are `@ptah-extension/canvas`, `@ptah-extension/chat`, `@ptah-extension/chat-ui` | Use the full project names |

Still correct: `canvas-tile.component.ts:20`, `tile-agent-mini-panel.component.ts:36`
and `:124-142`, `chat-view.component.html:4`, `compact-session-card.component.ts:136`,
`styles.css:2221-2222`.

## Classification

- Type: FEATURE — new canvas surfaces (cards, detail row, lane tabs, queue)
  plus a change in cap semantics.
- Estimate: XL — seven independently shippable steps across three libraries
  (`canvas`, `chat`, `chat-ui`), with one Gridstack spike.
- Priority: not defined here.

## Scope

In scope:

- Steps 1–7 below, each shippable alone, in the order given.
- Before/after performance measurement with 6 streaming sessions, recorded in
  this task folder.

Out of scope:

- Every item in `## Ownership boundary with TASK_2026_628` — TASK_2026_628 owns it.
- Allocation churn in stores, tree building, markdown and CLI output parsing —
  TASK_2026_628.
- Main-process memory growth — separate task if it continues (628 also excludes it).
- Backend changes to reduce the cost of a running session — a card does not
  reduce SDK, CLI process or stream cost. Raising the running cap needs a
  backend measurement first; file it separately.
- Automatic card reordering by attention — the design rejects it.
- The rejected prototypes `02-focus-rail.html` and `03-overview.html`.
- The single chat view (non-canvas). The agent monitor sidebar stays there
  unchanged.
- A settings UI for the live budget — see Open questions.
- Answering `AskUserQuestion` prompts inline in the queue — the queue shows
  them with "Open session" only.
- Retry actions that do not already exist for an error type.
- Removing settled features: Gridstack layout, manual resize and span
  intents, per-workspace keep-alive grids, transcript retention LRU, render
  window (18 messages), Send to Messaging, compact/full toggle.

## Requirements

Terms used below:

- **Live budget**: the number of sessions that can render live side by side.
  Default 2.
- **Card**: a tile that renders the compact summary instead of a transcript.
- **Running session**: a session with an SDK turn in flight, or with at least
  one non-terminal CLI lane or background agent.
- **Lane**: a sub-agent, a CLI agent, or a background agent of one session.

### 1. Automatic card mode above the live budget (S)

Requirement: the canvas — renders unfocused tiles as cards when the tile count
exceeds the live budget — so that only the focused session renders a live
transcript.

Acceptance criteria:

1. Given 1 tile, when it streams, then it renders live and fills the canvas as today.
2. Given 2 tiles (count ≤ budget), when both stream, then both render live side by side as today.
3. Given 3 or more tiles, when the canvas renders, then only the focused tile mounts a transcript, and every other tile renders `ptah-compact-session-card`.
4. Given 3 or more tiles, when the user focuses another tile, then the old tile becomes a card and the new tile renders live. No tile changes its Gridstack position or size.
5. Given a tile with a stored view mode, when it becomes a card automatically and the count later drops to the budget or below, then it returns to its stored view mode. The automatic mode never overwrites the stored per-tab view mode.
6. Given the focused tile above the budget, when the user uses the compact/full toggle, then the toggle still works for that tile.
7. When the live budget value changes (for example to 3), then the threshold follows the value without other code changes.
8. Unit specs in `@ptah-extension/canvas` cover criteria 1–5.

### 2. Sampled card summary (S)

Requirement: the compact card — recomputes its live summary at most about every
500 ms — so that cards update at most twice per second.

Acceptance criteria:

1. Given a streaming tab rendered as a card, when 100 stream events arrive in 1 s, then `summarizeLive` runs at most 2–3 times for that card in that second (spec with fake timers).
2. Given a card, when a permission request, a question, an error or a session status change arrives, then the card shows it within the next frame, without waiting for the sample.
3. When streaming ends, then the card shows the finalized summary (`summarizeFinalized`) on the next update.
4. When the card is destroyed, then no sampling timer stays active (spec).
5. The sampling lives in `compact-session-card.component.ts` (or a helper in the `chat` library). `compact-session-summary.ts` has no diff from this task.

### 3. Status card layout with the Lanes table (M)

Requirement: a canvas card — shows fixed zones in a fixed order — so that the
user reads the same field in the same place on every card.

Acceptance criteria:

1. When a card renders, then it shows these zones in this order: header (state dot, title, state pill, expand) → branch · model · elapsed → **Now** (current activity) → **Lanes** (summary line plus table) → metrics (todos, context %, cost, git +/−). A zone with no data keeps its place and shows a placeholder.
2. Given a session with lanes, when the card renders, then the Lanes table shows at most 3 rows. Each row shows a type icon, name, kind (Sub-agent, CLI lane, Background), status and elapsed time. Rows sort by status: waiting, error, running, done, stopped.
3. Given more than 3 lanes, then the card shows "+N more lanes", where N = total lanes − shown rows.
4. Given every running CLI lane of a session (scoped with `agentVisibleInSession`), then each one is a visible row or is counted in "+N more".
5. Given a pending session permission or CLI lane permission, then an Allow/Deny callout replaces the lane rows, and the lane summary line stays. Allow and Deny resolve the request through the existing paths (`PermissionHandlerService` for session permissions; the `AGENT_MONITOR_PERMISSION_RESPONSE` message plus `AgentMonitorStore.clearPermission` for CLI lanes, as in `tile-agent-mini-panel.component.ts:124-142`).
6. Given a session error, then an error callout replaces the lane rows. It shows the error text and "Show output". It shows Retry only where a retry action exists today.
7. Given two cards side by side with different data, then each zone starts at the same vertical offset on both cards (visual check, screenshot in the task folder).
8. `CompactSessionActivityComponent` (`chat-ui`) stays presentational: it receives lane data as inputs and injects no store.
9. Specs cover row cap, "+N", sort order and the callout swap.

### 4. Detail row under the clicked card (M–L)

Requirement: the canvas — opens a full-width detail panel directly below the
clicked card's row — so that the user inspects one session without any card
moving.

Acceptance criteria:

1. A spike runs first. It records in this folder whether Gridstack (`float: false`, `canvas-workspace-grid.component.ts:220`) accepts a full-width item after a row without moving other tiles. If it does not, the fallback applies: a fixed detail panel at the bottom of the canvas. The spike result names the chosen option.
2. Given 3 or more tiles, when the user clicks a card, then the detail opens below that card's row (or in the fallback panel) with a notch that points to the card. The position of every card is unchanged (compare the Gridstack `x/y/w/h` of all tiles before and after, in a spec).
3. When the user presses Esc or clicks the same card again, then the detail closes and no card moves.
4. When the detail is open and the user presses ← or →, then the detail moves to the previous or next session in tile order and wraps at the ends.
5. When the detail is open, then its Orchestrator view mounts the live transcript of that session. With 6 sessions, exactly one transcript is mounted in the canvas (DOM query count of transcript hosts = 1).
6. The detail shows a session details column: context bar, tokens, cost, turns, todos and git. It has no agent list.
7. Given 1 or 2 tiles (count ≤ budget), then no detail row exists and click behaviour is as today.
8. When a tile is closed while its detail is open, then the detail closes. No detail element remains in the DOM.
9. The card element has `role` and keyboard activation: Enter and Space open the detail.

### 5. Lane tabs (M)

Requirement: the detail panel — shows a tab strip with Orchestrator, then
grouped Sub-agent, CLI lane and Background tabs — so that each lane's output is
one click away.

Acceptance criteria:

1. When the detail opens, then the tab strip shows Orchestrator first, then groups in this order: Sub-agents, CLI lanes, Background. Empty groups are hidden.
2. When the user selects a lane tab, then it shows the task, status, elapsed time, a Stop lane action, any pending permission with Allow/Deny, and the live output.
3. The lane output reuses the existing agent monitor rendering (`ptah-agent-card` / `ptah-agent-card-output`). No copy or fork of these components exists (grep check).
4. When the user clicks a lane row on a card, then the detail opens on that lane's tab in one click.
5. Only the open tab subscribes to live output. When the user switches tabs, then the previous tab's output view is destroyed (spec: one output component instance at a time).
6. Stop lane uses the existing stop paths (CLI: agent card stop; sub-agent: `AgentMonitorStore.stopAgent(taskId, sessionId)` with the owning session id).
7. In the canvas, the agent monitor sidebar is hidden through `HIDE_AGENT_SIDEBAR`. In the single chat view, the sidebar is unchanged.
8. Given a lane that ends, then its tab stays with a terminal status until the session's lanes are cleared by the existing store rules.

### 6. Cross-session "needs you" queue (S–M)

Requirement: the canvas header — shows one queue of pending permissions and
questions across all sessions and CLI lanes — so that the user answers them
without opening a transcript.

Acceptance criteria:

1. The header shows a button with the count ("N need you") or "All clear". It sits in the existing header controls area (`orchestra-canvas.component.ts`, next to `ptah-canvas-layout-controls`).
2. When opened, the queue lists every pending session permission, every pending question, and every CLI lane `permissionQueue` entry across all canvas sessions. Each item names the session, the requester and the command or question.
3. Permission items have inline Allow and Deny. These resolve only the selected request, for the right session (test: two sessions with simultaneous requests; answering one leaves the other pending).
4. Question items have "Open session" only.
5. When the user selects "Open session", then the queue closes and the detail opens on that session, on the lane that asked when the requester is a lane.
6. When a request is answered elsewhere (card, transcript, sidebar), then it leaves the queue on the next update.
7. The queue never reorders cards.

### 7. Running-session cap instead of tile cap (S)

Requirement: the canvas — limits the number of running sessions instead of
tiles — so that finished and idle sessions stay visible as cards.

Acceptance criteria:

1. When 9 sessions are running, then the user cannot start a 10th running session from the canvas. The UI states the reason. No running session is stopped.
2. Given 9 running sessions, when the user adds a tile for a finished or idle session, then the tile is added (up to the hard tile bound).
3. When a running session finishes, then a new session can start.
4. The hard tile bound stays `MAX_CANVAS_TILES` (20) for persistence and Gridstack. The `cap-reached` outcome (`orchestra-canvas.component.ts:500,520`) keeps working at that bound.
5. The running cap is one named value. The stale "nine tiles" comment at `canvas.store.ts:85-91` is corrected.
6. Specs cover: idle tiles do not count; the 10th running start is refused; a finish frees a slot.

## Non-functional requirements

- Performance (manual measurement, recorded in this folder as `perf-before-after.md`):
  - Scenario: 6 sessions streaming, with sub-agents and CLI lanes, in the
    Electron app, DevTools Performance recording with Memory, about 30 s.
  - Record before (main after TASK_2026_628 merges, before step 1) and after
    (all shipped steps): DOM node count, long tasks over 100 ms (count and
    total), renderer private memory (`Win32_Process` or Task Manager), and
    Recalculate Style total and average time.
  - Pass: after-values are lower than before-values for DOM node count and
    Recalculate Style total. No threshold is set beyond that.
- Card update rate: a card patches its DOM at most 2 times per second from
  stream data (elapsed timers excluded; at most 1 per second).
- Compatibility: with 1 or 2 sessions, the canvas behaves as today (existing
  `canvas`, `chat` and `chat-ui` specs pass without edits to their expectations).
- Accessibility: cards, lane rows, tabs and queue items are reachable by
  keyboard. The tab strip uses `role="tablist"`. The queue popover has an
  accessible name.

## Constraints

- Do not reintroduce `content-visibility`. It caused transcript scroll fighting.
- Do not use `--max-old-space-size`.
- Rebase this branch onto `main` after TASK_2026_628 merges, before the after-measurement.
- Angular 22: standalone components, `OnPush`, signals, `inject()`.
- Respect Nx module-boundary tags (`scope:webview`, `type:feature`). `chat-ui`
  stays presentational.
- The webview talks to the host only through the existing RPC and message
  protocol (`VSCodeService`). No new channel.
- Verification: CLAUDE.md rules. Test only changed projects, Jest
  `--maxWorkers=2`, Nx `--parallel=1`, one heavy check at a time, no build,
  serve or e2e.

## Ownership boundary with TASK_2026_628

TASK_2026_628 owns these areas. This task must NOT edit them:

| 628-owned area | Location |
| --- | --- |
| Tile tree cache key `tile-…` | `chat/.../transcript/chat-transcript.component.ts:416` |
| `summarizeLive` and all of `compact-session-summary.ts` | `chat-ui/src/lib/molecules/compact-session/compact-session-summary.ts` |
| Detached `ptah-canvas-tile` `ElementRef` leak | canvas tile, Gridstack adapter, tile registries |
| Streaming markdown rendering | `libs/frontend/markdown` |
| Batched updates | `chat-streaming/src/lib/batched-update.service.ts` |
| Execution tree builder | `chat-streaming/src/lib/execution-tree-builder.service.ts` and builders |
| Agent summary chunks | `chat/src/lib/services/chat-store/chat-lifecycle.service.ts` |
| Agent monitor store and output paths, incl. agent-card output parsing | `chat-streaming/src/lib/agent-monitor.store.ts`, `agent-card.component.ts`, `agent-card.utils.ts`, `agent-card-output.component.ts` |
| Tab flush copy | `chat-state/src/lib/tab-manager.service.ts`, `updateTabInternal` (~1315-1360) |
| Presentation store | `chat/src/lib/services/stream-presentation-store.service.ts` |
| Sidebar `scrollbar-color` | `apps/ptah-extension-webview/src/styles.css:2221-2222` |

Where this task works near these areas:

- Step 2 samples in the card component as a wrapper. It calls `summarizeLive`
  unchanged. Making `summarizeLive` linear is 628's work.
- Steps 1 and 4 edit `canvas-tile.component.ts` and the workspace grid. The
  `ElementRef` leak fix stays 628's. This task must not add new arrays or maps
  that hold tile `ElementRef`s or DOM nodes past destroy.
- Steps 3, 5 and 6 read `AgentMonitorStore` only through its existing public
  API (`agents`, `agentsForSession`, `sessionSubagentsForSession`,
  `permissionQueue`, `clearPermission`, `stopAgent`). Derived lane lists are
  computed in this task's components, not in the store.
- Step 5 mounts `ptah-agent-card` / `ptah-agent-card-output` as they are.
- Step 4 mounts the transcript in the detail row through the existing tile
  path. It does not change the cache key.
- Step 1 must not write view mode through `updateTabInternal` changes.

Dependencies on TASK_2026_628 (a requirement here needs work there):

1. Step 2 / NFR: the card cost per sample depends on 628 hot spot 6
   (`summarizeLive` linear). Sampling alone limits frequency, not cost per run.
2. Step 3: if the card needs a lane selector that the store does not expose
   today (for example lane elapsed time or kind for background agents), it is a
   628-area store change. Compute it in 629 components from public signals
   first; request a store change from 628 only if that is not possible.
3. Step 5: live lane output cost (full stdout re-parse, segment re-keying,
   unthrottled `<markdown>`) is fixed by 628 plan step 4. Step 5 limits it to
   one open tab only.
4. Step 4: the detail-row transcript uses the `tile-` cache key. The double
   build of the same state is fixed by 628.
5. Steps 1 and 4: closing tiles and detail rows must not leak. Verification of
   "no detached `ptah-canvas-tile`" depends on 628 step 7.
6. NFR measurement: the baseline is `main` after 628 merges, so the gain of
   each task stays separate.

## Stakeholders

| Stakeholder | What they need from this change | How they will judge it |
| --- | --- | --- |
| User running 5–6 sessions | Read all sessions at a glance; answer permissions fast | Cards readable; queue answers requests without opening a transcript; app stays responsive |
| User running 1–2 sessions | No change | Canvas behaves as today |
| TASK_2026_628 owner | No edits in owned areas; clean rebase | No diff in the owned files listed above |
| Reviewers | Checkable steps | Each step's criteria pass on its own |

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Gridstack (`float: false`) moves tiles when a full-width item is inserted after a row | HIGH | HIGH | Developer runs the step 4 spike first and records the result; if it fails, ship the fixed bottom panel fallback |
| Running-session definition misses a cost source (for example a detached CLI process), so the cap under-counts | MEDIUM | MEDIUM | Developer derives "running" from tab status plus non-terminal CLI and background agents; spec covers each source |
| An inline Allow/Deny answers the wrong session's request when two sessions ask at once | MEDIUM | HIGH | Use `targetTabsFor` / `questionTargetTabsFor` and the request id only; tester adds a two-session spec in steps 3 and 6 |
| Card mode change on focus causes Gridstack reflow before step 4 ships | MEDIUM | MEDIUM | Step 1 keeps tile geometry fixed; spec asserts `x/y/w/h` unchanged |
| Rebase conflicts with 628 in `canvas-tile.component.ts` and the grid | MEDIUM | LOW | Keep 629 edits in the canvas tile limited to mode selection; rebase right after 628 merges |
| Sampling hides a state change the user must act on | LOW | HIGH | Step 2 criterion 2: action-required changes bypass sampling |

## Open questions

Each is resolved with an assumption. Change it only if the user disagrees.

- Is the live budget a user setting with UI? Assumption: one named value,
  default 2, configurable in code. Settings UI is out of scope.
- Above the budget, how many sessions are live? Assumption: one (the focused
  session), as context.md states. The budget only controls side-by-side live
  mode at or below it.
- Which "running cap" value? Assumption: 9, as decided. The hard tile bound
  stays 20.
- What happens at the running cap? Assumption: a new running start is refused
  with a message. No running session is stopped or queued.
- Which lanes show on a card? Assumption: all three kinds (sub-agent, CLI,
  background), as in the prototype. CLI lanes are required by acceptance.
- Does the queue include errors? Assumption: no. Errors show on the card
  callout only. The queue holds permissions and questions.
- What does ←/→ do at the last session? Assumption: wrap around, as in the
  prototype.
- Do the prototype's 1–9 number shortcuts ship? Assumption: no. Not in the
  agreed design list.

## Handoff

- Next specialist: software-architect.
- Why: the shape is the question — card-mode selection without overwriting the
  stored view mode, the detail-row placement in Gridstack (spike), and lane-tab
  composition from existing components across three libraries.
