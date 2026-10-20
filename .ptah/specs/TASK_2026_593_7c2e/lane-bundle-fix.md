# Bundle fix lane

## Changes

- `libs/frontend/mcp-apps-page/src/lib/services/apps-focus-target.ts`: added a root injectable that reads a registered session ID source without importing the Apps page or session service.
- `libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.ts`: registers its existing `sessionId` computed with the focus target during construction.
- `libs/frontend/mcp-apps-page/src/lib/services/apps-focus-router.service.ts`: reads the lightweight target instead of injecting `AppsSessionService`; navigation behavior is unchanged.
- `libs/frontend/mcp-apps-page/src/lib/services/apps-focus-router.service.spec.ts`: stubs the target and covers matching, mismatching, null, empty, landed and cancelled navigation, plus target registration.
- `libs/frontend/mcp-apps-page/src/focus.ts`: added the narrow focus entry exporting the router, provider and target.
- `libs/frontend/mcp-apps-page/src/index.ts`: removed focus router and provider exports from the page entry.
- `tsconfig.base.json`: mapped `@ptah-extension/mcp-apps-page/focus` to the narrow entry.
- `apps/ptah-extension-webview/src/app/app.config.ts`: imports the provider from the narrow entry.
- `libs/frontend/git-ui/src/services.ts`: exports `provideGitStatusAttention` from the existing eager services entry.
- `libs/frontend/git-ui/src/index.ts`: removes the provider export from the root entry, which also exports the lazy review shell.
- `apps/ptah-extension-webview/src/app/app.config.ts`: also imports the git attention provider from `@ptah-extension/git-ui/services`.
- `eslint.config.mjs`: permits the narrow `@ptah-extension/mcp-apps-page/focus` entry as a static import while the page entry remains lazy.

## Item 8 findings

- `setup-wizard` was already statically imported and its route was eager on `origin/main`.
- `harness-builder/services` was already statically imported on `origin/main`; the harness builder view itself remains lazy.
- `git-ui` root was newly statically imported for `provideGitStatusAttention`. On `origin/main`, production imports of the root entry are dynamic in the Electron shell and chat services. The root barrel also exports `ReviewShellComponent`. With expanded scope, I moved the provider export to the existing services entry and changed the app config import to that entry. AST inspection confirmed the provider imports only Angular, core, `GitStatusService`, and the status label helper. `GitStatusService` imports Angular, core, and shared types; the label helper imports only a shared type. None imports a component. `git grep` found no other consumer importing the provider from the root barrel, so its root export was removed.
- `NOTICE_ACTION_HANDLER` is an existing core token. The new registration uses `VoiceProviderErrorService`, which was already statically imported and registered as a message handler on `origin/main`.

## Checks run

- Focused Jest: 1 suite passed, 4 tests passed, 0 failed.
- ESLint across changed TypeScript source: 1 error, 3 warnings. The error is `@nx/enforce-module-boundaries` on the new narrow `mcp-apps-page/focus` import. The existing rule has `checkDynamicDependenciesExceptions` for other narrow entries including `harness-builder/services`, but root `eslint.config.mjs` is outside this lane's allowed files. I reported the needed narrow exception to the spawning session.
- ESLint on the changed mcp-apps-page files: 0 errors, 3 pre-existing accessibility warnings in `apps-focus-router.service.ts`.
- ESLint on the three files changed for the git-ui follow-up: 1 error, 0 warnings. The sole error remains the separate mcp-apps-page/focus narrow-entry exception in `app.config.ts`; the git-ui change added no lint findings.
- Final ESLint on all changed TypeScript files and `eslint.config.mjs`: 0 errors, 3 pre-existing accessibility warnings in `apps-focus-router.service.ts`. No `git-ui/services` exception was needed; ESLint reported no boundary error for it.
- `git diff --check`: passed.
- `ptah_get_diagnostics` after edits: unavailable; TypeScript compiler check remained running past its 45-second service limit, including a later single-file retry. No typecheck result is claimed.
- `ptah_get_diagnostics` after the git-ui edit: unavailable again after the same 45-second service limit.
- `ptah_get_diagnostics` after the ESLint config edit: unavailable again after the same 45-second service limit.
- No build, Nx target, serve or e2e command was run, as required.

## Decisions

- **Session lookup bridge:** use a callback held by a tiny injectable. Options were a callback or a signal reference; the callback directly accepts the existing `sessionId` computed and avoids additional imports or state. Reversible.
- **Secondary entry configuration:** add only the TypeScript path and entry file. The existing `harness-builder/services` entry has no additional project, ESLint, or Jest mapper configuration. Reversible.
- **Git-ui entry:** move the provider to the existing eager services entry and remove the unused root export. Options were to leave both exports or remove the root export; `git grep` showed no remaining root consumer, and the task calls for removal in that case. Reversible.
- **Nx boundary exception:** with explicit scope authorization, add only `@ptah-extension/mcp-apps-page/focus` next to the existing narrow entries. Options were also to add `git-ui/services`; the changed-file ESLint run had no git-ui boundary error, so that extra exception was unnecessary. Reversible.

## Not done

- Initial bundle size measurement; builds were expressly prohibited.

## Review fix

- Added one test in `apps-session.service.spec.ts` using its existing TestBed setup. It checks that `AppsFocusTarget` reflects `AppsSessionService.sessionId()` at creation and after the existing mock resolves `session-1`.
- Focused Jest: 1 suite passed, 41 tests passed, 0 failed. ESLint on the changed spec: passed with 0 errors and 0 warnings.
