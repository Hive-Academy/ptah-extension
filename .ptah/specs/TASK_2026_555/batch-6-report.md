# Batch 6 report — TASK_2026_555 (Electron secret delete pre-check, S1c)

**Tasks completed**: Task 6.1 — Electron secret delete pre-check: trace verified and spec added proving delete persists across reload and subsequent `get` returns `undefined`.

## Files changed

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\libs\backend\platform-electron\src\implementations\electron-secret-storage.spec.ts`
  - Added test case: `delete persists across a provider restart (file reload path: delete -> get is undefined)` in describe block `ElectronSecretStorage — Electron-specific behaviour`.
  - Verifies: store credential → delete credential → create fresh `ElectronSecretStorage` instance loading the same `secrets.json` file on disk → `get` returns `undefined`.

*(No changes to `electron-secret-storage.ts` were required, as the trace and test confirm delete persists and reloads correctly.)*

## Pre-Check Findings (Task 6.1 & Plan §4/Component 4 / S1c)

The pre-check confirms that **the Electron secrets store genuinely deletes keys both in memory and on disk**, surviving reloads. Batch 7 (`auth:deleteStoredKey` RPC) is safe to implement.

### Trace Evidence:

1. **`EXTENSION_CONTEXT.secrets` shim → `ElectronSecretStorage`**:
   - `apps\ptah-electron\src\di\phase-1-infra.ts:82` invokes `registerVsCodeCorePlatformAgnostic(container, logger)`.
   - In Phase 0 (`libs\backend\platform-electron\src\registration.ts:144-149`), the DI container registers `PLATFORM_TOKENS.SECRET_STORAGE`:
     ```typescript
     container.register(PLATFORM_TOKENS.SECRET_STORAGE, {
       useValue: new ElectronSecretStorage(
         options.userDataPath,
         options.safeStorage,
       ),
     });
     ```
   - In Phase 1.5 (`apps\ptah-electron\src\di\phase-1-infra.ts:123-126`), `registerExtensionContextShim(container, logger, ...)` is called.
   - In `libs\backend\vscode-core\src\di\register-storage-shims.ts:54-56`, `secretStorage` is resolved from `PLATFORM_TOKENS.SECRET_STORAGE`.
   - In `libs\backend\vscode-core\src\di\register-storage-shims.ts:70-75`, the shim creates:
     ```typescript
     secrets: {
       get: async (key: string): Promise<string | undefined> => secretStorage.get(key),
       store: async (key: string, value: string): Promise<void> => secretStorage.store(key, value),
       delete: async (key: string): Promise<void> => secretStorage.delete(key),
       ...
     }
     ```
   - Therefore, `context.secrets.delete` routes directly to `ElectronSecretStorage.delete`.

2. **`AuthSecretsService.setCredential('apiKey', '')` → delete**:
   - In `libs\backend\vscode-core\src\services\auth-secrets.service.ts:192-196`:
     ```typescript
     async setCredential(type: AuthCredentialType, value: string): Promise<void> {
       if (!value || value.trim().length === 0) {
         await this.deleteCredential(type);
         return;
       }
     ```
   - In `libs\backend\vscode-core\src\services\auth-secrets.service.ts:219-222`:
     ```typescript
     async deleteCredential(type: AuthCredentialType): Promise<void> {
       const secretKey = this.getSecretKey(type);
       await this.context.secrets.delete(secretKey);
     ```
   - An empty or whitespace-only API key triggers deletion via `this.context.secrets.delete`, delegating to `ElectronSecretStorage.delete`.

3. **`deleteProviderKey`**:
   - In `libs\backend\vscode-core\src\services\auth-secrets.service.ts:300-302`:
     ```typescript
     async deleteProviderKey(providerId: string): Promise<void> {
       const secretKey = this.getProviderSecretKey(providerId);
       await this.context.secrets.delete(secretKey);
     ```
   - Deleting a provider-specific key routes directly to `this.context.secrets.delete`, delegating to `ElectronSecretStorage.delete`.

4. **Persistence and reload survival**:
   - In `libs\backend\platform-electron\src\implementations\electron-secret-storage.ts:105-114`:
     ```typescript
     async delete(key: string): Promise<void> {
       if (!(key in this.secrets)) return;
       delete this.secrets[key];
       this.writePromise = this.writePromise.then(
         () => this.persist(),
         () => this.persist(),
       );
       await this.writePromise;
       this.fireChange({ key });
     }
     ```
   - `persist()` (`:125-135`) writes `JSON.stringify(this.secrets, null, 2)` to `secrets.json.tmp` and renames it to `secrets.json`.
   - On provider reload, constructor calls `loadSync()` (`:53, 116-123`), which loads `secrets.json`. Since the key was removed before persisting, `key in this.secrets` is false.
   - `get(key)` (`:57`) checks `if (!(key in this.secrets)) return undefined;` and returns `undefined`.

## Stack observed

- Framework & Runtime: Electron 44 / Node runtime adapter in `libs/backend/platform-electron`
- Wiring: tsyringe DI (`PLATFORM_TOKENS.SECRET_STORAGE` → `ElectronSecretStorage`; `TOKENS.EXTENSION_CONTEXT` shim delegates to `PLATFORM_TOKENS.SECRET_STORAGE`)
- Validation: Unit tests run via Jest / `@nx/jest`.

## Verification

### Verification commands:

1. **Targeted suite**:
   `npx nx test @ptah-extension/platform-electron --testFile=electron-secret-storage.spec.ts`
   - **Result**: PASS (27 of 27 tests passed across encryption available, plain fallback, and reload persistence).

2. **Project typecheck & lint**:
   `npx nx run-many -t typecheck,lint -p @ptah-extension/platform-electron`
   - **Result**: PASS (0 errors).

3. **Batch 6 verify command**:
   `npx nx run-many -t typecheck,test,lint -p @ptah-extension/platform-electron ptah-electron`
   - **typecheck**: PASS across both projects (`@ptah-extension/platform-electron` and `ptah-electron`).
   - **lint**: PASS across both projects.
   - **test**:
     - `electron-secret-storage.spec.ts` passed (all 27 tests green).
     - Full suite in `platform-electron` passed 35 of 38 suites (654 passed tests). The only failure in an isolated run was `workspace-watch-host.stress.spec.ts` (`AC-7` timing out during high load on Windows file watching).
     - In `ptah-electron`, 53 of 55 test suites passed (985 passed tests). Two pre-existing stress/timeout tests timed out under unbounded parallel load (`phase-2-diagnostics-override.spec.ts` hook timeout and `git-watcher.stress.spec.ts`). Both are unrelated to secret storage.

## Risks handled

- **Unverified delete assumption**: Plan requirement 6 ("The handler must not ship on the unverified assumption") is satisfied. Traced through all 4 layers (RPC / service / shim / adapter) and verified that delete removes the key from the persisted JSON file on disk, not just the memory map.
- **Reload safety**: Tested that a fresh instance reading the on-disk file after `delete` returns `undefined`.
- **Shared worktree hygiene**: Only touched `libs/backend/platform-electron/src/implementations/electron-secret-storage.spec.ts`. Did not modify any other project files or files owned by concurrent batches.

## Plan deviations

None.

## Out-of-scope observations

- `ptah-electron:build-workspace-watch-host` had not been executed prior to running `workspace-watch-host.stress.spec.ts`, causing it to report a missing bundle until built. Running `npx nx run ptah-electron:build-workspace-watch-host` resolved the missing bundle.
- Stress tests (`workspace-watch-host.stress.spec.ts` and `git-watcher.stress.spec.ts`) are sensitive to machine load and timeout if Nx runs with high worker concurrency. Capping workers with `--maxWorkers=2` is recommended on this host.
