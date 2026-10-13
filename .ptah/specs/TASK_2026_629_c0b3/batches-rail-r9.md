# Batches - TASK_2026_629_c0b3 (phase R9, Rail only)

Total tasks: 20 | Batches: 20 (R9a-R9t) | Complete: 5/20 (Wave 1) | Held: 3 (R9h, R9f, R9l)

Source: `implementation-plan-rail-r9.md` (Gate 2 APPROVED 9/10, `implementation-plan-rail-r9-rereview-2.md`),
decisions 73-80, `handoff-6.md` §4, parity rows 1-116 of `parity-inventory-layout.md`. One task per batch
(Task R9x.1 = the batch contract). Status words: PENDING, HELD, IN_PROGRESS, IMPLEMENTED, COMPLETE, FAILED.

Root W = `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5`. Paths below are
`W\libs\frontend\...` unless prefixed `apps/` (= `W\apps\...`). Lane prompts must expand them to absolute paths.

## Plan validation

Status: PASSED WITH RISKS (no blocker)

Assumptions:

- A1 Every named file exists on disk except the planned-new ones (`subagent-tile.component.ts` + spec,
  `single-chat-subagent-view.component.ts` + spec, `turn-summary-mini-card.styles.ts`,
  `canvas-session-overrides.spec.ts`) — verified (existence script, 2026-10-14). `chat-view.dock.spec.ts` exists: extend.
- A2 Importers of every deleted file were re-checked by rg: each importer's owner runs in an earlier wave or is the
  deleting batch (matches rereview-2 map). Verified.
- A3 `CanvasLayout` (canvas `index.ts:7`) has no consumer outside canvas; `TileLayout` is used by
  `tribunal-panel` (`tribunal-state.service.ts:19`, `tribunal-ui.types.ts:2`). Verified -> R9i drops `CanvasLayout`.
- A4 `compactHeightUnits`/`setCompactHeight` live only in R9i/R9j (deleted), R9r, R9s files and a comment at
  `chat-view.component.ts:911` (R9h). Verified.
- A5 `gridUpdates` is used only by `canvas-workspace-grid` (R9i). R9q therefore depends on R9i only and moves
  from the plan's R9k->R9q slot to Wave 3. This relaxes ordering only; no file or symbol dependency. Verified.
- A6 R9f now runs AFTER the Grid deletions (plan had R9f before R9i). Safer: `canvas-tile` (R9j) imports
  `canvas-session-overrides` (R9f) and `canvas-detail-panel` (R9j) imports `canvas-lane-view`/lane tabs, so
  deleting them first removes importers R9f could break. Verified by rg.
- A7 `typecheck` compiles `tsconfig.lib.json` only; specs are not typechecked. Deleted-file importers in specs
  are caught only by the full suite or rg -> deletion waves run the zero-importer rg plus a full canvas suite.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| R1 Shared worktree: a Mode 2 project check sees half-edited files of another in-flight writer | HIGH | Mode 2 checks for a wave start only after ALL writers of that wave returned; next wave launches after this wave's commits (Waves rule 3) |
| R2 Per-commit greenness is proven on the wave's combined tree, not per commit in isolation | MEDIUM | Batches in one wave have no symbol dependency in either direction (checked); commits go in plan order |
| R3 Split-focus addendum (items 12/13) will touch files that R9b, R9c, R9t, R9l own (rail board, rail card reorder, store, detail service, e2e) | MEDIUM | Addendum batches are sequenced after the owning R9 batch commits; R9l HELD; R9b/R9c/R9t proceed per decision 80 |
| R4 Persistence migration loses sessions (v3 Grid / v2) | HIGH | R9a cases incl. write-then-read round-trip; v3-Grid case built from raw stored JSON (minor 1) |
| R5 Strict ownership hides unresolved agents everywhere | MEDIUM | R9d/R9e/R9h keep the main-panel monitor, resume banner, background tray tolerant; strict only under SESSION_CONTEXT |
| R6 `HIDE_AGENT_SIDEBAR: true` reintroduced on a transcript host (decision 77d) | HIGH | Named refusal in R9f, R9h, R9n contracts and their reviews |
| R7 Opencode quota (83% monthly) runs out mid-wave | LOW | Fallback executor codex lane for every opencode batch |
| R8 Codex concurrency: 3 codex writers plus codex reviewer lanes for Claude batches | MEDIUM | Total codex lanes (writers + reviewers) <= 3; a Claude batch's codex review waits for a free codex slot |

