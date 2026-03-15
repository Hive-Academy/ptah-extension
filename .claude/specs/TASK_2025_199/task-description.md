# Requirements Document - TASK_2025_199: Platform Abstraction Layer for Multi-Runtime Support

## Introduction

Ptah Extension's backend libraries are tightly coupled to VS Code APIs (`import * as vscode from 'vscode'`), preventing the core business logic from running outside the VS Code extension host. This coupling blocks two strategic product goals: a standalone Electron desktop app and a Node.js CLI app that reuse the same backend intelligence.

The coupling is pervasive: `workspace-intelligence` has 28+ source files importing vscode, `agent-sdk` has 6, `agent-generation` has 9, `vscode-lm-tools` has 11, and `template-generation` has 2. These libraries use VS Code APIs for file system access (`workspace.fs`), state persistence (`Memento`/`globalState`), configuration (`workspace.getConfiguration`), secret storage (`ExtensionContext.secrets`), workspace folder discovery (`workspace.workspaceFolders`), file watching (`createFileSystemWatcher`), user interaction (`window.showErrorMessage`, `window.onDidChangeActiveTextEditor`), and command execution (`commands.executeCommand`).

This task creates a platform abstraction layer that replaces all direct VS Code API usage in business logic libraries with injectable interfaces, then provides VS Code implementations that preserve identical behavior.

## Requirements

### Requirement 1: Platform-Core Interfaces Library

**User Story:** As a developer building a standalone Ptah app (Electron or CLI), I want platform-agnostic interfaces for all OS/editor interactions, so that I can provide my own implementations without depending on VS Code APIs.

#### Acceptance Criteria

1. WHEN the `libs/backend/platform-core` library is created THEN it SHALL export the following interfaces with no dependency on `vscode` module:

   - `IFileSystemProvider` — `readFile(path: string): Promise<string>`, `writeFile(path: string, content: string): Promise<void>`, `readDirectory(path: string): Promise<DirectoryEntry[]>`, `stat(path: string): Promise<FileStat>`, `exists(path: string): Promise<boolean>`, `delete(path: string): Promise<void>`, `findFiles(pattern: string, exclude?: string): Promise<string[]>`, `createFileWatcher(pattern: string): IFileWatcher`
   - `IStateStorage` — `get<T>(key: string, defaultValue: T): T`, `update(key: string, value: unknown): Promise<void>`, `keys(): readonly string[]` (replaces `vscode.Memento` / `globalState` / `workspaceState`)
   - `ISecretStorage` — `get(key: string): Promise<string | undefined>`, `store(key: string, value: string): Promise<void>`, `delete(key: string): Promise<void>`, `onDidChange: IEvent<{ key: string }>` (replaces `ExtensionContext.secrets`)
   - `IWorkspaceProvider` — `getWorkspaceFolders(): string[]`, `getWorkspaceRoot(): string | undefined`, `getConfiguration<T>(section: string, key: string, defaultValue?: T): T`, `onDidChangeConfiguration: IEvent<{ section: string }>` (replaces `vscode.workspace.workspaceFolders`, `workspace.getConfiguration`)
   - `IUserInteraction` — `showErrorMessage(message: string, ...actions: string[]): Promise<string | undefined>`, `showWarningMessage(...)`, `showInformationMessage(...)`, `showQuickPick(items: QuickPickItem[], options?: QuickPickOptions): Promise<QuickPickItem | undefined>`, `showInputBox(options?: InputBoxOptions): Promise<string | undefined>`, `withProgress<T>(options: ProgressOptions, task: (progress: IProgress) => Promise<T>): Promise<T>` (replaces `vscode.window.*`)
   - `IOutputChannel` — `appendLine(message: string): void`, `append(message: string): void`, `clear(): void`, `show(): void`, `dispose(): void` (replaces `vscode.OutputChannel`)
   - `ICommandRegistry` — `registerCommand(id: string, handler: (...args: unknown[]) => unknown): IDisposable`, `executeCommand<T>(id: string, ...args: unknown[]): Promise<T>` (replaces `vscode.commands`)
   - `IEditorProvider` — `onDidChangeActiveEditor: IEvent<{ filePath: string | undefined }>`, `onDidOpenDocument: IEvent<{ filePath: string }>` (replaces `vscode.window.onDidChangeActiveTextEditor`, `workspace.onDidOpenTextDocument`)

