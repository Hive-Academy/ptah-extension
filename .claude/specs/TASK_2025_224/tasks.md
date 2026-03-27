# Development Tasks - TASK_2025_224: Fix Platform Abstraction Gaps

**Total Tasks**: 17 | **Batches**: 4 | **Status**: 4/4 complete

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- `IWorkspaceProvider.getConfiguration<T>(section, key, defaultValue)` exists at `workspace-provider.interface.ts:34-38`: VERIFIED
- `IWorkspaceProvider.getWorkspaceRoot()` exists at `workspace-provider.interface.ts:24`: VERIFIED
- `PLATFORM_TOKENS.WORKSPACE_PROVIDER` token exists at `tokens.ts:25`: VERIFIED
- `IPlatformInfo.extensionPath` exists at `platform.types.ts:178`: VERIFIED
- `IUserInteraction.showInformationMessage()` exists at `user-interaction.interface.ts:42-44`: VERIFIED
- `CopilotAuthService` registered at `SDK_TOKENS.SDK_COPILOT_AUTH` in `register.ts:387-388`: VERIFIED
- `AgentProcessManager` registered as singleton in `llm-abstraction/di/register.ts:72-75`: VERIFIED
- `TokenCounterService` uses `vscode.lm.selectChatModels()` at lines 80 and 160: VERIFIED
- `CopilotAuthService` has 5 vscode call sites (import, extensions, version, 2x authentication): VERIFIED
- Existing `platform-core/index.ts` barrel exports types and tokens: VERIFIED

### Risks Identified

| Risk                                                                         | Severity | Mitigation                                                                                            |
| ---------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `gpt-tokenizer` package compatibility with Webpack/esbuild bundlers          | LOW      | Pure JS package with CJS/ESM dual support; test build in Batch 2                                      |
| Device code flow (Batch 3) is new untested code path                         | MEDIUM   | Follows RFC 8628 standard; pattern proven by CodexAuthService; VS Code subclass preserves existing UX |
| `exchangeToken()` visibility change from private to protected                | LOW      | Only VscodeCopilotAuthService subclass uses it; interface unchanged                                   |
| `doRefreshToken()` fallback changes from vscode.authentication to file-based | LOW      | File-based refresh matches CodexAuthService pattern; auth state cleared on failure                    |

### Edge Cases to Handle

- [x] `IWorkspaceProvider.getConfiguration()` may return `undefined` instead of default value -- use `?? defaultValue` pattern -> Handled in Task 1.1
- [x] Copilot hosts.json may have GHES entries (not just `github.com`) -> Handled in Task 3.1
- [x] Device code flow may time out (5 min max) -> Handled in Task 3.2
- [x] `gpt-tokenizer` `encode()` on empty string should return 0 tokens -> Handled in Task 2.5/2.6
- [x] VS Code LM API may return empty models array -> Handled in Task 1.5 (VscodeTokenCounter fallback to gpt-tokenizer)

---

## Batch 1: AgentProcessManager + TokenCounter Infrastructure [COMPLETE]

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: None
**Commit**: d9c99b8b
**Rationale**: Batches 1 and 2 from the architect's plan are independent and both LOW risk. The infrastructure tasks (interface, token, npm install) are combined with the AgentProcessManager refactor since they are small and non-overlapping.

### Task 1.1: Refactor AgentProcessManagerService to use IWorkspaceProvider [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\agent-process-manager.service.ts`
**Spec Reference**: implementation-plan.md:162-274
**Pattern to Follow**: Any of the 20+ services that inject `PLATFORM_TOKENS.WORKSPACE_PROVIDER` (e.g., `workspace-intelligence/workspace.service.ts`)

**Quality Requirements**:

- Remove `import * as vscode from 'vscode'` completely
- Add `@inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER) private readonly workspace: IWorkspaceProvider` as 5th constructor parameter
- Replace all 8 `vscode.*` call sites with `IWorkspaceProvider` methods
- Use `?? defaultValue` pattern since `getConfiguration()` may return `undefined`
- No DI registration changes needed (tsyringe auto-resolves the new parameter)

