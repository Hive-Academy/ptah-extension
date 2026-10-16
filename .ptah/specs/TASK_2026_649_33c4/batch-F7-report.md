# Summary

Raised the webview initial bundle error budget to 3.75 MB and addressed both PR #736 Electron e2e failures. The reload failure was an app regression; the question visibility failure was spec drift.

# Root cause per failure

- **Initial bundle budget:** `apps/ptah-extension-webview/project.json:61` capped the initial bundle at 3.7 MB; CI exceeded it by 5.61 kB. The requested 3.75 MB cap now covers that increase.
- **Reload restoration — app regression:** `libs/frontend/core/src/lib/routing/surface-route-persistence.ts:88` saves the settled route through `VSCodeService.setState`. `apps/ptah-electron/src/preload.ts:29-32` reads synchronously but writes through async IPC. `apps/ptah-electron/src/ipc/ipc-bridge.ts:551-566` previously read only committed storage, while `libs/backend/platform-electron/src/implementations/electron-state-storage.ts:139-165` waits for the worker before its cache reflects an update. `apps/ptah-electron-e2e/src/support/ui-driver.ts:199-205` reloads immediately; the CI snapshot shows Chat selected after reload. The bridge now serves the latest pending state for the active workspace until its write settles. The renderer snapshot in `vscode.service.ts` remains workspace scoped.
- **Foreign question visibility — spec drift:** `libs/frontend/chat-routing/src/lib/stream-router.service.ts:496-521,666-680` resolves an explicit question `tabId` to its bound tab. The spec asserted that the workflow panel had no card, then switched to Chat at `apps/ptah-electron-e2e/src/specs/harness/new-project-question-routing.spec.ts:241-249` without selecting the foreign tab. The CI snapshot shows New Project still in focus, so its transcript was rendered. The spec now selects the foreign rail card before asserting its question card is visible.

# Changes

- `apps/ptah-extension-webview/project.json`: changed only the initial `maximumError` value.
- `apps/ptah-electron/src/ipc/ipc-bridge.ts`: added a workspace scoped pending state read for synchronous `get-state` during async persistence.
- `apps/ptah-electron/src/ipc/ipc-bridge.state.spec.ts`: tests pending route visibility and workspace isolation.
- `apps/ptah-electron-e2e/src/specs/harness/new-project-question-routing.spec.ts`: selects the foreign tab before the existing question assertion.

# Checks run

- `npx nx typecheck ptah-electron --parallel=1` — passed (Nx Cloud reported a disabled organization after local success).
- `$env:NX_NO_CLOUD='true'; npx nx typecheck ptah-electron-e2e --parallel=1` — passed.
- `$env:NX_NO_CLOUD='true'; npx nx typecheck ptah-extension-webview --parallel=1` — passed.
- `$env:NX_NO_CLOUD='true'; npx nx lint ptah-electron --parallel=1` — passed, 18 warnings.
- `$env:NX_NO_CLOUD='true'; npx nx lint ptah-electron-e2e --parallel=1` — passed, 17 warnings.
- `$env:NX_NO_CLOUD='true'; npx nx lint ptah-extension-webview --parallel=1` — passed.
- `npx jest -c apps/ptah-electron/jest.config.ts apps/ptah-electron/src/ipc/ipc-bridge.state.spec.ts --coverage=false --maxWorkers=2` — passed, 2 tests.
- `git diff --check` — passed.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Raise budget to 3.75 MB | Raise cap or reduce bundle | Explicit user decision; CI overage was 5.61 kB | Yes, one JSON value |
| Serve pending state in main IPC bridge | Main pending state, worker cache changes, or spec wait | `get-state` is synchronous and reload occurs before async worker completion; changing the bridge avoids a worker cache contract change | Yes, isolated bridge logic |
| Select foreign tab in spec | Change question router or select its tab | Router targets explicit `tabId`; CI snapshot has New Project focused after Chat navigation | Yes, one spec interaction |

# Not done

- Did not run build, serve, dev, e2e, package, or workspace wide checks, per task constraints. The CI e2e cases were not rerun locally.
- Did not alter pre-existing `tsconfig.base.json` changes or the untracked HANDOFF/NEXT-SESSION-PROMPT files; they were present before this work.
- Did not commit, push, stash, reset, restore, checkout, or clean.