2. WHEN platform-core is built THEN its `package.json` / `project.json` SHALL have zero dependency on `vscode` and zero dependency on `@ptah-extension/vscode-core`.

3. WHEN platform-core defines supporting types THEN it SHALL include:

   - `FileStat` — `{ type: FileType; size: number; ctime: number; mtime: number }`
   - `FileType` enum — `File`, `Directory`, `SymbolicLink`
   - `DirectoryEntry` — `{ name: string; type: FileType }`
   - `IDisposable` — `{ dispose(): void }`
   - `IEvent<T>` — event subscription pattern (callback-based, not RxJS)
   - `IFileWatcher` — `{ onDidChange: IEvent<string>; onDidCreate: IEvent<string>; onDidDelete: IEvent<string>; dispose(): void }`
   - `IProgress` — `{ report(value: { message?: string; increment?: number }): void }`
   - `PlatformType` enum — `VSCode`, `Electron`, `CLI`, `Web`
   - `IPlatformInfo` — `{ type: PlatformType; extensionPath: string; storagePath: string }`

4. WHEN DI tokens for platform interfaces are defined THEN they SHALL use the existing `Symbol.for()` convention and be exported from platform-core as `PLATFORM_TOKENS`.

### Requirement 2: Platform-VSCode Implementations Library

**User Story:** As the VS Code extension app, I want drop-in implementations of all platform interfaces that delegate to VS Code APIs, so that existing extension behavior is preserved identically.

#### Acceptance Criteria

1. WHEN `libs/backend/platform-vscode` is created THEN it SHALL implement every interface from platform-core using VS Code APIs:

   - `VscodeFileSystemProvider` wraps `vscode.workspace.fs.*` and `vscode.workspace.findFiles()`
   - `VscodeStateStorage` wraps `vscode.Memento` (supports both `globalState` and `workspaceState`)
   - `VscodeSecretStorage` wraps `vscode.ExtensionContext.secrets`
   - `VscodeWorkspaceProvider` wraps `vscode.workspace.workspaceFolders` and `vscode.workspace.getConfiguration()`
   - `VscodeUserInteraction` wraps `vscode.window.show*Message()`, `showQuickPick()`, `showInputBox()`, `withProgress()`
   - `VscodeOutputChannel` wraps `vscode.OutputChannel`
   - `VscodeCommandRegistry` wraps `vscode.commands.*`
   - `VscodeEditorProvider` wraps `vscode.window.onDidChangeActiveTextEditor` and `vscode.workspace.onDidOpenTextDocument`

2. WHEN platform-vscode implementations are registered in the DI container THEN the registration SHALL happen in `apps/ptah-extension-vscode/src/di/container.ts`, consistent with the existing centralized registration pattern.

3. WHEN platform-vscode is used by the existing extension THEN all existing functionality SHALL behave identically (zero behavioral regressions).

4. WHEN `VscodeFileSystemProvider` converts between `string` paths and `vscode.Uri` THEN it SHALL handle all URI schemes currently supported (`file://`, `vscode-vfs://`, `untitled://`).

### Requirement 3: Refactor agent-sdk to Use Platform Interfaces

**User Story:** As the agent-sdk library, I want to depend on platform-core interfaces instead of vscode APIs, so that the Claude Agent SDK integration can run in any runtime.

#### Acceptance Criteria