Edge cases: v3 Grid / v2 / v1 / malformed / newer read-only (R9a); empty name + first-prompt rename, cap 9,
null addTile (R9b); unowned/mismatched owner (R9d, R9e, R9h); stale permission id (R9g, R9f); fifth-tab eviction,
close, workspace removal, shared tree cache (R9h); dock lazy-load failure (R9h); doomed exports (R9i);
old stored `compactHeightUnits` payload (R9s); historical `'grid'` after narrowing (R9l).

## Execution rules (decisions 78, 79; handoff-6 §4; CLAUDE.md)

1. Writers: codex lanes (max 3), Claude `frontend-developer` subagents (max 2), opencode lanes; max 5 writers.
   Glm/grok/antigravity not used. Lanes: `cli`, `workingDirectory` = W, `taskFolder: .ptah/specs/TASK_2026_629_c0b3`,
   `timeout: 1200000`, <= 40 tool calls. Lanes and subagents never run git. Report: `lane-R9x-report.md`.
2. Writers run ONLY their batch's `--testFile` specs (below), one at a time. No full suite, typecheck or lint.
3. Review before commit (decision 79): codex/opencode batch -> Claude `code-logic-reviewer` subagent writing
   `code-logic-review-R9x.md`; Claude-written batch -> codex reviewer lane writing `codex-review-R9x.md`.
   One fix round per batch by the same writer. Phase-diff code-logic review runs once after the last R9 batch.
4. Mode 2 (team-leader) runs project checks SERIALLY, one heavy check at a time, after every writer of the
   wave returned. First touch of canvas (R9a), chat-ui (R9c) and chat (R9d) runs that project's FULL suite
   (first run after the main merge). Deletion waves run the full canvas suite once plus rg zero-importer checks.
   When several batches of a wave share a project, Mode 2 may run that project's suite/typecheck/lint once on the
   combined tree, then commit the batches one by one in plan order.
5. No build, serve, dev, e2e, package or install. No git in `D:\projects\ptah-final-run-ws`.
6. Never delete a file with a live import/export; fix the reference in the same batch before its checks.

Command templates (exact; `P` = Nx project name, `S` = spec file name):

- SPEC(P,S): `npx nx test P --testFile=S --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
- FULL(P): `npx nx test P --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
- TC(P): `npx nx typecheck P --parallel=1 --skip-nx-cache` | LINT(P): `npx nx lint P --parallel=1 --skip-nx-cache`
- Filter: strip `\x1b\[[0-9;]*m`, grep `Tests:|Test Suites:|FAIL |error`; logs to `%TEMP%`, never the task folder.
- Projects: `@ptah-extension/canvas`, `@ptah-extension/chat`, `@ptah-extension/chat-ui`,
  `@ptah-extension/chat-state`, `@ptah-extension/chat-types` (no test target), `@ptah-extension/tribunal-panel`,
  `ptah-electron-e2e` (typecheck/lint only).

## Waves (file-disjoint inside a wave; each wave waits for the previous wave's commits)

| Wave | Batches -> executor | Writers | Mode 2 heavy checks (serial order) |
| --- | --- | --- | --- |
| 1 | R9a codex, R9b Claude FD, R9c Claude FD, R9d codex, R9g codex | 5 (3 codex, 2 Claude) | FULL canvas, TC/LINT canvas; FULL chat-ui, TC/LINT chat-ui; FULL chat, TC/LINT chat |
| 2 | R9e codex, R9n Claude FD, R9o Claude FD, R9i opencode | 4 | rg R9i; FULL canvas, TC/LINT canvas; SPECs + TC/LINT chat; SPECs + TC/LINT chat-ui |
| 3 | R9p opencode, R9j opencode, R9q opencode | 3 | rg R9p/R9j; FULL canvas, TC/LINT canvas |
| 4 | R9m opencode, R9r opencode | 2 | rg R9m; FULL canvas, TC/LINT canvas; FULL chat-state, TC/LINT chat-state |
| 5 | R9k codex, R9s opencode | 2 | FULL canvas, TC/LINT canvas, TC tribunal-panel; FULL chat-state, TC/LINT chat-state, TC/LINT chat-types |
| 6 | R9t codex | 1 | FULL canvas, TC/LINT canvas |
| H1 (after addendum Gate 2) | R9h codex (+ addendum batches on disjoint files) | <=5 | FULL chat, TC/LINT chat |
| H2 | R9f codex | 1+ | FULL canvas, TC/LINT canvas |
| H3 | R9l codex | 1 | SPECs canvas, TC/LINT canvas, TC/LINT ptah-electron-e2e |

