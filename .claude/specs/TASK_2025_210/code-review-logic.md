# Code Logic Review - TASK_2025_210: Settings Export/Import + Session Auto-Discovery

## Review Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall Score       | 5.5/10         |
| Assessment          | NEEDS_REVISION |
| Critical Issues     | 3              |
| Serious Issues      | 4              |
| Moderate Issues     | 4              |
| Failure Modes Found | 8              |

---

## The 5 Paranoid Questions

### 1. How does this fail silently?

1. **VS Code session import limit NOT updated**: The VS Code `main.ts` at line 673 still calls `sessionImporter.scanAndImport(workspacePath, 5)` with a hardcoded limit of `5`. The `SessionImporterService` default was changed from 5 to 50, but the VS Code call site explicitly passes `5`, overriding the new default. Sessions 6-50 are silently never imported in VS Code. The Electron `main.ts` correctly passes `50`. This is the highest-impact silent failure in the changeset.

2. **Config import stored in secret storage but never consumed**: The `importConfigBundle()` method stores config as a serialized JSON blob under `ptah.importedConfig` in `ISecretStorage`. However, there is no code anywhere in the codebase that reads `ptah.importedConfig` on startup and applies those values. The import reports config keys as "imported" in the summary, but the config values are effectively dead data. The user sees "12 imported" but their configuration preferences are never applied.

3. **Electron export has no security warning**: The VS Code export command shows a modal warning about plaintext secrets before proceeding (line 76-84 of `settings-commands.ts`). The Electron `settings:export` RPC handler (`electron-settings-rpc.handlers.ts`) has zero security warning -- it immediately collects secrets and shows a save dialog. Users on Electron export plaintext API keys without any warning.

### 2. What user action causes unexpected behavior?

1. **Importing arbitrary JSON**: A user could select any `.json` file. The validation checks `version`, `exportedAt`, `source`, and `auth` -- but does not validate the shape of `auth.providerKeys`. If a user imports a JSON file where `auth.providerKeys` contains a key like `__proto__` or `constructor`, it flows through `Object.entries()` into `providerSecretKey()` which constructs `ptah.auth.provider.__proto__` and stores it in secret storage. While this is unlikely to cause prototype pollution (it is just stored as a secret key), it does pollute the secret store with garbage keys.

2. **Importing with empty string values**: The `importSecret` method checks `if (!value)` which treats empty string `""` as falsy and skips the import. If a user deliberately exported a setting that happened to be an empty string (unlikely for secrets but possible for config), it would be silently dropped.

3. **Double-clicking Export rapidly**: Two `collectSettings()` calls execute concurrently. Both read secrets, both show save dialogs. Not harmful but confusing UX with two dialogs.

### 3. What data makes this produce wrong results?

1. **Prototype pollution in providerKeys**: If the imported JSON contains `auth.providerKeys` with keys like `__proto__`, `constructor`, or `toString`, these are iterated via `Object.entries()` and stored as secret keys. The `providerSecretKey()` function does not validate or sanitize the provider ID.

2. **Config bundle overwrite logic**: When `overwrite=false` and a config bundle already exists in `ptah.importedConfig`, ALL config keys are skipped as a single unit. If the existing bundle has 3 keys and the new import has 15 keys, 12 new config values are lost. The granularity is wrong -- it should merge at the key level, not the bundle level.

3. **Malformed exportedAt**: The validation checks `typeof obj['exportedAt'] !== 'string'` but does not validate it is a valid ISO 8601 date. A string like `"not-a-date"` passes validation. The `exportedAt` value is never actually used after import so this is low-impact, but the validation claims to check for a valid timestamp when it does not.

### 4. What happens when dependencies fail?

1. **ISecretStorage.get() throws during import's overwrite check**: In `importSecret()`, if `secretStorage.get(key)` throws, the error is caught and recorded in `result.errors`. This is handled correctly.

2. **ISecretStorage.store() throws during import**: Similarly caught and recorded. This is handled correctly.

3. **IWorkspaceProvider.getConfiguration() throws during export**: Caught per-key and logged as warning. Config key is skipped. Handled correctly.

4. **Electron `dialog` import fails**: The dynamic `import('electron')` inside the RPC handler could fail if the module is not available. Caught by the outer try/catch. Handled.

5. **File system write fails during export**: Caught in VS Code command (line 117-127). Caught in Electron handler (outer catch). Handled.

### 5. What's missing that the requirements didn't mention?

