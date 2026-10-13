Verdict: REVISE — 7.5/10

Scoped Gate 2 re-review (Claude) of the codex revision of `implementation-plan-rail-r9.md` (Revision 1 table, lines 147-159).
Twelve of the 14 findings are closed. Two are partly closed. The revision added three Serious defects: two in deletion
ordering and one in the tile routing contract. Each needs a small plan edit. No code change is needed to fix them.

## Finding status

| # | Status | Evidence |
| --- | --- | --- |
| 1 | CLOSED | Plan 14, 100 (R9f), D8. Code: `canvas-lane-view.component.ts:50-121` keys only `@for` and `@default` holds the transcript, so it can move outside. `canvas-detail-transcript.component.ts:45-55` feeds one `active` signal to SESSION_VISIBLE/SURFACE_ACTIVE/SESSION_FOCUSED, so a `covered` input can gate it. Implementable. |
| 2 | CLOSED | `canvas-session-overrides.ts` and a new spec are in R9f (plan 100). Parity row 101. |
| 3 | CLOSED | Plan 40, 44, 99, D9, re-check 10. Code: the service is component-scoped (`transcript-retention.service.ts:35`) and `dispose` calls `clearForTab` (:123-130). A shared "last retainer" count therefore needs root-level state. It must live inside the service file because R9h is already at 8 files. |
| 4 | CLOSED | Plan 16, 96, 99, D10. Code: `agentsOwnedBySession` exists (`agent-monitor.store.ts:891`). `SubagentRecord.parentSessionId` lets R9e filter the groups (`agent-monitor-panel.component.ts:765,776`) in the panel when SESSION_CONTEXT is injected. The store needs no edit. |
| 5 | CLOSED (design, file, spec) | `SingleChatSubagentViewComponent` is in R9n (plan 32, 98) and covered by parity row 103. The routing mechanism is still undefined; see N3. |
| 6 | CLOSED | R9f: `<ptah-execution-node [node]="agentNode">` with tile mode off, plus stop/background/steer/copy/depth-2/permission cases (plan 100, row 104). |
| 7 | PARTLY | (a) `index.ts` moved to R9i: closed. (b) The detail spec is deleted in R9b: closed. (c) Still open: R9l narrows `CanvasBoardMode`, but `'grid'` is typed in R9a-owned specs (`canvas.store.spec.ts:324-364`, `canvas-layout-persistence.service.spec.ts:18`) and in `canvas.store.ts:267` `setBoardMode`. R9l cannot edit those files. See N1 and N2. |
| 8 | PARTLY | The R9k keep list is correct for Rail width and Tribunal `TileLayout` (`canvas/src/index.ts`; `tribunal-state.service.ts:19`). It omits what `canvas.store.ts:20-29` imports from intent: `DEFAULT_TILE_WIDTH`, `TILE_SPANS`, `projectPreset`, `reconcileIntent`, `retainTilesInLogicalRows`, `sameWidth`, `CanvasLayoutPreset` and `TileSpan`. It also omits `TILE_SPANS` used by persistence (:6). See N2. |
| 9 | CLOSED | Plan 20, 50, D11, R9a cases. Code: `boardSchema.mode` (`canvas-layout-persistence.service.ts:46-47`) can map `'grid'` to `'rail'`, and `tilesSchema` (:29-39) stays strict. Implementable. |
| 10 | CLOSED | R9p (live-budget and its spec, gesture, empty-state), D13, R9r/R9s with D12, task-337 in R9l. |
| 11 | CLOSED | Plan 26, R9b contract (footer and zero-tile trigger, `canAddTile`, null add, baseline, focus, anchor). |
| 12 | CLOSED | `subagent-tile.component.ts`, strip formatters `:96,109`, dead `agent-execution` untouched (R9g, D15, row 105). |
| 13 | CLOSED | R9a, R9c and R9d run the first full canvas, chat-ui and chat suites, serially (plan 88). |
| 14 | CLOSED | Re-check 2 (popover and name), 7 (full-lane controls, draft across sub-lane), 10 (retained count against cap 4, heap MB, elements), 12 (Tribunal smoke). |

Item 11 (decision 76): present. R9o (plan 101) is chat-ui only, file-disjoint, and keeps `display-panel` inputs. Rows 106-111
keep expand-to-detail: files and actions, tests, tokens and cost, conflict, and actionError. Re-check 10 covers both hosts in
dark and light. Row 71 is updated.
Decision 77: (a) row 112. (b) named specs in the Rail host (R9f `canvas-lane-view` spec) and the single view (R9h
`chat-view.dock.spec`, R9n `chat-transcript.display.spec`). (c) re-check 10 authors and updates a `ptah-ui display [id]`.
(d) the rule is at plan line 28. All present.

## New findings

