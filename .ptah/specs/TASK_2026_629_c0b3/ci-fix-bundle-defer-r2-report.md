# CI fix r2: move Rail board parts that first paint does not need into lazy `@defer` chunks (TASK_2026_629)

**Verdict: DONE, but the bundle number is not measured yet.** Three canvas-only components now load
in lazy `@defer (on idle)` chunks. My estimate is about 12.5 to 13.5 kB raw out of `main`. The
overshoot is 2.75 kB and the goal was at least 10 kB, so the estimate clears the goal. It probably
falls a little short of the 15 kB target. These numbers are estimates from minifying the source with
esbuild, not from a build (the task forbids builds). The real figure arrives with the CI
`bundle initial` line after the push. The budget, `app.config.ts` and `apps/ptah-electron-e2e/**`
are unchanged. The canvas as a whole stays eager.

## Files changed

- MODIFIED `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts`: all three
  `<ptah-canvas-session-details>` uses (split Details overlay, `sm` Details aside, side aside) are
  wrapped in `@defer (on idle)`. Each has a placeholder that shows the same "Session details" heading
  text. The `aside` containers stay eager, so their width, the `role="dialog"`/`aria-label="Session details"`
  overlay and the "Close details" button are all unchanged.
- MODIFIED `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.ts`:
  `<ptah-canvas-lane-tabs>` is wrapped in `@defer (on idle)`. Its placeholder is
  `div.h-9.shrink-0.bg-base-200[aria-hidden]`, the same height as the tab strip (`h-9` tabs on
  `bg-base-200`), so nothing shifts.
- MODIFIED `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts`:
  `<ptah-canvas-needs-you-queue>` is wrapped in `@defer (on idle)`. Its placeholder is an `invisible`,
  `aria-hidden` `span.btn.btn-xs.btn-ghost.border` reading "All clear". It keeps the trigger's
  footprint, so the dock controls after it do not move.
- MODIFIED `canvas-rail-board.component.spec.ts`, `canvas-focus-area.component.spec.ts`,
  `orchestra-canvas.component.spec.ts`: each gets a `completeDeferBlocks()` helper
  (`fixture.getDeferBlocks()` plus `render(DeferBlockState.Complete)`). The 5 tests that read the
  deferred child now await it. I added one new test per spec that pins the placeholder state and then
  the loaded state, which fixes the defer boundary in place.

Each deferred import is now its own declaration, with a comment above it stating the contract
(used only inside `@defer`, and no eager file imports it).

## Deferred components and why each lands in a lazy chunk

Size estimates come from esbuild TS-strip plus minify of the source, with template whitespace
collapsed. AOT output is usually about that size or a little larger.

| Component (file) | Est. raw saved | Why it splits |
| --- | --- | --- |
| `CanvasSessionDetailsComponent` (`canvas-detail/canvas-session-details.component.ts`) | ~4.0 kB | Its only importer is `canvas-rail-board.component.ts`, through a single-symbol relative import. All 3 template uses are inside `@defer`. There is no value use in the class, no barrel export (`canvas/src/index.ts` exports only the store, the layout service and `OrchestraCanvasComponent`), and nothing in `apps/ptah-extension-webview` or any other lib imports it. The compiler therefore drops the static import and emits `import('../canvas-detail/canvas-session-details.component')`, and esbuild puts it in its own chunk. Its chat and chat-ui dependencies (`SessionGitStatsStore`, `summarizeTodos`, ...) are still used eagerly by `CompactSessionCardComponent`, so they stay in `main`. |
| `CanvasNeedsYouQueueComponent` + helper `canvas-needs-you-queue.ts` | ~4.7 + 1.3 = ~6.0 kB | Its only importer is `orchestra-canvas.component.ts` (single-symbol import, one `@defer` use, no other value reference). Only the queue component imports `buildNeedsYouItems` (`canvas-needs-you-queue.ts`), so the helper moves with it. `NativePopoverComponent` and `AgentPermissionResponder` stay eager because other code uses them. |
| `CanvasLaneTabsComponent` (`canvas-detail/canvas-lane-tabs.component.ts`) | ~4.8 kB | Its only importer is `canvas-focus-area.component.ts` (single-symbol import, one `@defer` use). `lane-owner.ts` stays eager because the lane view also uses it, and it is only 81 B. |
| Gross | ~14.8 kB | |
| Cost of 5 defer blocks in `main` (dependency fn, placeholder template, `ɵɵdefer` instructions) | about −1.5 to −2 kB | The defer runtime is already in `main` (chat lib `@defer` blocks), so it adds nothing new. |
| **Net** | **~12.5 to 13.5 kB** | |

