# Development Tasks - TASK_2025_226: Decouple vscode-lm-tools MCP Server from VS Code

**Total Tasks**: 21 | **Batches**: 6 | **Status**: 6/6 COMPLETE | **Current**: ALL COMPLETE

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- `IWorkspaceProvider.getConfiguration()` exists at `libs/backend/platform-core/src/interfaces/workspace-provider.interface.ts:34`: VERIFIED
- `PLATFORM_TOKENS` exists at `libs/backend/platform-core/src/tokens.ts:11`: VERIFIED
- `buildTestingNamespace()` graceful degradation pattern exists at `ide-namespace.builder.ts:740-817`: VERIFIED
- `http-server.handler.ts` uses `import * as vscode from 'vscode'` only for `getConfiguration()`: VERIFIED (line 13, used at line 41-43)
- `core-namespace.builders.ts` uses `import * as vscode from 'vscode'` only for diagnostics: VERIFIED (line 14, used in `buildDiagnosticsNamespace()` and helpers)
- `ide-namespace.builder.ts` uses `import * as vscode from 'vscode'` for LSP/editor/actions: VERIFIED (line 43, used throughout 818 lines)
- `CodeExecutionMCP` injects `WebviewManager` non-optionally at line 64-65: VERIFIED
- `approval-prompt.handler.ts` requires `WebviewManager` for sending permission requests: VERIFIED (line 55)
- `registerVsCodeLmToolsServices` registers 3 singletons (PtahAPIBuilder, CodeExecutionMCP, PermissionPromptService): VERIFIED
- Electron shim exists at `apps/ptah-electron/src/shims/vscode-lm-tools-shim.ts` with `PTAH_SYSTEM_PROMPT = ''`: VERIFIED
- Electron tsconfig.build.json path alias redirects `@ptah-extension/vscode-lm-tools` to shim: VERIFIED (lines 6-8)
- Platform-vscode registration pattern at `libs/backend/platform-vscode/src/registration.ts`: VERIFIED
- Platform-electron registration pattern at `libs/backend/platform-electron/src/registration.ts`: VERIFIED
- Tree-sitter services (`TreeSitterParserService`, `AstAnalysisService`) are already injected into `PtahAPIBuilder`: VERIFIED (lines 162-166)

### Risks Identified

| Risk                                                                                                                                                 | Severity | Mitigation                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WebviewManager` is typed from `@ptah-extension/vscode-core` - making it optional requires `@optional()` decorator support in tsyringe               | LOW      | tsyringe supports `@optional()` via `isRegistered()` check pattern - already used elsewhere in codebase (e.g., `container.isRegistered(SDK_SESSION_LIFECYCLE_MANAGER)` in ptah-api-builder.service.ts)            |
| Tree-sitter IDE provider for Electron is a stretch goal - definition/reference lookup via tree-sitter is approximate, not precise like LSP           | LOW      | Initial implementation should use graceful degradation stubs. Tree-sitter provider can be added as an enhancement if time permits. Plan Section 11.3 recommends this but acknowledges stubs are acceptable first. |
| `protocol-handlers.ts` `ProtocolHandlerDependencies` interface types `webviewManager: WebviewManager` as required - needs to become optional         | LOW      | Change type to `webviewManager?: WebviewManager` and add null check in `handleApprovalPrompt` call                                                                                                                |
| Electron DI container (`apps/ptah-electron/src/di/container.ts`) may not have all prerequisite TOKENS registered for `registerVsCodeLmToolsServices` | MED      | Task 4.3 must verify prerequisite tokens exist in Electron DI before calling registration. May need conditional registration or relaxed dependency checks.                                                        |

### Edge Cases to Handle

- [x] `getConfiguredPort()` called when `IWorkspaceProvider` returns `undefined` for config -> must fall back to default 51820 -> Handled in Task 1.3 (uses `?? 51820` fallback)
- [x] `buildDiagnosticsNamespace()` called without `IDiagnosticsProvider` -> must not crash -> Handled in Task 2.1
- [x] `buildIDENamespace()` called without `IIDECapabilities` (Electron) -> must return full graceful degradation stub -> Handled in Task 3.1
- [x] `approval_prompt` tool called when `WebviewManager` is absent (Electron) -> must auto-allow or provide alternative -> Handled in Task 4.2
- [x] Tool filtering must not break existing VS Code tool list -> Handled in Task 5.1 with conditional check
- [x] `PTAH_SYSTEM_PROMPT` must remain a static export for `agent-sdk` import compatibility -> Handled in Task 5.2

---

## Batch 1: IDiagnosticsProvider Interface + http-server.handler.ts Fix -- COMPLETE

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: None
**Risk**: LOW
**Commit**: 706fb838

### Task 1.1: Create IDiagnosticsProvider Interface -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\platform-core\src\interfaces\diagnostics-provider.interface.ts` (CREATE)
**Spec Reference**: implementation-plan.md: Section 4.1 (lines 162-183)
**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\platform-core\src\interfaces\workspace-provider.interface.ts`

**Quality Requirements**:

- Interface must define `getDiagnostics()` returning `Array<{ file: string; diagnostics: Array<{ message: string; line: number; severity: 'error' | 'warning' | 'info' | 'hint' }>}>`
- Use string literal union for severity (not numeric enum) for cross-platform simplicity
- Add JSDoc with `@replaces vscode.languages.getDiagnostics()` note

**Implementation Details**:

- Single interface file with `IDiagnosticsProvider` export
- Follow the exact pattern from `workspace-provider.interface.ts` (JSDoc, `@replaces` annotation)
- Keep it minimal - only `getDiagnostics()` method needed

---

### Task 1.2: Add DIAGNOSTICS_PROVIDER Token + Export -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\platform-core\src\tokens.ts` (MODIFY)
**File**: `D:\projects\ptah-extension\libs\backend\platform-core\src\index.ts` (MODIFY)
**Spec Reference**: implementation-plan.md: Section 4.1 (line 188)
**Pattern to Follow**: Existing `PLATFORM_TOKENS` entries in `tokens.ts`

