# Development Tasks - TASK_2025_203: Unify RPC Handler Architecture

**Total Tasks**: 25 | **Batches**: 5 | **Status**: 0/5 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- IWorkspaceProvider exists and is registered on both platforms: VERIFIED (PLATFORM_TOKENS.WORKSPACE_PROVIDER in platform-core/src/tokens.ts)
- ICommandRegistry exists with executeCommand(): VERIFIED (platform-core/src/interfaces/command-registry.interface.ts)
- Tier 1 handlers have no vscode import: VERIFIED (grep confirms session, context, autocomplete, subagent, llm, plugin, ptah-cli are clean)
- RpcHandler + TOKENS available from vscode-core: VERIFIED (libs/backend/vscode-core/src/index.ts lines 6, 66)
- VS Code RpcMethodRegistrationService uses .register() pattern: VERIFIED (lines 123-143)
- Electron has 2475-line procedural file: VERIFIED (wc -l confirms)
- IWorkspaceProvider.getWorkspaceRoot() exists: VERIFIED (returns string | undefined)
- IWorkspaceProvider.getWorkspaceFolders() returns string[]: VERIFIED (not {uri:{fsPath:string}}[] as some handler code assumes)

### Risks Identified

| Risk                                                                                                                       | Severity | Mitigation                                                                           |
| -------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------ |
| IWorkspaceProvider.getWorkspaceFolders() returns string[] but handlers use vscode pattern `workspaceFolders[0].uri.fsPath` | HIGH     | Refactored handlers must use getWorkspaceRoot() or getWorkspaceFolders()[0] directly |
| ChatRpcHandlers is ~1500 lines with 6+ library imports - complex move                                                      | MED      | Move last in Batch 3, verify all imports resolve from library path                   |
| ConfigManager.set() target param removal may change VS Code behavior                                                       | MED      | Verify ConfigManager defaults to Workspace target; test config writes                |
| Electron inline handlers may have subtle behavioral differences                                                            | MED      | Developer must compare each Electron inline impl with VS Code class before delete    |
| LlmRpcHandlers name collision: library has llm-rpc-handlers.ts (interface), app has llm-rpc.handlers.ts (impl)             | LOW      | Use distinct filename: llm-rpc.handlers-app.ts in library as plan specifies          |

### Edge Cases to Handle

- [ ] Handler DI resolution when moved to library layer (vscode-core cannot depend on agent-sdk circular) -> Handled in Batch 1 notes
- [ ] IWorkspaceProvider API mismatch (string[] vs {uri:{fsPath}} pattern) -> Handled in Batch 3/4 refactoring
- [ ] Electron inline methods that have NO corresponding VS Code handler class -> Keep in Electron-specific handlers

---

## Batch 1: Move Tier 1 Handlers (Zero Refactoring) -- IMPLEMENTED

**Developer**: backend-developer
**Tasks**: 6 | **Dependencies**: None

### Task 1.1: Create shared handler directory and barrel export -- IMPLEMENTED

**Action**: CREATE
**Files**:

- CREATE: `D:\projects\ptah-extension\libs\backend\vscode-core\src\rpc\handlers\index.ts`

**Spec Reference**: implementation-plan.md:193-201
**Pattern to Follow**: `libs/backend/vscode-core/src/rpc/llm-rpc-handlers.ts` (existing library handler)

**Implementation Details**:

- Create `libs/backend/vscode-core/src/rpc/handlers/` directory
- Create barrel `index.ts` that will re-export all shared handler classes
- Initially empty, will be populated as handlers are moved in subsequent tasks

---

### Task 1.2: Copy 7 Tier 1 handlers to library -- IMPLEMENTED

**Action**: CREATE
**Files**:

- CREATE: `D:\projects\ptah-extension\libs\backend\vscode-core\src\rpc\handlers\session-rpc.handlers.ts`
- CREATE: `D:\projects\ptah-extension\libs\backend\vscode-core\src\rpc\handlers\context-rpc.handlers.ts`
- CREATE: `D:\projects\ptah-extension\libs\backend\vscode-core\src\rpc\handlers\autocomplete-rpc.handlers.ts`
- CREATE: `D:\projects\ptah-extension\libs\backend\vscode-core\src\rpc\handlers\subagent-rpc.handlers.ts`
- CREATE: `D:\projects\ptah-extension\libs\backend\vscode-core\src\rpc\handlers\llm-rpc.handlers-app.ts`
- CREATE: `D:\projects\ptah-extension\libs\backend\vscode-core\src\rpc\handlers\plugin-rpc.handlers.ts`
- CREATE: `D:\projects\ptah-extension\libs\backend\vscode-core\src\rpc\handlers\ptah-cli-rpc.handlers.ts`

**Spec Reference**: implementation-plan.md:193-200
**Pattern to Follow**: Each handler from `apps/ptah-extension-vscode/src/services/rpc/handlers/`

**Quality Requirements**:

- Copy each handler file verbatim (they have NO vscode imports)
- Verify all imports resolve from library paths (e.g., `@ptah-extension/vscode-core`, `@ptah-extension/agent-sdk`, `@ptah-extension/shared`)
- If any handler imports from `../../` or relative app paths, those imports MUST be changed to library import paths
- Update barrel `index.ts` to export all 7 handlers

**Validation Notes**:

- These handlers are confirmed to have zero `import * as vscode` statements
- However, verify they don't have sneaky relative imports to app-layer code
- The LlmRpcHandlers file is named `llm-rpc.handlers-app.ts` to avoid collision with existing `llm-rpc-handlers.ts` (the backend interface file)

---

### Task 1.3: Update vscode-core index.ts to export shared handlers -- IMPLEMENTED

**Action**: MODIFY
**Files**:

- MODIFY: `D:\projects\ptah-extension\libs\backend\vscode-core\src\index.ts`

**Spec Reference**: implementation-plan.md:203
**Pattern to Follow**: Existing export pattern at line 82 (`export { LlmRpcHandlers } from './rpc/llm-rpc-handlers'`)

**Implementation Details**:

- Add exports for all 7 Tier 1 handler classes from `./rpc/handlers`
- Use a section comment: `// Shared RPC Handlers (TASK_2025_203)`
- Export each class individually (not `export * from`) for tree-shaking

---

### Task 1.4: Update VS Code app to import handlers from library -- IMPLEMENTED

**Action**: MODIFY + DELETE
**Files**:

- MODIFY: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\index.ts`
- DELETE: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\session-rpc.handlers.ts`
- DELETE: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\context-rpc.handlers.ts`
- DELETE: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\autocomplete-rpc.handlers.ts`
- DELETE: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\subagent-rpc.handlers.ts`
- DELETE: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\plugin-rpc.handlers.ts`
- DELETE: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\ptah-cli-rpc.handlers.ts`

**Spec Reference**: implementation-plan.md:204-216

**Implementation Details**:

- In VS Code `handlers/index.ts`, change the 7 handler exports to re-export from `@ptah-extension/vscode-core`
- Example: `export { SessionRpcHandlers } from '@ptah-extension/vscode-core';`
- Delete the 6 original handler files from the app (NOTE: llm-rpc.handlers.ts stays because it re-exports and VS Code orchestrator imports from handlers/index.ts)
- The VS Code `RpcMethodRegistrationService` imports from `./handlers/` so the re-exports maintain compatibility

**Validation Notes**:

- Do NOT delete llm-rpc.handlers.ts from VS Code app yet - there may be VS Code-specific LLM handler logic. Verify first.

---

### Task 1.5: Register shared Tier 1 handlers in Electron DI + orchestrator -- IMPLEMENTED

**Action**: MODIFY
**Files**:

- MODIFY: `D:\projects\ptah-extension\apps\ptah-electron\src\di\container.ts`
- MODIFY: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\rpc-method-registration.service.ts`

**Spec Reference**: implementation-plan.md:207-208

**Implementation Details**:

- In Electron `container.ts`: Register the 7 shared handler classes as singletons using `container.registerSingleton(HandlerClass)` or factory pattern
- In Electron `rpc-method-registration.service.ts`: For the 7 Tier 1 methods, replace inline implementations with calls to shared handler `.register()` method
- Import shared handlers from `@ptah-extension/vscode-core`
- Keep the remaining inline Electron implementations untouched for now

