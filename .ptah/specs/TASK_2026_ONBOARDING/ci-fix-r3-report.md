# CI fix round 3

## Changed lines

- `apps/ptah-electron-e2e/src/specs/onboarding/onboarding.spec.ts:34`: assert `ptah-orchestra-canvas` is visible after entering Chat.
- `apps/ptah-electron-e2e/src/specs/onboarding/onboarding.spec.ts:43`: assert the same canvas is visible after returning to Chat.

## Verification

Ran `npm run verify -- -t lint,typecheck -p ptah-electron-e2e`.

`NX 2 tasks: 1 succeeded, 1 failed` — typecheck succeeded. Lint failed only on four accepted, pre-existing `no-restricted-syntax` errors in `src/specs/git-watcher.spec.ts` at lines 111, 169, 220, and 273. No lint errors were reported for the changed spec.

Live Electron e2e was not rerun in this lane, as requested.
