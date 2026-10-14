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
- Wave 2 COMPLETE (R9o b78468290, R9i df3b88e8d, R9e df4e9977b, R9n 7ef8d53d3, docs ca4021597). Wave 3 COMPLETE (R9p 1fd6e99cb, R9j 77b41f02c, R9q 9a17fd085, docs 4650b78b0). 12/24 batches. Session 8 ended at the user's request with HANDOFF.md (eighth handoff); previous handoff kept as handoff-7.md.
- Session 9 (continuation from handoff-8.md §3 step 1). Gate 0.1: lanes enabled (user /agent-lanes prompt), approval lane-review. `ptah_agent_list`: codex confirmed room (weekly 12%), opencode confirmed room (5-hour 17%, weekly 26%, monthly 87%), copilot disabled, antigravity/grok/Glm unknown (not used for shipping code, row 78).
- Wave 4 + H1 (01:09Z): R9m opencode `f919a93b`, R9r opencode `81849da8`, R9h codex `4ad228a9` (row 89 dock specs). Reviewers after delivery: Claude code-logic-reviewer per batch.
- R9m delivered (9m 10s, session `ses_ec80aee3fffehLps1K0f2i9ocI`); reviewer reviewer-R9m (code-logic-review-R9m.md).
- R9h delivered (13m 16s, session `01a137f5-9a00-73b0-b3e9-1c3a3bb57c13`): ret 16/16, keep 2/2 (NG0101 logged), dock 22/22; reviewer reviewer-R9h (code-logic-review-R9h.md).
- R9m review APPROVED 9/10, 3 Minors (mcp-bench fixtures; row 60 leak guarantee -> s-heap; Escape-from-lane-tab case without exact Rail twin). No fix round.
- R9r delivered (19m 36s, session `ses_ec80aa197ffes42MzmrUywH5uu`): 60/60, 23/23, 94/94; also removed unused getTabCompactHeightUnits; reviewer reviewer-R9r (code-logic-review-R9r.md).
- R9r review APPROVED 9/10, 2 Minors (rewritten viewMode reload case passes without real restore; carry-over: tab-persistence restore still stamps compactHeightUnits: 2 and save writes it -> R9s lane prompt must remove that restore code and the legacy constants). No fix round. Mode 2 for R9r (chat-state) queued after team-leader-W4a.
- Wave 4a COMPLETE: R9m b3626c50d (canvas 269/269, TC pass, lint 0 errors/16 warnings). Mode 2 W4b (R9r, chat-state) team-leader-W4b running. Wave 5 (01:37Z): R9k codex `2c99d78a`, R9s opencode `8dbf5043` (prompt carries R9r Minor 2 carry-over).
- R9h review APPROVE-WITH-FIXES 7/10 (S1 real ChatView Rail path untested; M1 main-panel destroy clears memos; M2 strict spec has no positive case; M4 closed context tab stays rendered). Fix round codex `a46b287a` (fresh lane, writer idle > 10 min) on S1, M1, M2, M4 (M1/M4 break named contract points; M2 weakens the R9f gate spec). Recorded not fixed: M3 (non-retaining tiles are not cache owners), m1-m3, formatting.
- Wave 4 COMPLETE: R9r cea73f11f (chat-state 566/566, TC pass, lint 0 errors); docs bd7414b93. R9k delivered (5m 52s, session `01a1380e-b416-7551-bbc1-4471937e3b05`, spec 5/5); reviewer reviewer-R9k.
- R9h fix round done (ret 18/18, keep 2/2, dock 26/26; M3, m1-m3 not fixed). Mode 2 H1 team-leader-H1 running (chat FULL/TC/LINT, both decision-89 specs by name).
- R9h fix lane session `01a13810-5956-79e1-80f2-726186972273`.
- R9k review APPROVE-WITH-FIXES 7/10. Fix round codex `addc14ff` on finding 1 (spec self-import via @ptah-extension/canvas, vacuous Tribunal test). Routed: finding 3 (e2e Layout options/presets selectors canvas.spec.ts:145,553,569,883,898) -> R9l (already in its contract); finding 6 (stale comments canvas-layout-intent.ts:8,23,292, canvas.store.ts:42,82) -> R9t prompt. Recorded: finding 2 (stale CanvasLayoutService mocks orchestra-canvas.component.spec.ts:241-248,735-740, no owner), 4 (vacuous selector-absence guards), 5, 7.
- R9k fix done (session `01a1381d-e749-7bb0-b616-5a2d9e8c54ac`, 5/5). R9k Mode 2 queued after team-leader-H1.
- R9s delivered (34m 2s, session `ses_ec7f0ecf6ffeaqO7dvXozwMPva`, 40/40, 9/9); reviewer reviewer-R9s (write-path trace).
- H1 COMPLETE: R9h 43d48bf89 (chat 3705 pass/2 skipped, TC pass, lint 0 errors; both decision-89 specs pass by name via Jest JSON). Existing HIDE_AGENT_SIDEBAR: true at canvas-detail-transcript.component.ts:56 (R9f removes) and tribunal conductor-tile.component.ts:221 (phase review must judge against row 77d).
- H2 (02:14Z): R9f codex `0a40562d` (also provides RAIL_TRANSCRIPT_RETENTION). Mode 2 W5a (R9k) team-leader-W5a running.
- R9s review APPROVED 8/10, 3 Minors, no fix round. Mode 2 W5b (R9s) queued after W5a. Routed to R9t: clampCompactHeightUnits and tileViewConstraint in canvas-layout-intent.ts appear to have no production caller.
- W5a COMPLETE: R9k e8e190455 (canvas 247/247, lint 0 errors; TC canvas + tribunal-panel failed only on R9s tab-persistence.ts:171 TS2367 -> orchestrator one-line fix, row 92). Next: Mode 2 W5b (R9s) + R9t lane.
- W6 (02:33Z): R9t codex `2a663fe8` (carries R9k finding 6 + R9s reviewer note). Mode 2 W5b (R9s) team-leader-W5b running. R9f writer reported done (6/7/6/1; self-reported gaps: Rail fenced-display integration, steer/copy, reduced motion); reviewer reviewer-R9f.
- R9f delivered (18m 20s, session `01a13830-d65c-71d3-9009-0c7e5f84350e`).
- R9t delivered (6m 42s, session `01a13841-cb77-7b63-9128-b6fc8a5e159f`, 17/17, 37/37); reviewer reviewer-R9t.
- R9t review APPROVE-WITH-FIXES 8/10: 2 Moderate (stale comments in canvas-layout-intent.ts: deleted lock; removed height clamp), 3 Minor. Zero callers of removed symbols; old v3 grid record loads as Rail. User asked to stop after this round (R9f/R9t reviews) and hand off (handoff-9.md).
- R9f review REVISE 5/10 (S1-S5, M1-M6, m1-m3). Session 9 ended at the user's request after the R9f/R9t reviews; handoff-9.md written. R9f + R9t code left uncommitted in W (12 paths, handoff-9 §1).
- Session 10 Gate 0.1 (handoff-9 §3 step 1): lanes enabled, Approval lane-review (unchanged). codex installed, confirmed room (weekly 15%, reset 2026-10-20 14:59Z); opencode installed, confirmed room (5-hour 0%, weekly 31%, monthly 89%); antigravity/grok/Glm unknown limits (not used for shipping code, row 78); copilot disabled; cursor/pi not installed. Tree: exactly the 12 R9f/R9t paths uncommitted, HEAD 332d6fcf4.
- R9t COMMITTED ad3234690 (Mode 2 mode2-wave6-report.md: canvas TC/lint green, no R9t test failure). R9f fix lane 0e8bd1d0 delivered (session 01a13af3-9e5c-70f2-9144-50e39fc15660; lane 12/12, transcript 8/8); row 97 answered S5c. Scoped re-review reviewer-R9f-fix running.
- R9f re-review code-logic-review-R9f-fix.md APPROVE-WITH-FIXES 7/10 (N1 focus steal, N2 lane-tabs undo M2, N3 weak guard, N4 noted). Row 98: one post-cap correction, codex lane 00ea2ac3 (15:35Z). opencode monthly now 90% (near limit, reset 2026-11-04): prefer codex/Claude for remaining writers.
- R9f correction (codex 00ea2ac3, session 01a13b0d-ab48-70a1-9061-5ef074093b07) reviewed: code-logic-review-R9f-correction.md APPROVED 8/10 (N1-N3 FIXED). Recorded for PR: reverse bg:->sub: migration not handled, stale opener after mixed open path, late record can pull focus to Back, sub:->bg: key change remounts lane content. Mode 2 team-leader-H2 running.
- R9f Mode 2 (mode2-h2-report.md) FAIL on lint only: 9 errors in canvas-detail-transcript.component.spec.ts (8 relative imports into chat internals, 1 stub selector). Tests 255/255, TC pass, no HIDE_AGENT_SIDEBAR in canvas. Lint-only codex lane 89791f17 (15:51Z), spec-only, no new review (lean rule 3). Then re-run FULL+LINT canvas before commit.
- R9f lint lane 89791f17 fixed 9 errors (public barrels + PTAH_UI_DISPLAY_DOCK_SYNC). Orchestrator re-check: FULL canvas 255/255, TC pass, LINT 0 errors. R9f COMMITTED 19db607e8 (10 paths). Next: docs commit, then H3 R9l codex.
- H3 R9l: codex e89cf26d (4m54s, session 01a13b24-a697-7b51-86f3-00843e961959; 8 files incl. persistence spec; specs 6/6, 30/30, 25/25). Review code-logic-review-R9l.md APPROVE-WITH-FIXES 6/10 (S1 deleted 'Create new session' button in 3 e2e cases). Row 99. Fix round codex c243c555 (16:15Z, test-only).
- R9l fix round c243c555 (session 01a13b31-c2bf-7510-9194-207ddbd95e49). Mode 2 mode2-h3-report.md PASS (canvas+e2e TC/lint 0 errors). R9l COMMITTED 27be43205. H1-H3 all committed -> R9u (H4) unblocked.
