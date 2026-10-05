# BF3 — Host-kind DI token relocation

## Outcome

`HOST_KIND` and `HostKind` now belong to the platform-agnostic `platform-core`
contract. The Electron host registers the shared token before
`registerVsCodeCorePlatformAgnostic`, and the agent SDK consumes only the
platform-core contract.

## Files changed

- `libs/backend/platform-core/src/di/tokens.ts:50` — added
  `PLATFORM_TOKENS.HOST_KIND: Symbol.for('HostKind')`.
- `libs/backend/platform-core/src/types/platform.types.ts:148` — added
  `HostKind = 'vscode' | 'electron' | 'cli' | 'tui'`.
- `libs/backend/platform-core/src/index.ts:12` — exported `HostKind` from the
  public barrel.
- `libs/backend/vscode-core/src/di/tokens.ts:205` — removed the former
  `HostKind` declaration and `TOKENS.HOST_KIND` entry.
- `libs/backend/vscode-core/src/index.ts:1` — removed the former `HostKind`
  re-export.
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:18,958`
  — imports `PLATFORM_TOKENS`/`HostKind` from platform-core and optionally
  injects `PLATFORM_TOKENS.HOST_KIND`.
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ptah-ui-hint.spec.ts:4`
  — imports `HostKind` from platform-core; its existing seven-row truth table
  remains intact.
- `apps/ptah-electron/src/di/phase-1-infra.ts:92` — registers the shared token
  as `'electron'` before platform-agnostic VS Code-core registration.
- `apps/ptah-electron/src/di/container.smoke.spec.ts:276` — resolves the shared
  token in the Electron smoke assertion.

`platform-core` has no token-uniqueness or token-list spec (search returned no
matching spec), so no token spec update applied.

## Residual grep

Command:

```powershell
rg -n 'HOST_KIND|\bHostKind\b' libs/backend/vscode-core
```

Observed result: no matches (`rg` exit 1). The remaining references are limited
to platform-core, agent-sdk, and Electron's registration/smoke test.

## Formatting and verification

All nine changed TypeScript files were formatted with:

```powershell
npx prettier --write <all nine changed files>
```

Requested verification completed successfully:

```powershell
npx nx run-many -t typecheck,test,lint -p @ptah-extension/platform-core,@ptah-extension/vscode-core,@ptah-extension/agent-sdk,ptah-electron --parallel=1
```

Observed counts: **18 successful tasks**, **0/18 cache hits**, duration
**10m 40s**. This includes all three targets for each requested project plus six
dependency tasks. `@ptah-extension/agent-sdk:test` passed, which includes the
seven-row `sdk-query-options-builder.ptah-ui-hint.spec.ts` truth table.

The scoped editor diagnostic request did not return a result within its 45-second
availability window; the completed Nx typecheck target above is the verification
result. Nx also reported its organization-level Cloud 401 as non-fatal after the
successful local run.