Dependencies: R9n<-R9g; R9i<-R9b; R9p,R9j<-R9b,R9i; R9q<-R9i; R9m<-R9b,R9i,R9j; R9r<-R9i,R9j; R9k<-R9m,R9j,R9i,R9b;
R9s<-R9r; R9t<-R9k,R9p,R9m,R9j,R9i,R9b; R9h<-R9e,R9n,addendum gate; R9f<-R9h,R9g,R9n,R9d,R9j; R9l<-R9t,R9f.

## Batch R9a: Persistence Grid->Rail normalization — COMPLETE (e24a8c93e; review code-logic-review-R9a.md)

- Executor: codex lane | Fallback: Claude frontend-developer | Reviewer: Claude code-logic-reviewer | Wave 1
- Files: `canvas/src/lib/canvas-layout-persistence.service.ts`, `canvas/src/lib/canvas-layout-persistence.service.spec.ts`
- Contract: accept legacy `'grid'` at the schema seam and normalize to `'rail'` before returning typed board state;
  keep `railCollapsed`/`railDensity`/`railScrollTop`; v2 -> Rail defaults; strict v3 tile shape (ids, order,
  width, row-break) kept; only `board.mode` normalized; v1 read retained; newer-version read-only guard kept.
  Minor 1: build the v3-Grid case from raw stored JSON and remove the typed `mode: 'grid' as const` at spec `:18`.
- Cases: v3 Grid, v2, v1, malformed, newer read-only, write-then-read round-trip. Parity rows 63, 64.
- Writer: SPEC(@ptah-extension/canvas, canvas-layout-persistence.service.spec.ts)
- Mode 2: FULL(canvas) (first canvas run), TC(canvas), LINT(canvas)

### Task R9a.1 — COMPLETE

## Batch R9b: Rail New session uses the named popover; Grid host removed — COMPLETE (c8d8bc95f; review codex-review-R9b.md, fix round done)

- Executor: Claude frontend-developer | Fallback: codex lane | Reviewer: codex reviewer lane | Wave 1
- Files: `canvas/src/lib/orchestra-canvas.component.ts`, `orchestra-canvas.rail.spec.ts`,
  `orchestra-canvas.component.spec.ts`, `orchestra-canvas.detail.spec.ts` (delete),
  `canvas/src/lib/canvas-rail/canvas-rail-board.component.ts`, its `.spec.ts`
- Contract: Rail footer `newSession` and the zero-tile empty board open the SAME anchored `ptah-native-popover`
  (`handleCreateSession`, R9-D1); typed/empty name, first-prompt rename, `canStartRunningSession`, `canAddTile`,
  null `addTile`, `geometryBaseline` reset, focus and scroll anchor after add; cap failure leaves no tile and
  announces. Remove Grid host imports (workspace-grid, detail-panel, detail-keyboard, layout-controls,
  board-toggle, live-budget, empty-state) with the detail spec. Keep `CanvasLayoutService` use in rail-board.
- Cases: footer + empty board -> same popover; typed name; empty name default; cap 9 disabled reason; null add.
  Parity rows 45, 46, 62, 67.
- Writer: SPEC(canvas, orchestra-canvas.rail.spec.ts), SPEC(canvas, orchestra-canvas.component.spec.ts),
  SPEC(canvas, canvas-rail-board.component.spec.ts)
- Mode 2: covered by Wave 1 FULL(canvas), TC(canvas), LINT(canvas); rg: no importer of `orchestra-canvas.detail.spec`.

### Task R9b.1 — COMPLETE

## Batch R9c: Rail card hover/role/pointer and keyboard — COMPLETE (713ec57ae; review codex-review-R9c.md)

- Executor: Claude frontend-developer | Fallback: codex lane | Reviewer: codex reviewer lane | Wave 1
- Files: `canvas/src/lib/canvas-rail/canvas-rail-card.component.ts`, its `.spec.ts`,
  `chat-ui/src/lib/molecules/compact-session/compact-rail-card.component.ts`, its `.spec.ts`
