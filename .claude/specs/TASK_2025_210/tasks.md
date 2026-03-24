# Development Tasks - TASK_2025_210

**Total Tasks**: 14 | **Batches**: 4 | **Status**: 4/4 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- ISecretStorage interface: Verified methods `get(key)`, `store(key, value)`, `delete(key)` at `platform-core/src/interfaces/secret-storage.interface.ts:9-33`
- IWorkspaceProvider interface: Verified `getConfiguration(section, key, defaultValue?)` at `platform-core/src/interfaces/workspace-provider.interface.ts:34-38`
- PLATFORM_TOKENS: Verified SECRET_STORAGE, WORKSPACE_PROVIDER at `platform-core/src/tokens.ts:22-25`
- LicenseCommands pattern: Verified `registerCommands(context)` at `license-commands.ts:219-243`
- Electron RPC handler pattern: Verified `register()` method at `rpc-method-registration.service.ts:98-111`
- SessionImporterService.scanAndImport default limit=5: Verified at `session-importer.service.ts:52`
- Session importer called with limit=5 in VS Code main.ts: Verified at `main.ts:670`
- No existing session import in Electron: Verified (grep found zero matches in ptah-electron)

### Risks Identified

| Risk                                                                                                               | Severity | Mitigation                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------- |
| IWorkspaceProvider.getConfiguration takes (section, key) not wildcards -- cannot export all ptah.\* config at once | MED      | Export service must enumerate known config keys explicitly; developer should check ConfigManager for key list |
| SettingsCommands needs DI container for SettingsExportService but LicenseCommands is instantiated outside DI       | LOW      | Register settings commands after DI container is ready (same pattern as session import at main.ts:665-670)    |
| Provider key enumeration may be incomplete -- only openrouter, moonshot, z-ai mentioned                            | LOW      | Define known provider IDs as a constant array; gracefully skip missing keys                                   |

### Edge Cases to Handle

- [ ] Export with no credentials set (all optional) -> Should produce valid JSON with empty/missing fields
- [ ] Import file with unknown schema version -> Must reject with clear error
- [ ] Import when credentials already exist -> Skip by default, never overwrite
- [ ] Import with malformed JSON -> Graceful error, not crash
- [ ] Session directory does not exist -> Already handled by existing SessionImporterService
- [ ] Electron app opened with no workspace path -> Skip session import gracefully

---

## Batch 1: Types + Shared Services (Foundation) -- COMPLETE (Commit: d0e302fe)

**Developer**: backend-developer
**Tasks**: 6 | **Dependencies**: None

### Task 1.1: Create Settings Export Types -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\types\settings-export.types.ts`
**Spec Reference**: implementation-plan.md:69-98, 178-186
**Action**: CREATE

**Quality Requirements**:

- PtahSettingsExport interface with version=1 schema, exportedAt, source, licenseKey, auth, config
- SettingsImportResult interface with imported[], skipped[], errors[] arrays
- Export known provider IDs as a constant array (KNOWN_PROVIDER_IDS)
- Export known secret keys as constants (SECRET_KEYS) for reuse
- Schema version number as a constant (SETTINGS_EXPORT_VERSION = 1)

**Implementation Details**:

- Define `PtahSettingsExport` interface: `{ version: 1; exportedAt: string; source: 'vscode' | 'electron'; licenseKey?: string; auth: { oauthToken?: string; apiKey?: string; providerKeys?: Record<string, string>; }; config: Record<string, unknown>; }`
- Define `SettingsImportResult` interface: `{ imported: string[]; skipped: string[]; errors: string[]; }`
- Define `KNOWN_PROVIDER_IDS = ['openrouter', 'moonshot', 'z-ai'] as const`
- Define `SETTINGS_EXPORT_VERSION = 1`
- Define secret key constants for all known keys (ptah.licenseKey, ptah.auth.claudeOAuthToken, ptah.auth.anthropicApiKey, ptah.auth.provider.{id})

---

### Task 1.2: Create SettingsExportService -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\settings-export.service.ts`
**Spec Reference**: implementation-plan.md:104-152
**Pattern to Follow**: `session-importer.service.ts:34-40` (injectable with platform-agnostic deps)
**Action**: CREATE

**Quality Requirements**:

- Platform-agnostic: uses ISecretStorage and IWorkspaceProvider via PLATFORM_TOKENS
- NEVER log actual secret values (only key names and has/missing boolean)
- Return null/undefined for missing keys, never fail on partial data
- Schema version field mandatory

