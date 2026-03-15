# Implementation Plan - TASK_2025_199: Platform Abstraction Layer for Multi-Runtime Support

## Codebase Investigation Summary

### Libraries Discovered

- **vscode-core** (`libs/backend/vscode-core/src/di/tokens.ts`): 60+ DI tokens using `Symbol.for()` convention. TOKENS constant aggregates all tokens.
- **agent-sdk** (`libs/backend/agent-sdk/src/lib/di/register.ts`): Registration function takes `(container, context: vscode.ExtensionContext, logger)`. 6 source files import vscode.
- **workspace-intelligence** (`libs/backend/workspace-intelligence/src/di/register.ts`): Registration function takes `(container, logger)`. 15 source files + 8 test files import vscode.
- **agent-generation** (`libs/backend/agent-generation/src/lib/di/register.ts`): Registration function takes `(container, logger, extensionPath)`. 7 source files import vscode.
- **template-generation** (`libs/backend/template-generation/src/lib/di/register.ts`): Registration function takes `(container, logger)`. 2 source files import vscode.
- **vscode-lm-tools** (`libs/backend/vscode-lm-tools/src/lib/di/register.ts`): Registration function takes `(container, logger)`. 11 source files import vscode.

### Patterns Identified

- **DI Token Convention**: All tokens use `Symbol.for('DescriptiveName')` (verified: `libs/backend/vscode-core/src/di/tokens.ts:1-31`)
- **Library Registration Pattern**: Each library exports `registerXxxServices(container, logger, ...)` called from `apps/ptah-extension-vscode/src/di/container.ts`
- **Nx Library Pattern**: `project.json` with `@nx/esbuild:esbuild` executor, CJS format, vscode as external (verified: `libs/backend/workspace-intelligence/project.json`)
- **TypeScript Config**: `tsconfig.lib.json` extends `tsconfig.json`, uses `module: "node16"`, `moduleResolution: "node16"` (verified: `libs/backend/workspace-intelligence/tsconfig.lib.json`)
- **Import Aliases**: Defined in `tsconfig.base.json` as `@ptah-extension/<lib-name>`

### Key VS Code API Usage Patterns (Evidence-Based)

| Pattern                                     | Example File:Line               | Replacement                               |
| ------------------------------------------- | ------------------------------- | ----------------------------------------- |
| `vscode.Memento` for storage                | `session-metadata-store.ts:107` | `IStateStorage`                           |
| `vscode.ExtensionContext` for paths         | `sdk-agent-adapter.ts:21`       | `IPlatformInfo`                           |
| `vscode.ExtensionContext.secrets`           | `config-watcher.ts:54`          | `ISecretStorage`                          |
| `vscode.workspace.workspaceFolders`         | `workspace.service.ts:188`      | `IWorkspaceProvider`                      |
| `vscode.workspace.fs.*`                     | `file-system.service.ts:27`     | `IFileSystemProvider`                     |
| `vscode.workspace.findFiles`                | `context.service.ts`            | `IFileSystemProvider.findFiles()`         |
| `vscode.workspace.getConfiguration`         | `context.service.ts`            | `IWorkspaceProvider.getConfiguration()`   |
| `vscode.workspace.createFileSystemWatcher`  | autocomplete services           | `IFileSystemProvider.createFileWatcher()` |
| `vscode.window.show*Message`                | agent-generation                | `IUserInteraction`                        |
| `vscode.commands.executeCommand`            | context.service.ts              | `ICommandRegistry`                        |
| `vscode.window.onDidChangeActiveTextEditor` | context.service.ts              | `IEditorProvider`                         |
| `vscode.Uri` as parameter type              | `file-system.service.ts:25`     | `string` path                             |
| `vscode.FileType` enum                      | `workspace.service.ts:506`      | platform-core `FileType`                  |
| `vscode.Disposable`                         | `config-watcher.ts:22-23`       | `IDisposable`                             |
| `vscode.extensions.getExtension`            | `copilot-auth.service.ts:28`    | Stays VS Code-specific (isolated)         |

---

## Architecture Design

### Layer Diagram

```
+----------------------------------------------------------------------+
|  Application Layer                                                    |
|  apps/ptah-extension-vscode/src/di/container.ts                      |
|    - Registers PLATFORM_TOKENS with VscodeXxx implementations        |
|    - Calls registerXxxServices() — libraries resolve platform tokens  |
+----------------------------------------------------------------------+
|  Feature Libraries (REFACTORED — no vscode imports)                  |
|  agent-sdk | workspace-intelligence | agent-generation               |
|  template-generation | vscode-lm-tools (partial)                     |
|    - Import interfaces from @ptah-extension/platform-core            |
|    - Inject via PLATFORM_TOKENS                                      |
+----------------------------------------------------------------------+
|  Infrastructure Layer                                                |
|  libs/backend/platform-vscode     | libs/backend/vscode-core         |
|    - VscodeFileSystemProvider     |   - Logger, ConfigManager, etc.  |
|    - VscodeStateStorage           |   - Remains VS Code-specific     |
|    - VscodeSecretStorage          |                                  |
|    - VscodeWorkspaceProvider      |                                  |
|    - VscodeUserInteraction        |                                  |
|    - VscodeOutputChannel          |                                  |
|    - VscodeCommandRegistry        |                                  |
|    - VscodeEditorProvider         |                                  |
+----------------------------------------------------------------------+
|  Foundation Layer                                                    |
|  libs/backend/platform-core      | libs/shared                       |
|    - IFileSystemProvider          |   - Branded types, message proto  |
|    - IStateStorage                |   - AI provider abstractions      |
|    - ISecretStorage               |   - Zero dependencies             |
|    - IWorkspaceProvider           |                                  |
|    - IUserInteraction             |                                  |
|    - IOutputChannel               |                                  |
|    - ICommandRegistry             |                                  |
|    - IEditorProvider              |                                  |
|    - PLATFORM_TOKENS              |                                  |
|    - Supporting types (FileType,  |                                  |
|      FileStat, IDisposable, etc.) |                                  |
+----------------------------------------------------------------------+
```

### Dependency Flow

```
platform-core  ←  platform-vscode  ←  apps/ptah-extension-vscode
     ↑                                        ↑
     |                                        |
     +--- agent-sdk ----+                     |
     +--- workspace-intelligence --+          |
     +--- agent-generation --------+----------+
     +--- template-generation -----+
     +--- vscode-lm-tools (partial)+
```

---

## Phase 1: Foundation — platform-core Library

### 1.1 Library Scaffolding

**Create**: `libs/backend/platform-core/`

#### File: `libs/backend/platform-core/project.json`

```json
{
  "name": "@ptah-extension/platform-core",
  "$schema": "../../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "libs/backend/platform-core/src",
  "projectType": "library",
  "tags": ["scope:shared", "type:util"],
  "targets": {
    "build": {
      "executor": "@nx/esbuild:esbuild",
      "outputs": ["{options.outputPath}"],
      "options": {
        "outputPath": "dist/libs/backend/platform-core",
        "main": "libs/backend/platform-core/src/index.ts",
        "tsConfig": "libs/backend/platform-core/tsconfig.lib.json",
        "assets": ["libs/backend/platform-core/*.md"],
        "format": ["cjs"],
        "external": ["tsyringe", "reflect-metadata"]
      }
    },
    "test": {
      "executor": "@nx/jest:jest",
      "outputs": ["{workspaceRoot}/coverage/{projectRoot}"],
      "options": {
        "jestConfig": "libs/backend/platform-core/jest.config.ts"
      }
    },
    "typecheck": {
      "executor": "nx:run-commands",
      "options": {
        "command": "tsc --noEmit --project libs/backend/platform-core/tsconfig.lib.json"
      }
    },
    "lint": {
      "executor": "@nx/eslint:lint"
    }
  }
}
```

#### File: `libs/backend/platform-core/tsconfig.json`

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "module": "node16",
    "moduleResolution": "node16",
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  },
  "files": [],
  "include": [],
  "references": [{ "path": "./tsconfig.lib.json" }, { "path": "./tsconfig.spec.json" }]
}
```

#### File: `libs/backend/platform-core/tsconfig.lib.json`

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "../../../dist/out-tsc",
    "declaration": true,
    "types": ["node"],
    "module": "node16",
    "moduleResolution": "node16"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["jest.config.ts", "src/**/*.spec.ts", "src/**/*.test.ts"]
}
```

#### File: `libs/backend/platform-core/tsconfig.spec.json`

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "../../../dist/out-tsc",
    "module": "node16",
    "moduleResolution": "node16",
    "types": ["jest", "node"]
  },
  "include": ["jest.config.ts", "src/**/*.test.ts", "src/**/*.spec.ts", "src/**/*.d.ts"]
}
```

#### File: `libs/backend/platform-core/jest.config.ts`

```typescript
export default {
  displayName: 'platform-core',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../../coverage/libs/backend/platform-core',
};
```

#### Add to `tsconfig.base.json` paths:

```json
"@ptah-extension/platform-core": ["libs/backend/platform-core/src/index.ts"]
```

### 1.2 Supporting Types

#### File: `libs/backend/platform-core/src/types/platform.types.ts`

```typescript
/**
 * Platform Abstraction Types
 *
 * Platform-agnostic types replacing VS Code-specific types.
 * These types have ZERO dependency on 'vscode' module.
 */

// ============================================================
// Disposable Pattern
// ============================================================

/**
 * Resource that can be disposed.
 * Replaces: vscode.Disposable
 */
export interface IDisposable {
  dispose(): void;
}

// ============================================================
// Event System
// ============================================================

/**
 * Event subscription handler.
 * Replaces: vscode.Event<T>
 *
 * Usage:
 *   const disposable = event((data) => { ... });
 *   disposable.dispose(); // unsubscribe
 */
export type IEvent<T> = (listener: (e: T) => void) => IDisposable;

// ============================================================
// File System Types
// ============================================================

/**
 * File type enumeration.
 * Replaces: vscode.FileType
 */
export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

/**
 * File metadata.
 * Replaces: vscode.FileStat
 */
export interface FileStat {
  readonly type: FileType;
  readonly ctime: number;
  readonly mtime: number;
  readonly size: number;
}

/**
 * Directory entry.
 * Replaces: [string, vscode.FileType] tuple from readDirectory()
 */
export interface DirectoryEntry {
  readonly name: string;
  readonly type: FileType;
}

/**
 * File watcher for monitoring file system changes.
 * Replaces: vscode.FileSystemWatcher
 */
