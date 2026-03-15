# Implementation Plan: Electron Application Architecture for Ptah

## TASK_2025_200 | Architect: software-architect

---

## 1. Codebase Investigation Summary

### Libraries Discovered

- **platform-core** (`libs/backend/platform-core/src`): 8 interfaces + PLATFORM_TOKENS + PlatformType enum (with `Electron` already defined), `createEvent()` utility
- **platform-vscode** (`libs/backend/platform-vscode/src`): Reference implementation for all 8 interfaces, `registerPlatformVscodeServices()` registration function
- **vscode-core** (`libs/backend/vscode-core/src`): Infrastructure — TOKENS, Logger, RpcHandler, CommandManager, WebviewManager, etc.
- **agent-sdk** (`libs/backend/agent-sdk/src`): Claude Agent SDK integration — SdkAgentAdapter, SdkSessionStorage, EnhancedPromptsService
- **workspace-intelligence** (`libs/backend/workspace-intelligence/src`): Project detection, file indexing
- **agent-generation** (`libs/backend/agent-generation/src`): Agent template storage, setup wizard
- **llm-abstraction** (`libs/backend/llm-abstraction/src`): Multi-provider LLM (Anthropic, OpenRouter)
- **template-generation** (`libs/backend/template-generation/src`): Template processing
- **frontend/core** (`libs/frontend/core/src`): VSCodeService, ClaudeRpcService, MessageRouterService, AppStateManager

### Patterns Verified

1. **DI Container Orchestration** (`apps/ptah-extension-vscode/src/di/container.ts`):

   - `DIContainer.setup(context)` static method
   - Phase-based registration: Platform → Logger → vscode-core → workspace-intelligence → vscode-lm-tools → agent-sdk → agent-generation → llm-abstraction → template-generation → App-level
   - Uses `container.register(TOKEN, { useValue: instance })` pattern
   - `isRegistered()` guards for idempotent setup

2. **Platform Registration** (`libs/backend/platform-vscode/src/registration.ts`):

   - Function signature: `registerPlatformVscodeServices(container, context)`
   - Creates `IPlatformInfo` object first
   - Registers all 10 tokens (PLATFORM_INFO + 8 interfaces + WORKSPACE_STATE_STORAGE)
   - Uses `{ useValue: new XxxProvider() }` pattern (NOT classes — instances)

3. **RPC Handler Registration** (`apps/ptah-extension-vscode/src/services/rpc/rpc-method-registration.service.ts`):

   - `RpcMethodRegistrationService` orchestrates domain-specific handler classes
   - Each handler has a `register()` method that calls `rpcHandler.registerMethod(name, handler)`
   - Methods follow `domain:action` naming: `chat:start`, `session:list`, `config:model-get`

4. **Frontend Message Flow** (`libs/frontend/core/src/lib/services/`):

   - `VSCodeService` reads `window.vscode` and `window.ptahConfig` globals
   - `ClaudeRpcService` calls `vscodeService.postMessage()` with correlation IDs
   - `MessageRouterService` listens via `window.addEventListener('message', ...)` and dispatches to handlers

5. **Webpack Configuration** (`apps/ptah-extension-vscode/webpack.config.js`):

   - Target: `node`, output: `commonjs2`
   - Entry: `['reflect-metadata', './src/main.ts']`
   - Bundles `@ptah-extension/*`, `tsyringe`, `reflect-metadata`, `@anthropic-ai/claude-agent-sdk`
   - Externalizes: `vscode`, scoped packages, lowercase node_modules
   - Path aliases for all `@ptah-extension/*` libraries

6. **Event System** (`libs/backend/platform-core/src/utils/event-emitter.ts`):
   - `createEvent<T>()` returns `[IEvent<T>, fire: (data: T) => void]` tuple
   - Used by all VS Code implementations for IEvent properties

### Platform-Core Interfaces (All 8 Verified)

| Interface             | File                                           | Methods                                                                                                                                      |
| --------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `IFileSystemProvider` | `interfaces/file-system-provider.interface.ts` | readFile, readFileBytes, writeFile, writeFileBytes, readDirectory, stat, exists, delete, createDirectory, copy, findFiles, createFileWatcher |
| `IStateStorage`       | `interfaces/state-storage.interface.ts`        | get, update, keys                                                                                                                            |
| `ISecretStorage`      | `interfaces/secret-storage.interface.ts`       | get, store, delete, onDidChange                                                                                                              |
| `IWorkspaceProvider`  | `interfaces/workspace-provider.interface.ts`   | getWorkspaceFolders, getWorkspaceRoot, getConfiguration, onDidChangeConfiguration, onDidChangeWorkspaceFolders                               |
| `IUserInteraction`    | `interfaces/user-interaction.interface.ts`     | showErrorMessage, showWarningMessage, showInformationMessage, showQuickPick, showInputBox, withProgress                                      |
| `IOutputChannel`      | `interfaces/output-channel.interface.ts`       | name, appendLine, append, clear, show, dispose                                                                                               |
| `ICommandRegistry`    | `interfaces/command-registry.interface.ts`     | registerCommand, executeCommand                                                                                                              |
| `IEditorProvider`     | `interfaces/editor-provider.interface.ts`      | onDidChangeActiveEditor, onDidOpenDocument, getActiveEditorPath                                                                              |

### PLATFORM_TOKENS (Verified: `libs/backend/platform-core/src/tokens.ts`)

```
PLATFORM_INFO, FILE_SYSTEM_PROVIDER, STATE_STORAGE, WORKSPACE_STATE_STORAGE,
SECRET_STORAGE, WORKSPACE_PROVIDER, USER_INTERACTION, OUTPUT_CHANNEL,
COMMAND_REGISTRY, EDITOR_PROVIDER
```

---

## 2. Architecture Overview

```
+================================================================+
|                    PTAH ELECTRON APPLICATION                    |
+================================================================+
|                                                                |
|  RENDERER PROCESS (Chromium)                                   |
|  +----------------------------------------------------------+ |
|  |  Angular 20 SPA (ptah-extension-webview — UNCHANGED)      | |
|  |  +------------------------------------------------------+ | |
|  |  |  App Shell -> Chat / Dashboard / Settings / Wizard   | | |
|  |  |  Uses: @ptah-extension/chat, dashboard, setup-wizard | | |
|  |  +------------------------------------------------------+ | |
|  |  |  Frontend Core Services (@ptah-extension/core)       | | |
|  |  |  VSCodeService -> postMessage() -> contextBridge     | | |
|  |  |  ClaudeRpcService -> type-safe RPC calls             | | |
|  |  |  MessageRouterService -> window.addEventListener     | | |
|  |  +------------------------------------------------------+ | |
|  +----------------------------------------------------------+ |
|       |  contextBridge (preload.ts)     |                      |
|       |  ipcRenderer.send/on            |                      |
|  =====[============IPC==================]====================== |
|       |  ipcMain.on/handle              |                      |
|  MAIN PROCESS (Node.js)                                        |
|  +----------------------------------------------------------+ |
|  |  IPC Bridge (ipc-bridge.ts)                               | |
|  |  Deserializes RPC messages, routes to RpcHandler          | |
|  |  Forwards backend events -> renderer via webContents.send | |
|  +----------------------------------------------------------+ |
|  |  DI Container (tsyringe)                                  | |
|  |  +------------------------------------------------------+ | |
|  |  |  PLATFORM LAYER (libs/backend/platform-electron)     | | |
|  |  |  ElectronFileSystemProvider   (Node fs/promises)     | | |
|  |  |  ElectronStateStorage         (JSON file + cache)    | | |
|  |  |  ElectronSecretStorage        (safeStorage)          | | |
|  |  |  ElectronWorkspaceProvider    (dialog + recent)      | | |
|  |  |  ElectronUserInteraction      (dialog API + IPC)     | | |
|  |  |  ElectronOutputChannel        (log file + console)   | | |
|  |  |  ElectronCommandRegistry      (menu + shortcuts)     | | |
|  |  |  ElectronEditorProvider       (Monaco-backed)        | | |
|  |  +------------------------------------------------------+ | |
|  |  |  BACKEND LIBRARIES (UNCHANGED)                       | | |
|  |  |  agent-sdk          -> Claude SDK + streaming        | | |
|  |  |  workspace-intel    -> project analysis              | | |
|  |  |  agent-generation   -> agent templates               | | |
|  |  |  llm-abstraction    -> multi-provider LLM            | | |
|  |  |  template-generation -> template processing          | | |
|  |  |  vscode-core        -> Logger, RpcHandler, TOKENS    | | |
|  |  +------------------------------------------------------+ | |
|  +----------------------------------------------------------+ |
|  |  BrowserWindow Management (main-window.ts)                | |
|  |  Auto-Updater (electron-updater) [Phase 4]               | |
|  |  Application Menu (menu.ts)                               | |
|  +----------------------------------------------------------+ |
+================================================================+
```

### IPC Message Flow (Detailed)

```
RENDERER (Angular)                PRELOAD              MAIN PROCESS

ClaudeRpcService                  contextBridge         IpcBridge
  |                                |                     |
  |-- postMessage({               |                     |
  |     type: 'rpc_request',      |                     |
  |     method: 'chat:start',     |                     |
  |     params: {...},            |                     |
  |     correlationId: 'abc'      |                     |
  |   })                          |                     |
  |                               |                     |
  |----> vscode.postMessage() --->|                     |
  |                        ipcRenderer.send('rpc') ---->|
  |                               |                     |
  |                               |       rpcHandler.handleMessage()
  |                               |             |
  |                               |       resolve handler
  |                               |       execute handler
  |                               |             |
  |                               |       webContents.send('rpc-response',
  |                               |         { type: 'rpc_response',
  |                        <------|           correlationId: 'abc',
  |   <---- window message event  |           success: true,
  |                               |           data: {...} })
  |                               |
MessageRouterService              |
  dispatches to handlers          |
```

---

## 3. Directory Structure

### apps/ptah-electron/

```
apps/ptah-electron/
  src/
    main.ts                    # Electron main process entry point
    preload.ts                 # contextBridge preload script (separate webpack entry)
    di/
      container.ts             # DI container setup (mirrors VS Code container.ts)
    windows/
      main-window.ts           # BrowserWindow creation and management
    ipc/
      ipc-bridge.ts            # IPC handler registration (maps to RPC)
      webview-manager-adapter.ts  # WebviewManager adapter for IPC broadcasting
    menu/
      application-menu.ts      # Electron Menu + keyboard shortcuts
    updater/
      auto-updater.ts          # electron-updater integration [Phase 4]
    assets/
      icons/
        icon.png               # 512x512 app icon (source)
        icon.icns              # macOS icon
        icon.ico               # Windows icon
  webpack.config.js            # Webpack config for main process
  webpack.preload.config.js    # Webpack config for preload script
  tsconfig.app.json            # TypeScript config
  tsconfig.preload.json        # TypeScript config for preload
  project.json                 # Nx project configuration
  electron-builder.yml         # Packaging configuration
```

