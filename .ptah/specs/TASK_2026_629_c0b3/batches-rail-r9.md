# Batches - TASK_2026_629_c0b3 (phase R9, Rail only)

Total tasks: 24 | Batches: 24 (R9a-R9t, addendum R9u-R9x) | Complete: 24/24 | Held: 0

Addendum: `implementation-plan-rail-r9-split.md` Revisions 1-3 (Gate 2 passed, decision 88), notes N1-N6
(`implementation-plan-rail-r9-split-final-check.md`) and B1-B7 (`implementation-plan-rail-r9-split-rev3-check.md`)
folded into the R9u-R9x contracts below; user decisions 82, 83, 85, 86. R9h/R9f/R9l run unchanged as approved
(decision 81) apart from decision 89 (R9h/R9f) and the R9i review note on R9t.

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
| R3 Split-focus addendum (items 12/13) will touch files that R9b, R9c, R9t, R9l own (rail board, rail card reorder, store, detail service, e2e) | MEDIUM | Addendum batches R9u-R9x run serially (Waves H4-H7) after every owning R9 batch commits (R9b, R9c, R9t, R9h, R9f, R9l); R9t keeps `reorderTiles` for R9w; HOLD lifted (decision 81) |
| R4 Persistence migration loses sessions (v3 Grid / v2) | HIGH | R9a cases incl. write-then-read round-trip; v3-Grid case built from raw stored JSON (minor 1) |
| R5 Strict ownership hides unresolved agents everywhere | MEDIUM | R9d/R9e/R9h keep the main-panel monitor, resume banner, background tray tolerant; strict only under SESSION_CONTEXT |
| R6 `HIDE_AGENT_SIDEBAR: true` reintroduced on a transcript host (decision 77d) | HIGH | Named refusal in R9f, R9h, R9n, R9u, R9w contracts and their reviews; R9f removal gated on R9h decision-89 specs |
| R7 Opencode quota (83% monthly) runs out mid-wave | LOW | Fallback executor codex lane for every opencode batch |
| R8 Codex concurrency: 3 codex writers plus codex reviewer lanes for Claude batches | MEDIUM | Total codex lanes (writers + reviewers) <= 3; a Claude batch's codex review waits for a free codex slot |
| R9 R9w is the heaviest contract (pane state machine, ghost reconcile, close transition, Details overlay, stacked layout, tokens, lane ids, reorder consumer) and cannot be split under the 8-file cap without breaking file disjointness (B7) | HIGH | R9w lane gets `timeout: 2400000` and <= 80 tool calls; the contract lists each named spec case so the reviewer can check them one by one; one fix round; if the lane times out, resume the same session, never start a second writer on the same files |
| R10 R9x spans three projects (canvas, one chat spec, the e2e app) | LOW | Plan-approved file set; Mode 2 runs each project's own check; e2e is typecheck/lint only, never run |
| R11 R9i review minors: stale `ptah-canvas-workspace-grid` selector strings in `orchestra-canvas.rail.spec.ts:296` and `orchestra-canvas.component.spec.ts:906` | LOW | Recorded, not fixed (lean rule 4); no later batch owns these files; the phase-diff review lists them |

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
| 2 | R9e codex, R9n Claude FD, R9o Claude FD, R9i opencode | 4 | rg R9i; FULL canvas, TC/LINT canvas; SPECs + TC/LINT chat; SPECs + TC/LINT chat-ui. Wave 2a (R9o, R9i) COMMITTED, `mode2-wave2a-report.md`; R9e, R9n Mode 2 pending |
| 3 | R9p opencode, R9j opencode, R9q opencode | 3 | rg R9p/R9j; FULL canvas, TC/LINT canvas |
| 4 | R9m opencode, R9r opencode | 2 | rg R9m; FULL canvas, TC/LINT canvas; FULL chat-state, TC/LINT chat-state |
| 5 | R9k codex, R9s opencode | 2 | FULL canvas, TC/LINT canvas, TC tribunal-panel; FULL chat-state, TC/LINT chat-state, TC/LINT chat-types |
| 6 | R9t codex | 1 | FULL canvas, TC/LINT canvas |
| H1 | R9h codex | 1 | FULL chat, TC/LINT chat |
| H2 | R9f codex | 1 | FULL canvas, TC/LINT canvas |
| H3 | R9l codex | 1 | SPECs canvas, TC/LINT canvas, TC/LINT ptah-electron-e2e |
| H4 (addendum) | R9u codex | 1 | FULL chat, TC/LINT chat |
| H5 (addendum) | R9v Claude FD | 1 | FULL canvas, TC/LINT canvas |
| H6 (addendum) | R9w codex | 1 | FULL canvas, TC/LINT canvas |
| H7 (addendum) | R9x Claude FD | 1 | FULL canvas, TC/LINT canvas; SPEC + LINT chat; TC/LINT ptah-electron-e2e |

H1-H3 lost their HELD state (decision 81; addendum Gate 2 passed, decision 88) and follow their dependencies.
H4-H7 run serially in plan order (addendum line 80: R9u -> R9v -> R9w -> R9x). R9h is ready once R9e and R9n commit
(its chat files are disjoint from Waves 3-6); R9f waits for R9j (Wave 3) and R9h; R9l waits for R9t and R9f. A wave
that shares a project with another in-flight wave still obeys risk R1 (Mode 2 checks only after all its writers return).

Dependencies: R9n<-R9g; R9i<-R9b; R9p,R9j<-R9b,R9i; R9q<-R9i; R9m<-R9b,R9i,R9j; R9r<-R9i,R9j; R9k<-R9m,R9j,R9i,R9b;
R9s<-R9r; R9t<-R9k,R9p,R9m,R9j,R9i,R9b; R9h<-R9e,R9n; R9f<-R9h (decision 89 specs),R9g,R9n,R9d,R9j; R9l<-R9t,R9f;
R9u<-R9h,R9l (all H1-H3 commits); R9v<-R9c,R9b,R9l,R9u; R9w<-R9b,R9f,R9l,R9u,R9v; R9x<-R9l,R9w.

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

## Batch R9e: Strict scoped Agents groups, tolerant main panel — COMPLETE (df4e9977b; review code-logic-review-R9e.md, fix round done; finding 2 -> R9h, decision 89)

