# Code Logic Review — TASK_2026_538 Batch C (Composition Roots)

Commit under review: `24f189166821b6e0bdf6a6f92f4125a92970f61d`
Scope: Runtime composition roots (`apps/ptah-extension-vscode/src/activation/bootstrap.ts`, `apps/ptah-electron/src/activation/bootstrap.ts`, `libs/backend/cli-engine/src/lib/bootstrap/with-engine.ts`), wrapper `runCursorApiKeyMigration` (`libs/backend/rpc-handlers/src/lib/migrations/run-cursor-api-key-migration.ts`), and associated test suites.

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 9/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 0        |
| Minor observations  | 2        |
| Failure modes found | 0        |

The implementation in commit `24f189166` cleanly integrates `runCursorApiKeyMigration` across all three composition roots (VS Code, Electron, and CLI engine). Dependency resolution ordering is correct, secrets storage is ready before migration runs, no components access the Cursor key prior to migration, error handling never throws or leaks secret material, and mode gating in the CLI appropriately protects against unintended executions.

---

## Verdict

PASS — All three runtime composition roots sequence the migration after file-settings migrations, dependencies are resolvable at call sites, failure handling never throws or leaks secrets, and test coverage validates startup behavior.

---

## Findings

none

*(Minor observations recorded below under Moderate and minor issues.)*

---

## Checks run

1. **Ordering & Dependency Resolution**:
   - **VS Code** (`apps/ptah-extension-vscode/src/activation/bootstrap.ts:109`):
     - `DIContainer.setup(context)` executes at line 91, registering `PLATFORM_TOKENS.WORKSPACE_PROVIDER` and `TOKENS.LOGGER` (Phase 0) and `TOKENS.AUTH_SECRETS_SERVICE` via `registerVsCodeCoreServices` (Phase 1).
     - `registerVscodeSettings` runs at line 104, establishing file-settings registrations before `runCursorApiKeyMigration` executes at line 109.
     - Readers (`registerRpcSurface` at line 157, `agentDiscovery`/`commandDiscovery` at lines 167-168, `agentAdapter.initialize()` at line 174) execute strictly after line 109.
   - **Electron** (`apps/ptah-electron/src/activation/bootstrap.ts:218`):
     - `ElectronDIContainer.setup(platformOptions)` executes at line 197, registering `PLATFORM_TOKENS.WORKSPACE_PROVIDER`, `TOKENS.LOGGER` (Phase 0), and `TOKENS.AUTH_SECRETS_SERVICE` via `registerVsCodeCorePlatformAgnostic` (Phase 1).
     - `registerElectronSettings(container)` runs at line 213, followed by `migrationRunner.runMigrations()` at line 217, before `runCursorApiKeyMigration` at line 218.
     - Readers (`startAgentAdapterInitialization` at line 375, `ipcBridge` at line 322) execute strictly after line 218.
   - **CLI** (`libs/backend/cli-engine/src/lib/bootstrap/with-engine.ts:321`):
     - `CliDIContainer.setup(options)` executes at line 270, registering `PLATFORM_TOKENS.WORKSPACE_PROVIDER` (Phase 0), `TOKENS.LOGGER` and `TOKENS.AUTH_SECRETS_SERVICE` (Phase 1), and `registerCliSettings` (Phase 3.5).
     - `withEngine` awaits `workspaceReady` (line 287), executes `migrationRunner.runMigrations()` (line 293), and then runs `runCursorApiKeyMigration` (line 321) prior to `ctx.initializeSdk()` (line 328) and the user command callback `fn(ctx)`.

2. **Failure Handling & Secret Redaction**:
   - `runCursorApiKeyMigration` (`libs/backend/rpc-handlers/src/lib/migrations/run-cursor-api-key-migration.ts:22-43`):
     - Safely resolves `TOKENS.LOGGER`, `PLATFORM_TOKENS.WORKSPACE_PROVIDER`, and `TOKENS.AUTH_SECRETS_SERVICE` inside a `try/catch` block.
     - If `TOKENS.LOGGER` fails to resolve, `logger` remains `undefined`, and `logger?.warn` optional chaining prevents re-throwing.
     - If secret store operations or dependency resolution fail, it catches `error: unknown` and logs only `{ errorType: error instanceof Error ? error.name : typeof error }`. `error.message` is completely omitted, ensuring no credential fragments from store rejections can leak into log files or console streams.
     - When migrations succeed, the logger output is limited to static string constants (`'[CursorApiKeyMigration] plain setting migrated'` or `'cleared'`).

