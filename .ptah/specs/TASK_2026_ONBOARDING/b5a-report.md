# B5a implementation report

## Files

The pre-existing `HANDOFF.md` modification and untracked screenshots were left untouched. Changed files:

- `.ptah/specs/TASK_2026_ONBOARDING/b5a-report.md`
- `apps/ptah-electron/src/services/electron-setup-wizard.service.spec.ts`
- `apps/ptah-electron/src/services/electron-setup-wizard.service.ts`
- `apps/ptah-extension-vscode/src/services/webview-html-generator.initial-view.spec.ts`
- `apps/ptah-extension-webview/src/app/app.config.ts`
- `apps/ptah-extension-webview/src/app/initial-navigation.ts`
- `apps/ptah-extension-webview/src/app/webview-routing.spec.ts`
- `libs/backend/agent-generation/src/lib/services/wizard/webview-lifecycle.service.ts`
- `libs/frontend/chat-ui/src/lib/services/generation-workflow-launcher.service.spec.ts`
- `libs/frontend/chat-ui/src/lib/services/generation-workflow-launcher.service.ts`
- `libs/frontend/chat/src/lib/components/molecules/global-config-actions.component.spec.ts`
- `libs/frontend/chat/src/lib/components/molecules/global-config-actions.component.ts`
- `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`
- `libs/frontend/chat/src/lib/components/templates/electron-shell.config-gate.spec.ts`
- `libs/frontend/chat/src/lib/services/chat-attention-host-message-handler.service.spec.ts`
- `libs/frontend/chat/src/lib/services/chat-attention-host-message-handler.service.ts`
- `libs/frontend/chat/src/lib/settings/settings.component.html`
- `libs/frontend/chat/src/lib/settings/settings.component.spec.ts`
- `libs/frontend/chat/src/lib/settings/settings.component.ts`
- `libs/frontend/core/src/index.ts`
- `libs/frontend/core/src/lib/routing/index.ts`
- `libs/frontend/core/src/lib/routing/surface-route-persistence.spec.ts`
- `libs/frontend/core/src/lib/routing/surface-route-persistence.ts`
- `libs/frontend/core/src/lib/routing/surface-router.service.spec.ts`
- `libs/frontend/core/src/lib/routing/surface-router.service.ts`
- `libs/frontend/core/src/lib/routing/surface-routes.ts`
- `libs/frontend/core/src/lib/services/app-state.service.spec.ts`
- `libs/frontend/core/src/lib/services/app-state.service.ts`
- `libs/frontend/core/src/lib/tokens/surface-focus-router.token.ts`
- `libs/frontend/harness-builder/src/lib/services/harness-workflow-request.service.spec.ts`
- `libs/frontend/harness-builder/src/lib/services/harness-workflow-request.service.ts`
- `libs/frontend/onboarding/src/lib/focus/onboarding-focus-router.provider.ts`
- `libs/frontend/onboarding/src/lib/focus/onboarding-focus-router.service.ts`
- `libs/frontend/onboarding/src/lib/focus/onboarding-focus-router.service.spec.ts`
- `libs/frontend/onboarding/src/lib/home/onboarding-home.component.spec.ts`
- `libs/frontend/onboarding/src/lib/home/onboarding-home.component.ts`
- `libs/frontend/onboarding/src/lib/home/onboarding-resume.store.spec.ts`
- `libs/frontend/onboarding/src/lib/home/onboarding-resume.store.ts`
- `libs/frontend/onboarding/src/services.ts`
- `libs/shared/src/lib/types/webview-surface.types.spec.ts`
- `libs/shared/src/lib/types/webview-surface.types.ts`

## Acceptance evidence