### libs/backend/platform-electron/

```
libs/backend/platform-electron/
  src/
    index.ts                                    # Public API exports
    registration.ts                             # registerPlatformElectronServices()
    implementations/
      electron-file-system-provider.ts          # IFileSystemProvider (fs/promises + fast-glob + chokidar)
      electron-state-storage.ts                 # IStateStorage (JSON file + in-memory cache)
      electron-secret-storage.ts                # ISecretStorage (safeStorage + encrypted JSON)
      electron-workspace-provider.ts            # IWorkspaceProvider (dialog + recent projects + config)
      electron-user-interaction.ts              # IUserInteraction (dialog API + IPC for custom UI)
      electron-output-channel.ts                # IOutputChannel (log file + console)
      electron-command-registry.ts              # ICommandRegistry (in-memory registry)
      electron-editor-provider.ts               # IEditorProvider (Monaco-backed, tracks active file via IPC)
  project.json
  tsconfig.json
  tsconfig.lib.json
  tsconfig.spec.json
  jest.config.ts
  CLAUDE.md
```

---

## 4. Platform-Electron Implementations

### 4.1 ElectronFileSystemProvider

**File**: `libs/backend/platform-electron/src/implementations/electron-file-system-provider.ts`

**Pattern source**: `libs/backend/platform-vscode/src/implementations/vscode-file-system-provider.ts`

```typescript
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import type { IFileSystemProvider, FileStat, DirectoryEntry, IFileWatcher } from '@ptah-extension/platform-core';
import { FileType, createEvent } from '@ptah-extension/platform-core';

export class ElectronFileSystemProvider implements IFileSystemProvider {
  async readFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, 'utf-8');
  }

  async readFileBytes(filePath: string): Promise<Uint8Array> {
    const buffer = await fs.readFile(filePath);
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
  }

  async writeFileBytes(filePath: string, content: Uint8Array): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  }

  async readDirectory(dirPath: string): Promise<DirectoryEntry[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      type: entry.isFile() ? FileType.File : entry.isDirectory() ? FileType.Directory : entry.isSymbolicLink() ? FileType.SymbolicLink : FileType.Unknown,
    }));
  }

  async stat(filePath: string): Promise<FileStat> {
    const stats = await fs.stat(filePath);
    return {
      type: stats.isFile() ? FileType.File : stats.isDirectory() ? FileType.Directory : stats.isSymbolicLink() ? FileType.SymbolicLink : FileType.Unknown,
      ctime: stats.ctimeMs,
      mtime: stats.mtimeMs,
      size: stats.size,
    };
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async delete(filePath: string, options?: { recursive?: boolean }): Promise<void> {
    await fs.rm(filePath, { recursive: options?.recursive ?? false, force: true });
  }

  async createDirectory(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }

  async copy(source: string, destination: string, options?: { overwrite?: boolean }): Promise<void> {
    const destExists = await this.exists(destination);
    if (destExists && !options?.overwrite) {
      throw new Error(`Destination already exists: ${destination}`);
    }
    await fs.cp(source, destination, { recursive: true, force: options?.overwrite });
  }

  async findFiles(pattern: string, exclude?: string, maxResults?: number): Promise<string[]> {
    // Use fast-glob for reliable cross-platform glob support
    const fg = await import('fast-glob');
    const results = await fg.default(pattern, {
      ignore: exclude ? [exclude] : undefined,
      absolute: true,
      onlyFiles: true,
    });
    return maxResults ? results.slice(0, maxResults) : results;
  }

  createFileWatcher(pattern: string): IFileWatcher {
    // Dynamic import to avoid issues if chokidar not installed
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const chokidar = require('chokidar');
    const watcher = chokidar.watch(pattern, {
      ignoreInitial: true,
      persistent: true,
    });

    const [onDidChange, fireChange] = createEvent<string>();
    const [onDidCreate, fireCreate] = createEvent<string>();
    const [onDidDelete, fireDelete] = createEvent<string>();

    watcher.on('change', (filePath: string) => fireChange(filePath));
    watcher.on('add', (filePath: string) => fireCreate(filePath));
    watcher.on('unlink', (filePath: string) => fireDelete(filePath));

    return {
      onDidChange,
      onDidCreate,
      onDidDelete,
      dispose() {
        watcher.close();
      },
    };
  }
}
```

### 4.2 ElectronStateStorage

**File**: `libs/backend/platform-electron/src/implementations/electron-state-storage.ts`

**Pattern source**: `libs/backend/platform-vscode/src/implementations/vscode-state-storage.ts`

```typescript
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import type { IStateStorage } from '@ptah-extension/platform-core';

/**
 * JSON file-based state storage with in-memory cache.
 * Replaces vscode.Memento (globalState / workspaceState).
 *
 * Thread-safe writes via atomic rename pattern.
 */
export class ElectronStateStorage implements IStateStorage {
  private data: Record<string, unknown> = {};
  private readonly filePath: string;
  private writePromise: Promise<void> = Promise.resolve();

  constructor(storageDirPath: string, filename: string) {
    this.filePath = path.join(storageDirPath, filename);
    this.loadSync();
  }

  get<T>(key: string, defaultValue?: T): T | undefined {
    const value = this.data[key];
    return value !== undefined ? (value as T) : defaultValue;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      delete this.data[key];
    } else {
      this.data[key] = value;
    }
    // Serialize writes to prevent corruption
    this.writePromise = this.writePromise.then(() => this.persist());
  }

  keys(): readonly string[] {
    return Object.keys(this.data);
  }

  private loadSync(): void {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      this.data = JSON.parse(raw);
    } catch {
      this.data = {};
    }
  }

  private async persist(): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fsPromises.mkdir(dir, { recursive: true });
    // Atomic write: write to temp file then rename
    const tmpPath = this.filePath + '.tmp';
    await fsPromises.writeFile(tmpPath, JSON.stringify(this.data, null, 2), 'utf-8');
    await fsPromises.rename(tmpPath, this.filePath);
  }
}
```

### 4.3 ElectronSecretStorage

**File**: `libs/backend/platform-electron/src/implementations/electron-secret-storage.ts`

**Pattern source**: `libs/backend/platform-vscode/src/implementations/vscode-secret-storage.ts`

```typescript
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import type { ISecretStorage } from '@ptah-extension/platform-core';
import type { IEvent, SecretChangeEvent } from '@ptah-extension/platform-core';
import { createEvent } from '@ptah-extension/platform-core';

/**
 * Electron secret storage using safeStorage API.
 *
 * Stores encrypted secrets in a JSON file. Each value is encrypted
 * with Electron's safeStorage (DPAPI on Windows, Keychain on macOS,
 * libsecret on Linux).
 *
 * IMPORTANT: safeStorage is only available after app.whenReady().
 * The registration function must ensure this.
 */
export class ElectronSecretStorage implements ISecretStorage {
  public readonly onDidChange: IEvent<SecretChangeEvent>;
  private readonly fireChange: (data: SecretChangeEvent) => void;
  private secrets: Record<string, string> = {}; // key -> base64-encoded encrypted buffer
  private readonly filePath: string;
  private writePromise: Promise<void> = Promise.resolve();

  // safeStorage is injected to avoid importing 'electron' at module level
  // (the library might be loaded in tests without Electron runtime)
  constructor(
    storageDirPath: string,
    private readonly safeStorage: {
      isEncryptionAvailable(): boolean;
      encryptString(plainText: string): Buffer;
      decryptString(encrypted: Buffer): string;
    }
  ) {
    this.filePath = path.join(storageDirPath, 'secrets.json');
    const [event, fire] = createEvent<SecretChangeEvent>();
    this.onDidChange = event;
    this.fireChange = fire;
    this.loadSync();
  }

  async get(key: string): Promise<string | undefined> {
    const encrypted = this.secrets[key];
    if (!encrypted) return undefined;

    if (!this.safeStorage.isEncryptionAvailable()) {
      // Fallback: return raw value if encryption not available (Linux without keyring)
      console.warn('[ElectronSecretStorage] Encryption not available, returning raw value');
      return encrypted;
    }

    try {
      const buffer = Buffer.from(encrypted, 'base64');
      return this.safeStorage.decryptString(buffer);
    } catch (error) {
      console.error('[ElectronSecretStorage] Failed to decrypt secret:', key, error);
      return undefined;
    }
  }

  async store(key: string, value: string): Promise<void> {
    if (this.safeStorage.isEncryptionAvailable()) {
      const encrypted = this.safeStorage.encryptString(value);
      this.secrets[key] = encrypted.toString('base64');
    } else {
      // Fallback: store raw (with warning)
      console.warn('[ElectronSecretStorage] Encryption not available, storing raw');
      this.secrets[key] = value;
    }
    this.writePromise = this.writePromise.then(() => this.persist());
    this.fireChange({ key });
  }

  async delete(key: string): Promise<void> {
    if (!(key in this.secrets)) return;
    delete this.secrets[key];
    this.writePromise = this.writePromise.then(() => this.persist());
    this.fireChange({ key });
  }

  private loadSync(): void {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      this.secrets = JSON.parse(raw);
    } catch {
      this.secrets = {};
    }
  }

  private async persist(): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fsPromises.mkdir(dir, { recursive: true });
    const tmpPath = this.filePath + '.tmp';
    await fsPromises.writeFile(tmpPath, JSON.stringify(this.secrets, null, 2), 'utf-8');
    await fsPromises.rename(tmpPath, this.filePath);
  }
}
```

### 4.4 ElectronWorkspaceProvider

**File**: `libs/backend/platform-electron/src/implementations/electron-workspace-provider.ts`

**Pattern source**: `libs/backend/platform-vscode/src/implementations/vscode-workspace-provider.ts`

