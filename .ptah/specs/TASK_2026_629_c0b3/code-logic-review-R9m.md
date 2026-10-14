# Code Logic Review R9m, TASK_2026_629_c0b3

Review family: Claude (reviewer) vs opencode (implementer)

Scope: batch R9m, deletion of six Grid-only files under `libs/frontend/canvas/src/lib`. Read-only review. I ran no tests, typecheck, lint, build or nx command. Other uncommitted changes in W (chat, chat-state, R9h and R9r) are out of scope and were not reviewed.

## Summary

| Metric | Value |
| --- | --- |
| Score | 9/10 |
| Verdict | APPROVED |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 0 |
| Minor | 3 |

`git status` for `libs/frontend/canvas` shows exactly the six intended deletions and nothing else. The deleted symbols have no live consumer, and each capability is either already served by a Rail replacement or is an approved Grid-only removal.

## Evidence

### 1. Zero live importers

Search: `rg`/Grep over the whole worktree for every basename and exported symbol, excluding `.ptah`, `node_modules`, `dist`, `.git` and `.nx`.
- Symbols: `canvas-grid-release`, `tile-agent-mini-panel`, `TileAgentMiniPanel`, `canvas-detail-keyboard`, `retainLiveViewConstraints`, `nodesNeedingLayout`, `geometryDriftCount`, `pinLiveNodes`, `restorePinnedNodes`, `releaseStaleNodes`, `staleGridNodes`, `handleCanvasDetailKeydown`.
- The only hits are in `tools/mcp-bench/**` (see Minor finding 1). Nothing in `libs`, `apps`, `.html`, `.md` or `.css`.

Second search: `mini-panel|miniPanel|detail-keyboard|grid-release|gridRelease` over `libs` and `apps` returned nothing. That covers element selectors, templates, barrels and dynamic imports.

Cross-check against HEAD with `git grep HEAD -- libs apps`: before the deletion, the only references to each symbol were inside the six files themselves (definitions plus their own specs).
- `handleCanvasDetailKeydown` already had no production caller at HEAD. Only its spec imported it. The orchestra host had previously moved to `handleCanvasRailKeydown`: `orchestra-canvas.component.ts:62` (`(window:keydown)` host binding), `:260-278`.
- `ptah-tile-agent-mini-panel` was never in a template. The strings `ptah-tile-agent-indicator` in `apps/ptah-electron-e2e/src/showcase/*.scene.ts` (`lane-console-review.scene.ts:181,256`, `chat-code-edit.scene.ts:161`, `canvas-orchestra.scene.ts:166`) are a different component and are unaffected.
- `libs/frontend/canvas/src/index.ts` and the other barrels do not export any of the six files.

The lane report (`lane-R9m-report.md`) records the same pre- and post-deletion `rg` result, and it matches my independent check.

### 2. Parity rows 59 and 60

Row 59, Grid tile mini-panel (`parity-inventory-layout.md:145`): classified remove-proposed under decision 73, replacement "existing focused Agents dock". The mini-panel offered an agent status list plus inline Allow/Deny via `AgentPermissionResponder.respondLane`. That capability is still served in Rail mode by:
- `canvas-lane-view.component.ts:189,350`, `responder.respondLane` for the focused lane.
- `canvas-needs-you-queue.component.ts:126,205`, `respondLane` for the dock queue.

The deleted component had no remaining mount point, so no behaviour was lost.

Row 60, Grid release and stale-node pinning (`parity-inventory-layout.md:146`): classified remove-proposed mechanism, keep the leak guarantee. The helpers were Gridstack-engine workarounds (top-gravity pack, `grid.engine.nodes`). They have no meaning without Gridstack, and the Rail board does not use them. The leak guarantee moves to Rail host teardown plus the `s-heap` / `s-switch` criteria, which `batches-rail-r9.md:615-617` assigns to the perf batch. The mechanism is legitimately removed. The guarantee's evidence is pending in that other batch (Minor finding 2).

