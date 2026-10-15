Verdict: REVISE — 6/10

Gate 2 cross-side review (Claude reviewing the codex plan lane) of `implementation-plan-rail-r9.md` and inventory rows 45-99.
Scope is right. Items 1, 2-3, 5, 6, 7, 9 and 10 are covered, and items 4 and 8 are not reintroduced. 19 file:line contracts were
spot-checked and all of them resolve. Examples: `orchestra-canvas.component.ts:136-170,718-736`, `chat-view.component.ts:237-250,548,808-845,1221-1238`,
`canvas-focus-area.component.ts:54-61`, `canvas-detail-transcript.component.ts:46-57`, `execution-node.component.ts:294-366`,
`message-bubble.component.html:104-111`, `chat/src/lib/components/index.ts:145`, `canvas-rail-card.component.ts:35-40`,
`canvas-rail-board.component.ts:321-329`, `canvas-layout-persistence.service.ts:42-58,220-245,312-322`, `agent-monitor.store.ts:886-894`,
`tribunal-page.component.ts:9,14`, `package.json:174`, `packaged-deps.spec.ts:174`. The gridstack keep decision is correct.
The plan still has nine Serious defects, and they would stall execution or lose capabilities.

## Findings

1. **Serious — the lane view's keyed block destroys the one ChatView.** Plan line 14 says `@for (key of [laneKey()]; track key)` "switches only
   lane content". That is false. In `canvas-lane-view.component.ts:50-115` that block wraps the `@default` `<ptah-canvas-detail-transcript>`.
   Two things destroy the ChatView and its retained LRU: opening any `sub:`/`bg:`/CLI lane, and focusing a tab whose stored lane differs
   from the current one. "Back without destroying the ChatView" (plan line 32) is impossible as designed.
   Fix (R9f): mount the orchestrator transcript outside the keyed block and keep it mounted. When another lane covers it, hide it and set
   its `SESSION_VISIBLE`/`SURFACE_ACTIVE` signal to false so it freezes. Key only the non-orchestrator content. Spec cases: `sub lane open and
   back keeps the same ChatView instance and draft`; `covered orchestrator transcript is frozen`.
2. **Serious — session overrides freeze only for the first tab.** `canvas-session-overrides.ts:11-35` reads `tabId()` inside `untracked`, so
   with a stable host only the first focused tab gets its effort/model frozen. Fix: add `canvas-session-overrides.ts` to R9f (7 files) and
   track the tab id. Spec: `each newly focused tab freezes its own effort and model`.
3. **Serious — R9-D6 cap 8 is a guess.** Each visited transcript adds 5k-17k elements (`switch-baseline.md:18-43`), so 8 retained can mean
   ~135k hidden elements in one ChatView. `s-heap.mjs:30-39` counts detached nodes only, so heap and DOM size are never measured. The main
   panel ChatView also stays mounted in canvas mode (`app-shell.component.html:795-829`) and keeps its own LRU, which `canvas.store.ts:502`
   `switchTab` drives. Retention also clears a shared cache: `dispose()` calls `clearForTab` (`transcript-retention.service.ts:123-130`) on
   the shared key `tab-${id}` (`chat-transcript.component.ts:404-410`). So eviction in either LRU clears the cache of a tab the other
   surface is still rendering live, and that forces a rebuild long task.
   Fix: set the Rail host cap to 4 (the 4-session script). Supply it from the Rail opt-in token, not the shared constant. Raise it only with
   a measured result. In the Rail mode, the retention effect follows the `SESSION_CONTEXT` value, not `activeTabId`
   (`transcript-retention.service.ts:66-75`). Clear the tree cache only when no other retainer holds that tab. Extend the `s-heap` and
   `s-switch` reports with JS heap used and the document element count, before and after. Spec cases: `fifth tab evicts LRU at cap 4`;
   `eviction does not clear a tab another surface retains`.
4. **Serious — strict Agents hides unresolved agents everywhere.** `chat-view.component.ts:541-549` `sessionAgents` feeds the dock and the
   fallback monitor in every host. In Electron no unscoped monitor mounts: the only mounts are `chat-view.component.html:313,352` and
   `display-dock.component.ts:203`, all embedded. So the "global monitor" in plan line 16 and in R9e's case does not exist, and unresolved
   agents would be shown nowhere. Fix: apply strict ownership only when `SESSION_CONTEXT` exists (Rail). The main panel stays tolerant. R9e
   filters the workflow/session groups (`agent-monitor-panel.component.ts:765,776`) strictly only in scoped hosts. Spec both hosts.
