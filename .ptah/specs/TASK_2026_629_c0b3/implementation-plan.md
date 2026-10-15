# Implementation plan: TASK_2026_629_c0b3 — Orchestra Canvas mission board

Status: **draft, waiting for user approval.** Do not start implementation until
the user approves this plan and `task-description.md`, and the TASK_2026_628
owner confirms that the overlap areas are settled.

This file is the merged plan. The detail for each step is in the part files:

- [plan-part-1.md](./plan-part-1.md): steps 1-3 (card mode, sampled summary, status card).
- [plan-part-2.md](./plan-part-2.md): steps 4-5 (Gridstack spike, detail row, lane tabs).
- [plan-part-3.md](./plan-part-3.md): steps 6-7 (needs-you queue, running-session cap) and the performance procedure.

When this file and a part file disagree, **this file wins.** The section
"Reconciled decisions" lists each change against the part files.

---

## 1. Reconciled decisions

The three parts were written in parallel. These decisions replace the parts
where they conflict.

### D1. Live-view rule (replaces the part 1 `autoCard` rule)

The prototype shows 0 live views with no detail open, and 1 live view in the
detail (`prototypes/01-board.html:98`). Step 1 must also ship alone, before the
detail row exists. So the rule has two phases:

| Tile count | Detail panel | Live transcripts |
|---|---|---|
| 1 or 2 (≤ `CANVAS_LIVE_BUDGET`) | not used | all tiles live (as today) |
| ≥ 3 | closed | the focused tile only, in its own grid slot |
| ≥ 3 | open for tab X | 0 tiles live. X is focused. X's transcript is in the detail panel |

Rule: `autoCard(tile) = tileCount > CANVAS_LIVE_BUDGET && (tile.tabId !== focusedTabId || detailOpen)`.

- Step 1 ships the rule without the `detailOpen` term. Step 4 adds that term.
- When the detail opens for X, X becomes the focused tab.
- In all states, at most one transcript is mounted (plus one open lane tab).
- When a lane tab is open in the detail, the Orchestrator transcript is not
  mounted (only the open tab mounts, part 2). That gives 0 transcripts + 1 lane view.

### D2. Agent sidebar inside cards

Part 1 found that the agent sidebar block (`chat-view.component.html:268-354`)
is outside the compact gate. Part 2 hides the sidebar in the canvas with
`HIDE_AGENT_SIDEBAR` in step 5. Step 1 must ship alone. So:

- Batch 1 checks first (part 1 assumption A5) whether the sidebar mounts in a canvas tile.
- If yes, batch 1 also gates the sidebar block on the new `showCompactCard`
  signal in `chat-view.component.html`. This is a chat-view change, not a tile change.
- Step 5 still adds the `HIDE_AGENT_SIDEBAR` provider in the tile, so the
  sidebar is also hidden in the live focused tile.

### D3. Permission responder lives in `chat`, not `canvas`

Part 2 puts `agent-permission-responder.ts` in the canvas lib. But part 1's
compact card (in `chat`) needs the same Allow/Deny logic, and `chat` cannot
import `canvas` (canvas imports chat). So:

- Create `libs/frontend/chat/src/lib/services/agent-permission-responder.ts`
  (+ spec) and export it from the `chat` barrel.
- Users: the compact card (step 3), the mini panel (step 5), the lane view (step 5)
  and the needs-you queue (step 6).
- It always passes the `requestId` to `clearPermission(agentId, requestId)`
  (part 3, `agent-monitor.store.ts:1509-1511`). Without the id, the store drops
  the first queue entry, which can be the wrong one.
- It keeps the same postMessage protocol as `tile-agent-mini-panel.component.ts:125-143`. No new host channel.

### D4. Lane-row click from a card into the canvas detail

The compact card (in `chat`) must open the detail on a lane (in `canvas`).
`chat` cannot import `canvas`. So:

- Add a token `SESSION_CARD_ACTIONS` in
  `libs/frontend/chat/src/lib/tokens/session-context.token.ts`. Its shape is
  `{ openLane(laneKey: string): void; openSession(): void }`. Optional injection.
- The canvas tile provides it. Each call goes to `CanvasDetailService`.
- In the main panel, the token is absent. The card then uses its existing `expandToFull` output.
- The lane-key format is defined by part 2 (`CanvasDetailService`). Part 1's
  `compact-lane-rows.ts` must produce the same keys. Put the key builder in
  `chat` (`compact-lane-rows.ts`) and let the canvas import it.

