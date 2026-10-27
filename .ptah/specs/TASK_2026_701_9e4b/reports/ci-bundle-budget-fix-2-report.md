# CI bundle budget fix 2 — `TASK_2026_701_9e4b`

## Root cause (from CI logs only)

The "Initial chunk files" tables of the `webview-e2e` jobs (each PR run builds the merge with main):

| Run | Built commit (merge) | main.js | styles.css | big shared chunk | Initial total |
| --- | --- | --- | --- | --- | --- |
| 40496511620 (main) | 62e97f505 | 1.43 MB | 378.47 kB | 423.50 kB | 3.94 MB (pass) |
| 40545033441 (PR #829 head 73d7bc556) | on 62e97f505 | 1.41 MB | 378.63 kB | 444.83 kB | 3.94 MB (pass) |
| 40553865428 (PR #832 head 6bba1367a) | on 543971d2b (= main after #829) | 1.47 MB | 378.76 kB | 444.83 kB | 4.01 MB (over by 5.89 kB) |
| 40554463218 (PR #825 head 545e8beac) | on 543971d2b | 1.41 MB | 408.84 kB | 458.76 kB | 3.99 MB (pass) |
| 40562325531 (PR #832 head f2a312631) | on 65ad51fc2 (= main after #825) | 1.45 MB | 408.96 kB | 458.77 kB | 4.04 MB (over by 35.77 kB) |

What the table shows:

1. **Main grew by about 50 kB between our two runs.** PR #825 (the empty-state redesign, merged as
   65ad51fc2) landed after 6bba1367a was built. It adds about 30 kB to `styles.css` and about
   14 kB to the shared chunk, which takes main from 3.94 MB to 3.99 MB. That leaves about 10 kB
   under the 4.00 MB budget. PR #829 made almost no difference to the total.
2. **The f2a312631 deferral did take code out of the initial bundle.** Our branch added about
   60 kB to `main.js` at 6bba1367a (1.41 MB to 1.47 MB) and about 40 kB at f2a312631 (1.41 MB to
   1.45 MB). So that commit moved roughly 20 kB of `main.js` into lazy chunks. Our branch did not
   change styles or the other initial chunks: their sizes match PR #825's run to within 0.3 kB.
3. **What stayed eager:** the step components that host those dialogs. `WizardViewComponent`
   (eager, on the `setup-wizard` route) imports `AgentSelectionComponent` (41 kB of source, and
   it provides `GenerationPreviewStore`) and `CompletionComponent`. `GenerationAgentSidebarComponent`
   (eager, on the `setup-wizard/generation/...` route) imports `AgentSelectionListComponent`, which
   pulls in `CommunityPacksPanelComponent`, `PackInstallStore`, `preview-decisions.state`,
   `pack-install-result`, `safe-failure-copy`, the model picker and source status. It also
   imports `AgentNextStepsComponent`, which pulls in `outcome-rows`. Most of this branch's eager
   growth lives in these hosts and stores.

The overage went from 5.89 kB to 35.77 kB because main grew by about 50 kB. Our branch's own
eager share actually shrank, from about 60 kB to about 40 kB.

## Changes

All changes are inside `libs/frontend/setup-wizard`. There is no budget change, no RPC or store
change, and no new UI.

1. `libs/frontend/setup-wizard/src/lib/components/wizard-view.component.ts:114-158`: every
   wizard step after `welcome` (scan, analysis, selection, enhance, generation, completion) now
   renders inside `@defer (on immediate) { ... }` within its `@case`. Each step component appears
   only in that file's `imports` array and in its deferred block, so Angular compiles each one to
   a dynamic `import()`. The welcome/landing step, which is the initial view, stays eager.
2. `libs/frontend/setup-wizard/src/lib/components/generation-agent-sidebar.component.ts:85-93`:
   `<ptah-agent-selection-list>` now sits inside `@defer (on immediate)`.
3. Same file, lines 175-195: `<ptah-agent-next-steps>` now sits inside `@defer (on immediate)`.
4. `libs/frontend/setup-wizard/src/lib/components/generation-workflow-shell.component.spec.ts`
   (spec only):
   - The "real sidebar" test is now `async`. After each `detectChanges()` that reveals a deferred
     block, it waits one macrotask (`setTimeout(…, 0)`) and calls `detectChanges()` again.
     `whenStable()` cannot be used here because the shell's 250 ms countdown interval keeps the
     zone from settling.
   - The describe-level `SurfaceRouterService` mock gains `currentSurface: signal('chat')`. The
     extra tick lets `AppStateManager`'s root effect run, and that effect calls
     `currentSurface()`.
   - The assertions themselves did not change.

Behavior: a `when`/`on immediate` trigger starts loading as soon as its block renders. The step
appears one async tick after the step changes. In the webview that is a local chunk load. There
is no `@placeholder`, so nothing flashes. A step that has loaded once comes from cache after
that. Step state lives in root or route services, not in the components, so nothing resets. The
focus router does not depend on the DOM (checked in `setup-wizard-focus-router.service.ts`).

## Static check: the moved code has no remaining eager importer

I grepped `libs/frontend`, `apps/ptah-extension-webview/src` and `apps/ptah-electron/src`,
excluding specs:

- `AgentSelectionComponent`, `CompletionComponent`, `ScanProgressComponent`,
  `AnalysisResultsComponent`, `PromptEnhancementComponent`, `GenerationProgressComponent`: used
  only by `wizard-view` (deferred) and the barrel `index.ts`. The other hits are comments in
  services.
- `AgentSelectionListComponent`, `AgentNextStepsComponent`: used only by the sidebar (deferred)
  and the barrel. `CommunityPacksPanelComponent` is used only by the list.
- `GenerationPreviewStore`, `PackInstallStore`, `preview-decisions.state`, `pack-install-result`,
  `safe-failure-copy`, `outcome-rows`, `generation-model-picker`, `generation-source-status`:
  every importer is now inside a deferred subtree.
- No app or lib imports any of these classes from `@ptah-extension/setup-wizard`. Their barrel
  re-exports are unused, so esbuild tree-shakes them. That is the same assumption f2a312631
  relied on, and its roughly 20 kB `main.js` drop is consistent with it.

## Estimated bytes moved

Source size (`wc -c`) that leaves the eager graph:

| Group | Source |
| --- | --- |
| Selection, completion and sidebar subtree (agent-selection, agent-selection-list, community-packs-panel, completion, agent-next-steps, the 2 stores, preview-decisions.state, pack-install-result, safe-failure-copy, outcome-rows, model picker, source status) | ~132 kB |
| Other wizard steps (scan-progress, analysis-results, prompt-enhancement, generation-progress, analysis-transcript, analysis-stats-dashboard, confirmation-modal, enhanced-prompts card, activity indicator) | ~93 kB |
| Total | ~225 kB |

Last round, about 82 kB of source moved and `main.js` dropped about 20 kB. That is a
source-to-minified ratio of roughly 0.25 to 0.3. Applying it here, I expect **about 55 to 65 kB**
to leave `main.js`, which puts the initial total at about 3.98 MB.

That clears the 35.77 kB overage with an estimated 20 to 30 kB of margin. It probably falls
short of the requested 40 kB margin over the overage, which would mean removing about 76 kB.
This branch's own eager share was only about 40 kB, so a 76 kB cut necessarily includes
pre-existing wizard code. That is why the remaining wizard steps were deferred as well.

If CI measures less than about 20 kB of margin, the next options are outside this batch's scope:
- make the `setup-wizard` routes lazy (`loadComponent`). `app.routes.ts` and
  `webview-routing.spec.ts` currently pin them as eager.
- defer `WizardLandingComponent` or `WelcomeComponent`, which are the initial view.

The estimate is not a measurement; CI will measure.

## Verification

- `npm run verify -- -p @ptah-extension/setup-wizard,ptah-extension-webview`: 6 tasks, 4
  succeeded. `ptah-extension-webview:lint` failed, which is the accepted pre-existing failure.
  `@ptah-extension/setup-wizard:test` failed one test: the shell spec's real-sidebar test, which
  needed to wait for the deferred blocks. setup-wizard lint and typecheck and webview test and
  typecheck passed.
- After the spec fix, `npm run verify -- -t test -p @ptah-extension/setup-wizard`: `1 task: 1
  succeeded`, exit code 0. Before the fix the suite had 638 tests with 1 failing, so 638 now pass.
- `ptah_get_diagnostics` on the 3 changed files: no errors in them. The errors it shows in
  sibling specs and shared files (BigInt target) exist without this change.
- No build was run locally, as instructed. The bundle size is measured only by CI.

## Changed files

- `D:\projects\ptah-extension\.claude-worktrees\wizard-library-alignment\libs\frontend\setup-wizard\src\lib\components\wizard-view.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\wizard-library-alignment\libs\frontend\setup-wizard\src\lib\components\generation-agent-sidebar.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\wizard-library-alignment\libs\frontend\setup-wizard\src\lib\components\generation-workflow-shell.component.spec.ts`

`libs/shared/src/lib/types/rpc.types.ts` also shows as modified in the worktree. That change
belongs to the backend agent, not to this fix.