export interface IFileWatcher extends IDisposable {
  readonly onDidChange: IEvent<string>;
  readonly onDidCreate: IEvent<string>;
  readonly onDidDelete: IEvent<string>;
}

// ============================================================
// Progress
// ============================================================

/**
 * Progress reporter.
 * Replaces: vscode.Progress<{ message?: string; increment?: number }>
 */
export interface IProgress {
  report(value: { message?: string; increment?: number }): void;
}

/**
 * Progress options for withProgress().
 * Replaces: vscode.ProgressOptions
 */
export interface ProgressOptions {
  readonly title: string;
  readonly cancellable?: boolean;
  /**
   * Location hint: 'notification' | 'window' | 'statusbar'
   * Implementations map this to platform-specific locations.
   */
  readonly location?: 'notification' | 'window' | 'statusbar';
}

// ============================================================
// Quick Pick / Input Box
// ============================================================

/**
 * Quick pick item.
 * Replaces: vscode.QuickPickItem
 */
export interface QuickPickItem {
  readonly label: string;
  readonly description?: string;
  readonly detail?: string;
  readonly picked?: boolean;
  readonly alwaysShow?: boolean;
}

/**
 * Quick pick options.
 * Replaces: vscode.QuickPickOptions
 */
export interface QuickPickOptions {
  readonly title?: string;
  readonly placeHolder?: string;
  readonly canPickMany?: boolean;
  readonly ignoreFocusOut?: boolean;
}

/**
 * Input box options.
 * Replaces: vscode.InputBoxOptions
 */
export interface InputBoxOptions {
  readonly title?: string;
  readonly prompt?: string;
  readonly placeHolder?: string;
  readonly value?: string;
  readonly password?: boolean;
  readonly ignoreFocusOut?: boolean;
  readonly validateInput?: (value: string) => string | undefined | Promise<string | undefined>;
}

// ============================================================
// Platform Info
// ============================================================

/**
 * Runtime platform type.
 */
export enum PlatformType {
  VSCode = 'vscode',
  Electron = 'electron',
  CLI = 'cli',
  Web = 'web',
}

/**
 * Platform information.
 * Replaces: vscode.ExtensionContext (extensionPath, storagePath, etc.)
 */
export interface IPlatformInfo {
  readonly type: PlatformType;
  /** Root directory of the extension/application */
  readonly extensionPath: string;
  /** Directory for persistent storage (globalStoragePath equivalent) */
  readonly globalStoragePath: string;
  /** Directory for workspace-scoped storage */
  readonly workspaceStoragePath: string;
}

// ============================================================
// Configuration Change Event
// ============================================================

/**
 * Configuration change event data.
 * Replaces: vscode.ConfigurationChangeEvent
 */
export interface ConfigurationChangeEvent {
  readonly affectsConfiguration: (section: string) => boolean;
}

// ============================================================
// Secret Change Event
// ============================================================

/**
 * Secret change event data.
 * Replaces: vscode.SecretStorageChangeEvent
 */
export interface SecretChangeEvent {
  readonly key: string;
}
```

### 1.3 Platform Interfaces

#### File: `libs/backend/platform-core/src/interfaces/file-system-provider.interface.ts`

```typescript
/**
 * IFileSystemProvider — Platform-agnostic file system operations.
 *
 * Replaces: vscode.workspace.fs.*, vscode.workspace.findFiles(),
 *           vscode.workspace.createFileSystemWatcher()
 *
 * All paths are string-based (no vscode.Uri). The VS Code implementation
 * handles string-to-Uri conversion internally.
 */

import type { FileStat, DirectoryEntry, IFileWatcher } from '../types/platform.types';

export interface IFileSystemProvider {
  /**
   * Read file contents as UTF-8 string.
   * Replaces: vscode.workspace.fs.readFile() + TextDecoder
   */
  readFile(path: string): Promise<string>;

  /**
   * Read file contents as binary (Uint8Array).
   * Replaces: vscode.workspace.fs.readFile()
   */
  readFileBytes(path: string): Promise<Uint8Array>;

  /**
   * Write string content to a file (creates parent dirs if needed).
   * Replaces: vscode.workspace.fs.writeFile()
   */
  writeFile(path: string, content: string): Promise<void>;

  /**
   * Write binary content to a file.
   * Replaces: vscode.workspace.fs.writeFile()
   */
  writeFileBytes(path: string, content: Uint8Array): Promise<void>;

  /**
   * Read directory entries.
   * Replaces: vscode.workspace.fs.readDirectory()
   */
  readDirectory(path: string): Promise<DirectoryEntry[]>;

  /**
   * Get file or directory stats.
   * Replaces: vscode.workspace.fs.stat()
   */
  stat(path: string): Promise<FileStat>;

  /**
   * Check if a file or directory exists.
   * Replaces: try { await vscode.workspace.fs.stat(uri) } catch { false }
   */
  exists(path: string): Promise<boolean>;

  /**
   * Delete a file or directory.
   * Replaces: vscode.workspace.fs.delete()
   */
  delete(path: string, options?: { recursive?: boolean }): Promise<void>;

  /**
   * Create a directory (including parent directories).
   * Replaces: vscode.workspace.fs.createDirectory()
   */
  createDirectory(path: string): Promise<void>;

  /**
   * Copy a file or directory.
   * Replaces: vscode.workspace.fs.copy()
   */
  copy(source: string, destination: string, options?: { overwrite?: boolean }): Promise<void>;

  /**
   * Find files matching a glob pattern in the workspace.
   * Replaces: vscode.workspace.findFiles()
   *
   * @param pattern - Glob pattern (e.g., '** /*.ts')
   * @param exclude - Optional exclusion glob pattern
   * @param maxResults - Maximum number of results
   * @returns Array of absolute file paths
   */
  findFiles(pattern: string, exclude?: string, maxResults?: number): Promise<string[]>;

  /**
   * Create a file system watcher.
   * Replaces: vscode.workspace.createFileSystemWatcher()
   *
   * @param pattern - Glob pattern to watch
   * @returns File watcher with change/create/delete events
   */
  createFileWatcher(pattern: string): IFileWatcher;
}
```

#### File: `libs/backend/platform-core/src/interfaces/state-storage.interface.ts`

```typescript
/**
 * IStateStorage — Platform-agnostic key-value persistence.
 *
 * Replaces: vscode.Memento (ExtensionContext.globalState, workspaceState)
 *
 * Provides synchronous get (cached) and async update.
 */

export interface IStateStorage {
  /**
   * Get a value by key.
   * Replaces: vscode.Memento.get<T>(key, defaultValue)
   */
  get<T>(key: string, defaultValue?: T): T | undefined;

  /**
   * Update a value by key.
   * Replaces: vscode.Memento.update(key, value)
   */
  update(key: string, value: unknown): Promise<void>;

  /**
   * Get all stored keys.
   * Replaces: vscode.Memento.keys()
   */
  keys(): readonly string[];
}
```

#### File: `libs/backend/platform-core/src/interfaces/secret-storage.interface.ts`

```typescript
/**
 * ISecretStorage — Platform-agnostic secure credential storage.
 *
 * Replaces: vscode.ExtensionContext.secrets (SecretStorage)
 */

import type { IEvent, SecretChangeEvent } from '../types/platform.types';

export interface ISecretStorage {
  /**
   * Get a secret by key.
   * Replaces: vscode.SecretStorage.get(key)
   */
  get(key: string): Promise<string | undefined>;

  /**
   * Store a secret.
   * Replaces: vscode.SecretStorage.store(key, value)
   */
  store(key: string, value: string): Promise<void>;

  /**
   * Delete a secret.
   * Replaces: vscode.SecretStorage.delete(key)
   */
  delete(key: string): Promise<void>;

  /**
   * Event fired when a secret changes.
   * Replaces: vscode.SecretStorage.onDidChange
   */
  readonly onDidChange: IEvent<SecretChangeEvent>;
}
```

#### File: `libs/backend/platform-core/src/interfaces/workspace-provider.interface.ts`

```typescript
/**
 * IWorkspaceProvider — Platform-agnostic workspace folder and configuration access.
 *
 * Replaces: vscode.workspace.workspaceFolders, vscode.workspace.getConfiguration()
 */

import type { IEvent, ConfigurationChangeEvent } from '../types/platform.types';

export interface IWorkspaceProvider {
  /**
   * Get workspace folder paths.
   * Replaces: vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath)
   *
   * @returns Array of absolute workspace folder paths, empty if no workspace open
   */
  getWorkspaceFolders(): string[];

  /**
   * Get the primary workspace root path.
   * Replaces: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
   *
   * @returns Absolute path or undefined if no workspace open
   */
  getWorkspaceRoot(): string | undefined;

  /**
   * Get a configuration value.
   * Replaces: vscode.workspace.getConfiguration(section).get<T>(key, defaultValue)
   *
   * @param section - Configuration section (e.g., 'ptah')
   * @param key - Configuration key within the section (e.g., 'authMethod')
   * @param defaultValue - Default if not set
   */
  getConfiguration<T>(section: string, key: string, defaultValue?: T): T | undefined;

  /**
   * Event fired when configuration changes.
   * Replaces: vscode.workspace.onDidChangeConfiguration
   */
  readonly onDidChangeConfiguration: IEvent<ConfigurationChangeEvent>;

  /**
   * Event fired when workspace folders change.
   * Replaces: vscode.workspace.onDidChangeWorkspaceFolders
   */
  readonly onDidChangeWorkspaceFolders: IEvent<void>;
}
```

#### File: `libs/backend/platform-core/src/interfaces/user-interaction.interface.ts`

```typescript
/**
 * IUserInteraction — Platform-agnostic user notification and input.
 *
 * Replaces: vscode.window.showErrorMessage, showWarningMessage,
 *           showInformationMessage, showQuickPick, showInputBox, withProgress
 */

import type { QuickPickItem, QuickPickOptions, InputBoxOptions, ProgressOptions, IProgress } from '../types/platform.types';

export interface IUserInteraction {
  /**
   * Show an error message with optional action buttons.
   * Replaces: vscode.window.showErrorMessage()
   *
   * @returns The selected action label, or undefined if dismissed
   */
  showErrorMessage(message: string, ...actions: string[]): Promise<string | undefined>;

  /**
   * Show a warning message with optional action buttons.
   * Replaces: vscode.window.showWarningMessage()
   */
  showWarningMessage(message: string, ...actions: string[]): Promise<string | undefined>;

  /**
   * Show an information message with optional action buttons.
   * Replaces: vscode.window.showInformationMessage()
   */
  showInformationMessage(message: string, ...actions: string[]): Promise<string | undefined>;