- Contract: visible hover/role/pointer on card, lane, action and collapsed control; keyboard selection;
  preserve `focusRailSelectButton` and `rc-lane-overflow`; 176/96 px cards and 70 px lane block unchanged.
  Item 13 (Rail reorder) is NOT in scope; the addendum extends these files after this commit.
- Writer: SPEC(canvas, canvas-rail-card.component.spec.ts), SPEC(@ptah-extension/chat-ui, compact-rail-card.component.spec.ts)
- Mode 2: FULL(chat-ui) (first chat-ui run), TC(chat-ui), LINT(chat-ui); canvas covered by Wave 1 canvas checks.

### Task R9c.1 — COMPLETE

## Batch R9d: Strict ownership on Rail rows and lane tabs — COMPLETE (b9736bd4e; review code-logic-review-R9d.md, fix round done)

- Executor: codex lane | Fallback: Claude frontend-developer | Reviewer: Claude code-logic-reviewer | Wave 1
- Files: `chat/src/lib/components/molecules/compact-session/compact-lane-rows.ts`, its `.spec.ts`,
  `compact-session-card.component.ts`, its `.spec.ts`, `canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts`, its `.spec.ts`
- Contract: owner equality (`agentsOwnedBySession`) for rows/count/Now/+N only when SESSION_CONTEXT exists; no
  cross-session unowned agent; main panel tolerant. Unowned-forever events -> TASK_2026_633 finding, no backend.
- Writer: SPEC(@ptah-extension/chat, compact-lane-rows.spec.ts), SPEC(chat, compact-session-card.component.spec.ts),
  SPEC(canvas, canvas-lane-tabs.component.spec.ts)
- Mode 2: FULL(chat) (first chat run), TC(chat), LINT(chat); canvas covered by Wave 1 canvas checks.

### Task R9d.1 — COMPLETE

## Batch R9g: Opt-in sub-agent tile in the execution tree — COMPLETE (8f9d63757; review code-logic-review-R9g.md, fix round done)

- Executor: codex lane | Fallback: Claude frontend-developer | Reviewer: Claude code-logic-reviewer | Wave 1
- Files: `chat/src/lib/components/organisms/execution/execution-node.component.ts`, `execution-node.ptah-ui.spec.ts`,
  `subagent-tile.component.ts` (new), `subagent-tile.component.spec.ts` (new),
  `chat/src/lib/components/organisms/message-bubble.component.ts`, its `.html`, its `.spec.ts`,
  `chat-ui/src/index.ts` (one export line, `formatAgentElapsed`; decision 84)
- Contract: `agentTileMode` opt-in input across message-bubble -> execution-node and every recursive edge
  (agent, SendMessage, tool); default off keeps the inline branch for the other four hosts. Tile uses
  background-agent-strip formatters/status icon (`:96,109`), tool count from `children`, pending-permission badge
  from descendants, finalization. Optional inject `SESSION_CARD_ACTIONS`; `openLane('sub:'|'bg:' + toolCallId)`
  only when present; absent provider -> safe unavailable action. Stale permission id does nothing.
  `agent-execution.component.ts` untouched. Parity rows 79-99, 105.
- Writer: SPEC(chat, execution-node.ptah-ui.spec.ts), SPEC(chat, subagent-tile.component.spec.ts),
  SPEC(chat, message-bubble.component.spec.ts)
- Mode 2: covered by Wave 1 FULL(chat), TC(chat), LINT(chat).

### Task R9g.1 — COMPLETE

## Batch R9e: Strict scoped Agents groups, tolerant main panel — PENDING

- Executor: codex lane | Fallback: Claude frontend-developer | Reviewer: Claude code-logic-reviewer | Wave 2
- Files: `chat/src/lib/components/organisms/agent-monitor-panel.component.ts`, `agent-monitor-panel.scope.spec.ts`,
  `chat/src/lib/services/display-dock/display-dock.state.spec.ts`,
  `chat/src/lib/components/organisms/display-dock/display-dock.component.spec.ts`
- Contract: scoped workflow/session groups strict; main-panel host tolerant and still shows unresolved agents;
  pin/close/per-tab dock state. Parity rows 70, 74.