1. **No consumer of `ptah.importedConfig`**: The import stores config values but nothing reads them. This is a feature gap, not just missing implementation -- the architecture doc acknowledges IWorkspaceProvider is read-only but the solution (store in secret storage for later consumption) has no consumer.

2. **No export from Electron was originally planned**: The implementation plan only specified export from VS Code and import in Electron. The Electron RPC handler implements both `settings:export` AND `settings:import`, which is fine functionally but the export path lacks the security warning that was explicitly required.

3. **No file deletion helper after import**: Both requirements and implementation mention advising the user to delete the export file. VS Code shows a modal warning. Electron returns the result to the webview but has no mechanism to advise deletion -- that would need webview UI which doesn't exist yet.

4. **No `ptah.llm.{provider}.apiKey` keys exported**: The context document lists `ptah.llm.{provider}.apiKey` as a secret key pattern (from `LlmSecretsService`). The export service only collects `ptah.licenseKey`, `ptah.auth.claudeOAuthToken`, `ptah.auth.anthropicApiKey`, and `ptah.auth.provider.{id}` keys. The LLM-specific keys are omitted. The context notes these are "currently empty" but if they are ever populated, they would not be exported.

5. **No indication that import succeeded when 0 items exist**: If the user exports from a fresh install with no credentials configured, the export will succeed with 0 secrets and 0 config values. The success message says "0 item(s) saved (0 credential(s), 0 config value(s))." which is technically correct but unhelpful -- the user may not understand why nothing was exported.

---

## Failure Mode Analysis

### Failure Mode 1: VS Code Session Import Limit Override

- **Trigger**: VS Code extension activates with a workspace open
- **Symptoms**: Only 5 sessions imported despite the default being changed to 50 in the service
- **Impact**: CRITICAL -- Directly contradicts the task requirement to increase the limit from 5 to 50
- **Current Handling**: The hardcoded `5` at `main.ts:673` overrides the service default
- **Recommendation**: Change line 673 of `apps/ptah-extension-vscode/src/main.ts` from `scanAndImport(workspacePath, 5)` to `scanAndImport(workspacePath, 50)` or remove the explicit limit to use the new default

### Failure Mode 2: Imported Config Values Are Never Applied

- **Trigger**: User imports settings with config values on any platform
- **Symptoms**: User sees "12 imported" in summary but settings preferences (model selection, autopilot config, etc.) do not change
- **Impact**: CRITICAL -- Feature appears to work but silently discards config data
- **Current Handling**: Values are stored in `ptah.importedConfig` secret storage key with no consumer
- **Recommendation**: Either (a) implement a startup reader in both VS Code and Electron that reads `ptah.importedConfig` and applies values, or (b) remove config import from the summary counts so users are not misled, and document config import as a future enhancement

### Failure Mode 3: No Security Warning on Electron Export

- **Trigger**: User calls `settings:export` RPC method from Electron webview
- **Symptoms**: Plaintext API keys exported to disk without any user confirmation about security risk
- **Impact**: SERIOUS -- Violates security requirement from implementation plan: "User MUST be warned before export"
- **Current Handling**: No warning dialog shown
- **Recommendation**: Add a confirmation dialog using Electron's `dialog.showMessageBox()` before collecting settings, matching the VS Code behavior

### Failure Mode 4: Unvalidated Provider IDs in Import

- **Trigger**: Importing a JSON file with crafted `auth.providerKeys` containing keys like `__proto__`, `constructor`, or arbitrary strings
- **Symptoms**: Garbage keys stored in secret storage under `ptah.auth.provider.{arbitrary}`
- **Impact**: MODERATE -- No prototype pollution (values are stored as strings), but pollutes secret storage and could cause confusion if the app later iterates known provider keys
- **Current Handling**: No validation of provider ID values before constructing the secret key
- **Recommendation**: Validate that provider IDs match `KNOWN_PROVIDER_IDS` or at minimum are alphanumeric strings without special characters

### Failure Mode 5: Config Bundle Granularity Mismatch

- **Trigger**: User imports settings with `overwrite=false` when a partial config bundle already exists
- **Symptoms**: New config keys that don't exist in the old bundle are silently dropped
- **Impact**: MODERATE -- User loses config values that should have been additive
- **Current Handling**: Entire config bundle treated as a single unit for overwrite checks
- **Recommendation**: Merge config bundles at the key level, or at minimum document the all-or-nothing behavior

### Failure Mode 6: Duplicate `countExportedSecrets` Implementation

