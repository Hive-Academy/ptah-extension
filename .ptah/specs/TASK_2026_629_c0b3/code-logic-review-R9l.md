# Code Logic Review — R9l (`TASK_2026_629_c0b3`)

Reviewer: Claude (code-logic-reviewer). Implementer: codex lane. Change reviewed: uncommitted diff of 8 files in the worktree (`git diff`, read in full), plus the current Rail templates and the three e2e specs read in full.

## Summary

| Metric              | Value                                              |
| ------------------- | -------------------------------------------------- |
| Overall score       | 6/10                                               |
| Assessment          | APPROVE-WITH-FIXES                                 |
| Blocking issues     | 0                                                  |
| Serious issues      | 1 (e2e: nonexistent "Create new session" button, 3 cases) |
| Moderate issues     | 4                                                  |
| Failure modes found | 5                                                  |

The library side (mode narrowing, persistence, detail service, mock cleanup) is correct and minimal. The score is held at 6 because the rewritten `canvas.spec.ts` drives a control that no current template renders, so 3 of its 5 cases cannot get past their first click. The lane report's "template evidence" list omits that control, and the lane did not (and was told not to) run e2e, so nothing would have caught it before a later e2e run.

I ran one scoped spec: `canvas-detail.service.spec.ts` via the lock (`rv-r9l-1`): 1 suite, 6 tests passed. I did not run e2e, typecheck or lint.

## Five logic questions

### 1. How does this fail silently?

- `canvas.spec.ts:26,43,74` click `getByRole('button', { name: 'Create new session' })`. No non-spec file under `libs` or `apps` renders a button with that name (`rg "Create new session" libs apps -g '!*.spec.ts'` only hits e2e support and showcase files). The only producer was `canvas-empty-state.component.ts`, deleted in `1fd6e99cb` (R9p). The rewrite copied the stale locator from HEAD's spec (HEAD `canvas.spec.ts:130,169,258`). Result: when e2e runs, three cases time out at the click. Mode 2 for R9l has no e2e run, so it passes unnoticed.
- `CanvasDetailService` keeps `detailTabId`, `laneKey`, `selectLane` and `close` (`canvas-detail.service.ts:15-16,50-57`) although `open()` now always writes `null` (`:47`). `detailTabId` can therefore never be non-null, `laneKey` is always `'orchestrator'`, `selectLane` is a no-op, `close` is a no-op. No production file reads them (`rg` for `detailTabId|\.selectLane\(|detail\.close|detail\.laneKey\(\)` finds only the service, its spec and a mock in `canvas-needs-you-queue.component.spec.ts:114-127`). This is inert dead state, not a silent wrong answer, but it reads as live API.

### 2. What user action produces unexpected behaviour?

None in production. `open()` previously left `_detailTabId` untouched in Rail mode; it now sets `null`. Since Rail never set it, the observable behaviour is the same. A stored v3 record with `mode: 'grid'` loads as Rail (`canvas-layout-persistence.service.ts:47`, `.catch('rail').transform(() => 'rail')`) and the persistence spec asserts tiles and Rail options are unchanged and the raw string is not rewritten on load (`canvas-layout-persistence.service.spec.ts:49-70`).

### 3. What input data produces a wrong answer?

- Raw `'grid'`, `'unknown'`, missing mode: all normalised to `'rail'` by the zod `.catch` + `.transform` (`canvas-layout-persistence.service.ts:47`), covered by the spec at `:201-202`.
- Write path forces `mode: 'rail'` (`canvas-layout-persistence.service.ts:322`), so a runtime snapshot cannot persist `'grid'` even if cast. The deleted case ("writes Rail mode even when the snapshot still has Grid mode") only existed to exercise that, and is now unrepresentable under the narrowed type. The `:322` override is now redundant but harmless.
- `[data-testid="canvas-rail-empty-board"]` is a `flex-1` section that sits between the 304 px Rail and a 296-360 px details aside (`canvas-rail-board.component.ts:53-76,77-111,153-164`). For the hunk-revert overlap assertion its box is narrower than the old full-width empty-state panel. See failure mode "Hunk-revert probe narrower than the old one".

### 4. What happens when a dependency fails?

No runtime dependency changed. The detail service still depends on `CanvasStore.tiles`/`focusTile` and `TabManagerService.onTabClosed`; the lane map prune on close and the `reset` exception are intact (`canvas-detail.service.ts:25-38`; spec `:67-74`). The spec's `CanvasStore` mock shrank to `{ tiles, focusTile }` (`canvas-detail.service.spec.ts:28`), which matches the only two members `open`/`selectLaneFor` now call (`canvas-detail.service.ts:26,43,46`). Not vacuous.

### 5. What is missing that the requirements never mentioned?