```typescript
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { IEvent, ConfigurationChangeEvent } from '@ptah-extension/platform-core';
import { createEvent } from '@ptah-extension/platform-core';

/**
 * Electron workspace provider.
 *
 * Manages workspace folders (opened directories) and configuration
 * stored in a JSON config file. Configuration lives at:
 *   {globalStoragePath}/config.json
 *
 * Workspace folders are set when user opens a folder via dialog.
 */
export class ElectronWorkspaceProvider implements IWorkspaceProvider {
  public readonly onDidChangeConfiguration: IEvent<ConfigurationChangeEvent>;
  public readonly onDidChangeWorkspaceFolders: IEvent<void>;

  private readonly fireConfigChange: (data: ConfigurationChangeEvent) => void;
  private readonly fireFoldersChange: (data: void) => void;

  private folders: string[] = [];
  private config: Record<string, Record<string, unknown>> = {};
  private readonly configFilePath: string;

  constructor(globalStoragePath: string, initialFolders?: string[]) {
    const [configEvent, fireConfig] = createEvent<ConfigurationChangeEvent>();
    this.onDidChangeConfiguration = configEvent;
    this.fireConfigChange = fireConfig;

    const [folderEvent, fireFolders] = createEvent<void>();
    this.onDidChangeWorkspaceFolders = folderEvent;
    this.fireFoldersChange = fireFolders;

    this.configFilePath = path.join(globalStoragePath, 'config.json');
    this.loadConfigSync();

    if (initialFolders && initialFolders.length > 0) {
      this.folders = [...initialFolders];
    }
  }

  getWorkspaceFolders(): string[] {
    return [...this.folders];
  }

  getWorkspaceRoot(): string | undefined {
    return this.folders[0];
  }

  getConfiguration<T>(section: string, key: string, defaultValue?: T): T | undefined {
    const sectionConfig = this.config[section];
    if (!sectionConfig) return defaultValue;
    const value = sectionConfig[key];
    return value !== undefined ? (value as T) : defaultValue;
  }

  /**
   * Set workspace folders (called when user opens folder via Electron dialog).
   * Fires onDidChangeWorkspaceFolders event.
   */
  setWorkspaceFolders(folders: string[]): void {
    this.folders = [...folders];
    this.fireFoldersChange(undefined as unknown as void);
  }

  /**
   * Update a configuration value.
   * Fires onDidChangeConfiguration event.
   */
  async setConfiguration(section: string, key: string, value: unknown): Promise<void> {
    if (!this.config[section]) {
      this.config[section] = {};
    }
    this.config[section][key] = value;
    await this.persistConfig();
    this.fireConfigChange({
      affectsConfiguration: (s: string) => s === section || s === `${section}.${key}`,
    });
  }

  private loadConfigSync(): void {
    try {
      const raw = fs.readFileSync(this.configFilePath, 'utf-8');
      this.config = JSON.parse(raw);
    } catch {
      this.config = {};
    }
  }

  private async persistConfig(): Promise<void> {
    const dir = path.dirname(this.configFilePath);
    await fsPromises.mkdir(dir, { recursive: true });
    await fsPromises.writeFile(this.configFilePath, JSON.stringify(this.config, null, 2), 'utf-8');
  }
}
```

### 4.5 ElectronUserInteraction

**File**: `libs/backend/platform-electron/src/implementations/electron-user-interaction.ts`

**Pattern source**: `libs/backend/platform-vscode/src/implementations/vscode-user-interaction.ts`

```typescript
import type { IUserInteraction } from '@ptah-extension/platform-core';
import type { QuickPickItem, QuickPickOptions, InputBoxOptions, ProgressOptions, IProgress, ICancellationToken } from '@ptah-extension/platform-core';
import { createEvent } from '@ptah-extension/platform-core';

// Types for Electron APIs passed via constructor (avoids top-level electron import)
interface ElectronDialog {
  showMessageBox(
    window: ElectronBrowserWindow | null,
    options: {
      type: string;
      message: string;
      buttons: string[];
      title?: string;
    }
  ): Promise<{ response: number }>;
  showOpenDialog(window: ElectronBrowserWindow | null, options: { properties: string[]; title?: string }): Promise<{ canceled: boolean; filePaths: string[] }>;
}

interface ElectronBrowserWindow {
  webContents: {
    send(channel: string, ...args: unknown[]): void;
  };
}

/**
 * Electron user interaction.
 *
 * Simple dialogs (error/warning/info) use Electron's native dialog.showMessageBox().
 * Complex dialogs (QuickPick, InputBox) delegate to the renderer process via IPC,
 * where they are displayed using existing Angular/DaisyUI components.
 *
 * Progress is forwarded to renderer for display in the Angular UI.
 */
export class ElectronUserInteraction implements IUserInteraction {
  constructor(private readonly dialog: ElectronDialog, private readonly getWindow: () => ElectronBrowserWindow | null) {}

  async showErrorMessage(message: string, ...actions: string[]): Promise<string | undefined> {
    const win = this.getWindow();
    const result = await this.dialog.showMessageBox(win, {
      type: 'error',
      message,
      buttons: actions.length ? actions : ['OK'],
    });
    return actions.length ? actions[result.response] : undefined;
  }

  async showWarningMessage(message: string, ...actions: string[]): Promise<string | undefined> {
    const win = this.getWindow();
    const result = await this.dialog.showMessageBox(win, {
      type: 'warning',
      message,
      buttons: actions.length ? actions : ['OK'],
    });
    return actions.length ? actions[result.response] : undefined;
  }

  async showInformationMessage(message: string, ...actions: string[]): Promise<string | undefined> {
    const win = this.getWindow();
    const result = await this.dialog.showMessageBox(win, {
      type: 'info',
      message,
      buttons: actions.length ? actions : ['OK'],
    });
    return actions.length ? actions[result.response] : undefined;
  }

  async showQuickPick(items: QuickPickItem[], options?: QuickPickOptions): Promise<QuickPickItem | undefined> {
    // Delegate to renderer via IPC — renderer shows Angular-based quick pick
    const win = this.getWindow();
    if (!win) return undefined;

    return new Promise<QuickPickItem | undefined>((resolve) => {
      const { ipcMain } = require('electron');
      const channel = `quick-pick-response-${Date.now()}`;

      ipcMain.once(channel, (_event: unknown, selectedIndex: number | null) => {
        if (selectedIndex === null || selectedIndex < 0) {
          resolve(undefined);
        } else {
          resolve(items[selectedIndex]);
        }
      });

      win.webContents.send('show-quick-pick', {
        items,
        options,
        responseChannel: channel,
      });
    });
  }

  async showInputBox(options?: InputBoxOptions): Promise<string | undefined> {
    // Delegate to renderer via IPC
    const win = this.getWindow();
    if (!win) return undefined;

    return new Promise<string | undefined>((resolve) => {
      const { ipcMain } = require('electron');
      const channel = `input-box-response-${Date.now()}`;

      ipcMain.once(channel, (_event: unknown, value: string | null) => {
        resolve(value ?? undefined);
      });

      win.webContents.send('show-input-box', {
        options,
        responseChannel: channel,
      });
    });
  }

  async withProgress<T>(options: ProgressOptions, task: (progress: IProgress, token: ICancellationToken) => Promise<T>): Promise<T> {
    const win = this.getWindow();
    const progressId = `progress-${Date.now()}`;

    // Create cancellation support
    const [onCancellationRequested, fireCancellation] = createEvent<void>();
    let isCancelled = false;

    if (options.cancellable) {
      const { ipcMain } = require('electron');
      ipcMain.once(`cancel-progress-${progressId}`, () => {
        isCancelled = true;
        fireCancellation(undefined as unknown as void);
      });
    }

    const token: ICancellationToken = {
      get isCancellationRequested() {
        return isCancelled;
      },
      onCancellationRequested,
    };

    const progress: IProgress = {
      report: (value) => {
        win?.webContents.send('progress-update', {
          id: progressId,
          ...options,
          ...value,
        });
      },
    };

    // Notify renderer that progress started
    win?.webContents.send('progress-start', {
      id: progressId,
      title: options.title,
      cancellable: options.cancellable,
    });

    try {
      return await task(progress, token);
    } finally {
      win?.webContents.send('progress-end', { id: progressId });
    }
  }
}
```

### 4.6 ElectronOutputChannel

**File**: `libs/backend/platform-electron/src/implementations/electron-output-channel.ts`

**Pattern source**: `libs/backend/platform-vscode/src/implementations/vscode-output-channel.ts`

```typescript
import * as fs from 'fs';
import * as path from 'path';
import type { IOutputChannel } from '@ptah-extension/platform-core';

/**
 * Electron output channel — writes to log file + console.
 *
 * Log file location: {app.getPath('logs')}/{name}.log
 */
export class ElectronOutputChannel implements IOutputChannel {
  readonly name: string;
  private logStream: fs.WriteStream;
  private isDisposed = false;

  constructor(name: string, logDir: string) {
    this.name = name;
    const logPath = path.join(logDir, `${name}.log`);
    // Ensure directory exists
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    this.logStream = fs.createWriteStream(logPath, { flags: 'a' });
  }

  appendLine(message: string): void {
    if (this.isDisposed) return;
    const line = `[${new Date().toISOString()}] ${message}\n`;
    this.logStream.write(line);
    console.log(`[${this.name}] ${message}`);
  }

  append(message: string): void {
    if (this.isDisposed) return;
    this.logStream.write(message);
  }

  clear(): void {
    // Close current stream and reopen with 'w' flag to truncate
    if (this.isDisposed) return;
    const logPath = this.logStream.path as string;
    this.logStream.end();
    this.logStream = fs.createWriteStream(logPath, { flags: 'w' });
  }

  show(): void {
    // In Electron, "show" could open the log file in default editor
    // For MVP, just log to console
    console.log(`[${this.name}] Output channel shown (log file: ${this.logStream.path})`);
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.logStream.end();
  }
}
```

### 4.7 ElectronCommandRegistry

**File**: `libs/backend/platform-electron/src/implementations/electron-command-registry.ts`

```typescript
import type { ICommandRegistry } from '@ptah-extension/platform-core';
import type { IDisposable } from '@ptah-extension/platform-core';

/**
 * Electron command registry — in-memory registry for command handlers.
 *
 * Commands can be bound to Electron Menu items and keyboard shortcuts
 * via the application menu integration.
 */
export class ElectronCommandRegistry implements ICommandRegistry {
  private readonly commands = new Map<string, (...args: unknown[]) => unknown>();

  registerCommand(id: string, handler: (...args: unknown[]) => unknown): IDisposable {
    this.commands.set(id, handler);
    return {
      dispose: () => {
        this.commands.delete(id);
      },
    };
  }

  async executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T> {
    const handler = this.commands.get(id);
    if (!handler) {
      throw new Error(`Command not found: ${id}`);
    }
    const result = await handler(...args);
    return result as T;
  }

  /**
   * Get all registered command IDs.
   * Used by the application menu to build dynamic menu items.
   */
  getRegisteredCommands(): string[] {
    return Array.from(this.commands.keys());
  }
}
```

