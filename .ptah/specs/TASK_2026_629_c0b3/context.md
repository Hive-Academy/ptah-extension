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

## Performance evidence

A 26 s trace with 5–6 streaming sessions (see TASK_2026_628_5ab5 `context.md`)
measured these values:
- Recalculate Style used 18.1 s of 25.9 s, about 224 ms per frame.
- Each recalculation touched about 13,000 elements of a 105,000-node DOM.

The cost scales with the number of mounted elements. So this task's main
performance goal is fewer mounted elements: one live transcript instead of
one per session. Record the DOM node count and the Recalculate Style time
before and after.

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

## R9 session (2026-10-14)

- Gate 0.1: lanes enabled (user pinned codex lanes); approval mode lane-review for Gate 2, the Grid removal list goes to the user. `ptah_agent_list`: codex installed, confirmed room (weekly 6%); opencode confirmed room; copilot disabled; antigravity, grok, Glm unknown.
- R9 architect lane: codex `aa9fd3a0-42ac-4228-af8d-2919347b3169` (software-architect), started 21:20Z.
- Architect lane delivered (8m 36s): plan 120 lines, parity rows 45-99. CLI Session ID `01a13723-248c-7ce3-8faa-6e711517a151` (resume for the revise round + item 11).
- Gate 2 reviewer: Claude sub-agent `plan-reviewer` (software-architect type), deliverable `implementation-plan-rail-r9-review.md`.
- Revise round 1 lane: codex `84a44856` delivered (7m 15s), CLI Session ID `01a13735-5fd2-7d91-af87-bb4106317604`. Re-reviewer: Claude sub-agent `plan-rereviewer`.
- Revise round 2 lane: codex `c387938d` delivered (3m 28s), CLI Session ID `01a13742-c518-7910-9696-403c2481bc83`. Final check: Claude sub-agent `plan-final-check`.
- Split addendum lane: codex `c9c0966e` delivered (4m 16s), CLI Session ID `01a1374f-4c52-7572-8281-8d040e6ef224`. Gate 2 reviewer: Claude sub-agent `split-reviewer`. Mode 1: team-leader sub-agent writing `batches-rail-r9.md`.
- Wave 1 (22:15Z): R9a codex `76113504`, R9d codex `ea025d57`, R9g codex `f2309cce`, R9b Claude fd-R9b, R9c Claude fd-R9c. Writers run specs through `.ptah/tmp/check-run.mjs` (machine-wide mkdir lock `%TEMP%\ptah-629-check.lock`, one heavy check at a time).
- R9a delivered (session `01a13756-10d6-7200-afdf-6f78060d69c1`), reviewer review-R9a. R9d delivered (session `01a13756-3178-74b1-ae6f-eb6df6686bda`), reviewer review-R9d. Addendum revise round 1: codex `19581dc0` (fresh lane, handoff brief).
- Session 8 (23:12Z, continuation from HANDOFF.md §3 step 1). Gate 0.1: lanes enabled (user /agent-lanes prompt), approval lane-review. `ptah_agent_list`: codex confirmed room (weekly 10%), opencode confirmed room (monthly 83%), copilot disabled, antigravity/grok/Glm unknown.
- Wave 1 reviews: R9b codex `ca532d75` (codex-review-R9b.md), R9c codex `e7cdc606` (codex-review-R9c.md), R9g Claude sub-agent reviewer-R9g (code-logic-review-R9g.md). Split addendum re-review: Claude sub-agent reviewer-split-addendum (implementation-plan-rail-r9-split-rereview.md).
- R9c review delivered: APPROVED 8/10, 1 Minor (keyboard activation test gap) recorded; no fix round. R9b review delivered: REVISE 6/10 (Serious 1 stale popover, Moderate 2 aria-disabled activates) -> fix round Claude sub-agent fd-R9b-fix. R9b reviewer CLI session `01a13789-af29-7293-9ec0-ecb7114899bb` (scoped re-review if needed).
- Wave 1 COMPLETE (team-leader Mode 2, `mode2-wave1-report.md`): R9a e24a8c93e, R9b c8d8bc95f, R9c 713ec57ae, R9d b9736bd4e, R9g 8f9d63757, docs c57d04e2b. Minor: 2 non-null assertions at subagent-tile.component.ts:80 (phase review).
- Split addendum: revise round 2 codex `08d8d182` (session `01a13796-1d8b-7a33-a7f2-d285ba4c9827`); final check APPROVED 8/10 (`-split-final-check.md`). User rows 85 (stack below 1440) and 86 (ephemeral). Revision 3 codex `f3562c8b`.
- Wave 2 (23:40Z): R9e codex `b2bad50b`, R9i opencode `733dc5b5`, R9n Claude fd-R9n, R9o Claude fd-R9o.
- Wave 2 reviews: R9e Claude APPROVE-WITH-FIXES 6/10 -> fix codex `cf636c26` (session `01a137b1-9a9c-74d1-8ec7-21c7be5dbdd0`), done; finding 2 -> R9h (row 89). R9i Claude APPROVED 9/10, no fix. R9o codex `8d777aa1` REVISE 6/10 -> fix Claude fd-R9o-fix, done (Minor: identical no-file turns share a key). R9n writer fd-R9n running (harness line approved, row 87).
- R9n review codex `b9ea6eb4` REVISE 6/10 (Escape loses agent draft; vanished agent leaves inert transcript) -> fix Claude fd-R9n-fix, done (5/5, 39/39, 15/15). Mode 2 W2a (R9i, R9o + R9u-R9x decomposition) team-leader-W2a running; R9e+R9n Mode 2 (chat) after it.