**Validation Notes**:

- Electron DI container must have all dependencies these handlers need (TOKENS.RPC_HANDLER, TOKENS.LOGGER, SDK_TOKENS.\*, etc.)
- Check that Electron already registers these dependency tokens before adding handler registrations
- The handlers use `@injectable()` + `@inject()` decorators - ensure tsyringe reflect-metadata is loaded in Electron

---

### Task 1.6: Verify Batch 1 builds -- IMPLEMENTED

**Action**: VERIFY
**Commands**:

- `npx nx run vscode-core:build` (library compiles with new handler exports)
- `npx nx run ptah-extension-vscode:build` (VS Code app builds with re-exports)
- `npx nx run ptah-electron:build` (Electron app builds with shared handlers)

**Quality Requirements**:

- Zero TypeScript errors
- No circular dependency warnings
- All 7 handlers properly exported and importable

---

**Batch 1 Verification**:

- All 7 handler files exist in `libs/backend/vscode-core/src/rpc/handlers/`
- VS Code app handler index re-exports from library
- Electron DI container registers shared handlers
- Build passes: `npx nx run vscode-core:build` + `npx nx run ptah-extension-vscode:build` + `npx nx run ptah-electron:build`
- code-logic-reviewer approved

---

## Batch 2: Create Platform Abstraction Interfaces + Implementations -- IMPLEMENTED

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batch 1 complete

### Task 2.1: Add new platform tokens to vscode-core TOKENS -- IMPLEMENTED

**Action**: CREATE + MODIFY
**Files**:

- MODIFY: `D:\projects\ptah-extension\libs\backend\vscode-core\src\di\tokens.ts`

**Spec Reference**: implementation-plan.md:114-177, 220

**Implementation Details**:

- Add 4 new tokens to the TOKENS namespace:
  - `PLATFORM_COMMANDS: Symbol.for('PlatformCommands')` - for IPlatformCommands
  - `PLATFORM_AUTH_PROVIDER: Symbol.for('PlatformAuthProvider')` - for IPlatformAuthProvider
  - `SAVE_DIALOG_PROVIDER: Symbol.for('SaveDialogProvider')` - for ISaveDialogProvider
  - `MODEL_DISCOVERY: Symbol.for('ModelDiscovery')` - for IModelDiscovery
- Add under a new section comment: `// Platform Abstraction Tokens (TASK_2025_203)`
- Also define and export the 4 TypeScript interfaces in a new file

**Validation Notes**:

- Symbol.for() descriptions MUST be globally unique across all token files
- Check existing PLATFORM_TOKENS in platform-core to avoid collision

---

### Task 2.2: Create platform abstraction interfaces file -- IMPLEMENTED

**Action**: CREATE
**Files**:

- CREATE: `D:\projects\ptah-extension\libs\backend\vscode-core\src\rpc\platform-abstractions.ts`

**Spec Reference**: implementation-plan.md:118-177

**Implementation Details**:

- Define 4 interfaces:
  - `IPlatformCommands` with `reloadWindow(): Promise<void>` and `openTerminal(name: string, command: string): void`
  - `IPlatformAuthProvider` with `getGitHubUsername(): Promise<string | undefined>`
  - `ISaveDialogProvider` with `showSaveAndWrite(options: { defaultFilename: string; filters: Record<string, string[]>; title: string; content: Buffer }): Promise<string | null>`
  - `IModelDiscovery` with `getCopilotModels()` and `getCodexModels()` returning `Promise<Array<{ id: string; name: string; contextLength: number }>>`
- Export all interfaces
- Update `libs/backend/vscode-core/src/index.ts` to export these interfaces

---

### Task 2.3: Create VS Code platform implementations -- IMPLEMENTED

**Action**: CREATE
**Files**:

- CREATE: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\platform\vscode-platform-commands.ts`
- CREATE: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\platform\vscode-platform-auth.ts`
- CREATE: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\platform\vscode-save-dialog.ts`
- CREATE: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\platform\vscode-model-discovery.ts`
- CREATE: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\platform\index.ts`

**Spec Reference**: implementation-plan.md:128-129, 144-145, 162-163, 179-180

**Implementation Details**:

- `VsCodePlatformCommands`: `reloadWindow()` calls `vscode.commands.executeCommand('workbench.action.reloadWindow')`, `openTerminal()` calls `vscode.window.createTerminal()`
- `VsCodePlatformAuth`: `getGitHubUsername()` calls `vscode.authentication.getSession('github', ['user:email'], { createIfNone: false })`
- `VsCodeSaveDialog`: `showSaveAndWrite()` calls `vscode.window.showSaveDialog()` + `vscode.workspace.fs.writeFile()`
- `VsCodeModelDiscovery`: `getCopilotModels()`/`getCodexModels()` call `vscode.lm.selectChatModels()` with appropriate vendor filter
- All classes use `@injectable()` decorator
- Barrel export from `index.ts`

---

### Task 2.4: Create Electron platform implementations -- IMPLEMENTED

**Action**: CREATE
**Files**:

- CREATE: `D:\projects\ptah-extension\apps\ptah-electron\src\services\platform\electron-platform-commands.ts`
- CREATE: `D:\projects\ptah-extension\apps\ptah-electron\src\services\platform\electron-platform-auth.ts`
- CREATE: `D:\projects\ptah-extension\apps\ptah-electron\src\services\platform\electron-save-dialog.ts`
- CREATE: `D:\projects\ptah-extension\apps\ptah-electron\src\services\platform\electron-model-discovery.ts`
- CREATE: `D:\projects\ptah-extension\apps\ptah-electron\src\services\platform\index.ts`

**Spec Reference**: implementation-plan.md:129-130, 145, 163-164, 180

**Implementation Details**:

- `ElectronPlatformCommands`: `reloadWindow()` calls `app.relaunch()` + `app.exit()`, `openTerminal()` is no-op with logger.warn
- `ElectronPlatformAuth`: `getGitHubUsername()` returns `undefined` (Copilot auth not available)
- `ElectronSaveDialog`: `showSaveAndWrite()` uses Electron `dialog.showSaveDialog()` + Node `fs.writeFile()`
- `ElectronModelDiscovery`: Returns empty arrays (VS Code LM API not available)
- All classes use `@injectable()` decorator
- Barrel export from `index.ts`

---

### Task 2.5: Register platform implementations in DI containers -- IMPLEMENTED

**Action**: MODIFY
**Files**:

- MODIFY: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\di\container.ts`
- MODIFY: `D:\projects\ptah-extension\apps\ptah-electron\src\di\container.ts`
- MODIFY: `D:\projects\ptah-extension\libs\backend\vscode-core\src\index.ts`

**Spec Reference**: implementation-plan.md:231-235

**Implementation Details**:

- VS Code container: Register 4 implementations against TOKENS (e.g., `container.register(TOKENS.PLATFORM_COMMANDS, { useClass: VsCodePlatformCommands })`)
- Electron container: Register 4 implementations against same TOKENS
- vscode-core index.ts: Export the 4 interface types and new tokens

**Validation Notes**:

- Both containers must register the SAME token symbols
- Verify registration happens BEFORE handler classes that will depend on these tokens (Phase 3)

---

**Batch 2 Verification**:

- 4 interfaces defined in vscode-core
- 4 VS Code implementations created and registered
- 4 Electron implementations created and registered
- 4 new tokens added to TOKENS namespace
- Build passes: `npx nx run vscode-core:build` + `npx nx run ptah-extension-vscode:build` + `npx nx run ptah-electron:build`
- code-logic-reviewer approved

---

## Batch 3: Move Tier 2 Handlers - First 5 (Chat, Setup, Wizard, Config, License) -- IMPLEMENTED

**Developer**: backend-developer
**Tasks**: 6 | **Dependencies**: Batch 2 complete

### Task 3.1: Refactor + move SetupRpcHandlers -- IMPLEMENTED

**Action**: CREATE + DELETE
**Files**:

- CREATE: `D:\projects\ptah-extension\libs\backend\vscode-core\src\rpc\handlers\setup-rpc.handlers.ts`
- DELETE: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\setup-rpc.handlers.ts`
- MODIFY: `D:\projects\ptah-extension\libs\backend\vscode-core\src\rpc\handlers\index.ts`
- MODIFY: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\index.ts`

**Spec Reference**: implementation-plan.md:243-244

**Implementation Details**:

- Replace 5 occurrences of `vscode.workspace.workspaceFolders` with `IWorkspaceProvider` injected via `@inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)`
- CRITICAL: `IWorkspaceProvider.getWorkspaceFolders()` returns `string[]`, NOT `{uri:{fsPath:string}}[]` - adjust all access patterns
- Use `this.workspaceProvider.getWorkspaceRoot()` for the common `workspaceFolders?.[0]?.uri.fsPath` pattern
- Remove `import * as vscode from 'vscode'`
- Import `PLATFORM_TOKENS` from `@ptah-extension/platform-core`
- Add to library barrel export and VS Code re-export

---

### Task 3.2: Refactor + move WizardGenerationRpcHandlers -- IMPLEMENTED

**Action**: CREATE + DELETE
**Files**:

- CREATE: `D:\projects\ptah-extension\libs\backend\vscode-core\src\rpc\handlers\wizard-generation-rpc.handlers.ts`
- DELETE: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\wizard-generation-rpc.handlers.ts`
- MODIFY: `D:\projects\ptah-extension\libs\backend\vscode-core\src\rpc\handlers\index.ts`
- MODIFY: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\index.ts`

**Spec Reference**: implementation-plan.md:245

**Implementation Details**:

- Replace 3 occurrences of `vscode.workspace.workspaceFolders` with `IWorkspaceProvider`
- Same API mismatch handling as Task 3.1 (string[] vs {uri:{fsPath}})
- Remove `import * as vscode from 'vscode'`
- Inject `PLATFORM_TOKENS.WORKSPACE_PROVIDER`

---

### Task 3.3: Refactor + move ConfigRpcHandlers -- IMPLEMENTED

**Action**: CREATE + DELETE
**Files**:

- CREATE: `D:\projects\ptah-extension\libs\backend\vscode-core\src\rpc\handlers\config-rpc.handlers.ts`
- DELETE: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\config-rpc.handlers.ts`
- MODIFY: `D:\projects\ptah-extension\libs\backend\vscode-core\src\rpc\handlers\index.ts`
- MODIFY: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\index.ts`

**Spec Reference**: implementation-plan.md:248-249

**Implementation Details**:

- Remove `vscode.ConfigurationTarget.Workspace` option from `configManager.set()` calls
- The ConfigManager interface does not require target param (Electron shim ignores it)
- VS Code ConfigManager defaults to Workspace target when none specified - VERIFY THIS
- Remove `import * as vscode from 'vscode'`

**Validation Notes**:

- RISK: Verify VS Code ConfigManager.set() defaults are acceptable without explicit target
- Check `libs/backend/vscode-core/src/config/config-manager.ts` for default behavior

---

### Task 3.4: Refactor + move LicenseRpcHandlers -- IMPLEMENTED

**Action**: CREATE + DELETE
**Files**:

- CREATE: `D:\projects\ptah-extension\libs\backend\vscode-core\src\rpc\handlers\license-rpc.handlers.ts`
- DELETE: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\license-rpc.handlers.ts`
- MODIFY: `D:\projects\ptah-extension\libs\backend\vscode-core\src\rpc\handlers\index.ts`
- MODIFY: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\index.ts`

**Spec Reference**: implementation-plan.md:250-251

**Implementation Details**:

- Replace `vscode.commands.executeCommand('workbench.action.reloadWindow')` with `IPlatformCommands.reloadWindow()`
- Inject `TOKENS.PLATFORM_COMMANDS` via `@inject(TOKENS.PLATFORM_COMMANDS)`
- Remove `import * as vscode from 'vscode'`

---

### Task 3.5: Refactor + move ChatRpcHandlers -- IMPLEMENTED

**Action**: CREATE + DELETE
**Files**:

- CREATE: `D:\projects\ptah-extension\libs\backend\vscode-core\src\rpc\handlers\chat-rpc.handlers.ts`
- DELETE: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\chat-rpc.handlers.ts`
- MODIFY: `D:\projects\ptah-extension\libs\backend\vscode-core\src\rpc\handlers\index.ts`
- MODIFY: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\index.ts`

**Spec Reference**: implementation-plan.md:242-243

**Implementation Details**:

- Replace 1 occurrence of `vscode.workspace.workspaceFolders?.[0]?.uri.fsPath` with `IWorkspaceProvider.getWorkspaceRoot()`
- Inject `PLATFORM_TOKENS.WORKSPACE_PROVIDER`
- Remove `import * as vscode from 'vscode'`
- This is the LARGEST handler (~1500 lines) - verify ALL imports resolve from library paths
- Carefully check for any other vscode.\* usages beyond the one documented

**Validation Notes**:

- HIGH RISK: Large file with many imports from agent-sdk, agent-generation, shared, etc.
- All those libraries are already vscode-core dependencies, so imports should resolve
- Do a thorough grep for `vscode.` in the copied file to catch any missed usages

---

### Task 3.6: Register Batch 3 handlers in Electron -- IMPLEMENTED

**Action**: MODIFY
**Files**:

- MODIFY: `D:\projects\ptah-extension\apps\ptah-electron\src\di\container.ts`
- MODIFY: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\rpc-method-registration.service.ts`

**Implementation Details**:

- Register 5 new shared handler classes in Electron DI container
- Replace corresponding inline implementations in Electron RPC file with shared handler `.register()` calls
- For each handler, find the matching inline method registrations and remove them

---

**Batch 3 Verification**:

- 5 handler files exist in library with zero vscode imports
- VS Code app re-exports from library
- Electron registers and uses shared handlers
- Build passes: `npx nx run vscode-core:build` + `npx nx run ptah-extension-vscode:build` + `npx nx run ptah-electron:build`
- code-logic-reviewer approved
- IWorkspaceProvider API mismatch handled correctly (string[] not {uri:{fsPath}})

---

## Batch 4: Move Tier 2 Handlers - Remaining 4 (Auth, EnhancedPrompts, Quality, Provider) -- IMPLEMENTED

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batch 3 complete

### Task 4.1: Refactor + move AuthRpcHandlers -- IMPLEMENTED

**Action**: CREATE + DELETE
**Files**:

- CREATE: `D:\projects\ptah-extension\libs\backend\vscode-core\src\rpc\handlers\auth-rpc.handlers.ts`
- DELETE: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\auth-rpc.handlers.ts`
- MODIFY: `D:\projects\ptah-extension\libs\backend\vscode-core\src\rpc\handlers\index.ts`
- MODIFY: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\index.ts`

**Spec Reference**: implementation-plan.md:252-253

**Implementation Details**:

- Replace `vscode.window.createTerminal()` with `IPlatformCommands.openTerminal(name, command)`
- Replace `vscode.authentication.getSession('github', ...)` with `IPlatformAuthProvider.getGitHubUsername()`
- Inject `TOKENS.PLATFORM_COMMANDS` and `TOKENS.PLATFORM_AUTH_PROVIDER`
- Remove `import * as vscode from 'vscode'`

---

### Task 4.2: Refactor + move EnhancedPromptsRpcHandlers -- IMPLEMENTED

**Action**: CREATE + DELETE
**Files**:

- CREATE: `D:\projects\ptah-extension\libs\backend\vscode-core\src\rpc\handlers\enhanced-prompts-rpc.handlers.ts`
- DELETE: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\enhanced-prompts-rpc.handlers.ts`
- MODIFY: `D:\projects\ptah-extension\libs\backend\vscode-core\src\rpc\handlers\index.ts`
- MODIFY: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\index.ts`

**Spec Reference**: implementation-plan.md:254-255

**Implementation Details**:

- Replace `vscode.workspace.workspaceFolders` with `IWorkspaceProvider.getWorkspaceRoot()`
- Replace `vscode.window.showSaveDialog()` + `vscode.workspace.fs.writeFile()` with `ISaveDialogProvider.showSaveAndWrite()`
- Inject `PLATFORM_TOKENS.WORKSPACE_PROVIDER` and `TOKENS.SAVE_DIALOG_PROVIDER`
- Remove `import * as vscode from 'vscode'`

---

### Task 4.3: Refactor + move QualityRpcHandlers -- IMPLEMENTED

**Action**: CREATE + DELETE
**Files**:

- CREATE: `D:\projects\ptah-extension\libs\backend\vscode-core\src\rpc\handlers\quality-rpc.handlers.ts`
- DELETE: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\quality-rpc.handlers.ts`
- MODIFY: `D:\projects\ptah-extension\libs\backend\vscode-core\src\rpc\handlers\index.ts`
- MODIFY: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\index.ts`

**Spec Reference**: implementation-plan.md:256-257

**Implementation Details**:

- Replace `vscode.workspace.workspaceFolders` (3 occurrences) with `IWorkspaceProvider`
- Replace `vscode.window.showSaveDialog()` + `vscode.workspace.fs.writeFile()` + `vscode.Uri.joinPath()` with `ISaveDialogProvider.showSaveAndWrite()`
- Inject `PLATFORM_TOKENS.WORKSPACE_PROVIDER` and `TOKENS.SAVE_DIALOG_PROVIDER`
- Remove `import * as vscode from 'vscode'`

---

### Task 4.4: Refactor + move ProviderRpcHandlers -- IMPLEMENTED

**Action**: CREATE + DELETE
**Files**:

- CREATE: `D:\projects\ptah-extension\libs\backend\vscode-core\src\rpc\handlers\provider-rpc.handlers.ts`
- DELETE: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\provider-rpc.handlers.ts`
- MODIFY: `D:\projects\ptah-extension\libs\backend\vscode-core\src\rpc\handlers\index.ts`
- MODIFY: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\index.ts`

**Spec Reference**: implementation-plan.md:258-259

**Implementation Details**:

- Replace `vscode.lm.selectChatModels()` (Copilot/Codex dynamic fetcher) with `IModelDiscovery.getCopilotModels()` / `getCodexModels()`
- Inject `TOKENS.MODEL_DISCOVERY`
- Remove `import * as vscode from 'vscode'`
- Dynamic model fetcher registration must use injected discovery service instead of direct VS Code LM API

---

### Task 4.5: Register Batch 4 handlers in Electron -- IMPLEMENTED

**Action**: MODIFY
**Files**:

- MODIFY: `D:\projects\ptah-extension\apps\ptah-electron\src\di\container.ts`
- MODIFY: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\rpc-method-registration.service.ts`