**Validation Notes**:

- `getConfiguration()` returns `T | undefined`, so always use nullish coalescing (`??`) with the original default values
- The `import * as vscode from 'vscode'` at line 15 should be the ONLY vscode import to remove

**Implementation Details**:

- Add imports: `PLATFORM_TOKENS` and `IWorkspaceProvider` from `@ptah-extension/platform-core`
- 8 replacement sites documented in implementation-plan.md:192-268
- Line 155-158: `resolveReasoningEffort` -- `this.workspace.getConfiguration<string>('ptah.agentOrchestration', effortKey, '') ?? ''`
- Line 165-167: `resolveAutoApprove` -- `this.workspace.getConfiguration<boolean>('ptah.agentOrchestration', 'copilotAutoApprove', true)`
- Line 312-321: doSpawn CLI model resolution -- `this.workspace.getConfiguration<string>('ptah.agentOrchestration', configKey, '') ?? ''`
- Line 463-475: SDK model resolution -- same pattern as above
- Line 1323-1324: `getMaxConcurrentAgents` -- `this.workspace.getConfiguration<number>('ptah.agentOrchestration', 'maxConcurrentAgents', 5) ?? 5`
- Line 1329-1330: `getDefaultCli` -- `this.workspace.getConfiguration<string>('ptah.agentOrchestration', 'defaultCli')`
- Line 1379-1383: `getWorkspaceRoot` -- `this.workspace.getWorkspaceRoot() ?? process.cwd()`
- Line 1463-1465: `resolveMcpPort` -- `this.workspace.getConfiguration<number>('ptah', 'mcpPort', 51820) ?? 51820`

---

### Task 1.2: Create ITokenCounter interface in platform-core [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\platform-core\src\interfaces\token-counter.interface.ts` (CREATE)
**Spec Reference**: implementation-plan.md:294-321
**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\platform-core\src\interfaces\workspace-provider.interface.ts`

**Quality Requirements**:

- Follow existing interface documentation style (JSDoc with `Replaces:` annotation)
- Interface has 2 methods: `countTokens(text: string): Promise<number>` and `getMaxInputTokens(): Promise<number | null>`
- Export as `type` from the interface file

**Implementation Details**:

- Create new file at `libs/backend/platform-core/src/interfaces/token-counter.interface.ts`
- Interface name: `ITokenCounter`
- Follows exact pattern from implementation-plan.md:296-321

---

### Task 1.3: Add TOKEN_COUNTER token and export ITokenCounter [COMPLETE]

**Files**:

- `D:\projects\ptah-extension\libs\backend\platform-core\src\tokens.ts` (MODIFY)
- `D:\projects\ptah-extension\libs\backend\platform-core\src\index.ts` (MODIFY)
  **Spec Reference**: implementation-plan.md:323-340
  **Pattern to Follow**: Existing tokens and exports in the same files

**Quality Requirements**:

- Add `TOKEN_COUNTER: Symbol.for('PlatformTokenCounter')` to `PLATFORM_TOKENS`
- Add `export type { ITokenCounter } from './interfaces/token-counter.interface'` to index.ts
- Place token after PLATFORM_INFO (last existing token)
- Place export after IEditorProvider (last existing interface export)

**Implementation Details**:

- tokens.ts: Add after line 40 (PLATFORM_INFO), before `} as const;`
- index.ts: Add after line 29 (IEditorProvider export)

---

### Task 1.4: Install gpt-tokenizer npm package [COMPLETE]

**File**: `D:\projects\ptah-extension\package.json` (MODIFY via npm install)
**Spec Reference**: implementation-plan.md:284-290

**Quality Requirements**:

- Install `gpt-tokenizer` as a production dependency
- Pure JS package, no native bindings required
- Verify it appears in package.json dependencies after install

**Implementation Details**:

- Run `npm install gpt-tokenizer` from the project root

---

### Task 1.5: Create platform-specific TokenCounter implementations [COMPLETE]

**Files**:

- `D:\projects\ptah-extension\libs\backend\platform-vscode\src\implementations\vscode-token-counter.ts` (CREATE)
- `D:\projects\ptah-extension\libs\backend\platform-electron\src\implementations\electron-token-counter.ts` (CREATE)
  **Spec Reference**: implementation-plan.md:342-408
  **Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\platform-vscode\src\implementations\vscode-workspace-provider.ts`