  /**
   * Show a quick pick selection dialog.
   * Replaces: vscode.window.showQuickPick()
   */
  showQuickPick(items: QuickPickItem[], options?: QuickPickOptions): Promise<QuickPickItem | undefined>;

  /**
   * Show an input box for text input.
   * Replaces: vscode.window.showInputBox()
   */
  showInputBox(options?: InputBoxOptions): Promise<string | undefined>;

  /**
   * Show progress with a long-running task.
   * Replaces: vscode.window.withProgress()
   */
  withProgress<T>(options: ProgressOptions, task: (progress: IProgress) => Promise<T>): Promise<T>;
}
```

#### File: `libs/backend/platform-core/src/interfaces/output-channel.interface.ts`

```typescript
/**
 * IOutputChannel — Platform-agnostic logging output channel.
 *
 * Replaces: vscode.OutputChannel
 */

import type { IDisposable } from '../types/platform.types';

export interface IOutputChannel extends IDisposable {
  readonly name: string;
  appendLine(message: string): void;
  append(message: string): void;
  clear(): void;
  show(): void;
}
```

#### File: `libs/backend/platform-core/src/interfaces/command-registry.interface.ts`

```typescript
/**
 * ICommandRegistry — Platform-agnostic command registration and execution.
 *
 * Replaces: vscode.commands.registerCommand, vscode.commands.executeCommand
 */

import type { IDisposable } from '../types/platform.types';

export interface ICommandRegistry {
  /**
   * Register a command handler.
   * Replaces: vscode.commands.registerCommand()
   */
  registerCommand(id: string, handler: (...args: unknown[]) => unknown): IDisposable;

  /**
   * Execute a command by ID.
   * Replaces: vscode.commands.executeCommand()
   */
  executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
}
```

#### File: `libs/backend/platform-core/src/interfaces/editor-provider.interface.ts`

```typescript
/**
 * IEditorProvider — Platform-agnostic active editor and document events.
 *
 * Replaces: vscode.window.onDidChangeActiveTextEditor,
 *           vscode.workspace.onDidOpenTextDocument
 */

import type { IEvent } from '../types/platform.types';

export interface IEditorProvider {
  /**
   * Event fired when the active text editor changes.
   * Replaces: vscode.window.onDidChangeActiveTextEditor
   *
   * Provides the file path of the new active editor, or undefined if none.
   */
  readonly onDidChangeActiveEditor: IEvent<{ filePath: string | undefined }>;

  /**
   * Event fired when a text document is opened.
   * Replaces: vscode.workspace.onDidOpenTextDocument
   */
  readonly onDidOpenDocument: IEvent<{ filePath: string }>;

  /**
   * Get the currently active editor's file path.
   * Replaces: vscode.window.activeTextEditor?.document.uri.fsPath
   */
  getActiveEditorPath(): string | undefined;
}
```

### 1.4 DI Tokens

#### File: `libs/backend/platform-core/src/tokens.ts`

```typescript
/**
 * Platform DI Tokens
 *
 * DI tokens for platform abstraction interfaces.
 * Follows the Symbol.for() convention from vscode-core/src/di/tokens.ts
 *
 * Convention: All tokens use Symbol.for('PlatformXxx') to ensure
 * global uniqueness and cross-module resolution.
 */

export const PLATFORM_TOKENS = {
  /** IFileSystemProvider — file read/write/watch/search */
  FILE_SYSTEM_PROVIDER: Symbol.for('PlatformFileSystemProvider'),

  /** IStateStorage — global state (replaces TOKENS.GLOBAL_STATE / vscode.Memento) */
  STATE_STORAGE: Symbol.for('PlatformStateStorage'),

  /** IStateStorage — workspace-scoped state (replaces context.workspaceState) */
  WORKSPACE_STATE_STORAGE: Symbol.for('PlatformWorkspaceStateStorage'),

  /** ISecretStorage — secure credential storage */
  SECRET_STORAGE: Symbol.for('PlatformSecretStorage'),

  /** IWorkspaceProvider — workspace folders and configuration */
  WORKSPACE_PROVIDER: Symbol.for('PlatformWorkspaceProvider'),

  /** IUserInteraction — error/warning/info messages, quick pick, input box */
  USER_INTERACTION: Symbol.for('PlatformUserInteraction'),

  /** IOutputChannel — logging output channel */
  OUTPUT_CHANNEL: Symbol.for('PlatformOutputChannel'),

  /** ICommandRegistry — command registration and execution */
  COMMAND_REGISTRY: Symbol.for('PlatformCommandRegistry'),

  /** IEditorProvider — active editor and document events */
  EDITOR_PROVIDER: Symbol.for('PlatformEditorProvider'),

  /** IPlatformInfo — platform type, extension path, storage paths */
  PLATFORM_INFO: Symbol.for('PlatformInfo'),
} as const;
```

### 1.5 Event Emitter Utility

#### File: `libs/backend/platform-core/src/utils/event-emitter.ts`

```typescript
/**
 * Simple event emitter utility for implementing IEvent<T>.
 *
 * Platform implementations use this to create events that match IEvent<T>.
 * NOT a public API — internal utility for platform implementations.
 */

import type { IEvent, IDisposable } from '../types/platform.types';

/**
 * Creates an IEvent<T> + fire function pair.
 *
 * Usage in platform implementations:
 *   const [onDidChange, fireChange] = createEvent<string>();
 *   // Expose onDidChange as the IEvent
 *   // Call fireChange(data) when the event occurs
 */
export function createEvent<T>(): [IEvent<T>, (data: T) => void] {
  const listeners = new Set<(e: T) => void>();

  const event: IEvent<T> = (listener: (e: T) => void): IDisposable => {
    listeners.add(listener);
    return {
      dispose() {
        listeners.delete(listener);
      },
    };
  };

  const fire = (data: T): void => {
    for (const listener of listeners) {
      try {
        listener(data);
      } catch {
        // Swallow listener errors to prevent one listener from breaking others
      }
    }
  };

  return [event, fire];
}
```

### 1.6 Barrel Export

#### File: `libs/backend/platform-core/src/index.ts`

```typescript
// Types
export type { IDisposable, IEvent, FileStat, DirectoryEntry, IFileWatcher, IProgress, ProgressOptions, QuickPickItem, QuickPickOptions, InputBoxOptions, IPlatformInfo, ConfigurationChangeEvent, SecretChangeEvent } from './types/platform.types';

export { FileType, PlatformType } from './types/platform.types';

// Interfaces
export type { IFileSystemProvider } from './interfaces/file-system-provider.interface';
export type { IStateStorage } from './interfaces/state-storage.interface';
export type { ISecretStorage } from './interfaces/secret-storage.interface';
export type { IWorkspaceProvider } from './interfaces/workspace-provider.interface';
export type { IUserInteraction } from './interfaces/user-interaction.interface';
export type { IOutputChannel } from './interfaces/output-channel.interface';
export type { ICommandRegistry } from './interfaces/command-registry.interface';
export type { IEditorProvider } from './interfaces/editor-provider.interface';

// DI Tokens
export { PLATFORM_TOKENS } from './tokens';

// Utilities
export { createEvent } from './utils/event-emitter';
```

---

## Phase 2: Foundation — platform-vscode Library

### 2.1 Library Scaffolding

**Create**: `libs/backend/platform-vscode/`

#### File: `libs/backend/platform-vscode/project.json`

```json
{
  "name": "@ptah-extension/platform-vscode",
  "$schema": "../../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "libs/backend/platform-vscode/src",
  "projectType": "library",
  "tags": ["scope:extension", "type:feature"],
  "targets": {
    "build": {
      "executor": "@nx/esbuild:esbuild",
      "outputs": ["{options.outputPath}"],
      "options": {
        "outputPath": "dist/libs/backend/platform-vscode",
        "main": "libs/backend/platform-vscode/src/index.ts",
        "tsConfig": "libs/backend/platform-vscode/tsconfig.lib.json",
        "assets": ["libs/backend/platform-vscode/*.md"],
        "format": ["cjs"],
        "external": ["vscode", "tsyringe", "reflect-metadata"]
      }
    },
    "test": {
      "executor": "@nx/jest:jest",
      "outputs": ["{workspaceRoot}/coverage/{projectRoot}"],
      "options": {
        "jestConfig": "libs/backend/platform-vscode/jest.config.ts"
      }
    },
    "typecheck": {
      "executor": "nx:run-commands",
      "options": {
        "command": "tsc --noEmit --project libs/backend/platform-vscode/tsconfig.lib.json"
      }
    },
    "lint": {
      "executor": "@nx/eslint:lint"
    }
  }
}
```

#### Add to `tsconfig.base.json` paths:

```json
"@ptah-extension/platform-vscode": ["libs/backend/platform-vscode/src/index.ts"]
```

Tsconfig files follow the same pattern as platform-core (omitted for brevity).

### 2.2 VS Code Implementations

#### File: `libs/backend/platform-vscode/src/implementations/vscode-file-system-provider.ts`

```typescript
/**
 * VscodeFileSystemProvider — IFileSystemProvider implementation using VS Code APIs.
 *
 * Handles all string-to-Uri conversion internally.
 * Supports file://, vscode-vfs://, and untitled:// schemes.
 */

import * as vscode from 'vscode';
import type { IFileSystemProvider, FileStat, DirectoryEntry, IFileWatcher, IDisposable, IEvent } from '@ptah-extension/platform-core';
import { FileType, createEvent } from '@ptah-extension/platform-core';

export class VscodeFileSystemProvider implements IFileSystemProvider {
  /**
   * Convert string path to vscode.Uri.
   * If the path looks like a URI scheme (contains ://), parse it.
   * Otherwise treat it as a file path.
   */
  private toUri(path: string): vscode.Uri {
    if (path.includes('://')) {
      return vscode.Uri.parse(path);
    }
    return vscode.Uri.file(path);
  }

  /**
   * Convert vscode.FileType to platform FileType
   */
  private convertFileType(vsType: vscode.FileType): FileType {
    switch (vsType) {
      case vscode.FileType.File:
        return FileType.File;
      case vscode.FileType.Directory:
        return FileType.Directory;
      case vscode.FileType.SymbolicLink:
        return FileType.SymbolicLink;
      default:
        return FileType.Unknown;
    }
  }

  async readFile(path: string): Promise<string> {
    const bytes = await vscode.workspace.fs.readFile(this.toUri(path));
    return new TextDecoder('utf-8').decode(bytes);
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
    return vscode.workspace.fs.readFile(this.toUri(path));
  }