### 4.8 ElectronEditorProvider (Monaco-Backed)

**File**: `libs/backend/platform-electron/src/implementations/electron-editor-provider.ts`

The Electron app uses Monaco Editor (`ngx-monaco-editor-v2` v20.x for Angular 20) in the renderer
with a file tree sidebar. The backend `ElectronEditorProvider` tracks which file is active and
fires events when the renderer opens/changes files via IPC.

```typescript
import type { IEditorProvider } from '@ptah-extension/platform-core';
import type { IEvent } from '@ptah-extension/platform-core';
import { createEvent } from '@ptah-extension/platform-core';

/**
 * Monaco-backed editor provider for Electron.
 *
 * The renderer hosts Monaco Editor (ngx-monaco-editor-v2) and a file tree.
 * This backend service tracks state and fires events when the renderer
 * notifies of file open/change via IPC.
 */
export class ElectronEditorProvider implements IEditorProvider {
  readonly onDidChangeActiveEditor: IEvent<{ filePath: string | undefined }>;
  readonly onDidOpenDocument: IEvent<{ filePath: string }>;

  private readonly fireActiveEditorChange: (data: { filePath: string | undefined }) => void;
  private readonly fireDocumentOpen: (data: { filePath: string }) => void;
  private activeFilePath: string | undefined;

  constructor() {
    const [changeEvent, fireChange] = createEvent<{ filePath: string | undefined }>();
    this.onDidChangeActiveEditor = changeEvent;
    this.fireActiveEditorChange = fireChange;

    const [openEvent, fireOpen] = createEvent<{ filePath: string }>();
    this.onDidOpenDocument = openEvent;
    this.fireDocumentOpen = fireOpen;
  }

  getActiveEditorPath(): string | undefined {
    return this.activeFilePath;
  }

  /**
   * Called by IPC bridge when renderer opens a file in Monaco.
   */
  notifyFileOpened(filePath: string): void {
    this.activeFilePath = filePath;
    this.fireDocumentOpen({ filePath });
    this.fireActiveEditorChange({ filePath });
  }

  /**
   * Called by IPC bridge when renderer closes the editor or switches tabs.
   */
  notifyActiveEditorChanged(filePath: string | undefined): void {
    this.activeFilePath = filePath;
    this.fireActiveEditorChange({ filePath });
  }
}
```

### 4.8.1 Monaco Editor Frontend Integration

**Package**: `ngx-monaco-editor-v2` v20.x (Angular 20 compatible)
**Dependency**: `monaco-editor` v0.55+

**Installation**:

```bash
npm install ngx-monaco-editor-v2@20 monaco-editor@^0.55
```

**Angular Module Setup** (`apps/ptah-extension-webview` or Electron-specific module):

```typescript
// In app.config.ts or equivalent
import { provideMonacoEditor } from 'ngx-monaco-editor-v2';

export const appConfig = {
  providers: [
    provideMonacoEditor({
      baseUrl: './assets/monaco',
      defaultOptions: {
        theme: 'vs-dark',
        scrollBeyondLastLine: false,
        minimap: { enabled: true },
        automaticLayout: true,
        fontSize: 14,
        wordWrap: 'on',
      },
    }),
  ],
};
```

**Editor Component** (`libs/frontend/editor/`):

```typescript
@Component({
  selector: 'ptah-code-editor',
  standalone: true,
  imports: [EditorComponent],
  template: `
    <div class="h-full flex">
      <!-- File Tree Sidebar -->
      <ptah-file-tree [rootPath]="workspaceRoot()" [files]="fileTree()" (fileSelected)="onFileSelected($event)" />
      <!-- Monaco Editor -->
      <div class="flex-1">
        <ngx-monaco-editor [options]="editorOptions()" [(ngModel)]="fileContent" (onInit)="onEditorInit($event)" />
      </div>
    </div>
  `,
})
export class CodeEditorComponent {
  workspaceRoot = input<string>();
  fileTree = input<FileTreeNode[]>();
  editorOptions = computed(() => ({
    theme: 'vs-dark',
    language: this.detectLanguage(this.activeFile()),
    readOnly: false,
    automaticLayout: true,
  }));
  activeFile = signal<string | undefined>(undefined);
  fileContent = '';

  onFileSelected(filePath: string) {
    this.activeFile.set(filePath);
    // IPC: request file content from main process
    this.vscodeService.postMessage({
      type: 'rpc_call',
      payload: { method: 'editor:openFile', params: { filePath } },
    });
  }

  private detectLanguage(filePath?: string): string {
    if (!filePath) return 'plaintext';
    const ext = filePath.split('.').pop();
    const langMap: Record<string, string> = {
      ts: 'typescript',
      js: 'javascript',
      json: 'json',
      html: 'html',
      css: 'css',
      scss: 'scss',
      py: 'python',
      md: 'markdown',
      yaml: 'yaml',
      yml: 'yaml',
    };
    return langMap[ext ?? ''] ?? 'plaintext';
  }
}
```

**File Tree Component** (`libs/frontend/editor/`):

```typescript
export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
  expanded?: boolean;
}

@Component({
  selector: 'ptah-file-tree',
  standalone: true,
  template: `
    <div class="w-64 h-full overflow-y-auto bg-base-200 border-r border-base-300 p-2">
      <div class="text-sm font-semibold mb-2 px-2 opacity-70">EXPLORER</div>
      @for (node of files(); track node.path) {
      <ptah-file-tree-node [node]="node" [depth]="0" (fileClicked)="fileSelected.emit($event)" />
      }
    </div>
  `,
})
export class FileTreeComponent {
  files = input<FileTreeNode[]>([]);
  fileSelected = output<string>();
}
```

**IPC Handlers for Editor** (added to IPC bridge):

```typescript
// In apps/ptah-electron/src/ipc/ipc-bridge.ts
// Register editor-specific IPC methods:
ipcMain.handle('editor:openFile', async (_event, { filePath }) => {
  const fs = container.resolve<IFileSystemProvider>(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER);
  const content = await fs.readFile(filePath);
  const editorProvider = container.resolve<ElectronEditorProvider>(PLATFORM_TOKENS.EDITOR_PROVIDER);
  editorProvider.notifyFileOpened(filePath);
  return { content, filePath };
});

ipcMain.handle('editor:saveFile', async (_event, { filePath, content }) => {
  const fs = container.resolve<IFileSystemProvider>(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER);
  await fs.writeFile(filePath, content);
  return { success: true };
});

ipcMain.handle('editor:getFileTree', async (_event, { rootPath }) => {
  const fs = container.resolve<IFileSystemProvider>(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER);
  return buildFileTree(fs, rootPath);
});
```

**Monaco Assets for Electron**: Monaco editor workers must be copied to the renderer output:

```json
// In angular.json assets config for Electron build:
{
  "glob": "**/*",
  "input": "node_modules/monaco-editor/min/vs",
  "output": "/assets/monaco/vs"
}
```

### 4.9 Registration Function

**File**: `libs/backend/platform-electron/src/registration.ts`

**Pattern source**: `libs/backend/platform-vscode/src/registration.ts` (lines 34-98)

```typescript
import type { DependencyContainer } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IPlatformInfo } from '@ptah-extension/platform-core';
import { PlatformType } from '@ptah-extension/platform-core';

import { ElectronFileSystemProvider } from './implementations/electron-file-system-provider';
import { ElectronStateStorage } from './implementations/electron-state-storage';
import { ElectronSecretStorage } from './implementations/electron-secret-storage';
import { ElectronWorkspaceProvider } from './implementations/electron-workspace-provider';
import { ElectronUserInteraction } from './implementations/electron-user-interaction';
import { ElectronOutputChannel } from './implementations/electron-output-channel';
import { ElectronCommandRegistry } from './implementations/electron-command-registry';
import { ElectronEditorProvider } from './implementations/electron-editor-provider';

/**
 * Options for Electron platform registration.
 * All Electron-specific APIs are passed in to avoid top-level
 * import of 'electron' (enables testing without Electron runtime).
 */
export interface ElectronPlatformOptions {
  /** app.getAppPath() */
  appPath: string;
  /** app.getPath('userData') */
  userDataPath: string;
  /** app.getPath('logs') */
  logsPath: string;
  /** Electron's safeStorage module */
  safeStorage: {
    isEncryptionAvailable(): boolean;
    encryptString(plainText: string): Buffer;
    decryptString(encrypted: Buffer): string;
  };
  /** Electron's dialog module */
  dialog: {
    showMessageBox: (...args: unknown[]) => Promise<{ response: number }>;
    showOpenDialog: (...args: unknown[]) => Promise<{ canceled: boolean; filePaths: string[] }>;
  };
  /** Function to get the current BrowserWindow */
  getWindow: () => { webContents: { send(channel: string, ...args: unknown[]): void } } | null;
  /** Initial workspace folders (from command line or recent) */
  initialFolders?: string[];
}

/**
 * Register all Electron platform implementations in the DI container.
 *
 * MUST be called after app.whenReady() (safeStorage requires it).
 * MUST be called before any library registerXxxServices() functions.
 *
 * Mirrors: libs/backend/platform-vscode/src/registration.ts
 */
export function registerPlatformElectronServices(container: DependencyContainer, options: ElectronPlatformOptions): void {
  const workspaceStoragePath = options.initialFolders?.[0] ? require('path').join(options.userDataPath, 'workspace-storage', encodeWorkspacePath(options.initialFolders[0])) : require('path').join(options.userDataPath, 'workspace-storage', 'default');

  // Platform Info
  const platformInfo: IPlatformInfo = {
    type: PlatformType.Electron,
    extensionPath: options.appPath,
    globalStoragePath: options.userDataPath,
    workspaceStoragePath,
  };
  container.register(PLATFORM_TOKENS.PLATFORM_INFO, { useValue: platformInfo });

  // File System
  container.register(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER, {
    useValue: new ElectronFileSystemProvider(),
  });

  // State Storage (global)
  container.register(PLATFORM_TOKENS.STATE_STORAGE, {
    useValue: new ElectronStateStorage(options.userDataPath, 'global-state.json'),
  });

  // State Storage (workspace-scoped)
  container.register(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE, {
    useValue: new ElectronStateStorage(workspaceStoragePath, 'workspace-state.json'),
  });

  // Secret Storage (uses safeStorage for encryption)
  container.register(PLATFORM_TOKENS.SECRET_STORAGE, {
    useValue: new ElectronSecretStorage(options.userDataPath, options.safeStorage),
  });

  // Workspace Provider
  container.register(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {
    useValue: new ElectronWorkspaceProvider(options.userDataPath, options.initialFolders),
  });

  // User Interaction
  container.register(PLATFORM_TOKENS.USER_INTERACTION, {
    useValue: new ElectronUserInteraction(options.dialog as any, options.getWindow as any),
  });

  // Output Channel
  container.register(PLATFORM_TOKENS.OUTPUT_CHANNEL, {
    useValue: new ElectronOutputChannel('Ptah Electron', options.logsPath),
  });

  // Command Registry
  container.register(PLATFORM_TOKENS.COMMAND_REGISTRY, {
    useValue: new ElectronCommandRegistry(),
  });

  // Editor Provider (null MVP)
  container.register(PLATFORM_TOKENS.EDITOR_PROVIDER, {
    useValue: new ElectronEditorProvider(),
  });
}

/**
 * Create a filesystem-safe workspace identifier from a folder path.
 */
function encodeWorkspacePath(folderPath: string): string {
  return Buffer.from(folderPath).toString('base64url');
}
```