**Quality Requirements**:

- VscodeTokenCounter: Try `vscode.lm.selectChatModels()` first, fall back to `gpt-tokenizer` `encode()`
- ElectronTokenCounter: Use only `gpt-tokenizer` `encode()`, return `null` for `getMaxInputTokens()`
- Both implement `ITokenCounter` from `@ptah-extension/platform-core`
- Use `import { encode } from 'gpt-tokenizer'` for the tokenizer

**Implementation Details**:

- VS Code impl wraps existing vscode.lm logic with gpt-tokenizer fallback
- Electron impl is pure JS, no vscode import
- Follow code from implementation-plan.md:346-408

---

**Batch 1 Verification**:

- All files exist at specified paths
- `import * as vscode from 'vscode'` removed from agent-process-manager.service.ts
- ITokenCounter interface created and exported
- TOKEN_COUNTER token added
- gpt-tokenizer installed
- Both token counter implementations created
- Build passes: `npx nx build llm-abstraction` and `npx nx build platform-core`
- code-logic-reviewer approved

---

## Batch 2: TokenCounter Wiring + Registration [COMPLETE]

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batch 1
**Commit**: 9c330d02

### Task 2.1: Register TokenCounter implementations in platform containers [COMPLETE]

**Files**:

- `D:\projects\ptah-extension\libs\backend\platform-vscode\src\registration.ts` (MODIFY)
- `D:\projects\ptah-extension\libs\backend\platform-electron\src\registration.ts` (MODIFY)
  **Spec Reference**: implementation-plan.md:411-438
  **Pattern to Follow**: Existing registrations in both files (e.g., Editor Provider registration)

**Quality Requirements**:

- Register using `useValue: new VscodeTokenCounter()` / `new ElectronTokenCounter()`
- Register against `PLATFORM_TOKENS.TOKEN_COUNTER`
- Add import for the implementation class
- Place after Editor Provider registration in both files

**Implementation Details**:

- VS Code registration.ts: Add import + `container.register(PLATFORM_TOKENS.TOKEN_COUNTER, { useValue: new VscodeTokenCounter() })`
- Electron registration.ts: Add import + `container.register(PLATFORM_TOKENS.TOKEN_COUNTER, { useValue: new ElectronTokenCounter() })`

---

### Task 2.2: Refactor TokenCounterService to use ITokenCounter [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\services\token-counter.service.ts` (MODIFY)
**Spec Reference**: implementation-plan.md:441-496
**Pattern to Follow**: AgentProcessManager refactor from Task 1.1 (inject platform token)

**Quality Requirements**:

- Remove `import * as vscode from 'vscode'` and the APPROVED EXCEPTION comment
- Add constructor injection: `@inject(PLATFORM_TOKENS.TOKEN_COUNTER) private readonly tokenCounter: ITokenCounter`
- Replace `countTokensNative()` with `this.tokenCounter.countTokens(text)`
- Replace `getMaxInputTokens()` with `this.tokenCounter.getMaxInputTokens()`
- Remove `countTokensNative()` and `estimateTokens()` private methods (logic moved to ITokenCounter implementations)
- Keep `getCached()`, `setCached()`, `clearCache()`, `dispose()` UNCHANGED

**Validation Notes**:

- The cache layer stays in TokenCounterService -- ITokenCounter is the raw counting backend
- `console.warn` calls in the current file should be removed (ITokenCounter handles its own fallback)

**Implementation Details**:

- Add imports: `inject` from `tsyringe`, `PLATFORM_TOKENS` and `ITokenCounter` from `@ptah-extension/platform-core`
- Simplify `countTokens()` to delegate to `this.tokenCounter.countTokens(text)` (no try/catch needed since ITokenCounter handles fallback)
- Simplify `getMaxInputTokens()` to delegate directly

---

### Task 2.3: Verify TokenCounterService DI registration [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\di\register.ts` (VERIFY, possibly MODIFY)
**Spec Reference**: implementation-plan.md:274 (note about auto-resolution)

**Quality Requirements**:

- Verify that `TokenCounterService` is registered as a class (singleton) so tsyringe auto-resolves the new `@inject()` parameter
- If it uses `registerSingleton(TOKEN, Class)`, no changes needed
- If it uses `useValue: new TokenCounterService()`, update to `useClass` pattern

**Implementation Details**:

- Check registration pattern and ensure the new `@inject(PLATFORM_TOKENS.TOKEN_COUNTER)` constructor parameter will resolve correctly
- The `PLATFORM_TOKENS.TOKEN_COUNTER` is registered in Phase 0 of both containers, so it will be available

---

**Batch 2 Verification**:

- TokenCounter implementations registered in both VS Code and Electron containers
- TokenCounterService refactored -- no `vscode` import
- Build passes: `npx nx build workspace-intelligence`, `npx nx build platform-vscode`, `npx nx build platform-electron`
- code-logic-reviewer approved

---

## Batch 3: CopilotAuthService - Platform-Agnostic Auth [COMPLETE]

**Developer**: backend-developer
**Tasks**: 7 | **Dependencies**: None (independent of Batches 1-2)
**Commit**: 324266f3

### Task 3.1: Create CopilotFileAuth utility [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\copilot-provider\copilot-file-auth.ts` (CREATE)
**Spec Reference**: implementation-plan.md:507-595
**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\codex-provider\codex-auth.service.ts` (file-based auth pattern)

**Quality Requirements**:

- Cross-platform token file path resolution (XDG_CONFIG_HOME, LOCALAPPDATA, ~/.config)
- Read from `hosts.json` format: `{ "github.com": { "oauth_token": "..." } }`
- Support GHES entries (check any host with `oauth_token`, not just `github.com`)
- Return null on any error (file not found, malformed JSON, etc.)
- Export `getCopilotHostsPath()`, `readCopilotToken()`, and `CopilotHostsFile` type

**Implementation Details**:

- Uses `node:fs/promises` for file reading, `node:path` for joining, `node:os` for homedir
- Follow exact implementation from implementation-plan.md:531-595

---

### Task 3.2: Create CopilotDeviceCodeAuth utility [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\copilot-provider\copilot-device-code-auth.ts` (CREATE)
**Spec Reference**: implementation-plan.md:597-759
**Pattern to Follow**: RFC 8628 Device Code Flow standard

**Quality Requirements**:

- Use `axios` for HTTP requests (already a project dependency)
- GitHub Copilot client ID: `Iv1.b507a08c87ecfe98`
- Handle all RFC 8628 error codes: `authorization_pending`, `slow_down`, `expired_token`, `access_denied`
- Maximum 5-minute polling timeout
- Minimum 5-second polling interval
- Export `executeDeviceCodeFlow()`, `DeviceCodeResponse`, `DeviceCodeCallbacks` types

**Validation Notes**:

- This is new code with no existing pattern in the codebase
- The device code flow is standard RFC 8628 used by GitHub for years
- Error handling follows the exact RFC error codes

**Implementation Details**:

- Follow exact implementation from implementation-plan.md:603-759
- Callbacks pattern: `onUserCode` for displaying code, `openBrowser` for launching URL

---