5. **Serious — the single-view tile click has no design, file or spec.** No `SESSION_CARD_ACTIONS` provider exists outside the canvas
   (`subagent-render-trace.md` finding 5). Item 7 requires a full view with a way back in the single chat view. The plan names this only in
   row 92 and re-check #7. Fix: name the component that shows the in-place live full view with Back, and say where it mounts (chat-view or
   chat-transcript). Assign it to R9n or R9h. Spec: `single view tile opens live full view; Back restores the transcript scroll`.
6. **Serious — the full lane must render the agent node, not only its descendants.** Plan line 34 renders "descendants". Inventory rows 86-95
   (stop, background, steer, RPC error line, auto-scroll, stats footer) live in `inline-agent-bubble.component.ts`, which only the agent
   branch mounts (`execution-node.component.ts:336-366`). Fix: render `<ptah-execution-node [node]="agentNode">` with tile mode off. Add
   R9f cases for stop, background, steer, copy, a nested agent at depth 2, and a sub-agent permission answered in the lane.
7. **Serious — the batch order leaves red states between batches.**
   (a) `canvas/src/index.ts:2,6-9` exports `CanvasTileComponent`, `CanvasLayoutService`, `TileAgentIndicatorComponent` and
   `TileAgentMiniPanelComponent`. But R9l owns `index.ts` and runs last, after R9j and R9m delete those files.
   (b) After R9b removes the Grid path, `orchestra-canvas.detail.spec.ts` (owned by R9j) fails the canvas suite that R9b must run.
   (c) If R9a narrows `CanvasBoardMode`, `canvas-detail.service.ts:47` (R9l) and `orchestra-canvas.component.ts` stop compiling.
   Fix: move the export edits in `index.ts` into the first deletion batch. Move the deletion of `orchestra-canvas.detail.spec.ts` into R9b.
   R9a accepts `'grid'` only at the schema seam, and the type narrows in the batch that removes the last comparison. State "every batch
   ends green on test, typecheck and lint".
8. **Serious — R9k "delete" breaks Rail and Tribunal.**
   - `CanvasLayoutService.containerWidth` feeds `railWidthBand` (`canvas-rail-board.component.ts:136,170`; observed at
     `orchestra-canvas.component.ts:480`).
   - Tribunal imports `TileLayout` from `@ptah-extension/canvas` (`tribunal-state.service.ts:19`, `tribunal-ui.types.ts:2`).
   - `MAX_CANVAS_TILES`, `TileIntent`, `logicalRows` and `migrateCanvasIntentV1` are used by `canvas-rail.component.ts:15`,
     `canvas-layout-persistence.service.ts:4-9,103-130` and `canvas.store.ts:19-30`.
   Fix: R9k slims these two files against an explicit keep list (container width observer, `TileLayout`, tile cap, intent type and
   order/migration helpers). If R9k touches `canvas-rail.component.ts` and its spec (`DEFAULT_TILE_WIDTH`), add them to a batch.
9. **Serious — the persistence migration would lose boards.** `tilesSchema` is a `strictObject` that requires `width` and `rowBreakBefore`
   (`canvas-layout-persistence.service.ts:29-40`). If the writer emits "only order and identity" under version 3, the plan's own reader
   rejects that record and returns `tiles: null`. The plan also omits the v1 branch (`:236-243`). Fix: keep the v3 tile shape (write the
   width and row break values unchanged, or their defaults), and only normalize `board.mode` `'grid'` to `'rail'` (`:48`). R9a cases:
   v3 grid, v2, v1, malformed, newer read-only, `write then read round-trips`.
10. **Moderate — Grid removal gaps.**
    - `canvas-live-budget.spec.ts` imports a file that R9i deletes but is in no batch.
    - `canvas-gesture-observation.ts` is used only by the Grid and is in no batch.
    - `canvas-empty-state.component.ts` is exported and shown only for Grid (`orchestra-canvas.component.ts:295-310`): use it for an empty
      Rail board or delete it.
    - The Grid-only tab state `compactHeightUnits`/`setCompactHeight` (`tab-manager.service.ts:2947-2998`, `tab-persistence.ts:182-195`):
      state whether it is kept or removed.
    - e2e `task-337-agent-card-refresh.spec.ts:58,184` asserts the inline bubble in the main transcript: update it without running it.
11. **Moderate — item 1 details.** Rail `newSession` (`canvas-rail-board.component.ts:321-329`) also resets `geometryBaseline`, focuses and
    anchors. `handleCreateSession` (`orchestra-canvas.component.ts:722-732`) does not check `canAddTile()` or a null `addTile` result. Its
    trigger anchor is the Grid-gated header (`:167-170`). Define the Rail anchor (footer button and empty board), and keep focus, anchor and
    the baseline reset. Spec: `0 tiles: empty-board trigger opens the same popover`.
