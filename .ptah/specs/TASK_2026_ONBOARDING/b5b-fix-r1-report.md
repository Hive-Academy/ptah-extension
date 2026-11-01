# B5b code logic review fixes — round 1

| Finding | Fix                                                                                                                                               | File:line                                                                                                                                    | Covering spec/test                                                   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| F1      | Map the onboarding surface to the retained `setup-hub` menu hook.                                                                                 | `apps/ptah-electron-e2e/src/showcase/_harness/config-menu.ts:14`                                                                             | `setup-wizard-tour.scene.ts` (authored; e2e unrun)                   |
| F2      | Check the actual intake alert and scope it to the intake.                                                                                         | `apps/ptah-electron-e2e/src/specs/harness/new-project.spec.ts:9`                                                                             | `Home opens the intake and requires a brief`                         |
| F3      | Stop the inert walk at `ptah-onboarding-shell`.                                                                                                   | `libs/frontend/harness-builder/src/lib/components/harness-builder-leave-dialog.component.ts:215`                                             | `inerts onboarding content while leaving app chrome interactive`     |
| F4      | Restore new-project payload, validation, restore, resume, and foreign ownership cases on onboarding routes.                                       | `apps/ptah-electron-e2e/src/specs/harness/new-project.spec.ts:49`                                                                            | See F4 coverage map                                                  |
| F5      | Seed a written first-run flag by default; expose `onboardingAlreadyShown: false` for the first-run spec.                                          | `apps/ptah-electron-e2e/src/support/fixtures.ts:41`; `apps/ptah-electron-e2e/src/specs/onboarding/onboarding.spec.ts:3`                      | `first run reaches Ready, can be skipped, and the menu reopens Home` |
| F6      | Restore the Electron shell `min-h-0` regression assertion.                                                                                        | `apps/ptah-extension-webview/src/app/app.routes.spec.ts:11`                                                                                  | `bounds the outer row and configuration host`                        |
| F7      | Guard both `app.config.ts` and `app.routes.ts` against eager wide imports and deleted harness views; allow routes to have no setup-wizard import. | `apps/ptah-extension-webview/src/app/setup-wizard-entry.spec.ts:27`; `apps/ptah-extension-webview/src/app/unit5-message-routing.spec.ts:127` | `setup-wizard eager entry`; `initial setup bundle boundary`          |
| F8      | Rewrite the 13 tour lines for the three Setup Home paths.                                                                                         | `apps/ptah-electron-e2e/src/showcase/scripts/setup-wizard-tour.json:4`                                                                       | Tour scene (authored; visual/e2e unrun)                              |
| F9      | Make the first-run fixture explicit about the two readiness RPCs, accept a chat tab route, and assert reload stays on Home.                       | `apps/ptah-electron-e2e/src/specs/onboarding/onboarding.spec.ts:3`                                                                           | `first run reaches Ready, can be skipped, and the menu reopens Home` |
| F10     | None in the scoped B5b changed files.                                                                                                             | —                                                                                                                                            | —                                                                    |

## F4 coverage map

| Old case                                | New e2e test or unit spec                                                                                                                                                                                            |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| .NET platform and stack wire payload    | `submits the .NET platform and stack in the wire payload`                                                                                                                                                            |
| Untouched platform payload              | `submits the new intake and opens the proposal workspace` asserts the current default `platform: 'node-ts'`; the old omission contract no longer applies because the new page always includes its selected platform. |
| Other stack free-text gate              | `requires free text when Other stack is chosen`; `NewProjectIntakePage` unit spec `validates required brief and other stack on submit`                                                                               |
| Reload and restore                      | `reload restores the proposal route and its tab`                                                                                                                                                                     |
| Resume same tab and direct switch       | `continues the same draft after a direct view switch`                                                                                                                                                                |
| TASK_2026_317 foreign-session ownership | `foreign-session question does not take the proposal panel (TASK_2026_317)`                                                                                                                                          |

## Decisions

- The new onboarding proposal uses its own route, session record, and answer dock. The removed builder view and embedded chat transcript selectors do not apply. The new tests assert the route, tab identity, proposal panel, and foreign question isolation.
- The Electron e2e tests were authored only. No e2e, app launch, Playwright, visual review, build, or workspace-wide check was run.
- The repository skill file `.claude/skills/angular-frontend-patterns/SKILL.md` was read directly because CLI skill invocation was unavailable. Ptah workspace analysis was used; native shell reads and patches were used for source and writes.
- The existing worktree and branch were retained. No new branch or worktree was created because the task explicitly required all work in the supplied worktree and prohibited checkout.

## Not fixed

- F10 stale comments in Electron, core, mcp-apps-page, and setup-wizard are outside the task's permitted file scope. The e2e `message-handlers-eager.spec.ts` comment is outside the B5b-changed files named for this round.
- F7 remains a source-text guard, now covering both relevant entry files. A full dependency graph assertion is outside this scoped spec fix.

## Verification

- `npx prettier --write` was run on every changed source file, with a second pass after the first changed formatting.
- `npm run verify -- -p @ptah-extension/harness-builder`: `NX   3 tasks: 3 succeeded` (exit 0).
- `npm run verify -- -t lint,typecheck -p ptah-electron-e2e,ptah-video-studio`: `NX   4 tasks: 3 succeeded, 1 failed` (exit 1). The sole failed task was the accepted `ptah-electron-e2e:lint`: four unchanged `fs.watch` errors in `src/specs/git-watcher.spec.ts` (lines 111, 169, 220, 273). All typechecks passed; no changed file had a lint error. The lint log is `/home/amun/.nx/8b7110c7390b9603/cache/terminalOutputs/13955349833412084634`.
- `npm run verify -- -t test -p ptah-extension-webview`: first run `NX   1 task: 0 succeeded, 1 failed` because the new route guard incorrectly required a setup-wizard import in `app.routes.ts`. After correcting that assertion, the same command returned `NX   1 task: 1 succeeded` (exit 0).