### Task 3.3: Rewrite CopilotAuthService to be platform-agnostic [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\copilot-provider\copilot-auth.service.ts` (REWRITE)
**Spec Reference**: implementation-plan.md:761-894
**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\codex-provider\codex-auth.service.ts`

**Quality Requirements**:

- Remove ALL `import * as vscode from 'vscode'`
- Remove APPROVED EXCEPTION comment
- Change constructor to inject `TOKENS.LOGGER`, `PLATFORM_TOKENS.PLATFORM_INFO`, `PLATFORM_TOKENS.USER_INTERACTION`
- Change `login()` flow: file-based token first -> device code flow fallback
- Change `getHeaders()` to use `getExtensionVersion()` method (reads from package.json via platformInfo.extensionPath)
- Change `exchangeToken()` from `private` to `protected` (for VscodeCopilotAuthService subclass)
- Change `doRefreshToken()` to use `readCopilotToken()` instead of `getGitHubSession(false)`
- Remove `getGitHubSession()` method entirely (moved to VS Code subclass)
- Change `logger` from `private` to `protected` readonly (for subclass access)
- Keep `isAuthenticated()`, `getAuthState()`, `logout()`, `isTokenExpiringSoon()`, `refreshToken()` UNCHANGED
- Keep `exchangeToken()` logic UNCHANGED (only visibility changes)
- Keep `describeToken()` utility function

**Validation Notes**:

- The `ICopilotAuthService` interface is UNCHANGED -- consumers unaffected
- `doRefreshToken()` fallback: try `readCopilotToken()` instead of VS Code session; if both fail, clear auth state

**Implementation Details**:

- New imports: `PLATFORM_TOKENS` from `@ptah-extension/platform-core`, `IPlatformInfo`, `IUserInteraction`
- New imports: `readCopilotToken` from `./copilot-file-auth`, `executeDeviceCodeFlow` from `./copilot-device-code-auth`
- `getExtensionVersion()` reads version from `require(path.join(this.platformInfo.extensionPath, 'package.json')).version`
- `executeDeviceCodeLogin()` private method uses IUserInteraction.showInformationMessage for user code display

---

### Task 3.4: Create VscodeCopilotAuthService subclass [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\copilot-provider\vscode-copilot-auth.service.ts` (CREATE)
**Spec Reference**: implementation-plan.md:896-982
**Pattern to Follow**: Platform-enhanced override pattern (similar to `ElectronSetupWizardService`)

**Quality Requirements**:

- Extends `CopilotAuthService`
- Overrides `login()` only: try VS Code native auth first, then fall back to `super.login()`
- Private `getVscodeGitHubSession()` method with copilot scope + read:user fallback
- Constructor passes through logger, platformInfo, userInteraction to super
- Uses `@injectable()` decorator

**Implementation Details**:

- `import * as vscode from 'vscode'` is allowed here (VS Code-specific subclass)
- login() priority: vscode.authentication -> file-based -> device code
- Follow exact implementation from implementation-plan.md:902-982

---

### Task 3.5: Update agent-sdk DI registration [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\register.ts` (VERIFY)
**Spec Reference**: implementation-plan.md:984-999

**Quality Requirements**:

- The base `CopilotAuthService` registration at `SDK_TOKENS.SDK_COPILOT_AUTH` (line 387-390) should remain UNCHANGED
- The base service is now platform-agnostic, so it works for both VS Code and Electron
- No changes needed here -- VS Code override happens in the VS Code container

**Implementation Details**:

- Verify that the existing registration (`useClass: CopilotAuthService`) still points to the refactored class
- Verify that the new constructor parameters (`PLATFORM_TOKENS.PLATFORM_INFO`, `PLATFORM_TOKENS.USER_INTERACTION`) will auto-resolve

---