1. WHEN agent-sdk is refactored THEN the following files SHALL have zero `import * as vscode` or `from 'vscode'` statements:

   - `sdk-agent-adapter.ts` — replace `vscode.ExtensionContext` with `IPlatformInfo` + `IStateStorage`
   - `session-metadata-store.ts` — replace `vscode.Memento` injection with `IStateStorage`
   - `di/register.ts` — replace `vscode.ExtensionContext` parameter with platform tokens
   - `helpers/config-watcher.ts` — replace `vscode.ExtensionContext.secrets` and `vscode.Disposable` with `ISecretStorage` and `IDisposable`
   - `helpers/plugin-loader.service.ts` — replace `vscode.Memento` with `IStateStorage`
   - `copilot-provider/copilot-auth.service.ts` — replace `vscode.extensions.getExtension()` with an injectable extension discovery interface or move to platform-vscode

2. WHEN `TOKENS.GLOBAL_STATE` is injected in agent-sdk THEN it SHALL resolve to `IStateStorage` (from platform-core) instead of `vscode.Memento`.

3. WHEN `TOKENS.EXTENSION_CONTEXT` is used for `extensionPath` or `storagePath` THEN it SHALL be replaced with `IPlatformInfo` injected via `PLATFORM_TOKENS.PLATFORM_INFO`.

4. WHEN all agent-sdk refactoring is complete THEN `vscode` SHALL NOT appear in the library's `peerDependencies`, `dependencies`, or webpack externals.

### Requirement 4: Refactor workspace-intelligence to Use Platform Interfaces

**User Story:** As the workspace-intelligence library, I want to use platform-agnostic file system and workspace APIs, so that project analysis works in Electron and CLI runtimes.

#### Acceptance Criteria

1. WHEN workspace-intelligence is refactored THEN the following files SHALL replace `vscode.*` calls with platform interface calls:

   - `services/file-system.service.ts` — replace `vscode.workspace.fs.*` with `IFileSystemProvider` (this is the primary abstraction point; most other files use this service)
   - `workspace/workspace.service.ts` — replace `vscode.workspace.workspaceFolders` with `IWorkspaceProvider`
   - `context/context.service.ts` — replace `vscode.workspace.findFiles`, `vscode.workspace.fs.stat`, `vscode.workspace.fs.readDirectory`, `vscode.workspace.getConfiguration`, `vscode.window.onDidChangeActiveTextEditor`, `vscode.workspace.onDidOpenTextDocument`, `vscode.commands.executeCommand` with corresponding platform interfaces
   - `file-indexing/workspace-indexer.service.ts` — replace `vscode.workspace.findFiles` with `IFileSystemProvider.findFiles()`
   - `project-analysis/*.ts` (4 files) — replace `vscode.workspace.fs.readFile` and `vscode.Uri.file()` with `IFileSystemProvider`
   - `autocomplete/*.ts` (2 files) — replace `vscode.workspace.workspaceFolders` and `vscode.workspace.createFileSystemWatcher` with `IWorkspaceProvider` and `IFileSystemProvider.createFileWatcher()`
   - `composite/workspace-analyzer.service.ts` — replace `vscode.workspace.workspaceFolders` with `IWorkspaceProvider`
   - `ast/dependency-graph.service.ts` — replace vscode import with `IFileSystemProvider`
   - `context-analysis/context-enrichment.service.ts` — replace vscode import with platform interfaces
   - `quality/services/*.ts` (3 files) — replace vscode imports with platform interfaces

2. WHEN `vscode.Uri` is used as a parameter type in workspace-intelligence public APIs THEN it SHALL be replaced with `string` (file paths), and the platform-vscode `VscodeFileSystemProvider` SHALL handle `string` to `vscode.Uri` conversion internally.

3. WHEN `vscode.FileType` is used in workspace-intelligence THEN it SHALL be replaced with the `FileType` enum from platform-core.

4. WHEN all workspace-intelligence refactoring is complete THEN `vscode` SHALL NOT appear in any source file import (excluding test mocks which will use platform-core types instead).

### Requirement 5: Refactor agent-generation to Use Platform Interfaces

**User Story:** As the agent-generation library, I want to use platform-agnostic workspace and user interaction APIs, so that agent setup can work in standalone apps.

#### Acceptance Criteria

