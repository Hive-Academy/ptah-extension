# CI fix R1 report

## Fix 1

The audit baseline remains unchanged. The scoped detector reproduced all 13 findings (four in harness-builder, nine in onboarding) and reports zero unsuppressed sites after the fixes. Each catch now has the documented suppression form with its actual failure path:

| Finding in CI                                                                      | Fix                                                                                             |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `libs/frontend/harness-builder/src/lib/services/harness-session.controller.ts:260` | Reported: log and failed phase plus retry message.                                              |
| `libs/frontend/harness-builder/src/lib/services/harness-session.controller.ts:363` | Reported: log and `proposal-unavailable` recovery state.                                        |
| `libs/frontend/harness-builder/src/lib/services/harness-session.controller.ts:387` | Reported: log and failed phase plus retry message.                                              |
| `libs/frontend/harness-builder/src/lib/services/harness-session.controller.ts:431` | Reported: log and failed phase plus uncertain-stop message.                                     |
| `libs/frontend/onboarding/src/lib/analyze/analysis-step.store.ts:82`               | Reported: `failed` result maps to the saved-analysis retry message.                             |
| `libs/frontend/onboarding/src/lib/analyze/analyze-workspace.page.ts:130`           | Reported: `savedError` displays the load failure.                                               |
| `libs/frontend/onboarding/src/lib/analyze/choose-agents.page.ts:216`               | Reported: `loadError` displays a retryable failure.                                             |
| `libs/frontend/onboarding/src/lib/analyze/generate-agents.page.ts:208`             | Reported: `continueError` displays a retryable failure.                                         |
| `libs/frontend/onboarding/src/lib/analyze/generation-step.store.ts:100`            | Optional capability: section counts are supplemental; the completed guidance remains available. |
| `libs/frontend/onboarding/src/lib/analyze/project-guidance.page.ts:176`            | Reported: `lookupError` displays the run lookup failure.                                        |
| `libs/frontend/onboarding/src/lib/first-run/onboarding-first-run.tracker.ts:120`   | Optional capability: invalid navigation URL cannot commit first-run redirect.                   |
| `libs/frontend/onboarding/src/lib/first-run/onboarding-flag.service.ts:178`        | Reported: storage failure is logged.                                                            |
| `libs/frontend/onboarding/src/lib/proposal/proposal-flow.store.ts:238`             | Reported: `actionError` displays a retryable session-stop failure.                              |

These edits document existing behavior; no failure behavior changed, so no new behavioral unit spec was needed.

## Fix 2

`apps/ptah-electron-e2e/src/specs/state.spec.ts` now seeds `ptah.onboarding.v1` with `{ shownAt }` and reloads the renderer before the two assertions that wait for `ptahRoute`. This follows the fixture's first-run flag shape and lets the app write a persistable route. The IPC write and reload assertions remain the same.

## Fix 3

The four onboarding visual specs now use one shared capture theme list: CI uses the first product theme (`ptah-glass`) at both wide and narrow sizes; local runs keep all four themes. Ready-page glass-only transparency and contrast cases also use that same CI theme, preserving their assertions while reducing captures. The workflow timeout is unchanged.

The two Electron `settings-advanced-search-voice.e2e.spec.ts:187` failures are branch-caused. This branch inserted a Setup panel above the Advanced settings component, while the spec measures Advanced cards against the 768px fold in both `anubis` themes. The test reports its fold failure only after taking captures. The Setup panel is now below Advanced settings, and a component spec asserts that order. The settings e2e spec was not run, as requested.

## Verification

- `npm run verify -- -t lint -p degradation-audit`: `NX   1 task: 1 succeeded`.
- `npm run verify -- -p @ptah-extension/onboarding,@ptah-extension/harness-builder`: `NX   6 tasks: 6 succeeded`.
- `npm run verify -- -t lint,typecheck -p ptah-electron-e2e,@ptah-extension/webview-e2e-harness`: `NX   4 tasks: 3 succeeded, 1 failed`. Only `ptah-electron-e2e:lint` failed, with four accepted existing `no-restricted-syntax` errors in `src/specs/git-watcher.spec.ts` at 111, 169, 220, and 273; the other three tasks succeeded.
- `npm run verify -- -p @ptah-extension/chat`: `NX   3 tasks: 3 succeeded` (includes the settings component spec).
- `git diff --check`: passed.

## Decisions

The specific fixed worktree and the prohibition on checkout take precedence over the generic new-worktree guidance. The audit annotations follow `tools/degradation-audit/check-degradation.ts`; the baseline was not raised. The settings failure classification is an inference from the branch diff and the spec's fold assertions, without a browser rerun.

## Not done

The settings e2e spec, all other e2e targets, builds, app targets, and the protected coordinator/lane files were not run or edited. The Advanced fold was not visually rerun in Electron because the task forbids browser tests and app targets. Ptah scoped diagnostics timed out twice; the scoped Nx typechecks above succeeded instead.