| Acceptance item                                                               | Implementation file:line                                                                | Covering spec test name                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Legacy `SWITCH_VIEW` and `initialView` land on Home                           | `app-state.service.ts:642`, `webview-surface.types.ts:104`                              | `routes legacy SWITCH_VIEW %s to onboarding Home`; `lands a legacy %s initialView on onboarding Home`                                                                                                                         |
| Saved legacy routes land on Home                                              | `surface-router.service.ts:232`, `initial-navigation.ts:109`                            | `restores legacy route %s to onboarding Home`; `restores legacy %s to onboarding Home`                                                                                                                                        |
| Host accepts legacy ids                                                       | `webview-surface.types.ts:127`                                                          | `accepts %s, which the old six-entry list rejected`; `accepts every route id plus every legacy alias as an initialView`                                                                                                       |
| Setup menu and Electron Setup button open onboarding                          | `global-config-actions.component.ts:85`, `electron-shell.component.ts:304`              | global config actions Setup test; Electron shell config gate Setup test                                                                                                                                                       |
| Settings rows navigate correctly, Electron gated                              | `settings.component.html:237`, `app-state.service.ts:1166`                              | `opens onboarding Home from Advanced in Electron=%s`; `opens the Claude Code readiness step and obeys the view-switch guard`                                                                                                  |
| Generation and harness focus retains tab identity                             | `onboarding-focus-router.service.ts:18`, `surface-focus-router.token.ts:11`             | `focuses %s on its owning step with tab identity`; `matches legacy %s surfaceKind to onboarding focus`                                                                                                                        |
| Launcher uses `?tab=`; harness workflow opens workspace step                  | `generation-workflow-launcher.service.ts:79`, `harness-workflow-request.service.ts:260` | generation launcher target spec; harness workflow request target spec                                                                                                                                                         |
| Home resumes bounded pair, bound tabs and harness records                     | `onboarding-resume.store.ts:29`, `onboarding-home.component.ts:110`                     | `shows the latest analysis and generation checkpoint pair with a bound tab`; `limits bound tabs and harness records to one item per workflow or mode`; `places resume banners after the Claude banner and opens their target` |
| Old focus router implementations still typecheck; only onboarding is provided | `surface-focus-router.token.ts:4`, `app.config.ts:352`                                  | scoped typecheck targets in Verification                                                                                                                                                                                      |

## Decisions

| Decision                                                                                                                                  | Options                            | Evidence                                                                                                   | Reversible                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Map any saved legacy child URL to `/onboarding`, and drop legacy subpaths passed to `navigateToSurface`.                                  | Preserve child path; open Home     | B5a acceptance names Home for all legacy saved routes; the old child shapes differ from onboarding routes. | Yes, through the two normalization functions. |
| Use the existing generation target helper for focus, so agent generation lands at Analyze → Choose agents and guidance lands at Guidance. | Force Generate step; use helper    | `onboarding-routes.ts` documents that Choose agents forwards to Generate when a run exists.                | Yes.                                          |
| Keep the `setup-hub` test selector while changing its label and target.                                                                   | Rename selector; preserve selector | B5a acceptance explicitly preserves `config-menu-item-setup-hub`.                                          | Yes.                                          |

| Keep the required “Setup” label even though `electron-shell.apps-tab.spec.ts` still asserts “Setup hub”; leave that out-of-scope spec for B5b. | Change label back; edit out-of-scope spec | B5a acceptance explicitly requires “Setup”, while the plan permits editing only `electron-shell.config-gate.spec.ts`. | Yes, by updating the stale spec in its owning batch. |

## Proposed Removals

Old setup-wizard, setup-hub, and harness-builder route/components and their focus router classes remain for B5b. No removal in B5a.

## Host compatibility

Electron's setup command and the agent-generation webview literal now select `onboarding`. VS Code's existing host allow-list still accepts the three old ids; its named spec has explicit coverage for all three. No VS Code or TUI feature flow was added. Shared ids remain accepted for their wire compatibility. No TUI code changed.

## Verification

Commands run under the repository verify lock, with a 45-minute timeout for each verify. Nx summaries will be recorded below when each command exits.

1. `npm run verify -- -p @ptah-extension/shared,@ptah-extension/core,@ptah-extension/chat-ui,@ptah-extension/chat,@ptah-extension/onboarding,@ptah-extension/harness-builder,@ptah-extension/setup-wizard,@ptah-extension/agent-generation,ptah-extension-webview` — first run: `NX   27 tasks: 23 succeeded, 4 failed`; failed `core:test`, `chat:test`, `ptah-extension-webview:test`, and the accepted `ptah-extension-webview:lint`. The test failures were inspected; scoped corrections are in place for core/webview, and the chat app-tab expectation conflicts with the required Setup label. A rerun is pending.
2. `npm run verify -- -t lint,typecheck -p @ptah-extension/mcp-apps-page,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,ptah-electron-e2e` — queued behind the machine-wide verify lock.
3. `npm run verify -- -t test -p ptah-electron -- --testPathPatterns=electron-setup-wizard.service` — pending.
4. `npm run verify -- -t test -p ptah-extension-vscode -- --testPathPatterns=webview-html-generator.initial-view` — pending.

`npx prettier --write` was run over every changed implementation and spec file; it will be run again on this finished report.

## Outstanding

Visual Electron review was not run because this task explicitly forbids launching the app; source and unit/type checks cannot establish visual quality. The known `ptah-extension-webview:lint` circular dependency in `app.routes.ts` ↔ `@ptah-extension/command-center` is accepted by the task and was not changed. `electron-shell.apps-tab.spec.ts` is outside the B5a edit list and still asserts the retired “Setup hub” label; the required UI label is “Setup”, so `chat:test` cannot fully pass within the authorized file list. A provider settings test also exceeded its 5-second Jest timeout during the loaded run; no B5a code touched that test or component.