**Quality Requirements**:

- Token must use `Symbol.for('PlatformDiagnosticsProvider')` convention
- Must be added to `PLATFORM_TOKENS` const
- Must be exported from `index.ts` barrel

**Implementation Details**:

- In `tokens.ts`: Add `DIAGNOSTICS_PROVIDER: Symbol.for('PlatformDiagnosticsProvider')` to `PLATFORM_TOKENS` object
- In `index.ts`: Add `export type { IDiagnosticsProvider } from './interfaces/diagnostics-provider.interface'`

---

### Task 1.3: Replace vscode.workspace.getConfiguration in http-server.handler.ts -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\http-server.handler.ts` (MODIFY)
**Spec Reference**: implementation-plan.md: Section 2.3 (lines 96-99), Section 3.3 (lines 142-146)
**Pattern to Follow**: `IWorkspaceProvider.getConfiguration()` usage pattern

**Quality Requirements**:

- Remove `import * as vscode from 'vscode'` entirely from this file
- Replace `vscode.workspace.getConfiguration('ptah').get<number>('mcpPort', 51820)` with `IWorkspaceProvider.getConfiguration<number>('ptah', 'mcpPort', 51820)`
- `getConfiguredPort()` function must accept `IWorkspaceProvider` parameter (cannot use DI injection in a standalone function)
- Ensure default port 51820 is preserved

**Validation Notes**:

- Edge case: If `workspaceProvider.getConfiguration()` returns `undefined`, the default of `51820` must be used
- This function is called from `CodeExecutionMCP.start()` (line 81 of `code-execution-mcp.service.ts`) - the caller must pass the `IWorkspaceProvider`

**Implementation Details**:

- Import `IWorkspaceProvider` from `@ptah-extension/platform-core` (type import)
- Change `getConfiguredPort()` signature to `getConfiguredPort(workspaceProvider: IWorkspaceProvider): number`
- Replace body: `return workspaceProvider.getConfiguration<number>('ptah', 'mcpPort', 51820) ?? 51820`
- Remove the `APPROVED EXCEPTION` comment block at top of file
- Update `code-execution-mcp.service.ts` line 81 to pass `this.workspaceProvider` to `getConfiguredPort()`

---

### Task 1.4: Update CodeExecutionMCP to pass IWorkspaceProvider to getConfiguredPort -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\code-execution-mcp.service.ts` (MODIFY)
**Spec Reference**: implementation-plan.md: Section 3.3
**Dependencies**: Task 1.3

**Quality Requirements**:

- `getConfiguredPort(this.workspaceProvider)` call must be used at line 81
- No other changes to this file in this batch (WebviewManager optionality is Batch 4)

**Implementation Details**:

- Change `const configuredPort = getConfiguredPort();` to `const configuredPort = getConfiguredPort(this.workspaceProvider);`
- `this.workspaceProvider` is already injected at line 58-59

---

**Batch 1 Verification**:

- `http-server.handler.ts` has zero `import * as vscode` statements
- `IDiagnosticsProvider` interface exists and is exported from `@ptah-extension/platform-core`
- `DIAGNOSTICS_PROVIDER` token exists in `PLATFORM_TOKENS`
- Build passes: `npx nx build vscode-lm-tools`
- code-logic-reviewer approved

---

## Batch 2: Abstract Diagnostics Namespace -- COMPLETE

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 1
**Risk**: LOW
**Commit**: 71aed800

### Task 2.1: Refactor buildDiagnosticsNamespace to use IDiagnosticsProvider -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\core-namespace.builders.ts` (MODIFY)
**Spec Reference**: implementation-plan.md: Section 3.1 (lines 106-128), Section 11.4 (lines 624-629)
**Pattern to Follow**: `buildWorkspaceNamespace(deps)` in same file (accepts dependencies parameter)

**Quality Requirements**:

- Remove `import * as vscode from 'vscode'` entirely from this file
- `buildDiagnosticsNamespace()` must accept `IDiagnosticsProvider` parameter
- When provider returns results, map them to `DiagnosticInfo` format
- Remove `severityToString()` and `getDiagnosticsByLevel()` helper functions (they use vscode enums)
- `getErrors()` / `getWarnings()` must filter by severity string from the provider results
- Remove `APPROVED EXCEPTION` comment block

**Validation Notes**:

- The `DiagnosticInfo` type from `types.ts` has fields: `file`, `message`, `line`, `severity?` (optional string)
- `getErrors()` and `getWarnings()` return `DiagnosticInfo[]` without severity field, `getAll()` returns with severity

**Implementation Details**:

- Import `IDiagnosticsProvider` from `@ptah-extension/platform-core` (type import)
- Change signature: `buildDiagnosticsNamespace(diagnosticsProvider: IDiagnosticsProvider): DiagnosticsNamespace`
- `getErrors()`: call `diagnosticsProvider.getDiagnostics()`, filter where `severity === 'error'`, map to `DiagnosticInfo`
- `getWarnings()`: same but filter `severity === 'warning'`
- `getAll()`: no filter, include severity string
- Delete `severityToString()` function (no longer needed - provider returns strings)
- Delete `getDiagnosticsByLevel()` function (no longer needed)

---

### Task 2.2: Update PtahAPIBuilder to inject and pass IDiagnosticsProvider -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.ts` (MODIFY)
**Spec Reference**: implementation-plan.md: Section 6, Batch 2 (lines 273)
**Dependencies**: Task 2.1

**Quality Requirements**:

- Inject `IDiagnosticsProvider` via `@inject(PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER)` in constructor
- Pass the provider to `buildDiagnosticsNamespace(diagnosticsProvider)`
- Update the `buildDiagnosticsNamespace()` call at line 233

**Implementation Details**:

- Add constructor parameter: `@inject(PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER) private readonly diagnosticsProvider: IDiagnosticsProvider`
- Import `IDiagnosticsProvider` type from `@ptah-extension/platform-core`
- Change line 233: `diagnostics: buildDiagnosticsNamespace(this.diagnosticsProvider),`
- The `buildDiagnosticsNamespace` import in the import block already exists - no import change needed, just the function signature changed

---