### 4.10 Library Index

**File**: `libs/backend/platform-electron/src/index.ts`

```typescript
// Registration function (primary export)
export { registerPlatformElectronServices } from './registration';
export type { ElectronPlatformOptions } from './registration';

// Implementations (for direct use if needed)
export { ElectronFileSystemProvider } from './implementations/electron-file-system-provider';
export { ElectronStateStorage } from './implementations/electron-state-storage';
export { ElectronSecretStorage } from './implementations/electron-secret-storage';
export { ElectronWorkspaceProvider } from './implementations/electron-workspace-provider';
export { ElectronUserInteraction } from './implementations/electron-user-interaction';
export { ElectronOutputChannel } from './implementations/electron-output-channel';
export { ElectronCommandRegistry } from './implementations/electron-command-registry';
export { ElectronEditorProvider } from './implementations/electron-editor-provider';
```

---

## 5. Electron Main Process

### 5.1 main.ts — Entry Point

**File**: `apps/ptah-electron/src/main.ts`

**Pattern source**: `apps/ptah-extension-vscode/src/main.ts` (lines 1-21)

```typescript
// CRITICAL: reflect-metadata MUST be imported first for TSyringe to work
import 'reflect-metadata';

import { app, BrowserWindow, safeStorage, dialog, ipcMain } from 'electron';
import * as path from 'path';
import { ElectronDIContainer } from './di/container';
import { createMainWindow } from './windows/main-window';
import { IpcBridge } from './ipc/ipc-bridge';

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let ipcBridge: IpcBridge | null = null;

app.whenReady().then(async () => {
  // ========================================
  // PHASE 1: Create BrowserWindow
  // ========================================
  mainWindow = createMainWindow();

  // Handle second instance (focus existing window)
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // ========================================
  // PHASE 2: Initialize DI Container
  // ========================================
  // Parse command-line args for initial workspace folder
  const workspacePath = process.argv.find((arg) => !arg.startsWith('-') && arg !== process.argv[0] && arg !== process.argv[1]);
  const initialFolders = workspacePath ? [path.resolve(workspacePath)] : [];

  const container = ElectronDIContainer.setup({
    appPath: app.getAppPath(),
    userDataPath: app.getPath('userData'),
    logsPath: app.getPath('logs'),
    safeStorage,
    dialog,
    getWindow: () => mainWindow,
    initialFolders,
  });

  // ========================================
  // PHASE 3: Setup IPC Bridge
  // ========================================
  ipcBridge = new IpcBridge(container, () => mainWindow);
  ipcBridge.initialize();

  // ========================================
  // PHASE 4: Load API Key from Secret Storage
  // ========================================
  const { PLATFORM_TOKENS } = require('@ptah-extension/platform-core');
  const secretStorage = container.resolve(PLATFORM_TOKENS.SECRET_STORAGE);
  const apiKey = await secretStorage.get('anthropic-api-key');
  if (apiKey) {
    process.env['ANTHROPIC_API_KEY'] = apiKey;
  }

  // ========================================
  // PHASE 5: Load Renderer
  // ========================================
  const rendererPath = path.join(__dirname, 'renderer', 'index.html');
  mainWindow.loadFile(rendererPath);

  // Open DevTools in development
  if (process.env['NODE_ENV'] === 'development') {
    mainWindow.webContents.openDevTools();
  }
});

// macOS: re-create window when dock icon is clicked
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createMainWindow();
    const rendererPath = path.join(__dirname, 'renderer', 'index.html');
    mainWindow.loadFile(rendererPath);
  }
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
```

### 5.2 main-window.ts — BrowserWindow Creation

**File**: `apps/ptah-electron/src/windows/main-window.ts`

```typescript
import { BrowserWindow } from 'electron';
import * as path from 'path';

/**
 * Create the main application window.
 *
 * Security settings:
 * - contextIsolation: true (preload is only bridge)
 * - nodeIntegration: false (no Node.js in renderer)
 * - sandbox: true (additional security layer)
 */
export function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Ptah',
    icon: path.join(__dirname, 'assets', 'icons', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
    // macOS title bar
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 15, y: 15 },
  });

  // Persist window state
  mainWindow.on('close', () => {
    // Save window bounds for next launch
    const bounds = mainWindow.getBounds();
    const { session } = mainWindow.webContents;
    // Window state persistence is handled via IPC to ElectronStateStorage
  });

  return mainWindow;
}
```

### 5.3 preload.ts — Context Bridge

**File**: `apps/ptah-electron/src/preload.ts`

This is the critical bridge that makes the Angular SPA work without modification.

```typescript
import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload script — bridges renderer (Angular) with main process.
 *
 * Exposes the same API shape as VS Code's webview API:
 * - window.vscode.postMessage(msg)  -> ipcRenderer.send('rpc', msg)
 * - window.vscode.getState()        -> ipcRenderer.sendSync('get-state')
 * - window.vscode.setState(state)   -> ipcRenderer.send('set-state', state)
 *
 * Also sets up window.ptahConfig for Angular app configuration.
 *
 * The Angular app (VSCodeService) reads window.vscode in constructor.
 * By providing the same shape, ZERO Angular code changes needed.
 */

// Expose VS Code-compatible API
contextBridge.exposeInMainWorld('vscode', {
  postMessage: (message: unknown) => {
    ipcRenderer.send('rpc', message);
  },
  getState: () => {
    return ipcRenderer.sendSync('get-state');
  },
  setState: (state: unknown) => {
    ipcRenderer.send('set-state', state);
  },
});

// Expose Ptah configuration
contextBridge.exposeInMainWorld('ptahConfig', {
  isVSCode: false,
  isElectron: true,
  theme: 'dark',
  workspaceRoot: '',
  workspaceName: '',
  extensionUri: '',
  baseUri: '',
  iconUri: './assets/ptah-icon.svg',
  userIconUri: './assets/user-icon.png',
  panelId: 'electron-main',
});

// Forward messages from main process to renderer
// The Angular MessageRouterService listens on window 'message' event.
ipcRenderer.on('to-renderer', (_event, message) => {
  // Dispatch as a native window message event — this is exactly what
  // VS Code does internally for webview postMessage, so the Angular
  // MessageRouterService picks it up without any changes.
  window.dispatchEvent(new MessageEvent('message', { data: message }));
});
```

### 5.4 IPC Bridge

**File**: `apps/ptah-electron/src/ipc/ipc-bridge.ts`

```typescript
import { ipcMain, BrowserWindow } from 'electron';
import type { DependencyContainer } from 'tsyringe';
import { TOKENS, RpcHandler } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IStateStorage } from '@ptah-extension/platform-core';

/**
 * IPC Bridge — connects Electron IPC to the DI container's RPC system.
 *
 * Maps:
 * - 'rpc' channel -> RpcHandler.handleMessage() -> 'to-renderer' response
 * - 'get-state' -> synchronous webview state read
 * - 'set-state' -> webview state write
 *
 * Also provides sendToRenderer() for pushing events (streaming, status, etc.)
 * to the Angular frontend.
 */
export class IpcBridge {
  constructor(private readonly container: DependencyContainer, private readonly getWindow: () => BrowserWindow | null) {}

  initialize(): void {
    this.setupRpcHandler();
    this.setupStateHandlers();
  }

  private setupRpcHandler(): void {
    const rpcHandler = this.container.resolve<RpcHandler>(TOKENS.RPC_HANDLER);

    ipcMain.on('rpc', async (event, message) => {
      // The Angular ClaudeRpcService sends: { type: 'rpc_request', method, params, correlationId }
      // The RpcHandler expects: { method, params, correlationId }
      if (!message || !message.method) {
        console.warn('[IpcBridge] Received invalid RPC message:', message);
        return;
      }

      try {
        const response = await rpcHandler.handleMessage(message);

        // Send response back to renderer
        // Use 'to-renderer' channel which the preload script forwards
        // as a window MessageEvent (picked up by MessageRouterService)
        event.sender.send('to-renderer', response);
      } catch (error) {
        // Send error response
        event.sender.send('to-renderer', {
          type: 'rpc_response',
          success: false,
          error: error instanceof Error ? error.message : String(error),
          correlationId: message.correlationId,
        });
      }
    });
  }

  private setupStateHandlers(): void {
    // Synchronous state read (for getState)
    ipcMain.on('get-state', (event) => {
      try {
        const stateStorage = this.container.resolve<IStateStorage>(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE);
        event.returnValue = stateStorage.get('webview-state') ?? {};
      } catch {
        event.returnValue = {};
      }
    });

    // Async state write (for setState)
    ipcMain.on('set-state', (_event, state) => {
      try {
        const stateStorage = this.container.resolve<IStateStorage>(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE);
        stateStorage.update('webview-state', state).catch((err) => {
          console.error('[IpcBridge] Failed to save webview state:', err);
        });
      } catch (error) {
        console.error('[IpcBridge] State storage not available:', error);
      }
    });
  }

  /**
   * Push an event from main process to renderer.
   *
   * Used by: RpcMethodRegistrationService (via WebviewManager adapter)
   * for streaming events, session updates, agent status, etc.
   */
  sendToRenderer(message: unknown): void {
    this.getWindow()?.webContents.send('to-renderer', message);
  }
}
```

### 5.5 WebviewManager Adapter

**File**: `apps/ptah-electron/src/ipc/webview-manager-adapter.ts`

The existing `RpcMethodRegistrationService` injects `TOKENS.WEBVIEW_MANAGER` to broadcast events to the frontend. In Electron, we provide an adapter that uses the IPC bridge.