3. **CLI Bootstrap Mode Analysis**:
   - Codebase audit confirmed that zero production CLI commands use `mode: 'minimal'`. All commands in `apps/ptah-cli` (`doctor`, `interact`, `mcp-serve`, `provider`, `proxy`, `harness-doctor`, `cron`, `gateway`, `memory`, `skill-synthesis`) and `apps/ptah-tui` (`main.tsx:129`) run with `mode: 'full'`.
   - In `mode: 'minimal'`, RPC handlers (including `AgentRpcHandlers` and `agent:getConfig`) are never registered (`container.ts:772-803`). No command booted with `mode: 'minimal'` can report `cursorApiKeyConfigured` or spawn a Cursor lane. Gating `runCursorApiKeyMigration` behind `if (opts.mode === 'full')` is correct and matches `migrateLegacyAuthMethod` beside it.

4. **Automated Verification Suites**:
   - `npx nx test @ptah-extension/rpc-handlers --testPathPatterns=run-cursor-api-key-migration --skip-nx-cache`:
     - 4/4 passed (verifies secret migration, idempotency on subsequent boots, retention of plain key on secret store error, and clean resolution on container failure).
   - `npx nx test @ptah-extension/cli-engine --testPathPatterns=with-engine --skip-nx-cache`:
     - 44/44 passed (verifies full-mode execution and minimal-mode exclusion of `runCursorApiKeyMigration`).
   - `npx nx test ptah-extension-vscode --testPathPatterns=bootstrap.cursor-key --skip-nx-cache`:
     - 1/1 passed (verifies source ordering: `cursor > migrations`).
   - `apps/ptah-electron/src/activation/bootstrap.cursor-key.spec.ts`:
     - Validated by inspection against `apps/ptah-electron/src/activation/bootstrap.ts` (verifies source ordering: `cursor > migrations`).

---

## Lane-introduced constraints

none

---

## Five logic questions

### 1. How does this fail silently?
There is no silent failure. If the secret store rejects the key during migration, the failure is caught, logged with `errorType` (without exposing the value), the plain-text setting is preserved in `settings.json`, and the migration is scheduled for retry on the next application startup (`run-cursor-api-key-migration.ts:38-41`). When migration succeeds, an informational log entry (`[CursorApiKeyMigration] plain setting migrated` or `cleared`) is emitted (`run-cursor-api-key-migration.ts:34`).

### 2. What user action produces unexpected behaviour?
None during startup. A potential edge case noted in Batch A review (user invoking `agent:setConfig` concurrently while the startup migration was in-flight) cannot occur in practice during startup because `runCursorApiKeyMigration` completes and is awaited prior to RPC surface registration (`registerRpcSurface`) in VS Code (`bootstrap.ts:109,157`), Electron (`bootstrap.ts:218,322`), and CLI (`with-engine.ts:321,328`).

### 3. What input data produces a wrong answer?
None. `migrateCursorApiKeyToSecrets` treats missing or non-string values as `'none'` without write operations. If a secret already exists in `AuthSecretsService`, it leaves the secret intact and deletes the legacy plain setting.

### 4. What happens when a dependency fails?
- If `TOKENS.LOGGER` resolution fails: `logger` is undefined, `logger?.warn` safely evaluates to undefined, and the promise resolves cleanly without uncaught exceptions (`run-cursor-api-key-migration.ts:26,38`).
- If `PLATFORM_TOKENS.WORKSPACE_PROVIDER` or `TOKENS.AUTH_SECRETS_SERVICE` resolution fails: caught by the wrapper, a non-fatal warning is logged, and the plain setting remains intact for retry on the next boot (`run-cursor-api-key-migration.ts:36-42`).
- If `migrationRunner.runMigrations()` throws in VS Code or Electron: caught by the outer `catch (settingsError)` block, logging a non-fatal warning; `runCursorApiKeyMigration` is skipped for that launch and will run on the next boot once the underlying settings issue is resolved.

