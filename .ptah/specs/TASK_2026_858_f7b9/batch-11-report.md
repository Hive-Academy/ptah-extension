# Batch 11 report — Task 11.1

## Files changed

- `libs/backend/platform-electron/src/registration.ts`
- `libs/backend/platform-cli/src/registration.ts`
- `apps/ptah-electron/src/di/surface-composition.spec.ts`
- `libs/backend/cli-engine/src/lib/container-driver-lock.spec.ts` (new)

## Acceptance

- Electron binds `SESSION_DRIVER_LOCK` to a host-owned `KernelSessionDriverLock`, or `NullSessionDriverLock` on darwin: `libs/backend/platform-electron/src/registration.ts:115`.
- CLI binds the same platform-specific lock for cli-engine, worker host, and mcp-bench composition: `libs/backend/platform-cli/src/registration.ts:69`.
- A container with vscode-core platform-agnostic registration and no host binding fails to resolve the lock: `libs/backend/cli-engine/src/lib/container-driver-lock.spec.ts:20`.
- Electron smoke spec asserts the bound class and stable instance: `apps/ptah-electron/src/di/surface-composition.spec.ts:68`.
- CLI engine smoke spec asserts the bound class and stable instance: `libs/backend/cli-engine/src/lib/container-driver-lock.spec.ts:38`.

## Tests added

- Added one Electron host binding smoke test and two CLI engine smoke tests (unbound resolution and host binding).

## Verification

- Ran the required filtered command once: `npm run verify -- -p @ptah-extension/platform-electron,@ptah-extension/platform-cli,@ptah-extension/cli-engine,ptah-electron,mcp-bench`.
- Blocked before tests, lint, or typechecks by Nx daemon socket `connect EPERM` under `/tmp/.nx`; Nx also could not create its plugin worker socket. No retry per task instruction. The orchestrator must run verification.
- `ptah_get_diagnostics` on changed files, then the new spec, timed out with TypeScript checks still running. No diagnostic result available.
- No other files changed by this lane; pre-existing changes were not inspected or reverted.

## Decisions

- Registered one `useValue` lock instance per host, matching neighboring platform bindings. Options: `useClass` or `useValue`; the latter gives the host a stable lock instance and matches adjacent registrations. Evidence: existing registration patterns and lock implementation's in-memory held entries. Reversible: yes.
- Used `NullSessionDriverLock` only on darwin and `KernelSessionDriverLock` elsewhere, as prescribed by Batch 11 and C4a. Reversible: yes.
- Kept vscode-core without a default binding; the smoke spec exercises its platform-agnostic registration on an otherwise unbound container. Reversible: yes.