### Task 2.3: Create VS Code IDiagnosticsProvider Implementation -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\platform-vscode\src\implementations\vscode-diagnostics-provider.ts` (CREATE)
**Spec Reference**: implementation-plan.md: Section 4.1 (lines 185-186), Section 6 Batch 2 (line 277)
**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\platform-vscode\src\implementations\vscode-workspace-provider.ts`

**Quality Requirements**:

- Implements `IDiagnosticsProvider` from `@ptah-extension/platform-core`
- Wraps `vscode.languages.getDiagnostics()` with severity enum-to-string conversion
- Must `import * as vscode from 'vscode'` (this file is VS Code-only, that is correct)

**Implementation Details**:

- Class `VscodeDiagnosticsProvider implements IDiagnosticsProvider`
- `getDiagnostics()`: calls `vscode.languages.getDiagnostics()`, maps `[Uri, Diagnostic[]][]` to the interface format
- Severity mapping: `vscode.DiagnosticSeverity.Error` -> `'error'`, `.Warning` -> `'warning'`, `.Information` -> `'info'`, `.Hint` -> `'hint'`
- Uses `uri.fsPath` for file paths, `d.range.start.line` for line numbers
- Export from `libs/backend/platform-vscode/src/index.ts`
- Register in `libs/backend/platform-vscode/src/registration.ts` under `PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER`

---

### Task 2.4: Create Electron IDiagnosticsProvider Implementation -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\platform-electron\src\implementations\electron-diagnostics-provider.ts` (CREATE)
**Spec Reference**: implementation-plan.md: Section 4.1 (lines 186-187), Section 11.4 (lines 624-629)
**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\platform-electron\src\implementations\electron-editor-provider.ts`

**Quality Requirements**:

- Implements `IDiagnosticsProvider` from `@ptah-extension/platform-core`
- Returns tree-sitter syntax errors as diagnostics (per Section 11.4 guidance)
- If tree-sitter is not feasible in initial implementation, return `[]` as minimum viable implementation
- Must NOT import `vscode`

**Validation Notes**:

- Section 11.4 says: "tree-sitter CAN detect syntax errors (parse errors in the AST)" and "returning tree-sitter syntax errors is a good minimum viable diagnostics provider"
- `TreeSitterParserService` is injectable via DI from `@ptah-extension/workspace-intelligence`
- However, injecting workspace-intelligence into platform-electron may create a circular dependency - verify first
- If circular dependency exists, fall back to returning `[]` (still better than the current shim which blocks everything)

**Implementation Details**:

- Class `ElectronDiagnosticsProvider implements IDiagnosticsProvider`
- `getDiagnostics()`: returns `[]` for initial implementation (tree-sitter enhancement can be added later)
- Export from `libs/backend/platform-electron/src/index.ts`
- Register in `libs/backend/platform-electron/src/registration.ts` under `PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER`

---

**Batch 2 Verification**:

- `core-namespace.builders.ts` has zero `import * as vscode` statements
- VS Code diagnostics provider registered in `platform-vscode/src/registration.ts`
- Electron diagnostics provider registered in `platform-electron/src/registration.ts`
- Build passes: `npx nx build vscode-lm-tools`
- Build passes: `npx nx build platform-vscode`
- Build passes: `npx nx build platform-electron`
- code-logic-reviewer approved

---

## Batch 3: IDE Namespace Graceful Degradation -- COMPLETE

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 2
**Risk**: MEDIUM (largest file change - 818 lines)
**Commit**: e4e5f50c

### Task 3.1: Define IIDECapabilities Interface + Refactor buildIDENamespace -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\ide-namespace.builder.ts` (MODIFY)
**Spec Reference**: implementation-plan.md: Section 3.2 (lines 129-141), Section 4.2 (lines 192-222), Section 11.3 (lines 600-620)

**Quality Requirements**:

- Remove `import * as vscode from 'vscode'` entirely from this file
- Define `IIDECapabilities` interface (local to this file or in a types file)
- `buildIDENamespace()` must accept optional `IIDECapabilities` parameter
- When `capabilities` is `undefined` (Electron): return graceful degradation stub for ALL sub-namespaces (lsp, editor, actions, testing)
- When `capabilities` is provided (VS Code): delegate to the capabilities provider
- The stub must follow the existing `buildTestingNamespace()` pattern (lines 740-817 in current file)
- Remove `resolveFilePath()` helper function (it uses `vscode.Uri`, `vscode.workspace.workspaceFolders`)
- Testing namespace already uses graceful degradation - keep as-is but move under the stub pattern

**Validation Notes**:

- This is the largest single file change (818 lines)
- The `IIDECapabilities` interface has 3 sub-interfaces: `lsp`, `editor`, `actions` (testing stays as graceful degradation always)
- Section 11.3 recommends tree-sitter for LSP-like features in Electron, but stubs are acceptable first
- All types (`Location`, `HoverInfo`, `SignatureHelp`, `ActiveEditorInfo`, etc.) are already defined in `types.ts` and stay unchanged

**Implementation Details**:

- Define `IIDECapabilities` at top of file with `lsp`, `editor`, `actions` sub-interfaces matching the existing namespace method signatures
- `buildIDENamespace(capabilities?: IIDECapabilities)`:
  - If `capabilities` provided: return `{ lsp: capabilities.lsp, editor: capabilities.editor, actions: capabilities.actions, testing: buildTestingNamespace() }`
  - If `capabilities` undefined: return stub with all methods returning `[]`, `null`, `false` as appropriate
- Stub LSP methods: `getDefinition` -> `[]`, `getReferences` -> `[]`, `getHover` -> `null`, `getTypeDefinition` -> `[]`, `getSignatureHelp` -> `null`
- Stub Editor methods: `getActive` -> `null`, `getOpenFiles` -> `[]`, `getDirtyFiles` -> `[]`, `getRecentFiles` -> `[]`, `getVisibleRange` -> `null`
- Stub Actions methods: `getAvailable` -> `[]`, `apply` -> `false`, `rename` -> `false`, `organizeImports` -> `false`, `fixAll` -> `false`
- Export `IIDECapabilities` from the file for use by the VS Code implementation
- Remove `APPROVED EXCEPTION` comment block