  async writeFile(path: string, content: string): Promise<void> {
    const bytes = new TextEncoder().encode(content);
    await vscode.workspace.fs.writeFile(this.toUri(path), bytes);
  }

  async writeFileBytes(path: string, content: Uint8Array): Promise<void> {
    await vscode.workspace.fs.writeFile(this.toUri(path), content);
  }

  async readDirectory(path: string): Promise<DirectoryEntry[]> {
    const entries = await vscode.workspace.fs.readDirectory(this.toUri(path));
    return entries.map(([name, type]) => ({
      name,
      type: this.convertFileType(type),
    }));
  }

  async stat(path: string): Promise<FileStat> {
    const vsStat = await vscode.workspace.fs.stat(this.toUri(path));
    return {
      type: this.convertFileType(vsStat.type),
      ctime: vsStat.ctime,
      mtime: vsStat.mtime,
      size: vsStat.size,
    };
  }

  async exists(path: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(this.toUri(path));
      return true;
    } catch {
      return false;
    }
  }

  async delete(path: string, options?: { recursive?: boolean }): Promise<void> {
    await vscode.workspace.fs.delete(this.toUri(path), {
      recursive: options?.recursive ?? false,
    });
  }

  async createDirectory(path: string): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.toUri(path));
  }

  async copy(source: string, destination: string, options?: { overwrite?: boolean }): Promise<void> {
    await vscode.workspace.fs.copy(this.toUri(source), this.toUri(destination), {
      overwrite: options?.overwrite ?? false,
    });
  }

  async findFiles(pattern: string, exclude?: string, maxResults?: number): Promise<string[]> {
    const uris = await vscode.workspace.findFiles(pattern, exclude ?? undefined, maxResults);
    return uris.map((uri) => uri.fsPath);
  }

  createFileWatcher(pattern: string): IFileWatcher {
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);

    const [onDidChange, fireChange] = createEvent<string>();
    const [onDidCreate, fireCreate] = createEvent<string>();
    const [onDidDelete, fireDelete] = createEvent<string>();

    const disposables: vscode.Disposable[] = [watcher.onDidChange((uri) => fireChange(uri.fsPath)), watcher.onDidCreate((uri) => fireCreate(uri.fsPath)), watcher.onDidDelete((uri) => fireDelete(uri.fsPath))];

    return {
      onDidChange,
      onDidCreate,
      onDidDelete,
      dispose() {
        disposables.forEach((d) => d.dispose());
        watcher.dispose();
      },
    };
  }
}
```

#### File: `libs/backend/platform-vscode/src/implementations/vscode-state-storage.ts`

```typescript
/**
 * VscodeStateStorage — IStateStorage implementation wrapping vscode.Memento.
 *
 * Used for both globalState and workspaceState.
 */

import type * as vscode from 'vscode';
import type { IStateStorage } from '@ptah-extension/platform-core';

export class VscodeStateStorage implements IStateStorage {
  constructor(private readonly memento: vscode.Memento) {}

  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.memento.get<T>(key, defaultValue as T);
  }

  async update(key: string, value: unknown): Promise<void> {
    await this.memento.update(key, value);
  }

  keys(): readonly string[] {
    return this.memento.keys();
  }
}
```

#### File: `libs/backend/platform-vscode/src/implementations/vscode-secret-storage.ts`

```typescript
/**
 * VscodeSecretStorage — ISecretStorage implementation wrapping vscode.SecretStorage.
 */

import type * as vscode from 'vscode';
import type { ISecretStorage } from '@ptah-extension/platform-core';
import type { IEvent, SecretChangeEvent } from '@ptah-extension/platform-core';
import { createEvent } from '@ptah-extension/platform-core';

export class VscodeSecretStorage implements ISecretStorage {
  public readonly onDidChange: IEvent<SecretChangeEvent>;
  private readonly fireChange: (data: SecretChangeEvent) => void;
  private disposable: vscode.Disposable;

  constructor(secrets: vscode.SecretStorage) {
    const [event, fire] = createEvent<SecretChangeEvent>();
    this.onDidChange = event;
    this.fireChange = fire;

    this.disposable = secrets.onDidChange((e) => {
      this.fireChange({ key: e.key });
    });

    this._secrets = secrets;
  }

  private readonly _secrets: vscode.SecretStorage;

  async get(key: string): Promise<string | undefined> {
    return this._secrets.get(key);
  }

  async store(key: string, value: string): Promise<void> {
    await this._secrets.store(key, value);
  }

  async delete(key: string): Promise<void> {
    await this._secrets.delete(key);
  }

  dispose(): void {
    this.disposable.dispose();
  }
}
```

#### File: `libs/backend/platform-vscode/src/implementations/vscode-workspace-provider.ts`

```typescript
/**
 * VscodeWorkspaceProvider — IWorkspaceProvider implementation using VS Code APIs.
 */

import * as vscode from 'vscode';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { IEvent, ConfigurationChangeEvent } from '@ptah-extension/platform-core';
import { createEvent } from '@ptah-extension/platform-core';

export class VscodeWorkspaceProvider implements IWorkspaceProvider {
  public readonly onDidChangeConfiguration: IEvent<ConfigurationChangeEvent>;
  public readonly onDidChangeWorkspaceFolders: IEvent<void>;

  private disposables: vscode.Disposable[] = [];

