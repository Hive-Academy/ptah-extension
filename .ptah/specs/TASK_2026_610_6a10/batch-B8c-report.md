# Batch B8c report — trusted host fact

Implemented the Electron-only trusted `TOKENS.HOST_KIND` registration.

## Files changed

- `libs/backend/vscode-core/src/di/tokens.ts`
  - Line 205: added `export type HostKind = 'vscode' | 'electron' | 'cli' | 'tui';`.
  - Line 290: added `HOST_KIND: Symbol.for('HostKind')` to `TOKENS`.
- `apps/ptah-electron/src/di/phase-1-infra.ts`
  - Line 92: registers `TOKENS.HOST_KIND` with `{ useValue: 'electron' }` in `registerPhase1Infra`.
- `apps/ptah-electron/src/di/container.smoke.spec.ts`
  - Line 67: imports `registerPhase1Infra`.
  - Lines 250–278: adds the phase-1 smoke case, which resolves `TOKENS.HOST_KIND` to `'electron'` after normal phase-1 setup.

## Barrel export

`@ptah-extension/vscode-core` exports `TOKENS` through `libs/backend/vscode-core/src/index.ts:1` as `export { TOKENS } from './di/tokens';`. It does not re-export `HostKind`; left unchanged as instructed.

## Verification

- `npx jest -c apps/ptah-electron/jest.config.ts apps/ptah-electron/src/di/container.smoke.spec.ts --runInBand` — passed: 1 suite, 19 tests, 0 snapshots.
- `npx tsc -p libs/backend/vscode-core/tsconfig.lib.json --noEmit` — passed (exit code 0; no compiler output).
- Scoped editor diagnostics were unavailable because its TypeScript check remained in progress beyond 45 seconds; the required direct TypeScript check passed.

## Deviations

None. No VS Code, CLI, or TUI registration was added. The registration uses the file's existing `{ useValue: ... }` style; importing `HostKind` from the public barrel was not possible because that barrel intentionally exports only `TOKENS` from `tokens.ts`.