**Implementation Details**:

- Register 4 new shared handler classes in Electron DI container
- Replace corresponding inline implementations in Electron RPC file
- After this batch, the Electron RPC file should have significantly fewer inline methods

---

**Batch 4 Verification**:

- 4 handler files exist in library with zero vscode imports
- All platform abstraction injections use correct tokens
- VS Code app re-exports from library
- Electron registers and uses shared handlers
- Build passes: `npx nx run vscode-core:build` + `npx nx run ptah-extension-vscode:build` + `npx nx run ptah-electron:build`
- code-logic-reviewer approved

---

## Batch 5: Electron Orchestrator + Eliminate Procedural File + VS Code Cleanup -- IMPLEMENTED

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batch 4 complete

### Task 5.1: Create Electron-specific handler classes -- IMPLEMENTED

**Action**: CREATE
**Files**:

- CREATE: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\electron-file-rpc.handlers.ts`
- CREATE: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\electron-command-rpc.handlers.ts`
- CREATE: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\electron-agent-rpc.handlers.ts`
- CREATE: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\index.ts`

**Spec Reference**: implementation-plan.md:285-288

**Implementation Details**:

- `ElectronFileRpcHandlers`: Electron-specific file:open using `shell.openPath`, file:openInEditor (no-op or basic)
- `ElectronCommandRpcHandlers`: Electron-specific command:execute (limited command set)
- `ElectronAgentRpcHandlers`: Electron-specific agent config using Electron store instead of vscode.workspace.getConfiguration
- Each class follows the same `@injectable()` + `register()` pattern as shared handlers
- Extract relevant inline code from the 2475-line file into these classes

