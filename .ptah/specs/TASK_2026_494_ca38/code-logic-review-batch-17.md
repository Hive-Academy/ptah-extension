# Code Logic Review — Batch 17 (Round 1)

**Task:** TASK_2026_494 — Electron shell Apps tab (Task 17.1)
**Scope:** `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts` (modified),
`electron-shell.config-gate.spec.ts` (approved edit), `electron-shell.apps-tab.spec.ts` (new).

## Score: 9/10

## Verdict: APPROVED

0 blocking, 0 serious, 1 moderate (inherited, not introduced by this batch), 0 minor logic findings.

## Check table

| # | Check | Result | Evidence |
| - | ----- | ------ | -------- |
| 1 | Only the slot comment replaced; button sits inside `@if (layout.hasWorkspaceFolders())`, between Chat and Tasks; nothing else moved | PASS | `electron-shell.component.ts:124` opens the `@if`; Chat button `:126-136`; new Apps button `:137-147`; Tasks button (unchanged) now `:148-158`. `git diff` shows exactly 4 hunks: icon import (`:39`), the Apps `<button>` block, the `AppWindowIcon` field (`:394`), and `openApps()` (`:415-417`). No other line in the 419-line file changed. |
| 2 | Mirrors sibling tabs attribute-for-attribute; `openApps()` → `setCurrentView('apps')`; reaches the lazy Apps route on Electron | PASS | Attributes identical to Tasks (`role="tab"`, `class="tab gap-1.5 no-drag"`, `[class.tab-active]`, `[attr.aria-selected]`, `title`, icon size). `openApps()` (`:415-417`) calls `this.appState.setCurrentView('apps')`. Traced `setCurrentView` → `app-state.service.ts:902-906` → `requestSurface('apps')` (`:513-521`) → `surfaceRouter.navigateToSurface('apps')`, the same path Batch 16 verified reaches `canMatch: [electronOnlySurface]` and the lazy `loadComponent` on Electron (`isElectron: true`). B17 adds no new navigation logic; it only invokes the already-verified path. |
| 3 | New spec pins are non-vacuous | PASS | `electron-shell.apps-tab.spec.ts` re-run directly (`npx jest -c libs/frontend/chat/jest.config.ts .../templates/electron-shell`): 4 suites, 24/24 pass. Each of the 5 new tests asserts a real outcome, not a tautology: order (`:134-139`), attribute/class parity against the live Tasks button plus a negative `text-base-content/` regex (`:141-154`), full-teardown/rebuild of the tab row on `hasWorkspaceFolders` toggling (`:156-165`), `setCurrentView` called exactly once with `'apps'` and `setLayoutMode` NOT called (`:167-172`), and both `'apps'`/`'tasks'` branches of the `aria-selected`/`tab-active` binding (`:174-197`). |
| 4 | Config-gate edit exactly as approved, not weaker, other tests untouched | PASS | `git diff` on `electron-shell.config-gate.spec.ts` touches only the one test block at `:197-229`: `'Apps'` inserted second in both title/text arrays, a fifth `'false'` added to the aria-selected array, `toHaveLength(4)` → `toHaveLength(5)`, test title updated. This is byte-for-byte the coordinator-approved edit in `batches.md:1071-1080`. No assertion was removed or loosened — the array now has one more entry, all previously-asserted entries are still asserted at the same positions. The other 13 tests in the file are unchanged (confirmed by diff scope) and the full suite run is 24/24 green. |
| 5 | No `text-base-content/NN` alpha classes | PASS | The Apps button's only classes are `tab gap-1.5 no-drag` (`electron-shell.component.ts:139`); no alpha-opacity utility added anywhere in the diff. Spec asserts this negatively (`apps-tab.spec.ts:147`). |
| 6 | Five standard logic questions | See below | |

## Five logic questions

### 1. How does this fail silently?

Nothing new. `openApps()` is a one-line delegation with no error path of its own — the same shape as `openTasks()`, `openDashboard()`, `openTribunal()`. The only silent-no-op path is inherited, pre-existing `AppStateManager` behaviour: `setCurrentView` gates on `canSwitchViews()` (`app-state.service.ts:639-641`, `:902-906`), which is `false` while `isLoading()` or not `isConnected()`. A click on Apps during that window does nothing and gives the user no feedback — but this is identical to clicking Chat, Tasks, Tribunal or Analytics in the same window, is not introduced or worsened by this batch, and is out of B17's file scope.

### 2. What user action produces unexpected behaviour?

None found. The button is a native `<button>` (keyboard-reachable, `Enter`/`Space` activate it by default), gated by the same `@if` as its four siblings, so it disappears/reappears with the workspace-folders condition exactly like them (spec `:156-165` exercises the toggle both ways, not just the initial render).