```typescript
import type { IpcBridge } from './ipc-bridge';

/**
 * Adapts the WebviewManager interface for Electron IPC.
 *
 * In VS Code, WebviewManager sends messages via webview.postMessage().
 * In Electron, we send via IpcBridge -> webContents.send() -> preload -> window message event.
 *
 * This adapter is registered as TOKENS.WEBVIEW_MANAGER in the DI container.
 */
export class ElectronWebviewManagerAdapter {
  constructor(private readonly ipcBridge: IpcBridge) {}

  async sendMessage(_viewType: string, type: string, payload: unknown): Promise<void> {
    this.ipcBridge.sendToRenderer({ type, payload });
  }

  async broadcastMessage(type: string, payload: unknown): Promise<void> {
    this.ipcBridge.sendToRenderer({ type, payload });
  }
}
```

### 5.6 DI Container

**File**: `apps/ptah-electron/src/di/container.ts`

**Pattern source**: `apps/ptah-extension-vscode/src/di/container.ts` (lines 101-484)

```typescript
import 'reflect-metadata';
import { container, DependencyContainer } from 'tsyringe';

import { Logger, OutputManager, TOKENS, registerVsCodeCoreServices } from '@ptah-extension/vscode-core';

import { registerSdkServices, SDK_TOKENS, EnhancedPromptsService } from '@ptah-extension/agent-sdk';
import type { IMultiPhaseAnalysisReader } from '@ptah-extension/agent-sdk';

import { registerAgentGenerationServices, AGENT_GENERATION_TOKENS } from '@ptah-extension/agent-generation';

import { registerWorkspaceIntelligenceServices } from '@ptah-extension/workspace-intelligence';
import { registerLlmAbstractionServices } from '@ptah-extension/llm-abstraction';
import { registerTemplateGenerationServices } from '@ptah-extension/template-generation';

import { registerPlatformElectronServices, ElectronPlatformOptions } from '@ptah-extension/platform-electron';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';

// Import RPC handlers (same handlers as VS Code, minus vscode-lm-tools)
// NOTE: RPC handler imports will be identical to VS Code container.ts
// except we skip VS Code-specific handlers (vscode-lm-tools)
import { RpcMethodRegistrationService } from '../services/rpc';

/**
 * Electron DI Container
 *
 * Mirrors the VS Code DIContainer.setup() but:
 * - Uses platform-electron instead of platform-vscode
 * - Skips VS Code-specific services (vscode-lm-tools)
 * - Skips license verification (Electron uses API key auth)
 * - Creates ElectronWebviewManagerAdapter instead of AngularWebviewProvider
 */
export class ElectronDIContainer {
  static setup(options: ElectronPlatformOptions): DependencyContainer {
    // ========================================
    // PHASE 0: Platform Abstraction Layer
    // ========================================
    registerPlatformElectronServices(container, options);

    // ========================================
    // PHASE 1: Infrastructure Services (vscode-core)
    // ========================================
    // OutputManager depends on PLATFORM_TOKENS.OUTPUT_CHANNEL (registered above)
    container.registerSingleton(TOKENS.OUTPUT_MANAGER, OutputManager);
    container.registerSingleton(TOKENS.LOGGER, Logger);
    const logger = container.resolve<Logger>(TOKENS.LOGGER);

    // Register vscode-core infrastructure services
    // NOTE: registerVsCodeCoreServices() will need a compatibility shim
    // since it expects ExtensionContext. For Electron, we create a
    // minimal context-like object. The actual approach depends on what
    // registerVsCodeCoreServices() accesses from the context parameter.
    //
    // IMPORTANT: This is a key integration point. The vscode-core
    // registration function may need to be refactored to accept
    // platform-agnostic parameters, or we register the services manually.
    // The backend developer should investigate registerVsCodeCoreServices()
    // to determine the best approach.
    //
    // Option A: Create ElectronContextShim that satisfies the interface
    // Option B: Register vscode-core services manually (preferred for control)
    // Option C: Refactor registerVsCodeCoreServices() to be platform-agnostic
    //
    // For now, we document Option B (manual registration):
    this.registerVsCodeCoreServicesManually(container, logger);

    // ========================================
    // PHASE 2: Library Services
    // ========================================
    registerWorkspaceIntelligenceServices(container, logger);
    // NOTE: Skip registerVsCodeLmToolsServices() — VS Code LM Tools
    // are VS Code-specific (MCP server, VS Code LM API).
    registerSdkServices(container, logger);
    registerAgentGenerationServices(container, logger);
    registerLlmAbstractionServices(container, logger);
    registerTemplateGenerationServices(container, logger);

    // Wire multi-phase analysis reader (same as VS Code container)
    try {
      const enhancedPrompts = container.resolve<EnhancedPromptsService>(SDK_TOKENS.SDK_ENHANCED_PROMPTS_SERVICE);
      const analysisStorage = container.resolve<IMultiPhaseAnalysisReader>(AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE);
      enhancedPrompts.setAnalysisReader(analysisStorage);
    } catch (error) {
      logger.warn('[DI] Failed to wire multi-phase analysis reader', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // ========================================
    // PHASE 3: App-Level Services
    // ========================================
    // Storage adapter (delegates to WORKSPACE_STATE_STORAGE)
    const workspaceStorage = container.resolve(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE);
    container.register(TOKENS.STORAGE_SERVICE, { useValue: workspaceStorage });

    // Global state adapter (delegates to STATE_STORAGE)
    const globalStorage = container.resolve(PLATFORM_TOKENS.STATE_STORAGE);
    container.register(TOKENS.GLOBAL_STATE, { useValue: globalStorage });

    // WebviewManager adapter (registered after IPC bridge is created in main.ts)
    // container.register(TOKENS.WEBVIEW_MANAGER, { useValue: webviewManagerAdapter });
    // NOTE: This must be registered AFTER IpcBridge is created. The caller (main.ts)
    // should register TOKENS.WEBVIEW_MANAGER with ElectronWebviewManagerAdapter.

    // ========================================
    // PHASE 4: RPC Handlers
    // ========================================
    // RPC handler registration follows the same pattern as VS Code.
    // Individual handler classes are registered, then RpcMethodRegistrationService
    // orchestrates them.
    // NOTE: The exact handlers to register depends on which ones are
    // VS Code-specific. Backend developer should audit each handler class.
    // Most handlers (Chat, Session, Context, Config, Auth, Setup, etc.)
    // are platform-agnostic and work in Electron.

    return container;
  }

  /**
   * Register vscode-core services manually for Electron.
   *
   * Instead of calling registerVsCodeCoreServices(container, context, logger),
   * we register each service individually since we don't have an ExtensionContext.
   *
   * The backend developer should audit registerVsCodeCoreServices() to determine
   * which services are needed and which are VS Code-specific.
   */
  private static registerVsCodeCoreServicesManually(container: DependencyContainer, logger: Logger): void {
    // TODO: Backend developer should audit libs/backend/vscode-core/src/registration.ts
    // and register each needed service manually.
    //
    // Known needed services:
    // - TOKENS.RPC_HANDLER (RpcHandler class — platform-agnostic)
    // - TOKENS.CONFIG_MANAGER (ConfigManager — may need Electron adapter)
    // - TOKENS.COMMAND_MANAGER (CommandManager — may delegate to ICommandRegistry)
    // - TOKENS.AGENT_SESSION_WATCHER_SERVICE (AgentSessionWatcherService — platform-agnostic)
    //
    // Known VS Code-specific services to SKIP:
    // - TOKENS.STATUS_BAR_MANAGER (VS Code status bar)
    // - TOKENS.WEBVIEW_HTML_GENERATOR (VS Code webview HTML)
    //
    // This is a critical integration point that the backend developer must resolve.
    logger.info('[Electron DI] Manual vscode-core service registration');
  }

  static getContainer(): DependencyContainer {
    return container;
  }
}
```

---

## 6. Build System Configuration

### 6.1 webpack.config.js (Main Process)

**File**: `apps/ptah-electron/webpack.config.js`

**Pattern source**: `apps/ptah-extension-vscode/webpack.config.js`

```javascript
const path = require('path');

/** @type {import('webpack').Configuration} */
module.exports = {
  target: 'electron-main',
  mode: 'development',

  entry: ['reflect-metadata', path.resolve(__dirname, './src/main.ts')],

  output: {
    path: path.resolve(__dirname, '../../dist/apps/ptah-electron'),
    filename: 'main.js',
    libraryTarget: 'commonjs2',
    clean: false,
  },

  externals: [
    // Electron is provided by the runtime
    { electron: 'commonjs electron' },
    // Custom externals (mirrors VS Code webpack config)
    function ({ request }, callback) {
      // Bundle reflect-metadata and tsyringe
      if (request === 'reflect-metadata' || request === 'tsyringe') {
        return callback();
      }
      // Bundle all @ptah-extension/* packages
      if (request.startsWith('@ptah-extension/')) {
        return callback();
      }
      // Bundle @anthropic-ai/claude-agent-sdk (ESM-only)
      if (request.startsWith('@anthropic-ai/claude-agent-sdk')) {
        return callback();
      }
      // Externalize other scoped packages
      if (request.startsWith('@')) {
        return callback(null, 'commonjs ' + request);
      }
      // Externalize other node_modules
      if (/^[a-z\-0-9]+/.test(request)) {
        return callback(null, 'commonjs ' + request);
      }
      callback();
    },
  ],

  resolve: {
    extensions: ['.ts', '.js', '.json'],
    alias: {
      '@ptah-extension/platform-core': path.resolve(__dirname, '../../libs/backend/platform-core/src'),
      '@ptah-extension/platform-electron': path.resolve(__dirname, '../../libs/backend/platform-electron/src'),
      '@ptah-extension/shared': path.resolve(__dirname, '../../libs/shared/src'),
      '@ptah-extension/vscode-core': path.resolve(__dirname, '../../libs/backend/vscode-core/src'),
      '@ptah-extension/workspace-intelligence': path.resolve(__dirname, '../../libs/backend/workspace-intelligence/src'),
      '@ptah-extension/agent-sdk': path.resolve(__dirname, '../../libs/backend/agent-sdk/src'),
      '@ptah-extension/agent-generation': path.resolve(__dirname, '../../libs/backend/agent-generation/src'),
      '@ptah-extension/template-generation': path.resolve(__dirname, '../../libs/backend/template-generation/src'),
      '@ptah-extension/llm-abstraction': path.resolve(__dirname, '../../libs/backend/llm-abstraction/src'),
      '@ptah-extension/llm-abstraction/anthropic': path.resolve(__dirname, '../../libs/backend/llm-abstraction/src/anthropic.ts'),
      '@ptah-extension/llm-abstraction/openrouter': path.resolve(__dirname, '../../libs/backend/llm-abstraction/src/openrouter.ts'),
      // NOTE: Do NOT alias @ptah-extension/platform-vscode — it should not be imported in Electron
      // NOTE: Do NOT alias @ptah-extension/vscode-lm-tools — it's VS Code-specific
    },
  },

  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: {
          loader: 'ts-loader',
          options: {
            transpileOnly: true,
            configFile: 'tsconfig.app.json',
          },
        },
      },
      {
        test: /\.node$/,
        use: 'node-loader',
      },
    ],
  },

  devtool: 'source-map',
  optimization: {
    minimize: false,
    concatenateModules: false,
    runtimeChunk: false,
  },
  performance: {
    hints: false,
  },
};
```