### D5. Sampler scope

The 500 ms sampler is in `CompactSessionCardComponent` and runs for every card,
in both the canvas and the main panel. It is **not** gated to the canvas.
`summarizeLive` has one caller (`compact-session-card.component.ts:122-139`).
TASK_2026_628 adds no sampler.

### D6. Detail row placement (Gridstack spike decision)

Use part 2 option (b): an overlay next to the grid, not a Gridstack item.

- The panel sits just below the clicked card's row.
- Rows below move down visually with `transform: translateY(var(--ptah-detail-h))`, as in the prototype.
- The Gridstack `x/y/w/h` values and the saved layout intents never change.
- Option (a), a full-width Gridstack widget, is rejected. With `float: false`
  it changes the `y` of every row below, and the next `grid.load` pass
  (`canvas-workspace-grid.component.ts:750-800`) removes it.
- If the spike says no-go, use option (c), a fixed bottom panel. On no-go, the grid file is not edited for step 4.

### D7. Running-session cap: start guard (gap G1 closed by 629)

The cap (step 7) gates the canvas "new session" paths (part 3). A message sent
to an idle tile also starts a turn (part 3 gap G1). The 628 owner declined the
guard (Q6) and 628 Batch 3 edits only the `AGENT_SUMMARY_CHUNK` handler in
`chat-lifecycle.service.ts` (~:186-196). So:

- 629 adds the start guard in the send/start-turn path, in its own batch (B10),
  **after** the rebase over 628. The executor locates the exact send path first.
- The guard must stay out of the `AGENT_SUMMARY_CHUNK` handler.
- When the cap blocks a send, the message is not sent, the draft stays in the
  composer, and the user sees the same text as the disabled "new session" button.
- The guard counts only canvas sessions (`countRunningSessions`). The single
  chat view outside the canvas is not capped.

### D8. Deciding tab for permission answers (Q7)

`StreamRouterService` (`libs/frontend/chat-routing/src/lib/stream-router.service.ts:87-96`)
is the only reader of `decisionPulse`. It cancels the same prompt on every tab
except `decidingTabId`. `handlePermissionResponse` records the active tab
(`permission-handler.service.ts:~426`). An answer from the canvas header or a
card is for a tab that is often not the active tab. Then the router cancels the
prompt on the wrong set of tabs.

- 629 adds an optional `tabId` parameter to `handlePermissionResponse`. When it
  is present, it is the deciding tab. When it is absent, the active tab is used (as today).
- The needs-you queue (step 6), the card callout (step 3) and the lane view
  (step 5) always pass the tab id of the request.
- Add a spec test: an answer with an explicit `tabId` that is not the active tab
  publishes `decidingTabId = tabId`.
- 628 does not touch `permission-handler.service.ts`.

---

## 2. Parity checklist

These features must not change. Each part file cites where they live.

- Gridstack layout, manual resize and span intents (no `x/y/w/h` change from any 629 feature).
- Per-workspace keep-alive grids.
- Transcript retention LRU and the render window (18 mounted messages).
- Send to Messaging.
- Compact/full view toggle. The automatic card mode never writes the stored per-tab view mode.
- 1 and 2 sessions behave as today.
- The agent monitor sidebar in the single chat view (outside the canvas).
- The compact view in the main panel keeps working. It gets the new card layout (it is the same component).

---

## 3. Steps (summary)

| Step | What | Detail |
|---|---|---|
| 1 | `CANVAS_LIVE_BUDGET = 2`, `SESSION_FORCED_CARD` token, `showCompactCard` in ChatView, `autoCard` per tile (D1, D2) | part 1 §1 |
| 2 | 500 ms sampler in the compact card; urgent changes (permission, question, error, status) skip the wait (D5) | part 1 §2 |
| 3 | Status card zones, Lanes table (max 3 rows + "+N more"), callouts; lane rows from public `AgentMonitorStore` signals (D3, D4) | part 1 §3 |
| 4 | Spike, then `CanvasDetailService`, detail panel, Orchestrator transcript, session details column, Esc / ←/→ (D1, D6) | part 2 §4 |
| 5 | Lane tabs (Orchestrator, Sub-agents, CLI lanes, Background); reuse `ptah-agent-card` unchanged; `HIDE_AGENT_SIDEBAR` in the tile | part 2 §5 |
| 6 | `buildNeedsYouItems` + `CanvasNeedsYouQueueComponent` in the canvas header | part 3 §6 |
| 7 | `MAX_RUNNING_SESSIONS = 9`, `countRunningSessions`, gate on the canvas new-session paths and the send/start-turn path (D7) | part 3 §7 + D7 |
| perf | Manual DevTools procedure, 6 streaming sessions, `perf-before-after.md` | part 3 §perf |