---

### Task 3.2: Create VS Code IIDECapabilities Implementation -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\ide-capabilities.vscode.ts` (CREATE)
**Spec Reference**: implementation-plan.md: Section 6, Batch 3 (lines 317-318)

**Quality Requirements**:

- Implements `IIDECapabilities` interface from `ide-namespace.builder.ts`
- This file WILL import `vscode` - that is correct (VS Code-only file)
- Must contain ALL the VS Code-specific logic currently in `buildLSPNamespace()`, `buildEditorNamespace()`, `buildActionsNamespace()`
- Must include the `resolveFilePath()` helper function (moved from `ide-namespace.builder.ts`)
- Must be a concrete class or factory function that returns `IIDECapabilities`

**Implementation Details**:

- Class `VscodeIDECapabilities implements IIDECapabilities`
- Move `resolveFilePath()` into this file
- `lsp` property: Object with `getDefinition`, `getReferences`, `getHover`, `getTypeDefinition`, `getSignatureHelp` - all the VS Code command execution logic from current `buildLSPNamespace()`
- `editor` property: Object with `getActive`, `getOpenFiles`, `getDirtyFiles`, `getRecentFiles`, `getVisibleRange` - from current `buildEditorNamespace()`
- `actions` property: Object with `getAvailable`, `apply`, `rename`, `organizeImports`, `fixAll` - from current `buildActionsNamespace()`
- Export class from file

---

### Task 3.3: Update namespace-builders index.ts for new exports -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\index.ts` (MODIFY)
**Spec Reference**: implementation-plan.md: Section 6, Batch 3 (line 308)
**Dependencies**: Task 3.1

**Quality Requirements**:

- Export `IIDECapabilities` type from `ide-namespace.builder.ts`
- Export `VscodeIDECapabilities` from `ide-capabilities.vscode.ts`
- Update `buildIDENamespace` export to include new signature

**Implementation Details**:

- Change: `export { buildIDENamespace } from './ide-namespace.builder'`
- To: `export { buildIDENamespace, type IIDECapabilities } from './ide-namespace.builder'`
- Add: `export { VscodeIDECapabilities } from './ide-capabilities.vscode'`

---

### Task 3.4: Update PtahAPIBuilder to pass IIDECapabilities -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.ts` (MODIFY)
**Spec Reference**: implementation-plan.md: Section 6, Batch 3 (lines 310-314)
**Dependencies**: Task 3.1, Task 3.2

**Quality Requirements**:

- IDE capabilities must be optional - resolved via DI `container.isRegistered()` pattern
- In VS Code: `VscodeIDECapabilities` is registered, so capabilities are available
- In Electron: token is not registered, so `buildIDENamespace()` receives `undefined` -> graceful degradation
- Follow the existing lazy DI resolution pattern (see `SDK_SESSION_LIFECYCLE_MANAGER` at lines 265-276)

**Validation Notes**:

- Do NOT inject via constructor `@inject()` (would crash in Electron where token is not registered)
- Use `container.isRegistered()` + `container.resolve()` pattern instead

**Implementation Details**:

- Define a DI token for IDE capabilities: `const IDE_CAPABILITIES_TOKEN = Symbol.for('IDECapabilities')` (local to this file, or add to TOKENS)
- In `build()` method, resolve lazily: `const ideCapabilities = container.isRegistered(IDE_CAPABILITIES_TOKEN) ? container.resolve<IIDECapabilities>(IDE_CAPABILITIES_TOKEN) : undefined`
- Change line 250: `ide: buildIDENamespace(ideCapabilities),`
- Import `IIDECapabilities` from namespace-builders
- The VS Code DI container registration (Batch 4 or VS Code container.ts) must register `VscodeIDECapabilities` under this token

---

**Batch 3 Verification**:

- `ide-namespace.builder.ts` has zero `import * as vscode` statements
- `ide-capabilities.vscode.ts` exists with all VS Code logic extracted
- `buildIDENamespace(undefined)` returns graceful degradation stub
- `buildIDENamespace(vscodeCapabilities)` delegates to VS Code implementation
- Build passes: `npx nx build vscode-lm-tools`
- code-logic-reviewer approved

---

## Batch 4: Remove Shim + WebviewManager Optionality + DI Registration -- COMPLETE

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batch 3
**Risk**: LOW-MEDIUM
**Commit**: 152ed89b