- Other e2e specs still use the deleted `[data-testid="canvas-tile"]` (see Moderate 1). Decision 90b scoped that to showcase, but real specs are affected.
- Rail has no e2e for the focus-header view-mode toggle (`canvas-focus-area.component.ts:46`, `toggleTabViewMode`), the one surviving capability behind the removed "compact tile" scenarios. It is not a regression of a Rail capability that had Rail e2e, so it is only a note.

## Failure modes

### Nonexistent "Create new session" button

- Trigger: `canvas.spec.ts` cases "adds and focuses a Rail session", "retains the Rail board and card across a settings round-trip", "restores the Rail card across a workspace round-trip".
- Symptom: Playwright waits for a button that is never rendered, then times out. Three of five cases fail before reaching any Rail assertion.
- Evidence: `canvas.spec.ts:26,43,74`; deleted in `1fd6e99cb`; current controls: dock button `orchestra-canvas.component.ts:161-182` (`data-testid="canvas-new-session-anchor"`, `aria-label="Add new session tile"`, `title="Add new session tile"`), empty-board button `canvas-rail-board.component.ts:92-102` (name "New session"), Rail footer `canvas-rail.component.ts:187`. The shared helper already encodes the working path: `ui-driver.ts:451-458` clicks `[title="Add new session tile"]` first.
- Current handling: none.
- Recommendation: use `page.locator('[data-testid="canvas-new-session-anchor"]')` (unique; a name match on "New session" would hit three buttons and trip Playwright strict mode). The follow-up `getByRole('button', { name: 'Create', exact: true })` matches the popover's Create button (`orchestra-canvas.component.ts:214-221`) and is correct.

### Hunk-revert probe narrower than the old one