- Executor: codex lane | Fallback: Claude frontend-developer | Reviewer: Claude code-logic-reviewer | Wave 2
- Files: `chat/src/lib/components/organisms/agent-monitor-panel.component.ts`, `agent-monitor-panel.scope.spec.ts`,
  `chat/src/lib/services/display-dock/display-dock.state.spec.ts`,
  `chat/src/lib/components/organisms/display-dock/display-dock.component.spec.ts`
- Contract: scoped workflow/session groups strict; main-panel host tolerant and still shows unresolved agents;
  pin/close/per-tab dock state. Parity rows 70, 74.
- Writer: SPEC(chat, agent-monitor-panel.scope.spec.ts), SPEC(chat, display-dock.state.spec.ts),
  SPEC(chat, display-dock.component.spec.ts)
- Mode 2: SPECs re-run, TC(chat), LINT(chat).
- Mode 2 result (mode2-wave2b-report.md): FULL(chat) 202 suites, 1 failure caused by R9n (see R9n);
  TC(chat) green; LINT(chat) 0 errors.

### Task R9e.1 — COMPLETE

## Batch R9n: Single-chat sub-agent full view — COMPLETE (7ef8d53d3; review codex-review-R9n.md, fix round done)

- Executor: Claude frontend-developer | Fallback: codex lane | Reviewer: codex reviewer lane | Wave 2 | Depends: R9g
- Files: `chat/src/lib/components/organisms/transcript/chat-transcript.component.ts`, its `.html`, its `.spec.ts`,
  `chat-transcript.display.spec.ts`, `single-chat-subagent-view.component.ts` (new), its `.spec.ts` (new),
  `transcript/testing/transcript-spec-harness.ts` (one stub input, decision 87),
  `chat/src/lib/components/templates/chat-view.keepalive.spec.ts` (one stub input, added in Mode 2)
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
- Mode 2 result (mode2-wave2b-report.md): FULL(chat) failed only in `chat-view.keepalive.spec.ts` (NG0303,
  its `ptah-message-bubble` stub lacked the new `agentTileMode` input); team-leader added the one stub input
  (same fix as decision 87), spec re-run green (1/1); TC(chat) green; LINT(chat) 0 errors.

### Task R9n.1 — COMPLETE

## Batch R9o: Panel Turn summary in inline mini-card style (item 11) — COMPLETE (b78468290; review codex-review-R9o.md, fix round done)

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
- Mode 2 result: 4 specs + `display-panel.component.spec.ts` green (36, 24, 28, 18); TC green; LINT failed on
  `turn-summary-chip.component.ts:86-87` (static `class` plus `[class]`, no-duplicate-attributes); team-leader
  merged both into one `SECTION_CLASS` binding (same rendered classes), chip spec + LINT + TC re-run green.

### Task R9o.1 — COMPLETE

## Batch R9i: First deletion — workspace grid, grid items, doomed exports — COMPLETE (df3b88e8d; review code-logic-review-R9i.md)

- Executor: opencode lane | Fallback: codex lane | Reviewer: Claude code-logic-reviewer | Wave 2 | Depends: R9b
- Files: `canvas/src/index.ts`, `canvas/src/lib/canvas-workspace-grid.component.ts`, its `.spec.ts`,
  `canvas-workspace-grid.detail.spec.ts`, `canvas-workspace-grid.styles.ts`, `canvas-grid-items.ts`, its `.spec.ts`
- Contract: remove doomed exports first (`CanvasTileComponent`, `CanvasEmptyStateComponent`,
  `TileAgentIndicatorComponent`, `TileAgentMiniPanelComponent`, and type `CanvasLayout` — minor 2, A3); keep
  `CanvasLayoutService`, `TileLayout`, `CanvasStore`, `CanvasTile`, `OrchestraCanvasComponent`. Delete the rest.
  Parity rows 47-49, 51, 53-55.
- Writer: none (deletions); run rg zero-importer for each deleted basename in `libs` and `apps`.
- Mode 2: rg zero-importer; FULL(canvas), TC(canvas), LINT(canvas); TC(@ptah-extension/tribunal-panel) (index change).
- Mode 2 result: rg zero live importers (hits only in R9j/R9p/R9m/R9k-owned files, R9l e2e selectors, two
  non-import selector strings, risk R11); FULL(canvas) 31 suites / 333 tests green; TC, LINT (0 errors), TC tribunal green.

### Task R9i.1 — COMPLETE

## Batch R9p: Delete live budget, gesture observation, empty state — COMPLETE (1fd6e99cb; review code-logic-review-R9p.md)

- Executor: opencode lane | Fallback: codex lane | Reviewer: Claude code-logic-reviewer | Wave 3 | Depends: R9b, R9i
- Files: `canvas/src/lib/canvas-live-budget.ts`, its `.spec.ts`, `canvas-gesture-observation.ts`, `canvas-empty-state.component.ts`
- Contract: delete Grid-only files; Rail empty-board trigger (R9b) is the replacement. Parity rows 53, 113.
- Writer: rg zero-importer. Mode 2: rg; Wave 3 FULL(canvas), TC(canvas), LINT(canvas).
- Mode 2 result (Wave 3, combined tree): rg zero live importers (hits: `ptah-canvas-empty-state` strings in R9l e2e
  specs incl. decision 90a, and kept canvas specs per R11); FULL(canvas) 27 suites / 275 tests green; TC green;
  LINT 0 errors (16 warnings). No fix round (decision 90).

### Task R9p.1 — COMPLETE

## Batch R9j: Delete Grid detail panel, geometry, tile, indicator — COMPLETE (77b41f02c; review code-logic-review-R9j.md)

- Executor: opencode lane | Fallback: codex lane | Reviewer: Claude code-logic-reviewer | Wave 3 | Depends: R9b, R9i
- Files: `canvas/src/lib/canvas-detail/canvas-detail-panel.component.ts`, its `.spec.ts`,
  `canvas/src/lib/canvas-detail-geometry.ts`, its `.spec.ts`, `canvas/src/lib/canvas-tile.component.ts`, its `.spec.ts`,
  `tile-agent-indicator.component.ts`