---

## 4. Files to touch

| Path | Create/modify | Step | Overlap with 628? |
|---|---|---|---|
| `libs/frontend/canvas/src/lib/canvas-live-budget.ts` (+ spec) | create | 1 | no |
| `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts` | modify | 1, 4, leak | no (the leak moved to 629; 628 edits no canvas file). 629 changes: the `[autoCard]` binding (template ~:126-130), one input (~:202), one computed near ~:362, template after ~:144, styles, and the leak release (see plan-part-4.md). Step 4 hunks are skipped on no-go. |
| `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.spec.ts` | modify | 1, leak | no |
| `libs/frontend/canvas/src/lib/canvas-workspace-grid.detail.spec.ts` | create | 4 | no |
| `libs/frontend/canvas/src/lib/canvas-tile.component.ts` | modify | 1, 4, 5 | no (628 confirmed it does not touch this file). 629 adds the `autoCard` input and provider lines in `:618-623` (`SESSION_FORCED_CARD`, `SESSION_CARD_ACTIONS`, `HIDE_AGENT_SIDEBAR`). |
| `libs/frontend/canvas/src/lib/canvas-tile.component.spec.ts` | modify | 1 | no |
| `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts` | modify | 4, 6, 7 | no (header `:111-129`, `:391-397`, `:550-555`, provider for `CanvasDetailService`) |
| `libs/frontend/canvas/src/lib/orchestra-canvas.component.spec.ts` | modify | 6, 7 | no |
| `libs/frontend/canvas/src/lib/orchestra-canvas.detail.spec.ts` | create | 4 | no |
| `libs/frontend/canvas/src/lib/canvas.store.ts` (+ spec) | modify | 7 | no (2 computeds + the stale comment at `:85-91`) |
| `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail.service.ts` (+ spec) | create | 4 | no |
| `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-panel.component.ts` | create | 4 | no |
| `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.ts` | create | 4 | no (normal tab path, `tab-<id>` build, no `buildTree` call, no cache key) |
| `libs/frontend/canvas/src/lib/canvas-detail/canvas-session-details.component.ts` (+ spec) | create | 4 | no |
| `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts` (+ spec) | create | 5 | no |
| `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts` (+ spec) | create | 5 | no (mounts `ptah-agent-card` unchanged) |
| `libs/frontend/canvas/src/lib/tile-agent-mini-panel.component.ts` | modify | 5 | no (`:125-143` delegates to the responder) |
| `libs/frontend/canvas/src/lib/canvas-needs-you-queue.ts` (+ spec) | create | 6 | no |
| `libs/frontend/canvas/src/lib/canvas-needs-you-queue.component.ts` (+ spec) | create | 6 | no |
| `libs/frontend/canvas/src/lib/canvas-running-cap.ts` (+ spec) | create | 7 | no |
| `libs/frontend/chat/src/lib/tokens/session-context.token.ts` | modify | 1, 3 | no (`SESSION_FORCED_CARD`, `SESSION_CARD_ACTIONS`) |
| `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts` / `.html` / `.spec.ts` | modify | 1 | no |
| `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts` (+ spec) | modify | 2, 3 | no 628 file. It is the only `summarizeLive` caller (628 changes the callee only). |
| `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-lane-rows.ts` (+ spec) | create | 3 | no |
| `libs/frontend/chat/src/lib/services/agent-permission-responder.ts` (+ spec) | create | 3 | no |
| `libs/frontend/chat/src/index.ts` | modify | 1, 3 | no (exports) |
| `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-lane.types.ts` | create | 3 | no |
| `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.ts` (+ spec) | modify | 3 | no |
| `libs/frontend/chat-ui/src/index.ts` | modify | 3 | no |
| `libs/frontend/chat-streaming/src/lib/permission-handler.service.ts` (+ spec) | modify | 6 (D8) | no (628 does not touch it). Optional `tabId` parameter on `handlePermissionResponse`. |
| Send/start-turn path for the cap guard (the executor locates it; may be `libs/frontend/chat/src/lib/services/chat-lifecycle.service.ts`) (+ spec) | modify | 7 (D7) | **yes, if it is `chat-lifecycle.service.ts`**: 628 Batch 3 edits only the `AGENT_SUMMARY_CHUNK` handler (~:186-196). The guard stays out of that handler. B10 runs after the rebase. |
| `libs/frontend/canvas/src/lib/canvas-grid-release.ts` | create | leak (BL) | no |
| `libs/frontend/canvas/src/lib/canvas-grid-release.engine.spec.ts` | create | leak (BL) | no (real GridStack engine, no mock) |
| `libs/frontend/canvas/src/lib/canvas-render-metrics.service.ts` | modify | leak (BL) | no (`releasedNodes`, `geometryDrift` counters) |
| `.ptah/specs/TASK_2026_629_c0b3/spike-detail-row.md` | create | 4 | no |
| `.ptah/specs/TASK_2026_629_c0b3/perf-before-after.md` | create (manual) | perf | no |