Canvas detail keyboard (a contract file in R9m, but its behaviour is parity row 24 at `parity-inventory-layout.md:42`, marked "keep"): the Rail replacement is `handleCanvasRailKeydown`, `canvas-rail/canvas-rail-keyboard.ts:30-58`, wired at `orchestra-canvas.component.ts:62,260-278`.
- It keeps the same guard shape: ignored targets, `isContentEditable`, modifier keys, and `[role="tablist"], [role="tab"]` for arrows.
- Escape now returns focus to the select button, and Left/Right wrap through `orderedIds`.
- Specs: `canvas-rail-keyboard.spec.ts:29-51` and `orchestra-canvas.rail.spec.ts:463`.
- No Rail or single-view code imported `canvas-detail-keyboard`. The deletion changes no runtime behaviour.

### 3. Dangling comments and docs

No comment or doc under `libs/frontend/canvas` names any of the deleted files or symbols. A residual Gridstack mention at `canvas.store.ts:108` ("MAX_CANVAS_TILES ... for persistence and Gridstack") does not reference the deleted files and belongs to R9k's geometry cleanup.

## Five logic questions

1. Silent failure: none. A dangling import would fail typecheck loudly, and the search shows none exist. Template-only references (`ptah-tile-agent-mini-panel`) are also absent, so there is no unknown-element failure at runtime.
2. Unexpected user action: Escape and arrow behaviour in the detail column now follows the Rail contract (focus movement) rather than the old "Escape closes detail" behaviour. That change was made in an earlier batch, not here.
3. Wrong-answer input: not applicable. This is a pure deletion.
4. Dependency failure: not applicable.
5. Missing: the deleted `canvas-detail-keyboard.spec.ts` was the sole evidence for "Escape from a lane tab closes detail". Its Rail equivalent (Escape from inside a tablist in the Rail host) is only partly covered; see Minor finding 3.

## Findings

### Minor 1: stale file paths in mcp-bench baseline fixtures
- Where: `tools/mcp-bench/baseline/gate-baseline.json:1052,1816` and `tools/mcp-bench/questions/7910f34cf/{relevance,references,file-tools}.json`.
- These are recorded historical retrieval results ("got" and "expected" file lists) and not live imports. `references.json:369-372` pins `tile-agent-mini-panel.component.ts:119` as an expected answer.
- Impact: none at build time. If the mcp-bench gate re-evaluates the question 7910f34cf against the worktree, that question's reference target no longer exists. This is not a canvas regression, but whoever owns mcp-bench should know a fixture points at a deleted file.
- Fix: no change in R9m. Re-record the baseline or retire that question when mcp-bench next runs.

### Minor 2: row 60 leak-guarantee evidence is deferred
- The `canvas-grid-release.engine.spec.ts` (Gridstack engine) proof of "no leaked nodes after release" is gone. Its Rail replacement (`s-heap` after swaps and closes) is only a pending criterion at `batches-rail-r9.md:615-617`.
- Impact: between R9m and that batch landing, no automated test covers the teardown leak guarantee. This is acceptable only if the perf batch stays on the plan.
- Fix: confirm the perf batch is not dropped.

### Minor 3: Escape-in-tablist coverage after deleting `canvas-detail-keyboard.spec.ts`
- The deleted spec's "closes detail with Escape from a lane tab" case has no exact Rail twin that I could find.
- `canvas-rail-keyboard.spec.ts:29-42` covers Escape from a card or inner element, and `orchestra-canvas.rail.spec.ts:463` covers Escape returning focus to the collapsed Rail button.
- Impact: Rail Escape semantics differ by design (focus return, not close), so the old assertion no longer applies. A lane-tab case would still be worth adding under row 24 if it has no coverage elsewhere.
- Fix: optional, in the R9j or R9i spec follow-up.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH on the import graph (two independent searches plus a HEAD cross-check). MEDIUM on runtime behaviour, which the team-leader's TC, LINT and FULL(canvas) runs will confirm.
- Top risk: only the bookkeeping items above. No code path depends on the deleted files.
- What a robust implementation would add: update the mcp-bench fixture on the next gate run, and keep the pending `s-heap` leak criterion on the schedule.