12. **Moderate — tile visual and name.** The handoff requires the background-agent tile style. The trace says the strip row is not
    reusable and points to its formatters (`background-agent-strip.component.ts:96,109`). The plan does not name its visual source. The name
    `agent-execution-tile` also sits next to the dead `agent-execution.component.ts`. Fix: name the reused formatters and status icon, choose
    a distinct name (e.g. `subagent-tile.component.ts`), and record that the dead component is left untouched.
13. **Moderate — first-run full suites.** Only R9a runs a full suite (canvas). Handoff §3 step 2 means the first test run after the merge.
    The first batch that touches chat and the first that touches chat-ui must also run their full project suites, serially.
14. **Moderate — re-check gaps.** The list lacks:
    - an item-1 step: the footer and the empty board open the named popover, and a typed name is kept;
    - a Tribunal Gridstack smoke test for the keep decision;
    - full-lane stop, background, steer and permission answer;
    - a draft that survives a sub-lane open and Back;
    - `s-heap` reporting the retained transcript count against the cap, plus heap MB.
    Also record that a workspace switch rebuilds cold, because `canvas-rail-board.component.ts:50` gates the board on `visible()`.
15. **Minor.**
    - The retention cap constant is at `transcript-retention.service.ts:20`, not `:16-18`.
    - "Focuses the result" is new behaviour for the popover path, not current behaviour.
    - State the intentional tolerant keeps: the resume banner (`chat-view.component.ts:790-803`) and the background tray
      (`background-agent-tray.component.ts:219-225`).
    - Keep the gridstack CSS in `styles.css:13`.
    - App-shell `layoutMode() === 'grid'` means the canvas surface, not the Grid board: do not rename it.
    - The `gridUpdates` metric (`canvas-render-metrics.service.ts:8,27`) becomes dead.

## Item 11 constraints

- Files item 11 will touch (all in chat-ui): `organisms/display-panel/turn-summary.component.ts` and `turn-summary.component.spec.ts`,
  `turn-summary-files.component.ts` and `turn-summary-tests.component.ts`, and possibly `display-panel.component.ts` and its spec if inputs
  change. It reads (or extracts shared styles from) `molecules/turn-recap/turn-summary-chip.component.ts` and `turn-summary.model.ts`.
- Collisions: none. No R9 batch owns these files. R9n owns only `ptah-ui-display-chip.component.spec.ts`, and R9e/R9h own the dock specs in
  chat. Constraint: `chat-view.dock.spec.ts` (R9h) asserts the Turn summary by presence or `data-testid` only, not by card markup.
- Boundary: chat-ui only. No import from chat or canvas.
- Order: add it as its own batch, e.g. R9o (at most 6 files), with no dependency. Run it in parallel with R9h, which otherwise runs alone,
  so the cap of 3 lanes holds. Electron check: after R9f, in both the Rail dock and the single view (shared component), with dark and light
  screenshots. Update inventory row 71 (Turn summary panel) to the new look and keep expand-to-detail: files, actions, tests, tokens and cost.

## Lane-introduced constraints

These rules are not from the user or a project rule. The user may accept or drop them:
- Warm-swap budget "fewer than 100 elements added" and "zero newly created transcript subtrees". The user acceptance is no long task over
  50 ms, no shift, F5 and heap 0 detached.
- LRU cap 8 for the Rail host (see finding 3).
- 180 ms fade duration (the user range was about 150-200 ms; fine).
- Defer markdown only if a measured cold case is over 50 ms.
- RPC snapshot kept as a labelled stale fallback with Refresh.
- Chips must distinguish "dock closed" from "unavailable" (no batch owns the chip source; drop it or assign it).
- A one-time v3 rewrite that drops Grid geometry (see finding 9; recommend dropping this rule).
- Deletion batches run serially after integration.
- A back button that always returns to `orchestrator`.

## Grid removal list check

Complete for: toggle, presets/menu, lock, drag, span resize, row break, layout focus, compact height, auto-card budget, gridstack board,
singleton geometry, detail panel and geometry, tile host and menu, indicator, mini-panel, release engine, K1 spec, e2e, stored geometry,
and the package kept for Tribunal.

Missing from batches: `canvas-live-budget.spec.ts`, `canvas-gesture-observation.ts`, `canvas-empty-state.component.ts` (decide),
the exports in `index.ts` (ordering), the chat-state `compactHeightUnits` API (decide), `canvas-render-metrics` `gridUpdates` (minor), and
the e2e `task-337` selector.

Missing from the Gate 2 user list (plain words): "several live chats visible side by side" and "the `s-heap` `gridstack-item` baseline is
retired". Moved, not lost: send-to-messaging, close and the compact/full toggle are already in the Rail focus header
(`canvas-focus-header.component.ts:41`).