Not touched (owned by 628): `compact-session-summary.ts`, `chat-transcript.component.ts`,
`libs/frontend/markdown`, `batched-update.service.ts`, the execution tree builder,
the `AGENT_SUMMARY_CHUNK` handler in `chat-lifecycle.service.ts`, `agent-monitor.store.ts` and the agent-card output files,
`tab-manager.service.ts`, `stream-presentation-store.service.ts`, `apps/ptah-extension-webview/src/styles.css`.

---

## 5. Depends on TASK_2026_628

Confirmed by the 628 owner:

1. 628 makes `summarizeLive` linear. 629 step 2 only limits how often it runs (D5).
2. 628 Batch 4 keeps the `AgentMonitorStore` public signal names and shapes. The owner tells 629 before any change lands.
3. 628 Batch 5 moves tiles to the `tab-<id>` tree key and removes the `tile-` key. The 629 detail transcript uses the same build and never calls `buildTree` with its own key.
4. **User decision: the detached canvas tile leak (628 hot spot 7) moved to 629.**
   628 now edits no canvas file. There is no overlap in
   `canvas-workspace-grid.component.ts` or its spec. The leak fix is planned in
   [plan-part-4.md](./plan-part-4.md) (batch BL).
5. The performance baseline is `main` after 628 merges.

629 uses two 628 results when they land, with no rebase over a canvas change:
628 Batch 5 (`tab-<id>` tree key) and Batch 6 (linear `summarizeLive`).

Requests to 628 — **decided** (628 owner answers):

| # | Request | Decision |
|---|---|---|
| Q1 | Keep the grid template and input anchors stable. | Yes. 628 does not edit the template, the input at ~:202 or the computed near ~:362. Lines can shift: rebase by symbol. |
| Q2 | Keep the tile provider list as an array. | Yes. 628 does not touch `canvas-tile.component.ts`. |
| Q3 | Keep the public way to set `agent.expanded`. | Yes. 628 Batch 4 keeps the public `AgentMonitorStore` API. |
| Q4 | Two ChatViews of the same tab must not start a second `tab-<id>` build in one frame. | Yes, if both read the tree through `StreamPresentationStore` (never `buildTree` directly). 628 Batch 5 builds once for each published tab snapshot and adds a test with two ChatViews in one frame. **629 rule:** the detail transcript uses `ChatViewComponent` on the normal path only. |
| Q5 | Keep a reactive "turn in flight" tab status. | Yes. 628 Batch 5 skips the copy in `updateTabInternal` only when nothing changed. Every status change still publishes. |
| Q6 | Start guard for the running cap (gap G1). | 628 declines. **629 adds the guard** in batch B10, after the rebase, in the send/start-turn path. Not in the `AGENT_SUMMARY_CHUNK` handler (D7). |
| Q7 | Deciding tab for permission answers. | The only reader of `decisionPulse` is `StreamRouterService` (`chat-routing/src/lib/stream-router.service.ts:87-96`). **629 owns the fix** (D8). |
| Q8 | Keep the `summarizeLive` / `summarizeFinalized` signatures. | Yes. 628 Batch 6 changes internals only and does not touch `buildSummary`. |

---

## 6. Assumptions to check first

Each batch starts by checking its assumptions, and stops if one fails.

- Part 1 A1-A10. The main ones: A3 (the store signal names and status values in
  `agent-monitor.store.ts`), A4 (the method that answers a session permission), and
  A5 (whether the sidebar mounts in a canvas tile, see D2).
- Part 2 A1-A6. The main ones: whether context-bar and git components exist, and
  `BackgroundAgentStore` as the source for background tabs.
