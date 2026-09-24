## Changes

Paths below are relative to `D:/projects/ptah-extension/.claude-worktrees/cursor-key-secrets`.

- MODIFIED `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:131` — injects the existing `IAuthSecretsService` token; `:200` awaits secret/env key status; `:274` validates the key before writes; `:319` stores/deletes the trimmed secret before clearing the plain setting; `:394` suppresses credential-bearing storage error details; `:1049` no longer reads the plain key.
- MODIFIED `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.set-config.spec.ts:167` — preserves the #581 field-names-only regression and adds secret write/delete, error, validation, and status-read tests.
- MODIFIED `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.list-rows.spec.ts` — supplies the new constructor dependency.
- MODIFIED `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.resume-parent-session.spec.ts` — supplies the new constructor dependency.
- CREATED `libs/backend/rpc-handlers/src/lib/migrations/cursor-api-key-migration.ts:5` — exports the idempotent migration, preserves existing secrets, propagates secret-store failures before removing the plain value, and logs only outcome words.
- CREATED `libs/backend/rpc-handlers/src/lib/migrations/cursor-api-key-migration.spec.ts:41` — tests migration, clearing, absent/blank values, idempotency, storage failure, and safe logging.
- MODIFIED `libs/backend/rpc-handlers/src/index.ts:102` — exports the migration for the orchestrator's bootstrap wiring.
- MODIFIED `libs/shared/src/lib/types/rpc/rpc-agents.types.ts:106` and `:194` — documentation now names the secrets-store entry `ptah.auth.provider.cursor`.
- CREATED `.ptah/specs/TASK_2026_538/batch-a-report.md` — this report.

Stack observed: Node 24 (`.nvmrc:1`), TypeScript 6.0.3 (`package-lock.json:37399`), tsyringe 4.10.0 (`package-lock.json:37247`), Zod 4.6.5 (`package-lock.json:39267`). This is the shared host RPC layer, not NestJS. Existing injection precedents are `mcp-directory-rpc.handlers.ts:186` and `provider-rpc.handlers.ts:108`; shared registration is `libs/backend/vscode-core/src/di/register-platform-agnostic.ts:150`. The RPC handler's existing boundary uses explicit guards for setConfig and Zod for resume; this change adds a string guard for the touched credential boundary. Migration reads unknown configuration and narrows it before trimming. Imports stay on existing library barrels under the extension/shared boundary rules (`eslint.config.mjs:222`, `:260`, `:365`). No new module or registration.

## Write-path trace

1. `agent:setConfig { cursorApiKey: nonblank }` -> `authSecrets.setProviderKey('cursor', trimmed)` -> `ptah.auth.provider.cursor` -> `AuthSecretsService.context.secrets.store` (`libs/backend/vscode-core/src/services/auth-secrets.service.ts:279`). Only after the awaited secret write succeeds, `workspace.setConfiguration('ptah', 'provider.cursor.apiKey', undefined)` removes the legacy JSON value. Detection cache invalidation remains after successful removal.
2. `agent:setConfig { cursorApiKey: '' }` (also whitespace-only) -> `authSecrets.deleteProviderKey('cursor')` -> `ptah.auth.provider.cursor` -> `context.secrets.delete`; then the same plain-setting removal. No credential value reaches settings writes.
3. Startup migration -> `workspace.getConfiguration('ptah', 'provider.cursor.apiKey')`. Blank/absent -> `none`, no writes. Present and no secret -> `setProviderKey('cursor', trimmed)` -> awaited secret persistence -> plain-setting removal -> `migrated`. Present with a secret -> leave the secret untouched -> plain-setting removal -> `cleared`. Secret-write exceptions propagate before the plain write, leaving the plain value available for retry. Second successful invocation -> `none`.
4. Plain removal -> `setConfiguration('ptah', 'provider.cursor.apiKey', undefined)` -> all adapters' `PtahFileSettingsManager.set` -> unflatten -> JSON serialization -> atomic replacement of `~/.ptah/settings.json`. The leaf is omitted, not replaced with the credential or an empty credential string.

Secret stores: VS Code delegates to the native `SecretStorage` (`libs/backend/platform-vscode/src/implementations/vscode-secret-storage.ts:33`, `:37`). Electron uses `ElectronSecretStorage`, backed by `secrets.json` and Electron safeStorage (`libs/backend/platform-electron/src/implementations/electron-secret-storage.ts:49`, `:87`); its existing no-encryption fallback writes a `plain:` marker. CLI uses `CliSecretStorage` and `secrets.enc` with AES-256-GCM (`libs/backend/platform-cli/src/implementations/cli-secret-storage.ts:61`, `:78`, `:88`). The non-VS-Code extension-context shim delegates get/store/delete to the platform secret store (`libs/backend/vscode-core/src/di/register-storage-shims.ts:54`, `:69`). This lane changes neither encryption policy nor store implementation.

Cursor-specific readers found by repository text search:

- `agent:getConfig` -> awaited `isCursorApiKeyConfigured` (`agent-rpc.handlers.ts:200`, `:1049`) -> nonblank `CURSOR_API_KEY`, otherwise `hasProviderKey('cursor')`. Only the boolean is returned.
- Migration -> legacy setting (`cursor-api-key-migration.ts:10`) and `hasProviderKey('cursor')` (`:18`).
- `AuthSecretsService.hasProviderKey` -> `getProviderKey` -> secret store (`auth-secrets.service.ts:316`, `:263`).
- Existing Batch B reader, unchanged here: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cursor-cli.adapter.ts:174` (`resolveCursorApiKey`) reads env then nested `provider.cursor.apiKey` from the plain file. Its callers are detection (`:215`), authentication status (`:236`), model listing (`:263`), and execution (`:312`). Batch B must replace this reader before the feature is complete across runtimes. `file-settings-keys.ts:175` and `:472` retain the registration/default for migration.

Generic provider-key consumers also found (they accept other/provider-selected IDs rather than naming Cursor): provider profile/auth resolution (`workspace-provider-profile-resolver.ts:253`, `api-key.strategy.ts:356`/`:557`, `provider-auth-resolver.ts:251`, `provider-proxy-pool.ts:174`, `draft-verification.service.ts:531`, `custom-openai-translation-proxy.ts:145`); provider RPC/model and auth status (`provider-rpc.handlers.ts:482`/`:839`, `auth-rpc.handlers.ts:756`/`:762`/`:1289`/`:1339`, `llm-rpc-app.handlers.ts:310`); chat/MCP callbacks (`chat-session.service.ts:282`/`:312`, `mcp-directory-rpc.handlers.ts:221`/`:270`). Other direct consumers explicitly use their own provider/slot IDs (Sakana, OpenRouter, OpenCode, Ollama Cloud, Ptah CLI, Smithery and MCP OAuth), not this Cursor entry.

## Plain-setting removal evidence

- VS Code: `libs/backend/platform-vscode/src/implementations/vscode-workspace-provider.ts:95`–`:101` routes registered ptah file keys directly to `fileSettings.set(key, value)`.
- Electron: `libs/backend/platform-electron/src/implementations/electron-workspace-provider.ts:212`–`:218` uses the same route.
- CLI: `libs/backend/platform-cli/src/implementations/cli-workspace-provider.ts:104`–`:110` uses the same route.
- Shared registration: `libs/backend/platform-core/src/file-settings-keys.ts:175` includes `provider.cursor.apiKey`.
- Shared store: `libs/backend/platform-core/src/file-settings-manager.ts:97`–`:103` assigns undefined and awaits persistence; `:548`–`:568` unflattens the leaf without converting it; `:482`–`:496` serializes with `JSON.stringify` (which omits undefined object properties), writes a temporary file, and renames it. In-memory reads treat undefined as absent (`:87`).
- Existing limitation, outside ownership: `file-settings-manager.ts:497`–`:503` catches and suppresses persistence errors. Therefore a disk failure can leave an old plain copy despite a resolved setConfiguration promise; this lane cannot guarantee deletion under that existing failure mode. No adapter/store files were changed.

## Tests

Updated `agent-rpc.handlers.set-config.spec.ts`:

- `never writes a credential value to the log` — preserves exact `fields: ['cursorApiKey']` assertion from #581; now asserts settings do not contain the key.
- `stores the trimmed key only in secrets and removes the plain copy`.
- `deletes the secret and plain copy for %p` — empty and whitespace-only values.
- `rejects non-string keys before any write`.
- `keeps the plain copy and hides credential-bearing storage errors`.
- `reports false with nothing configured and ignores the legacy plain setting`.
- `reports true from the secret`.
- `reports true from a non-blank environment key without reading secrets`.
- `treats a blank environment key as absent`.

New `cursor-api-key-migration.spec.ts`:

- `migrates a trimmed plain key and removes the plain setting after storing`.
- `clears the plain setting without overwriting an existing secret`.
- `returns none without writes for %p` — empty, whitespace, null, non-string.
- `returns none for an absent setting`.
- `is idempotent with an initial secret of %p` — missing and existing secret.
- `keeps the plain setting and rethrows when storing the secret fails`.
- `logs outcome words only, never the key (existing secret: %p)` — missing and existing secret.

## Verification

Requested command launched once, scoped to the exact names from the two project.json files:

`npx nx run-many -t test lint typecheck -p @ptah-extension/rpc-handlers @ptah-extension/shared --skip-nx-cache`

PowerShell captures the output, preserves the exit code, and prints matching header/result/error lines plus the last 40 lines (the equivalent of the requested filtered/tail output).

Result: verification remains unresolved at the tool-budget checkpoint. The command has not returned any output yet because the PowerShell capture is still awaiting completion. Neither the required “Running targets ... for 2 projects” header nor result lines have been observed, so no test/lint/typecheck pass is claimed. The requested project names were confirmed from their project.json files. The invoking workflow must collect the outstanding command result (execution session 33167) before accepting this batch. Tests were authored but their success is not established.

`ptah_get_diagnostics` was called with all eight changed source/spec paths: reported **Unavailable — TypeScript check still running after 45s**, not a pass. No workspace-wide command was issued. No app bootstrap or cli-agent-runtime file was edited.

## Lane-introduced constraints

none

## git status

`git status --short` was not run: the higher-priority backend-developer role explicitly says “You do not run git.” No Git commands were executed. The caller must collect this requested status. All changes remain uncommitted.