**Implementation Details**:

- Injectable service with `@inject(PLATFORM_TOKENS.SECRET_STORAGE)` for ISecretStorage
- Injectable with `@inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)` for IWorkspaceProvider
- Injectable with `@inject(TOKENS.LOGGER)` for Logger
- Method: `async collectSettings(source: 'vscode' | 'electron'): Promise<PtahSettingsExport>`
- Collect all secret keys using ISecretStorage.get() for each known key
- Collect config keys using IWorkspaceProvider.getConfiguration('ptah', key) for known keys
- Use constants from settings-export.types.ts for key enumeration
- Known config keys to export: defaultProvider, defaultModel, authMethod, reasoningEffort (enumerate from ConfigManager usage in codebase)

**Validation Notes**:

- IWorkspaceProvider.getConfiguration takes (section, key) not wildcards -- enumerate known keys

---

### Task 1.3: Create SettingsImportService -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\settings-import.service.ts`
**Spec Reference**: implementation-plan.md:155-201
**Pattern to Follow**: `session-importer.service.ts:34-40` (injectable with platform-agnostic deps)
**Action**: CREATE

**Quality Requirements**:

- Validate schema version before importing (reject unknown versions)
- NEVER log imported secret values
- Graceful failure: if one key fails, continue with others
- Never overwrite existing credentials unless explicitly requested (overwrite param default=false)
- Return detailed SettingsImportResult summary

**Implementation Details**:

- Injectable service with same deps as SettingsExportService
- Method: `async importSettings(data: PtahSettingsExport, options?: { overwrite?: boolean }): Promise<SettingsImportResult>`
- Step 1: Validate version field (must equal SETTINGS_EXPORT_VERSION)
- Step 2: For each secret key in data, check if exists via ISecretStorage.get()
  - If exists and !overwrite -> add to skipped[]
  - If not exists or overwrite -> store via ISecretStorage.store(), add to imported[]
  - On error -> add to errors[], continue
- Step 3: Store config values similarly (config keys are non-sensitive, can overwrite)
- Handle: licenseKey, auth.oauthToken, auth.apiKey, auth.providerKeys (iterate), config entries

---

### Task 1.4: Add DI Tokens for Settings Services -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\tokens.ts`
**Spec Reference**: implementation-plan.md:149, 199
**Action**: MODIFY

**Implementation Details**:

- Add `SDK_SETTINGS_EXPORT: Symbol.for('SdkSettingsExport')` to SDK_TOKENS
- Add `SDK_SETTINGS_IMPORT: Symbol.for('SdkSettingsImport')` to SDK_TOKENS
- Place after the existing SDK_SKILL_JUNCTION entry, with a comment: `/** Settings Export/Import Services (TASK_2025_210) */`

---

### Task 1.5: Register Settings Services in DI Container -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\register.ts`
**Spec Reference**: implementation-plan.md:150, 200
**Pattern to Follow**: `register.ts:104-108` (SessionImporterService registration pattern)
**Action**: MODIFY

**Implementation Details**:

- Import `SettingsExportService` from `'../settings-export.service'`
- Import `SettingsImportService` from `'../settings-import.service'`
- Register both as singletons using SDK_TOKENS.SDK_SETTINGS_EXPORT and SDK_TOKENS.SDK_SETTINGS_IMPORT
- Place registration after Skill Junction Service block, with section header comment

---

### Task 1.6: Export New Types and Services from agent-sdk barrel -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\index.ts`
**Spec Reference**: implementation-plan.md:151, 201
**Action**: MODIFY

**Implementation Details**:

- Add export section for Settings Export/Import (TASK_2025_210) after the Slash Command Interceptor section
- Export: `SettingsExportService` from `'./lib/settings-export.service'`
- Export: `SettingsImportService` from `'./lib/settings-import.service'`
- Export types: `PtahSettingsExport`, `SettingsImportResult`, `KNOWN_PROVIDER_IDS`, `SETTINGS_EXPORT_VERSION` from `'./lib/types/settings-export.types'`

---

**Batch 1 Verification**:

- All 3 new files exist at paths
- All 3 modified files have correct additions
- Build passes: `npx nx build agent-sdk`
- code-logic-reviewer approved
- No TODO/STUB/PLACEHOLDER comments

---