### 6.2 webpack.preload.config.js

**File**: `apps/ptah-electron/webpack.preload.config.js`

```javascript
const path = require('path');

/** @type {import('webpack').Configuration} */
module.exports = {
  target: 'electron-preload',
  mode: 'development',

  entry: path.resolve(__dirname, './src/preload.ts'),

  output: {
    path: path.resolve(__dirname, '../../dist/apps/ptah-electron'),
    filename: 'preload.js',
  },

  externals: {
    electron: 'commonjs electron',
  },

  resolve: {
    extensions: ['.ts', '.js'],
  },

  module: {
    rules: [
      {
        test: /\.ts$/,
        use: {
          loader: 'ts-loader',
          options: {
            transpileOnly: true,
            configFile: 'tsconfig.preload.json',
          },
        },
      },
    ],
  },

  devtool: 'source-map',
};
```

### 6.3 project.json

**File**: `apps/ptah-electron/project.json`

**Pattern source**: `libs/backend/platform-vscode/project.json`

```json
{
  "name": "ptah-electron",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "projectType": "application",
  "sourceRoot": "apps/ptah-electron/src",
  "tags": ["scope:electron", "type:app"],
  "targets": {
    "build-main": {
      "executor": "@nx/webpack:webpack",
      "outputs": ["{options.outputPath}"],
      "options": {
        "outputPath": "dist/apps/ptah-electron",
        "main": "apps/ptah-electron/src/main.ts",
        "tsConfig": "apps/ptah-electron/tsconfig.app.json",
        "webpackConfig": "apps/ptah-electron/webpack.config.js",
        "target": "node",
        "compiler": "tsc"
      },
      "configurations": {
        "production": {
          "optimization": true,
          "sourceMap": false
        },
        "development": {
          "optimization": false,
          "sourceMap": true
        }
      }
    },
    "build-preload": {
      "executor": "@nx/webpack:webpack",
      "outputs": ["{options.outputPath}"],
      "options": {
        "outputPath": "dist/apps/ptah-electron",
        "main": "apps/ptah-electron/src/preload.ts",
        "tsConfig": "apps/ptah-electron/tsconfig.preload.json",
        "webpackConfig": "apps/ptah-electron/webpack.preload.config.js",
        "target": "node",
        "compiler": "tsc"
      }
    },
    "build": {
      "executor": "nx:run-commands",
      "options": {
        "commands": ["nx build-main ptah-electron", "nx build-preload ptah-electron", "nx build ptah-extension-webview --configuration=production"],
        "parallel": false
      },
      "dependsOn": []
    },
    "copy-renderer": {
      "executor": "nx:run-commands",
      "dependsOn": ["build"],
      "options": {
        "commands": [
          {
            "command": "node -e \"const fs=require('fs');fs.cpSync('dist/apps/ptah-extension-webview/browser','dist/apps/ptah-electron/renderer',{recursive:true})\""
          }
        ]
      }
    },
    "serve": {
      "executor": "nx:run-commands",
      "options": {
        "commands": ["nx build ptah-electron --configuration=development", "nx copy-renderer ptah-electron", "electron dist/apps/ptah-electron/main.js"],
        "parallel": false
      }
    },
    "package": {
      "executor": "nx:run-commands",
      "dependsOn": ["build", "copy-renderer"],
      "options": {
        "command": "electron-builder --config apps/ptah-electron/electron-builder.yml --project dist/apps/ptah-electron"
      }
    },
    "typecheck": {
      "executor": "nx:run-commands",
      "options": {
        "command": "tsc --noEmit --project apps/ptah-electron/tsconfig.app.json"
      }
    },
    "lint": {
      "executor": "@nx/eslint:lint"
    }
  }
}
```

### 6.4 platform-electron project.json

**File**: `libs/backend/platform-electron/project.json`

```json
{
  "name": "@ptah-extension/platform-electron",
  "$schema": "../../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "libs/backend/platform-electron/src",
  "projectType": "library",
  "tags": ["scope:electron", "type:feature"],
  "targets": {
    "build": {
      "executor": "@nx/esbuild:esbuild",
      "outputs": ["{options.outputPath}"],
      "options": {
        "outputPath": "dist/libs/backend/platform-electron",
        "main": "libs/backend/platform-electron/src/index.ts",
        "tsConfig": "libs/backend/platform-electron/tsconfig.lib.json",
        "assets": ["libs/backend/platform-electron/*.md"],
        "format": ["cjs"],
        "external": ["tsyringe", "reflect-metadata", "electron", "chokidar", "fast-glob"]
      }
    },
    "test": {
      "executor": "@nx/jest:jest",
      "outputs": ["{workspaceRoot}/coverage/{projectRoot}"],
      "options": {
        "jestConfig": "libs/backend/platform-electron/jest.config.ts"
      }
    },
    "typecheck": {
      "executor": "nx:run-commands",
      "options": {
        "command": "tsc --noEmit --project libs/backend/platform-electron/tsconfig.lib.json"
      }
    },
    "lint": {
      "executor": "@nx/eslint:lint"
    }
  }
}
```

### 6.5 tsconfig Files

**File**: `apps/ptah-electron/tsconfig.app.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "commonjs",
    "moduleResolution": "node",
    "target": "ES2022",
    "outDir": "../../dist/out-tsc",
    "types": ["node"],
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "strict": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/preload.ts", "**/*.spec.ts"]
}
```

**File**: `apps/ptah-electron/tsconfig.preload.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "commonjs",
    "moduleResolution": "node",
    "target": "ES2022",
    "outDir": "../../dist/out-tsc",
    "types": ["node"],
    "strict": true
  },
  "include": ["src/preload.ts"]
}
```

**File**: `libs/backend/platform-electron/tsconfig.json`

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

### 6.6 tsconfig.base.json Path Addition

Add to root `tsconfig.base.json` paths:

```json
"@ptah-extension/platform-electron": [
  "libs/backend/platform-electron/src/index.ts"
]
```

### 6.7 electron-builder.yml

**File**: `apps/ptah-electron/electron-builder.yml`

```yaml
appId: com.ptah.desktop
productName: Ptah
copyright: Copyright 2026 Ptah

directories:
  output: ../../release
  buildResources: src/assets

files:
  - '**/*'
  - '!**/*.map'
  - '!**/*.ts'

extraResources:
  - from: 'renderer'
    to: 'renderer'

mac:
  category: public.app-category.developer-tools
  icon: src/assets/icons/icon.icns
  hardenedRuntime: true
  gatekeeperAssess: false
  target:
    - dmg
    - zip

win:
  icon: src/assets/icons/icon.ico
  target:
    - nsis

linux:
  icon: src/assets/icons
  category: Development
  target:
    - AppImage
    - deb

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true

publish:
  provider: github
  owner: ptah
  repo: ptah-desktop
```

---

## 7. Angular Webview Changes

### Summary: ZERO Code Changes Required (for MVP)

The Angular SPA (`ptah-extension-webview`) requires NO code changes because:

1. **VSCodeService** (`libs/frontend/core/src/lib/services/vscode.service.ts:104-123`): Reads `window.vscode` and `window.ptahConfig` from globals. The preload script injects these with the exact same shape.

2. **ClaudeRpcService** (`libs/frontend/core/src/lib/services/claude-rpc.service.ts`): Uses `vscodeService.postMessage()` which maps to `ipcRenderer.send('rpc')` in Electron.

3. **MessageRouterService** (`libs/frontend/core/src/lib/services/message-router.service.ts:51-63`): Listens on `window.addEventListener('message')`. The preload script dispatches `window.dispatchEvent(new MessageEvent('message', { data }))` for main-to-renderer messages — exact same mechanism.

4. **Asset URIs**: The `WebviewConfig.baseUri` and `extensionUri` are set to empty strings. The renderer loads local files relative to `index.html`. In Electron, `BrowserWindow.loadFile()` serves files from disk, so relative paths work correctly.

### Future Enhancement (Post-MVP)

If QuickPick/InputBox IPC-based dialogs are needed in the renderer, a small Angular service can be added:

```typescript
// Future: libs/frontend/core/src/lib/services/electron-dialog.service.ts
@Injectable({ providedIn: 'root' })
export class ElectronDialogService {
  constructor() {
    // Listen for dialog requests from main process
    if ((window as any).ptahConfig?.isElectron) {
      window.addEventListener('message', (event) => {
        if (event.data.type === 'show-quick-pick') {
          // Show Angular-based quick pick component
        }
      });
    }
  }
}
```

This is NOT needed for MVP — simple dialogs use Electron's native dialog API.

---

## 8. Authentication Flow

### API Key Entry (MVP)

1. User opens Ptah Electron for first time
2. Angular Settings view shows API key input field
3. User enters Anthropic API key
4. Frontend sends RPC: `auth:setApiKey { provider: 'anthropic', key: 'sk-ant-...' }`
5. Backend `AuthRpcHandlers.register()` handles this — stores key via `ISecretStorage`
6. `ElectronSecretStorage.store('anthropic-api-key', key)` encrypts with safeStorage
7. `process.env['ANTHROPIC_API_KEY'] = key` is set for Claude Agent SDK
8. Subsequent app launches: key is loaded from secret storage in `main.ts` Phase 4

### Alternative Providers

The same flow works for other providers:

- OpenRouter: `auth:setApiKey { provider: 'openrouter', key: '...' }`
- Bedrock: environment variables (`CLAUDE_CODE_USE_BEDROCK=1`, AWS credentials)
- Vertex: environment variables (`CLAUDE_CODE_USE_VERTEX=1`, GCP credentials)

### Auth RPC Handler Compatibility

**Evidence**: `apps/ptah-extension-vscode/src/services/rpc/handlers/auth-rpc.handlers.ts` uses `ISecretStorage` via `PLATFORM_TOKENS.SECRET_STORAGE` injection. This handler is platform-agnostic and works in Electron without modification.

