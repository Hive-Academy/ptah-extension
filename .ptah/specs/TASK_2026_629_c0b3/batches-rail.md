# Batches - TASK_2026_629_c0b3 - Rail board mode

Source plan: `implementation-plan-rail.md` (Gate 2 approved, decisions rows 55-58), including `## Revision 1`.
Earlier phases stay in `batches.md`; this file covers only the Rail phase.

Worktree root (ROOT): `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5`.
Every path below is relative to ROOT. Lanes run all commands from ROOT.

Total batches: 10 (R0, R1, R2, R3, R4a, R4b, R5, R6, R7, R8) | Complete: 7/10
Executor for every batch: `frontend-developer` role on a codex CLI lane (one lane per batch, sequential).
Fallback executor: `frontend-developer` sub-agent.
Lanes never commit and never run git that changes anything. The orchestrator verifies on disk, then commits one batch
per commit.

## Plan validation

Status: PASSED WITH RISKS (no BLOCKER; 4 HIGH risks are spec-fixture breaks the plan calls "unedited").

Files checked on disk at `767fe3d9a`: every MODIFY target exists; every CREATE target is absent
(`canvas-board-mode.ts`, `canvas-rail/`, `terminal-failure-seq.ts`, `compact-rail-card.component.ts`,
`state-ink-contrast.spec.ts`). No "create" turns into "extend".
Projects and targets checked in each `project.json`: `@ptah-extension/chat-types` has lint and typecheck only (no test);
`chat-state`, `chat-ui`, `chat`, `canvas`, `ptah-extension-webview` have test, lint, typecheck.

### Assumptions (A1-A5)

- **A1** (tone mapping, R2) — **verified now, with one nuance.** In
  `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-summary.ts` the status `tone: 'error'` is set
  at `:705` (`Failed`), `:730` (`Limit reached`) and `:732` (`Needs attention`); `Stopped` (`:723`) and `Needs input`
  (`:687`) are `warning`. So the plan's `summary().status.tone === 'error'` → `error` rule holds, and a limit-reached
  session reads as Rail `error`, a stopped one as `done`/`idle`. R2 re-reads these lines and records the mapping in its
  report; no code change is needed for A1.
- **A2** (`useExisting: forwardRef` self-provider, R5) — unverified. Proved by
  `canvas-rail-card.component.spec.ts` case (4) in R5. R5 is not accepted until that case passes. Fallback if it fails:
  a separate `@Injectable` actions adapter provided by the wrapper (lane reports it; team-leader rejects any other
  redesign).
- **A3** (existing orchestra specs resolve Grid, R7) — **resolved now: they do not.** Evidence:
  - `orchestra-canvas.component.spec.ts:236-264` mocks `CanvasStore` with no `boardFor` / `activeBoard`;
  - `:886-898` and `:1086-1098` stub `CanvasLayoutPersistenceService.load` returning `{tiles:null, writable, needsWrite}`
    with no `board`, so the real store defaults to Rail (`DEFAULT_BOARD_STATE.mode = 'rail'`, plan Component 1);
  - the stubs have no `writeFailed` / `readOnlyPaths`, which the R7 dock notes read.
  So R7 **must** edit `orchestra-canvas.component.spec.ts` fixtures (store mock gains board members returning `grid`;
  persistence stubs return `board: {mode:'grid', ...}`, `readOnlyReason: null`, `writeFailed: signal(false)`,
  `readOnlyPaths: signal(new Set())`). Fixture edits only; no `it` body or assertion changes. Recorded in R7.
- **A4** (`@if/@else` destroys the old branch before creating the new one, R7) — unverified. Proved by the
  `orchestra-canvas.rail.spec.ts` draft case in R7 (type a draft, switch mode, draft restored). Backstop:
  `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.spec.ts:319` (destroy-save) stays green.
- **A5** (restore keeps `terminalFailureSeq`, R0) — not load-bearing. R0 reads `tab-restore-sanitize.ts` and reports
  whether the field survives; no change either way.

### Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| K1 | `canvas-detail.service.spec.ts:22-27` mocks `CanvasStore` as `{tiles, focusTile}` and provides no `TabManagerService`. The new mode-aware `open` (`boardFor(activePath).mode`) and the `onTabClosed` prune make the 3 existing cases throw, although the plan says "unedited". | HIGH | R4a: fixture-only edit of that `providers` block (add `boardFor`/`activeWorkspacePath` returning `grid`, a `TabManagerService` mock with `onTabClosed: jest.fn(() => jest.fn())`). Existing `it` bodies unchanged. Recorded in the R4a report. |
| K2 | `orchestra-canvas.component.spec.ts:423,473` read `onTabClosedMock.mock.results[0]` / `.calls[0][0]` as the orchestra's own listener. `orchestra-canvas.component.ts:334` injects `CanvasDetailService` as a field, before the orchestra subscribes at `:553`; if the service subscribes in its constructor it becomes call 0 and those tests break. `:348,357` call `detail.open('b')` against the store mock with no `boardFor`. | HIGH | R4a: the detail service must not subscribe to `onTabClosed` at construction. It subscribes lazily on the first lane-map write (still released through `DestroyRef`), so the orchestra listener stays call 0. The `canvasStoreMock` gets `boardFor` returning `grid` (fixture-only). R4a runs the whole canvas project, so the break is caught in R4a, not R7. |
| K3 | R7 must edit the orchestra spec fixtures (A3). | HIGH | R7 file list carries `orchestra-canvas.component.spec.ts` as fixture-only MODIFY. |
| K4 | `orchestra-canvas.detail.spec.ts:49-56` calls `onDetailKeydown` with a fake `this` that has only `surfaceActive`, `detailTabId`, `detail`; it also calls it with the detail closed and expects nothing. A Rail branch that reads `this.canvasStore.activeBoard()` throws there. | HIGH | R7: keep this spec unedited by routing so the Grid path needs nothing new: Grid branch when `detailTabId()` is non-null (the Grid gate is already inside `detailTabId`); the Rail branch goes through an optional active-Rail-board handle (`this.activeRailBoard?.()`), a no-op when absent. If the lane cannot keep it unedited, it stops and reports; it does not edit the spec. |
| K5 | `canvas-detail-transcript.component.spec.ts:19-38,70-85` provides no `EffortStateService` / `ModelStateService`; the extracted `freezeSessionOverrides` injects both (root, `libs/frontend/core/src/lib/services/effort-state.service.ts:14-17`, `model-state.service.ts:43-51`, which inject `ClaudeRpcService`). Root construction may fail in jsdom. | MEDIUM | R4b: run the existing transcript spec first after the change. If root construction fails, add fixture-only providers (`isLoaded: signal(false)`, `currentEffort`/`currentModel` signals). Recorded. |
| K6 | The `CanvasLayoutLoadResult` shape change (D16) reaches the orchestra spec persistence stubs, which return the old shape. | MEDIUM | R3: the store reads `loaded.board ?? existing ?? DEFAULT_BOARD_STATE` (undefined-safe) so old-shape stubs still hydrate; R3 runs the whole canvas project and must stay green without touching the orchestra spec. |
| K7 | Rail renders no Grid path until R7, but R3 flips the in-memory default to Rail. | LOW | Nothing reads `boardFor` for rendering before R7; R3-R6 project runs prove Grid unchanged. |
| K8 | R6 is the largest batch (Component 13 board, ~108 plan lines, plus focus area, geometry, metrics). | MEDIUM | 60-call ceiling; geometry and metrics are pure and tested first; the board spec is last. If the ceiling is hit, the lane returns a partial report and the orchestrator resumes the same lane. |
| K9 | Public surface grows: chat-ui barrel (`CompactRailCardComponent`, `COMPACT_RAIL_CARD_HEIGHT`, `CompactRailState`, `CompactRailDensity`), chat-types `TabState.terminalFailureSeq`, and new inputs/outputs on the chat smart card. | LOW | Style review scoped to R0, R1, R2 (see Review). `canvas/src/index.ts` must export nothing new (checked in R7 acceptance). |
| K10 | R5/R6 component styles reference R8 tokens, but R8 runs last (plan order). | LOW | R5/R6 must use the `var(--state-ink-x, <daisy fallback>)` form (plan Component 17), so Rail renders correctly before R8; the R8 contrast spec then pins the real values. Team-leader rejects a bare `var(--state-ink-x)` in R5/R6. |

### Disjointness check

All batches are file-disjoint except `libs/frontend/canvas/src/lib/orchestra-canvas.component.spec.ts`, which R4a (K2,
fixture-only, conditional) and R7 (K3, fixture-only) both may touch. The run is strictly sequential, so this is safe;
the R7 lane reads R4a's committed version first. No batch exceeds 8 files.

### Edge cases (owner batch)

- Two equal-text `StopFailure` errors get two ids; a duplicate stamp keeps one — R0 (store), R2 (card id).
- Reset must not clear `terminalFailureSeq` — R0.
- Replacement permission / question, stale shown id refused and announced — R2 (logic), R1 (view), R5 (wrapper).
- Dense `+N` with 0, 1, 4 lanes — R1, R5, R6.
- v2 record opens as Rail with Grid layout intact; `it.each([99, 2.5, 3.5])` stays read-only — R3.
- Board setters never change `tilesFor(path)()` identity or `workspaceRevision` — R3.
- Queue Esc closes only the queue — R4a (unit), R7 (integration).
- Lane strip reveal on its own width change; no `ResizeObserver` in jsdom — R4a.
- Hidden Rail workspace mounts nothing live — R6 (board), R7 (integration).
- Geometry baseline reset only on density, collapse, add/close — R6.
- Draft survives a mode switch (A4) — R7.

## Run order (strictly sequential, one lane and one heavy check at a time)

| Step | Batch | Depends on | Why here |
|---|---|---|---|
| 1 | R0 | none | Feeds R2's error id; two projects, isolated. |
| 2 | R1 | none | chat-ui view and shared height constant needed by R2, R5, R6. |
| 3 | R2 | R0, R1 | Smart card rail variant. |
| 4 | R3 | none | Board state and v3 record; needed by R4a-R7. |
| 5 | R4a | R3 | Detail service, lane tabs, queue (K1, K2). |
| 6 | R4b | R3 | Transcript gating and helper extraction (K5). |
| 7 | R5 | R2, R3 | Rail, rail card (A2), focus header, keyboard. |
| 8 | R6 | R4a, R4b, R5 | Focus area, board, geometry, metrics. |
| 9 | R7 | R6 | Toggle and orchestra integration (A3, A4, K3, K4). |
| 10 | R8 | none | Independent; plan order keeps it last (K10). |

The next batch starts only after the previous one is committed.

## Review

- Phase: **Rail** = R0-R8 (all ten batches).
- **One code-logic review** (Claude `code-logic-reviewer`) on the combined Rail diff, requested after R8 (the last batch) commits:
  range = parent of R0's commit .. `HEAD`. Reject on TODO/PLACEHOLDER/STUB, empty bodies, mock data standing in for
  logic. It must check K1-K6, the R2-1 stale-id rule, the D10 error id, draft safety (A4) and the one-live-view
  contract.
- **One style review** (`code-style-reviewer`) only for the new public API, scoped to the R0, R1 and R2 commits:
  `libs/frontend/chat-types/src/lib/chat-types.ts`, `libs/frontend/chat-ui/src/index.ts`,
  `compact-lane.types.ts`, `compact-rail-card.component.ts`, `compact-session-card.component.ts` inputs/outputs.
  Canvas adds no public API (Rail components stay internal).
