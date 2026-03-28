# Implementation Plan - TASK_2025_226: Decouple vscode-lm-tools from VS Code APIs

## 1. Comprehensive Library Audit

### 1.1 Complete File Inventory (25 source files)

Every file in `libs/backend/vscode-lm-tools/src/` has been classified by its VS Code dependency status:

#### ALREADY PLATFORM-AGNOSTIC (no `import * as vscode`) - 17 files

| File                                                                       | Dependencies                                                                                                                                                                                                              | Notes                                                                                                                                                                        |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`                                                                 | Barrel exports only                                                                                                                                                                                                       | No changes needed                                                                                                                                                            |
| `lib/code-execution/ptah-api-builder.service.ts`                           | `@ptah-extension/vscode-core` (Logger, FileSystemManager, TOKENS), `@ptah-extension/platform-core` (IWorkspaceProvider, IFileSystemProvider), `@ptah-extension/workspace-intelligence`, `@ptah-extension/llm-abstraction` | Already uses platform-core interfaces. FileSystemManager from vscode-core is used but could be replaced — however it's injected via DI, not direct vscode import. **CLEAN.** |
| `lib/code-execution/ptah-system-prompt.constant.ts`                        | None (pure string constant)                                                                                                                                                                                               | **CLEAN.**                                                                                                                                                                   |
| `lib/code-execution/types.ts`                                              | `@ptah-extension/shared`, `@ptah-extension/workspace-intelligence` (type imports only)                                                                                                                                    | **CLEAN.**                                                                                                                                                                   |
| `lib/code-execution/code-execution-mcp.service.ts`                         | `http`, `fs`, `path`, `tsyringe`, `@ptah-extension/vscode-core` (TOKENS, Logger, WebviewManager), `@ptah-extension/platform-core` (IWorkspaceProvider, IStateStorage, IDisposable)                                        | WebviewManager is injected via DI token. No direct `vscode` import. **CLEAN but depends on WebviewManager type from vscode-core.**                                           |
| `lib/code-execution/mcp-handlers/protocol-handlers.ts`                     | `@ptah-extension/vscode-core` (Logger, WebviewManager type imports), `@ptah-extension/shared`                                                                                                                             | **CLEAN.** No direct vscode.                                                                                                                                                 |
| `lib/code-execution/mcp-handlers/code-execution.engine.ts`                 | `@ptah-extension/vscode-core` (Logger)                                                                                                                                                                                    | **CLEAN.** Pure Node.js code execution with AsyncFunction.                                                                                                                   |
| `lib/code-execution/mcp-handlers/approval-prompt.handler.ts`               | `@ptah-extension/vscode-core` (Logger, WebviewManager type), `@ptah-extension/shared`                                                                                                                                     | **CLEAN.** No direct vscode.                                                                                                                                                 |
| `lib/code-execution/mcp-handlers/tool-description.builder.ts`              | Only imports from local `types.ts` and `ptah-system-prompt.constant.ts`                                                                                                                                                   | **CLEAN.**                                                                                                                                                                   |
| `lib/code-execution/mcp-handlers/mcp-response-formatter.ts`                | `json2md`, `@ptah-extension/shared`                                                                                                                                                                                       | **CLEAN.** Pure formatting logic.                                                                                                                                            |
| `lib/code-execution/mcp-handlers/index.ts`                                 | Barrel exports only                                                                                                                                                                                                       | **CLEAN.**                                                                                                                                                                   |
| `lib/code-execution/namespace-builders/index.ts`                           | Barrel exports only                                                                                                                                                                                                       | **CLEAN.**                                                                                                                                                                   |
| `lib/code-execution/namespace-builders/analysis-namespace.builders.ts`     | `@ptah-extension/workspace-intelligence`, `@ptah-extension/platform-core` (IWorkspaceProvider)                                                                                                                            | **CLEAN.** No vscode.                                                                                                                                                        |
| `lib/code-execution/namespace-builders/ast-namespace.builder.ts`           | `path`, `@ptah-extension/workspace-intelligence`, `@ptah-extension/platform-core` (IFileSystemProvider, IWorkspaceProvider)                                                                                               | **CLEAN.** No vscode.                                                                                                                                                        |
| `lib/code-execution/namespace-builders/orchestration-namespace.builder.ts` | `path`, `fs` (Node.js built-in)                                                                                                                                                                                           | **CLEAN.** Uses native fs, not vscode.workspace.fs.                                                                                                                          |
| `lib/code-execution/namespace-builders/agent-namespace.builder.ts`         | `@ptah-extension/llm-abstraction`, `@ptah-extension/shared`                                                                                                                                                               | **CLEAN.** No vscode.                                                                                                                                                        |
| `lib/code-execution/services/web-search.service.ts`                        | `@ptah-extension/llm-abstraction`, `@ptah-extension/vscode-core` (Logger type)                                                                                                                                            | **CLEAN.** No vscode.                                                                                                                                                        |
| `lib/types/tool-parameters.ts`                                             | None (pure interfaces)                                                                                                                                                                                                    | **CLEAN.**                                                                                                                                                                   |
| `lib/permission/permission-prompt.service.ts`                              | `tsyringe`, `minimatch`, `@ptah-extension/vscode-core` (TOKENS, Logger), `@ptah-extension/platform-core` (PLATFORM_TOKENS, IStateStorage), `@ptah-extension/shared`                                                       | **CLEAN.** No direct vscode import.                                                                                                                                          |
| `lib/di/register.ts`                                                       | `tsyringe`, `@ptah-extension/vscode-core` (TOKENS, Logger)                                                                                                                                                                | **CLEAN.** No vscode.                                                                                                                                                        |
| `lib/di/index.ts`                                                          | Barrel export only                                                                                                                                                                                                        | **CLEAN.**                                                                                                                                                                   |
| `lib/code-execution/namespace-builders/system-namespace.builders.ts`       | `path`, `@ptah-extension/vscode-core` (FileSystemManager), `@ptah-extension/platform-core` (FileType, IWorkspaceProvider, IFileSystemProvider)                                                                            | **CLEAN.** Uses FileSystemManager but through DI. No direct vscode.                                                                                                          |

#### REQUIRES VS CODE APIs (direct `import * as vscode`) - 3 files

| File                                                                   | VS Code APIs Used                                                                                                                                                                                                                                                         | Abstraction Strategy                                                                   |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **`lib/code-execution/namespace-builders/core-namespace.builders.ts`** | `vscode.languages.getDiagnostics()`, `vscode.DiagnosticSeverity`                                                                                                                                                                                                          | Needs new `IDiagnosticsProvider` interface in platform-core                            |
| **`lib/code-execution/namespace-builders/ide-namespace.builder.ts`**   | `vscode.commands.executeCommand()` (LSP providers), `vscode.window.activeTextEditor`, `vscode.window.visibleTextEditors`, `vscode.workspace.textDocuments`, `vscode.workspace.workspaceFolders`, `vscode.Uri`, `vscode.Position`, `vscode.Range`, `vscode.CodeActionKind` | **VS Code-exclusive.** Keep behind a platform interface or graceful degradation.       |
| **`lib/code-execution/mcp-handlers/http-server.handler.ts`**           | `vscode.workspace.getConfiguration('ptah').get('mcpPort', 51820)`                                                                                                                                                                                                         | Replace with `IWorkspaceProvider.getConfiguration()` (already exists in platform-core) |

### 1.2 Summary Statistics

- **Total source files**: 25 (including barrel exports)
- **Already platform-agnostic**: 22 files (88%)
- **Needs VS Code API removal**: 3 files (12%)
- **Truly VS Code-exclusive logic**: 1 file (ide-namespace.builder.ts — LSP, editor state)

**KEY INSIGHT**: The library is already 88% platform-agnostic. The Electron shim that exports `PTAH_SYSTEM_PROMPT = ''` and blocks the entire library is a massive overreaction to 3 files' worth of VS Code imports.

---

## 2. VS Code API Dependency Deep Dive

### 2.1 `core-namespace.builders.ts` — Diagnostics

**APIs used**:

- `vscode.languages.getDiagnostics()` — returns `[Uri, Diagnostic[]][]`
- `vscode.DiagnosticSeverity` — enum (Error=0, Warning=1, Information=2, Hint=3)

**What it builds**: `buildDiagnosticsNamespace()` which provides `getErrors()`, `getWarnings()`, `getAll()`

**Abstraction strategy**: Create `IDiagnosticsProvider` in platform-core.

**Why not just use the existing platform-core interfaces?** There's no diagnostics interface. Diagnostics are fundamentally a language server feature. In VS Code, `vscode.languages.getDiagnostics()` returns them. In Electron, there are no live language servers — but we can provide a stub or use a file-based approach (run `tsc --noEmit` and parse output).

### 2.2 `ide-namespace.builder.ts` — LSP + Editor State

**APIs used**:

- `vscode.commands.executeCommand('vscode.executeDefinitionProvider', ...)` (LSP)
- `vscode.commands.executeCommand('vscode.executeReferenceProvider', ...)` (LSP)
- `vscode.commands.executeCommand('vscode.executeHoverProvider', ...)` (LSP)
- `vscode.commands.executeCommand('vscode.executeTypeDefinitionProvider', ...)` (LSP)
- `vscode.commands.executeCommand('vscode.executeSignatureHelpProvider', ...)` (LSP)
- `vscode.commands.executeCommand('vscode.executeCodeActionProvider', ...)` (Actions)
- `vscode.commands.executeCommand('editor.action.rename', ...)` (Actions)
- `vscode.commands.executeCommand('editor.action.organizeImports', ...)` (Actions)
- `vscode.commands.executeCommand('editor.action.fixAll', ...)` (Actions)
- `vscode.window.activeTextEditor` (Editor state)
- `vscode.window.visibleTextEditors` (Editor state)
- `vscode.workspace.textDocuments` (Editor state)
- `vscode.workspace.workspaceFolders` (path resolution)
- `vscode.Uri.file()`, `vscode.Uri.joinPath()` (URI construction)
- `vscode.Position`, `vscode.Range` (positioning)
- `vscode.CodeActionKind` (code action filtering)

**This is the hardest file.** These are VS Code-exclusive capabilities. In Electron, there are no language servers, no editors, no code actions.

**Abstraction strategy**: Do NOT try to abstract every LSP/Editor API into platform-core. Instead, make `buildIDENamespace()` accept an optional `IIDECapabilities` interface. When the interface is not provided (Electron), return a graceful degradation stub that returns empty arrays / null for all methods.

### 2.3 `http-server.handler.ts` — Configuration

**API used**: `vscode.workspace.getConfiguration('ptah').get<number>('mcpPort', 51820)`

**Abstraction**: The `IWorkspaceProvider.getConfiguration()` interface in platform-core already supports this exact pattern. This is a one-line fix: inject `IWorkspaceProvider` and use `workspaceProvider.getConfiguration('ptah', 'mcpPort', 51820)`.

---

## 3. Architecture Decisions

### 3.1 Decision: Inject Diagnostics via Interface, Not Abstract the VS Code API

**Evidence**: `buildDiagnosticsNamespace()` in `core-namespace.builders.ts:111` takes no parameters. It directly calls `vscode.languages.getDiagnostics()`.

**Solution**: Change `buildDiagnosticsNamespace()` to accept an `IDiagnosticsProvider` dependency. Create this interface in platform-core with methods matching the existing `DiagnosticsNamespace` type from `types.ts`.

**New interface** (platform-core):

```typescript
export interface IDiagnosticsProvider {
  getDiagnostics(): Array<{
    uri: string; // file path (replaces Uri.fsPath)
    diagnostics: Array<{
      message: string;
      line: number; // replaces range.start.line
      severity: number; // 0=Error, 1=Warning, 2=Info, 3=Hint
    }>;
  }>;
}
```

**VS Code implementation** (in platform-vscode or vscode-core): wraps `vscode.languages.getDiagnostics()`.
**Electron implementation**: Returns empty array (no language servers) or shells out to `tsc --noEmit` for TypeScript projects.

### 3.2 Decision: IDE Namespace Gets Graceful Degradation, Not Full Abstraction

**Rationale**: The IDE namespace (LSP, editor state, code actions, testing) is 100% VS Code-specific. These APIs require a running VS Code instance with language servers, active editors, and code action providers. Abstracting each of the 20+ methods into platform-core interfaces would be massive overengineering for functionality that fundamentally cannot exist in Electron.

**Solution**:

1. Make `buildIDENamespace()` accept an optional `IIDENamespaceProvider` dependency
2. When the provider is absent (Electron), return a stub that matches the existing `TestingNamespace` graceful degradation pattern (the testing namespace already returns empty arrays and null)
3. The stub returns: `[]` for arrays, `null` for nullable returns, `false` for boolean returns
4. Each method in the stub adds a descriptive error message like "LSP features require VS Code"

**Evidence for this pattern**: The existing `buildTestingNamespace()` in `ide-namespace.builder.ts:740-817` already uses this exact graceful degradation pattern. Lines 752-757 show `discover()` returning `[]`, and lines 791-795 show `getLastResults()` returning `null`.

### 3.3 Decision: Use `IWorkspaceProvider.getConfiguration()` for MCP Port

**Evidence**: `IWorkspaceProvider.getConfiguration()` at `platform-core/src/interfaces/workspace-provider.interface.ts:34-38` already provides `getConfiguration<T>(section, key, defaultValue): T | undefined`.

**Solution**: Replace `vscode.workspace.getConfiguration('ptah').get<number>('mcpPort', 51820)` with `workspaceProvider.getConfiguration<number>('ptah', 'mcpPort', 51820)` in `http-server.handler.ts`.

### 3.4 Decision: WebviewManager Dependency Becomes Optional

**Evidence**: `CodeExecutionMCP` at `code-execution-mcp.service.ts:65` injects `WebviewManager`. This is used only for the `approval_prompt` tool in `protocol-handlers.ts:55-59` where it sends permission requests to the webview.

**Solution**: Make `WebviewManager` optional in `CodeExecutionMCP` constructor. In Electron, the approval prompt tool can use the `IUserInteraction` interface from platform-core to show native Electron dialogs instead of webview messages. Or, initially, the approval_prompt tool simply auto-allows in Electron (since there's no Claude CLI subagent scenario in Electron currently).

### 3.5 Decision: Remove the Shim, Import the Real Library

Once the 3 files are fixed, the entire `vscode-lm-tools` library will compile without the `vscode` module. The Electron tsconfig.build.json path alias that redirects `@ptah-extension/vscode-lm-tools` to the shim (`vscode-lm-tools-shim.ts`) should be **removed**, and Electron should import the real library directly.

---

## 4. New Platform Abstractions Needed

### 4.1 `IDiagnosticsProvider` — NEW interface in platform-core

**Location**: `libs/backend/platform-core/src/interfaces/diagnostics-provider.interface.ts`

```typescript
export interface IDiagnosticsProvider {
  /**
   * Get all diagnostics across the workspace.
   * Replaces: vscode.languages.getDiagnostics()
   *
   * @returns Array of file diagnostics. Each entry has a file path and its diagnostics.
   */
  getDiagnostics(): Array<{
    file: string;
    diagnostics: Array<{
      message: string;
      line: number;
      severity: 'error' | 'warning' | 'info' | 'hint';
    }>;
  }>;
}
```

**VS Code implementation**: Wraps `vscode.languages.getDiagnostics()` with severity enum-to-string conversion.
**Electron implementation**: Returns `[]` (no live language server). Future: could run `tsc --noEmit --pretty false` and parse output.

**DI Token**: Add `DIAGNOSTICS_PROVIDER: Symbol.for('PlatformDiagnosticsProvider')` to `PLATFORM_TOKENS`.

### 4.2 Optional `IIDECapabilities` — For IDE namespace injection

This does NOT go in platform-core (it's VS Code-specific). Instead, it lives in vscode-lm-tools as a local interface:

```typescript
// In libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/ide-namespace.builder.ts

