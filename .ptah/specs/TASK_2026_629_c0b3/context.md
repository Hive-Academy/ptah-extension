# Context: Orchestra Canvas mission board

## Problem

With 5–6 sessions, each running many sub-agents and CLI lanes, the canvas shows
too much at once and is hard to follow. Every visible tile mounts a full
`ChatViewComponent` and renders its stream live:

- `libs/frontend/canvas/src/lib/canvas-tile.component.ts:20` — each tile hosts `ChatViewComponent`.
- An unfocused but visible tile still renders its full stream. Only decorative
  animations pause (`canvas-tile.component.ts:144`). The transcript freezes only
  when the whole workspace is hidden (`chat-view.component.ts:735`).
- CLI agents are hard to see. The tile mini panel shows name, task and status
  only (`tile-agent-mini-panel.component.ts:36`). Their output is only in the
  agent monitor sidebar.

The renderer memory problem is handled by TASK_2026_628_5ab5. This task
reduces render work and makes many sessions readable. It does not, by itself,
fix allocation churn in the stores.

## Agreed design (prototype A, "mission board")

Prototypes: [./prototypes/index.html](./prototypes/index.html). Open the HTML
files directly. No build step. `01-board.html` is the agreed direction. `02`
and `03` are alternatives kept for reference.

1. **Live budget.** With 1 session, it fills the canvas (as today). With 2
   sessions, both are live side by side (as today). From 3 sessions, the
   focused session is live and every other session is a card. The budget (2) is
   a setting.
2. **Status card.** It has fixed zones in a fixed order, aligned across all
   cards: header (state dot, title, state pill, expand) → branch · model ·
   elapsed → **Now** (current activity) → **Lanes** table (type icon, name,
   kind, status, elapsed. Max 3 rows, then "+N more lanes") → metrics (todos,
   context %, cost, git +/−). A permission request or an error replaces the lane
   rows with an Allow/Deny or Retry callout. The lane summary line stays.
3. **Detail row, not a swap.** Cards never move on click. A click opens a
   full-width detail panel directly below the clicked card's row, with a notch
   that points to the card. Esc or a second click closes it. ←/→ moves the
   detail to the next session. No automatic reordering by attention.
4. **Lane tabs.** The detail panel has a tab strip: Orchestrator, then grouped
   tabs for Sub-agents, CLI lanes and Background. A lane tab shows the task,
   status, elapsed time, a Stop lane action, the pending permission with
   Allow/Deny, and the live output. Clicking a lane row on a card opens the
   detail on that lane. Only the open tab subscribes to live output.
5. **Session details column** in the detail panel: context bar, tokens, cost,
   turns, todos and git. This is the inspector from the reference image,
   without the agent list (the tabs replace it).
6. **"Needs you" queue** in the canvas header. It combines session permission
   and question requests and CLI-agent permission queues across all sessions,
   with inline Allow/Deny and "Open session".

### Decisions

- **The agent monitor sidebar stays** in the single chat view. In the canvas,
  its content moves into the lane tabs. Hide it there with the existing
  `HIDE_AGENT_SIDEBAR` token (already used by Tribunal) and reuse the
  `AgentMonitorPanelComponent` / `agent-card` output rendering in the lane tab.
  Do not fork it.
- **Session cap.** Change the cap from 9 tiles to 9 **running** sessions.
  Finished and idle sessions stay as cards and do not count. Raise the number
  only after the backend is measured with many running sessions. A card does
  not reduce backend cost (SDK session, CLI processes, stream).
- **Settled features stay:** Gridstack layout, manual resize and span intents,
  per-workspace keep-alive grids, transcript retention LRU, the render window
  (18 mounted messages), Send to Messaging, compact/full view toggle.
- **Do not reintroduce `content-visibility`.** It caused transcript scroll fighting.

## What already exists (reuse)

- `CompactSessionCardComponent`
  (`libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts`)
  is already summary-only, and `ChatViewComponent` already swaps to it in
  compact mode (`chat-view.component.html:4`). Card mode = compact view chosen
  automatically for unfocused tiles.
- `summarizeLive()` / `summarizeFinalized()`
  (`libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-summary.ts`)
  build the summary. Today it recomputes on every `streamingState` change
  (`compact-session-card.component.ts:136`). Sample it (about 500 ms).
- `AgentMonitorStore` (`AGENT_MONITOR_SPAWNED/OUTPUT/EXITED`) holds CLI agents,
  their output and `permissionQueue`. The mini panel already has the Allow/Deny
  logic (`tile-agent-mini-panel.component.ts:124-142`).
- `agentVisibleInSession()` (used in `agent-monitor-panel.component.ts:799`)
  scopes agents to a session.
- `PermissionHandlerService` exposes permission and question requests and
  their target tabs.

## Delivery steps (each one can ship alone)

| # | Step | Size |
|---|---|---|
| 1 | Automatic compact view for unfocused tiles above the live budget | S |
| 2 | Sample the compact summary (no per-event `summarizeLive`) | S |
| 3 | Card layout with the Lanes table (CLI lanes from `AgentMonitorStore`) in `CompactSessionActivityComponent` | M |
| 4 | Detail row below the clicked card inside Gridstack | M–L |
| 5 | Lane tabs, reusing the agent monitor output rendering | M |
| 6 | Cross-session "needs you" queue in the canvas header | S–M |
| 7 | Running-session cap instead of tile cap | S |

**Risk in step 4:** Gridstack must accept a full-width item inserted after a
row without moving other tiles. Spike this first. The fallback is a fixed
detail panel at the bottom of the canvas. The cards still do not move.

## Acceptance

- With 6 sessions streaming, exactly one transcript (plus the open lane tab) is
  mounted. Cards update at most twice each second.
- A click never changes the position of any card.
- Every running CLI lane of a session is visible on its card (or counted in
  "+N more") and its output opens in one click.
- A permission request from any session or CLI lane can be answered from the
  card or the "needs you" queue without opening the transcript.
- 1 and 2 sessions behave as today.
- Before/after trace with 6 streaming sessions: DOM node count, long tasks
  over 100 ms, and renderer private memory. Record the numbers in this folder.

## Prototype evidence (simulated data only)

Same simulated load (~160 stream events/s over 6 sessions), `01-board.html`
Fidelity switch: cards mode 395 DOM nodes and 50 UI patches/s. All-live mode
1,310 nodes and 168 patches/s. The simulation has no markdown parsing, so the
real cost is higher. Use the numbers to compare the two modes only.

## Verification rules

Follow CLAUDE.md: test only the changed projects (`npx nx test canvas`,
`npx nx test chat`, `npx nx test chat-ui`, typecheck/lint the same), Jest
`--maxWorkers=2`, Nx `--parallel=1`, one heavy check at a time, no build,
serve or e2e targets unless the user asks.