**Quality Requirements**:

- Must handle ALL agent:_, file:_, command:\* methods that are currently inline in the Electron RPC file
- No methods can be lost in the migration

---

### Task 5.2: Rewrite Electron RPC orchestrator -- IMPLEMENTED

**Action**: REWRITE
**Files**:

- REWRITE: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\rpc-method-registration.service.ts`
- MODIFY: `D:\projects\ptah-extension\apps\ptah-electron\src\di\container.ts`
- MODIFY: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\rpc-handler-setup.ts` (if needed)
- MODIFY: `D:\projects\ptah-extension\apps\ptah-electron\src\main.ts` (update RPC registration call if signature changes)

**Spec Reference**: implementation-plan.md:283-291

**Implementation Details**:

- Replace 2475-line procedural `registerExtendedRpcMethods()` function with a class-based `ElectronRpcMethodRegistrationService`
- Pattern: Mirror VS Code's `RpcMethodRegistrationService` (~150 lines)
- Import shared handlers from `@ptah-extension/vscode-core`
- Import Electron-specific handlers from local `./handlers/`
- `registerAll()` method calls `.register()` on each handler
- Keep any Electron-specific setup (SDK callbacks, generation guard) in the orchestrator
- Register the orchestrator in Electron DI container

**Quality Requirements**:

- EVERY RPC method currently registered in the 2475-line file must be accounted for (either in shared handlers or Electron-specific handlers)
- Do a method audit: list all `rpcHandler.registerMethod()` calls in old file, verify each is covered
- The `isGenerating` guard and `checkAndResetStaleness` can stay as module-level or move to a shared utility

**Validation Notes**:

- HIGH RISK: This is the most critical task. Missing methods = broken features
- Compare registered method names between old file and new orchestrator + all handler .register() calls

---

### Task 5.3: Final VS Code orchestrator cleanup -- IMPLEMENTED

**Action**: MODIFY
**Files**:

- MODIFY: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\rpc-method-registration.service.ts`
- MODIFY: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\index.ts`

**Spec Reference**: implementation-plan.md:295-299

**Implementation Details**:

- Update VS Code `RpcMethodRegistrationService` to import shared handlers from `@ptah-extension/vscode-core` (via handlers/index.ts re-exports - should already work from earlier batches)
- Clean up VS Code `handlers/index.ts`: Keep only Tier 3 handlers locally (File, Command, Agent) + re-exports from library for all shared handlers
- Verify no dead imports or unused local handler files remain

---

**Batch 5 Verification**:

- Electron RPC file reduced from 2475 lines to ~150 lines orchestrator
- 3 Electron-specific handler classes created
- ALL RPC methods accounted for (method audit)
- VS Code handlers/index.ts only has Tier 3 local + library re-exports
- Build passes: `npx nx run vscode-core:build` + `npx nx run ptah-extension-vscode:build` + `npx nx run ptah-electron:build`
- code-logic-reviewer approved
- No regressions in method registration

---

## Summary

| Batch | Name                                                     | Tasks | Developer         | Dependencies |
| ----- | -------------------------------------------------------- | ----- | ----------------- | ------------ |
| 1     | Move Tier 1 Handlers (Zero Refactoring)                  | 6     | backend-developer | None         |
| 2     | Create Platform Abstraction Interfaces + Implementations | 5     | backend-developer | Batch 1      |
| 3     | Move Tier 2 Handlers - First 5                           | 6     | backend-developer | Batch 2      |
| 4     | Move Tier 2 Handlers - Remaining 4                       | 5     | backend-developer | Batch 3      |
| 5     | Electron Orchestrator + Cleanup                          | 3     | backend-developer | Batch 4      |

**Files Created**: ~28 files
**Files Deleted**: ~16 handler files from VS Code app
**Files Modified**: ~10 files (DI containers, indexes, orchestrators)
**Files Rewritten**: 1 (Electron 2475-line file -> ~150-line orchestrator)