- Writer: SPEC(chat, agent-monitor-panel.scope.spec.ts), SPEC(chat, display-dock.state.spec.ts),
  SPEC(chat, display-dock.component.spec.ts)
- Mode 2: SPECs re-run, TC(chat), LINT(chat).

### Task R9e.1 — PENDING

## Batch R9n: Single-chat sub-agent full view — PENDING

- Executor: Claude frontend-developer | Fallback: codex lane | Reviewer: codex reviewer lane | Wave 2 | Depends: R9g
- Files: `chat/src/lib/components/organisms/transcript/chat-transcript.component.ts`, its `.html`, its `.spec.ts`,
  `chat-transcript.display.spec.ts`, `single-chat-subagent-view.component.ts` (new), its `.spec.ts` (new)
- Contract: only the main transcript passes `agentTileMode=true`; tile opens the live full agent node in place;
  Back restores scroll and draft. `SESSION_CARD_ACTIONS` factory injects the parent with `skipSelf`+`optional`,
  returns it when present, else the local handler (Rail parent wins). Never set `HIDE_AGENT_SIDEBAR: true`.
- Acceptance gate (decision 84, code-logic-review-R9g.md finding 3): in tile mode a pending permission must be
  answerable (render the permission card or route via SESSION_CARD_ACTIONS); spec case required.
- Risk (HANDOFF §5): R9d makes the compact card strict when SESSION_CARD_ACTIONS OR SESSION_CONTEXT is injected
  (`compact-session-card.component.ts`, commit b9736bd4e). R9n's single-view SESSION_CARD_ACTIONS handler must not
  make the main-panel compact card strict. Writer and reviewer must check this and cover it with a spec.
- Cases: tile -> full view -> Back; parent provider wins; fenced display opens and updates in place in single chat;
  pending permission answerable in tile mode; main-panel compact card stays tolerant. Parity rows 103, 112.
- Writer: SPEC(chat, chat-transcript.component.spec.ts), SPEC(chat, chat-transcript.display.spec.ts),
  SPEC(chat, single-chat-subagent-view.component.spec.ts)
- Mode 2: SPECs re-run, TC(chat), LINT(chat).

### Task R9n.1 — PENDING

## Batch R9o: Panel Turn summary in inline mini-card style (item 11) — PENDING

- Executor: Claude frontend-developer | Fallback: codex lane | Reviewer: codex reviewer lane | Wave 2
- Files: `chat-ui/src/lib/organisms/display-panel/turn-summary.component.ts`, its `.spec.ts`,
  `turn-summary-files.component.ts`, `turn-summary-tests.component.ts`,
  `chat-ui/src/lib/molecules/turn-recap/turn-summary-chip.component.ts`, its `.spec.ts`,
  `chat-ui/src/lib/organisms/display-panel/turn-summary-mini-card.styles.ts` (new),
  `chat-ui/src/lib/organisms/ptah-ui/ptah-ui-display-chip.component.spec.ts`
- Contract: shared mini-card styles; Files/Lines/Tokens (in · out)/Cost/Time responsive to panel width; keep detail
  expansion, per-file actions, tests, token/cost detail, conflict-forced Files, actionError alert;
  `display-panel.component.ts` inputs unchanged. Parity rows 71, 106-111.
- Writer: SPEC(chat-ui, turn-summary.component.spec.ts), SPEC(chat-ui, turn-summary-chip.component.spec.ts),
  SPEC(chat-ui, ptah-ui-display-chip.component.spec.ts)
- Mode 2: SPECs re-run, TC(chat-ui), LINT(chat-ui).

### Task R9o.1 — PENDING

## Batch R9i: First deletion — workspace grid, grid items, doomed exports — PENDING

- Executor: opencode lane | Fallback: codex lane | Reviewer: Claude code-logic-reviewer | Wave 2 | Depends: R9b
- Files: `canvas/src/index.ts`, `canvas/src/lib/canvas-workspace-grid.component.ts`, its `.spec.ts`,
  `canvas-workspace-grid.detail.spec.ts`, `canvas-workspace-grid.styles.ts`, `canvas-grid-items.ts`, its `.spec.ts`