- **Trigger**: N/A (code maintenance issue)
- **Symptoms**: Three identical copies of `countExportedSecrets()` exist in: `SettingsExportService`, `SettingsCommands`, and `ElectronSettingsRpcHandlers`
- **Impact**: LOW -- Functional but violates DRY. If the export schema changes to add new secret types, developers must update 3 places
- **Current Handling**: Copy-pasted implementation
- **Recommendation**: Export `countExportedSecrets` as a utility function from the types module or add it as a method on `SettingsExportService` that callers can use

### Failure Mode 7: Race Between Export Collection and Dialog

- **Trigger**: Settings change between `collectSettings()` and user confirming save dialog (VS Code export)
- **Symptoms**: Exported file may not reflect the very latest state if secrets change during dialog interaction
- **Impact**: LOW -- Extremely unlikely in practice; secrets don't change frequently
- **Current Handling**: No handling; collect happens before dialog
- **Recommendation**: Acceptable as-is. The current ordering (collect then dialog) is actually correct -- collecting after dialog could also race

### Failure Mode 8: Empty Export Produces Confusing Message

- **Trigger**: User exports from a fresh install with no credentials configured
- **Symptoms**: Success message says "0 item(s) saved" which may confuse the user
- **Impact**: LOW -- UX papercut, not a data integrity issue
- **Current Handling**: Shows count-based message regardless of whether anything meaningful was exported
- **Recommendation**: Show a specific message like "No credentials or settings found to export" when totalCount is 0

---

## Critical Issues

### Issue 1: VS Code Session Import Limit Not Updated

- **File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\main.ts:673`
- **Scenario**: VS Code extension activates and runs session import
- **Impact**: Only 5 sessions imported instead of 50. Directly contradicts the TASK_2025_210 requirement to increase the limit from 5 to 50.
- **Evidence**: `const imported = await sessionImporter.scanAndImport(workspacePath, 5);` -- hardcoded `5` overrides the new default of `50`
- **Fix**: Change to `sessionImporter.scanAndImport(workspacePath, 50)` or remove the explicit `5` to use the service's new default

### Issue 2: Imported Config Values Are Dead Data

- **File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\settings-import.service.ts:240-278`
- **Scenario**: User imports settings containing config values (model preferences, autopilot settings, etc.)
- **Impact**: Config values are stored in `ptah.importedConfig` secret storage key but never read or applied by any code. Users are told their config was imported (via `result.imported` containing `config:*` entries) but the values have no effect. This is misleading.
- **Evidence**: Search for `ptah.importedConfig` across the entire codebase returns only the single write in `settings-import.service.ts:245`. There is no consumer.
- **Fix**: Either implement startup code in both VS Code `main.ts` and Electron `main.ts` that reads `ptah.importedConfig` and applies it, or stop claiming config was imported in the result summary

### Issue 3: No Security Warning on Electron Export Path

- **File**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\electron-settings-rpc.handlers.ts:50-102`
- **Scenario**: User triggers `settings:export` from Electron webview
- **Impact**: API keys and OAuth tokens exported to plaintext JSON file without any security advisory. The implementation plan explicitly states: "User MUST be warned before export. The warning dialog should explicitly state that API keys and tokens will be stored in plaintext."
- **Evidence**: The `registerExport()` method jumps directly from `collectSettings()` to `showSaveDialog()` with no intermediate warning
- **Fix**: Add `electronDialog.showMessageBox()` with a warning message matching the VS Code implementation before proceeding with collection

---

## Serious Issues

### Issue 4: Provider ID Injection in Import

- **File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\settings-import.service.ts:109-116`
- **Scenario**: User imports a JSON file where `auth.providerKeys` contains arbitrary keys
- **Impact**: Arbitrary secret keys created under `ptah.auth.provider.{attacker-controlled-string}`. While not a prototype pollution vector, it pollutes secret storage.
- **Evidence**: `for (const [providerId, value] of Object.entries(data.auth.providerKeys)` -- no validation of `providerId` against `KNOWN_PROVIDER_IDS`
- **Fix**: Add a check: `if (!KNOWN_PROVIDER_IDS.includes(providerId as KnownProviderId))` to skip unknown provider IDs (with a log warning)

### Issue 5: Config Bundle Overwrite Is All-or-Nothing

