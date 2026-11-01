# Batch 8q-2b report

## Changes

- `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts:74,395`: require a workspace-specific saved permission reader and use it when the caller supplies no explicit level.
- `apps/ptah-electron/src/di/codex-runtime-composition.ts:26,494`: bind that reader through `resolveSavedCodexPermissionLevel` and `scopeResolver.readForPath(name, workspacePath, true)`; invalid saved levels raise `CodexSessionSettingsError('invalid-settings')`.
- `libs/backend/rpc-handlers/src/index.ts:152`: export the existing pure permission helper for the Electron composition root.
- `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-native-contract.spec.ts:409` and `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.native.spec.ts:209`: supply the required reader in existing test callers. Search found no VS Code or CLI composition caller.

## Specs added

- `uses the saved $mode permission level` (Manual, Auto edit, Plan, Yolo): `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.spec.ts:226`.
- `lets an explicit permission level win without reading the saved level`: `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.spec.ts:233`.
- `reads the saved permission level when resuming without an explicit level`: `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.spec.ts:240`.
- `binds the saved Codex permission reader to the profile workspace`: `apps/ptah-electron/src/di/codex-runtime-composition.spec.ts:405`.
- `maps a resume after the saved permission level changes to CODEX_RUNTIME_FAILED`: `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.spec.ts:24`. The spec exercises `autoResumeIfInactive` and checks the exported `CODEX_RESUME_PROFILE_CHANGED_MESSAGE`.

## Decisions

- **Permission source:** Chose a required host reader over embedding the saved-level rule in the profile. The settings record already uses `resolveSavedCodexPermissionLevel`; the Electron reader calls the same helper over the same scoped keys. Reversible by replacing the reader binding.
- **Explicit override:** Chose `config.permissionLevel ?? savedLevel`, preserving an explicit caller level and avoiding a saved-settings read. The host spec asserts the reader is not called. Reversible by changing the profile selection expression.
- **Other callers:** Added fixed `ask` readers only to test fixtures, preserving their existing behavior. Search found only Electron production composition and these fixtures. Reversible by updating those fixtures with workspace-specific readers.

## Not done

- No verification, tests, builds, lint, Nx, npm, TypeScript checks, or diagnostics ran, as required by the implementation lane.
- No production change to `chat-session.service.ts` was needed.
