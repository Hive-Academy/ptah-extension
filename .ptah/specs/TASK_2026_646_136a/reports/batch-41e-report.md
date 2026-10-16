# Batch 41e — webview initial bundle back under budget

## Cause

CI (PR #731, which builds the merge with `main`) failed with: `bundle initial exceeded maximum
budget. Budget 3.70 MB was not met by 5.25 kB with a total of 3.71 MB`.

`settings` is an EAGER route (`apps/ptah-extension-webview/src/app/app.routes.ts:103-109`), and
`SettingsComponent` rendered the Agent Orchestration tab directly. That put the tab's whole graph in
the initial chunk: `OrchestrationSettingsComponent` → `ProviderConsumerAssignmentsComponent` →
`DecisionModelRowComponent` (new, 697 lines) and `provider-consumer-rows.ts` (+477 lines on this
branch). The Agents-tab outcome UI in `skill-synthesis-ui` is not involved: it loads only under the
lazy `thoth` route (`app.routes.ts:140-150`).

## Change

The Orchestration tab now loads the same way as the Advanced and Search & Voice tabs on the same
page, which were deferred for the same reason ("the eager route is at its bundle budget").

- `libs/frontend/chat/src/lib/settings/settings.component.html:172-185`: the
  `<ptah-orchestration-settings>` element is in a `@defer (on immediate)` block inside the existing
  `@if`. The `@placeholder` is the same `aria-busy` placeholder the other deferred tabs use, so
  `waitForSettled` in the e2e harness keeps waiting until the chunk has loaded. The bindings
  (`[focusTarget]`, `(focusTargetConsumed)`) are unchanged, so deep links still apply once the tab
  renders.
- `libs/frontend/chat/src/lib/settings/settings.component.ts:27-30`: the import is split into a
  value import of `OrchestrationSettingsComponent` and an `import type` of
  `OrchestrationSettingsFocusTarget`. That way the component's import declaration holds only the
  class that is used only inside `@defer`, and Angular can defer it.
- `settings.component.ts:105-107`: the class moved under the existing comment that says these
  classes are used only inside `@defer`.
- `libs/frontend/chat/src/lib/settings/settings.component.spec.ts`:
  - Two Orchestration-landing tests now let the deferred chunk render (`whenStable` +
    `detectChanges`) before they query it.
  - The "deferred tabs" suite has a new Manual-mode test: the `aria-busy` placeholder shows first,
    and after render the deep-link target reaches the tab and `focusTargetConsumed` clears it.
  - `orchestration` is added to the Playthrough `it.each` case.

The only change in behaviour is load timing: on first open, the Orchestration tab shows the
placeholder briefly, as Advanced and Search & Voice already do. No `data-testid` changed, and the
budget was not touched.

## Measurements (`NX_NO_CLOUD=true npx nx build ptah-extension-webview --parallel=1`)

Local builds compile this branch only. Its `project.json` still has the old 3.50 MB error budget;
`main` has raised it to 3.70 MB.

| Build | main.js | Initial total | Budget line |
| --- | --- | --- | --- |
| Before (branch HEAD) | 1.18 MB | 3.51 MB | `Budget 3.50 MB was not met by 14.45 kB` (ERROR) |
| After (this batch) | 1.12 MB | 3.45 MB | only the 2.50 MB warning, `not met by 950.75 kB`; build exit 0 |

- Before = 3584 + 14.45 = 3598.45 kB. After = 2560 + 950.75 = 3510.75 kB. **Initial chunk saving:
  87.70 kB.**
- Projected for the CI merge build: 3794.05 − 87.70 ≈ 3706.35 kB. That is about **82 kB under the
  3.70 MB budget**, against the 10 kB margin the batch asked for. This assumes the saving carries
  over additively, because the moved code is this branch's Orchestration graph. The merge result
  was not built locally.
- The "after" build ran while other agents had uncommitted edits in the worktree
  (`clone-card.component.ts`, which is in the lazy `thoth` chunk, and backend libs that are not in
  this bundle).

Builds used: 2 of 3.

## Other verification

- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/settings/settings.component.spec.ts --coverage=false --maxWorkers=2`:
  47 passed, 47 total.
- `npx eslint` on the three changed files: clean. `npx prettier --check` on the `.ts` and `.html`
  files: clean.
- `ptah_get_diagnostics` on the changed files: none. Other files in `chat` already have spec type
  errors (for example `tab-bar.component.spec.ts`); this batch did not touch them.

## Decisions

- **Defer the whole Orchestration tab rather than only the Decision model row.**
  - Options considered:
    - (a) `@defer` the row inside `ProviderConsumerAssignmentsComponent`.
    - (b) `@defer` the assignments block.
    - (c) `@defer` the tab.
  - Evidence: (c) is the pattern already used for tabs 3 and 4 in the same template. It moved
    87.7 kB, against the 15.6 kB needed for a 10 kB margin. The first build did not write a
    `stats.json` (the budget error aborted the output), so the size of (a) could not be measured
    and might not have reached the margin.
  - Reversible: yes, by removing the `@defer` wrapper.