- **File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\settings-import.service.ts:240-278`
- **Scenario**: Second import with `overwrite=false` when first import already stored a config bundle
- **Impact**: ALL config keys from second import are skipped even if they don't exist in the first bundle. New config keys are lost.
- **Evidence**: Lines 248-256 check for existence of the `ptah.importedConfig` key as a whole, not individual keys within it
- **Fix**: When `overwrite=false`, read the existing bundle, merge new keys that don't exist, then write back the merged bundle

### Issue 6: Validation Missing `config` Field Check

- **File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\settings-import.service.ts:151-177`
- **Scenario**: Import file has `config` set to a non-object value (string, array, number)
- **Impact**: `Object.keys(data.config)` at line 130 would work on arrays (returning indices) but not on primitives (would throw). Since `data.config` is typed as `Record<string, unknown>` via the `PtahSettingsExport` type, the TypeScript type provides false safety -- the actual runtime value from `JSON.parse()` could be anything.
- **Evidence**: `validateExportData()` validates `version`, `exportedAt`, `source`, `auth` but does NOT validate `config`
- **Fix**: Add validation: `if (obj['config'] !== undefined && (typeof obj['config'] !== 'object' || Array.isArray(obj['config'])))` return error

### Issue 7: `as unknown as Error` Logger Hack in Electron Handler

- **File**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\electron-settings-rpc.handlers.ts:84,141,163,203`
- **Scenario**: Any log call with structured metadata
- **Impact**: The `as unknown as Error` cast suggests the Logger interface expects an `Error` as the second argument but the code passes a plain object. This is a typing workaround that could mask real logging issues if the logger implementation changes.
- **Evidence**: Lines 84, 141, 163, 203 all use `as unknown as Error` pattern
- **Fix**: Use the logger's structured metadata API correctly, or add a metadata overload to the Logger type

---

## Moderate Issues

### Issue 8: `ptah.llm.{provider}.apiKey` Keys Not Exported

- **File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\types\settings-export.types.ts`
- **Scenario**: User has LLM provider API keys stored under the `ptah.llm.*` pattern
- **Impact**: These keys are not exported and therefore not portable. The context document lists these as a known key pattern.
- **Evidence**: `SECRET_KEYS` constant only includes `ptah.licenseKey`, `ptah.auth.claudeOAuthToken`, `ptah.auth.anthropicApiKey`. The `KNOWN_PROVIDER_IDS` only covers `ptah.auth.provider.{id}` pattern.
- **Fix**: Add `ptah.llm.{provider}.apiKey` pattern to the export, or document that these keys are intentionally excluded

### Issue 9: `collectConfigValues()` Is Synchronous But Could Be Wrapped in Promise.all

- **File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\settings-export.service.ts:52-59`
- **Scenario**: Export collection calls `this.collectConfigValues()` inside `Promise.all()`
- **Impact**: `collectConfigValues()` is synchronous (returns `Record<string, unknown>`, not a Promise). Wrapping it in `Promise.all` works because `Promise.all` handles non-Promise values, but it is misleading to other developers who might expect all items in the array to be async operations.
- **Evidence**: Line 58: `this.collectConfigValues()` returns `Record<string, unknown>` (not `Promise<Record<string, unknown>>`)
- **Fix**: Minor -- either make `collectConfigValues()` async for consistency, or move it outside `Promise.all()`

### Issue 10: No Test Files Created

- **File**: N/A
- **Scenario**: Any future modification to settings export/import logic
- **Impact**: Zero test coverage for 3 new service files and 2 new command/handler files. No regression protection for: validation logic, secret collection, import overwrite behavior, edge cases.
- **Evidence**: No `*.spec.ts` files created for `settings-export.service.ts`, `settings-import.service.ts`, `settings-commands.ts`, or `electron-settings-rpc.handlers.ts`
- **Fix**: Create unit tests covering at minimum: validation passes/fails, empty export, import with overwrite, import without overwrite, malformed JSON handling

### Issue 11: `countExportedSecrets` Duplicated 3 Times

- **File**: `settings-export.service.ts:172`, `settings-commands.ts:257`, `electron-settings-rpc.handlers.ts:230`
- **Scenario**: Schema changes add new secret types (e.g., new auth fields)
- **Impact**: Three copies of identical logic must be kept in sync
- **Evidence**: Identical method body in all three locations
- **Fix**: Export as a utility function from `settings-export.types.ts` or expose via `SettingsExportService`

---

## Data Flow Analysis

```
EXPORT FLOW (VS Code):
  User clicks "Ptah: Export Settings"
    |
    v
  [Security Warning Dialog] --- user cancels --> abort
    |
    v
  SettingsExportService.collectSettings('vscode')
    |-- ISecretStorage.get('ptah.licenseKey')         --> licenseKey?
    |-- ISecretStorage.get('ptah.auth.claudeOAuthToken') --> oauthToken?
    |-- ISecretStorage.get('ptah.auth.anthropicApiKey')  --> apiKey?
    |-- ISecretStorage.get('ptah.auth.provider.openrouter') --> providerKeys?
    |-- ISecretStorage.get('ptah.auth.provider.moonshot')   --> providerKeys?
    |-- ISecretStorage.get('ptah.auth.provider.z-ai')       --> providerKeys?
    |-- IWorkspaceProvider.getConfiguration('ptah', key) x 22 keys --> config{}
    |
    v
  PtahSettingsExport object assembled
    |
    v
  [Save File Dialog] --- user cancels --> abort
    |
    v
  JSON.stringify(exportData, null, 2) --> write to file
    |
    v
  Success message with counts

