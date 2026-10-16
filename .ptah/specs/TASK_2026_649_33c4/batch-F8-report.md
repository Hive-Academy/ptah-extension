# F8 report

## Summary

The foreign-session question assertion now targets the chat view that owns the foreign transcript. The first boot-time workspace activation now preserves the restored builder URL, including its mode and tab ID. Both pending and settled restore timings are covered by a unit spec.

## Root cause per failure

- **Question routing: spec drift.** `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:103` renders the transcript inside `ptah-chat-view`; the question card is separately rendered at line 200. The CI r2 page snapshot contains the visible "Unrelated session question" card after the foreign rail card is selected, while `new-project-question-routing.spec.ts:252` queried for a card *inside* `ptah-chat-transcript`. The card was correctly routed to the foreign session. The replacement locator finds a `ptah-chat-view` containing the foreign tab's transcript, then its question card. The assertion that the builder view has zero cards remains.
- **Reload: app regression, proven in AppStateManager.** `design-spec.md:415` and `implementation-plan.md:98,129` require route and session restoration. `surface-route-persistence.ts:42-56,69-88` records settled URLs; `webview-route-state.ts:24-29,134-143` accepts this builder route; `initial-navigation.ts:95-116` restores it. `app.routes.ts:118-130` has no redirect guard, and `harness-builder-view.component.ts:366-378` does not navigate to Chat when a tab is missing. The CI r3 snapshot after reload shows Chat with the same New Project tab. During boot, `electron-layout.service.ts:789-827` activates the workspace; previously `app-state.service.ts:875-949` unconditionally started a workspace-surface navigation. The new test at `app-state.service.spec.ts:679-726` failed without the fix for both timing variants: a pending builder route was replaced, and a settled `/harness-builder/new-project/boot-tab` was shortened to `/harness-builder`. `app-state.service.ts:879,908,939-944` now treats the first transition from the implicit workspace as adopting the boot route and its settlement ownership. Real workspace switches still navigate to their remembered surface. This proves the app-side navigation race; the CI artifacts do not expose the saved `ptahRoute` value, and Electron e2e was not run locally.

## Changes

- `apps/ptah-electron-e2e/src/specs/harness/new-project-question-routing.spec.ts`: scope the question card to the `ptah-chat-view` containing the foreign tab's transcript.
- `libs/frontend/core/src/lib/services/app-state.service.ts`: preserve the initial route when adopting the first real workspace; leave later workspace-switch navigation intact.
- `libs/frontend/core/src/lib/services/app-state.service.spec.ts`: cover pending and settled restored builder child routes followed by boot workspace activation.
- `.ptah/specs/TASK_2026_649_33c4/batch-F8-report.md`: this report.

## Checks run

- `npx nx typecheck ptah-electron-e2e --parallel=1` — passed. Nx Cloud also printed a disabled-organization warning.
- `npx nx lint ptah-electron-e2e --parallel=1` — passed with 17 existing warnings. Nx Cloud also printed a disabled-organization warning.
- `npx jest -c libs/frontend/core/jest.config.ts libs/frontend/core/src/lib/services/app-state.service.spec.ts --coverage=false --maxWorkers=2 -t 'boot-restored builder route'` — failed before the app fix as intended: both timing cases exposed lost builder child URLs.
- `npx nx typecheck @ptah-extension/core --parallel=1` — passed; Nx Cloud printed a disabled-organization warning.
- `npx nx lint @ptah-extension/core --parallel=1` — passed with 14 warnings; Nx Cloud printed a disabled-organization warning.
- `npx jest -c libs/frontend/core/jest.config.ts libs/frontend/core/src/lib/services/app-state.service.spec.ts --coverage=false --maxWorkers=2` — passed, 142 tests.
- No Jest command applies to the changed Playwright spec. E2e execution was prohibited.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Scope the card through the owning chat view | Transcript descendant; owning view | Template lines 103 and 200, CI r2 snapshot | Yes |
| Retain the automatic route-restore expectation | Manual `ui.goto('harness-builder')`; app fix | 649 design note 6 and acceptance rows 29/60 require reload restoration | Yes |
| Preserve the initial route on first workspace adoption | Navigate to remembered slice; adopt the live boot route | Red/green pending and settled route tests; 649 reload requirement | Yes |
| Leave real workspace-switch navigation in place | Skip all workspace navigation; branch only on implicit workspace | Existing A/B workspace tests and 142 passing AppStateManager tests | Yes |

## Not done

- No build, serve, dev, e2e, package, or workspace-wide check was run; the two Electron e2e cases remain unverified locally.
- Pre-existing worktree changes in `tsconfig.base.json` and the listed HANDOFF/NEXT-SESSION-PROMPT files were neither modified nor reverted.