1. WHEN agent-generation is refactored THEN the following files SHALL have zero direct vscode imports:
   - `services/setup-status.service.ts` — replace `vscode.workspace.workspaceFolders` with `IWorkspaceProvider`
   - `services/wizard/agentic-analysis.service.ts` — replace vscode workspace access with platform interfaces
   - `services/wizard/multi-phase-analysis.service.ts` — replace vscode workspace access with platform interfaces
   - `services/wizard/webview-lifecycle.service.ts` — replace `vscode.ExtensionContext` type with `IPlatformInfo`
   - `services/orchestrator.service.ts` — replace `vscode.ExtensionContext` type with platform types
   - `services/setup-wizard.service.ts` — replace `vscode.ExtensionContext` type with platform types
   - `interfaces/setup-wizard.interface.ts` — replace `vscode.ExtensionContext` type with platform types

### Requirement 6: Refactor template-generation to Use Platform Interfaces

**User Story:** As the template-generation library, I want to use platform-agnostic file system APIs, so that template processing works outside VS Code.

#### Acceptance Criteria

1. WHEN template-generation is refactored THEN:

   - `adapters/file-system.adapter.ts` — replace `vscode.workspace.fs.*` and `vscode.Uri` with `IFileSystemProvider`
   - `services/template-generator.service.ts` — replace `vscode.workspace.workspaceFolders` with `IWorkspaceProvider`

2. WHEN refactoring is complete THEN template-generation SHALL depend only on `platform-core`, `shared`, and `vscode-core` (for TOKENS/Logger only — not for vscode APIs).

### Requirement 7: Refactor vscode-lm-tools to Use Platform Interfaces

**User Story:** As the vscode-lm-tools library, I want to use platform-agnostic APIs where possible, so that the MCP server and Ptah API can be reused outside VS Code.

#### Acceptance Criteria

1. WHEN vscode-lm-tools is refactored THEN the following files SHALL use platform interfaces where the underlying functionality is platform-agnostic:

   - `permission/permission-prompt.service.ts` — replace `ExtensionContext` with `IUserInteraction`
   - `code-execution/ptah-api-builder.service.ts` — replace `vscode.workspace.*` and `vscode.window.*` with platform interfaces
   - `code-execution/namespace-builders/*.ts` (6 files) — replace `vscode.workspace.*` and `vscode.Uri.*` with platform interfaces

2. WHEN vscode-lm-tools files require VS Code-specific APIs that have no platform equivalent (e.g., `vscode.languages.*`, `vscode.window.activeTextEditor` for IDE-specific features) THEN those specific usages MAY remain, but SHALL be isolated behind conditional checks or separate VS Code-specific modules.

3. WHEN `code-execution/code-execution-mcp.service.ts` uses `vscode.ExtensionContext` for MCP server setup THEN it SHALL be refactored to use `IPlatformInfo` for paths and `IStateStorage` for state.

### Requirement 8: DI Token Architecture

**User Story:** As a developer registering platform services, I want a clear token hierarchy that follows existing conventions, so that DI resolution is predictable across all runtimes.

#### Acceptance Criteria

1. WHEN platform tokens are defined THEN they SHALL follow the existing `Symbol.for()` convention:

   ```
   PLATFORM_TOKENS = {
     FILE_SYSTEM_PROVIDER: Symbol.for('PlatformFileSystemProvider'),
     STATE_STORAGE: Symbol.for('PlatformStateStorage'),
     WORKSPACE_STATE_STORAGE: Symbol.for('PlatformWorkspaceStateStorage'),
     SECRET_STORAGE: Symbol.for('PlatformSecretStorage'),
     WORKSPACE_PROVIDER: Symbol.for('PlatformWorkspaceProvider'),
     USER_INTERACTION: Symbol.for('PlatformUserInteraction'),
     OUTPUT_CHANNEL: Symbol.for('PlatformOutputChannel'),
     COMMAND_REGISTRY: Symbol.for('PlatformCommandRegistry'),
     EDITOR_PROVIDER: Symbol.for('PlatformEditorProvider'),
     PLATFORM_INFO: Symbol.for('PlatformInfo'),
   }
   ```