- Contract: delete; preserve `CanvasDetailService`, `canvas-session-overrides.ts`, lane tabs/lane view. Rows 56-58.
- Writer: rg zero-importer. Mode 2: rg; Wave 3 FULL(canvas), TC(canvas), LINT(canvas).
- Mode 2 result (Wave 3, combined tree): rg zero live importers (hits: four `ptah-tile-agent-indicator` showcase
  locators, decision 90b; `ptah-canvas-detail-panel` string in `orchestra-canvas.component.spec.ts:906`, R11);
  Wave 3 canvas checks green as R9p. No fix round (decision 90).

### Task R9j.1 — COMPLETE

## Batch R9q: Remove dead gridUpdates metric — COMPLETE (9a17fd085; review code-logic-review-R9q.md)

- Executor: opencode lane | Fallback: codex lane | Reviewer: Claude code-logic-reviewer | Wave 3 | Depends: R9i (A5)
- Files: `canvas/src/lib/canvas-render-metrics.service.ts`, its `.spec.ts`
- Contract: remove `gridUpdates` metric and test; `canvas-rail.component.ts` and spec unchanged.
- Writer: SPEC(canvas, canvas-render-metrics.service.spec.ts). Mode 2: Wave 3 canvas checks.
- Mode 2 result: `gridUpdates` rg 0 hits in libs/apps; Wave 3 canvas checks green as R9p. No fix round.

### Task R9q.1 — COMPLETE

## Batch R9m: Delete grid release, mini-panel, detail keyboard — COMPLETE (b3626c50d; review code-logic-review-R9m.md)

- Executor: opencode lane | Fallback: codex lane | Reviewer: Claude code-logic-reviewer | Wave 4 | Depends: R9b, R9i, R9j
- Files: `canvas/src/lib/canvas-grid-release.ts`, `canvas-grid-release.engine.spec.ts`,
  `tile-agent-mini-panel.component.ts`, its `.spec.ts`, `canvas-detail/canvas-detail-keyboard.ts`, its `.spec.ts`
- Contract: delete before R9k drops geometry references. Parity rows 59, 60.
- Writer: rg zero-importer. Mode 2: rg; FULL(canvas), TC(canvas), LINT(canvas).
- Mode 2 result (Wave 4a, `mode2-wave4a-report.md`): rg 0 hits in libs/apps for 3 basenames + 9 symbols;
  FULL(canvas) 24 suites / 269 tests green; TC green; LINT 0 errors (16 warnings). Review APPROVED 9/10,
  3 Minors recorded (mcp-bench fixture paths; row-60 leak evidence deferred to perf `s-heap`; Escape-in-tablist
  Rail spec gap), no fix round.

### Task R9m.1 — COMPLETE (b3626c50d)

## Batch R9r: Remove setCompactHeight and compactHeightUnits from tab manager — COMPLETE (cea73f11f; review code-logic-review-R9r.md)

- Executor: opencode lane | Fallback: codex lane | Reviewer: Claude code-logic-reviewer | Wave 4 | Depends: R9i, R9j
- Files: `chat-state/src/lib/tab-manager.service.ts`, its `.spec.ts`, `tab-manager.persistence.spec.ts`, `tab-manager.intent-mutators.spec.ts`
- Contract: remove `setCompactHeight` and EVERY `compactHeightUnits` reference in these four files incl. comments;
  preserve `viewMode`; green before R9s drops the type field. Parity row 52, 114.
- Writer: SPEC(@ptah-extension/chat-state, tab-manager.service.spec.ts), SPEC(chat-state, tab-manager.persistence.spec.ts),
  SPEC(chat-state, tab-manager.intent-mutators.spec.ts)
- Mode 2: FULL(chat-state) (first chat-state run), TC(chat-state), LINT(chat-state).
- Mode 2 result (Wave 4b, `mode2-wave4b-report.md`): rg `setCompactHeight|getTabCompactHeightUnits` 0 hits in
  libs/apps; FULL(chat-state) 24 suites / 566 tests green; TC green; LINT 0 errors (2 pre-existing warnings).
  Review APPROVED 9/10, 2 Minors recorded (reload case not discriminating, optional; restore still injects
  `compactHeightUnits` -> carry-over for R9s), no fix round.

### Task R9r.1 — COMPLETE (cea73f11f)

## Batch R9k: Slim layout service; delete layout controls and board toggle — COMPLETE (e8e190455; review code-logic-review-R9k.md, fix round done)

- Executor: codex lane | Fallback: Claude frontend-developer | Reviewer: Claude code-logic-reviewer | Wave 5 | Depends: R9m, R9j, R9i, R9b
- Files: `canvas/src/lib/canvas-layout.service.ts`, its `.spec.ts`, `canvas-layout-controls.component.ts`, its `.spec.ts`,
  `canvas-board-toggle.component.ts`, its `.spec.ts`
- Contract: keep Rail container-width observation/release and exported `TileLayout` (Tribunal); `CanvasLayout`
  may go (R9i already dropped its export); remove Grid geometry imports/tests; delete controls/toggle; leave
  intent and store exports for R9t. Cases: width observation/release, Tribunal type import. Rows 45, 46, 61.
- Writer: SPEC(canvas, canvas-layout.service.spec.ts); rg zero-importer.
- Mode 2: FULL(canvas), TC(canvas), LINT(canvas), TC(@ptah-extension/tribunal-panel).
- Mode 2 result (Wave 5a, `mode2-wave5a-report.md`): rg 0 live importers (3 spec absence asserts; e2e
  hits routed to R9l); FULL(canvas) 22 suites / 247 tests green; LINT 0 errors (16 warnings); TC(canvas)
  and TC(tribunal-panel) each 1 error, only `chat-state/src/lib/tab-persistence.ts:171` TS2367 from R9s's
  uncommitted edit (not at HEAD), none in R9k files or `tribunal-ui.types.ts`. Review APPROVE-WITH-FIXES
  7/10; finding 1 fixed; 3 -> R9l, 6 -> R9t; 2, 4, 5, 7 recorded.

### Task R9k.1 — COMPLETE (e8e190455)

## Batch R9s: Drop compactHeightUnits from TabState — COMPLETE (2365151a8; review code-logic-review-R9s.md APPROVED 8/10, no fix round)

- Executor: opencode lane | Fallback: codex lane | Reviewer: Claude code-logic-reviewer | Wave 5 | Depends: R9r
- Files: `chat-state/src/lib/tab-persistence.ts`, `tab-restore-sanitize.spec.ts`, `tab-persistence.backoff.spec.ts`,
  `chat-types/src/lib/chat-types.ts`