- Trigger: the git view shows a centred modal; the old probe was the full-width `ptah-canvas-empty-state`; the new probe is the empty-board section only.
- Symptom: `overlaps(canvasBox, boxBox)` could be false in a narrow canvas pane (section x-range excludes about 600 px of Rail plus details aside), failing with "not exercising the collision" even though the stacking fix is fine. Cannot be proven either way without a run.
- Evidence: `hunk-revert-top-layer.spec.ts:193-196` (new), `canvas-rail-board.component.ts:53-76,153-164`.
- Current handling: locator is real, painted, non-null box (meets decision 90a's wording). The heading `No sessions on this board` is real (`:83-88`) and unique because hidden boards render nothing (`@if (visible())`, `:51`).
- Recommendation: acceptable as written; if it flakes, probe `ptah-canvas-rail-board:visible` (host is `block h-full`, fills the whole board) instead.

### Workspace round-trip no longer asserts DOM retention

- Trigger: old case "keeps a tile mounted (no remount) across a workspace round-trip" asserted the same DOM node survived; new case asserts only `toHaveCount(1)` after return (`canvas.spec.ts:59-82`).
- Symptom: a regression that tears down session state on workspace switch would not be caught by e2e.
- Evidence: Rail board content is under `@if (visible())` (`canvas-rail-board.component.ts:51`), so cards are rebuilt on every show; the lane report's reasoning that Rail does not promise card DOM identity is correct. Chat-state retention is R9f's job and has its own specs.
- Recommendation: accept; record in the PR body as a dropped e2e guarantee (see Proposed Removals).

### Dead detail state

- Trigger: any future reader/writer of `detailTabId`/`laneKey`/`selectLane`/`close`.
- Symptom: misleading API; `close()` and `selectLane()` do nothing.
- Evidence: `canvas-detail.service.ts:15-16,47,50-57`; `canvas-needs-you-queue.component.spec.ts:114-127` mocks `detailTabId` and asserts `detailTabId()` stays `'a'`, a state the real service can no longer produce.
- Recommendation: either remove these members and the queue spec's mock assertion, or name a caller. Decision 90c only mandates `toggle/next/prev`, which were removed correctly, so this is not a contract breach.

### Stale `canvas-tile` locators outside R9l's file list

- Trigger: e2e runs of `specs/git/change-set-card.spec.ts:138`, `specs/chat/tile-load-older-history.spec.ts:43`, `specs/chat/tile-open-longtask-budget.perf.spec.ts:367`, `specs/chat/compaction-duplicate-session.spec.ts:152,302,306`, plus `support/perf-session-fixture.ts:466`, `support/perf-page-capture.ts:230+`, and showcase scenes.
- Symptom: those cases cannot find any tile (`canvas-tile` testid is not rendered; `rg` finds only comments).
- Current handling: decision 90b records showcase only; these are real specs.
- Recommendation: add to the PR body / R11 sweep list; not an R9l defect.

## Blocking issues

None.

## Serious issues

### S1. `canvas.spec.ts` drives a deleted control (3 of 5 cases)

- File: `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:26,43,74`
- Scenario: any e2e run of the canvas spec.
- Impact: the batch's purpose for this file (R9k finding 3: e2e that actually passes against Rail) is not met; the lane report's "existing create-dialog controls from the earlier spec" claim is inaccurate for the first click.
- Fix: replace the three `getByRole('button', { name: 'Create new session' })` clicks with the dock anchor (`[data-testid="canvas-new-session-anchor"]`), as in the failure-mode entry above. Keep the `Create` click.

## Moderate and minor issues

1. Moderate: stale `canvas-tile` locators in four other specs and the perf support files (list above); record for PR body / R11.
2. Moderate: dead detail state `canvas-detail.service.ts:15-16,47,50-57` and the matching mock assertion `canvas-needs-you-queue.component.spec.ts:127`.
3. Moderate: `canvas-detail.service.spec.ts:53-58` ("focuses and selects a lane without opening detail in Rail mode") now duplicates `:35-43`; delete or fold. Also `:64` asserts `laneKey()` is `'orchestrator'` after close, which is trivially true now that `detailTabId` is always null.
4. Moderate: Rail e2e case "adds and focuses" asserts the `Dense cards` button exists (`canvas.spec.ts:33`, `canvas-rail.component.ts:81-91`); it is only rendered when the Rail is not collapsed (`@if (!collapsed())`), so a narrow window would fail it. Prefer asserting the Focused session region only, or assert on the `Sessions` aside (`canvas-rail.component.ts:66`).
5. Minor: `orchestra-canvas.rail.spec.ts:156,290-291` still feeds raw `'grid'` through a mock `boardFor`, a value the real store can no longer return. Not an R9l file; harmless.
6. Minor: stale wording "binds the tile" in `task-337-agent-card-refresh.spec.ts:199`; trailing blank line before the class close in `canvas-detail.service.ts:58-59` (style, route to code-style).

## Data flow

1. Stored v3 JSON (`mode: 'grid'`) -> `boardSchema` zod -> `'rail'` (`canvas-layout-persistence.service.ts:47`). OK; raw string left on disk until the next real write, asserted in spec `:49-70`.
2. `CanvasStore` board state typed `CanvasBoardMode = 'rail'` (`canvas-board-mode.ts:1`). OK; `rg "mode: ?'grid'|=== 'grid'|'rail' \| 'grid'"` across `libs` and `apps` finds no production comparison, only raw JSON in the persistence spec and the untyped mock in `orchestra-canvas.rail.spec.ts`.
3. Rail card click / needs-you open -> `detail.open(tabId, laneKey)` -> `focusTile` + `selectLaneFor` (lane memory) (`canvas-detail.service.ts:43-47`; callers `canvas-rail-card.component.ts:151`, `canvas-needs-you-queue.component.ts:238`). OK.
4. Focus area reads `detail.laneKeyFor(id)` and writes `detail.selectLaneFor` (`canvas-focus-area.component.ts:50-51,57`; lane view `canvas-lane-view.component.ts:370`; transcript `canvas-detail-transcript.component.ts:65-66`). OK, intact.
5. Tab closed -> `onTabClosed` prunes the lane map, ignoring `reset` (`canvas-detail.service.ts:30-37`). OK.
6. e2e entry: `ui.goto('canvas')` -> dock anchor -> popover -> Create -> board card. GAP at the first click (S1).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| `CanvasBoardMode` narrowed to `'rail'` | COMPLETE | none |
| Persistence alone accepts historical `'grid'` | COMPLETE | spec keeps raw `'grid'` JSON, not a typed value (`:51`) |
| No remaining `mode === 'grid'` in libs/apps | COMPLETE | only raw/untyped spec data |
| Rail lane memory (`selectLaneFor`, lane keys, close prune) intact | COMPLETE | none |
| Remove `toggle/next/prev` only if no production caller (90c) | COMPLETE | `rg 'detail\.(toggle\|next\|prev)\('` finds no caller; also no other `.toggle(`/`.next()` hit in canvas libs |
| Stale `CanvasLayoutService` mocks removed, not vacuous (96) | COMPLETE | mocks now `{ observe, containerWidth }` (`orchestra-canvas.component.spec.ts:238-241,725-728`) matching `canvas-layout.service.ts` (`observe`, `containerWidth`); the removed members were not asserted anywhere |
| `canvas.spec.ts` selectors rewritten to real Rail elements | PARTIAL | empty board, rail-board, card, Focused session, Dense cards locators are real (see table below); "Create new session" is not (S1) |
| `task-337` selector | COMPLETE | `ptah-canvas-focus-area section[aria-label="Focused session"]` real (`canvas-focus-area.component.ts:30-32`); tile is created by `ui.goto('chat')` via the FAB (`ui-driver.ts:451-458`) |
| `hunk-revert` probe still runs against a painted element behind the dialog (90a) | COMPLETE with risk | real, painted; narrower than before (failure mode above) |
| No capability removed beyond contract | COMPLETE | Gridstack geometry/lock/preset e2e removal matches parity row 65 "remove-proposed"; Gridstack package untouched; `packaged-deps.spec.ts` untouched |
| No e2e run | COMPLETE | per report |

Implicit requirements not addressed: e2e-reachability of the rewritten cases (S1); other specs' `canvas-tile` locators (out of scope, listed).

### New e2e locator verification

| Locator | Spec:line | Template evidence | Real? |
| --- | --- | --- | --- |
| `ptah-canvas-rail-board:visible` | canvas:9,46 | `canvas-rail-board.component.ts:34` selector; host `display:none` when hidden `:44` | yes |
| `[data-testid="canvas-rail-empty-board"]` | canvas:10,17,79; hunk:19 | `canvas-rail-board.component.ts:80` | yes |
| heading `No sessions on this board` | canvas:19; hunk:16 | `canvas-rail-board.component.ts:83-88` | yes |
| button `New session` inside empty board | canvas:20 | `canvas-rail-board.component.ts:92-102` | yes |
| `ptah-tab-bar` count 0 | canvas:11 | unchanged from HEAD | yes |
| button `Create new session` | canvas:26,43,74 | none | NO |
| button `Create` exact | canvas:27,44,75 | `orchestra-canvas.component.ts:214-221` (popover) | yes |
| `ptah-canvas-rail [data-rail-card]` | canvas:29,76 | `canvas-rail.component.ts:33` selector; `canvas-rail-card.component.ts:43` host attr | yes |
| region `Focused session` | canvas:32 | `canvas-focus-area.component.ts:30-32` (`section` + `aria-label`) | yes |
| button `Dense cards` | canvas:33 | `canvas-rail.component.ts:81-91` (only when not collapsed) | yes, conditional |
| `ptah-canvas-rail-board` count 0 on settings | canvas:53 | retained-row detach (`app-shell.component.html:84`), same mechanism as old `ptah-canvas-workspace-grid` count 0 | yes |
| `ui.goto('dashboard')` | canvas:35 | `ui-driver.ts:6,397` | yes |

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Stored v3 `mode:'grid'` | YES | zod normalises to rail, tiles/options preserved, raw string kept | none |
| Stored `mode` garbage / missing | YES | `.catch('rail')`, spec `:201-202` | none |
| `open()` unknown tab / invalid lane | YES | early returns, spec `:40-42` | none |
| Tab closed (close vs reset) | YES | spec `:67-74` | none |
| Re-selecting the same lane | YES | identity kept, single `onTabClosed` subscription, spec `:76-82` | none |
| Detail overlay open state | N/A | state is dead (`detailTabId` always null) | remove or name caller |
| Rail collapsed in narrow window | NO | `Dense cards` absent | canvas:33 flake risk |
| Hunk dialog overlap with empty-board box | UNPROVEN | needs e2e run | narrower than old probe |

## Verdict

- Recommendation: APPROVE-WITH-FIXES (6/10). Library changes are sound; fix S1 before commit. Moderate items 2-4 may be fixed in the same pass or recorded.
- Confidence: HIGH on the library and template-evidence checks (read in full, one scoped spec run); MEDIUM on e2e behaviour because no e2e could be run.
- Top risk: three of the five rewritten Rail e2e cases cannot pass because the "Create new session" button was deleted in R9p and the rewrite reused its locator.
- What a robust implementation would add: dock-anchor locator in the three cases; drop `Dense cards` assertion or guard it on collapse state; remove or justify the dead `detailTabId`/`laneKey`/`selectLane`/`close` and the matching queue-spec mock; dedupe the two overlapping detail spec cases; list the dropped e2e guarantees in the PR body.

## Proposed Removals (not in the lane report; for the orchestrator to confirm or reject)

1. e2e DOM-identity retention across a workspace round-trip (old `canvas.spec.ts` "keeps a tile mounted (no remount) across a workspace round-trip"). Reason: Rail board content is `@if (visible())` (`canvas-rail-board.component.ts:51`), so no DOM identity is promised; chat-state retention lives in R9f specs.
2. e2e on Gridstack drag, 2+1 row, compact tile reflow, lock, presets, south-edge preview (old `canvas.spec.ts:285-1098`). Reason: controls and geometry deleted in R9t/R9p; matches parity row 65.
3. e2e on render-metric counters `data-canvas-gesture-commits` / `data-canvas-layout-computations` (old settings round-trip case). Reason: gestures and layout computation deleted in R9p.