2. WHEN existing tokens like `TOKENS.GLOBAL_STATE` (currently `vscode.Memento`) are used by refactored libraries THEN they SHALL be migrated to the corresponding `PLATFORM_TOKENS` entry OR the existing token SHALL be re-typed to the platform interface (whichever causes fewer changes).

3. WHEN the DI container registers platform services THEN the registration order SHALL be: platform-core tokens first, then vscode-core services that depend on them, then all other library services.

## Non-Functional Requirements

### Performance Requirements

- **Zero overhead**: Platform abstraction layer SHALL add less than 1ms latency per call compared to direct VS Code API calls (the implementations are thin wrappers).
- **Memory**: Platform-core interfaces library SHALL add less than 50KB to the extension bundle.
- **Startup**: Platform service registration SHALL add less than 10ms to extension activation time.

### Compatibility Requirements

- **TypeScript**: All interfaces SHALL use TypeScript 5.8+ features (satisfies, const assertions) where beneficial.
- **Node.js**: Platform-core SHALL be compatible with Node.js 18+ (for future CLI app).
- **Electron**: Platform-core SHALL be compatible with Electron 28+ (for future desktop app).

### Testing Requirements

- **Unit tests**: Each platform-vscode implementation SHALL have unit tests that mock the underlying VS Code API and verify delegation.
- **Integration tests**: Existing tests in refactored libraries SHALL continue passing with platform interfaces injected instead of direct vscode mocks.
- **Type safety**: Zero `any` types in platform-core interfaces. All method signatures SHALL use concrete types.

### Build Requirements

- **Nx integration**: Both new libraries SHALL have proper `project.json` with build, test, lint, and typecheck targets.
- **Dependency graph**: `platform-core` SHALL sit at the foundation layer (same level as `shared`). `platform-vscode` SHALL sit at the infrastructure layer (same level as `vscode-core`).
- **Import paths**: `@ptah-extension/platform-core` and `@ptah-extension/platform-vscode`.

## Scope

### IN SCOPE

- Creating `libs/backend/platform-core` with all interfaces and types
- Creating `libs/backend/platform-vscode` with VS Code implementations
- Refactoring `agent-sdk` to remove all direct vscode imports (6 files)
- Refactoring `workspace-intelligence` to remove all direct vscode imports (28 source files + test files)
- Refactoring `agent-generation` to remove all direct vscode imports (9 files)
- Refactoring `template-generation` to remove all direct vscode imports (2 files)
- Refactoring `vscode-lm-tools` to remove vscode imports where platform-agnostic alternatives exist (11 files)
- Updating DI container registration in `apps/ptah-extension-vscode/src/di/container.ts`
- Updating all affected test files to use platform-core types in mocks
- Updating CLAUDE.md files for affected libraries

### OUT OF SCOPE

- Building the actual Electron app (future TASK)
- Building the actual CLI app (future TASK)
- Creating `platform-electron` or `platform-cli` implementations (future TASK)
- Refactoring `llm-abstraction` — it keeps VS Code LM API dependency (it is a VS Code-specific provider by design)
- Refactoring `vscode-core` — it remains VS Code-specific by design (infrastructure layer)
- Refactoring the `apps/ptah-extension-vscode` app — it is inherently VS Code-specific
- Changing the frontend libraries (they run in webview, not affected)
- Migrating the DI framework itself (tsyringe stays)

## Stakeholder Analysis

### Primary Stakeholders

| Stakeholder         | Impact Level       | Involvement        | Success Criteria                                  |
| ------------------- | ------------------ | ------------------ | ------------------------------------------------- |
| Extension Users     | None (transparent) | None               | Zero behavioral regressions                       |
| Core Developers     | High               | Implementation     | Clean interfaces, easy to implement new platforms |
| Future Electron App | High (unblocked)   | Requirements input | Can instantiate backend without vscode module     |
| Future CLI App      | High (unblocked)   | Requirements input | Can instantiate backend without vscode module     |

### Secondary Stakeholders