- Contract: drop field and its comments from current `TabState`; remove current writes; tolerate the old stored
  field; preserve `viewMode`. Case: old payload with `compactHeightUnits` loads. The `chat-view.component.ts:911`
  comment is R9h's. Parity row 114.
- Carry-over from R9r review Minor 2: `sanitizeRestoredTab`/`restoredCompactView` (`tab-persistence.ts:188-208`,
  `:272`) still stamps `compactHeightUnits: 2` on restored compact tabs and the spread in `projectTabForPersist`
  writes it back; R9s must delete the restore injection and the legacy constants.
- Writer: SPEC(chat-state, tab-restore-sanitize.spec.ts), SPEC(chat-state, tab-persistence.backoff.spec.ts)
- Mode 2: FULL(chat-state), TC(chat-state), LINT(chat-state), TC(@ptah-extension/chat-types), LINT(chat-types).

### Task R9s.1 — COMPLETE (2365151a8)

## Batch R9t: Late intent/store Grid cleanup — COMPLETE (ad3234690; review code-logic-review-R9t.md APPROVE-WITH-FIXES 8/10, Moderates fixed by row 94)

- Executor: codex lane | Fallback: Claude frontend-developer | Reviewer: Claude code-logic-reviewer | Wave 6 | Depends: R9k, R9p, R9m, R9j, R9i, R9b
- Files: `canvas/src/lib/canvas.store.ts`, its `.spec.ts`, `canvas-layout-intent.ts`, its `.spec.ts`
- Contract: remove applyPreset/projectPreset, span resize, setLayoutLocked, toggleRowBreak, `setBoardMode('grid')`
  and matching specs/intent exports. Keep `MAX_CANVAS_TILES`, `TILE_SPANS`, `TileSpan` (minor 3, needed by
  `TileWidthIntent`), `DEFAULT_TILE_WIDTH`, `TileIntent`, `TileWidthIntent`, `logicalRows`, `reconcileIntent`,
  `retainTilesInLogicalRows`, `sameWidth`; strict v3 width/row-break data. Do not add reorder (item 13 addendum).
  Keep `reorderTiles` and its specs (addendum S5: R9w's Move up/down consumer) and `commitDragIntent` (not on
  the removal list; code-logic-review-R9i.md finding 4).
  Parity rows 50, 61, 64.
- Writer: SPEC(canvas, canvas.store.spec.ts), SPEC(canvas, canvas-layout-intent.spec.ts)
- Mode 2: FULL(canvas), TC(canvas), LINT(canvas).

- Mode 2 result (Wave 6, `mode2-wave6-report.md`): FULL(canvas) 22/23 suites, 241/243 tests; the
  2 failures are only in R9f's mid-edit `canvas-lane-view.component.spec.ts` (`stop` removed, decision 93),
  so R9t has none. TC green, LINT 0 errors (no warning in R9t files). rg: removed symbols have zero callers;
  `reorderTiles`/`commitDragIntent` kept. Row-94 comments accurate. Review APPROVE-WITH-FIXES 8/10;
  M1-M2 fixed (row 94), m3-m5 recorded.

### Task R9t.1 — COMPLETE (ad3234690)

## Batch R9h: Rail retention cap 4, stable ChatView, dock by tab id — COMPLETE (43d48bf89; review code-logic-review-R9h.md, fix round done)

- Executor: codex lane | Fallback: none (codex only) | Reviewer: Claude code-logic-reviewer | Wave H1 | Depends: R9e, R9n (hold lifted, decision 81)
- Files: `chat/src/lib/services/transcript-retention.service.ts`, its `.spec.ts`,
  `chat/src/lib/components/templates/chat-view.component.ts`, its `.html`, `chat-view.keepalive.spec.ts`,
  `chat-view.dock.spec.ts`, `chat/src/lib/tokens/session-context.token.ts`, `chat/src/index.ts`
- Contract: Rail opt-in token cap 4 (shared default 8 unchanged); follow SESSION_CONTEXT; fifth tab evicts; tree
  cache survives while another surface retains the tab; close/workspace release; ordinary tile/main panel
  unchanged; strict owners only in Rail; dock keyed by tab id; remove the `:911` comment's `compactHeightUnits`.
  Never set `HIDE_AGENT_SIDEBAR: true`. Named spec: fenced display opens and updates in place in single chat view.
  Re-validate against the addendum ("one live ChatView, or two while split focus is on"). Rows 68-78, 102.
  Split deltas are NOT R9h's (decision 81): R9u reworks retention and ChatView after H1-H3.
- Decision 89 (code-logic-review-R9e.md finding 2): `ChatView.sessionAgents` (`chat-view.component.ts:542-549`)
  uses `agentsOwnedBySession` when `SESSION_CONTEXT` is injected, else stays on tolerant `agentsForSession`. Key
  on `SESSION_CONTEXT` ONLY, never on `SESSION_CARD_ACTIONS`. It feeds the dock `Agents (N)`, running count, badge
  and dock auto-open. Named cases in `chat-view.dock.spec.ts`: "Rail host (SESSION_CONTEXT) counts only owned
  agents: an unresolved running agent adds no badge or auto-open" (strict) and "single chat view that provides
  SESSION_CARD_ACTIONS without SESSION_CONTEXT keeps unresolved agents" (tolerant). These two specs gate R9f.