Rejected candidates:

- **Focus header and lane view / detail transcript.** These are what first paint shows when a session
  is focused: the header and the live transcript.
- **Lane view non-orchestrator lanes.** These would need a component extraction with heavy spec
  coupling, and their chat-lib components are imported eagerly by `agent-monitor-panel` anyway.
- **Cross-lib barrel symbols.** A deferred `import('@ptah-extension/chat')` would keep the whole
  namespace, as the r1 report explains.
- **`ProjectSetupCardComponent`.** The r1 report covers it: it is already eager through
  `ChatEmptyStateComponent`.

## Checks

All checks ran through `node .ptah/tmp/check-run.mjs`, one at a time. Logs are at
`%TEMP%\629-check-<label>.log`.

- Baseline before the spec edits (`r2-canvas-test-pre`): 5 failures, all of them the expected ones
  that read a deferred child synchronously. Result: 3 suites failed, 364 tests passed.
- Changed specs, `npx nx test canvas --testFile=<spec> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`:
  - `canvas-focus-area.component.spec.ts`: 11/11 passed.
  - `canvas-rail-board.component.spec.ts`: 84/84 passed.
  - `orchestra-canvas.component.spec.ts`: 31/31 passed.
- Mode 2 on canvas:
  - `npx nx test canvas ...`: **23/23 suites, 372/372 tests passed**.
  - `npx nx typecheck canvas ...`: **passed**.
  - `npx nx lint canvas ...`: **0 errors, 31 warnings**. All the warnings were there before. The one
    on a changed file is `max-lines` in `canvas-rail-board.component.ts`, which was already 849 lines
    at HEAD and is 865 now.
- Not run, because the task forbids them: the webview production build and bundle stats, and e2e.
  chat, chat-ui and ui are untouched, so I did not run their checks.

## E2E risk (apps/ptah-electron-e2e, not edited)

All three blocks use `on idle`, so they render right after first paint. Playwright's auto-waiting
locators find them.

- `getByRole('dialog', { name: 'Session details' })` in `canvas.spec.ts:159` matches the eager
  `aside`, not the deferred content, so it is unaffected. The Escape and focus-restore path targets
  only eager buttons.
- `pane.locator('ptah-canvas-lane-tabs')` with `boundingBox()` in `canvas.spec.ts:150-154`: the host
  appears on idle. The check runs after split is opened and `toBeVisible()` has passed on the
  header, so idle is long over by then. Low risk.
- `'ptah-canvas-focus-area'`, `ptah-canvas-focus-header` and the "Open details" buttons are not
  deferred.
- No e2e or showcase file refers to the needs-you queue ("need you" / "All clear").
- Behaviour risk in the idle window only, on first mount: `onLanesRequested`
  (`canvas-rail-board.component.ts`) focuses `[role="tab"][aria-selected="true"]` after the next
  render. If a pane had never mounted lane tabs before, focus would not move. On a later focus swap
  the `@if (focusedTabId(); as id)` view, and so the loaded block, is kept. The lane-tabs effect
  that resets a stale lane key to Orchestrator also starts only on idle. Until then the lane view
  falls back to its own `selectedKind` and shows Orchestrator.

## Decisions

- **Decision:** use `on idle` for all three blocks, as the task asks.
  **Options:** `on idle`, `on immediate`, or `when` conditions.
  **Evidence:** task step 4. The containers already gate when they appear, so a `when` condition
  would add nothing.
  **Reversible:** yes.
- **Decision:** do not defer the focus header, the lane view or the transcript.
  **Options:** defer the whole focus area (largest saving), or defer only the parts first paint does
  not need.
  **Evidence:** the goal says "parts that are NOT needed for the first paint", and the focused pane
  is the first paint.
  **Reversible:** yes.

## Out-of-scope observations

- `canvas-rail-board.component.ts` already breaks the lint `max-lines` limit (700). It needs a
  split in a later task.
- If CI still shows the bundle within a few kB of 3.50 MB, the next candidate with real headroom is
  deferring `ChatEmptyStateComponent` in the chat lib. The r1 report has the details.