## Batch 2: VS Code Export/Import Commands -- COMPLETE (Commit: 8f097809)

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batch 1

### Task 2.1: Create SettingsCommands class -- COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\commands\settings-commands.ts`
**Spec Reference**: implementation-plan.md:205-261
**Pattern to Follow**: `license-commands.ts:36-243` (injectable command class)
**Action**: CREATE

**Quality Requirements**:

- Security warning MUST be shown before export proceeds (vscode.window.showWarningMessage with Yes/Cancel)
- Default filename: `ptah-settings-export.json` (no timestamp, simple)
- JSON is pretty-printed (2-space indent for human readability)
- Post-import: warn user to delete the export file prominently
- Post-import: offer to reload window

**Implementation Details**:

- Injectable class using `@inject(SDK_TOKENS.SDK_SETTINGS_EXPORT)` for SettingsExportService
- Injectable using `@inject(SDK_TOKENS.SDK_SETTINGS_IMPORT)` for SettingsImportService
- Method: `registerCommands(context: vscode.ExtensionContext): void`
  - Register `ptah.exportSettings` command
  - Register `ptah.importSettings` command
- Export flow:
  1. Show warning: "This will export your API keys and tokens in PLAINTEXT to a JSON file. Only share this file on trusted devices. Continue?"
  2. If user cancels -> return
  3. Call SettingsExportService.collectSettings('vscode')
  4. Show save dialog with defaultUri `ptah-settings-export.json`, filter \*.json
  5. Write JSON file using `vscode.workspace.fs.writeFile`
  6. Show success message with count of exported items
- Import flow:
  1. Show open dialog, filter \*.json
  2. Read file using `vscode.workspace.fs.readFile`
  3. Parse JSON, validate structure
  4. Call SettingsImportService.importSettings(data)
  5. Show summary: "Imported X items, skipped Y, errors: Z"
  6. Show warning: "Please delete the export file as it contains plaintext secrets"
  7. Offer "Reload Window" action

---

### Task 2.2: Register SettingsCommands in VS Code main.ts -- COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\main.ts`
**Spec Reference**: implementation-plan.md:429
**Action**: MODIFY

**Implementation Details**:

- Import `SettingsCommands` from `'./commands/settings-commands'`
- Import `SDK_TOKENS` (already imported at line 21)
- After DI container is fully set up (near session import block around line 660-682), resolve SettingsCommands:
  ```
  const settingsCommands = new SettingsCommands(
    DIContainer.getContainer().resolve(SDK_TOKENS.SDK_SETTINGS_EXPORT),
    DIContainer.getContainer().resolve(SDK_TOKENS.SDK_SETTINGS_IMPORT)
  );
  settingsCommands.registerCommands(context);
  ```
- Or resolve from container if SettingsCommands is registered in DI

**Validation Notes**:

- Must be placed AFTER DI container setup is complete (after Step 7)
- Follow the pattern at main.ts:665-682 for resolving from DI container

---

### Task 2.3: Add command contributions to package.json -- COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\package.json`
**Spec Reference**: implementation-plan.md:239, 261
**Action**: MODIFY

**Implementation Details**:

- Add to `contributes.commands` array:
  ```json
  { "command": "ptah.exportSettings", "title": "Export Settings", "category": "Ptah", "icon": "$(export)" }
  { "command": "ptah.importSettings", "title": "Import Settings", "category": "Ptah", "icon": "$(import)" }
  ```

---

**Batch 2 Verification**:

- New file exists: settings-commands.ts
- main.ts correctly instantiates and registers commands
- package.json has both new command contributions
- Build passes: `npx nx build ptah-extension-vscode`
- code-logic-reviewer approved

---

## Batch 3: Electron Import RPC Handler -- COMPLETE (Commit: 74bba993)

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batch 1

### Task 3.1: Create Electron Settings RPC Handlers -- COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\electron-settings-rpc.handlers.ts`
**Spec Reference**: implementation-plan.md:265-296
**Pattern to Follow**: `electron-config-extended-rpc.handlers.ts:24-59` (injectable RPC handler)
**Action**: CREATE

**Quality Requirements**:

- Use Electron native file dialog (not IPC to webview)
- Return structured SettingsImportResult for webview display
- Handle dialog cancellation gracefully

**Implementation Details**:

- Injectable class: `ElectronSettingsRpcHandlers`
- Dependencies: `@inject(TOKENS.LOGGER) Logger`, `@inject(TOKENS.RPC_HANDLER) RpcHandler`, `@inject(SDK_TOKENS.SDK_SETTINGS_IMPORT) SettingsImportService`, `@inject(SDK_TOKENS.SDK_SETTINGS_EXPORT) SettingsExportService`
- Method: `register(): void`
- Register `settings:import` RPC method:
  1. Use Electron `dialog.showOpenDialog` (import from 'electron') with filter `*.json`
  2. If cancelled -> return `{ cancelled: true }`
  3. Read file with `fs.promises.readFile`
  4. Parse JSON, validate
  5. Call SettingsImportService.importSettings(data)
  6. Return SettingsImportResult
- Register `settings:export` RPC method:
  1. Call SettingsExportService.collectSettings('electron')
  2. Use Electron `dialog.showSaveDialog` with default filename
  3. Write file with `fs.promises.writeFile`
  4. Return success status

**Validation Notes**:

- Electron dialog API is available in main process (verified import at main.ts:4)
- Note: The plan specifies file at `apps/ptah-electron/src/services/rpc/settings-rpc.handlers.ts` but the handler convention uses `handlers/` subdirectory -- use `handlers/electron-settings-rpc.handlers.ts` for consistency

---

### Task 3.2: Register Settings RPC Handlers in Electron Orchestrator -- COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\rpc-method-registration.service.ts`
**Spec Reference**: implementation-plan.md:297
**Action**: MODIFY

**Also modify**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\index.ts`

**Implementation Details**:

- In `handlers/index.ts`: Add export for `ElectronSettingsRpcHandlers`
- In `rpc-method-registration.service.ts`:
  1. Import `ElectronSettingsRpcHandlers` from `'./handlers'`
  2. Add constructor parameter: `private readonly settingsHandlers: ElectronSettingsRpcHandlers`
  3. Add to `electronHandlers` array in `registerElectronHandlers()`:
     `{ name: 'ElectronSettingsRpcHandlers', handler: this.settingsHandlers }`

---

**Batch 3 Verification**:

- New file exists: electron-settings-rpc.handlers.ts
- handlers/index.ts exports the new handler
- rpc-method-registration.service.ts imports and registers the handler
- Build passes: `npx nx build ptah-electron`
- code-logic-reviewer approved

---

## Batch 4: Session Auto-Discovery Enhancement -- COMPLETE (Commit: 926e5347)

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: None (independent, ordered last for clean merge)

### Task 4.1: Increase Session Import Default Limit -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\session-importer.service.ts`
**Spec Reference**: implementation-plan.md:300-330
**Action**: MODIFY

**Implementation Details**:

- Change default limit from 5 to 50 at line 52: `async scanAndImport(workspacePath: string, limit = 50)`
- Add a brief comment explaining the change: `// TASK_2025_210: Increased from 5 to 50 for cross-platform session discovery`
- No other logic changes needed -- the existing implementation handles everything correctly

---

### Task 4.2: Trigger Session Import on Electron Workspace Open -- COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\main.ts`
**Spec Reference**: implementation-plan.md:330
**Action**: MODIFY

**Implementation Details**:

- After PHASE 4.5 (RPC registration at line 354), add a new PHASE 4.6 block:
  ```
  // PHASE 4.6: Session Auto-Discovery (TASK_2025_210)
  ```
- Get workspace path from `workspaceProviderForRestore.getWorkspaceRoot()` or from `initialFolders?.[0]`
- If workspace path exists:
  1. Resolve SessionImporterService from container: `container.resolve(SDK_TOKENS.SDK_SESSION_IMPORTER)`
  2. Call `sessionImporter.scanAndImport(workspacePath, 50)`
  3. Log imported count
  4. Wrap in try/catch (non-fatal, same pattern as VS Code main.ts:664-682)
- Follow the exact pattern from VS Code main.ts:663-682

**Validation Notes**:

- Electron currently has ZERO session import calls (verified by grep)
- The container already has SDK_SESSION_IMPORTER registered (registered in agent-sdk/di/register.ts)
- workspaceProviderForRestore is available as ElectronWorkspaceProvider in scope

---

**Batch 4 Verification**:

- session-importer.service.ts has new default limit=50
- Electron main.ts has session import block after RPC registration
- Build passes for both: `npx nx build agent-sdk` and `npx nx build ptah-electron`
- code-logic-reviewer approved
