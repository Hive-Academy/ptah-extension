# Mode 2 report - TASK_2026_629_c0b3, phase R9, Wave 1 (R9a, R9b, R9c, R9d, R9g)

Verdict: ACCEPTED. All 9 scoped checks passed on the combined Wave 1 tree, then each batch was
committed in plan order. No fix was needed from team-leader.

## Checks (serial, through `.ptah/tmp/check-run.mjs`, logs in `%TEMP%\629-check-<label>.log`)

| Label | Command | Result |
| --- | --- | --- |
| m2-canvas-full | `npx nx test @ptah-extension/canvas --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | exit 0; Test Suites 34/34 passed; Tests 422/422 passed |
| m2-canvas-tc | `npx nx typecheck @ptah-extension/canvas --parallel=1 --skip-nx-cache` | exit 0; typecheck succeeded |
| m2-canvas-lint | `npx nx lint @ptah-extension/canvas --parallel=1 --skip-nx-cache` | exit 0; 0 errors, 22 warnings |
| m2-chatui-full | `npx nx test @ptah-extension/chat-ui --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | exit 0; Test Suites 72/72 passed; Tests 1411/1411 passed |
| m2-chatui-tc | `npx nx typecheck @ptah-extension/chat-ui --parallel=1 --skip-nx-cache` | exit 0; typecheck succeeded |
| m2-chatui-lint | `npx nx lint @ptah-extension/chat-ui --parallel=1 --skip-nx-cache` | exit 0; 0 errors, 7 warnings (none in R9c files or `index.ts`) |
| m2-chat-full | `npx nx test @ptah-extension/chat --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | exit 0; Test Suites 201/201 passed; Tests 3665 passed, 2 skipped, 3667 total |
| m2-chat-tc | `npx nx typecheck @ptah-extension/chat --parallel=1 --skip-nx-cache` | exit 0; typecheck succeeded |
| m2-chat-lint | `npx nx lint @ptah-extension/chat --parallel=1 --skip-nx-cache` | exit 0; 0 errors, 39 warnings |

Lint warnings are not errors. The canvas warnings sit in spec files and in Grid files that later R9 waves
delete. One new warning comes from Wave 1:
`libs/frontend/chat/src/lib/components/organisms/execution/subagent-tile.component.ts:80` has two
`@typescript-eslint/no-non-null-assertion` warnings (`endTime!`, `startTime!` in `duration`). It is
recorded as a Minor for the phase review and was not fixed.

## Contract and fix verification (on disk, before the checks)

- R9a: the schema seam is `z.enum(['rail','grid']).catch('rail').transform(() => 'rail')`, and the write
  path forces `mode: 'rail'`. The typed `mode: 'grid' as const` is gone from the spec.
- R9b: `orchestra-canvas.component.ts:413-420` has a new effect. When `canAddTile()` turns false,
  it runs `untracked(handleCancelSession)`, which closes the popover and clears its name (finding 1).
  The spec is at `orchestra-canvas.rail.spec.ts:436`.
  `canvas-rail-board.component.ts:371-381`: `emptyBoardNewSession()` returns early while
  `newSessionBlockReason()` is set (finding 2).
  The host has no Grid imports (workspace-grid, detail-panel, detail-keyboard, layout-controls,
  board-toggle, live-budget, empty-state). No file imports `orchestra-canvas.detail`.
- R9c: the changes stay inside the four contract files. The codex review APPROVED it with 1 Minor recorded.
- R9d: `compact-lane-rows.ts` applies `strictOwnership` as owner equality.
  `compact-session-card.component.ts` uses `agentsOwnedBySession` and strict rows when
  `SESSION_CARD_ACTIONS` or `SESSION_CONTEXT` is injected. The main panel stays tolerant. This
  OR condition is now an R9n risk (see below).
- R9g:
  - `subagent-tile.component.ts` checks terminal states first: record failed, stopped, killed or
    completed; then node error, interrupted or resumed (resumed maps to stopped), or complete. Only
    after that does it check background.
  - The lane key comes from the shared `laneKey()` (`compact-lane-rows.ts:27`) using
    `record?.status === 'background'`, which is the same predicate as `compact-lane-rows.ts:75`.
  - `formatAgentElapsed` is imported from `@ptah-extension/chat-ui`, and `chat-ui/src/index.ts`
    exports it.
  - `agentTileMode` is passed on every recursive edge (`execution-node.component.ts:301,331,375,394`)
    and from `message-bubble.component.html:108`. It defaults to `false`.
  - `agent-execution.component.ts` is untouched.

## Commits (foreground, explicit paths, hooks ran, no amend)

| Batch | Verdict | Commit | Files |
| --- | --- | --- | --- |
| R9a | COMPLETE | e24a8c93e | canvas-layout-persistence.service.ts + spec |
| R9b | COMPLETE | c8d8bc95f | orchestra-canvas.component.ts, .component.spec.ts, .rail.spec.ts, .detail.spec.ts (deleted), canvas-rail-board.component.ts + spec |
| R9c | COMPLETE | 713ec57ae | canvas-rail-card.component.ts + spec, compact-rail-card.component.ts + spec |
| R9d | COMPLETE | b9736bd4e | compact-lane-rows.ts + spec, compact-session-card.component.ts + spec, canvas-lane-tabs.component.spec.ts |
| R9g | COMPLETE | 8f9d63757 | execution-node.component.ts, execution-node.ptah-ui.spec.ts, subagent-tile.component.ts + spec (new), message-bubble.component.ts/.html/.spec.ts, chat-ui/src/index.ts |

The task docs are committed separately as `docs(canvas)`. That commit leaves out
`implementation-plan-rail-r9-split.md` and `implementation-plan-rail-r9-split-rereview.md`,
because a codex lane is still editing them.

## batches-rail-r9.md updates

- R9a-R9d and R9g, with their tasks, are now COMPLETE with commit SHAs. The header reads Complete 5/20.
- `chat-ui/src/index.ts` is added to the R9g files (decision 84).
- R9n now has an acceptance gate (decision 84): in tile mode a pending permission must be answerable,
  either by rendering the permission card or by routing through SESSION_CARD_ACTIONS. A spec case is
  required.
- R9n now carries the HANDOFF §5 risk. R9d makes the compact card strict when `SESSION_CARD_ACTIONS`
  or `SESSION_CONTEXT` is injected. R9n's single-view `SESSION_CARD_ACTIONS` handler must not make the
  main-panel compact card strict. The writer and the reviewer must check this, and a spec case is
  required.

### Next action: start Wave 2 (R9e codex, R9n Claude FD, R9o Claude FD, R9i opencode) from HEAD 8f9d63757 plus the docs commit; record the subagent-tile.component.ts:80 non-null-assertion Minor for the R9 phase review.