- Contract: remove doomed exports first (`CanvasTileComponent`, `CanvasEmptyStateComponent`,
  `TileAgentIndicatorComponent`, `TileAgentMiniPanelComponent`, and type `CanvasLayout` — minor 2, A3); keep
  `CanvasLayoutService`, `TileLayout`, `CanvasStore`, `CanvasTile`, `OrchestraCanvasComponent`. Delete the rest.
  Parity rows 47-49, 51, 53-55.
- Writer: none (deletions); run rg zero-importer for each deleted basename in `libs` and `apps`.
- Mode 2: rg zero-importer; FULL(canvas), TC(canvas), LINT(canvas); TC(@ptah-extension/tribunal-panel) (index change).

### Task R9i.1 — PENDING

## Batch R9p: Delete live budget, gesture observation, empty state — PENDING

- Executor: opencode lane | Fallback: codex lane | Reviewer: Claude code-logic-reviewer | Wave 3 | Depends: R9b, R9i
- Files: `canvas/src/lib/canvas-live-budget.ts`, its `.spec.ts`, `canvas-gesture-observation.ts`, `canvas-empty-state.component.ts`
- Contract: delete Grid-only files; Rail empty-board trigger (R9b) is the replacement. Parity rows 53, 113.
- Writer: rg zero-importer. Mode 2: rg; Wave 3 FULL(canvas), TC(canvas), LINT(canvas).

### Task R9p.1 — PENDING

## Batch R9j: Delete Grid detail panel, geometry, tile, indicator — PENDING

- Executor: opencode lane | Fallback: codex lane | Reviewer: Claude code-logic-reviewer | Wave 3 | Depends: R9b, R9i
- Files: `canvas/src/lib/canvas-detail/canvas-detail-panel.component.ts`, its `.spec.ts`,
  `canvas/src/lib/canvas-detail-geometry.ts`, its `.spec.ts`, `canvas/src/lib/canvas-tile.component.ts`, its `.spec.ts`,
  `tile-agent-indicator.component.ts`
- Contract: delete; preserve `CanvasDetailService`, `canvas-session-overrides.ts`, lane tabs/lane view. Rows 56-58.
- Writer: rg zero-importer. Mode 2: rg; Wave 3 FULL(canvas), TC(canvas), LINT(canvas).

### Task R9j.1 — PENDING

## Batch R9q: Remove dead gridUpdates metric — PENDING

- Executor: opencode lane | Fallback: codex lane | Reviewer: Claude code-logic-reviewer | Wave 3 | Depends: R9i (A5)
- Files: `canvas/src/lib/canvas-render-metrics.service.ts`, its `.spec.ts`
- Contract: remove `gridUpdates` metric and test; `canvas-rail.component.ts` and spec unchanged.
- Writer: SPEC(canvas, canvas-render-metrics.service.spec.ts). Mode 2: Wave 3 canvas checks.

### Task R9q.1 — PENDING

## Batch R9m: Delete grid release, mini-panel, detail keyboard — PENDING

- Executor: opencode lane | Fallback: codex lane | Reviewer: Claude code-logic-reviewer | Wave 4 | Depends: R9b, R9i, R9j
- Files: `canvas/src/lib/canvas-grid-release.ts`, `canvas-grid-release.engine.spec.ts`,
  `tile-agent-mini-panel.component.ts`, its `.spec.ts`, `canvas-detail/canvas-detail-keyboard.ts`, its `.spec.ts`
- Contract: delete before R9k drops geometry references. Parity rows 59, 60.
- Writer: rg zero-importer. Mode 2: rg; FULL(canvas), TC(canvas), LINT(canvas).

### Task R9m.1 — PENDING

## Batch R9r: Remove setCompactHeight and compactHeightUnits from tab manager — PENDING

- Executor: opencode lane | Fallback: codex lane | Reviewer: Claude code-logic-reviewer | Wave 4 | Depends: R9i, R9j
- Files: `chat-state/src/lib/tab-manager.service.ts`, its `.spec.ts`, `tab-manager.persistence.spec.ts`, `tab-manager.intent-mutators.spec.ts`
- Contract: remove `setCompactHeight` and EVERY `compactHeightUnits` reference in these four files incl. comments;
  preserve `viewMode`; green before R9s drops the type field. Parity row 52, 114.
- Writer: SPEC(@ptah-extension/chat-state, tab-manager.service.spec.ts), SPEC(chat-state, tab-manager.persistence.spec.ts),
  SPEC(chat-state, tab-manager.intent-mutators.spec.ts)
