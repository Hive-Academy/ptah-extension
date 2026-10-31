# FIX_PLUGIN_SESSION_ROOT batch 1 fix report

## Changes

- `libs/backend/agent-sdk/src/lib/helpers/plugin-config-home.ts:342`: `viewFor(root, readOnly)` returns the same governing value while suppressing its one-time import when read-only. Both `get` and `keys` use the flag; normal views retain import behavior (`:510`, `:521`).
- `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:983`: `storageFor` passes the flag only when it creates a home view; plain workspace storage still supplies its normal `get`. `getSessionPluginNotice` calls `readWorkspaceLayer(layer, true, true)` at `:1067`, preserving the missing-storage error. Other reads still use the default import behavior (`:1181`).

## Other callers checked

- `storageFor`: `hasWorkspaceState` (`:1020`), `getWorkspacePluginConfig` (`:1156`), `readWorkspaceLayer` (`:1186`), and `saveWorkspacePluginConfig` (`:1375`). Only the notice call passes read-only.
- `readWorkspaceLayer`: `getEffectivePluginConfig` local and ancestors (`:1283`, `:1289`), `getDisabledSkillIds` (`:1566`), and `resolveCurrentPluginPaths` (`:1835`). Their calls are unchanged.
- A repository-wide `rg` search found `viewFor` only in `storageFor` and direct `plugin-config-home.spec.ts` calls. The view's `get` is used by loader config and layer reads and existing direct view specs. `ptah_lsp_references` did not return, so `rg` was the fallback.

## Specs

- `plugin-loader.service.session-notice.spec.ts:136`: `reads an importable legacy layer without writing its home record` checks the legacy override, no home storage write, and absent record after the queue flush.
- `plugin-config-home.spec.ts:216`: `a read-only view returns legacy config without import while a normal get imports it` checks both view modes, including `keys`.
- Existing `plugin-loader.service.spec.ts:1893` test `sole legacy config in a sub-folder, empty home: the read returns it and the record is imported once (idempotent)` already checks the normal loader read and one-time import.

## Verification

- `git diff --check`: passed.
- Scoped `ptah_get_diagnostics`: unavailable while its TypeScript check ran past 45 seconds.
- `npm run verify -- -t test,lint,typecheck -p agent-sdk | tail -40`: passed, exit code 0. Output: `NX   3 tasks: 3 succeeded`; `@ptah-extension/agent-sdk:test 4m 39s`; `[verify 2026-10-31T16:53:32.129Z] lock released after 327.3s, exit code 0`.

## Decisions

- Used an optional read-only flag on the existing home view so `IStateStorage` and normal callers keep their contracts.
- No callable skill discovery mechanism was exposed to this Codex lane for this backend task.