export interface IIDECapabilities {
  lsp: {
    executeDefinitionProvider(uri: string, line: number, col: number): Promise<Location[]>;
    executeReferenceProvider(uri: string, line: number, col: number): Promise<Location[]>;
    executeHoverProvider(uri: string, line: number, col: number): Promise<HoverInfo | null>;
    executeTypeDefinitionProvider(uri: string, line: number, col: number): Promise<Location[]>;
    executeSignatureHelpProvider(uri: string, line: number, col: number): Promise<SignatureHelp | null>;
  };
  editor: {
    getActiveEditor(): ActiveEditorInfo | null;
    getOpenFiles(): string[];
    getDirtyFiles(): string[];
    getVisibleEditors(): string[];
    getVisibleRange(): VisibleRange | null;
  };
  actions: {
    executeCodeActionProvider(uri: string, line: number): Promise<CodeAction[]>;
    applyCodeAction(uri: string, line: number, title: string): Promise<boolean>;
    rename(uri: string, line: number, col: number, newName: string): Promise<boolean>;
    organizeImports(uri: string): Promise<boolean>;
    fixAll(uri: string, kind?: string): Promise<boolean>;
  };
}
```

When `IIDECapabilities` is `undefined`, `buildIDENamespace()` returns a graceful degradation stub.

---

## 5. Existing Platform Abstractions That Already Cover vscode-lm-tools Needs

| vscode-lm-tools Need | Platform-Core Abstraction                  | Status                                                                            |
| -------------------- | ------------------------------------------ | --------------------------------------------------------------------------------- |
| Workspace root       | `IWorkspaceProvider.getWorkspaceRoot()`    | Already used (ptah-api-builder.service.ts:176, 236)                               |
| File reading         | `IFileSystemProvider.readFile()`           | Already used (ast-namespace.builder.ts:203, system-namespace.builders.ts:376-381) |
| File existence check | `IFileSystemProvider.exists()`             | Already used (system-namespace.builders.ts:377)                                   |
| Directory listing    | `IFileSystemProvider.readDirectory()`      | Already used (system-namespace.builders.ts:411)                                   |
| File stat            | `IFileSystemProvider.stat()`               | Already used (system-namespace.builders.ts:404)                                   |
| Configuration        | `IWorkspaceProvider.getConfiguration()`    | **Not yet used** (http-server.handler.ts still uses vscode directly)              |
| State persistence    | `IStateStorage.get/update()`               | Already used (permission-prompt.service.ts:64-65)                                 |
| Workspace folders    | `IWorkspaceProvider.getWorkspaceFolders()` | Available but not used (ide-namespace.builder.ts uses vscode directly)            |
| Diagnostics          | None                                       | **NEW: IDiagnosticsProvider needed**                                              |
| LSP/Editor/Actions   | None                                       | VS Code-exclusive, use graceful degradation                                       |

---

## 6. Batched Implementation Plan

### Batch 1: Create IDiagnosticsProvider Interface + Fix http-server.handler.ts (LOW RISK)

**Goal**: Add missing platform abstraction and fix the simplest VS Code import.

**Files to CREATE**:

1. `libs/backend/platform-core/src/interfaces/diagnostics-provider.interface.ts` — New `IDiagnosticsProvider` interface

**Files to MODIFY**:

1. `libs/backend/platform-core/src/tokens.ts` — Add `DIAGNOSTICS_PROVIDER` token
2. `libs/backend/platform-core/src/index.ts` — Export new interface and token
3. `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/http-server.handler.ts` — Replace `vscode.workspace.getConfiguration()` with `IWorkspaceProvider.getConfiguration()`, remove `import * as vscode from 'vscode'`

**Risk**: LOW. The `IWorkspaceProvider.getConfiguration()` method already exists in platform-core. The IDiagnosticsProvider is a new additive interface.

**Verification**: `nx build vscode-lm-tools` should pass. The `http-server.handler.ts` file should have zero `vscode` imports.

---

### Batch 2: Abstract Diagnostics Namespace (LOW RISK)

**Goal**: Remove `import * as vscode from 'vscode'` from `core-namespace.builders.ts`.

**Files to MODIFY**:

1. `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/core-namespace.builders.ts` — Change `buildDiagnosticsNamespace()` to accept `IDiagnosticsProvider` parameter, remove `import * as vscode from 'vscode'`
2. `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/index.ts` — Update `CoreNamespaceDependencies` export if type changes
3. `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts` — Inject `IDiagnosticsProvider` via `PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER` and pass to `buildDiagnosticsNamespace()`

**Files to CREATE (VS Code platform implementation)**:

1. `libs/backend/vscode-core/src/platform/diagnostics-provider.vscode.ts` — VS Code implementation of `IDiagnosticsProvider` that wraps `vscode.languages.getDiagnostics()`

**Files to CREATE (Electron platform implementation)**:

1. `libs/backend/platform-electron/src/providers/diagnostics-provider.electron.ts` — Returns `[]` (no language server in Electron)

**Files to MODIFY (Platform DI registration)**:

1. VS Code DI container registration — register the VS Code `IDiagnosticsProvider` impl
2. Electron DI container registration — register the Electron `IDiagnosticsProvider` impl

**Risk**: LOW. `buildWorkspaceNamespace()` and `buildSearchNamespace()` in the same file are already platform-agnostic. Only `buildDiagnosticsNamespace()` touches VS Code APIs. The change is isolated.

**Verification**: `core-namespace.builders.ts` should have zero `vscode` imports. `nx build vscode-lm-tools` passes.

---

### Batch 3: IDE Namespace Graceful Degradation (MEDIUM RISK)

**Goal**: Remove `import * as vscode from 'vscode'` from `ide-namespace.builder.ts` by extracting VS Code calls into an injectable `IIDECapabilities` interface.

**Files to MODIFY**:

1. `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/ide-namespace.builder.ts`:
   - Define `IIDECapabilities` interface (local to the file or in a shared types file)
   - Change `buildIDENamespace()` to accept optional `IIDECapabilities` parameter
   - When `capabilities` is undefined, return graceful degradation stub (empty arrays, null, false)
   - When `capabilities` is provided, delegate to its methods
   - Remove `import * as vscode from 'vscode'`
   - The actual VS Code implementation of `IIDECapabilities` goes in a separate file

2. `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/index.ts` — Update export types

3. `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts`:
   - Accept optional IDE capabilities
   - Pass to `buildIDENamespace()`
   - In Electron: capabilities are undefined, graceful degradation

**Files to CREATE**:

1. `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/ide-capabilities.vscode.ts` — VS Code implementation of `IIDECapabilities` that uses all the `vscode.commands.executeCommand()`, `vscode.window.*`, `vscode.workspace.*` APIs. This file WILL import vscode, and that's fine — it's only loaded in VS Code context.

**Risk**: MEDIUM. This is the largest single file change (818 lines). The IDE namespace has 4 sub-namespaces (lsp, editor, actions, testing) with 20+ methods. However, the graceful degradation pattern is well-established in the existing `buildTestingNamespace()`.

**Key Design**: The `IIDECapabilities` interface is registered in DI as an optional token. In VS Code, the implementation is registered. In Electron, the token is not registered, and `buildIDENamespace()` receives `undefined`.

**Verification**: `ide-namespace.builder.ts` should have zero `vscode` imports. The new `ide-capabilities.vscode.ts` file will have vscode imports but is only included in VS Code builds. `nx build vscode-lm-tools` passes.

---

### Batch 4: Remove Shim + WebviewManager Optionality (LOW-MEDIUM RISK)

**Goal**: Remove the Electron shim and make the library fully functional in Electron.

**Files to MODIFY**:

1. `apps/ptah-electron/tsconfig.build.json` — Remove the `@ptah-extension/vscode-lm-tools` path alias that points to the shim
2. `libs/backend/vscode-lm-tools/src/lib/code-execution/code-execution-mcp.service.ts` — Make `WebviewManager` injection optional (use `@inject(TOKENS.WEBVIEW_MANAGER) @optional()` or check `container.isRegistered()`)
3. `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/protocol-handlers.ts` — Handle missing `WebviewManager` in approval_prompt handler (auto-allow or use `IUserInteraction` fallback)

**Files to DELETE**:

1. `apps/ptah-electron/src/shims/vscode-lm-tools-shim.ts` — No longer needed

**Files to MODIFY (Electron DI)**:

1. Electron DI container — Register `vscode-lm-tools` services (PtahAPIBuilder, CodeExecutionMCP, PermissionPromptService) just like the VS Code container does

**Risk**: LOW-MEDIUM. The shim removal is straightforward. The WebviewManager optionality needs careful testing to ensure the approval_prompt tool doesn't crash when WebviewManager is absent.

**Verification**:

- Electron app compiles without the shim alias
- `CodeExecutionMCP` starts its HTTP server successfully in Electron
- MCP tools (workspace analyze, search files, AST, agent spawn, etc.) work in Electron
- `approval_prompt` tool gracefully handles missing WebviewManager

---

### Batch 5: MCP Tool Availability Filtering (LOW RISK)

**Goal**: Make the MCP tools/list response platform-aware so that VS Code-only tools are not advertised in Electron.

**Files to MODIFY**:

1. `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/protocol-handlers.ts` — In `handleToolsList()`, conditionally include VS Code-only tools:
   - `ptah_lsp_references` — VS Code only (uses `ptah.ide.lsp.getReferences`)
   - `ptah_lsp_definitions` — VS Code only (uses `ptah.ide.lsp.getDefinition`)
   - `ptah_get_dirty_files` — VS Code only (uses `ptah.ide.editor.getDirtyFiles`)
   - `ptah_get_diagnostics` — Available on both (uses `IDiagnosticsProvider`)

2. `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-system-prompt.constant.ts` — Make the system prompt dynamically generated based on available capabilities, or add a note that LSP tools are VS Code-only

**Risk**: LOW. This is an additive change that only affects tool discovery, not tool execution.

**Verification**: In Electron, `tools/list` MCP call should not include `ptah_lsp_references`, `ptah_lsp_definitions`, `ptah_get_dirty_files`. All other tools should be listed.

---

### Batch 6: Integration Testing & System Prompt (LOW RISK)

**Goal**: Verify end-to-end MCP server functionality in both platforms. Update system prompt.

**Tasks**:

1. Start MCP server in Electron and verify all platform-agnostic tools work
2. Verify tool execution through the `execute_code` tool with `ptah.workspace.analyze()`
3. Verify `ptah.agent.spawn()` works in Electron (CLI agent spawning is Node.js-based)
4. Verify `ptah.ast.analyze()` works in Electron (tree-sitter is Node.js-based)
5. Verify `ptah.files.read()`, `ptah.files.list()` work in Electron
6. Verify `ptah.search.findFiles()` works in Electron
7. Update `PTAH_SYSTEM_PROMPT` to note which tools are VS Code-exclusive vs platform-agnostic
8. Update `libs/backend/vscode-lm-tools/CLAUDE.md` documentation

**Risk**: LOW. Pure verification and documentation.

---

## 7. Risk Assessment Summary

| Batch                                     | Risk       | Reason                                                             | Mitigation                                                  |
| ----------------------------------------- | ---------- | ------------------------------------------------------------------ | ----------------------------------------------------------- |
| 1: IDiagnosticsProvider + http-server fix | LOW        | Additive interface + 1-line config fix                             | Interface is simple, config API already exists              |
| 2: Diagnostics abstraction                | LOW        | Isolated change to 1 function, 2 others in same file already clean | Follow existing pattern from analysis-namespace.builders.ts |
| 3: IDE namespace graceful degradation     | MEDIUM     | Largest file (818 lines), 20+ methods to stub                      | Follow existing TestingNamespace pattern from same file     |
| 4: Remove shim + WebviewManager           | LOW-MEDIUM | Shim removal changes Electron build resolution                     | Test Electron build immediately after                       |
| 5: Tool filtering                         | LOW        | Additive conditional logic                                         | Only affects tool discovery, not execution                  |
| 6: Integration testing                    | LOW        | Verification only                                                  | No code changes                                             |

---

## 8. Dependency Map

### Which Namespaces Depend on Which Platform Abstractions

```
Namespace                  | Platform Abstractions Used              | VS Code Needed?
--------------------------|----------------------------------------|----------------
workspace                 | WorkspaceAnalyzerService (injected)     | NO
search                    | ContextOrchestrationService (injected)  | NO
diagnostics               | IDiagnosticsProvider (NEW)              | PARTIALLY (stub in Electron)
files                     | IFileSystemProvider, IWorkspaceProvider  | NO
context                   | workspace-intelligence services          | NO
project                   | IWorkspaceProvider, workspace-intel      | NO
relevance                 | workspace-intelligence services          | NO
dependencies              | DependencyGraphService (injected)        | NO
ast                       | IFileSystemProvider, IWorkspaceProvider  | NO
ide.lsp                   | IIDECapabilities (VS Code only)         | YES (graceful degradation)
ide.editor                | IIDECapabilities (VS Code only)         | YES (graceful degradation)
ide.actions               | IIDECapabilities (VS Code only)         | YES (graceful degradation)
ide.testing               | None (already stubs)                    | YES (already graceful)
orchestration             | Node.js fs (built-in)                   | NO
agent                     | AgentProcessManager, CliDetection        | NO
webSearch                 | CliDetectionService                     | NO
```

### MCP Tools Platform Availability Matrix

```
MCP Tool                  | Works in VS Code | Works in Electron | Notes
-------------------------|------------------|-------------------|------
ptah_workspace_analyze   | YES              | YES               | Uses WorkspaceAnalyzerService
ptah_search_files        | YES              | YES               | Uses ContextOrchestrationService
ptah_get_diagnostics     | YES              | PARTIAL            | Empty in Electron (no LSP)
ptah_lsp_references      | YES              | NO (graceful)      | Needs VS Code LSP
ptah_lsp_definitions     | YES              | NO (graceful)      | Needs VS Code LSP
ptah_get_dirty_files     | YES              | NO (graceful)      | Needs VS Code editor state
ptah_count_tokens        | YES              | YES               | Uses TokenCounterService
ptah_agent_spawn         | YES              | YES               | Uses AgentProcessManager (Node.js)
ptah_agent_status        | YES              | YES               | Pure in-memory state
ptah_agent_read          | YES              | YES               | Pure in-memory state
ptah_agent_steer         | YES              | YES               | Process stdin
ptah_agent_stop          | YES              | YES               | Process signal
ptah_agent_list          | YES              | YES               | CLI detection (Node.js)
ptah_web_search          | YES              | YES               | Gemini CLI (Node.js)
execute_code             | YES              | YES               | AsyncFunction execution
approval_prompt          | YES              | MODIFIED           | Uses IUserInteraction instead of WebviewManager
```

---

## 9. Consumers and Shim Impact

### Current consumers of `@ptah-extension/vscode-lm-tools`:

| Consumer                                                                | What it imports                                  | Impact of removing shim                          |
| ----------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------ |
| `apps/ptah-extension-vscode/src/di/container.ts`                        | `registerVsCodeLmToolsServices`                  | None (VS Code always has full library)           |
| `libs/backend/rpc-handlers/.../chat-rpc.handlers.ts`                    | `CodeExecutionMCP` (class type for DI injection) | None — resolved via DI, not direct instantiation |
| `libs/backend/rpc-handlers/.../enhanced-prompts-rpc.handlers.ts`        | `CodeExecutionMCP`                               | Same as above                                    |
| `libs/backend/rpc-handlers/.../setup-rpc.handlers.ts`                   | `CodeExecutionMCP`                               | Same as above                                    |
| `libs/backend/rpc-handlers/.../wizard-generation-rpc.handlers.ts`       | `CodeExecutionMCP`                               | Same as above                                    |
| `libs/backend/agent-generation/.../agent-customization.service.spec.ts` | `PtahAPIBuilder` (in test)                       | Test file, may need mock update                  |
| `apps/ptah-electron/src/shims/vscode-lm-tools-shim.ts`                  | N/A (IS the shim)                                | DELETED                                          |
| `apps/ptah-electron/tsconfig.build.json`                                | Path alias to shim                               | REMOVED                                          |

### Why the shim exists:

The shim was created because the `agent-sdk` library dynamically requires `PTAH_SYSTEM_PROMPT` from `@ptah-extension/vscode-lm-tools`. Since the full library had vscode imports, the Electron build couldn't include it. The shim provides `PTAH_SYSTEM_PROMPT = ''` so the import resolves.

After this task: The full library will be vscode-free (the 3 remaining vscode imports will use platform abstractions), so the shim is no longer needed.

---

## 10. Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**:

- All changes are in backend TypeScript libraries (Node.js context)
- Requires understanding of DI patterns (tsyringe), platform abstraction interfaces, and MCP protocol
- No frontend/Angular work involved
- Requires creating platform interface implementations for both VS Code and Electron

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 6-10 hours across 6 batches

**Breakdown**:

- Batch 1 (IDiagnosticsProvider + http-server fix): 1-1.5 hours
- Batch 2 (Diagnostics abstraction): 1-1.5 hours
- Batch 3 (IDE namespace graceful degradation): 2-3 hours (largest batch)
- Batch 4 (Remove shim + WebviewManager): 1-1.5 hours
- Batch 5 (Tool filtering): 0.5-1 hour
- Batch 6 (Integration testing): 0.5-1 hour

### Files Affected Summary

**CREATE** (4 files):

- `libs/backend/platform-core/src/interfaces/diagnostics-provider.interface.ts`
- `libs/backend/vscode-core/src/platform/diagnostics-provider.vscode.ts`
- `libs/backend/platform-electron/src/providers/diagnostics-provider.electron.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/ide-capabilities.vscode.ts`

**MODIFY** (12 files):

- `libs/backend/platform-core/src/tokens.ts`
- `libs/backend/platform-core/src/index.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/http-server.handler.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/core-namespace.builders.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/ide-namespace.builder.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/index.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/code-execution-mcp.service.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/protocol-handlers.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-system-prompt.constant.ts`
- `apps/ptah-electron/tsconfig.build.json`
- VS Code and Electron DI container registrations

**DELETE** (1 file):

- `apps/ptah-electron/src/shims/vscode-lm-tools-shim.ts`

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **All platform-core interfaces exist**:
   - `IWorkspaceProvider.getConfiguration()` at `libs/backend/platform-core/src/interfaces/workspace-provider.interface.ts:34`
   - `IFileSystemProvider` at `libs/backend/platform-core/src/interfaces/file-system-provider.interface.ts:17`
   - `IStateStorage` at `libs/backend/platform-core/src/interfaces/state-storage.interface.ts:9`
   - `PLATFORM_TOKENS` at `libs/backend/platform-core/src/tokens.ts:11`

2. **All DI tokens exist in vscode-core**:
   - `TOKENS.PTAH_API_BUILDER` at `libs/backend/vscode-core/src/di/tokens.ts`
   - `TOKENS.CODE_EXECUTION_MCP` at `libs/backend/vscode-core/src/di/tokens.ts`
   - `TOKENS.PERMISSION_PROMPT_SERVICE` at `libs/backend/vscode-core/src/di/tokens.ts`
   - `TOKENS.WEBVIEW_MANAGER` at `libs/backend/vscode-core/src/di/tokens.ts:53`

3. **Graceful degradation pattern verified from existing code**:
   - `buildTestingNamespace()` at `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/ide-namespace.builder.ts:740-817`

4. **No hallucinated APIs**:
   - All decorators verified: `@injectable()`, `@inject()` from `tsyringe`
   - All platform interfaces verified in platform-core source
   - All DI tokens verified in vscode-core/src/di/tokens.ts

### Architecture Delivery Checklist

- [x] All 25 source files audited with VS Code dependency classification
- [x] All 3 VS Code-dependent files have abstraction strategies
- [x] All patterns verified from codebase (graceful degradation, DI injection, platform interfaces)
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined (platform-agnostic compilation, graceful degradation)
- [x] Integration points documented (DI container, platform providers)
- [x] Files affected list complete (4 create, 12 modify, 1 delete)
- [x] Developer type recommended (backend-developer)
- [x] Complexity assessed (MEDIUM, 6-10 hours)
- [x] 6-batch plan with risk assessment per batch
- [x] MCP tool platform availability matrix documented
- [x] Dependency map showing namespace-to-abstraction relationships
- [x] No backward compatibility layers (direct replacement strategy)

---

## 11. USER DESIGN GUIDANCE: Tree-Sitter as VS Code API Replacement

**Added post-architecture review. These decisions MUST be incorporated during implementation.**

### 11.1 Key Decision: Use Tree-Sitter to Replace vscode.languages APIs Where Possible

The user has confirmed that **tree-sitter should be relied upon to replace VS Code internal APIs** (like `vscode.languages` for symbols, diagnostics, etc.) as much as possible. Tree-sitter provides AST parsing, symbol extraction, etc. without any VS Code dependency.

This changes the approach for several items in the plan:

### 11.2 Verified: `ptah.ast` Namespace Already Uses Tree-Sitter

**Confirmed**: `ast-namespace.builder.ts` already uses `TreeSitterParserService` and `AstAnalysisService` from `@ptah-extension/workspace-intelligence`. It is fully platform-agnostic (no vscode imports). The namespace provides:

- `analyze(filePath)` - Extract functions, classes, imports, exports
- `parse(filePath, maxDepth)` - Full AST tree
- `queryFunctions(filePath)` - Find all functions
- `queryClasses(filePath)` - Find all classes
- `queryImports(filePath)` - Find all imports
- `queryExports(filePath)` - Find all exports
- `getSupportedLanguages()` - List supported languages

### 11.3 Impact on IDE Namespace (Batch 3) - Extend Tree-Sitter Instead of Pure Stubs

The original plan (Section 3.2) proposed "graceful degradation" stubs for the IDE namespace in Electron (empty arrays, null, false). With the tree-sitter directive, the implementation should instead:

**For LSP-like features (`ide.lsp.*`):**

- `getDefinition(file, line, col)` - Tree-sitter can find symbol definitions by parsing imports and scanning workspace files for matching exported symbols. Not as precise as LSP but functional.
- `getReferences(file, line, col)` - Tree-sitter can search for symbol usage across files using `queryFunctions`/`queryClasses` + text search.
- `getHover(file, line, col)` - Tree-sitter can extract the AST node at position and provide type/signature info from the parsed tree.
- `getTypeDefinition(file, line, col)` - Similar to definition but for type declarations.

**For editor state (`ide.editor.*`):**

- `getActiveEditor()`, `getVisibleEditors()`, `getDirtyFiles()` - These are genuinely editor-specific. In Electron there is no editor, so stubs returning null/empty are correct.

**For code actions (`ide.actions.*`):**

- `organizeImports()`, `fixAll()` - These require language server integration. Stubs are correct for Electron.
- `rename()` - Could potentially use tree-sitter to find all references and do text replacement, but this is a stretch goal.

**Recommendation**: Create a `TreeSitterIDEProvider` that implements a subset of `IIDECapabilities` using tree-sitter for definition/reference lookup. This provides real (approximate) functionality in Electron rather than dead stubs, making the MCP tools significantly more useful.

### 11.4 Impact on Diagnostics (Batch 2)

The original plan proposed an `IDiagnosticsProvider` that returns `[]` in Electron. With tree-sitter available:

- Tree-sitter itself does not do diagnostics (it parses syntax, not semantics)
- However, tree-sitter CAN detect **syntax errors** (parse errors in the AST)
- For TypeScript projects, the Electron implementation could also shell out to `tsc --noEmit` and parse output
- For the initial implementation, returning tree-sitter syntax errors is a good minimum viable diagnostics provider

### 11.5 Revised MCP Tool Platform Availability Matrix

With tree-sitter providing fallback implementations:

```
MCP Tool                  | VS Code        | Electron (revised)    | Notes
-------------------------|----------------|----------------------|------
ptah_lsp_references      | YES (LSP)      | PARTIAL (tree-sitter) | Cross-file symbol search
ptah_lsp_definitions     | YES (LSP)      | PARTIAL (tree-sitter) | Import-based definition lookup
ptah_get_diagnostics     | YES (LSP)      | PARTIAL (syntax only) | Tree-sitter parse errors
ptah_get_dirty_files     | YES            | NO (stub)             | Editor-specific, no workaround
```

### 11.6 Implementation Priority

When implementing Batches 2 and 3, the developer should:

1. First create the interfaces (`IDiagnosticsProvider`, `IIDECapabilities`) as designed
2. Create the VS Code implementations as designed
3. For Electron implementations, use tree-sitter-based providers instead of empty stubs where feasible
4. The tree-sitter services (`TreeSitterParserService`, `AstAnalysisService`) are already injectable via DI and platform-agnostic