- Writer: SPEC(chat, transcript-retention.service.spec.ts), SPEC(chat, chat-view.keepalive.spec.ts), SPEC(chat, chat-view.dock.spec.ts)
- Mode 2: FULL(chat), TC(chat), LINT(chat); confirm both decision-89 cases by name in the FULL(chat) log.
- Mode 2 result (Wave H1, `mode2-h1-report.md`): no new `HIDE_AGENT_SIDEBAR: true` (existing: canvas-detail-transcript
  :56, conductor-tile :221, both R9f's/out of scope); FULL(chat) 202 suites / 3705 passed, 2 skipped; TC green;
  LINT 0 errors (40 pre-existing warnings). Both decision-89 dock cases passed by name (Jest JSON, 26/26) ->
  dock specs pass -> R9f unblocked. Review APPROVE-WITH-FIXES 7/10; fix round fixed S1, M1, M2, M4; M3 and m1-m3 recorded.

### Task R9h.1 — COMPLETE (43d48bf89)

## Batch R9f: Persistent Rail transcript host, restored dock, live full lane — COMPLETE (19db607e8; reviews code-logic-review-R9f.md REVISE 5/10 -> fix round -> -R9f-fix.md 7/10 -> correction (row 98) -> -R9f-correction.md APPROVED 8/10)

- Mode 2 H2 (2026-10-14): NOT ACCEPTED. FULL(canvas) 255/255 and TC(canvas) pass; LINT(canvas) fails with 9
  errors in `canvas-detail-transcript.component.spec.ts:4,13-20` (component-selector, enforce-module-boundaries).
  Not VERIFIED, so row 95's commit waits for a lint fix and a green LINT(canvas). See `mode2-h2-report.md`.

- Executor: codex lane | Fallback: none (codex only) | Reviewer: Claude code-logic-reviewer | Wave H2 | Depends: R9h, R9g, R9n, R9d, R9j (hold lifted, decision 81)
- Gate (decision 89): removing `HIDE_AGENT_SIDEBAR: true` is allowed only after R9h is COMPLETE with both
  decision-89 `chat-view.dock.spec.ts` cases (Rail strict, single-view SESSION_CARD_ACTIONS tolerant) passing in
  its Mode 2. If either case is absent or red, R9f does not start.
- Files: `canvas/src/lib/canvas-detail/canvas-detail-transcript.component.ts`, its `.spec.ts`, `canvas-lane-view.component.ts`,
  its `.spec.ts`, `canvas/src/lib/canvas-rail/canvas-focus-area.component.ts`, its `.spec.ts`,
  `canvas/src/lib/canvas-session-overrides.ts`, `canvas-session-overrides.spec.ts` (new),
  `canvas-detail/canvas-lane-tabs.component.ts` + `.spec.ts` (decision 98, post-cap correction)
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

### Task R9f.1 — COMPLETE (19db607e8)

## Batch R9l: Narrow CanvasBoardMode; detail service; e2e selectors — COMPLETE (27be43205; review code-logic-review-R9l.md APPROVE-WITH-FIXES 6/10, fix round done, row 99)

- Executor: codex lane | Fallback: none (codex only) | Reviewer: Claude code-logic-reviewer | Wave H3 | Depends: R9t, R9f
- Hold lifted: the passed addendum does not own `canvas-detail.service.ts`; its e2e split/reorder cases go to R9x
  after R9l. R9l keeps its approved contract (decision 81).
- Files: `canvas/src/lib/canvas-board-mode.ts`, `canvas-detail/canvas-detail.service.ts`, its `.spec.ts`,
  `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts`, `apps/ptah-electron-e2e/src/specs/task-337-agent-card-refresh.spec.ts`,
  `apps/ptah-electron-e2e/src/specs/git/hunk-revert-top-layer.spec.ts` (decision 90a),
  `canvas/src/lib/orchestra-canvas.component.spec.ts` (decision 96; 7 files, within the 8-file cap)
- Contract: narrow `CanvasBoardMode` to `'rail'`; persistence alone accepts historical `'grid'`; keep Rail lane
  memory; rewrite e2e selectors and task-337 tile/full-view assertion; do not run e2e; `packaged-deps.spec.ts`
  unowned and unchanged; Gridstack kept. Rows 63-66, 115, 116.
  Decision 90a: in `hunk-revert-top-layer.spec.ts:193-196` replace the deleted `ptah-canvas-empty-state` locator
  and the "Orchestra Canvas" heading expectation with the Rail empty-board equivalent (a painted element that
  fills the board behind the dialog) so the modal-above-canvas bounding-box assertion still runs.
  Decision 90c: `CanvasDetailService.toggle/next/prev` have no production caller after R9j; remove them (and
  their spec cases) or keep them only with a named caller.
  Decision 96 (R9k finding 2): remove `containerHeight`, `columnsFor`, `computeLayout` from the `CanvasLayoutService`
  mocks in `orchestra-canvas.component.spec.ts:241-248,735-740` so the mocks match the current service.
  R9k finding 3: rewrite the deleted-control e2e selectors in `canvas.spec.ts:145,553,569,883,898` ("Layout options",
  "Layout presets", "Lock tiles") to Rail equivalents or remove those steps with a reason in the lane report.
- Writer: SPEC(canvas, canvas-detail.service.spec.ts), SPEC(canvas, orchestra-canvas.component.spec.ts)
- Mode 2: SPEC re-run, TC(canvas), LINT(canvas), TC(ptah-electron-e2e), LINT(ptah-electron-e2e).

### Task R9l.1 — COMPLETE (27be43205)

## Addendum batches (items 12 split focus, 13 Rail reorder) — `implementation-plan-rail-r9-split.md`

Common to R9u-R9x: start only after every H1-H3 commit (addendum line 80); serial R9u -> R9v -> R9w -> R9x; if
R9f/R9h already shipped part of a delta, change their file in place, never a compatibility copy (line 89); no
backend/RPC change; no e2e run; split state is never persisted (decision 86: no v3 field, no migration). Each
writer reads the addendum lines cited in its contract. Pattern for menus: `canvas-focus-header.component.ts:19-78`
(keyboard-reachable overflow menu, Escape returns focus). Parity rows 117-124 (addendum "New parity rows").

## Batch R9u: Board-scoped retention coordinator and per-pane dock width — COMPLETE (c8fde086d; reviews code-logic-review-R9u.md 6/10 -> fix round -> -R9u-fix.md APPROVE 8/10 -> correction row 101 -> -R9u-correction.md APPROVE 8/10)

- Executor: codex lane | Fallback: none (codex only, addendum line 84) | Reviewer: Claude code-logic-reviewer | Wave H4 | Depends: R9h, R9l (all H1-H3 commits)
- Files (8): `chat/src/lib/services/rail-transcript-retention-coordinator.service.ts` (new), its `.spec.ts` (new),
  `chat/src/lib/services/transcript-retention.service.ts`, its `.spec.ts`,
  `chat/src/lib/components/templates/chat-view.component.ts`, its `.html`, `chat-view.keepalive.spec.ts`, `chat/src/index.ts`
- Contract (addendum lines 36, 62, 84): a chat-side coordinator that never imports canvas; R9w provides it at
  the Rail boundary. ONE cap of four per visible Rail board, counted as DISTINCT tab trees across both Rail
  ChatViews (not summed service entries); both visible tabs pinned during split and never evicted, so at most two
  extra frozen trees; each tab id owned at most once across panes; reconciles the two component-scoped
  `TranscriptRetentionService` instances by tab id and LRU; insertion order kept so `@for` moves no DOM.
  Transfer X from pane A to pane B: A disposes its frozen X subtree BEFORE B acquires X (never two X subtrees);
  a transfer is not a last-owner release. Close, workspace removal, split collapse and board destroy release
  owners; a tab's execution-tree cache clears only after its last surface owner releases. Expose a measurable
  distinct retained count for the board. Without a coordinator, retention behaves exactly as R9h shipped it
  (ordinary tile, main panel and single-view dock unchanged).
  Export `RAIL_MIN_CONTENT_WIDTH: InjectionToken<Signal<number | null>>` from ChatView's module and
  `chat/src/index.ts`; `isOverlay` = existing 600 px breakpoint OR (token value non-null AND measured host width -
  `dockWidth()` < token value); token absent or null -> existing breakpoint only (R9w supplies 360 in split).
  N6(a)/decision 77d: never provide `HIDE_AGENT_SIDEBAR: true`; the display dock stays mounted in every Rail ChatView.
- Cases (named): coordinator "tab retained in A then shown in B gives exactly one subtree"; "count <= 4 counts
  distinct tab trees"; fifth distinct tab evicts the LRU frozen tree, never a pinned visible tab; close and
  workspace release; cache cleared only at last owner, not on transfer; no coordinator -> unchanged behaviour.
  Keepalive (owned): side dock at 804 px and overlay at 644 px with a 360 px minimum; B2 adds side dock at 976 px
  (1280 stacked) and overlay at 648 px (920 stacked); token absent -> old breakpoint; B5/N6(a) "Rail ChatView with
  coordinator keeps the display dock mounted (HIDE_AGENT_SIDEBAR not provided)". R9h's decision-89 dock cases stay green.
- Writer: SPEC(chat, rail-transcript-retention-coordinator.service.spec.ts), SPEC(chat, transcript-retention.service.spec.ts),
  SPEC(chat, chat-view.keepalive.spec.ts)
- Mode 2: FULL(chat), TC(chat), LINT(chat).

### Task R9u.1 — COMPLETE (c8fde086d)

## Batch R9v: Rail card Session actions menu, Move up/down, Open beside outputs — COMPLETE (61078e201; reviews codex-review-R9v.md REVISE 6/10 -> fix round -> -R9v-fix.md REVISE 6/10 -> correction row 103 -> -R9v-correction.md APPROVE 8/10)

- Executor: Claude frontend-developer | Fallback: codex lane | Reviewer: codex reviewer lane | Wave H5 | Depends: R9c, R9b, R9l, R9u
- Files (8, row 102 adds `ui/src/lib/native/popover/native-popover.component.ts` + `.spec.ts`): `canvas/src/lib/canvas-rail/canvas-rail-card.component.ts`, its `.spec.ts`, `canvas-rail.component.ts`,
  its `.spec.ts`, `canvas-rail-keyboard.ts`, its `.spec.ts`
- Contract (addendum lines 32, 85; N5, N6(b), B6): card and Rail share one API. Card: outputs
  `openBesideRequested`, `moveUpRequested`, `moveDownRequested` = `output<string>()` carrying the tab id; inputs
  `canMoveUp`, `canMoveDown` (boolean) and `splitDisabledReason` (`string | null`). Rail: named input
  `splitDisabledReason: string | null` from the board; forwards the three outputs unchanged (the board is their
  single consumer, R9w); computes per-card `canMoveUp`/`canMoveDown` from the sorted tab ids (N5).
  Labelled `Session actions` trigger is a sibling of `ptah-compact-session-card` inside the fixed-height `li`,
  outside `rc-lane-overflow` and `.rc-select`; expanded 176/96 px cards reserve a trailing action gutter with the
  trigger at its top; collapsed 56 px Rail drops the list's 8 px horizontal padding and uses a 32/24 px two-cell
  row (select first, trigger second, no overlap); host heights unchanged. `isIgnoredCardClick` ignores trigger and
  menu. Collapsed roving Tab: select keeps `[tabIndex]="focused() ? 0 : -1"`, trigger 0 only on the roving current
  card. Menu items Open beside / Move up / Move down; impossible first/last moves disabled; Escape closes the
  menu and returns focus to the trigger. `Alt+Shift+ArrowUp/Down` on a card or its select button emits
  `moveUpRequested`/`moveDownRequested`; unmodified arrows stay with `handleCanvasRailKeydown`.
  B6 disabled reasons (exact strings, constants in the card file): `'Open another session first to split'` (board:
  fewer than two sessions, computed by R9w, passed through the Rail to every card) and `'This session is already in
  the focused pane'` (Rail: the card whose tab id equals `focusedTabId`, when the board reason is null). A stale
  or cross-workspace id is never a disabled reason; the board rejects it with an announcement (R9w).
  N6(b): the expanded action gutter must keep the compact card's `+N more` lane overflow fitting at 176/96 px.
- Cases (named): payload forwarding card -> Rail for all three outputs; disabled reason (both strings) shown and
  Open beside not emitted; trigger click does not select; collapsed Tab order select then trigger; Alt+Shift
  forwarding and boundary (first card no Move up, last no Move down); plain arrows unchanged; Escape focus return;
  176/96/56 px heights with the action gutter and `+N more` still fitting.
- Writer: SPEC(canvas, canvas-rail-card.component.spec.ts), SPEC(canvas, canvas-rail.component.spec.ts),
  SPEC(canvas, canvas-rail-keyboard.spec.ts)
- Mode 2: FULL(canvas), TC(canvas), LINT(canvas).

### Task R9v.1 — COMPLETE (61078e201)

## Batch R9w: Split focus board, panes, Details overlay, reorder consumer — COMPLETE (8c9fc364a; reviews code-logic-review-R9w.md REVISE 5/10 -> fix round -> -R9w-fix.md 6/10 -> correction row 105 -> -R9w-correction.md 6/10; C1-C3 routed to R9x, row 106)

- Executor: codex lane | Fallback: none (codex only, addendum line 86) | Reviewer: Claude code-logic-reviewer | Wave H6 | Depends: R9b, R9f, R9l, R9u, R9v
- Lane budget (risk R9): `timeout: 2400000`, <= 80 tool calls; resume the same session on timeout.
- Files (8): `canvas/src/lib/canvas-rail/canvas-rail-board.component.ts`, its `.spec.ts`, `canvas-focus-area.component.ts`,
  its `.spec.ts`, `canvas/src/lib/canvas-detail/canvas-lane-view.component.ts`, its `.spec.ts`,
  `canvas-detail-transcript.component.ts`, its `.spec.ts`
- Contract (addendum lines 22-30, 42-47, 61, 86; N1, N2, N4, N5, N6(a); B1, B2, B4, B5, B6, B7):
  - Pane state (B7: board owns it): `{ activeSide, otherTabId, visualOrder }` per visible workspace, default
    `visualOrder = ['left','right']` with left/right (top/bottom when stacked) labels; R9x adds only the swap. The
    active pane's tab is always `CanvasStore.focusedTabIdFor(path)`; ids always differ. Board owns the pane
    container, the CSS `order` binding and `splitStacked = layout.containerWidth() < 1440`.
  - Open beside (R9v output): atomic transition; opening the active tab refused with a polite announcement;
    inactive tab activates its pane; stale or cross-workspace id rejected with an announcement; never a third host.
    Board computes `splitDisabledReason` (`'Open another session first to split'` below two sessions, B6).
  - `lastFocusedId` updated synchronously inside every internal transition (no boolean suppression, N1); the
    external-focus effect reads it; a new focused id equal to `otherTabId` exchanges sides; else replace only
    the active pane's tab. jumpTo/newSession/Rail arrows/`CanvasDetailService.open`/main-panel switch go through
    this rule. Never derive from `focusedId()`'s `tiles[0]` fallback during transient null focus.
  - `close(id)` captures was-focused and survivor before `removeTile`; inactive close removes only that pane and
    never focuses a neighbour; active close keeps the survivor (focus it only if the store did not); cancel keeps
    both panes. N1: reconcile pane ids against `tiles()` after ANY removal (incl. `removeTileOnly`/
    `removeTileFromAnyWorkspace`): drop a ghost pane, never the same tab in both panes, announce once.
  - Move up/down (R9v outputs, single consumer, N5): adjacent swap of the sorted ids, one `reorderTiles(ids)` call,
    no pane/session change, focus restored to the moved card's select button, anchored in view, announce title and
    position of total; geometry baseline set to `{ key, order: expectedIds }` before the DOM moves; stale/no-op id
    makes no write and announces; observe `CanvasLayoutPersistenceService.writeFailed` and announce it.
  - Panes: one stable host per pane keyed by pane identity (not tab id); orchestrator transcript stays outside the
    keyed lane block in each pane; `SESSION_VISIBLE` = pane displayed, `SESSION_FOCUSED` = active pane (both true
    in single focus); visibility registration follows `SESSION_VISIBLE`; per-pane unique lane tab/panel ids;
    `paneFocused` and `splitDisplayed` inputs focus area -> lane view -> transcript (N4); transcript provides
    `RAIL_MIN_CONTENT_WIDTH` = 360 only when `splitDisplayed`, else null; activation by click or `focusin` calls
    `focusTile` without remounting. N6(a)/B5: no pane transcript provides `HIDE_AGENT_SIDEBAR: true`.
  - Layout (decision 85, B2, B4): >= 1440 px side by side, < 1440 stacked top then bottom; crossing changes layout
    only (no host release, layout name announced once). Pane wrapper (incl. its header) `min-h-[400px]` (derivation:
    header 48 + lane tabs 36 + about 316 for ChatView with a 2-line to 10 rem composer); column `overflow-y-auto`;
    pane wrappers `min-w-[360px]`, column `overflow-x-auto` (real floor Rail 272 + 360 = 632 px).
  - Details (decision 83, N2, B1): in split, Details is an overlay on the active pane at every band (absolutely
    positioned, reuse the sm pattern at `canvas-rail-board.component.ts:120-155`), opened and closed by a
    pane-header or overlay control that takes no layout width; follows the active tab; Escape and closing split
    close it with dialog-style focus return. Entering split closes the single-focus Details aside; in split
    `effectiveCollapsed` ignores `detailsOpen` and the sm 44 px "i" strip is not a column. Single focus keeps the column.
  - Collapse to single focus resets `visualOrder` to `['left','right']`; split never persisted (decision 86).
- Cases (named, board/focus/lane/transcript specs): "external removal drops a ghost pane without close(), never
  duplicates a surviving tab, announces once"; "split Details overlay opens on active pane at all bands, follows
  active tab, closes on Escape/collapse with focus return; single focus keeps the column"; "920 split: Details open
  does not collapse the Rail" (B1); 1280 and 920 stacked keep two live hosts; default dock width: 1280 side docks,
  920 overlay docks; 400 px wrapper and `overflow-y-auto` bindings asserted (jsdom cannot measure, B2); container
  1439 stacked vs 1440 side by side (B2); crossing 1440 without host remount; close inactive pane keeps active
  focus with an ordered neighbour present; close active pane while the other tab is `tiles[0]` keeps that survivor
  despite transient null focus; jumpTo/newSession/Rail arrows/detail open/main-panel switch; same-id suppression;
  independent lanes and drafts per pane; both docks and `ptah-ui display [id]`; focusin activation and unique
  labels; exactly two and <= 2 live ChatViews in split; 1920 side / 1600 overlay; expected reorder permutation with
  176/96/56 heights; persistence write failure via the service; retained A to live B gives one subtree; B5 "token
  is 360 when splitDisplayed, null in single focus" and "canvas detail transcript does not provide HIDE_AGENT_SIDEBAR".
- Writer: SPEC(canvas, canvas-rail-board.component.spec.ts), SPEC(canvas, canvas-focus-area.component.spec.ts),
  SPEC(canvas, canvas-lane-view.component.spec.ts), SPEC(canvas, canvas-detail-transcript.component.spec.ts)
- Mode 2: FULL(canvas), TC(canvas), LINT(canvas).

### Task R9w.1 — COMPLETE (8c9fc364a)

## Batch R9x: Header split actions, swap, stacked Tab order, drafts, e2e selectors — COMPLETE (4cf6d4f83; reviews codex-review-R9x.md REVISE 6/10 -> fix round (row 107) -> codex-review-R9x-fix.md APPROVE 8/10)

- Executor: Claude frontend-developer | Fallback: codex lane | Reviewer: codex reviewer lane | Wave H7 | Depends: R9l, R9w
- Rationale: addendum says "either"; a Claude writer gives the codex-written R9w board a second family on the same
  files, and the batch is keyboard/visual work.
- Files (8): `canvas/src/lib/canvas-rail/canvas-focus-header.component.ts`, its `.spec.ts`,
  `canvas-rail-board.component.ts`, its `.spec.ts`, `canvas-focus-area.component.ts`, its `.spec.ts`,
  `chat/src/lib/components/molecules/chat-input/chat-input.component.spec.ts`,
  `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts`
- Contract (addendum lines 26, 87; N3, B3, B7): header void outputs `closeSplitRequested`, `closePaneRequested`,
  `swapPanesRequested`, keyboard reachable in the header menu; focus area forwards each with its stable pane id;
  board consumes all three and owns the polite live region and focus return. Close pane releases that pane's host
  (active -> focus survivor; inactive -> focus untouched); Close split keeps the active tab; Escape closes an open
  menu first and never closes a pane; focus returns to the surviving header when its control is removed.
  Swap changes ONLY `visualOrder` (CSS `order` of the two stable wrappers): tab ids, injectors, `@for` keys, lane
  panel ids and ChatView subtrees unchanged; zero transcript transfers or cold mounts; labels follow `visualOrder`.
  B3: side-by-side Tab keeps DOM order after swap (conscious trade-off, recorded: Tab does not follow the visual
  order there). Stacked mode with `visualOrder` swapped: a board-hosted keydown handler intercepts Tab/Shift+Tab at
  the last/first tabbable of a pane and on entry from the Rail so focus goes visual top before bottom; "tabbable"
  query skips hidden elements and excludes an open dock overlay, Details overlay or menu; the handler is inert in
  side-by-side mode and when `visualOrder` is default. Lane-tabs spec (R9f) not modified.
  `chat-input.component.spec.ts`: contextual F5 drafts per `SESSION_CONTEXT` tab. e2e `canvas.spec.ts`: split and
  reorder selectors/cases, never run.
- Cases (named): each header output wired through focus area to board state; Escape before close; close active and
  inactive pane; "stacked swap keeps hosts and top-before-bottom Tab order" (asserts the handler's `focus()` target
  from synthetic keydown, jsdom moves no focus); "side-by-side swap keeps DOM Tab order" (B3); "collapse resets
  visualOrder"; after swap ChatView DOM identity unchanged, <= 2 hosts, no duplicate transcript, active tab,
  selected card, drafts and docks unchanged, labels updated; unique panel ids across panes; contextual F5 drafts.
- Writer: SPEC(canvas, canvas-focus-header.component.spec.ts), SPEC(canvas, canvas-rail-board.component.spec.ts),
  SPEC(canvas, canvas-focus-area.component.spec.ts), SPEC(chat, chat-input.component.spec.ts)
- Mode 2: FULL(canvas), TC(canvas), LINT(canvas); SPEC(chat, chat-input.component.spec.ts) re-run, LINT(chat);
  TC(ptah-electron-e2e), LINT(ptah-electron-e2e). No e2e run.

- Added by rows 105 and 106 (R9x owns `canvas-rail-board.component.ts` + spec): fix R9w C1 (Serious: the board's
  repair `focusTile` is gated on `visible()` only, so in single-chat mode a removal calls `switchTab`; gate it on
  `SURFACE_ACTIVE` and repair when the surface becomes active; spec with SURFACE_ACTIVE false), C2 (hidden removal
  during split keeps the survivor as `lastFocusedId`; spec that returns to the board), C3 (delete the unreachable
  reorder-specific failure branch and flag, rename its spec). NEW-3: move Close split AND the Details control into
  the header (menu or header controls) so no absolute control covers the pane header or lane-tab strip. NEW-6:
  single focus can carry `data-pane-side="right"`; selectors and keyboard code must not assume `left`.

### Task R9x.1 — COMPLETE (4cf6d4f83)

## Phase review and completion

- After the last R9 batch (R9x): one phase-diff code-logic review (plus style: new public `subagent-tile`,
  `single-chat-subagent-view`, Rail token, `RAIL_MIN_CONTENT_WIDTH`, retention coordinator) and visual-reviewer on
  the Electron re-check list (plan §Electron re-check plus addendum §Electron re-check additions 1-5, dark + light,
  before/after Rail shots). Mode 3 verifies parity rows 1-124 and the persistence write-path (R9a, R9s, R9w reorder).
- BL rule (decision 80, N6(c)): at most one live ChatView in single focus, or exactly two (never more) while split
  is on; frozen retained transcripts are `ptah-chat-transcript` subtrees, one shared cap of four per Rail board.
  Count with `ptah-canvas-rail-board ptah-chat-view` (excludes the main-panel ChatView) against board
  `data-canvas-live-views`; fail on duplicate `ptah-chat-transcript` per tab id.
- s-heap / s-switch criteria (addendum line 38): run in single AND split mode; ten warm switches and active-pane
  swaps record live ChatViews, distinct retained / 4, JS heap, elements before/after/added, task and layout
  durations, longest task, CLS; `s-heap.mjs` after 20 swaps and three closes per mode with detached nodes after GC;
  also collapse 2->1 and reopen 1->2. Pass: warm switches no task > 50 ms, CLS 0, zero detached lane-view,
  detail-transcript, chat-transcript and `chat-msg-slot` nodes; cold visit recorded separately; update the 628
  handoff budget.
- Electron re-check additions from B2/B4: shortest supported window 800 x 600 (`main-window.ts:119-120`) where the
  stacked column scrolls and the lower composer is keyboard reachable; smallest window with the left sidebar open
  (canvas container below 800 px; floor Rail 272 + 360 = 632 px) scrolls horizontally.
- Recorded minors for the phase review: R9i findings 1-2 (risk R11); R9c minor (decision 84).
