# Mode 2 report: Wave 2a (R9o, R9i) and the split addendum decomposition

TASK_2026_629_c0b3, phase R9. W = `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5`,
branch `feat/task-629-canvas-board`. Start HEAD c57d04e2b; end HEAD df3b88e8d. Nothing pushed.
R9e and R9n (chat project) were left uncommitted and unstaged. No chat-project file was staged or edited.

## Part A: verification

### R9o: panel Turn summary as inline mini cards

- Diff vs contract: 5 files, all under `libs/frontend/chat-ui/src/lib/`: `turn-summary.component.ts` + spec,
  `turn-summary-chip.component.ts` + spec, `turn-summary-mini-card.styles.ts` (new). `turn-summary-files`,
  `turn-summary-tests`, `ptah-ui-display-chip` spec and `display-panel.component.ts` were not changed (decision 77
  inputs held).
- Fix round (codex-review-R9o.md finding 1, Serious) is on disk. `turnKeyOf(summary)` is at
  `turn-summary.component.ts:114-123`: changeSet `sessionId` + `turnStartedAt`, with test-run commands as the
  fallback. `turnKey = computed(...)` is at `:432`. `sectionOpen` and `userOpen` are
  `linkedSignal({ source: turnKey, ... })` at `:437-451`. `isOpen` (`:470-474`) forces a conflicted Files card
  open unless the user toggled it in the same turn. There are 4 new spec cases in the "disclosure state lasts one
  turn" block.
- Lint fix by team-leader (trivial, allowed by the brief): `turn-summary-chip.component.ts:86-87` had both a
  static `class="my-2"` and `[class]="MINI_SECTION_CLASS"`, which tripped
  `@angular-eslint/template/no-duplicate-attributes` with 2 errors. They are merged into one binding:
  `[class]="SECTION_CLASS"`, where `SECTION_CLASS = \`my-2 ${MINI_SECTION_CLASS}\``. The rendered classes are the
  same, and the chip spec (which asserts `my-2` plus each shared token) is green.

### R9i: first Grid deletion

- Diff vs contract: `libs/frontend/canvas/src/index.ts` now exports exactly `OrchestraCanvasComponent`,
  `CanvasStore`, `CanvasTile`, `CanvasLayoutService` and `TileLayout`. It no longer exports `CanvasTileComponent`,
  `CanvasEmptyStateComponent`, `TileAgentIndicatorComponent`, `TileAgentMiniPanelComponent` or `CanvasLayout`.
  Six files were deleted: `canvas-workspace-grid.component.ts` + spec, `canvas-workspace-grid.detail.spec.ts`,
  `canvas-workspace-grid.styles.ts`, and `canvas-grid-items.ts` + spec.
- Review code-logic-review-R9i.md: APPROVED 9/10. Minors 1-2 (stale selector strings) are recorded as risk R11,
  not fixed. Moderate 4 is in R9t's contract: keep `reorderTiles` and `commitDragIntent`.

## Checks (serial, one at a time, from W, every heavy check through `.ptah/tmp/check-run.mjs`)

| Label | Result |
| --- | --- |
| rg R9i (per basename and export, `libs` + `apps`) | Zero live importers. `canvas-grid-items`, `canvas-workspace-grid.component`, `.styles`, `.detail` and `CanvasWorkspaceGrid` have 0 hits. The `ptah-canvas-workspace-grid` selector string remains in e2e `canvas.spec.ts` (7 lines, owned by R9l) and in `orchestra-canvas.rail.spec.ts:296` and `orchestra-canvas.component.spec.ts:906` (non-import strings, R11). `CanvasTileComponent` appears only in R9j files. `CanvasEmptyStateComponent` appears only in an R9p file. `TileAgentIndicatorComponent` appears only in R9j files. `TileAgentMiniPanelComponent` appears in R9m and R9j files. `CanvasLayout\b` appears in `canvas-layout.service.ts` (the definition, R9k) and in `canvas-detail-geometry.*` (R9j). No file imports `CanvasLayout` from `@ptah-extension/canvas`. |
| m2w2-canvas-full | exit 0. Test Suites 31 passed / 31; Tests 333 passed / 333 |
| m2w2-canvas-tc | exit 0. Typecheck `@ptah-extension/canvas` passed |
| m2w2-canvas-lint | exit 0. 0 errors, 20 warnings (existing) |
| m2w2-tribunal-tc | exit 0. Typecheck `@ptah-extension/tribunal-panel` passed |
| m2w2-chatui-spec turn-summary.component.spec.ts | exit 0. 36 / 36 |
| m2w2-chatui-spec turn-summary-chip.component.spec.ts | exit 0. 24 / 24 |
| m2w2-chatui-spec ptah-ui-display-chip.component.spec.ts | exit 0. 28 / 28 |
| m2w2-chatui-spec display-panel.component.spec.ts | exit 0. 18 / 18 |
| m2w2-chatui-tc | exit 0. Typecheck `@ptah-extension/chat-ui` passed |
| m2w2-chatui-lint (1st) | exit 1. 2 errors at `turn-summary-chip.component.ts:86:7` and `:87:7` (duplicate `class`, R9o). Fixed as above |
| m2w2-chatui-spec turn-summary-chip.component.spec.ts (re-run) | exit 0. 24 / 24 |
| m2w2-chatui-lint (re-run) | exit 0. 0 errors, 7 warnings (existing) |
| m2w2-chatui-tc (re-run after the fix) | exit 0. Passed |

