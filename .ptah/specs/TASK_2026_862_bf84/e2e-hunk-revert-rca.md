# Electron hunk revert E2E: Settings behind the dialog

## Root cause

The failure is a navigation race, not a failed Git operation or a missing canvas component. The failure snapshot (`e2e-hunk-revert-error-context.md:46-51,101-104`) shows the Git review and confirmation dialog with **Settings** as the main view and an installed Codex 0.165.0 row. The canvas-heading assertion, now at `apps/ptah-electron-e2e/src/specs/git/hunk-revert-top-layer.spec.ts:203`, therefore could not find the canvas heading in the failing run.

Evidence chain:

1. Each test gets a fresh temporary home, repository, and Electron app; `real-rpc-fixtures.ts:233-272` launches and closes the app per test. An earlier spec cannot leave Settings open in this instance.
2. `AppShellComponent` starts `loadAuthStatus()` when Chat first becomes active (`libs/frontend/chat/src/lib/components/templates/app-shell.component.ts:275-287`). When that asynchronous read finishes, it calls `setCurrentView('settings')` if the view is still Chat and `hasAnyAuth()` is false (`:288-303`). `AuthStateService.hasAnyAuth` counts authenticated Codex, not merely an installed executable (`libs/frontend/core/src/lib/services/auth-state.service.ts:449-468`). The snapshot's Ready Codex row is thus compatible with the no-auth redirect.
3. `showCanvas()` switches to Chat and returns as soon as the empty-board heading is visible (`apps/ptah-electron-e2e/src/support/show-canvas.ts:29-41`). Its retry covers a redirect that has *already* landed; it cannot prevent a later auth response from switching the view while `openRevertDialog()` runs. `ui.goto('canvas')` also checks the canvas grid at one point in time (`ui-driver.ts:356-375`).
4. This branch registers the Codex lane on Linux; its `detect()` resolves the selected executable (`codex-app-server-lane.adapter.ts:156-164`, `apps/ptah-electron/src/di/codex-lane-composition.ts:154-160`). Selection scans installed paths and runs `codex --version` with a 7-second per-probe timeout, then checks the bundle (`libs/backend/codex-runtime/src/lib/select-codex-executable.ts:8-9,64-115,184-194,228-244`). `agent:getConfig` awaits CLI detection (`libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:476-483`); detection previously awaited all adapters serially (`cli-detection.service.ts:169-213`). This explains the observed `agent:getConfig` startup timeout risk and a longer overlap window for the auth redirect. The auth-status handler itself runs its independent probes in parallel (`auth-status-cache.ts:197-204`), so the source does **not** prove Codex selection directly delayed `auth:getAuthStatus`.

Other Settings entry points found were explicit UI actions or links (`app-shell.component.ts:312-313`, `chat-view.component.ts:343-350`, `provider-account-card.component.ts:229`, `mcp-server-status.service.ts:160`). The spec performs none of those actions. The no-auth startup redirect is the supported path.

## Fix

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts:169-213`: start adapter detections together with `Promise.all`, preserving registration order and per-adapter error reporting. This removes the new Codex probe from the serial critical path of `agent:getConfig` and `agent:detectClis` without changing their result shape.
- `apps/ptah-electron-e2e/src/specs/git/hunk-revert-top-layer.spec.ts:190-198`: after opening the native confirmation dialog, send the app's existing `switchView` event for Chat. This restores the canvas *under the already-open dialog* if startup auth routed to Settings in the meantime. The following heading, geometry, hit-testing, unforced Cancel click, and unchanged Git tree assertions retain the spec's collision intent.

## Unit specs added

`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.spec.ts:234-254` holds the Codex detection promise pending and verifies every peer adapter has already started. It then resolves Codex and checks the original row order.

## Verification

- `ptah_get_diagnostics` scoped to the three edited TypeScript files: **0 errors** after the final edits.
- `npx tsc -p libs/backend/cli-agent-runtime/tsconfig.lib.json --noEmit`: exit 0, no `error TS` lines.
- `npx tsc -p libs/backend/cli-agent-runtime/tsconfig.spec.json --noEmit`: exit 0, no `error TS` lines.
- `npx tsc -p apps/ptah-electron-e2e/tsconfig.spec.json --noEmit`: exit 0, no `error TS` lines.
- Jest and Electron E2E were not run, as prohibited by the task.

## Decisions

- **Concurrent adapter detection** over skipping Codex or adding another cache: `agent:getConfig` requires the installed CLI inventory, and the service already preserves one in-flight promise and a completed cache. Concurrent independent probes preserve the contract. Reversible.
- **Restore Chat after dialog open** over changing the no-auth product redirect: the redirect is intentional onboarding behavior; this spec needs the canvas behind a modal even with an unconfigured isolated home. Reversible.

## Confidence

**Medium.** The snapshot and source establish the Settings redirect and the test's timing gap, and TypeScript checks pass. The exact CI timing and whether parallel detection eliminates the observed `agent:getConfig` timeout remain unverified because Jest and Electron E2E cannot run here.