EXPORT FLOW (Electron):
  RPC 'settings:export'
    |
    v
  SettingsExportService.collectSettings('electron')  *** NO SECURITY WARNING ***
    |
    v
  [Save File Dialog] --- user cancels --> { exported: false, cancelled: true }
    |
    v
  fs.writeFile(filePath, json, 'utf-8')
    |
    v
  Return { exported: true, filePath, secretCount, configCount }

IMPORT FLOW (Both Platforms):
  File selected --> JSON.parse()
    |
    v
  SettingsImportService.importSettings(data, options)
    |
    v
  validateExportData(data)
    |-- version !== 1 --> error
    |-- exportedAt not string --> error
    |-- source not vscode/electron --> error
    |-- auth missing/not object --> error
    |-- config NOT VALIDATED  *** GAP ***
    |
    v
  Import secrets (licenseKey, oauthToken, apiKey)
    |-- for each: check if exists, skip or overwrite
    |
    v
  Import provider keys (iterate auth.providerKeys)
    |-- NO VALIDATION of provider ID  *** GAP ***
    |
    v
  Import config bundle
    |-- Stored as JSON blob in 'ptah.importedConfig'
    |-- NO CONSUMER reads this key  *** DEAD END ***
    |
    v
  Return SettingsImportResult { imported[], skipped[], errors[] }