- Mode 2: FULL(chat-state) (first chat-state run), TC(chat-state), LINT(chat-state).

### Task R9r.1 — PENDING

## Batch R9k: Slim layout service; delete layout controls and board toggle — PENDING

- Executor: codex lane | Fallback: Claude frontend-developer | Reviewer: Claude code-logic-reviewer | Wave 5 | Depends: R9m, R9j, R9i, R9b
- Files: `canvas/src/lib/canvas-layout.service.ts`, its `.spec.ts`, `canvas-layout-controls.component.ts`, its `.spec.ts`,
  `canvas-board-toggle.component.ts`, its `.spec.ts`
- Contract: keep Rail container-width observation/release and exported `TileLayout` (Tribunal); `CanvasLayout`
  may go (R9i already dropped its export); remove Grid geometry imports/tests; delete controls/toggle; leave
  intent and store exports for R9t. Cases: width observation/release, Tribunal type import. Rows 45, 46, 61.
- Writer: SPEC(canvas, canvas-layout.service.spec.ts); rg zero-importer.
- Mode 2: FULL(canvas), TC(canvas), LINT(canvas), TC(@ptah-extension/tribunal-panel).

### Task R9k.1 — PENDING

## Batch R9s: Drop compactHeightUnits from TabState — PENDING

- Executor: opencode lane | Fallback: codex lane | Reviewer: Claude code-logic-reviewer | Wave 5 | Depends: R9r
- Files: `chat-state/src/lib/tab-persistence.ts`, `tab-restore-sanitize.spec.ts`, `tab-persistence.backoff.spec.ts`,
  `chat-types/src/lib/chat-types.ts`
- Contract: drop field and its comments from current `TabState`; remove current writes; tolerate the old stored
  field; preserve `viewMode`. Case: old payload with `compactHeightUnits` loads. The `chat-view.component.ts:911`
  comment is R9h's. Parity row 114.
- Writer: SPEC(chat-state, tab-restore-sanitize.spec.ts), SPEC(chat-state, tab-persistence.backoff.spec.ts)
- Mode 2: FULL(chat-state), TC(chat-state), LINT(chat-state), TC(@ptah-extension/chat-types), LINT(chat-types).

### Task R9s.1 — PENDING

## Batch R9t: Late intent/store Grid cleanup — PENDING

- Executor: codex lane | Fallback: Claude frontend-developer | Reviewer: Claude code-logic-reviewer | Wave 6 | Depends: R9k, R9p, R9m, R9j, R9i, R9b
- Files: `canvas/src/lib/canvas.store.ts`, its `.spec.ts`, `canvas-layout-intent.ts`, its `.spec.ts`
- Contract: remove applyPreset/projectPreset, span resize, setLayoutLocked, toggleRowBreak, `setBoardMode('grid')`
  and matching specs/intent exports. Keep `MAX_CANVAS_TILES`, `TILE_SPANS`, `TileSpan` (minor 3, needed by
  `TileWidthIntent`), `DEFAULT_TILE_WIDTH`, `TileIntent`, `TileWidthIntent`, `logicalRows`, `reconcileIntent`,
  `retainTilesInLogicalRows`, `sameWidth`; strict v3 width/row-break data. Do not add reorder (item 13 addendum).
  Parity rows 50, 61, 64.
- Writer: SPEC(canvas, canvas.store.spec.ts), SPEC(canvas, canvas-layout-intent.spec.ts)
- Mode 2: FULL(canvas), TC(canvas), LINT(canvas).

### Task R9t.1 — PENDING

## Batch R9h: Rail retention cap 4, stable ChatView, dock by tab id — HELD (split-focus addendum Gate 2)

- Executor: codex lane | Fallback: none (codex only) | Reviewer: Claude code-logic-reviewer | Wave H1 | Depends: R9e, R9n, addendum gate
- Files: `chat/src/lib/services/transcript-retention.service.ts`, its `.spec.ts`,
  `chat/src/lib/components/templates/chat-view.component.ts`, its `.html`, `chat-view.keepalive.spec.ts`,
  `chat-view.dock.spec.ts`, `chat/src/lib/tokens/session-context.token.ts`, `chat/src/index.ts`