### Task 4.1: Make WebviewManager Optional in CodeExecutionMCP -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\code-execution-mcp.service.ts` (MODIFY)
**Spec Reference**: implementation-plan.md: Section 3.4 (lines 148-152)

**Quality Requirements**:

- `WebviewManager` injection must become optional (not crash when token is unregistered)
- Use `container.isRegistered()` pattern for lazy resolution (same as `SDK_SESSION_LIFECYCLE_MANAGER`)
- `this.webviewManager` must be typed as `WebviewManager | undefined`
- Pass optional `webviewManager` to `handleMCPRequest` deps

**Implementation Details**:

- Remove `@inject(TOKENS.WEBVIEW_MANAGER) private readonly webviewManager: WebviewManager` from constructor
- Add private property: `private webviewManager: WebviewManager | undefined`
- In constructor body, resolve lazily: `this.webviewManager = container.isRegistered(TOKENS.WEBVIEW_MANAGER) ? container.resolve(TOKENS.WEBVIEW_MANAGER) : undefined`
- Import `container` from `tsyringe` (already imported)
- Update `handleMCPRequest` call to pass `this.webviewManager` (may be undefined)

---

### Task 4.2: Handle Missing WebviewManager in Protocol Handlers -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\protocol-handlers.ts` (MODIFY)
**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\approval-prompt.handler.ts` (MODIFY)
**Spec Reference**: implementation-plan.md: Section 3.4 (lines 151-152)
**Dependencies**: Task 4.1

**Quality Requirements**:

- `ProtocolHandlerDependencies.webviewManager` must become optional (`WebviewManager | undefined`)
- `approval_prompt` tool must handle missing WebviewManager: auto-allow permissions in Electron
- `ApprovalPromptDependencies.webviewManager` must become optional
- When `webviewManager` is undefined, `handleApprovalPrompt` should return an auto-allow response

**Implementation Details**:

- In `protocol-handlers.ts`: Change `webviewManager: WebviewManager` to `webviewManager?: WebviewManager` in `ProtocolHandlerDependencies`
- In `handleToolsCall` approval_prompt handling: if `!deps.webviewManager`, return auto-allow response directly (skip webview flow)
- In `approval-prompt.handler.ts`: Change `webviewManager: WebviewManager` to `webviewManager?: WebviewManager` in `ApprovalPromptDependencies`
- At top of `handleApprovalPrompt`: if `!deps.webviewManager`, return auto-allow response (same format as line 83-97 but without awaiting webview)

---

### Task 4.3: Register VscodeIDECapabilities in VS Code DI + Register VscodeDiagnosticsProvider -- COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\di\container.ts` (MODIFY)
**File**: `D:\projects\ptah-extension\libs\backend\platform-vscode\src\registration.ts` (MODIFY)
**Spec Reference**: implementation-plan.md: Section 6, Batch 2 (lines 285-287), Batch 3 (line 321)
**Dependencies**: Task 2.3, Task 3.2

**Quality Requirements**:

- `VscodeDiagnosticsProvider` must be registered under `PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER` in platform-vscode registration
- `VscodeIDECapabilities` must be registered under the IDE capabilities DI token in VS Code container
- Registration must happen AFTER platform services are registered, BEFORE `registerVsCodeLmToolsServices`

**Implementation Details**:

- In `platform-vscode/src/registration.ts`: Add `VscodeDiagnosticsProvider` registration:
  ```
  container.register(PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER, { useValue: new VscodeDiagnosticsProvider() });
  ```
- In VS Code `container.ts`: Register `VscodeIDECapabilities` under the IDE capabilities token (must match the token used in Task 3.4)
- Import `VscodeIDECapabilities` from `@ptah-extension/vscode-lm-tools` namespace-builders

---

### Task 4.4: Register Electron DI for vscode-lm-tools Services -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\platform-electron\src\registration.ts` (MODIFY)
**File**: `D:\projects\ptah-extension\apps\ptah-electron\tsconfig.build.json` (MODIFY)
**Spec Reference**: implementation-plan.md: Section 6, Batch 4 (lines 341-343, 333)

**Quality Requirements**:

- Remove the `@ptah-extension/vscode-lm-tools` path alias that points to the shim in `tsconfig.build.json`
- Register `ElectronDiagnosticsProvider` under `PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER` in platform-electron registration
- Electron DI container (or startup code) must call `registerVsCodeLmToolsServices` to register the real library
- Do NOT register `VscodeIDECapabilities` in Electron (IDE namespace will gracefully degrade)
- Do NOT register `TOKENS.WEBVIEW_MANAGER` in Electron (approval_prompt will auto-allow)