```

### Gap Points Identified:

1. Config values imported but never applied (dead data in secret storage)
2. Provider IDs in import not validated against known list
3. Config field not validated in `validateExportData()`
4. VS Code call site still uses limit=5 for session import

---

## Requirements Fulfillment

| Requirement                             | Status   | Concern                                                      |
| --------------------------------------- | -------- | ------------------------------------------------------------ |
| Export all API keys from SecretStorage  | COMPLETE | Missing `ptah.llm.{provider}.apiKey` pattern                 |
| Export OAuth tokens                     | COMPLETE | None                                                         |
| Export license key                      | COMPLETE | None                                                         |
| Export VS Code config                   | COMPLETE | Config keys are hardcoded, not dynamic                       |
| Security warning before export          | PARTIAL  | VS Code: yes. Electron: NO                                   |
| Import stores API keys to SecretStorage | COMPLETE | None                                                         |
| Import stores config to storage         | PARTIAL  | Stored but never consumed                                    |
| Post-import deletion advisory           | PARTIAL  | VS Code: yes. Electron: no (webview UI needed)               |
| Show import summary                     | COMPLETE | None                                                         |
| Offer window reload after import        | COMPLETE | VS Code only (appropriate)                                   |
| Schema version validation               | COMPLETE | None                                                         |
| Never overwrite existing credentials    | COMPLETE | Default behavior correct                                     |
| Never log secret values                 | COMPLETE | Only key names and booleans logged                           |
| Session import limit 5 -> 50            | PARTIAL  | Service default updated but VS Code call site still passes 5 |
| Electron triggers session import        | COMPLETE | PHASE 4.6 in Electron main.ts                                |
| Provider IDs as constant array          | COMPLETE | KNOWN_PROVIDER_IDS defined                                   |

### Implicit Requirements NOT Addressed:

1. **Config import consumer**: No code reads `ptah.importedConfig` after import
2. **Electron export security warning**: Implementation plan requires warning on ALL export paths
3. **Provider ID validation on import**: Unknown provider IDs blindly stored
4. **Tests**: Zero test coverage for new code
5. **Graceful handling of 0-item export**: No special UX for empty exports

---

## Edge Case Analysis

| Edge Case                                | Handled | How                                  | Concern                             |
| ---------------------------------------- | ------- | ------------------------------------ | ----------------------------------- |
| No credentials configured (empty export) | YES     | Returns valid object with empty auth | Message says "0 items" -- confusing |
| Malformed JSON import                    | YES     | JSON.parse error caught              | Proper error message shown          |
| Wrong schema version                     | YES     | Validation rejects                   | Clear error message                 |
| Dialog cancellation (export)             | YES     | Returns early                        | Clean                               |
| Dialog cancellation (import)             | YES     | Returns early                        | Clean                               |
| File write failure                       | YES     | Caught with error message            | Clean                               |
| File read failure                        | YES     | Caught with error message            | Clean                               |
| ISecretStorage.get() throws              | YES     | Per-key catch, logged                | Clean                               |
| ISecretStorage.store() throws            | YES     | Per-key catch, recorded in errors    | Clean                               |
| Existing credentials (no overwrite)      | YES     | Skipped, recorded                    | Clean                               |
| Empty string secret value                | PARTIAL | Treated as falsy, skipped            | Could be intentional value          |
| `config` field is not an object          | NO      | No validation                        | Could throw at runtime              |
| `providerKeys` has **proto** key         | NO      | Stored as secret key                 | Pollutes secret storage             |
| Very large export file                   | PARTIAL | JSON.parse handles it                | No size limit check                 |
| Concurrent export/import                 | NO      | No mutex/lock                        | Unlikely but possible               |
| Rapid double-click on export             | NO      | No debounce                          | Two dialogs shown                   |

---

## Integration Risk Assessment

| Integration                            | Failure Probability | Impact                       | Mitigation                      |
| -------------------------------------- | ------------------- | ---------------------------- | ------------------------------- |
| ISecretStorage.get/store               | LOW                 | High (data loss)             | Per-key error handling exists   |
| IWorkspaceProvider.getConfiguration    | LOW                 | Low (config only)            | Per-key error handling exists   |
| Electron dialog.showSaveDialog         | LOW                 | None (user can retry)        | Cancellation handled            |
| VS Code showSaveDialog/showOpenDialog  | LOW                 | None (user can retry)        | Cancellation handled            |
| JSON.parse on import                   | MEDIUM              | Medium (bad file selected)   | Caught with clear error         |
| File write on export                   | LOW                 | Medium (permissions)         | Caught with error message       |
| DI resolution of SettingsExportService | LOW                 | Medium (feature unavailable) | Wrapped in try/catch in main.ts |

---

## Verdict

**Recommendation**: NEEDS_REVISION
**Confidence**: HIGH
**Top Risk**: VS Code session import limit still hardcoded to 5 (directly contradicts task requirement) + imported config values are dead data (misleads users)

### What Must Be Fixed Before Approval:

1. **`D:\projects\ptah-extension\apps\ptah-extension-vscode\src\main.ts:673`**: Change `scanAndImport(workspacePath, 5)` to `scanAndImport(workspacePath, 50)` or remove explicit limit. This is the core deliverable of the session auto-discovery enhancement.

2. **`D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\electron-settings-rpc.handlers.ts`**: Add security warning dialog before export proceeds. The implementation plan explicitly mandates this.

3. **`D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\settings-import.service.ts`**: Either implement a consumer for `ptah.importedConfig` or stop reporting config keys as "imported" in the result summary. Users should not be told something was imported when it has no effect.

### What Should Be Fixed (Serious but not blocking):

4. Add provider ID validation in `importSecret` loop for `providerKeys`
5. Add `config` field validation in `validateExportData()`
6. Merge config bundles at key level instead of all-or-nothing
7. Fix `as unknown as Error` logger hack in Electron handler

### What Robust Implementation Would Include

A production-hardened version of this feature would additionally have:

- **Unit tests** for all validation paths, overwrite/skip logic, empty exports, malformed inputs
- **Integration tests** verifying round-trip export-then-import preserves all values
- **Config import consumer** in both platform startup paths that reads `ptah.importedConfig` and applies values to the workspace configuration
- **Size limits** on imported JSON files to prevent memory issues with extremely large files
- **Debounce** on VS Code command execution to prevent double-click issues
- **Audit logging** of import/export events (timestamp, what was imported, from which platform) for support diagnostics
- **`ptah.llm.{provider}.apiKey`** coverage in the export to capture all known secret patterns
- **Shared `countExportedSecrets` utility** instead of 3 copies