- Contract: Rail opt-in token cap 4 (shared default 8 unchanged); follow SESSION_CONTEXT; fifth tab evicts; tree
  cache survives while another surface retains the tab; close/workspace release; ordinary tile/main panel
  unchanged; strict owners only in Rail; dock keyed by tab id; remove the `:911` comment's `compactHeightUnits`.
  Never set `HIDE_AGENT_SIDEBAR: true`. Named spec: fenced display opens and updates in place in single chat view.
  Re-validate against the addendum ("one live ChatView, or two while split focus is on"). Rows 68-78, 102.
- Writer: SPEC(chat, transcript-retention.service.spec.ts), SPEC(chat, chat-view.keepalive.spec.ts), SPEC(chat, chat-view.dock.spec.ts)
- Mode 2: FULL(chat), TC(chat), LINT(chat).

### Task R9h.1 — HELD

## Batch R9f: Persistent Rail transcript host, restored dock, live full lane — HELD (split-focus addendum Gate 2)

- Executor: codex lane | Fallback: none (codex only) | Reviewer: Claude code-logic-reviewer | Wave H2 | Depends: R9h, R9g, R9n, R9d, R9j
- Files: `canvas/src/lib/canvas-detail/canvas-detail-transcript.component.ts`, its `.spec.ts`, `canvas-lane-view.component.ts`,
  its `.spec.ts`, `canvas/src/lib/canvas-rail/canvas-focus-area.component.ts`, its `.spec.ts`,
  `canvas/src/lib/canvas-session-overrides.ts`, `canvas-session-overrides.spec.ts` (new)
- Contract: remove `HIDE_AGENT_SIDEBAR: true` (`canvas-detail-transcript.component.ts:56`); provide Rail
  `SESSION_CARD_ACTIONS` (selectLaneFor parent tab + `sub:`/`bg:`); stable lane host (no keyed `@for` on tab id);
  transcript outside keyed non-orchestrator block; cover hides/freezes via SESSION_VISIBLE/SURFACE_ACTIVE; Open/Back
  keeps ChatView instance and draft; per-tab model/effort; full lane `<ptah-execution-node [node]="agentNode">`
  tile mode off; RPC viewer only as labelled fallback; 180 ms opacity/transform, reduced-motion off.
- Cases: stop, background, steer, copy, depth-2 agent, permission answer, fallback/Refresh, Escape; Rail tile click
  selects `sub:` lane and does not mount `SingleChatSubagentView`; fenced display updates in place in Rail host.
  Rows 68-78, 100-104, 112.
- Writer: SPEC(canvas, canvas-detail-transcript.component.spec.ts), SPEC(canvas, canvas-lane-view.component.spec.ts),
  SPEC(canvas, canvas-focus-area.component.spec.ts), SPEC(canvas, canvas-session-overrides.spec.ts)
- Mode 2: FULL(canvas), TC(canvas), LINT(canvas).

### Task R9f.1 — HELD

## Batch R9l: Narrow CanvasBoardMode; detail service; e2e selectors — HELD (after R9f; addendum may change detail service/e2e)

- Executor: codex lane | Fallback: none (codex only) | Reviewer: Claude code-logic-reviewer | Wave H3 | Depends: R9t, R9f
- Files: `canvas/src/lib/canvas-board-mode.ts`, `canvas-detail/canvas-detail.service.ts`, its `.spec.ts`,
  `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts`, `apps/ptah-electron-e2e/src/specs/task-337-agent-card-refresh.spec.ts`
- Contract: narrow `CanvasBoardMode` to `'rail'`; persistence alone accepts historical `'grid'`; keep Rail lane
  memory; rewrite e2e selectors and task-337 tile/full-view assertion; do not run e2e; `packaged-deps.spec.ts`
  unowned and unchanged; Gridstack kept. Rows 63-66, 115, 116.
- Writer: SPEC(canvas, canvas-detail.service.spec.ts)
- Mode 2: SPEC re-run, TC(canvas), LINT(canvas), TC(ptah-electron-e2e), LINT(ptah-electron-e2e).

### Task R9l.1 — HELD

## Phase review and completion

- After the last R9 batch: one phase-diff code-logic review (plus style: new public `subagent-tile`,
  `single-chat-subagent-view`, Rail token) and visual-reviewer on the Electron re-check list (plan §Electron
  re-check, dark + light, before/after Rail shots). Mode 3 verifies parity rows 1-116 and the persistence
  write-path (R9a, R9s).