| Stakeholder    | Impact Level | Involvement  | Success Criteria                           |
| -------------- | ------------ | ------------ | ------------------------------------------ |
| CI/CD Pipeline | Low          | Verification | All builds pass, no new lint errors        |
| Test Suite     | Medium       | Adaptation   | All existing tests pass with updated mocks |

## Risk Assessment

| Risk                                                            | Probability | Impact   | Score | Mitigation Strategy                                                                                                                                                                          |
| --------------------------------------------------------------- | ----------- | -------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface design misses a VS Code API surface, requiring rework | Medium      | Medium   | 6     | Exhaustive grep analysis completed (documented above); architect reviews all vscode usages before interface design                                                                           |
| Performance regression from abstraction layer                   | Low         | Medium   | 3     | Implementations are thin wrappers with no additional logic; benchmark before/after                                                                                                           |
| `vscode.Uri` removal breaks URI scheme handling                 | Medium      | High     | 8     | `VscodeFileSystemProvider` handles all Uri conversion internally; string paths used at interface boundary; comprehensive test coverage for `file://`, `vscode-vfs://`, `untitled://` schemes |
| DI token migration causes silent resolution failures            | Medium      | Critical | 9     | Use `Symbol.for()` convention consistently; add runtime assertions in dev mode to verify token resolution; test each library's DI independently                                              |
| Large PR size makes review difficult                            | High        | Medium   | 6     | Phase the work: Phase 1 (platform-core + platform-vscode), Phase 2 (agent-sdk + template-generation), Phase 3 (workspace-intelligence), Phase 4 (agent-generation + vscode-lm-tools)         |
| Test mock updates missed, causing false passes                  | Medium      | High     | 8     | Grep for all `jest.mock('vscode')` patterns; update every mock to use platform-core types; CI must pass with strict type checking                                                            |

## Dependencies

### Internal Dependencies

- **tsyringe DI system** — platform-core tokens must use `Symbol.for()` convention
- **Nx workspace configuration** — new libraries need proper `project.json`, `tsconfig`, and path aliases in root `tsconfig.base.json`
- **Existing test infrastructure** — Jest configuration with `__mocks__/vscode.ts` files must be updated to provide platform-core mocks instead
- **vscode-core TOKENS** — some tokens (GLOBAL_STATE, EXTENSION_CONTEXT) may need migration or aliasing to platform tokens

### External Dependencies

- **VS Code API (vscode ^1.103.0)** — only in platform-vscode, not in platform-core
- **Node.js fs/path modules** — platform-core interfaces should not assume Node.js APIs either (future web platform support)

## Success Metrics

1. **Zero vscode imports in business libraries**: `grep -r "from 'vscode'" libs/backend/agent-sdk/src libs/backend/workspace-intelligence/src libs/backend/agent-generation/src libs/backend/template-generation/src` returns zero results (excluding test mocks that import platform-core types)
2. **All existing tests pass**: `nx run-many --target=test` succeeds with zero failures
3. **All type checks pass**: `nx run-many --target=typecheck` succeeds with zero errors
4. **Build succeeds**: `nx run-many --target=build` produces working bundles
5. **Extension functions identically**: Manual smoke test of chat, workspace analysis, agent generation, and template processing shows no behavioral differences
6. **Platform-core is truly agnostic**: The library can be imported and type-checked in a plain Node.js project with no VS Code SDK installed

## Phased Delivery Recommendation

**Phase 1 — Foundation** (platform-core + platform-vscode): Create interfaces and VS Code implementations. No existing code changes yet. Verify builds.

**Phase 2 — Low-risk refactoring** (template-generation + agent-sdk): Refactor the two smallest libraries (2 + 6 files). Validate approach and DI patterns.

**Phase 3 — High-impact refactoring** (workspace-intelligence): Refactor the largest library (28 files). This is the highest-risk phase due to volume.

**Phase 4 — Remaining libraries** (agent-generation + vscode-lm-tools): Complete the refactoring (9 + 11 files). Some vscode-lm-tools files may retain VS Code-specific imports for IDE features.