### 5. What is missing that the requirements never mentioned?
The requirements did not specify how CLI test suites or minimal-mode containers should handle provider secret migrations. The author appropriately gated the CLI run on `opts.mode === 'full'`, matching `migrateLegacyAuthMethod` and avoiding unnecessary DI resolution overhead during lightweight minimal-mode tests.

---

## Failure modes

None found. The implementation adheres strictly to the non-throwing, idempotent startup migration contract.

---

## Blocking issues

none

---

## Serious issues

none

---

## Moderate and minor issues

1. **[MINOR] Asymmetric error scoping between desktop hosts and CLI**:
   - Files: `apps/ptah-extension-vscode/src/activation/bootstrap.ts:108-109`, `apps/ptah-electron/src/activation/bootstrap.ts:217-218`, vs `libs/backend/cli-engine/src/lib/bootstrap/with-engine.ts:288-322`
   - Context: In `with-engine.ts`, `migrationRunner.runMigrations()` has its own isolated `try/catch` block, so even if schema migrations throw, `runCursorApiKeyMigration` is still attempted. In VS Code and Electron, `runCursorApiKeyMigration` shares the `try` block with `migrationRunner.runMigrations()`. If `runMigrations()` throws, the Cursor migration is skipped for that session.
   - Impact: Minimal. If `runMigrations()` fails, the settings store is likely in an invalid or corrupted state where reading or writing `provider.cursor.apiKey` would fail anyway. Skipping it and retrying on next boot is safe and non-fatal.

2. **[MINOR] CLI test suite tests mode gating rather than relative call order**:
   - Files: `libs/backend/cli-engine/src/lib/bootstrap/with-engine.spec.ts:181-197`
   - Context: In VS Code and Electron, `bootstrap.cursor-key.spec.ts` uses source inspection to verify that `runCursorApiKeyMigration` is positioned strictly after `runMigrations()`. `with-engine.spec.ts` verifies that `runCursorApiKeyMigration` is called in `full` mode and omitted in `minimal` mode, but does not assert relative invocation ordering against `migrationRunner.runMigrations()`.
   - Impact: Minimal. In `with-engine.ts:288-322`, `runCursorApiKeyMigration` is directly sequenced after `runMigrations()`.

---

## Data flow

1. **Bootstrap Phase**: Runtime bootstrap initializes DI container (`DIContainer.setup` / `ElectronDIContainer.setup` / `CliDIContainer.setup`). OK.
2. **Settings Registration**: `registerVscodeSettings` / `registerElectronSettings` / `registerCliSettings` wire file-backed store. OK.
3. **Settings Schema Migrations**: `migrationRunner.runMigrations()` runs legacy schema transformations. OK.
4. **Cursor Key Migration**: `runCursorApiKeyMigration(container)` resolves dependencies, reads legacy plain key, moves to `AuthSecretsService` (if not already set), and deletes plain key from `settings.json`. OK.
5. **Runtime Surface Initialization**: RPC handlers, autocomplete discovery, and agent adapters initialize. OK.

---

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| VS Code bootstrap startup migration | COMPLETE | None. Sequenced after settings migrations at `apps/ptah-extension-vscode/src/activation/bootstrap.ts:109`. |
| Electron bootstrap startup migration | COMPLETE | None. Sequenced after settings migrations at `apps/ptah-electron/src/activation/bootstrap.ts:218`. |
| CLI bootstrap startup migration | COMPLETE | None. Sequenced after settings migrations at `libs/backend/cli-engine/src/lib/bootstrap/with-engine.ts:321`. |
| Idempotency across reboots | COMPLETE | None. Runs every boot; no-op if key is absent or already migrated. |
| Never log secret values | COMPLETE | None. Static strings and `error.name` only; verified by test assertions. |
| Never throw during startup | COMPLETE | None. Comprehensive `try/catch` with safe optional chaining on logger fallback. |

---

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Missing logger in container | YES | `logger?.warn` optional chaining prevents crash | None |
| Secret store throws on write | YES | Caught, warning logged without error message, plain key retained for retry | None |
| Secret already exists in store | YES | Preserves secret, deletes legacy plain key | None |
| Corrupt or non-string setting | YES | Returned as `'none'` without throwing | Plain invalid residue remains (noted in Batch A) |
| Minimal mode CLI invocation | YES | Migration skipped to keep minimal mode lightweight | None (minimal mode cannot access Cursor) |