  constructor() {
    const [configEvent, fireConfig] = createEvent<ConfigurationChangeEvent>();
    this.onDidChangeConfiguration = configEvent;

    const [folderEvent, fireFolders] = createEvent<void>();
    this.onDidChangeWorkspaceFolders = folderEvent;

    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        fireConfig({
          affectsConfiguration: (section: string) => e.affectsConfiguration(section),
        });
      })
    );

    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        fireFolders(undefined as never);
      })
    );
  }

  getWorkspaceFolders(): string[] {
    return vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? [];
  }

  getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  getConfiguration<T>(section: string, key: string, defaultValue?: T): T | undefined {
    const config = vscode.workspace.getConfiguration(section);
    return config.get<T>(key, defaultValue as T);
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
```

#### File: `libs/backend/platform-vscode/src/implementations/vscode-user-interaction.ts`

```typescript
/**
 * VscodeUserInteraction — IUserInteraction implementation using VS Code window APIs.
 */

import * as vscode from 'vscode';
import type { IUserInteraction } from '@ptah-extension/platform-core';
import type { QuickPickItem, QuickPickOptions, InputBoxOptions, ProgressOptions, IProgress } from '@ptah-extension/platform-core';

export class VscodeUserInteraction implements IUserInteraction {
  async showErrorMessage(message: string, ...actions: string[]): Promise<string | undefined> {
    return vscode.window.showErrorMessage(message, ...actions);
  }

  async showWarningMessage(message: string, ...actions: string[]): Promise<string | undefined> {
    return vscode.window.showWarningMessage(message, ...actions);
  }

  async showInformationMessage(message: string, ...actions: string[]): Promise<string | undefined> {
    return vscode.window.showInformationMessage(message, ...actions);
  }

  async showQuickPick(items: QuickPickItem[], options?: QuickPickOptions): Promise<QuickPickItem | undefined> {
    const vsItems: vscode.QuickPickItem[] = items.map((item) => ({
      label: item.label,
      description: item.description,
      detail: item.detail,
      picked: item.picked,
      alwaysShow: item.alwaysShow,
    }));

    const vsOptions: vscode.QuickPickOptions = {
      title: options?.title,
      placeHolder: options?.placeHolder,
      canPickMany: options?.canPickMany,
      ignoreFocusOut: options?.ignoreFocusOut,
    };

    const result = await vscode.window.showQuickPick(vsItems, vsOptions);
    if (!result) return undefined;

    return {
      label: result.label,
      description: result.description,
      detail: result.detail,
    };
  }

  async showInputBox(options?: InputBoxOptions): Promise<string | undefined> {
    return vscode.window.showInputBox({
      title: options?.title,
      prompt: options?.prompt,
      placeHolder: options?.placeHolder,
      value: options?.value,
      password: options?.password,
      ignoreFocusOut: options?.ignoreFocusOut,
      validateInput: options?.validateInput,
    });
  }

  async withProgress<T>(options: ProgressOptions, task: (progress: IProgress) => Promise<T>): Promise<T> {
    const locationMap: Record<string, vscode.ProgressLocation> = {
      notification: vscode.ProgressLocation.Notification,
      window: vscode.ProgressLocation.Window,
      statusbar: vscode.ProgressLocation.Window,
    };

    return vscode.window.withProgress(
      {
        location: locationMap[options.location ?? 'notification'] ?? vscode.ProgressLocation.Notification,
        title: options.title,
        cancellable: options.cancellable,
      },
      async (vsProgress) => {
        return task({
          report(value) {
            vsProgress.report(value);
          },
        });
      }
    );
  }
}
```

#### File: `libs/backend/platform-vscode/src/implementations/vscode-output-channel.ts`

```typescript
/**
 * VscodeOutputChannel — IOutputChannel implementation wrapping vscode.OutputChannel.
 */

import * as vscode from 'vscode';
import type { IOutputChannel } from '@ptah-extension/platform-core';

export class VscodeOutputChannel implements IOutputChannel {
  private readonly channel: vscode.OutputChannel;

  constructor(name: string) {
    this.channel = vscode.window.createOutputChannel(name);
  }

  get name(): string {
    return this.channel.name;
  }

  appendLine(message: string): void {
    this.channel.appendLine(message);
  }

  append(message: string): void {
    this.channel.append(message);
  }

  clear(): void {
    this.channel.clear();
  }

  show(): void {
    this.channel.show();
  }

  dispose(): void {
    this.channel.dispose();
  }
}
```

#### File: `libs/backend/platform-vscode/src/implementations/vscode-command-registry.ts`

```typescript
/**
 * VscodeCommandRegistry — ICommandRegistry implementation using VS Code commands API.
 */

import * as vscode from 'vscode';
import type { ICommandRegistry } from '@ptah-extension/platform-core';
import type { IDisposable } from '@ptah-extension/platform-core';

export class VscodeCommandRegistry implements ICommandRegistry {
  registerCommand(id: string, handler: (...args: unknown[]) => unknown): IDisposable {
    const disposable = vscode.commands.registerCommand(id, handler);
    return { dispose: () => disposable.dispose() };
  }

  async executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T> {
    return vscode.commands.executeCommand<T>(id, ...args);
  }
}
```

#### File: `libs/backend/platform-vscode/src/implementations/vscode-editor-provider.ts`

```typescript
/**
 * VscodeEditorProvider — IEditorProvider implementation using VS Code window/workspace events.
 */

import * as vscode from 'vscode';
import type { IEditorProvider } from '@ptah-extension/platform-core';
import type { IEvent } from '@ptah-extension/platform-core';
import { createEvent } from '@ptah-extension/platform-core';

export class VscodeEditorProvider implements IEditorProvider {
  public readonly onDidChangeActiveEditor: IEvent<{
    filePath: string | undefined;
  }>;
  public readonly onDidOpenDocument: IEvent<{ filePath: string }>;

  private disposables: vscode.Disposable[] = [];

  constructor() {
    const [editorEvent, fireEditor] = createEvent<{
      filePath: string | undefined;
    }>();
    this.onDidChangeActiveEditor = editorEvent;

    const [docEvent, fireDoc] = createEvent<{ filePath: string }>();
    this.onDidOpenDocument = docEvent;

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        fireEditor({
          filePath: editor?.document.uri.fsPath,
        });
      })
    );

    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((doc) => {
        fireDoc({ filePath: doc.uri.fsPath });
      })
    );
  }

  getActiveEditorPath(): string | undefined {
    return vscode.window.activeTextEditor?.document.uri.fsPath;
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
```

### 2.3 Registration Helper

#### File: `libs/backend/platform-vscode/src/registration.ts`

```typescript
/**
 * Platform-VSCode Registration Helper
 *
 * Registers all VS Code platform implementations against PLATFORM_TOKENS.
 * Called from apps/ptah-extension-vscode/src/di/container.ts BEFORE
 * any library registration functions.
 */

import type * as vscode from 'vscode';
import type { DependencyContainer } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';

import { VscodeFileSystemProvider } from './implementations/vscode-file-system-provider';
import { VscodeStateStorage } from './implementations/vscode-state-storage';
import { VscodeSecretStorage } from './implementations/vscode-secret-storage';
import { VscodeWorkspaceProvider } from './implementations/vscode-workspace-provider';
import { VscodeUserInteraction } from './implementations/vscode-user-interaction';
import { VscodeOutputChannel } from './implementations/vscode-output-channel';
import { VscodeCommandRegistry } from './implementations/vscode-command-registry';
import { VscodeEditorProvider } from './implementations/vscode-editor-provider';

import type { IPlatformInfo } from '@ptah-extension/platform-core';
import { PlatformType } from '@ptah-extension/platform-core';

/**
 * Register all platform implementations in the DI container.
 *
 * MUST be called before any library registerXxxServices() functions,
 * because those libraries inject PLATFORM_TOKENS.
 *
 * @param container - tsyringe DI container
 * @param context - VS Code ExtensionContext
 */
export function registerPlatformVscodeServices(container: DependencyContainer, context: vscode.ExtensionContext): void {
  // Platform Info
  const platformInfo: IPlatformInfo = {
    type: PlatformType.VSCode,
    extensionPath: context.extensionPath,
    globalStoragePath: context.globalStorageUri.fsPath,
    workspaceStoragePath: context.storageUri?.fsPath ?? context.globalStorageUri.fsPath,
  };
  container.register(PLATFORM_TOKENS.PLATFORM_INFO, { useValue: platformInfo });

  // File System
  container.register(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER, {
    useValue: new VscodeFileSystemProvider(),
  });

  // State Storage (global = globalState, workspace = workspaceState)
  container.register(PLATFORM_TOKENS.STATE_STORAGE, {
    useValue: new VscodeStateStorage(context.globalState),
  });
  container.register(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE, {
    useValue: new VscodeStateStorage(context.workspaceState),
  });

  // Secret Storage
  container.register(PLATFORM_TOKENS.SECRET_STORAGE, {
    useValue: new VscodeSecretStorage(context.secrets),
  });

  // Workspace Provider
  container.register(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {
    useValue: new VscodeWorkspaceProvider(),
  });

  // User Interaction
  container.register(PLATFORM_TOKENS.USER_INTERACTION, {
    useValue: new VscodeUserInteraction(),
  });

  // Output Channel (default channel name)
  container.register(PLATFORM_TOKENS.OUTPUT_CHANNEL, {
    useValue: new VscodeOutputChannel('Ptah Extension'),
  });

  // Command Registry
  container.register(PLATFORM_TOKENS.COMMAND_REGISTRY, {
    useValue: new VscodeCommandRegistry(),
  });

  // Editor Provider
  container.register(PLATFORM_TOKENS.EDITOR_PROVIDER, {
    useValue: new VscodeEditorProvider(),
  });
}
```

### 2.4 Barrel Export

#### File: `libs/backend/platform-vscode/src/index.ts`

```typescript
// Registration function (primary export)
export { registerPlatformVscodeServices } from './registration';

// Implementation classes (for testing/extension only)
export { VscodeFileSystemProvider } from './implementations/vscode-file-system-provider';
export { VscodeStateStorage } from './implementations/vscode-state-storage';
export { VscodeSecretStorage } from './implementations/vscode-secret-storage';
export { VscodeWorkspaceProvider } from './implementations/vscode-workspace-provider';
export { VscodeUserInteraction } from './implementations/vscode-user-interaction';
export { VscodeOutputChannel } from './implementations/vscode-output-channel';
export { VscodeCommandRegistry } from './implementations/vscode-command-registry';
export { VscodeEditorProvider } from './implementations/vscode-editor-provider';
```

### 2.5 Container Integration

#### Modify: `apps/ptah-extension-vscode/src/di/container.ts`

Add platform registration as **PHASE 0.5** — after EXTENSION_CONTEXT but before all other services:

```typescript
// NEW IMPORT
import { registerPlatformVscodeServices } from '@ptah-extension/platform-vscode';

// In setup() method, after PHASE 0 (EXTENSION_CONTEXT):

// ========================================
// PHASE 0.5: Platform Abstraction Layer (TASK_2025_199)
// ========================================
// MUST be before any library services (they inject PLATFORM_TOKENS)
registerPlatformVscodeServices(container, context);
```

Also add to `setupMinimal()`:

```typescript
// Platform services needed for minimal setup
registerPlatformVscodeServices(container, context);
```

---

## Phase 3: Low-Risk Refactoring — template-generation (2 files)

### 3.1 File: `libs/backend/template-generation/src/lib/adapters/file-system.adapter.ts`

**Current**: Uses `vscode.Uri.file()`, `vscode.workspace.fs.*`, `vscode.FileType`
**Change**: Inject `IFileSystemProvider` via `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER`, remove `vscode` import and `FileSystemService` dependency

**Before (key parts)**:

```typescript
import * as vscode from 'vscode';
import { FileSystemService } from '@ptah-extension/workspace-intelligence';

// In methods:
const uri = vscode.Uri.file(filePath);
const content = await this.fileSystemService.readFile(uri);
await vscode.workspace.fs.writeFile(uri, bytes);
if (type === vscode.FileType.Directory) { ... }
```

**After (key parts)**:

```typescript
import type { IFileSystemProvider } from '@ptah-extension/platform-core';
import { PLATFORM_TOKENS, FileType } from '@ptah-extension/platform-core';

@injectable()
export class FileSystemAdapter {
  constructor(
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fs: IFileSystemProvider
  ) {}

  async readFile(filePath: string): Promise<Result<string, Error>> {
    try {
      const content = await this.fs.readFile(filePath);
      return Result.ok(content);
    } catch (error) {
      return Result.err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async writeFile(filePath: string, content: string): Promise<Result<void, Error>> {
    try {
      await this.fs.writeFile(filePath, content);
      return Result.ok(undefined);
    } catch (error) {
      return Result.err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async createDirectory(dirPath: string): Promise<Result<void, Error>> {
    try {
      await this.fs.createDirectory(dirPath);
      return Result.ok(undefined);
    } catch (error) {
      return Result.err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async copyDirectoryRecursive(sourceDir: string, destDir: string): Promise<Result<void, Error>> {
    try {
      const entries = await this.fs.readDirectory(sourceDir);
      await this.fs.createDirectory(destDir);

      for (const entry of entries) {
        const srcPath = path.join(sourceDir, entry.name);
        const dstPath = path.join(destDir, entry.name);

        if (entry.type === FileType.Directory) {
          const result = await this.copyDirectoryRecursive(srcPath, dstPath);
          if (result.isErr()) return result;
        } else {
          await this.fs.copy(srcPath, dstPath, { overwrite: true });
        }
      }
      return Result.ok(undefined);
    } catch (error) {
      return Result.err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async exists(filePath: string): Promise<Result<boolean, Error>> {
    try {
      const exists = await this.fs.exists(filePath);
      return Result.ok(exists);
    } catch (error) {
      return Result.err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
```

**DI registration change** in `libs/backend/template-generation/src/lib/di/register.ts`:

- Remove dependency on `TOKENS.FILE_SYSTEM_SERVICE` for the FileSystemAdapter
- The adapter now injects `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER` directly via `@inject()` decorator

### 3.2 File: `libs/backend/template-generation/src/lib/services/template-generator.service.ts`

**Current**: Uses `vscode.workspace.workspaceFolders`
**Change**: Inject `IWorkspaceProvider` via `PLATFORM_TOKENS.WORKSPACE_PROVIDER`

Replace:

```typescript
import * as vscode from 'vscode';
// ...
const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
```

With:

```typescript
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
// ...
constructor(
  @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER) private readonly workspace: IWorkspaceProvider,
  // ... other deps
) {}
// ...
const workspaceRoot = this.workspace.getWorkspaceRoot();
```

---

## Phase 4: Low-Risk Refactoring — agent-sdk (6 files)

### 4.1 File: `libs/backend/agent-sdk/src/lib/session-metadata-store.ts`

**Current** (line 107): `@inject(TOKENS.GLOBAL_STATE) private storage: vscode.Memento`
**Change**: Replace `vscode.Memento` with `IStateStorage`

```typescript
// BEFORE
import * as vscode from 'vscode';
constructor(
  @inject(TOKENS.GLOBAL_STATE) private storage: vscode.Memento,
  @inject(TOKENS.LOGGER) private logger: Logger
) {}

// AFTER
import type { IStateStorage } from '@ptah-extension/platform-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
constructor(
  @inject(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE) private storage: IStateStorage,
  @inject(TOKENS.LOGGER) private logger: Logger
) {}
```

**Note**: The `IStateStorage` interface matches the subset of `vscode.Memento` already used (`.get<T>()`, `.update()`, `.keys()`). The registration in `di/register.ts` must change from `context.workspaceState` to resolving `PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE`.

### 4.2 File: `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`

**Current** (line 21): `import * as vscode from 'vscode'`
**Usage**: Only uses `vscode.ExtensionContext` for `extensionPath` and `storagePath`

**Change**: Replace with `IPlatformInfo`

```typescript
// BEFORE
@inject(TOKENS.EXTENSION_CONTEXT) private context: vscode.ExtensionContext
// Used as: this.context.extensionPath, this.context.globalStorageUri.fsPath

// AFTER
@inject(PLATFORM_TOKENS.PLATFORM_INFO) private platformInfo: IPlatformInfo
// Used as: this.platformInfo.extensionPath, this.platformInfo.globalStoragePath
```

### 4.3 File: `libs/backend/agent-sdk/src/lib/helpers/config-watcher.ts`

**Current**: Uses `vscode.ExtensionContext.secrets.onDidChange`, `vscode.Disposable`
**Change**: Replace with `ISecretStorage` and `IDisposable`

```typescript
// BEFORE
import * as vscode from 'vscode';
private watchers: vscode.Disposable[] = [];
private secretsDisposable?: vscode.Disposable;
@inject(TOKENS.EXTENSION_CONTEXT) private context: vscode.ExtensionContext

this.secretsDisposable = this.context.secrets.onDidChange((event) => { ... });

// AFTER
import type { ISecretStorage, IDisposable } from '@ptah-extension/platform-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';

private watchers: IDisposable[] = [];
private secretsDisposable?: IDisposable;
@inject(PLATFORM_TOKENS.SECRET_STORAGE) private secretStorage: ISecretStorage

this.secretsDisposable = this.secretStorage.onDidChange((event) => { ... });
```

**Note**: ConfigManager's `watch()` already returns an object with `dispose()`, which satisfies `IDisposable`.

### 4.4 File: `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts`

**Current**: Uses `type * as vscode from 'vscode'` for `vscode.Memento` type annotation
**Change**: Replace with `IStateStorage`

```typescript
// BEFORE
import type * as vscode from 'vscode';
private workspaceState: vscode.Memento | null = null;

// AFTER
import type { IStateStorage } from '@ptah-extension/platform-core';
private workspaceState: IStateStorage | null = null;
```

### 4.5 File: `libs/backend/agent-sdk/src/lib/di/register.ts`

**Current**: Imports `vscode`, receives `context: vscode.ExtensionContext`, uses `context.workspaceState`
**Change**: Remove vscode import. Use platform tokens for SessionMetadataStore construction.

```typescript
// BEFORE
import * as vscode from 'vscode';
export function registerSdkServices(container: DependencyContainer, context: vscode.ExtensionContext, logger: Logger): void {
  container.registerInstance(SDK_TOKENS.SDK_SESSION_METADATA_STORE, new SessionMetadataStore(context.workspaceState, logger));
  // ...
}

// AFTER
export function registerSdkServices(container: DependencyContainer, logger: Logger): void {
  // SessionMetadataStore now uses @inject() decorators for IStateStorage
  // Register as singleton (auto-wired via @inject(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE))
  container.register(SDK_TOKENS.SDK_SESSION_METADATA_STORE, { useClass: SessionMetadataStore }, { lifecycle: Lifecycle.Singleton });
  // ...
}
```

**Container.ts change**: Update the call site:

```typescript
// BEFORE
registerSdkServices(container, context, logger);
// AFTER
registerSdkServices(container, logger);
```

### 4.6 File: `libs/backend/agent-sdk/src/lib/copilot-provider/copilot-auth.service.ts`

**Current**: Uses `vscode.extensions.getExtension()` and `vscode.authentication.getSession()`
**Decision**: This file uses VS Code-specific APIs (`vscode.authentication`, `vscode.extensions`) that have NO platform-agnostic equivalent. These are inherently VS Code features.

**Strategy**: Keep the vscode import BUT isolate it. Create an `IExtensionDiscovery` interface in platform-core is NOT worth the complexity since this is a VS Code-specific provider (Copilot only works in VS Code). Instead, mark this as an allowed exception.

**Change**: Move the vscode dependency to a lazy import or conditional require, and add a comment explaining the exception:

```typescript
// This service is inherently VS Code-specific (GitHub Copilot authentication
// only works within VS Code). The vscode import is intentionally retained.
// TASK_2025_199: Approved exception — Copilot is VS Code-only.
```

No code change required. This file is explicitly VS Code-specific per the task requirements.

---

## Phase 5: High-Impact Refactoring — workspace-intelligence (15 source files + tests)

### 5.1 Core Abstraction Point: `services/file-system.service.ts`

**Current**: A wrapper around `vscode.workspace.fs.*` with `vscode.Uri` parameter types
**Change**: Make it a thin adapter that delegates to `IFileSystemProvider`

```typescript
// BEFORE
import * as vscode from 'vscode';

@injectable()
export class FileSystemService {
  async readFile(uri: vscode.Uri): Promise<string> { ... }
  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> { ... }
  async stat(uri: vscode.Uri): Promise<vscode.FileStat> { ... }
  async exists(uri: vscode.Uri): Promise<boolean> { ... }
}

// AFTER
import { injectable, inject } from 'tsyringe';
import type { IFileSystemProvider, FileStat, DirectoryEntry } from '@ptah-extension/platform-core';
import { PLATFORM_TOKENS, FileType } from '@ptah-extension/platform-core';

@injectable()
export class FileSystemService {
  constructor(
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fs: IFileSystemProvider
  ) {}

  // PUBLIC API CHANGE: Parameters change from vscode.Uri to string
  async readFile(path: string): Promise<string> {
    try {
      return await this.fs.readFile(path);
    } catch (error) {
      throw new FileSystemError(
        `Failed to read file: ${path}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async readDirectory(path: string): Promise<DirectoryEntry[]> {
    try {
      return await this.fs.readDirectory(path);
    } catch (error) {
      throw new FileSystemError(
        `Failed to read directory: ${path}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async stat(path: string): Promise<FileStat> {
    try {
      return await this.fs.stat(path);
    } catch (error) {
      throw new FileSystemError(
        `Failed to stat: ${path}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      return await this.fs.exists(path);
    } catch (error) {
      return false;
    }
  }

  isVirtualWorkspace(path: string): boolean {
    return path.includes('://') && !path.startsWith('file://');
  }
}
```

**CRITICAL IMPACT**: This changes the public API of `FileSystemService` from `Uri`-based to `string`-based. All callers must be updated. This is the largest ripple-effect change.

### 5.2 Caller Migration Strategy

Every file that calls `FileSystemService` methods currently passes `vscode.Uri`. These must change to pass `string` paths instead.

**Files needing Uri-to-string conversion** (all within workspace-intelligence):

| File                                                  | Current call pattern                                          | New call pattern                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `workspace/workspace.service.ts`                      | `this.fileSystem.readFile(uri)`                               | `this.fileSystem.readFile(uri.fsPath)` → then remove Uri entirely, use `path` |
| `context/context.service.ts`                          | `this.fileSystem.readFile(vscode.Uri.file(path))`             | `this.fileSystem.readFile(path)`                                              |
| `project-analysis/project-detector.service.ts`        | `readFile(vscode.Uri.joinPath(workspaceUri, 'package.json'))` | `readFile(path.join(workspacePath, 'package.json'))`                          |
| `project-analysis/framework-detector.service.ts`      | Same Uri pattern                                              | Same string pattern                                                           |
| `project-analysis/dependency-analyzer.service.ts`     | Same Uri pattern                                              | Same string pattern                                                           |
| `project-analysis/monorepo-detector.service.ts`       | Same Uri pattern                                              | Same string pattern                                                           |
| `composite/workspace-analyzer.service.ts`             | Uses `vscode.workspace.workspaceFolders`                      | Use `IWorkspaceProvider`                                                      |
| `file-indexing/workspace-indexer.service.ts`          | Uses `vscode.workspace.findFiles`                             | Use `IFileSystemProvider.findFiles()`                                         |
| `autocomplete/agent-discovery.service.ts`             | Uses `vscode.workspace.workspaceFolders`, file watcher        | Use `IWorkspaceProvider`, `IFileSystemProvider`                               |
| `autocomplete/command-discovery.service.ts`           | Uses `vscode.workspace.workspaceFolders`, file watcher        | Use `IWorkspaceProvider`, `IFileSystemProvider`                               |
| `ast/dependency-graph.service.ts`                     | Uses `vscode.Uri`                                             | Use string paths                                                              |
| `context-analysis/context-enrichment.service.ts`      | Uses vscode imports                                           | Use platform interfaces                                                       |
| `quality/services/project-intelligence.service.ts`    | Uses vscode imports                                           | Use `IWorkspaceProvider`                                                      |
| `quality/services/code-quality-assessment.service.ts` | Uses vscode imports                                           | Use platform interfaces                                                       |
| `quality/services/quality-history.service.ts`         | Uses `vscode.Memento` type                                    | Use `IStateStorage`                                                           |

### 5.3 Detailed Refactoring per File

#### `workspace/workspace.service.ts`

**Changes**:

1. Remove `import * as vscode from 'vscode'`
2. Inject `IWorkspaceProvider` for workspace folders
3. Inject `IFileSystemProvider` for file operations (or use existing FileSystemService which is now platform-agnostic)
4. Replace `vscode.Disposable` with `IDisposable`
5. Replace `vscode.workspace.onDidChangeWorkspaceFolders` with `IWorkspaceProvider.onDidChangeWorkspaceFolders`
6. Replace all `vscode.Uri.file(path)` and `vscode.Uri.joinPath(uri, segment)` with `path.join(base, segment)`
7. Replace `vscode.FileType.Directory` / `vscode.FileType.File` with `FileType.Directory` / `FileType.File`
8. Replace `implements vscode.Disposable` with explicit `dispose(): void`

#### `context/context.service.ts`

**Changes**:

1. Remove `import * as vscode from 'vscode'`
2. Remove local `ILogger` / `IConfigManager` interface hacks — inject the real things via TOKENS
3. Replace `vscode.workspace.findFiles` → inject `IFileSystemProvider` and call `.findFiles()`
4. Replace `vscode.workspace.fs.stat`, `vscode.workspace.fs.readDirectory` → use `FileSystemService` (now string-based)
5. Replace `vscode.workspace.getConfiguration` → inject `IWorkspaceProvider`
6. Replace `vscode.window.onDidChangeActiveTextEditor` → inject `IEditorProvider`
7. Replace `vscode.workspace.onDidOpenTextDocument` → inject `IEditorProvider`
8. Replace `vscode.commands.executeCommand` → inject `ICommandRegistry`
9. Replace `vscode.Uri` in `FileSearchResult.uri` field → change to `string` (file path)

#### `file-indexing/workspace-indexer.service.ts`

**Changes**:

1. Remove `import * as vscode from 'vscode'`
2. Replace `workspaceFolder?: vscode.Uri` in options with `workspaceFolder?: string`
3. Replace `vscode.workspace.findFiles` → use `IFileSystemProvider.findFiles()`
4. Inject `IWorkspaceProvider` for default workspace folder

#### `project-analysis/*.ts` (4 files)

**Changes** (same pattern for all 4):

1. Remove `import * as vscode from 'vscode'`
2. Change method signatures from `(workspaceUri: vscode.Uri)` to `(workspacePath: string)`
3. Replace `vscode.Uri.joinPath(uri, segment)` → `path.join(basePath, segment)`
4. Replace `vscode.workspace.fs.readFile` → use injected `FileSystemService` (now string-based)
5. Replace `vscode.FileType` → `FileType` from platform-core

#### `autocomplete/agent-discovery.service.ts` and `command-discovery.service.ts`

**Changes**:

1. Remove `import * as vscode from 'vscode'`
2. Inject `IWorkspaceProvider` for workspace folder paths
3. Inject `IFileSystemProvider` for file watching (if using `createFileSystemWatcher`)
4. Replace `vscode.workspace.workspaceFolders` → `this.workspace.getWorkspaceFolders()`

#### `composite/workspace-analyzer.service.ts`

**Changes**:

1. Remove `import * as vscode from 'vscode'`
2. Inject `IWorkspaceProvider` for workspace folders
3. Replace `vscode.workspace.workspaceFolders?.[0]?.uri` → `this.workspace.getWorkspaceRoot()`

#### `ast/dependency-graph.service.ts`

**Changes**:

1. Remove `import * as vscode from 'vscode'`
2. Replace any `vscode.Uri` usage with string paths

#### `context-analysis/context-enrichment.service.ts`

**Changes**:

1. Remove `import * as vscode from 'vscode'`
2. Replace vscode API calls with corresponding platform interfaces

#### `quality/services/*.ts` (3 files)

**Changes**:

1. `project-intelligence.service.ts`: Inject `IWorkspaceProvider` instead of using `vscode.workspace.workspaceFolders`
2. `code-quality-assessment.service.ts`: Same pattern
3. `quality-history.service.ts`: Replace `vscode.Memento` type with `IStateStorage`

#### `services/token-counter.service.ts`

**Changes**:

1. Remove `import * as vscode from 'vscode'` — investigate what it uses
2. If it only uses vscode for workspace.fs (reading files for token counting), replace with `IFileSystemProvider`

### 5.4 Test File Updates

All test files (`*.spec.ts`) that mock vscode should:

1. Replace `jest.mock('vscode')` with mocks for platform-core interfaces
2. Replace `vscode.Uri.file(path)` in test setup with plain string paths
3. Replace `vscode.FileType` enum values with `FileType` from platform-core
4. Replace `vscode.Memento` mocks with `IStateStorage` mocks

**Files**: 8 test files identified in workspace-intelligence

---

## Phase 6: Remaining Libraries — agent-generation (7 files)

### 6.1 File-by-File Plan

| File                                              | vscode Usage                                   | Replacement                                        |
| ------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------- |
| `interfaces/setup-wizard.interface.ts`            | `type * as vscode` for `ExtensionContext` type | `IPlatformInfo`                                    |
| `services/orchestrator.service.ts`                | `type * as vscode` for `ExtensionContext` type | `IPlatformInfo`                                    |
| `services/setup-wizard.service.ts`                | `type * as vscode` for `ExtensionContext` type | `IPlatformInfo`                                    |
| `services/setup-status.service.ts`                | `vscode.workspace.workspaceFolders`            | Inject `IWorkspaceProvider`                        |
| `services/wizard/webview-lifecycle.service.ts`    | `type * as vscode` for `ExtensionContext`      | `IPlatformInfo`                                    |
| `services/wizard/agentic-analysis.service.ts`     | `vscode.workspace.*`                           | Inject `IWorkspaceProvider`, `IFileSystemProvider` |
| `services/wizard/multi-phase-analysis.service.ts` | `vscode.workspace.*`                           | Inject `IWorkspaceProvider`, `IFileSystemProvider` |

### 6.2 Registration Function Change

`libs/backend/agent-generation/src/lib/di/register.ts`:

```typescript
// BEFORE
export function registerAgentGenerationServices(
  container: DependencyContainer,
  logger: Logger,
  extensionPath: string
): void { ... }

// AFTER
export function registerAgentGenerationServices(
  container: DependencyContainer,
  logger: Logger
): void {
  // extensionPath now comes from PLATFORM_TOKENS.PLATFORM_INFO
  // Services that need extensionPath inject IPlatformInfo directly
}
```

**Container.ts change**:

```typescript
// BEFORE
registerAgentGenerationServices(container, logger, context.extensionPath);
// AFTER
registerAgentGenerationServices(container, logger);
```

---

## Phase 7: Remaining Libraries — vscode-lm-tools (11 files, partial)

### 7.1 Files That CAN Be Refactored

| File                                                                   | vscode Usage                            | Replacement                                          |
| ---------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------- |
| `permission/permission-prompt.service.ts`                              | `ExtensionContext`                      | `IUserInteraction` for prompts                       |
| `code-execution/ptah-api-builder.service.ts`                           | `vscode.workspace.*`, `vscode.window.*` | `IWorkspaceProvider`, `IFileSystemProvider`          |
| `code-execution/code-execution-mcp.service.ts`                         | `vscode.ExtensionContext`               | `IPlatformInfo` for paths, `IStateStorage` for state |
| `code-execution/namespace-builders/core-namespace.builders.ts`         | `vscode.workspace.*`                    | `IWorkspaceProvider`, `IFileSystemProvider`          |
| `code-execution/namespace-builders/analysis-namespace.builders.ts`     | `vscode.workspace.*`                    | `IWorkspaceProvider`                                 |
| `code-execution/namespace-builders/system-namespace.builders.ts`       | `vscode.workspace.*`                    | `IWorkspaceProvider`, `IFileSystemProvider`          |
| `code-execution/namespace-builders/ast-namespace.builder.ts`           | `vscode.workspace.*`                    | `IWorkspaceProvider`                                 |
| `code-execution/namespace-builders/orchestration-namespace.builder.ts` | `vscode.*`                              | Platform interfaces where possible                   |

### 7.2 Files That MUST Keep vscode Import (VS Code-Specific APIs)

| File                                                         | Reason                                                                                                                                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `code-execution/namespace-builders/ide-namespace.builder.ts` | Uses `vscode.languages.*`, `vscode.window.activeTextEditor`, `vscode.workspace.textDocuments` — these are IDE-specific features with no platform equivalent |
| `code-execution/types.ts`                                    | Defines `PtahAPI` type that references `vscode.DiagnosticSeverity`                                                                                          |
| `code-execution/mcp-handlers/http-server.handler.ts`         | Uses `vscode.ExtensionContext` for MCP server lifecycle                                                                                                     |

**Strategy for remaining vscode files**: Isolate them in a `vscode-specific/` subdirectory or add clear comments marking them as VS Code-only.

---

## DI Token Migration Mapping

| Old Token (vscode-core)                           | New Token (platform-core)                 | Type Change                                      |
| ------------------------------------------------- | ----------------------------------------- | ------------------------------------------------ |
| `TOKENS.GLOBAL_STATE`                             | `PLATFORM_TOKENS.STATE_STORAGE`           | `vscode.Memento` → `IStateStorage`               |
| `TOKENS.EXTENSION_CONTEXT` (for extensionPath)    | `PLATFORM_TOKENS.PLATFORM_INFO`           | `vscode.ExtensionContext` → `IPlatformInfo`      |
| `TOKENS.EXTENSION_CONTEXT` (for secrets)          | `PLATFORM_TOKENS.SECRET_STORAGE`          | `vscode.ExtensionContext` → `ISecretStorage`     |
| `TOKENS.STORAGE_SERVICE` (workspaceState adapter) | `PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE` | Custom adapter → `IStateStorage`                 |
| (none — direct vscode call)                       | `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER`    | `vscode.workspace.fs.*` → `IFileSystemProvider`  |
| (none — direct vscode call)                       | `PLATFORM_TOKENS.WORKSPACE_PROVIDER`      | `vscode.workspace.*` → `IWorkspaceProvider`      |
| (none — direct vscode call)                       | `PLATFORM_TOKENS.USER_INTERACTION`        | `vscode.window.*` → `IUserInteraction`           |
| (none — direct vscode call)                       | `PLATFORM_TOKENS.COMMAND_REGISTRY`        | `vscode.commands.*` → `ICommandRegistry`         |
| (none — direct vscode call)                       | `PLATFORM_TOKENS.EDITOR_PROVIDER`         | `vscode.window.onDidChange*` → `IEditorProvider` |
| (none — direct vscode call)                       | `PLATFORM_TOKENS.OUTPUT_CHANNEL`          | `vscode.OutputChannel` → `IOutputChannel`        |

**Important**: `TOKENS.GLOBAL_STATE` and `TOKENS.STORAGE_SERVICE` REMAIN in vscode-core for backward compatibility with any consumers in the app layer. The refactored libraries use `PLATFORM_TOKENS` exclusively.

---

## Build and Dependency Order

### Build Order

1. `@ptah-extension/shared` (no changes)
2. `@ptah-extension/platform-core` (NEW — depends on nothing)
3. `@ptah-extension/vscode-core` (no changes — stays VS Code-specific)
4. `@ptah-extension/platform-vscode` (NEW — depends on platform-core, vscode)
5. `@ptah-extension/workspace-intelligence` (MODIFIED — depends on platform-core)
6. `@ptah-extension/vscode-lm-tools` (MODIFIED — depends on platform-core, workspace-intelligence)
7. `@ptah-extension/agent-sdk` (MODIFIED — depends on platform-core)
8. `@ptah-extension/agent-generation` (MODIFIED — depends on platform-core, workspace-intelligence)
9. `@ptah-extension/llm-abstraction` (NO CHANGES — keeps vscode dependency)
10. `@ptah-extension/template-generation` (MODIFIED — depends on platform-core)

### Webpack Externals Update

`apps/ptah-extension-vscode/webpack.config.js` may need `@ptah-extension/platform-core` and `@ptah-extension/platform-vscode` added if they aren't handled by Nx resolution.

---

## Testing Strategy

### Unit Tests for platform-core

- Test `createEvent()` utility: subscribe, fire, dispose, multiple listeners
- Test `FileType` and `PlatformType` enum values match expected values

### Unit Tests for platform-vscode

Each implementation class needs tests that:

1. Create the implementation with a mocked vscode API
2. Call each method
3. Verify the correct vscode API was called
4. Verify return values are correctly converted

Example test structure:

```typescript
// __mocks__/vscode.ts is already used by existing tests
describe('VscodeFileSystemProvider', () => {
  it('should convert string path to Uri and call workspace.fs.readFile', async () => {
    const provider = new VscodeFileSystemProvider();
    const result = await provider.readFile('/test/file.ts');
    expect(vscode.workspace.fs.readFile).toHaveBeenCalledWith(expect.objectContaining({ fsPath: '/test/file.ts' }));
  });
});
```

### Integration Tests for Refactored Libraries

Run all existing tests after each phase:

```bash
# After Phase 1-2 (new libraries only)
nx test platform-core
nx test platform-vscode

# After Phase 3
nx test template-generation

# After Phase 4
nx test agent-sdk

# After Phase 5
nx test workspace-intelligence

# After Phase 6
nx test agent-generation

# After Phase 7
nx test vscode-lm-tools

# Final validation
nx run-many --target=test
nx run-many --target=typecheck
nx run-many --target=lint
```

### Verification grep (Success Criteria)

After all phases:

```bash
# Should return ZERO results (excluding test mocks and approved exceptions)
grep -r "from 'vscode'" \
  libs/backend/agent-sdk/src \
  libs/backend/workspace-intelligence/src \
  libs/backend/agent-generation/src \
  libs/backend/template-generation/src \
  --include='*.ts' \
  --exclude='*.spec.ts' \
  --exclude='copilot-auth.service.ts' \
  --exclude='codex-auth.service.ts'
```

---

## Files Affected Summary

### CREATE (new files)

**platform-core** (8 files):

- `libs/backend/platform-core/project.json`
- `libs/backend/platform-core/tsconfig.json`
- `libs/backend/platform-core/tsconfig.lib.json`
- `libs/backend/platform-core/tsconfig.spec.json`
- `libs/backend/platform-core/jest.config.ts`
- `libs/backend/platform-core/src/index.ts`
- `libs/backend/platform-core/src/tokens.ts`
- `libs/backend/platform-core/src/types/platform.types.ts`
- `libs/backend/platform-core/src/interfaces/file-system-provider.interface.ts`
- `libs/backend/platform-core/src/interfaces/state-storage.interface.ts`
- `libs/backend/platform-core/src/interfaces/secret-storage.interface.ts`
- `libs/backend/platform-core/src/interfaces/workspace-provider.interface.ts`
- `libs/backend/platform-core/src/interfaces/user-interaction.interface.ts`
- `libs/backend/platform-core/src/interfaces/output-channel.interface.ts`
- `libs/backend/platform-core/src/interfaces/command-registry.interface.ts`
- `libs/backend/platform-core/src/interfaces/editor-provider.interface.ts`
- `libs/backend/platform-core/src/utils/event-emitter.ts`

**platform-vscode** (13 files):

- `libs/backend/platform-vscode/project.json`
- `libs/backend/platform-vscode/tsconfig.json`
- `libs/backend/platform-vscode/tsconfig.lib.json`
- `libs/backend/platform-vscode/tsconfig.spec.json`
- `libs/backend/platform-vscode/jest.config.ts`
- `libs/backend/platform-vscode/src/index.ts`
- `libs/backend/platform-vscode/src/registration.ts`
- `libs/backend/platform-vscode/src/implementations/vscode-file-system-provider.ts`
- `libs/backend/platform-vscode/src/implementations/vscode-state-storage.ts`
- `libs/backend/platform-vscode/src/implementations/vscode-secret-storage.ts`
- `libs/backend/platform-vscode/src/implementations/vscode-workspace-provider.ts`
- `libs/backend/platform-vscode/src/implementations/vscode-user-interaction.ts`
- `libs/backend/platform-vscode/src/implementations/vscode-output-channel.ts`
- `libs/backend/platform-vscode/src/implementations/vscode-command-registry.ts`
- `libs/backend/platform-vscode/src/implementations/vscode-editor-provider.ts`

### MODIFY (existing files)

**Root config**:

- `tsconfig.base.json` — add 2 path aliases

**Container**:

- `apps/ptah-extension-vscode/src/di/container.ts` — add platform registration, update registerSdkServices/registerAgentGenerationServices call signatures

**template-generation** (2 files):

- `libs/backend/template-generation/src/lib/adapters/file-system.adapter.ts`
- `libs/backend/template-generation/src/lib/services/template-generator.service.ts`

**agent-sdk** (6 files):

- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`
- `libs/backend/agent-sdk/src/lib/session-metadata-store.ts`
- `libs/backend/agent-sdk/src/lib/helpers/config-watcher.ts`
- `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts`
- `libs/backend/agent-sdk/src/lib/di/register.ts`
- `libs/backend/agent-sdk/src/lib/copilot-provider/copilot-auth.service.ts` (comment only)

**workspace-intelligence** (15+ source files, 8 test files):

- `libs/backend/workspace-intelligence/src/services/file-system.service.ts`
- `libs/backend/workspace-intelligence/src/workspace/workspace.service.ts`
- `libs/backend/workspace-intelligence/src/context/context.service.ts`
- `libs/backend/workspace-intelligence/src/file-indexing/workspace-indexer.service.ts`
- `libs/backend/workspace-intelligence/src/project-analysis/project-detector.service.ts`
- `libs/backend/workspace-intelligence/src/project-analysis/framework-detector.service.ts`
- `libs/backend/workspace-intelligence/src/project-analysis/dependency-analyzer.service.ts`
- `libs/backend/workspace-intelligence/src/project-analysis/monorepo-detector.service.ts`
- `libs/backend/workspace-intelligence/src/composite/workspace-analyzer.service.ts`
- `libs/backend/workspace-intelligence/src/autocomplete/agent-discovery.service.ts`
- `libs/backend/workspace-intelligence/src/autocomplete/command-discovery.service.ts`
- `libs/backend/workspace-intelligence/src/ast/dependency-graph.service.ts`
- `libs/backend/workspace-intelligence/src/context-analysis/context-enrichment.service.ts`
- `libs/backend/workspace-intelligence/src/services/token-counter.service.ts`
- `libs/backend/workspace-intelligence/src/quality/services/project-intelligence.service.ts`
- `libs/backend/workspace-intelligence/src/quality/services/code-quality-assessment.service.ts`
- `libs/backend/workspace-intelligence/src/quality/services/quality-history.service.ts`
- `libs/backend/workspace-intelligence/src/quality/interfaces/quality-assessment.interfaces.ts`
- Plus 8 `.spec.ts` test files

**agent-generation** (7 files):

- `libs/backend/agent-generation/src/lib/interfaces/setup-wizard.interface.ts`
- `libs/backend/agent-generation/src/lib/services/orchestrator.service.ts`
- `libs/backend/agent-generation/src/lib/services/setup-wizard.service.ts`
- `libs/backend/agent-generation/src/lib/services/setup-status.service.ts`
- `libs/backend/agent-generation/src/lib/services/wizard/webview-lifecycle.service.ts`
- `libs/backend/agent-generation/src/lib/services/wizard/agentic-analysis.service.ts`
- `libs/backend/agent-generation/src/lib/services/wizard/multi-phase-analysis.service.ts`
- `libs/backend/agent-generation/src/lib/di/register.ts`

**vscode-lm-tools** (8 files refactorable + 3 remain):

- `libs/backend/vscode-lm-tools/src/lib/permission/permission-prompt.service.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/code-execution-mcp.service.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/core-namespace.builders.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/ast-namespace.builder.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/orchestration-namespace.builder.ts`

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**:

- All work is in backend TypeScript libraries (Node.js runtime)
- Requires understanding of DI (tsyringe), interfaces, and dependency management
- No frontend/Angular work involved
- Requires careful attention to type safety and API compatibility

### Complexity Assessment

**Complexity**: HIGH
**Estimated Effort**: 16-24 hours across 7 phases

**Breakdown**:

- Phase 1 (platform-core): 2-3 hours — scaffolding + interface definitions
- Phase 2 (platform-vscode): 3-4 hours — 8 implementation classes + registration
- Phase 3 (template-generation): 1-2 hours — 2 files, straightforward
- Phase 4 (agent-sdk): 2-3 hours — 6 files, registration function change
- Phase 5 (workspace-intelligence): 5-8 hours — 15+ source files, API signature changes, test updates
- Phase 6 (agent-generation): 2-3 hours — 7 files, mostly type changes
- Phase 7 (vscode-lm-tools): 2-3 hours — 8 files refactorable, 3 remain

### Critical Verification Points

**Before implementation, the developer must verify**:

1. **All imports exist**:

   - `PLATFORM_TOKENS` from `@ptah-extension/platform-core` (tokens.ts)
   - `IFileSystemProvider`, `IStateStorage`, etc. from `@ptah-extension/platform-core` (index.ts)
   - `createEvent` from `@ptah-extension/platform-core` (utils/event-emitter.ts)
   - `registerPlatformVscodeServices` from `@ptah-extension/platform-vscode` (registration.ts)

2. **DI token uniqueness**: Every `Symbol.for()` description must be globally unique. All `PLATFORM_TOKENS` use `'Platform'` prefix to avoid collisions with existing tokens.

3. **No hallucinated APIs**: All interfaces designed from actual vscode API usage found in the codebase via grep.

4. **Build order**: platform-core MUST build before platform-vscode. Both MUST build before refactored libraries.

### Architecture Delivery Checklist

- [x] All components specified with evidence (file:line citations throughout)
- [x] All patterns verified from codebase (DI token convention, library scaffolding, registration pattern)
- [x] All imports/decorators verified as existing (Symbol.for convention, @inject/@injectable from tsyringe)
- [x] Quality requirements defined (zero vscode imports in business libraries)
- [x] Integration points documented (container.ts registration, PLATFORM_TOKENS)
- [x] Files affected list complete (30+ new files, 50+ modified files)
- [x] Developer type recommended (backend-developer)
- [x] Complexity assessed (HIGH, 16-24 hours)
- [x] No step-by-step implementation (architecture specification only)