1. **Serious — R9k slims intent before R9m deletes its last Grid users.** `canvas-grid-release.ts:2-3` imports `compactResizeBounds`
   and `TileViewConstraints`. `canvas-grid-release.engine.spec.ts:4` imports `projectTileGeometry`. The order R9k -> R9q -> R9m
   leaves only two outcomes. R9k ends red, or (by line 112's "never delete a live export") R9k keeps those helpers and no later
   batch owns intent to remove them. Fix: run R9m before R9k (R9i -> R9p -> R9j -> R9m -> R9k -> ...).
2. **Serious — no batch can remove the store's Grid branches, so intent cannot be slimmed.** `canvas.store.ts` is owned only by
   R9a, which runs first. Its Grid paths still have live callers until R9b and R9i: `applyPreset` with `projectPreset` (:490),
   span resize with `TILE_SPANS`/`sameWidth` (:450-453), `setLayoutLocked` (:303), `toggleRowBreak`
   (caller `canvas-workspace-grid.component.ts:658`) and `setBoardMode('grid')` (caller `orchestra-canvas.component.ts:428`).
   Plan line 77 ("Grid-only branches of ... store remove-proposed") therefore has no owner. R9k would break the store if it
   removed those intent exports. Fix: R9a owns only the persistence service and its spec, normalizing at the seam. Add a late
   batch (e.g. R9t, after R9k and before R9l) that owns `canvas.store.ts`, its spec, `canvas-layout-intent.ts` and its spec. That
   batch removes the store's Grid methods, the `'grid'` spec uses and the matching intent exports. R9k then keeps only the service,
   controls and toggle (6 files). This also closes 7(c).
3. **Serious — the tile's lane-routing contract is undefined across R9g, R9n and R9f.** `SESSION_CARD_ACTIONS` (`session-context.token.ts:62-69`)
   has `openLane(laneKey)` only. The Rail provider will live in the environment injector of `canvas-detail-transcript`. If R9n
   provides the single-view handler in `chat-transcript` `providers`, that element injector wins in Rail too. Tile clicks would then
   open the single-chat view inside the Rail instead of selecting the lane. The per-batch specs (single view in R9n, mocked ChatView
   in R9f) would not catch this. Fix: state the contract in R9g/R9n. The tile injects the token optionally, and `chat-transcript`
   uses its local handler only when no parent provider exists (factory with `skipSelf` + `optional`). Add an R9f case: "Rail tile
   click selects the `sub:` lane and does not mount `SingleChatSubagentView`".
4. **Moderate — R9o leaves `turn-summary-chip.component.spec.ts` unowned and does not name the shared style file.** R9o edits the
   inline chip. A new shared style file would be a seventh file. Add both (8 files, still within the cap).
5. **Moderate — R9r must remove every `compactHeightUnits` reference in its four files.** R9s then drops the field from `chat-types.ts`
   and cannot edit R9r files (`tab-manager.service.ts`, `tab-manager.persistence.spec.ts`, `tab-manager.intent-mutators.spec.ts`,
   `tab-manager.service.spec.ts` all reference it). Say so in the R9r contract. `chat-view.component.ts:911` is a comment only.
6. **Moderate — plan line 88 says "Each executor is a codex frontend-developer lane".** This contradicts decision 78. Replace it
   with "executor per batch assigned by team-leader Mode 1 under decision 78".
7. **Minor — R9f does not name the `HIDE_AGENT_SIDEBAR: true` removal at `canvas-detail-transcript.component.ts:56`.** It is the
   one edit that restores the Rail dock, so name it in the R9f contract. R9j's `canvas-detail-geometry.ts` is in `canvas/src/lib/`,
   not `canvas-detail/`. R9l owns `packaged-deps.spec.ts` but no change is stated for it.

## File-to-batch map check

I built the map from plan lines 92-110: 19 batches and 109 file slots. There are no duplicates. Every batch has 8 files or fewer
(R9h, R9f and R9k have exactly 8). The two `index.ts` files have one owner each: canvas in R9i, chat in R9h. Importer scan of
each deleted file: only the edges in N1 and N2 break the green ordering. Every other deletion follows its last importer: grid
and items in R9i after R9b, live-budget in R9p after R9i, tile and indicator in R9j after R9i, keyboard in R9m after R9b, and
mini-panel in R9m after R9j. Parallel sets are disjoint: {R9c, R9d, R9g} and {R9h, R9o}. Proposed order after the fix:
R9a -> R9b -> {R9c, R9d, R9g} -> R9e, R9n -> {R9h, R9o} -> R9f -> R9i -> R9p -> R9j -> R9m -> R9k -> R9q -> R9t -> R9r -> R9s -> R9l.

## Executor fit (row 78)

- Codex only (too coupled for a non-codex writer): R9f (cover/freeze, routing provider, full lane, overrides), R9h (two-LRU
  retainer, Rail cap token, dock, strict agents), R9g (recursive tile-mode input across 3 boundaries), R9k/R9t (keep list
  feeds Rail and Tribunal), R9l (type narrowing and e2e rewrite).
- Fit for Claude frontend-developer: R9o (item 11), R9c (item 5), R9b (item 1; large `orchestra-canvas` Grid strip, so borderline).
  R9n fits only once N3's contract is written down.
- Fit for opencode (small deletions): R9i, R9p, R9j, R9m, R9q. R9r and R9s are borderline because they carry persisted-JSON
  compatibility.
- Either: R9a, R9d, R9e.