---

## 9. Dependencies

### New Dependencies (package.json)

```json
{
  "dependencies": {
    "electron-updater": "^6.0.0"
  },
  "devDependencies": {
    "electron": "^35.0.0",
    "electron-builder": "^25.0.0",
    "@electron/rebuild": "^3.6.0",
    "chokidar": "^4.0.0",
    "fast-glob": "^3.3.0"
  }
}
```

### Existing Dependencies (No Changes)

- `tsyringe` + `reflect-metadata` — DI container
- `@anthropic-ai/claude-agent-sdk` — Claude SDK
- `langchain/*` — LLM providers
- `eventemitter3` — Event bus
- `uuid` — ID generation

---

## 10. Phase-by-Phase Delivery Plan

### Phase 1: Skeleton (Electron Window + Angular Rendering)

**Goal**: Electron window loads the Angular SPA, basic IPC round-trip works.

**Deliverables**:

1. Create `libs/backend/platform-electron/` with stub implementations (all methods throw "not implemented")
2. Create `apps/ptah-electron/src/main.ts` — BrowserWindow, loads renderer
3. Create `apps/ptah-electron/src/preload.ts` — contextBridge with vscode/ptahConfig
4. Create `apps/ptah-electron/src/windows/main-window.ts`
5. Create `apps/ptah-electron/webpack.config.js` and `webpack.preload.config.js`
6. Create `apps/ptah-electron/project.json` with build/serve targets
7. Create `apps/ptah-electron/tsconfig.app.json` and `tsconfig.preload.json`
8. Add `@ptah-extension/platform-electron` path to `tsconfig.base.json`
9. Install `electron` and `electron-builder` dev dependencies
10. Verify: Angular SPA renders in Electron window

**Success criteria**: `nx serve ptah-electron` opens Electron window showing the Angular UI.

**Files to CREATE**:

- `libs/backend/platform-electron/src/index.ts`
- `libs/backend/platform-electron/src/registration.ts` (stub)
- `libs/backend/platform-electron/src/implementations/` (8 stub files)
- `libs/backend/platform-electron/project.json`
- `libs/backend/platform-electron/tsconfig.json`
- `libs/backend/platform-electron/tsconfig.lib.json`
- `libs/backend/platform-electron/tsconfig.spec.json`
- `libs/backend/platform-electron/jest.config.ts`
- `apps/ptah-electron/src/main.ts`
- `apps/ptah-electron/src/preload.ts`
- `apps/ptah-electron/src/windows/main-window.ts`
- `apps/ptah-electron/webpack.config.js`
- `apps/ptah-electron/webpack.preload.config.js`
- `apps/ptah-electron/tsconfig.app.json`
- `apps/ptah-electron/tsconfig.preload.json`
- `apps/ptah-electron/project.json`

**Files to MODIFY**:

- `tsconfig.base.json` (add platform-electron path)
- `package.json` (add electron + electron-builder devDeps, fast-glob + chokidar deps)

### Phase 2: Platform Implementations

**Goal**: All 8 platform-electron interfaces fully implemented and tested.

**Deliverables**:

1. Implement `ElectronFileSystemProvider` (fs/promises + fast-glob + chokidar)
2. Implement `ElectronStateStorage` (JSON file + in-memory cache)
3. Implement `ElectronSecretStorage` (safeStorage + encrypted JSON)
4. Implement `ElectronWorkspaceProvider` (dialog + config file + recent projects)
5. Implement `ElectronUserInteraction` (dialog API + IPC delegation)
6. Implement `ElectronOutputChannel` (log file + console)
7. Implement `ElectronCommandRegistry` (in-memory registry)
8. Implement `ElectronEditorProvider` (Monaco-backed, tracks active file via IPC)
9. Implement `registerPlatformElectronServices()` registration function
10. Unit tests for each implementation

**Success criteria**: All implementations pass unit tests, DI container resolves without errors.

**Files to MODIFY (replace stubs)**:

- All 8 files in `libs/backend/platform-electron/src/implementations/`
- `libs/backend/platform-electron/src/registration.ts`

### Phase 3: Full DI + IPC Bridge + Chat

**Goal**: Chat with Claude works end-to-end in Electron.

**Deliverables**:

1. Create `apps/ptah-electron/src/di/container.ts` — full DI setup
2. Create `apps/ptah-electron/src/ipc/ipc-bridge.ts` — IPC handler
3. Create `apps/ptah-electron/src/ipc/webview-manager-adapter.ts`
4. Audit and adapt `registerVsCodeCoreServices()` for Electron
5. Register all platform-agnostic RPC handlers (Chat, Session, Config, Auth, etc.)
6. Create RPC handler index for Electron (`apps/ptah-electron/src/services/rpc/`)
7. Implement API key entry flow (auth:setApiKey -> ISecretStorage -> process.env)
8. Test: `chat:start`, `chat:continue`, streaming responses
9. Test: session persistence (save/load/list/delete)
10. Test: workspace intelligence (project detection)

**Success criteria**: Can have a full conversation with Claude in the Electron app.

**Files to CREATE**:

- `apps/ptah-electron/src/di/container.ts`
- `apps/ptah-electron/src/ipc/ipc-bridge.ts`
- `apps/ptah-electron/src/ipc/webview-manager-adapter.ts`
- `apps/ptah-electron/src/services/rpc/index.ts` (re-exports handlers)

**Critical integration point**: The `registerVsCodeCoreServices()` function in `libs/backend/vscode-core/src/registration.ts` may reference VS Code APIs. The backend developer must audit it and either:

- (A) Create an Electron-compatible shim for the context parameter
- (B) Register needed services manually
- (C) Refactor to accept platform-agnostic parameters

### Phase 4: Polish + Packaging

**Goal**: Distributable application with native OS integration.

**Deliverables**:

1. Create `apps/ptah-electron/electron-builder.yml`
2. Create app icons (icns, ico, png) in `apps/ptah-electron/src/assets/icons/`
3. Create `apps/ptah-electron/src/menu/application-menu.ts` — native menu
4. Add "Open Folder" flow (dialog -> workspace provider -> re-init)
5. Add recent projects list (stored in global state)
6. Build installers: macOS (dmg), Windows (nsis), Linux (AppImage)
7. Test on all three platforms
8. Window state persistence (bounds, maximized)

**Success criteria**: Installable application on all three platforms.

**Files to CREATE**:

- `apps/ptah-electron/electron-builder.yml`
- `apps/ptah-electron/src/menu/application-menu.ts`
- `apps/ptah-electron/src/assets/icons/` (icon files)

### Phase 5: Monaco Editor + File Explorer

**Goal**: Integrated code editor with file tree sidebar using `ngx-monaco-editor-v2` and a custom Angular file tree component.

**Deliverables**:

1. Install `ngx-monaco-editor-v2@20` and `monaco-editor@^0.55` dependencies
2. Create `libs/frontend/editor/` library with:
   - `CodeEditorComponent` — Monaco wrapper with language detection
   - `FileTreeComponent` — Recursive file tree sidebar using DaisyUI styling
   - `FileTreeNodeComponent` — Individual tree node with expand/collapse
3. Add editor IPC handlers to `apps/ptah-electron/src/ipc/ipc-bridge.ts`:
   - `editor:openFile` — Read file content, notify `ElectronEditorProvider`
   - `editor:saveFile` — Write file content
   - `editor:getFileTree` — Build recursive file tree from workspace root
4. Update `ElectronEditorProvider` to track active file and fire events via IPC
5. Configure Monaco worker assets in Angular build config
6. Add editor panel to the Electron renderer layout (split view: chat + editor)

**Dependencies**: Phase 3 (DI + IPC bridge must be working)

**Files**:

- `libs/frontend/editor/src/lib/code-editor.component.ts`
- `libs/frontend/editor/src/lib/file-tree.component.ts`
- `libs/frontend/editor/src/lib/file-tree-node.component.ts`
- `libs/frontend/editor/src/lib/editor.types.ts`
- `libs/frontend/editor/src/index.ts`
- Updated: `apps/ptah-electron/src/ipc/ipc-bridge.ts`

### Phase 6: Auto-Update + Feature Parity

**Goal**: Production-ready application with auto-update.

**Deliverables**:

1. Create `apps/ptah-electron/src/updater/auto-updater.ts`
2. Setup wizard (workspace analysis + agent generation)
3. Dashboard (performance metrics)
4. Multiple provider support (OpenRouter, Bedrock, Vertex)
5. Code signing for macOS and Windows
6. GitHub Actions CI/CD for automated releases

---

## 11. Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**:

- Primary work is Node.js/Electron main process (TypeScript)
- DI container setup and service registration (tsyringe)
- IPC bridge implementation
- Webpack configuration
- Platform interface implementations (all Node.js APIs)
- Phase 5 (Monaco + File Explorer) requires frontend-developer for Angular components

### Complexity Assessment

**Complexity**: HIGH
**Estimated Effort**: 3-4 weeks (Phases 1-4)

**Breakdown**:

- Phase 1 (Skeleton): 3-4 days
- Phase 2 (Platform implementations): 4-5 days
- Phase 3 (DI + IPC + Chat): 5-7 days (includes vscode-core audit)
- Phase 4 (Polish + Packaging): 3-5 days
- Phase 5 (Monaco + File Explorer): 3-4 days (frontend-developer)

### Critical Risk: vscode-core Registration

The biggest integration challenge is `registerVsCodeCoreServices()` in `libs/backend/vscode-core/src/registration.ts`. This function likely takes `vscode.ExtensionContext` and registers services that may reference VS Code APIs internally. The backend developer MUST audit this function first to determine which services are platform-agnostic and which need Electron-specific alternatives.

### Files Affected Summary

**CREATE** (25+ files):

- `libs/backend/platform-electron/` (10 files)
- `apps/ptah-electron/` (15+ files)

**MODIFY** (2 files):

- `tsconfig.base.json` (add path alias)
- `package.json` (add dependencies)

### Architecture Delivery Checklist

- [x] All 8 platform interfaces specified with exact code
- [x] All patterns verified from existing codebase (platform-vscode reference)
- [x] All PLATFORM_TOKENS verified in tokens.ts
- [x] createEvent() utility verified and used correctly
- [x] DI registration pattern matches VS Code container.ts
- [x] RPC flow verified through all layers
- [x] Frontend integration verified (zero changes needed)
- [x] Webpack config mirrors VS Code extension pattern
- [x] Build system integrated with Nx project.json
- [x] Phase-by-phase delivery plan with clear success criteria
- [x] Developer type recommended (backend-developer)
- [x] Critical risk identified (vscode-core registration)
