# Phase E round 6 fix report

## Files changed

- `libs/frontend/command-center/src/lib/model/session-coordinator.ts` — block sends from a marked tab bound to a stale workspace.
- `libs/frontend/command-center/src/lib/model/session-coordinator.spec.ts` — cover stale and matching workspaces for all three send entry points.
- `libs/frontend/command-center/src/lib/components/command-center-workspace-binding.ts` — report open rejections and keep coordinator reads out of the workspace effect's dependencies.
- `libs/frontend/command-center/src/lib/components/command-center-workspace-binding.spec.ts` — cover rejected opens from the effect and `canSend`, plus recovery after a later workspace change.
- `libs/frontend/command-center/src/lib/components/command-center-page.controller.spec.ts` — cover two successful terminal states without a session ID.

## Guard before and after

Before, `send` used the marked tab without checking its workspace, allowing Status and Tribunal launch turns to reach an old workspace session. After, a marked tab with `store.workspace() !== tabs.activeWorkspacePath` returns `false` before calling the sender or changing session status, and shows the fixed switching toast. A send with no marked tab still opens first.

## Catch handlers before and after

Before, the effect and `canSend` discarded `open()` rejections, leaving a possible `starting` status without a toast. After, both set status to `error` and show `Could not open the Command Center session.` with error tone. The effect invokes `open()` inside `untracked`; the in-flight marker cleanup chain is unchanged.

## Tests added

- Stale `send`, `sendStatusTurn`, and `sendLaunchTurn` each return `false`, leave status unchanged, skip the sender, and show the switching toast; matching workspaces send normally.
- Open rejection from the effect or `canSend` sets error status and the fixed toast; a later workspace change opens again after the rejected open clears.
- A root tab going from streaming to loaded with no `claudeSessionId` reaches idle without a toast when `hasLiveSession` is `true` or `undefined`.

## Verification

`npx jest -c libs/frontend/command-center/jest.config.ts libs/frontend/command-center/src/lib/model/session-coordinator.spec.ts libs/frontend/command-center/src/lib/components/command-center-workspace-binding.spec.ts libs/frontend/command-center/src/lib/components/command-center-page.controller.spec.ts --coverage=false --maxWorkers=2` (output filtered to last 40 lines): **Test Suites: 3 passed, 3 total; Tests: 78 passed, 78 total.** `git diff --check` found no whitespace errors in the changed code.

## Decisions

- Kept the binding's `canSend` check so it continues to start a rebind; the coordinator now independently prevents every send entry point from using a stale marked tab.
- Preserved the existing in-flight cleanup chain. The caller catches now report rejected opens through fixed text.

## Anything not done

- No work outside the requested S-1, M-4, M-1, m-2, and controller test gap. Other review findings remain outside this bounded fix.
- Pre-existing unrelated changes in `batches.md`, `future-enhancements.md`, and `HANDOFF.md` were not modified or reverted.