- No per-batch review. One fix round at most, then one re-review scoped to the fixes.
- Completion (Mode 3) also needs the Electron re-check list (plan `## Electron re-check list`) and visual-reviewer
  screenshots in dark (`anubis`) and light (`anubis-light`) against the approved prototype
  `prototypes/02-focus-rail.html`, plus parity against `parity-inventory-layout.md` rows 1-44 and the write-path trace
  for the v3 record (`canvas-layout-persistence.service.ts` write → `load` → `CanvasStore.hydrateWorkspace`).

## STRICT checks (CLAUDE.md) — repeated verbatim in every batch below

The block each batch carries, with `<project>` and `<spec>` filled in:

> - Test only the changed project. First the changed specs, one at a time:
>   `npx nx test <project> --testFile=<spec> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
>   (never `--testPathPattern`).
> - Then the project once:
>   `npx nx test <project> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`.
> - Then `npx nx typecheck <project> --parallel=1 --skip-nx-cache` and
>   `npx nx lint <project> --parallel=1 --skip-nx-cache`.
> - One heavy check at a time. No workspace-wide runs. No `build`, `serve`, `dev`, `e2e` or `package`. No
>   `npm install`.
> - Filter output: redirect Jest output to a file, strip `\x1b\[[0-9;]*m`, grep `Tests:|Test Suites:|FAIL `.
> - Lanes never commit (the orchestrator commits after verifying).
> - Backend Jest that loads better-sqlite3 fails until the user rebuilds it; frontend Jest is fine.

---

## Batch R0: Terminal failure sequence (chat-types, chat-state) — COMPLETE (commit 6bf6073bb)

- Goal: every newly stamped terminal reason advances a per-tab `terminalFailureSeq` inside the same store update, on
  every path including `StopFailure` (plan Component 7a, `implementation-plan-rail.md:468-520`; D10).
- Projects: `@ptah-extension/chat-state`, then `@ptah-extension/chat-types` (typecheck and lint only).
- Depends on: none.
- Executor: `frontend-developer` on a codex CLI lane. Tool-call ceiling: 60.
- Files:
  - MODIFY `libs/frontend/chat-types/src/lib/chat-types.ts` (`TabState.terminalFailureSeq?: number`, doc comment)
  - CREATE `libs/frontend/chat-state/src/lib/terminal-failure-seq.ts` (pure `withTerminalFailureSeq`, no barrel export)
  - CREATE `libs/frontend/chat-state/src/lib/terminal-failure-seq.spec.ts`
  - MODIFY `libs/frontend/chat-state/src/lib/tab-manager.service.ts` (`updateTabInternal`, before the `differs` check)
  - MODIFY `libs/frontend/chat-state/src/lib/tab-workspace-partition.service.ts` (`updateBackgroundTab`, before the
    spread)
  - CREATE `libs/frontend/chat-state/src/lib/tab-manager.terminal-failure.spec.ts`
- Acceptance:
  - Pure spec: cleared → advance; same reason → no advance; different reason → advance; `null`/`undefined` → no
    advance; update without the key returns the same reference.
  - Store spec: (1) stamp, `markTabStreaming`, stamp same text → seq 1 then 2 with no `turn_state`; (2) `failed`
    `turn_state` then the same reason → seq stays 1; (3) background-tab path through `updateBackgroundTab`.
  - The reset block (`tab-manager.service.ts:1262-1280` region) does not clear the counter.
  - No extra store write or signal emission; the field is not added to `NON_PERSISTED_TAB_KEYS`.
  - Existing chat-state specs pass unedited. Report A5 (does `tab-restore-sanitize.ts` keep the field).
- Spec files to run:
  - `libs/frontend/chat-state/src/lib/terminal-failure-seq.spec.ts`
  - `libs/frontend/chat-state/src/lib/tab-manager.terminal-failure.spec.ts`
- STRICT checks (verbatim; `<project>` = `@ptah-extension/chat-state`, then `@ptah-extension/chat-types` typecheck and
  lint only, one project at a time):
  - Test only the changed project. First the changed specs, one at a time:
    `npx nx test <project> --testFile=<spec> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
    (never `--testPathPattern`).
  - Then the project once:
    `npx nx test <project> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`.
  - Then `npx nx typecheck <project> --parallel=1 --skip-nx-cache` and
    `npx nx lint <project> --parallel=1 --skip-nx-cache`.
  - One heavy check at a time. No workspace-wide runs. No `build`, `serve`, `dev`, `e2e` or `package`. No
    `npm install`.
  - Filter output: redirect Jest output to a file, strip `\x1b\[[0-9;]*m`, grep `Tests:|Test Suites:|FAIL `.
  - Lanes never commit (the orchestrator commits after verifying).
  - Backend Jest that loads better-sqlite3 fails until the user rebuilds it; frontend Jest is fine.
- Status: COMPLETE. Verified on disk by team-leader; re-run checks: pure spec 6/6, store spec 3/3, chat-state
  project 24 suites / 572 tests, typecheck and lint pass for chat-state and chat-types (2 pre-existing lint
  warnings, 0 errors). Reset block leaves the counter; `NON_PERSISTED_TAB_KEYS` unchanged; no barrel export.
  A5: `tab-restore-sanitize.ts` does not exist; the restore path `tab-persistence.ts` spreads the tab, so the field
  survives (lane-R0-report.md).

## Batch R1: CompactRailCardComponent and shared rail types (chat-ui) — COMPLETE (commit e877d0c91)

- Goal: the presentational rail card in comfortable (176) and dense (96) density, with request-bound actions and the
  shared height pair (plan Component 8, `:521-620`; Rev 1 findings 1, 4, 5).
- Project: `@ptah-extension/chat-ui`.
- Depends on: none.
- Executor: `frontend-developer` on a codex CLI lane. Tool-call ceiling: 60.
- Files:
  - MODIFY `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-lane.types.ts`
    (`COMPACT_RAIL_CARD_HEIGHT = {comfortable:176, dense:96}`, `CompactRailState`, `CompactRailDensity`)
  - CREATE `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-rail-card.component.ts`
  - CREATE `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-rail-card.component.spec.ts`
  - MODIFY `libs/frontend/chat-ui/src/index.ts` (barrel exports)
- Acceptance:
  - Standalone, OnPush, signal inputs/outputs, no import of `@ptah-extension/chat`, `chat-state` or `canvas`.
  - `answer(shownId)` output and an Answer button in both densities; keyed rebuild, roving tabindex, stale-focus rule.
  - Dense `+N` uses `lanes.total`, shown when `total >= 1`, "Lanes none yet" and no button at 0, accessible name
    "Open the N lanes of <title>", emits `moreLanes`.
  - No Retry button; no hover close.
  - Spec covers the plan's numbered cases including (8) 0/1/4 lanes, (9)(10) answer, (11) one height per density.
- Spec files to run:
  - `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-rail-card.component.spec.ts`
- STRICT checks (verbatim; `<project>` = `@ptah-extension/chat-ui`):
  - Test only the changed project. First the changed specs, one at a time:
    `npx nx test <project> --testFile=<spec> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
    (never `--testPathPattern`).
  - Then the project once:
    `npx nx test <project> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`.
  - Then `npx nx typecheck <project> --parallel=1 --skip-nx-cache` and
    `npx nx lint <project> --parallel=1 --skip-nx-cache`.
  - One heavy check at a time. No workspace-wide runs. No `build`, `serve`, `dev`, `e2e` or `package`. No
    `npm install`.
  - Filter output: redirect Jest output to a file, strip `\x1b\[[0-9;]*m`, grep `Tests:|Test Suites:|FAIL `.
  - Lanes never commit (the orchestrator commits after verifying).
  - Backend Jest that loads better-sqlite3 fails until the user rebuilds it; frontend Jest is fine.
- Status: COMPLETE. Verified on disk by team-leader; re-run checks: rail-card spec 15/15, chat-ui project
  71 suites / 1130 tests, typecheck pass, lint 0 errors / 7 warnings (none in R1 files). State colours all use
  `var(--state-ink-<x>, oklch(var(--<daisy>)))` (DaisyUI 4.12, plan :975). No chat/chat-state/canvas import, no
  timers, no Retry, no hover close. Carried to R2: making `requestId` required leaves
  `@ptah-extension/chat` `compact-session-card.component.ts:164-165` failing typecheck until R2 adds the ids; and
  `compact-session-activity.component.spec.ts:1339,1375` (chat-ui spec fixtures, outside the typecheck target)
  lack `requestId` (Minor, recorded). Minor for the phase review: comfortable lane-row buttons are 18 px with no
  24 px `::after` hit area; the error-callout button's name "Show output of <title>" does not start with the
  visible word "Output".

## Batch R2: Smart card rail variant, request identity, carried #1/#2 (chat) — COMPLETE (commit f0462a870)

- Goal: one data source for tile and rail cards; ended lanes newest first (#1); full-field lane summary equality (#2);
  request ids for every callout, error id from `terminalFailureSeq`; `answerQuestion(shownId)` (plan Component 7,
  `:362-466`; Rev 1 findings 1, 2, 3).
- Project: `@ptah-extension/chat`.
- Depends on: R0, R1.
- Executor: `frontend-developer` on a codex CLI lane. Tool-call ceiling: 60.
- Files:
  - MODIFY `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-lane-rows.ts`
  - MODIFY `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-lane-rows.spec.ts`
  - MODIFY `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts`
  - MODIFY `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.spec.ts`
- Acceptance:
  - A1 recorded in the report (tone lines re-read; see Plan validation).
  - Tile branch byte-identical to today (`:85-108`); tile `(answer)="openFullView()"` unchanged; `SessionCardActions`
    unchanged.
  - Error `requestId = 'err:' + tabId + ':' + (tab.terminalFailureSeq ?? 0)`; `canRetry` stays false.
  - CLI Allow re-checks `agentsOwnedBySession` + `permissionQueue`; stale → `staleAction`, nothing posted.
  - `sameLaneSummary` compares `id, name, kind, status, startedAt, endedAt`, `moreCount`, `total`, every `counts` key.
  - Spec cases (1), (1b), (2)-(8) from the plan; existing tests unedited.
- Spec files to run:
  - `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-lane-rows.spec.ts`
  - `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.spec.ts`
- STRICT checks (verbatim; `<project>` = `@ptah-extension/chat`):
  - Test only the changed project. First the changed specs, one at a time:
    `npx nx test <project> --testFile=<spec> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
    (never `--testPathPattern`).
  - Then the project once:
    `npx nx test <project> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`.
  - Then `npx nx typecheck <project> --parallel=1 --skip-nx-cache` and
    `npx nx lint <project> --parallel=1 --skip-nx-cache`.
  - One heavy check at a time. No workspace-wide runs. No `build`, `serve`, `dev`, `e2e` or `package`. No
    `npm install`.
  - Filter output: redirect Jest output to a file, strip `\x1b\[[0-9;]*m`, grep `Tests:|Test Suites:|FAIL `.
  - Lanes never commit (the orchestrator commits after verifying).
  - Backend Jest that loads better-sqlite3 fails until the user rebuilds it; frontend Jest is fine.
- Status: COMPLETE. Verified on disk by team-leader: only the 4 listed files changed; tile branch byte-identical
  to the old `:85-108` (now `:129-152`); no removed spec lines; plan cases (1)-(8) present. A1 recorded in
  lane-R2-report.md. Re-run checks: lane-rows spec 6/6, card spec 43/43, chat project 200 suites / 3637 passed
  (2 skipped), typecheck pass (R1 carry-over closed), lint 0 errors / 37 warnings (none in R2 files). Minor for
  the phase review: `respond` now refuses any callout that is no longer `callout()` for the tile too (stricter
  than the plan's "session: unchanged"; consistent with R2-1, posts nothing stale).

## Batch R3: Board state model, v3 record, store board state (canvas) — COMPLETE (commit deab106e1)

- Goal: per-workspace `CanvasBoardState` persisted in a v3 record; v1/v2 still read; store setters that never touch
  tile intent (plan Components 1-2, `:128-229`; D16, D17).
- Project: `@ptah-extension/canvas`.
- Depends on: none.
- Executor: `frontend-developer` on a codex CLI lane. Tool-call ceiling: 60.
- Files:
  - CREATE `libs/frontend/canvas/src/lib/canvas-board-mode.ts`
  - MODIFY `libs/frontend/canvas/src/lib/canvas-layout-persistence.service.ts`
  - MODIFY `libs/frontend/canvas/src/lib/canvas-layout-persistence.service.spec.ts` (D16: only the round-trip and
    future-version assertions gain the new fields)
  - MODIFY `libs/frontend/canvas/src/lib/canvas.store.ts`
  - MODIFY `libs/frontend/canvas/src/lib/canvas.store.spec.ts`
- Acceptance:
  - Persistence cases (1)-(7) and store cases (1)-(5) from the plan.
  - Newer check `typeof version === 'number' && (version > 3 || !Number.isInteger(version))`; `it.each([99, 2.5, 3.5])`
    stays read-only.
  - v2 loads lossless with `needsWrite:false`; upgrade to v3 on first real change (D17).
  - K6: hydration uses `loaded.board ?? existing ?? DEFAULT_BOARD_STATE`; the full canvas project run (including
    `orchestra-canvas.component.spec.ts`, untouched) passes.
  - `canvas/src/index.ts` unchanged.
- Spec files to run:
  - `libs/frontend/canvas/src/lib/canvas-layout-persistence.service.spec.ts`
  - `libs/frontend/canvas/src/lib/canvas.store.spec.ts`
- STRICT checks (verbatim; `<project>` = `@ptah-extension/canvas`):
  - Test only the changed project. First the changed specs, one at a time:
    `npx nx test <project> --testFile=<spec> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
    (never `--testPathPattern`).
  - Then the project once:
    `npx nx test <project> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`.
  - Then `npx nx typecheck <project> --parallel=1 --skip-nx-cache` and
    `npx nx lint <project> --parallel=1 --skip-nx-cache`.
  - One heavy check at a time. No workspace-wide runs. No `build`, `serve`, `dev`, `e2e` or `package`. No
    `npm install`.
  - Filter output: redirect Jest output to a file, strip `\x1b\[[0-9;]*m`, grep `Tests:|Test Suites:|FAIL `.
  - Lanes never commit (the orchestrator commits after verifying).
  - Backend Jest that loads better-sqlite3 fails until the user rebuilds it; frontend Jest is fine.
- Status: COMPLETE. Verified on disk by team-leader: only the 5 listed files changed; `canvas/src/index.ts` and
  `orchestra-canvas.component.spec.ts` untouched; persistence spec edits are the schedule-signature migration,
  the D16 round-trip/future-version fields and plan cases (1)-(7); store cases (1)-(5) present. K6 hydration is
  `loaded.board ?? existing ?? DEFAULT_BOARD_STATE` (`canvas.store.ts:575`). Re-run checks: persistence spec
  22/22, store spec 23/23, canvas project 26 suites / 336 passed, typecheck pass, lint 0 errors / 14 warnings
  (none in R3 files). Minor for the phase review: board state carried from the implicit path to the first real
  workspace is not scheduled for persist at hydration (only tile diffs schedule), so it is written on the next
  board or tile change; `boardFor` is a plain signal read, not a memoized per-path signal (return type matches
  the plan).

## Batch R4a: Per-tab lane selection, lane strip reveal, queue Escape (canvas) — COMPLETE (commit 02fe637d8)

- Goal: `CanvasDetailService` per-tab lane map and mode-aware `open`; lane strip reveals the selected tab on its own
  width change (R2-2); queue Escape closes only the queue (#8) (plan Components 3, 4, 6, `:231-303,344-360`; D6, D18).
- Project: `@ptah-extension/canvas`.
- Depends on: R3.
- Executor: `frontend-developer` on a codex CLI lane. Tool-call ceiling: 60.
- Files:
  - MODIFY `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail.service.ts`
  - MODIFY `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail.service.spec.ts` (new cases (1)-(5); K1
    fixture-only provider edit)
  - MODIFY `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts`
  - MODIFY `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.spec.ts`
  - MODIFY `libs/frontend/canvas/src/lib/canvas-needs-you-queue.component.ts`
  - MODIFY `libs/frontend/canvas/src/lib/canvas-needs-you-queue.component.spec.ts`
  - CONDITIONAL MODIFY `libs/frontend/canvas/src/lib/orchestra-canvas.component.spec.ts` (K2: fixture-only, add
    `boardFor`/`activeBoard` returning `grid` to `canvasStoreMock`; no `it` body changes)
- Acceptance:
  - K2: the service does not subscribe to `onTabClosed` at construction (lazy on first lane-map write, released via
    `DestroyRef`); `orchestra-canvas.component.spec.ts:423,473` still pass unedited.
  - `laneKey` (Grid) = `laneKeyFor(detailTabId() ?? '')`; `close()` keeps the map; `reset` closes ignored.
  - One `ResizeObserver` on the tablist, guarded with `typeof ResizeObserver !== 'undefined'`, disconnected on destroy;
    reveal via `scrollIntoView({block:'nearest', inline:'nearest'})` in `afterNextRender`.
  - Queue Escape: `open.set(false)`, `preventDefault()`, focus returns to the trigger.
  - Existing `it` bodies in all three specs unedited; any fixture edit listed in the report with the reason.
- Spec files to run:
  - `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail.service.spec.ts`
  - `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.spec.ts`
  - `libs/frontend/canvas/src/lib/canvas-needs-you-queue.component.spec.ts`
  - `libs/frontend/canvas/src/lib/orchestra-canvas.component.spec.ts`
- STRICT checks (verbatim; `<project>` = `@ptah-extension/canvas`):
  - Test only the changed project. First the changed specs, one at a time:
    `npx nx test <project> --testFile=<spec> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
    (never `--testPathPattern`).
  - Then the project once:
    `npx nx test <project> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`.
  - Then `npx nx typecheck <project> --parallel=1 --skip-nx-cache` and
    `npx nx lint <project> --parallel=1 --skip-nx-cache`.
  - One heavy check at a time. No workspace-wide runs. No `build`, `serve`, `dev`, `e2e` or `package`. No
    `npm install`.
  - Filter output: redirect Jest output to a file, strip `\x1b\[[0-9;]*m`, grep `Tests:|Test Suites:|FAIL `.
  - Lanes never commit (the orchestrator commits after verifying).
  - Backend Jest that loads better-sqlite3 fails until the user rebuilds it; frontend Jest is fine.
- Status: COMPLETE. Verified on disk by team-leader: only the 7 listed files changed (orchestra spec: 2 fixture
  lines on `canvasStoreMock`); K1/K2 edits fixture-only, no existing `it` body changed; `onTabClosed` subscribed
  lazily on the first lane-map write and released via `DestroyRef`; Escape listener only while open. Re-run checks:
  detail-service 8/8, lane-tabs 5/5, queue 9/9, orchestra 34/34, canvas project 26 suites / 344 tests, typecheck
  pass, lint 0 errors (14 pre-existing warnings).

## Batch R4b: Transcript surface gating, freeze and click helpers (canvas) — COMPLETE (commit 5267965b6)

- Goal: the transcript follows the parent `SURFACE_ACTIVE` (D7); `freezeSessionOverrides` and `isIgnoredCardClick` /
  `isInteractiveTarget` extracted verbatim from the tile (D8) (plan Component 5, `:305-342`).
- Project: `@ptah-extension/canvas`.
- Depends on: R3 (sequencing; no code dependency).
- Executor: `frontend-developer` on a codex CLI lane. Tool-call ceiling: 40.
- Files:
  - MODIFY `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.ts`
  - MODIFY `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.spec.ts` (new cases
    (1)-(3); K5 fixture-only providers if needed)
  - CREATE `libs/frontend/canvas/src/lib/canvas-session-overrides.ts`
  - CREATE `libs/frontend/canvas/src/lib/canvas-card-click.ts`
  - MODIFY `libs/frontend/canvas/src/lib/canvas-tile.component.ts` (call both helpers; behaviour-preserving)
- Acceptance:
  - Registration only while `active()` and the tab is absent; releases only what it registered; one
    `childInjector.destroy()` per instance.
  - Helpers are the tile code moved verbatim (`canvas-tile.component.ts:536-562,692-703,720-727`); no copy left in the
    tile.
  - `canvas-tile.component.spec.ts` passes **unedited** (proves the extraction).
- Spec files to run:
  - `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.spec.ts`
  - `libs/frontend/canvas/src/lib/canvas-tile.component.spec.ts`
- STRICT checks (verbatim; `<project>` = `@ptah-extension/canvas`):
  - Test only the changed project. First the changed specs, one at a time:
    `npx nx test <project> --testFile=<spec> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
    (never `--testPathPattern`).
  - Then the project once:
    `npx nx test <project> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`.
  - Then `npx nx typecheck <project> --parallel=1 --skip-nx-cache` and
    `npx nx lint <project> --parallel=1 --skip-nx-cache`.
  - One heavy check at a time. No workspace-wide runs. No `build`, `serve`, `dev`, `e2e` or `package`. No
    `npm install`.
  - Filter output: redirect Jest output to a file, strip `\x1b\[[0-9;]*m`, grep `Tests:|Test Suites:|FAIL `.
  - Lanes never commit (the orchestrator commits after verifying).
  - Backend Jest that loads better-sqlite3 fails until the user rebuilds it; frontend Jest is fine.
- Status: COMPLETE. Verified on disk by team-leader: only the 5 listed files changed; tile spec unedited;
  helpers match HEAD tile `:536-562,692-703,720-727` with only `this.*` -> injected locals / `host` param, no copy
  left in the tile; registration gated on `active()` and tab absence, releases only what it registered; one
  `childInjector.destroy()`. K5: original transcript spec passed with no provider change; transcript spec
  additions only (3 new cases). Re-run checks: transcript 5/5, tile 51/51, canvas project 26 suites / 347
  tests, typecheck pass, lint 0 errors (13 warnings).

## Batch R5: Rail column, rail card wrapper, focus header, rail keyboard (canvas) — COMPLETE (commit: the `batch R5` commit; SHA recorded at R6 acceptance)

- Goal: the rail of cards, the per-card canvas wrapper (actions through `detail.open`, stale announcement, `lanesRequested`),
  the dumb focus header with the overflow menu (Send to messaging), and the pure rail keyboard (plan Components 9,
  10, 11, 14, `:621-734,878-900`).
- Project: `@ptah-extension/canvas`.
- Depends on: R2, R3.
- Executor: `frontend-developer` on a codex CLI lane. Tool-call ceiling: 60.
- Files (all CREATE, under `libs/frontend/canvas/src/lib/canvas-rail/`):
  - `canvas-rail-keyboard.ts`, `canvas-rail-keyboard.spec.ts`
  - `canvas-rail.component.ts`, `canvas-rail.component.spec.ts`
  - `canvas-rail-card.component.ts`, `canvas-rail-card.component.spec.ts`
  - `canvas-focus-header.component.ts`, `canvas-focus-header.component.spec.ts`
- Acceptance:
  - **A2 proved** by `canvas-rail-card.component.spec.ts` case (4); if it fails, use the fallback in Plan validation
    and report it.
  - Wrapper spec (5) replacement/stale id refused and announced, keyboard Enter; (6) `+N` → lanes; (7) height per
    density from `COMPACT_RAIL_CARD_HEIGHT`.
  - Tile-bound reason text "The board holds 20 sessions. Close one to add another."; cap uses `RUNNING_CAP_MESSAGE`
    (D11).
  - Overflow menu Esc returns focus to its own button and consumes the key (D18).
  - Nothing new exported from `canvas/src/index.ts`; state inks via `var(--state-ink-x, <fallback>)`.
- Spec files to run:
  - `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-keyboard.spec.ts`
  - `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.spec.ts`
  - `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.spec.ts`
  - `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.spec.ts`
- STRICT checks (verbatim; `<project>` = `@ptah-extension/canvas`):
  - Test only the changed project. First the changed specs, one at a time:
    `npx nx test <project> --testFile=<spec> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
    (never `--testPathPattern`).
  - Then the project once:
    `npx nx test <project> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`.
  - Then `npx nx typecheck <project> --parallel=1 --skip-nx-cache` and
    `npx nx lint <project> --parallel=1 --skip-nx-cache`.
  - One heavy check at a time. No workspace-wide runs. No `build`, `serve`, `dev`, `e2e` or `package`. No
    `npm install`.
  - Filter output: redirect Jest output to a file, strip `\x1b\[[0-9;]*m`, grep `Tests:|Test Suites:|FAIL `.
  - Lanes never commit (the orchestrator commits after verifying).
  - Backend Jest that loads better-sqlite3 fails until the user rebuilds it; frontend Jest is fine.
- Status: COMPLETE. Verified on disk by team-leader: only the 8 listed files created under
  `canvas-rail/`, no other source change, `canvas/src/index.ts` unchanged; no TODO/stub markers. A2 proved by
  rail-card spec case (4): the child injects `SESSION_CARD_ACTIONS` exactly as the real smart card does
  (`compact-session-card.component.ts:166`) and receives the wrapper instance; the lane click reaches
  `detail.open('a', 'orchestrator')`; fallback not needed. D11: tile-bound text and `RUNNING_CAP_MESSAGE`
  asserted in the rail spec, button stays focusable with `aria-disabled`. D18: menu Esc consumed
  (`preventDefault` + `stopPropagation`), focus back on the `…` trigger, asserted in the header spec. K10: all 15
  `--state-ink-*` uses carry a daisy fallback; no bare form. Case (5) judgement: accepted. The wrapper spec
  stubs the child and proves forwarding of `staleAction`, the live-region announcement and host Enter; the
  replaced-id refusal is smart-card logic (R2) and is pinned in `compact-session-card.component.spec.ts:273-331`.
  The end-to-end Answer path through the real card is left to R6/R7 integration and the phase review. Re-run
  checks: keyboard 6/6, rail 4/4, rail card 4/4, focus header 4/4; canvas project 30 suites / 365 tests;
  typecheck pass; lint 0 errors (20 warnings, 7 new in R5 specs).

## Batch R6: Focus area, Rail board, rail geometry, render metrics (canvas) — PENDING

- Goal: one keyed live view per board, the smart Rail board per retained workspace (collapse, density, scroll anchor,
  live region, D4 hidden-mounts-nothing, D19 bands), the pure geometry guard and the new metrics (plan Components 12,
  13, 16, `:735-877,954-962`; Rev 1 findings 4, 5).
- Project: `@ptah-extension/canvas`.
- Depends on: R4a, R4b, R5.
- Executor: `frontend-developer` on a codex CLI lane. Tool-call ceiling: 60 (largest batch, K8).
- Files:
  - CREATE `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.ts`
  - CREATE `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.spec.ts`
  - CREATE `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts`
  - CREATE `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts`
  - CREATE `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-geometry.ts`
  - CREATE `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-geometry.spec.ts`
  - MODIFY `libs/frontend/canvas/src/lib/canvas-render-metrics.service.ts` (`focusSwaps`, `liveViewMounts`,
    `railShifts`)
  - MODIFY `libs/frontend/canvas/src/lib/canvas-render-metrics.service.spec.ts`
- Acceptance:
  - Exactly one `ptah-canvas-lane-view` per visible Rail board, remounted by `track` focused id; a hidden board mounts
    no cards and no focus area.
  - Geometry baseline reset only on density toggle, collapse toggle, user add/close; never on focus, width or
    details; `data-canvas-rail-shifts` exposed.
  - Auto-collapse below 1120 is not persisted; Rail footer New session uses `defaultSessionName()` and focuses (D9).
  - Board spec cases including (10)-(13); metrics spec existing tests unedited plus saturation case.
- Spec files to run:
  - `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-geometry.spec.ts`
  - `libs/frontend/canvas/src/lib/canvas-render-metrics.service.spec.ts`
  - `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.spec.ts`
  - `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts`
- STRICT checks (verbatim; `<project>` = `@ptah-extension/canvas`):
  - Test only the changed project. First the changed specs, one at a time:
    `npx nx test <project> --testFile=<spec> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
    (never `--testPathPattern`).
  - Then the project once:
    `npx nx test <project> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`.
  - Then `npx nx typecheck <project> --parallel=1 --skip-nx-cache` and
    `npx nx lint <project> --parallel=1 --skip-nx-cache`.
  - One heavy check at a time. No workspace-wide runs. No `build`, `serve`, `dev`, `e2e` or `package`. No
    `npm install`.
  - Filter output: redirect Jest output to a file, strip `\x1b\[[0-9;]*m`, grep `Tests:|Test Suites:|FAIL `.
  - Lanes never commit (the orchestrator commits after verifying).
  - Backend Jest that loads better-sqlite3 fails until the user rebuilds it; frontend Jest is fine.
- Status: PENDING

## Batch R7: Board toggle and OrchestraCanvas integration (canvas) — PENDING

- Goal: per-path `@if` Rail/Grid mount, the Board toggle in the dock, Grid-only layout controls and empty overlay,
  `detailTabId` gate, mode-routed keys, dock notes (plan Component 15, `:901-952`; D1).
- Project: `@ptah-extension/canvas`.
- Depends on: R6.
- Executor: `frontend-developer` on a codex CLI lane. Tool-call ceiling: 60.
- Files:
  - CREATE `libs/frontend/canvas/src/lib/canvas-board-toggle.component.ts`
  - CREATE `libs/frontend/canvas/src/lib/canvas-board-toggle.component.spec.ts`
  - CREATE `libs/frontend/canvas/src/lib/orchestra-canvas.rail.spec.ts`
  - MODIFY `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts`
  - MODIFY `libs/frontend/canvas/src/lib/orchestra-canvas.component.spec.ts` (A3/K3: fixture-only; seed `grid` board
    in the store mock and persistence stubs, add `writeFailed`/`readOnlyPaths`/`readOnlyReason`; no `it` body
    changes)
- Acceptance:
  - **A3 handled** as above and recorded; **A4 proved** by the rail-spec draft case (type a draft, switch mode, the
    draft is restored).
  - K4: `orchestra-canvas.detail.spec.ts` passes **unedited** (Grid branch needs no new member; Rail branch is a no-op
    when no active Rail board is present).
  - Rail spec cases (1)-(8) from the plan, plus the A4 draft case.
  - Toggle before layout controls and queue, `aria-pressed`; a switch never stops, closes or reloads a session.
  - `canvas/src/index.ts` exports nothing new; no new chat-ui import of `chat`, `chat-state`, `canvas`.
- Spec files to run:
  - `libs/frontend/canvas/src/lib/canvas-board-toggle.component.spec.ts`
  - `libs/frontend/canvas/src/lib/orchestra-canvas.rail.spec.ts`
  - `libs/frontend/canvas/src/lib/orchestra-canvas.component.spec.ts`
  - `libs/frontend/canvas/src/lib/orchestra-canvas.detail.spec.ts`
- STRICT checks (verbatim; `<project>` = `@ptah-extension/canvas`):
  - Test only the changed project. First the changed specs, one at a time:
    `npx nx test <project> --testFile=<spec> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
    (never `--testPathPattern`).
  - Then the project once:
    `npx nx test <project> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`.
  - Then `npx nx typecheck <project> --parallel=1 --skip-nx-cache` and
    `npx nx lint <project> --parallel=1 --skip-nx-cache`.
  - One heavy check at a time. No workspace-wide runs. No `build`, `serve`, `dev`, `e2e` or `package`. No
    `npm install`.
  - Filter output: redirect Jest output to a file, strip `\x1b\[[0-9;]*m`, grep `Tests:|Test Suites:|FAIL `.
  - Lanes never commit (the orchestrator commits after verifying).
  - Backend Jest that loads better-sqlite3 fails until the user rebuilds it; frontend Jest is fine.
- Status: PENDING

## Batch R8: State-ink tokens and contrast spec (webview) — PENDING

- Goal: `--state-ink-run|need|err|done|idle` per anubis theme with `state-*` colours and a 3:1 contrast spec (plan
  Component 17, `:964-984`; D13, D14 dark error `#ef4444`).
- Project: `ptah-extension-webview`. Test and lint only (not typechecked by rule, decisions row 35).
- Depends on: none.
- Executor: `frontend-developer` on a codex CLI lane. Tool-call ceiling: 40.
- Files:
  - MODIFY `apps/ptah-extension-webview/tailwind.config.js` (variables next to `--bcm` at `:105` dark and `:174` light;
    colours beside `base-content-muted` at `:31`, fallback form `var(--state-ink-run, oklch(var(--in)))`)
  - CREATE `apps/ptah-extension-webview/src/app/state-ink-contrast.spec.ts` (pattern `base-content-muted.spec.ts:1-40`,
    `culori/require`)
- Acceptance: every state ink ≥ 3:1 against `base-100/200/300` in both anubis themes; light values
  `#2a56c6 #8f5200 #b4232a #13713a` idle `#6b6570`; dark run `#3b82f6`, need `#f97316`, err `#ef4444`, done
  `#16a34a`, idle `#6b7280`; `base-content-muted.spec.ts` still passes unedited.
- Spec files to run:
  - `apps/ptah-extension-webview/src/app/state-ink-contrast.spec.ts`
  - `apps/ptah-extension-webview/src/app/base-content-muted.spec.ts`
- STRICT checks (verbatim; `<project>` = `ptah-extension-webview`; skip the typecheck line for this project only, per
  decisions row 35):
  - Test only the changed project. First the changed specs, one at a time:
    `npx nx test <project> --testFile=<spec> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
    (never `--testPathPattern`).
  - Then the project once:
    `npx nx test <project> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`.
  - Then `npx nx typecheck <project> --parallel=1 --skip-nx-cache` and
    `npx nx lint <project> --parallel=1 --skip-nx-cache`.
  - One heavy check at a time. No workspace-wide runs. No `build`, `serve`, `dev`, `e2e` or `package`. No
    `npm install`.
  - Filter output: redirect Jest output to a file, strip `\x1b\[[0-9;]*m`, grep `Tests:|Test Suites:|FAIL `.
  - Lanes never commit (the orchestrator commits after verifying).
  - Backend Jest that loads better-sqlite3 fails until the user rebuilds it; frontend Jest is fine.
- Status: PENDING

## Recorded defaults

- Order chosen: the plan's batch order R0, R1, R2, R3, R4a, R4b, R5, R6, R7, R8, run strictly sequentially (one
  lane, one heavy check at a time). R8 is independent and may be pulled forward only if the orchestrator says so.
- Statuses are left PENDING as requested; the orchestrator's first spawn moves R0 to IN_PROGRESS through the
  team-leader.
