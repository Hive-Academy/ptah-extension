# Implementation Plan - TASK_2025_210: Settings Export/Import + Session Auto-Discovery

## Codebase Investigation Summary

### Libraries Discovered

- **vscode-core** (`libs/backend/vscode-core`): AuthSecretsService, LicenseService, ConfigManager, TOKENS

  - AuthSecretsService stores keys with prefix `ptah.auth.*` (source: `auth-secrets.service.ts:125`)
  - LicenseService stores key as `ptah.licenseKey` (source: `license.service.ts:177`)
  - Both use `context.secrets` (VS Code SecretStorage API)

- **llm-abstraction** (`libs/backend/llm-abstraction`): LlmSecretsService

  - Stores keys with prefix `ptah.llm.{provider}.apiKey` (source: `llm-secrets.service.ts:83,98`)
  - Currently only has vscode-lm provider (no API keys in use)

- **agent-sdk** (`libs/backend/agent-sdk`): SessionImporterService, SessionMetadataStore, JsonlReaderService

  - SessionImporterService already implements session auto-discovery (source: `session-importer.service.ts:52`)
  - Called during VS Code activation with limit=5 (source: `main.ts:668-670`)
  - SessionMetadataStore uses `IStateStorage` via PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE (source: `session-metadata-store.ts:107`)

- **platform-core** (`libs/backend/platform-core`): ISecretStorage, IStateStorage, IUserInteraction, IFileSystemProvider, PLATFORM_TOKENS

  - Platform-agnostic interfaces for all I/O operations
  - Already used by SessionMetadataStore and Electron container

- **platform-electron** (`libs/backend/platform-electron`): Electron platform implementations
  - ElectronSecretStorage wraps safeStorage
  - ElectronStateStorage wraps JSON file storage

### Patterns Identified

- **Command Pattern** (VS Code): Injectable class with `registerCommands(context)` method

  - Evidence: `apps/ptah-extension-vscode/src/commands/license-commands.ts:219-243`
  - Commands registered via `context.subscriptions.push(vscode.commands.registerCommand(...))`

- **RPC Handler Pattern**: Injectable class with `register()` method, uses `rpcHandler.registerMethod()`

  - Evidence: `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts:47-63`

- **DI Registration Pattern**: Services registered as singletons in container setup

  - Evidence: `libs/backend/agent-sdk/src/lib/di/register.ts:80-108`

- **Session Import Pattern**: `SessionImporterService.scanAndImport()` called during activation
  - Evidence: `apps/ptah-extension-vscode/src/main.ts:665-673`

### Integration Points

- **VS Code SecretStorage**: `context.secrets.get(key)`, `context.secrets.store(key, value)`
- **AuthSecretsService**: `getCredential('oauthToken'|'apiKey')`, `getProviderKey(providerId)`
- **LicenseService**: `context.secrets.get('ptah.licenseKey')`
- **VS Code Config**: `vscode.workspace.getConfiguration('ptah')`
- **Electron safeStorage**: Via ISecretStorage interface (PLATFORM_TOKENS.SECRET_STORAGE)
- **Electron state storage**: Via IStateStorage interface (PLATFORM_TOKENS.STATE_STORAGE)
- **Session importer**: `SessionImporterService.scanAndImport(workspacePath, limit)`

---

## Architecture Design

### Design Philosophy

**Approach**: Leverage existing services and platform abstraction layer. The settings export is VS Code-specific (command + VS Code dialogs). The settings import uses platform-agnostic interfaces so it works on both VS Code and Electron. Session auto-discovery already exists; we enhance the existing `SessionImporterService` rather than creating a new service.

### Exported JSON Schema (Versioned)

```typescript
interface PtahSettingsExport {
  /** Schema version for forward compatibility */
  version: 1;

  /** Timestamp of export (ISO 8601) */
  exportedAt: string;

  /** Source platform */
  source: 'vscode' | 'electron';

  /** License key (ptah.licenseKey) */
  licenseKey?: string;

  /** Authentication credentials from AuthSecretsService */
  auth: {
    /** ptah.auth.claudeOAuthToken */
    oauthToken?: string;
    /** ptah.auth.anthropicApiKey */
    apiKey?: string;
    /** ptah.auth.provider.{id} - per-provider keys */
    providerKeys?: Record<string, string>;
  };

  /** VS Code ptah.* configuration values */
  config: Record<string, unknown>;
}
```

---

## Component Specifications