Logs are in `%TEMP%\629-check-m2w2-*.log`. No chat-project error appeared in any check.

## Per batch verdict

| Batch | Verdict | Commit |
| --- | --- | --- |
| R9o | COMPLETE. Contract met, fix round verified, scoped checks green after the lint fix | b78468290 `feat(chat-ui): batch R9o - panel turn summary as inline mini cards` |
| R9i | COMPLETE. Contract met, zero importers, full canvas suite green | df3b88e8d `refactor(canvas): batch R9i - delete the workspace grid and its exports` |

Both commits were made in the foreground with explicit paths. R9i staged its 6 deleted paths explicitly. The hooks
passed, and there was no amend and no `--no-verify`.

## Part B: `batches-rail-r9.md` updates

- Header: 24 batches / 24 tasks, 7/24 COMPLETE, Held 0. There is a new addendum source paragraph (decision 88,
  N1-N6, B1-B7, user decisions 82, 83, 85, 86).
- Status changes: R9o is COMPLETE (b78468290), and R9i is COMPLETE (df3b88e8d), each with its Mode 2 result
  lines. R9h, R9f and R9l move from HELD to PENDING (decision 81). R9l's hold reason no longer applies: the addendum
  does not own `canvas-detail.service.ts`, and its e2e cases go to R9x after R9l.
- R9h (decision 89): `ChatView.sessionAgents` (`chat-view.component.ts:542-549`, verified) uses
  `agentsOwnedBySession` when `SESSION_CONTEXT` is present, keyed on `SESSION_CONTEXT` only. Two named
  `chat-view.dock.spec.ts` cases are added: a Rail host is strict, and a single chat view that provides
  SESSION_CARD_ACTIONS is tolerant. The file set stays at 8.
- R9f: a gate line says `HIDE_AGENT_SIDEBAR: true` may be removed only after R9h is COMPLETE with both
  decision-89 cases green.
- R9t: keep `reorderTiles` (needed by R9w) and `commitDragIntent` (R9i review finding 4).
- New batches, placed after R9l (the last owner of shared files):
  - **R9u** (Wave H4). Codex lane, no fallback, Claude code-logic-reviewer, 8 chat files. Covers the retention
    coordinator, the shared cap of 4 by distinct tab, transfer disposal and `RAIL_MIN_CONTENT_WIDTH`. Folds in
    N6(a), B2 (976 and 648 px keepalive rows) and B5 (dock-mounted case).
  - **R9v** (Wave H5). Claude frontend-developer, codex fallback, codex reviewer lane, 6 canvas files. Covers card
    and Rail outputs and inputs, the Session actions menu, Alt+Shift moves and fixed heights. Folds in N5, N6(b)
    and B6, with the exact disabled-reason strings.
  - **R9w** (Wave H6). Codex lane, no fallback, Claude code-logic-reviewer, 8 canvas files. Covers the pane state
    machine, `lastFocusedId`, the close transition, ghost reconcile, the reorder consumer, panes, tokens, stacked
    layout and the Details overlay. Folds in N1, N2, N4, N5, N6(a), B1, B2, B4, B5, B6 and B7. Lane budget is
    `timeout: 2400000` and <= 80 tool calls (risk R9).
  - **R9x** (Wave H7). Claude frontend-developer, codex fallback, codex reviewer lane, 8 files across canvas, chat
    (one spec) and the e2e app. Covers header outputs, swap via `visualOrder`, the stacked Tab handler, F5 drafts
    and e2e selectors. Folds in N3 and B3, including the named case "side-by-side swap keeps DOM Tab order" and
    the recorded trade-off.
- Waves: rows H4-H7 are added and run serially, following the plan's ordering (addendum line 80). The H1-H3 rows
  are no longer gated.
- Dependencies:
  - R9u <- R9h, R9l (all H1-H3)
  - R9v <- R9c, R9b, R9l, R9u
  - R9w <- R9b, R9f, R9l, R9u, R9v
  - R9x <- R9l, R9w
  - R9f also depends on R9h's decision-89 specs.
- Risks: R3 and R6 are updated. New R9 (size of R9w), R10 (R9x spans three projects) and R11 (R9i minors).
- Phase review section, updated per N6(c):
  - BL rule: one live ChatView, or exactly two while split. The section gives the counting selector.
  - s-heap and s-switch criteria apply in both single and split mode.
  - Electron re-check additions from B2/B4: the 800 x 600 window, and the smallest window with the left sidebar
    open.
  - Parity rows now run 1-124.
- The TF docs (`batches-rail-r9.md`, this report) are not committed; the orchestrator commits them.

### Next action: run Mode 2 for R9e and R9n once the R9n codex review and its fix round are done (chat project: SPECs, TC/LINT chat). Then launch Wave 3 (R9p, R9j, R9q). R9h (H1) is ready once R9e and R9n commit.
