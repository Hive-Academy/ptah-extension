# CI fix: e2e specs moved to the Rail board DOM (PR #730)

Paths are relative to the worktree. No e2e was run (forbidden). Each change is proven from the
code and the CI artifacts. Selectors assume the parallel canvas edits: (a) one
`Focused session: <title>` region, kept on the `[data-pane-side]` wrapper, (b) the setup card
back on the empty board, (c) the Rail auto-collapses to 56 px below 640 px.

## Changes

| spec:line | failure | change (old -> new) | evidence |
|---|---|---|---|
| `libs/frontend/webview-e2e-harness/src/lib/scenarios/plan-limits/plan-limits-visual.e2e.spec.ts:113-116` (6 tests) | `[data-testid="canvas-tile"]` not found | `page.locator('[data-testid="canvas-tile"]')` -> `page.locator('ptah-canvas-focus-area')`; comment rewritten | `canvas-focus-area.component.ts:20` selector; its `<ptah-canvas-lane-view>` hosts the ChatView (`:64`). `canvas-rail-board.component.ts:132` (`@if (visible())`) renders focus areas only for a visible board, so the bare selector is unique in single focus and excludes the hidden main-panel ChatView. `agentPanel` and `capture(tile)` stay inside the pane. Log `job-116153489643.log:456-480` |
| `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:166` (4b) | `Expected "right"`, `Received "left"` | `headerAction(page, await visualPane(page, 0), 'Swap panes')` -> `headerAction(page, paneContainer(page).locator(\`[data-pane-side="${activeSide}"]\`), 'Swap panes')`, with a comment | `results-1/canvas-canvas-Canvas-Rail--fede0*/error-context.md:17-25`. The pane wrapper has `(click)` and `(focusin)="activatePane(side)"` (`canvas-rail-board.component.ts:147`, `activatePane` at `:522-535`). After `openBeside` the right pane is active (`:556-557`). Opening the inactive left pane's menu moved the active side. The active pane's menu does not (`activatePane` returns early for the active side). |
| `canvas.spec.ts:200` (4c) | `Received: 0`, `New session [active]` | `railCards(page).last().locator('.rc-select').focus()` -> `railBoard(page).locator('ptah-canvas-rail footer button').focus()` | The footer button is the last tabbable of the Rail (`canvas-rail.component.ts:203-214`). The board's `onTabKey` (`canvas-rail-board.component.ts:797-824`) redirects only when the visual next element differs from the DOM next one. From the footer button the next element is the top pane (`visual` list: outside-preceding, top pane, bottom pane). Snapshot line 142 of the 4c context shows `button "New session" [active]`. See Decisions 1. |
| `specs/chat/tile-load-older-history.spec.ts:43` (5 tests) | `canvas-tile` not found | `.locator('[data-testid="canvas-tile"]')` -> `.locator('ptah-canvas-focus-area')` (keeps `.filter({ hasText: marker })`), comment added | Snapshot shows `PTAH_E2E_AC11_ANCHOR_ZERO_MARKER` inside `region "Focused session: AC-11 perf session ANCHOR_ZERO"`. Rail cards also contain the marker, so the scope is the pane, not the board. |
| `specs/git/change-set-card.spec.ts:138` (2 tests) | same | same swap | `results-1/git-change-set-card-turn-s-*`; same pane scope. |
| `specs/task-360-failed-start-leaves-tab-idle.spec.ts:122` | same | `'[data-testid="canvas-tile"] ptah-auth-required-banner'` -> `'ptah-canvas-focus-area ptah-auth-required-banner'`; comment says "focused pane" | `results-4/task-360-*` snapshot: `alert "Authentication required"` inside the focused region. |
| `specs/task-374-abort-then-next-turn.spec.ts:51-57` | same | `const TILE = '[data-testid="canvas-tile"]'` -> `'ptah-canvas-focus-area'`; comment | `results-4/task-374-*` snapshot: `button "Stop generating"` in the focused region. |
| `specs/task-337-agent-card-refresh.spec.ts:57-59` | exact `section[aria-label="Focused session"]` no longer matches | `'ptah-canvas-focus-area section[aria-label="Focused session"]'` -> `'ptah-canvas-focus-area'` | The label is `Focused session: <title>` (`canvas-rail-board.component.ts:519`). The inner section loses its label under change (a). The bare selector holds before and after. |
| `specs/perf/startup-tti.spec.ts:57-59` | waits on the deleted `Create new session` CTA | `page.getByRole('button', { name: 'Create new session' })` -> `page.locator('[data-testid="canvas-new-session-anchor"]')` | `orchestra-canvas.component.ts:165`, rendered whenever `canAddTile()` (`:138`), including the empty board. `canvas.spec.ts` already uses it on the empty board. |
| `specs/task-370-concurrent-session-isolation.spec.ts:52,125-157` (4e) | `toHaveCount(2)`, received 0 | Rewritten: `TILE` removed. After FAB + Create, `cards.toHaveCount(2)`, `ui.canvasPanes()` count 1, then `const { opened: tileA, kept: tileB } = await ui.openRailCardBeside(cards.first())` and count 2. `tileX.locator('.canvas-tile').click()` -> `tileX.locator('ptah-canvas-focus-header strong').click()`. `toHaveAttribute('data-focused','true')` -> `toHaveAttribute('aria-label', /, active$/)`. Doc comment updated. | `openBeside` (`canvas-rail-board.component.ts:537-562`): the invoked session takes the opposite side and becomes active; the previously focused session stays in `otherTabId`. A (first card) is therefore `opened`, B (new session) is `kept`, which matches the old `nth(0)`/`nth(1)`. Cards are appended at the end (`canvas.store.ts:565`). A click on the header title (non-interactive `<strong>`, `canvas-focus-header.component.ts`) bubbles to the wrapper's `(click)="activatePane(side)"`. The pane label ends `, active` only in split (`paneLabel`, `:517-520`). |
| `specs/chat/compaction-duplicate-session.spec.ts:152-310` (4e) | `tiles toHaveCount(1)`, received 0 | Pre-split steps use the single pane (`ui.canvasPanes().first()`, count 1). After FAB + Create (cards 2, panes 1), `{ opened: firstTile, kept: secondTile } = await ui.openRailCardBeside(cards.first())`, panes 2. End: `data-focused` checks -> `firstTile` `not.toHaveAttribute('aria-label', /, active$/)`, `secondTile` `toHaveAttribute('aria-label', /, active$/)`, `panes` count 2. | Same `openBeside` analysis. Interacting with the inactive `kept` pane (click/fill) activates it through `focusin` and `click`, so the non-first origin stays active at the end. The two tabs have distinct ids, so `assertDistinct` (`:336-340`) holds. |
| `support/ui-driver.ts:430-460` (`ensureCanvasChatTile`) | dead fallback | FAB-title branch plus `Create new session` fallback -> one click on `[data-testid="canvas-new-session-anchor"]`; doc comment updated | `Create new session` no longer exists; the FAB branch was the only live one. |
| `support/ui-driver.ts` (new) | none | Added `canvasPanes(side?)` and `openRailCardBeside(card)` | Shared by task-370 and compaction-duplicate (the only users of the two-pane flow). |
| `support/perf-session-fixture.ts:463-467` | stale, not failing | `waitForTileMarker`: `'[data-testid="canvas-tile"]'` -> `'ptah-canvas-focus-area'`; doc comment | Same pane scope. |
| `support/perf-page-capture.ts:230,250,351,491` | stale, not failing | four `[data-testid="canvas-tile"]` -> `ptah-canvas-focus-area` (`document.querySelectorAll`) | Same pane scope. |
| `specs/chat/tile-open-longtask-budget.perf.spec.ts:367` | stale, skipped in CI | `page.locator('[data-testid="canvas-tile"]')` -> `page.locator('ptah-canvas-rail [data-rail-card]')` (count still `sessions.length`); NOTE comment added | The Rail mounts one focused pane, so the session count is the card count. The rest of the harness is not fixed, see Decisions 3. |