- Part 3 A1-A8. The main ones: whether `chat-streaming` exports `agentVisibleInSession`,
  which `TabState.status` values mean a turn is in flight, and how the host treats a
  stale lane `requestId`.
- Parts 1 and 3 did not open the prototype. Batches 3 and 7 compare the card zones and
  the queue popover with `prototypes/01-board.html` and `shared.css` before coding.

---

## 7. Batches (handoff to the team-leader)

Executor for all batches: `frontend-developer`. Each batch is one commit.

| Batch | Step | Files (short) | 628 overlap | When |
|---|---|---|---|---|
| B1 | 2 | compact card sampler + spec | no | any time |
| B2 | 3 | responder, lane types, lane rows, activity component, card, barrels | no | any time |
| B3 | 7 | running cap, `canvas.store`, `orchestra-canvas` new-session paths | no | any time |
| B4 | 6 | needs-you queue + component, `orchestra-canvas` header, `permission-handler.service.ts` optional `tabId` (D8) | no | after B2 (responder), B3 (same file, other hunks) |
| B5 | 1 | live budget, tokens, chat-view, tile `autoCard`, grid binding | no | after B1-B4 |
| B6 | 4 spike | `canvas-workspace-grid.detail.spec.ts`, `spike-detail-row.md` | no | after B5. Go/no-go gate |
| B7 | 4 | detail service, panel, transcript, session details, grid overlay hunks, `orchestra-canvas` | no | after B6 = go |
| B8 | 5 | lane tabs, lane view, mini panel, tile `HIDE_AGENT_SIDEBAR` | no | after B7 |
| BL | leak | `canvas-workspace-grid.component.ts` (`applyAuthoritativeGeometry`, `ngOnDestroy`), new `canvas-grid-release.ts` + real-engine spec, grid spec, `canvas-render-metrics.service.ts`. Pin live nodes (`locked`) during the release, so `_packNodes` cannot close row-break gaps. See plan-part-4.md | no (moved from 628) | after B5b, before the B6 spike |
| B10 | 7 (D7) | cap start guard in the send/start-turn path (+ spec) | **yes, if in `chat-lifecycle.service.ts`** (stay out of the `AGENT_SUMMARY_CHUNK` handler) | after the rebase over 628 |
| B9 | perf | `perf-before-after.md` | no | manual, by the user, after rebase onto main. Last. |

B1-B8 do not touch 628 files and can start after user approval. 628 edits no
canvas file now. Only B10 waits for 628 Batch 3 to merge (if the guard is in
`chat-lifecycle.service.ts`), then this branch rebases. B7 shows the transcript
through the normal ChatView path, so it works before and after 628 Batch 5. B4 changes
`permission-handler.service.ts` in `@ptah-extension/chat-streaming`. Verify that
project too in B4 (`npx nx test @ptah-extension/chat-streaming --parallel=1`).

Spike go/no-go (B6): every tile keeps its `x/y/w/h` after the detail opens, after a
forced layout pass, and after the detail closes. A manual webview check confirms
alignment and scroll. No-go: use the fixed bottom panel (D6), with no grid edit for step 4.

### Verification for each batch (STRICT, from CLAUDE.md)

Repeat these rules in every executor prompt:

- Test only the changed projects:
  - `npx nx test @ptah-extension/chat-ui --parallel=1` (B2)
  - `npx nx test @ptah-extension/chat --parallel=1` (B1, B2, B5)
  - `npx nx test @ptah-extension/canvas --parallel=1` (B3-B8)
  - Or Jest on the changed spec files: `npx jest -c <lib>/jest.config.ts <spec...> --coverage=false --maxWorkers=2`.
  - The same for `typecheck` and `lint` on the same projects.
- One heavy check at a time. TASK_2026_628 runs checks on the same machine.
- No workspace-wide runs. No `build`, `serve`, `dev`, `e2e` or `package`.
- Filter the output (`| tail`, `grep`). Do not re-run a command only to read it again.
- Do not run `npm install`. The parent links `node_modules` before implementation.

---

## 8. Performance record

The procedure and the template are in part 3 §perf. Summary:

- 6 streaming sessions, 3 runs for each build, report the median.
- Record: DOM node count, long tasks over 100 ms, Recalculate Style total and
  average, renderer private memory.
- Before = `main` after TASK_2026_628 merges. After = this branch rebased onto that `main`.
- The user records the numbers in `perf-before-after.md`.