### Task 3.6: Override CopilotAuthService in VS Code container [COMPLETE]

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\di\container.ts` (MODIFY)
**Spec Reference**: implementation-plan.md:1003-1022
**Pattern to Follow**: `ElectronSetupWizardService` override pattern in the same file

**Quality Requirements**:

- Add override AFTER `registerSdkServices(container, logger)` call
- Import `VscodeCopilotAuthService` and `SDK_TOKENS` from `@ptah-extension/agent-sdk`
- Register with `useClass: VscodeCopilotAuthService` and `Lifecycle.Singleton`
- Add comment explaining the override purpose

**Implementation Details**:

- `container.register(SDK_TOKENS.SDK_COPILOT_AUTH, { useClass: VscodeCopilotAuthService }, { lifecycle: Lifecycle.Singleton })`
- Place after the `registerSdkServices()` call (around line 397-401)

---

### Task 3.7: Export new files from agent-sdk barrel [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\index.ts` (MODIFY)
**Spec Reference**: implementation-plan.md:1024-1033

**Quality Requirements**:

- Export `VscodeCopilotAuthService` class
- Export `readCopilotToken`, `getCopilotHostsPath` functions
- Export `CopilotHostsFile` type
- Place exports in the existing "Copilot Provider" section (lines 191-204)

**Implementation Details**:

- Add to the Copilot Provider export section:
  - `export { VscodeCopilotAuthService } from './lib/copilot-provider/vscode-copilot-auth.service'`
  - `export { readCopilotToken, getCopilotHostsPath } from './lib/copilot-provider/copilot-file-auth'`
  - `export type { CopilotHostsFile } from './lib/copilot-provider/copilot-file-auth'`

---

**Batch 3 Verification**:

- All 3 new files created (copilot-file-auth.ts, copilot-device-code-auth.ts, vscode-copilot-auth.service.ts)
- CopilotAuthService rewritten with zero vscode imports
- VscodeCopilotAuthService properly extends base class
- VS Code container overrides with VscodeCopilotAuthService
- New exports added to agent-sdk barrel
- Build passes: `npx nx build agent-sdk`
- code-logic-reviewer approved

---

## Batch 4: Integration Cleanup and Verification [COMPLETE]

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batches 1, 2, 3

### Task 4.1: Remove APPROVED EXCEPTION comments [COMPLETE]

**Files**:

- `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\agent-process-manager.service.ts` (VERIFY no vscode import remains)
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\copilot-provider\copilot-auth.service.ts` (VERIFY APPROVED EXCEPTION removed)
- `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\services\token-counter.service.ts` (VERIFY APPROVED EXCEPTION removed)
  **Spec Reference**: implementation-plan.md:1055-1061

**Quality Requirements**:

- Verify no `import * as vscode from 'vscode'` in any of the 3 refactored files
- Verify no APPROVED EXCEPTION comments remain in the 3 files
- The VscodeCopilotAuthService and VscodeTokenCounter MAY have vscode imports (they are platform-specific)

**Implementation Details**:

- This is primarily a verification step; the comments should already be removed in earlier batches
- If any remain, remove them

---

### Task 4.2: Full build and type-check verification [COMPLETE]

**Files**: All affected libraries
**Spec Reference**: implementation-plan.md:1063-1084

**Quality Requirements**:

- Type-check all affected libraries individually:
  - `npx nx run llm-abstraction:typecheck`
  - `npx nx run agent-sdk:typecheck`
  - `npx nx run workspace-intelligence:typecheck`
  - `npx nx run platform-core:typecheck`
  - `npx nx run platform-vscode:typecheck`
  - `npx nx run platform-electron:typecheck`
- Run `npm run typecheck:all` for full workspace verification
- Run `npm run lint:all` for linting

**Implementation Details**:

- Fix any type errors discovered during verification
- Fix any lint errors discovered during verification
- This is the final quality gate before task completion

---

**Batch 4 Verification**:

- All APPROVED EXCEPTION comments removed from refactored files
- No stray vscode imports in platform-agnostic files
- All type-checks pass
- All lint checks pass
- code-logic-reviewer approved

---