### Component 1: SettingsExportService (Shared Library)

**Purpose**: Collect all exportable settings into a `PtahSettingsExport` object. Platform-agnostic so it can be used from both VS Code and Electron.

**Location**: `libs/backend/agent-sdk/src/lib/settings-export.service.ts` (agent-sdk already has session management and is consumed by both platforms)

**Pattern**: Injectable service with platform-agnostic dependencies
**Evidence**: SessionImporterService follows the same pattern (source: `session-importer.service.ts:34-40`)

**Responsibilities**:

- Collect credentials from ISecretStorage (license key, OAuth token, API key, provider keys)
- Collect configuration from IWorkspaceProvider
- Assemble a versioned `PtahSettingsExport` object
- No file I/O -- caller handles writing

**Dependencies (verified)**:

- `ISecretStorage` via `PLATFORM_TOKENS.SECRET_STORAGE` (source: `platform-core/src/tokens.ts:22`)
- `IWorkspaceProvider` via `PLATFORM_TOKENS.WORKSPACE_PROVIDER` (source: `platform-core/src/tokens.ts:25`)
- `Logger` via `TOKENS.LOGGER` (source: `vscode-core/src/di/tokens.ts`)

**Key Secret Keys to Export**:

- `ptah.licenseKey` (source: `license.service.ts:177`)
- `ptah.auth.claudeOAuthToken` (source: `auth-secrets.service.ts:131` -- KEY_MAP.oauthToken)
- `ptah.auth.anthropicApiKey` (source: `auth-secrets.service.ts:132` -- KEY_MAP.apiKey)
- `ptah.auth.provider.openrouter` (source: `auth-secrets.service.ts:269-270`)
- `ptah.auth.provider.moonshot` (same pattern)
- `ptah.auth.provider.z-ai` (same pattern)

**Config Keys to Export**:

- All `ptah.*` settings from VS Code workspace configuration (provider, model, preferences)

**Quality Requirements**:

- Never log actual secret values (security)
- Return null/undefined for missing keys (don't fail on partial data)
- Schema version field is mandatory for forward compatibility

**Files**:

- CREATE: `libs/backend/agent-sdk/src/lib/settings-export.service.ts`
- CREATE: `libs/backend/agent-sdk/src/lib/types/settings-export.types.ts` (PtahSettingsExport interface)
- MODIFY: `libs/backend/agent-sdk/src/lib/di/tokens.ts` (add SDK_SETTINGS_EXPORT token)
- MODIFY: `libs/backend/agent-sdk/src/lib/di/register.ts` (register SettingsExportService)
- MODIFY: `libs/backend/agent-sdk/src/index.ts` (export new types and service)

---

### Component 2: SettingsImportService (Shared Library)

**Purpose**: Import a `PtahSettingsExport` object into the current platform's storage. Platform-agnostic.

**Location**: `libs/backend/agent-sdk/src/lib/settings-import.service.ts`

**Pattern**: Injectable service with platform-agnostic dependencies
**Evidence**: Same pattern as SettingsExportService

**Responsibilities**:

- Validate the import schema (version check, required fields)
- Store credentials into ISecretStorage
- Store config into IStateStorage or IWorkspaceProvider
- Return an import summary (what was imported, what was skipped)
- Never overwrite existing credentials unless explicitly requested

**Dependencies (verified)**:

- `ISecretStorage` via `PLATFORM_TOKENS.SECRET_STORAGE`
- `IWorkspaceProvider` via `PLATFORM_TOKENS.WORKSPACE_PROVIDER`
- `Logger` via `TOKENS.LOGGER`

**Import Summary Type**:

```typescript
interface SettingsImportResult {
  imported: string[]; // Keys that were imported
  skipped: string[]; // Keys that already existed
  errors: string[]; // Keys that failed
}
```

**Quality Requirements**:

- Validate schema version before importing
- Never log imported secret values
- Graceful failure: if one key fails, continue with others
- Return detailed summary for UI display

**Files**:

- CREATE: `libs/backend/agent-sdk/src/lib/settings-import.service.ts`
- MODIFY: `libs/backend/agent-sdk/src/lib/types/settings-export.types.ts` (add SettingsImportResult)
- MODIFY: `libs/backend/agent-sdk/src/lib/di/tokens.ts` (add SDK_SETTINGS_IMPORT token)
- MODIFY: `libs/backend/agent-sdk/src/lib/di/register.ts` (register SettingsImportService)
- MODIFY: `libs/backend/agent-sdk/src/index.ts` (export new service)

---

### Component 3: VS Code Export Command (`ptah.exportSettings`)

**Purpose**: Register a VS Code command that exports settings to a JSON file.

**Location**: `apps/ptah-extension-vscode/src/commands/settings-commands.ts`

**Pattern**: Injectable command class with `registerCommands(context)` method
**Evidence**: `apps/ptah-extension-vscode/src/commands/license-commands.ts:219-243`

**Responsibilities**:

- Show security warning dialog before export
- Call SettingsExportService to collect settings
- Show save file dialog (default filename: `ptah-settings-export.json`)
- Write JSON file to user-selected location
- Show success message with count of exported items

**Dependencies (verified)**:

- `SettingsExportService` via new SDK token
- `vscode.window.showWarningMessage` for security warning
- `vscode.window.showSaveDialog` for file selection
- `vscode.workspace.fs.writeFile` for writing

**Quality Requirements**:

- Security warning MUST be shown before export proceeds
- Default filename includes no timestamp (simple, recognizable)
- JSON is pretty-printed (human-readable, user might inspect it)

**Files**:

- CREATE: `apps/ptah-extension-vscode/src/commands/settings-commands.ts`
- MODIFY: `apps/ptah-extension-vscode/src/main.ts` (register SettingsCommands)
- MODIFY: `apps/ptah-extension-vscode/package.json` (add `ptah.exportSettings` command contribution)

---

### Component 4: VS Code Import Command (`ptah.importSettings`)

**Purpose**: Register a VS Code command that imports settings from a JSON file. Enables importing on another VS Code instance (e.g., different machine).

**Location**: Same file as export: `apps/ptah-extension-vscode/src/commands/settings-commands.ts`

**Responsibilities**:

- Show open file dialog (filter: \*.json)
- Read and parse JSON file
- Call SettingsImportService to import
- Show summary of what was imported
- Warn user to delete the export file
- Offer to reload the window

**Files**:

- Same as Component 3 (combined in settings-commands.ts)
- MODIFY: `apps/ptah-extension-vscode/package.json` (add `ptah.importSettings` command contribution)

---

### Component 5: Electron Import RPC Handler

**Purpose**: RPC handler for importing settings in the Electron app (triggered from webview UI).

**Location**: `apps/ptah-electron/src/services/rpc/` (alongside existing RPC handlers)

**Pattern**: RPC handler pattern
**Evidence**: `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts:47-63`

**Responsibilities**:

- Register `settings:import` RPC method
- Open native file dialog (Electron dialog API)
- Read and parse JSON file
- Call SettingsImportService
- Return import summary to webview

**Dependencies**:

- `SettingsImportService` via SDK token
- Electron `dialog.showOpenDialog` for file selection
- Node.js `fs` for file reading

**Quality Requirements**:

- Use Electron native file dialog (not IPC to webview)
- Return structured result for webview to display

**Files**:

- CREATE: `apps/ptah-electron/src/services/rpc/settings-rpc.handlers.ts`
- MODIFY: `apps/ptah-electron/src/services/rpc/rpc-method-registration.service.ts` (register new handler)

---

### Component 6: Session Auto-Discovery Enhancement

**Purpose**: Enhance existing `SessionImporterService` to remove the 5-session limit and ensure it runs on both platforms.

**Location**: `libs/backend/agent-sdk/src/lib/session-importer.service.ts` (MODIFY existing)

**Pattern**: Enhancement of existing service
**Evidence**: Current implementation at `session-importer.service.ts:52` with `limit = 5`

**Changes Needed**:

1. Increase default limit from 5 to 50 (or make unlimited with a reasonable cap)
2. Ensure the Electron app calls `scanAndImport()` on workspace open (same as VS Code does in `main.ts:665-673`)

**The core auto-discovery logic already works**:

- Finds sessions directory (line 296-357)
- Filters .jsonl files excluding agent-\* (line 136-173)
- Checks if already imported via `metadataStore.get()` (line 74-78)
- Handles child session detection (line 86-97)
- Extracts metadata from first 8KB (line 192-265)

**What needs to change**:

- Default limit: 5 -> 50 (covers most real-world scenarios)
- Electron integration: Call `scanAndImport()` during workspace context initialization

**Files**:

- MODIFY: `libs/backend/agent-sdk/src/lib/session-importer.service.ts` (increase default limit)
- MODIFY: `apps/ptah-electron/src/main.ts` OR `apps/ptah-electron/src/services/workspace-context-manager.ts` (trigger session import on workspace open)

---

## Integration Architecture

### Data Flow: Settings Export (VS Code)

```
User -> Command Palette -> ptah.exportSettings
  -> SettingsCommands.exportSettings()
    -> Show security warning dialog
    -> SettingsExportService.collectSettings()
      -> ISecretStorage.get('ptah.licenseKey')
      -> ISecretStorage.get('ptah.auth.claudeOAuthToken')
      -> ISecretStorage.get('ptah.auth.anthropicApiKey')
      -> ISecretStorage.get('ptah.auth.provider.openrouter')
      -> ISecretStorage.get('ptah.auth.provider.moonshot')
      -> ISecretStorage.get('ptah.auth.provider.z-ai')
      -> IWorkspaceProvider.getConfiguration('ptah', '*')
      -> Return PtahSettingsExport object
    -> Show save dialog
    -> Write JSON to file
    -> Show success message
```

### Data Flow: Settings Import (Electron)

```
User -> Webview UI -> RPC 'settings:import'
  -> SettingsRpcHandlers.handleImport()
    -> Electron dialog.showOpenDialog()
    -> Read JSON file
    -> SettingsImportService.importSettings(data)
      -> Validate schema version
      -> ISecretStorage.store('ptah.licenseKey', ...)
      -> ISecretStorage.store('ptah.auth.claudeOAuthToken', ...)
      -> ISecretStorage.store('ptah.auth.anthropicApiKey', ...)
      -> ISecretStorage.store('ptah.auth.provider.*', ...)
      -> Return SettingsImportResult
    -> Return summary to webview
    -> Webview shows summary + "Delete export file" warning
```

### Data Flow: Session Auto-Discovery

```
App startup (both platforms)
  -> Workspace opened/changed
    -> SessionImporterService.scanAndImport(workspacePath, 50)
      -> findSessionsDirectory() (existing logic)
      -> getRecentSessionFiles() (existing logic, increased limit)
      -> For each file:
        -> Skip if metadataStore.get(sessionId) exists (existing logic)
        -> Skip if isReferencedAsChildSession (existing logic)
        -> extractMetadata() from first 8KB (existing logic)
        -> metadataStore.save(metadata)
```

---

## Security Considerations

1. **Export file contains plaintext secrets**: User MUST be warned before export. The warning dialog should explicitly state that API keys and tokens will be stored in plaintext.

2. **Post-import deletion advisory**: After successful import, the user should be advised to delete the export file. This should be a prominent warning, not just a footnote.

3. **No secret values in logs**: SettingsExportService and SettingsImportService must never log actual credential values. Only log key names and boolean has/missing status.

4. **Schema validation on import**: Import must validate the schema version and structure before processing. Reject unknown versions to prevent injection attacks.

5. **Provider key enumeration**: The known provider IDs (openrouter, moonshot, z-ai) should be defined as a constant array, not hardcoded in multiple places.

---

## Batched Implementation Plan

### Batch 1: Types and Shared Services (Foundation)

**Goal**: Create the shared types and services that both platforms use.

**Files**:

- CREATE: `libs/backend/agent-sdk/src/lib/types/settings-export.types.ts`
- CREATE: `libs/backend/agent-sdk/src/lib/settings-export.service.ts`
- CREATE: `libs/backend/agent-sdk/src/lib/settings-import.service.ts`
- MODIFY: `libs/backend/agent-sdk/src/lib/di/tokens.ts` (add 2 new tokens)
- MODIFY: `libs/backend/agent-sdk/src/lib/di/register.ts` (register 2 new services)
- MODIFY: `libs/backend/agent-sdk/src/index.ts` (export new types and services)

**Dependencies**: None (foundation batch)

### Batch 2: VS Code Export/Import Commands

**Goal**: Add ptah.exportSettings and ptah.importSettings commands to VS Code.

**Files**:

- CREATE: `apps/ptah-extension-vscode/src/commands/settings-commands.ts`
- MODIFY: `apps/ptah-extension-vscode/src/main.ts` (instantiate SettingsCommands, call registerCommands)
- MODIFY: `apps/ptah-extension-vscode/package.json` (add command contributions)

**Dependencies**: Batch 1

### Batch 3: Electron Import RPC + UI

**Goal**: Add settings import capability to the Electron app.

**Files**:

- CREATE: `apps/ptah-electron/src/services/rpc/settings-rpc.handlers.ts`
- MODIFY: `apps/ptah-electron/src/services/rpc/rpc-method-registration.service.ts`

**Dependencies**: Batch 1

### Batch 4: Session Auto-Discovery Enhancement

**Goal**: Increase session import limit and ensure Electron triggers session import on workspace open.

**Files**:

- MODIFY: `libs/backend/agent-sdk/src/lib/session-importer.service.ts` (increase default limit from 5 to 50)
- MODIFY: `apps/ptah-electron/src/main.ts` OR `apps/ptah-electron/src/services/workspace-context-manager.ts` (trigger scanAndImport on workspace open/change)

**Dependencies**: None (independent of Batches 1-3, but ordered last for clean merge)

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**:

- All work is in Node.js services (no Angular components)
- VS Code command registration is server-side TypeScript
- Electron RPC handlers are server-side TypeScript
- Platform abstraction interfaces are backend patterns
- No UI components need to be created (Electron webview import button can be added separately later)

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 6-10 hours

**Breakdown**:

- Batch 1 (Types + Services): 2-3 hours -- new services, straightforward DI integration
- Batch 2 (VS Code Commands): 1-2 hours -- follows established LicenseCommands pattern exactly
- Batch 3 (Electron RPC): 1-2 hours -- follows established RPC handler pattern
- Batch 4 (Session Enhancement): 1 hour -- minimal change to existing service + Electron trigger

### Files Affected Summary

**CREATE** (4 files):

- `libs/backend/agent-sdk/src/lib/types/settings-export.types.ts`
- `libs/backend/agent-sdk/src/lib/settings-export.service.ts`
- `libs/backend/agent-sdk/src/lib/settings-import.service.ts`
- `apps/ptah-extension-vscode/src/commands/settings-commands.ts`
- `apps/ptah-electron/src/services/rpc/settings-rpc.handlers.ts`

**MODIFY** (8 files):

- `libs/backend/agent-sdk/src/lib/di/tokens.ts`
- `libs/backend/agent-sdk/src/lib/di/register.ts`
- `libs/backend/agent-sdk/src/index.ts`
- `libs/backend/agent-sdk/src/lib/session-importer.service.ts`
- `apps/ptah-extension-vscode/src/main.ts`
- `apps/ptah-extension-vscode/package.json`
- `apps/ptah-electron/src/main.ts` (or workspace-context-manager.ts)
- `apps/ptah-electron/src/services/rpc/rpc-method-registration.service.ts`

### Critical Verification Points

**Before implementation, developer must verify**:

1. **All imports exist in codebase**:

   - `ISecretStorage` from `@ptah-extension/platform-core` (source: `platform-core/src/interfaces/secret-storage.interface.ts:9`)
   - `IWorkspaceProvider` from `@ptah-extension/platform-core` (source: `platform-core/src/interfaces/workspace-provider.interface.ts:9`)
   - `PLATFORM_TOKENS` from `@ptah-extension/platform-core` (source: `platform-core/src/tokens.ts:11`)
   - `Logger, TOKENS` from `@ptah-extension/vscode-core` (source: `vscode-core/src/di/tokens.ts`)

2. **All patterns verified from examples**:

   - Command registration: `license-commands.ts:219-243`
   - RPC handler registration: `session-rpc.handlers.ts:47-63`
   - DI service registration: `agent-sdk/di/register.ts:80-108`
   - Session import invocation: `main.ts:665-673`

3. **Library documentation consulted**:

   - `libs/backend/agent-sdk/CLAUDE.md`
   - `libs/backend/vscode-core/CLAUDE.md`
   - `apps/ptah-extension-vscode/CLAUDE.md`

4. **No hallucinated APIs**:
   - All `ISecretStorage` methods verified: `get`, `store`, `delete` (source: `secret-storage.interface.ts:12-27`)
   - All `IWorkspaceProvider` methods verified: `getConfiguration` (source: `workspace-provider.interface.ts:34-38`)
   - `SessionMetadataStore.get(sessionId)` verified (source: `session-metadata-store.ts:147-150`)
   - `SessionImporterService.scanAndImport(path, limit)` verified (source: `session-importer.service.ts:52`)

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended
- [x] Complexity assessed
- [x] Security considerations documented
- [x] No step-by-step implementation (that is team-leader's job)