**Validation Notes**:

- Risk: `registerVsCodeLmToolsServices` checks for `TOKENS.CONTEXT_ORCHESTRATION_SERVICE` prerequisite - verify this is registered in Electron DI
- Electron DI container at `apps/ptah-electron/src/di/container.ts` must be checked for prerequisite tokens
- If prerequisites are missing, registration call may need to be conditional or prerequisites added

**Implementation Details**:

- In `tsconfig.build.json`: Remove the `"@ptah-extension/vscode-lm-tools": ["apps/ptah-electron/src/shims/vscode-lm-tools-shim.ts"]` path alias entry
- In `platform-electron/src/registration.ts`: Add `ElectronDiagnosticsProvider` registration
- In Electron DI container: Add `registerVsCodeLmToolsServices(container, logger)` call after workspace-intelligence services are registered
- Verify all prerequisite tokens are registered before calling

---

### Task 4.5: Delete the Electron Shim File -- COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\shims\vscode-lm-tools-shim.ts` (DELETE)
**Spec Reference**: implementation-plan.md: Section 3.5 (lines 154-157), Section 6, Batch 4 (line 339)
**Dependencies**: Task 4.4

**Quality Requirements**:

- File must be deleted entirely
- No other files should reference it after Task 4.4 removes the tsconfig path alias
- Verify no other imports reference this shim path

**Implementation Details**:

- Delete `apps/ptah-electron/src/shims/vscode-lm-tools-shim.ts`
- Verify with `grep -r "vscode-lm-tools-shim"` that no references remain

---

**Batch 4 Verification**:

- Electron `tsconfig.build.json` no longer has `@ptah-extension/vscode-lm-tools` path alias pointing to shim
- Shim file `vscode-lm-tools-shim.ts` is deleted
- `WebviewManager` is optional in `CodeExecutionMCP`
- `approval_prompt` tool auto-allows when `WebviewManager` is absent
- VS Code DI registers `VscodeDiagnosticsProvider` and `VscodeIDECapabilities`
- Electron DI registers `ElectronDiagnosticsProvider` but NOT IDE capabilities
- Electron DI calls `registerVsCodeLmToolsServices` successfully
- Build passes: `npx nx build vscode-lm-tools`
- Electron build compiles without the shim
- code-logic-reviewer approved

---

## Batch 5: MCP Tool Availability Filtering COMPLETE

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batch 4
**Risk**: LOW
**Commit**: f598e331

### Task 5.1: Make handleToolsList Platform-Aware COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\protocol-handlers.ts` (MODIFY)
**Spec Reference**: implementation-plan.md: Section 6, Batch 5 (lines 360-367)

**Quality Requirements**:

- `handleToolsList()` must conditionally exclude VS Code-only tools in Electron
- VS Code-only tools to exclude: `ptah_lsp_references`, `ptah_lsp_definitions`, `ptah_get_dirty_files`
- `ptah_get_diagnostics` stays available on both platforms (uses `IDiagnosticsProvider`)
- Detection: Use platform info or a boolean flag passed through dependencies
- Must NOT break the existing VS Code tool list

**Implementation Details**:

- Add `hasIDECapabilities?: boolean` to `ProtocolHandlerDependencies` interface
- In `CodeExecutionMCP`, pass `hasIDECapabilities: !!this.ideCapabilities` (or `container.isRegistered(IDE_CAPABILITIES_TOKEN)`)
- In `handleToolsList()`: accept `deps` parameter, conditionally include/exclude tools based on `deps.hasIDECapabilities`
- When `hasIDECapabilities` is false: exclude `buildLspReferencesTool()`, `buildLspDefinitionsTool()`, `buildGetDirtyFilesTool()` from the tools array
- Update `handleToolsList(request)` call to `handleToolsList(request, deps)`

---

### Task 5.2: Make PTAH_SYSTEM_PROMPT Platform-Aware COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-system-prompt.constant.ts` (MODIFY)
**Spec Reference**: implementation-plan.md: Section 6, Batch 5 (line 368)

**Quality Requirements**:

- The static `PTAH_SYSTEM_PROMPT` constant must remain for backward compatibility (agent-sdk imports it)
- Add a note in the system prompt that LSP tools (`ptah_lsp_references`, `ptah_lsp_definitions`, `ptah_get_dirty_files`) are "VS Code only"
- Alternatively, add a `buildSystemPrompt(options: { hasIDECapabilities: boolean })` function that returns a platform-tailored prompt

**Implementation Details**:

- Add "(VS Code only)" annotation to the tool descriptions for `ptah_lsp_references`, `ptah_lsp_definitions`, `ptah_get_dirty_files` in the static constant
- Keep `PTAH_SYSTEM_PROMPT` as a static export (do not change to function - would break agent-sdk import)
- Add `export function buildPlatformSystemPrompt(hasIDECapabilities: boolean): string` that returns a tailored prompt omitting VS Code-only tools when `hasIDECapabilities` is false

---

### Task 5.3: Pass Platform Awareness Through CodeExecutionMCP COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\code-execution-mcp.service.ts` (MODIFY)
**Spec Reference**: implementation-plan.md: Section 6, Batch 5
**Dependencies**: Task 5.1

**Quality Requirements**:

- `CodeExecutionMCP` must detect whether IDE capabilities are available
- Pass `hasIDECapabilities` flag to `handleMCPRequest` dependencies
- Detection: use `container.isRegistered(IDE_CAPABILITIES_TOKEN)`

**Implementation Details**:

- In `start()` method or constructor, determine `hasIDECapabilities` based on DI registration
- Add `hasIDECapabilities` to the `handleMCPRequest` deps object (currently at line 88-94)
- This allows `handleToolsList` and tool execution to know what's available

---

**Batch 5 Verification**:

- In Electron: `tools/list` MCP call does NOT include `ptah_lsp_references`, `ptah_lsp_definitions`, `ptah_get_dirty_files`
- In VS Code: `tools/list` MCP call includes ALL tools (unchanged behavior)
- `PTAH_SYSTEM_PROMPT` static export unchanged (backward compatible)
- System prompt annotates VS Code-only tools
- Build passes: `npx nx build vscode-lm-tools`
- code-logic-reviewer approved

---

## Batch 6: Documentation + Integration Verification COMPLETE

**Developer**: backend-developer
**Tasks**: 1 | **Dependencies**: Batch 5
**Risk**: LOW
**Commit**: 80505a65

### Task 6.1: Update Library Documentation COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\CLAUDE.md` (MODIFY)
**Spec Reference**: implementation-plan.md: Section 6, Batch 6 (line 389)

**Quality Requirements**:

- Update architecture diagram to show platform abstraction layer
- Document which namespaces are VS Code-only vs platform-agnostic
- Update dependencies section (remove direct `vscode` dependency from main library)
- Document the `IIDECapabilities` and `IDiagnosticsProvider` interfaces
- Add MCP Tool Platform Availability Matrix (from implementation-plan.md Section 11.5)
- Note that `ide-capabilities.vscode.ts` is the only file with `vscode` import (and it's conditionally loaded)

**Implementation Details**:

- Update "Dependencies" section: remove `vscode` from "External" deps for the main library
- Add "Platform Abstractions" section documenting:
  - `IDiagnosticsProvider` (platform-core interface)
  - `IIDECapabilities` (local interface, VS Code implementation only)
  - `IWorkspaceProvider.getConfiguration()` (replaces `vscode.workspace.getConfiguration()`)
- Add platform availability matrix table
- Update architecture diagram to show MCP server working in both VS Code and Electron

---

**Batch 6 Verification**:

- CLAUDE.md accurately reflects the new platform-agnostic architecture
- All references to VS Code-only status are documented
- Platform availability matrix matches implementation
- code-logic-reviewer approved

---

## Summary Statistics

| Metric           | Value                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files to CREATE  | 5 (`diagnostics-provider.interface.ts`, `vscode-diagnostics-provider.ts`, `electron-diagnostics-provider.ts`, `ide-capabilities.vscode.ts`, none in Batch 5-6)                                                                                                                                                                                                                                                                    |
| Files to MODIFY  | 15 (`tokens.ts`, `platform-core/index.ts`, `http-server.handler.ts`, `code-execution-mcp.service.ts`, `core-namespace.builders.ts`, `ptah-api-builder.service.ts`, `ide-namespace.builder.ts`, `namespace-builders/index.ts`, `protocol-handlers.ts`, `approval-prompt.handler.ts`, `platform-vscode/registration.ts`, `platform-electron/registration.ts`, `tsconfig.build.json`, `ptah-system-prompt.constant.ts`, `CLAUDE.md`) |
| Files to DELETE  | 1 (`vscode-lm-tools-shim.ts`)                                                                                                                                                                                                                                                                                                                                                                                                     |
| Total Batches    | 6                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Developer Type   | backend-developer (all batches)                                                                                                                                                                                                                                                                                                                                                                                                   |
| Estimated Effort | 6-10 hours                                                                                                                                                                                                                                                                                                                                                                                                                        |