### 3. What input data produces a wrong answer?

N/A for this diff — it carries no data transformation, only a static template binding (`currentView() === 'apps'`) and a fixed-argument call (`setCurrentView('apps')`). There is no parsing, no external input, nothing for malformed data to corrupt.

### 4. What happens when a dependency fails?

`AppStateManager` and `SurfaceRouterService` are injected, not called defensively — same as every other tab in this component. Their failure modes (a `canMatch` refusal, a rejected navigation) were already the subject of Batch 16's review and are unchanged here; B17 does not add a new failure surface. If `AppStateManager.setCurrentView` were ever missing or reassigned, Angular's DI would fail at bootstrap, not silently at click time.

### 5. What is missing that the requirements never mentioned?

Nothing material. The plan (`implementation-plan.md:335-357`) and the batch's spec pins are narrow (order, presence, click delegation, `aria-selected`) and all are met. One thing worth naming for the visual gate, not logic: the icon field `AppWindowIcon` was appended after `ClipboardListIcon` (`:394`), i.e. after all four pre-existing icon fields rather than positioned to mirror the tab's visual order (Chat, Apps, Tasks, ...). This has zero behavioural effect — it is a field-declaration order, not a runtime path — so it is a style note, not a logic finding, and is left for code-style-reviewer.

## Findings

No blocking or serious findings. One moderate item, explicitly inherited rather than introduced:

### 1. (Moderate, inherited — not a B17 defect) Tab click silently no-ops while `canSwitchViews()` is false

- Trigger: user clicks the Apps tab while `AppStateManager` is loading or disconnected.
- Symptom: no navigation, no visual feedback, no error.
- Evidence: `app-state.service.ts:639-641` (`canSwitchViews`), `:902-906` (`setCurrentView`); `electron-shell.component.ts:143` (`(click)="openApps()"`).
- Current handling: same as Chat/Tasks/Tribunal/Analytics — the click is dropped.
- Recommendation: none required of this batch. If the product wants feedback here, it is a cross-cutting `AppStateManager`/tab-row change, not something `openApps()` alone should own. Not a fix item for B17.

## Exact fix list

None. No blocking or serious defect was found in the diff under review.

## Carry-overs for the visual review (R10, dark + light, against `prototype/`)

Carried from `batch-17-report.md`'s own notes, confirmed still applicable after reading the live template:

1. The Apps tab uses `tabs-lifted` styling (`electron-shell.component.ts:125`, unchanged from the sibling tabs), which the prototype intentionally does not replicate (CDN-fidelity workaround, `prototype/README.md` "Deviations" and "Lane-introduced constraints"). Confirm the real lifted-tab treatment reads correctly with 5 tabs in both themes.
2. Icon fidelity: lucide `AppWindow` (a window-frame glyph) vs. the prototype's hand-drawn top-bar-and-two-panels SVG (visually closer to lucide `LayoutPanelTop`). Confirm `AppWindow` reads clearly at `w-3.5 h-3.5` (14px) in both `anubis` and `anubis-light`.
3. Tab row width at narrow Electron window sizes now that there are five tabs between two `flex-1` spacers (`:121`, `:185`) — confirm no wrapping/overflow.
4. Keyboard access: native `<button>`, DOM order between Chat and Tasks — confirm `Tab` reaches it in that order and `Enter`/`Space` activates it in the running app, not just in jsdom.

## Verification performed

- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/templates/electron-shell --maxWorkers=2` → 4 suites, 24/24 pass (re-run independently, matches `batch-17-report.md`'s claim).
- `ptah_get_diagnostics` scoped to `electron-shell.component.ts` and `electron-shell.apps-tab.spec.ts` → 0 diagnostics in either file (the tool returns the project's full 249-error spec-tsc baseline for unrelated files; grepping the saved output for `electron-shell` returns no matches, confirming 0 errors in this batch's files).
- Full `git diff` read for both modified files (component and config-gate spec); confirmed scope matches the coordinator's ruling exactly.
- Read `implementation-plan.md:335-357` (Component 2 contract), `batches.md` Batch 16 and Batch 17 sections in full (including the D-2 dependency, the R1/R7 rulings, and the "late host config... NOT a B17 risk" note), `batch-17-report.md`, `prototype/README.md`.
- Traced `openApps()` → `AppStateManager.setCurrentView` → `requestSurface` → `SurfaceRouterService.navigateToSurface('apps')`, confirming this reuses the route/guard path Batch 16 already reviewed rather than adding a new one.

## One-line summary

A minimal, attribute-exact copy of the sibling-tab pattern with non-vacuous new specs and an approved, non-weakening config-gate edit; no blocking or serious logic defects found — APPROVED 9/10.