Not changed: `showcase/*.scene.ts` (recorded only), `docs-screenshots/sessions.shot.ts:54` (uses the
`Add new session tile` title, which still exists), `canvas.spec.ts:74,185` (the substring role
match `Focused session` becomes unique after change (a); pane label `Focused session: <title>` is
asserted at `:185`).

## Decisions

1. **4c origin.** I used `footer button` instead of the proposal's `getByRole('button', { name: 'New session', exact: true })`.
   A collapsed Rail renders the label as `+` (`canvas-rail.component.ts:213`), with no `aria-label`,
   so a name-based selector would break once change (c) collapses the Rail at narrow widths. The
   1280 px window is stacked (below 1440 px) and wide enough to stay expanded, so either works
   there. The footer locator is correct in both states.
2. **4b.** Equivalent to the proposal (`[data-pane-side="${activeSide}"]`), and `activeSide` was
   already read on the line above. Side note from the report: `closePane`'s "closing the inactive
   pane" branch (`canvas-rail-board.component.ts` closePane) cannot be reached through the header
   menu, because opening the menu activates the pane. This is product doc/comment territory, not
   touched.
3. **Perf harness (`tile-open-longtask-budget.perf.spec.ts`, `perf-page-capture.ts`).** Only the
   deterministic selector and count were fixed. This harness is gated by `PTAH_PERF_SPECS=1`
   (skipped in CI) and is built on three sessions mounted at once: `openTilesWithinPage` waits
   for all markers to render, and the per-session marker and scroll-sanity loops need every
   session mounted. In the Rail only the last-opened session has a mounted transcript, so those
   steps need a redesign (a per-focus measurement), not a selector swap. I left a NOTE in the spec
   and did not guess a new measurement design.
4. **Pane sides are resolved, not assumed.** The report proposed fixed `right`/`left` for the
   two-pane specs. `openRailCardBeside` reads the single pane's side first and returns the
   opposite one for the invoked session, so a prior `activeSide` flip cannot break it
   (`openBeside` flips from the current `activeSide`, which `closeSplit`/`closePane` can leave on
   `right`).
5. **Pane activation click.** The report proposed clicking `ptah-canvas-focus-header` itself. Its
   centre can land on a button (the header holds Compact, Close and the overflow menu), so the
   specs click the title `<strong>` inside it, which is non-interactive and bubbles to the
   wrapper's `activatePane`.
6. **Dependency on the parallel canvas work.** `canvas.spec.ts:74` (region `Focused session`) and
   the task-337 selector only get stable once change (a) removes the inner label. `canvas.spec.ts:74`
   is a strict-mode role match: with the inner `<section>` still labelled, it still fails with two
   regions. This is the pending product fix, not a spec change.
7. **Not verified at runtime.** No e2e was run. The risk the report called out remains for
   plan-limits at 280/360/440 px: a 272 px Rail leaves almost no pane, and the stats strip may be
   found but clipped. Change (c) (56 px Rail below 640 px) is what makes those widths usable;
   the selector change alone does not.

## Checks

All run through `node .ptah/tmp/check-run.mjs <label> -- <command>`, one at a time, no cache.

| Command | Result |
|---|---|
| `npx nx typecheck ptah-electron-e2e --parallel=1 --skip-nx-cache` | `Successfully ran target typecheck for project ptah-electron-e2e` |
| `npx nx lint ptah-electron-e2e --parallel=1 --skip-nx-cache` | `17 problems (0 errors, 17 warnings)`; the only one in a touched file is `ui-driver.ts:139` `no-useless-assignment`, at code I did not change |
| `npx nx typecheck @ptah-extension/webview-e2e-harness --parallel=1 --skip-nx-cache` | `Successfully ran target typecheck for project @ptah-extension/webview-e2e-harness` |
| `npx nx lint @ptah-extension/webview-e2e-harness --parallel=1 --skip-nx-cache` | `44 problems (0 errors, 44 warnings)`, none in `plan-limits-visual.e2e.spec.ts` |

Neither project has a unit `test` target, so none was run. No e2e, build, serve or package target
was run. No git state was changed.
