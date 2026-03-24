# Research Report: Electron Application Architecture for Ptah

## TASK_2025_200 | Research Classification: STRATEGIC_ANALYSIS

**Researcher**: researcher-expert
**Date**: 2026-03-16
**Confidence Level**: 90% (based on 15+ primary sources, codebase analysis, official docs)
**Key Insight**: The platform abstraction layer (TASK_2025_199) makes Electron integration architecturally straightforward -- the main complexity lies in IPC bridging and build toolchain, not in service porting.

---

## 1. Executive Summary

Ptah's existing architecture is exceptionally well-positioned for an Electron port. The platform-core abstraction (8 interfaces, DI tokens, PlatformType enum with `Electron` already defined) means backend services can run in Electron's main process with zero code changes -- only new `platform-electron` implementations need to be written. The Angular SPA (`ptah-extension-webview`) can serve as the Electron renderer with minimal changes: replacing VS Code's `postMessage` with Electron's `contextBridge`/`ipcRenderer` in a single service (`VSCodeService`).

**Recommended approach**:

- Use **custom Nx project** (no nx-electron plugin) with Webpack for the main process
- Use **electron-builder** for packaging/distribution (more mature, wider ecosystem)
- Use **Electron v35+** (LTS, supports `safeStorage`, `contextBridge`, service worker preloads)
- Reuse the Angular SPA build output directly as the renderer
- Implement `platform-electron` as a new Nx library (`libs/backend/platform-electron`)
- Bridge IPC using `contextBridge` + preload script matching the existing RPC contract

**Estimated effort**: 3-4 weeks for MVP (chat + single provider), 6-8 weeks for full feature parity.

---

## 2. Nx + Electron Integration

### Options Compared

| Approach                        | Maturity | Nx Compat | Flexibility | Maintenance Risk                |
| ------------------------------- | -------- | --------- | ----------- | ------------------------------- |
| `nx-electron` plugin (bennymeg) | Medium   | Nx 21-23  | Low         | Medium -- single maintainer     |
| `@matheo/nx-electron`           | Low      | Nx 18-20  | Low         | High -- stale                   |
| Custom Nx project (recommended) | High     | Any Nx    | High        | Low -- you control it           |
| No Nx (standalone Electron)     | N/A      | N/A       | High        | Low but loses monorepo benefits |

### Recommendation: Custom Nx Project

The `nx-electron` plugin adds overhead and constraints without significant value for Ptah. Since Ptah already has a sophisticated Webpack + Nx setup for the VS Code extension, replicating that pattern for Electron is straightforward and gives full control.

### Recommended project.json

```json
{
  "name": "ptah-electron",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "projectType": "application",
  "sourceRoot": "apps/ptah-electron/src",
  "tags": ["scope:electron", "type:app"],
  "targets": {
    "build": {
      "executor": "@nx/webpack:webpack",
      "outputs": ["{options.outputPath}"],
      "options": {
        "outputPath": "dist/apps/ptah-electron",
        "main": "apps/ptah-electron/src/main.ts",
        "tsConfig": "apps/ptah-electron/tsconfig.app.json",
        "webpackConfig": "apps/ptah-electron/webpack.config.js",
        "target": "node",
        "compiler": "tsc",
        "assets": ["apps/ptah-electron/src/preload.ts", "apps/ptah-electron/src/assets"]
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
    "serve": {
      "executor": "nx:run-commands",
      "options": {
        "commands": ["nx build ptah-electron --configuration=development --watch", "electron dist/apps/ptah-electron/main.js"],
        "parallel": true
      }
    },
    "package": {
      "executor": "nx:run-commands",
      "options": {
        "command": "electron-builder --config electron-builder.yml",
        "cwd": "dist/apps/ptah-electron"
      },
      "dependsOn": ["build", "^build"]
    }
  }
}
```

### Directory Structure

```
apps/ptah-electron/
  src/
    main.ts              # Electron main process entry
    preload.ts           # contextBridge preload script
    di/
      container.ts       # DI container (mirrors VS Code container.ts)
    windows/
      main-window.ts     # BrowserWindow management
    ipc/
      ipc-bridge.ts      # IPC handler registration (maps RPC methods)
    assets/
      icons/             # App icons (icns, ico, png)
  webpack.config.js      # Webpack config for main process
  tsconfig.app.json
  project.json
  electron-builder.yml   # Packaging config
```

---

## 3. Angular Renderer Strategy

### How Reuse Works

The Angular SPA (`ptah-extension-webview`) builds to static files:

```
dist/apps/ptah-extension-webview/browser/
  index.html
  main-*.js
  styles-*.css
  polyfills-*.js
```

Electron's `BrowserWindow.loadFile()` can load this directly. No Angular code changes are needed for the renderer -- the abstraction point is `VSCodeService`, which currently checks `window.vscode` for the communication API.

### What Changes in the Angular App

**Almost nothing.** The key insight is that the Angular app already has a mock mode (see `main.ts` -- `initializeMockEnvironment()`). For Electron, we inject a similar API through the preload script:

```typescript
// preload.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('vscode', {
  postMessage: (message: unknown) => {
    ipcRenderer.send('rpc-message', message);
  },
  getState: () => {
    return ipcRenderer.sendSync('get-state');
  },
  setState: (state: unknown) => {
    ipcRenderer.send('set-state', state);
  },
});

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
});
```

The Angular `VSCodeService` already checks `window.vscode` and `window.ptahConfig` at initialization. By exposing the same shape via `contextBridge`, the entire Angular app works without modification. The `postMessage` calls from the frontend flow through `ipcRenderer.send()` instead of VS Code's webview postMessage.

### Receiving Messages from Main Process

The preload script also needs to forward messages from main to renderer:

```typescript
// preload.ts (addition)
contextBridge.exposeInMainWorld('electronBridge', {
  onMessage: (callback: (message: unknown) => void) => {
    ipcRenderer.on('rpc-response', (_event, message) => {
      callback(message);
    });
  },
});
```

In the Angular app, the `MessageRouterService` needs a one-line addition to listen for Electron messages alongside VS Code messages:

```typescript
// In MessageRouterService initialization
if ((window as any).electronBridge) {
  (window as any).electronBridge.onMessage((message: unknown) => {
    // Route through existing message handling
    this.handleIncomingMessage(message);
  });
}
```

### Build Integration

The Electron app's build target should depend on the webview build:

```json
"build": {
  "dependsOn": [
    { "projects": ["ptah-extension-webview"], "target": "build" }
  ]
}
```

After both builds complete, copy the webview output into the Electron dist:

```
dist/apps/ptah-electron/
  main.js           # Electron main process
  preload.js         # Preload script
  renderer/          # <- copied from dist/apps/ptah-extension-webview/browser/
    index.html
    main-*.js
    styles-*.css
```

---

## 4. Platform-Electron Architecture

Each of the 8 platform-core interfaces has a concrete Electron implementation. Here is the implementation plan for `libs/backend/platform-electron`:

### 4.1 IFileSystemProvider -- Node.js `fs/promises`

**Complexity**: Low
**Approach**: Direct mapping to Node.js `fs/promises` API.

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'node:fs/promises'; // Node 22+
import chokidar from 'chokidar';

export class ElectronFileSystemProvider implements IFileSystemProvider {
  async readFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, 'utf-8');
  }

  async readFileBytes(filePath: string): Promise<Uint8Array> {
    const buffer = await fs.readFile(filePath);
    return new Uint8Array(buffer);
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async findFiles(pattern: string, exclude?: string, maxResults?: number): Promise<string[]> {
    // Use fast-glob (more reliable than Node built-in for complex patterns)
    const fg = require('fast-glob');
    return fg(pattern, { ignore: exclude ? [exclude] : [], cwd: process.cwd() });
  }

  createFileWatcher(pattern: string): IFileWatcher {
    const watcher = chokidar.watch(pattern);
    // Map chokidar events to IFileWatcher interface
    // ...
  }
}
```

**Key dependency**: `chokidar` v4+ (ESM-only, no built-in glob -- use `fast-glob` separately for `findFiles`).

### 4.2 IStateStorage -- JSON File Persistence

**Complexity**: Low
**Approach**: JSON file with in-memory cache. `electron-store` is the obvious choice but is now ESM-only (requires Electron 30+). A simpler custom implementation avoids the ESM compatibility issue.

```typescript
export class ElectronStateStorage implements IStateStorage {
  private data: Record<string, unknown> = {};
  private filePath: string;

  constructor(storagePath: string, filename: string) {
    this.filePath = path.join(storagePath, filename);
    this.loadSync();
  }

  get<T>(key: string, defaultValue?: T): T | undefined {
    return (this.data[key] as T) ?? defaultValue;
  }

  async update(key: string, value: unknown): Promise<void> {
    this.data[key] = value;
    await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2));
  }

  keys(): readonly string[] {
    return Object.keys(this.data);
  }

  private loadSync(): void {
    try {
      const raw = require('fs').readFileSync(this.filePath, 'utf-8');
      this.data = JSON.parse(raw);
    } catch {
      this.data = {};
    }
  }
}
```

**Alternative**: If ESM is acceptable in the main process, use `electron-store` directly -- it provides schema validation, defaults, migrations, and change watching out of the box.

### 4.3 ISecretStorage -- Electron `safeStorage`

**Complexity**: Medium
**Approach**: Use Electron's built-in `safeStorage` API. Keytar is deprecated (unmaintained since Dec 2022). VS Code itself has migrated to `safeStorage`.

```typescript
import { safeStorage } from 'electron';

export class ElectronSecretStorage implements ISecretStorage {
  private filePath: string; // Encrypted secrets stored in a JSON file
  private secrets: Record<string, Buffer> = {};
  private changeEmitter = new EventEmitter();

  async get(key: string): Promise<string | undefined> {
    const encrypted = this.secrets[key];
    if (!encrypted) return undefined;
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Encryption not available');
    }
    return safeStorage.decryptString(Buffer.from(encrypted));
  }

  async store(key: string, value: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Encryption not available');
    }
    this.secrets[key] = safeStorage.encryptString(value);
    await this.persist();
    this.changeEmitter.emit('change', { key });
  }

  async delete(key: string): Promise<void> {
    delete this.secrets[key];
    await this.persist();
    this.changeEmitter.emit('change', { key });
  }

  readonly onDidChange: IEvent<SecretChangeEvent> = (listener) => {
    this.changeEmitter.on('change', listener);
    return { dispose: () => this.changeEmitter.off('change', listener) };
  };
}
```

**Platform notes**:

- Windows: Uses DPAPI (per-user encryption)
- macOS: Uses Keychain
- Linux: Uses gnome-libsecret, kwallet, or kwallet5/6

**Important**: `safeStorage` is only available after `app.ready` event. The DI container setup must wait for this.

### 4.4 IWorkspaceProvider -- File Dialogs + Recent Projects

**Complexity**: Medium
**Approach**: Workspace = opened folder(s). Use `dialog.showOpenDialog()` for folder selection. Store recent projects in state storage. Configuration via JSON config file.

```typescript
import { dialog, app } from 'electron';

export class ElectronWorkspaceProvider implements IWorkspaceProvider {
  private folders: string[] = [];
  private config: Record<string, Record<string, unknown>> = {};
  private changeEmitter = new EventEmitter();

  getWorkspaceFolders(): string[] {
    return [...this.folders];
  }

  getWorkspaceRoot(): string | undefined {
    return this.folders[0];
  }

  getConfiguration<T>(section: string, key: string, defaultValue?: T): T | undefined {
    return (this.config[section]?.[key] as T) ?? defaultValue;
  }

  // Called when user opens a folder
  async openFolder(): Promise<void> {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    if (!result.canceled && result.filePaths.length > 0) {
      this.folders = result.filePaths;
      this.changeEmitter.emit('workspaceFoldersChanged');
    }
  }

  readonly onDidChangeConfiguration: IEvent<ConfigurationChangeEvent> = createEvent();
  readonly onDidChangeWorkspaceFolders: IEvent<void> = (listener) => {
    this.changeEmitter.on('workspaceFoldersChanged', listener);
    return { dispose: () => this.changeEmitter.off('workspaceFoldersChanged', listener) };
  };
}
```

### 4.5 IUserInteraction -- Electron `dialog` API

**Complexity**: Low
**Approach**: Map to Electron's `dialog` module for native dialogs, plus custom renderer-based UI for quick pick and input box.

```typescript
import { dialog, BrowserWindow } from 'electron';

export class ElectronUserInteraction implements IUserInteraction {
  constructor(private getWindow: () => BrowserWindow | null) {}

  async showErrorMessage(message: string, ...actions: string[]): Promise<string | undefined> {
    const result = await dialog.showMessageBox(this.getWindow()!, {
      type: 'error',
      message,
      buttons: actions.length ? actions : ['OK'],
    });
    return actions[result.response];
  }

  async showWarningMessage(message: string, ...actions: string[]): Promise<string | undefined> {
    const result = await dialog.showMessageBox(this.getWindow()!, {
      type: 'warning',
      message,
      buttons: actions.length ? actions : ['OK'],
    });
    return actions[result.response];
  }

  async showInformationMessage(message: string, ...actions: string[]): Promise<string | undefined> {
    const result = await dialog.showMessageBox(this.getWindow()!, {
      type: 'info',
      message,
      buttons: actions.length ? actions : ['OK'],
    });
    return actions[result.response];
  }

  // QuickPick and InputBox -> delegate to renderer via IPC
  async showQuickPick(items: QuickPickItem[], options?: QuickPickOptions): Promise<QuickPickItem | undefined> {
    // Send IPC to renderer to show Angular-based quick pick UI
    // This can reuse existing DaisyUI dropdown components
  }

  async showInputBox(options?: InputBoxOptions): Promise<string | undefined> {
    // Send IPC to renderer to show Angular-based input dialog
  }

  async withProgress<T>(options: ProgressOptions, task: (progress: IProgress) => Promise<T>): Promise<T> {
    // Send progress updates to renderer via IPC
    const progress: IProgress = {
      report: (value) => {
        this.getWindow()?.webContents.send('progress-update', { ...options, ...value });
      },
    };
    return task(progress);
  }
}
```

### 4.6 IOutputChannel -- Log File + Console

**Complexity**: Low
**Approach**: Write to a log file (in userData) and console. Optionally forward to renderer for an in-app log viewer.

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export class ElectronOutputChannel implements IOutputChannel {
  readonly name: string;
  private logStream: fs.WriteStream;

  constructor(name: string) {
    this.name = name;
    const logPath = path.join(app.getPath('logs'), `${name}.log`);
    this.logStream = fs.createWriteStream(logPath, { flags: 'a' });
  }

  appendLine(message: string): void {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    this.logStream.write(line);
    console.log(`[${this.name}] ${message}`);
  }

  append(message: string): void {
    this.logStream.write(message);
  }

  clear(): void {
    // Truncate log file
  }

  show(): void {
    // Could open log file in default editor or send to renderer
  }

  dispose(): void {
    this.logStream.end();
  }
}
```

### 4.7 ICommandRegistry -- Menu + Accelerators

**Complexity**: Medium
**Approach**: Map commands to Electron menu items and keyboard shortcuts. Maintain an in-memory registry for programmatic execution.

```typescript
import { Menu, MenuItem, globalShortcut } from 'electron';

export class ElectronCommandRegistry implements ICommandRegistry {
  private commands = new Map<string, (...args: unknown[]) => unknown>();

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
    if (!handler) throw new Error(`Command not found: ${id}`);
    return handler(...args) as T;
  }
}
```

### 4.8 IEditorProvider -- Null Implementation (MVP) / Monaco (Later)

**Complexity**: Low (null) / High (Monaco)
**Approach for MVP**: Return null/no-op. The Electron app is a chat-first experience. File editing is not the primary use case.

```typescript
export class ElectronEditorProvider implements IEditorProvider {
  readonly onDidChangeActiveEditor: IEvent<{ filePath: string | undefined }> = createEvent();
  readonly onDidOpenDocument: IEvent<{ filePath: string }> = createEvent();

  getActiveEditorPath(): string | undefined {
    return undefined; // No built-in editor in MVP
  }
}
```

**Future**: Integrate Monaco Editor as an Angular component in the renderer for file viewing/editing.

### Registration Function

```typescript
// libs/backend/platform-electron/src/registration.ts
import { DependencyContainer } from 'tsyringe';
import { PLATFORM_TOKENS, PlatformType, IPlatformInfo } from '@ptah-extension/platform-core';
import { app } from 'electron';

export function registerPlatformElectronServices(container: DependencyContainer, workspaceFolders: string[]): void {
  const platformInfo: IPlatformInfo = {
    type: PlatformType.Electron,
    extensionPath: app.getAppPath(),
    globalStoragePath: app.getPath('userData'),
    workspaceStoragePath: path.join(app.getPath('userData'), 'workspace-storage'),
  };

  container.register(PLATFORM_TOKENS.PLATFORM_INFO, { useValue: platformInfo });
  container.register(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER, {
    useValue: new ElectronFileSystemProvider(),
  });
  container.register(PLATFORM_TOKENS.STATE_STORAGE, {
    useValue: new ElectronStateStorage(platformInfo.globalStoragePath, 'global-state.json'),
  });
  container.register(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE, {
    useValue: new ElectronStateStorage(platformInfo.workspaceStoragePath, 'workspace-state.json'),
  });
  container.register(PLATFORM_TOKENS.SECRET_STORAGE, {
    useValue: new ElectronSecretStorage(platformInfo.globalStoragePath),
  });
  // ... remaining registrations follow the same pattern
}
```

---

## 5. IPC Bridge Design

### Architecture

The IPC bridge connects the Angular renderer with Electron's main process, matching the existing RPC contract defined in `rpc.types.ts`.

```
Angular Renderer                    Preload Script               Electron Main Process
+-----------------+                +----------------+            +-------------------+
| ClaudeRpcService|--postMessage-->| contextBridge  |--ipcSend-->| IpcBridge         |
|                 |                | (vscode.post   |            | (RpcHandler)      |
|                 |<--onMessage----|  Message)      |<-ipcSend---|                   |
+-----------------+                +----------------+            +-------------------+
                                                                        |
                                                                 DI Container
                                                                 (all services)
```

### IPC Bridge Implementation (Main Process)

```typescript
// apps/ptah-electron/src/ipc/ipc-bridge.ts
import { ipcMain, BrowserWindow } from 'electron';
import { DependencyContainer } from 'tsyringe';

export class IpcBridge {
  constructor(private container: DependencyContainer, private getWindow: () => BrowserWindow | null) {}

  initialize(): void {
    // Handle RPC calls from renderer
    ipcMain.on('rpc-message', async (event, message) => {
      if (message.type === 'rpc_call') {
        const { method, params, correlationId } = message.payload;
        try {
          // Resolve the RPC handler and invoke the method
          const rpcHandler = this.container.resolve(TOKENS.RPC_HANDLER);
          const result = await rpcHandler.handleCall(method, params);

          // Send response back to renderer
          event.sender.send('rpc-response', {
            type: 'rpc_response',
            success: true,
            data: result,
            correlationId,
          });
        } catch (error) {
          event.sender.send('rpc-response', {
            type: 'rpc_response',
            success: false,
            error: error instanceof Error ? error.message : String(error),
            correlationId,
          });
        }
      }
    });

    // Handle synchronous state requests
    ipcMain.on('get-state', (event) => {
      const stateStorage = this.container.resolve(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE);
      event.returnValue = stateStorage.get('webview-state') ?? {};
    });

    ipcMain.on('set-state', (_event, state) => {
      const stateStorage = this.container.resolve(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE);
      stateStorage.update('webview-state', state);
    });
  }

  // Push events from main to renderer (streaming, status updates, etc.)
  sendToRenderer(channel: string, data: unknown): void {
    this.getWindow()?.webContents.send(channel, data);
  }
}
```

### Streaming Support

The existing streaming architecture (SSE-like events from Claude Agent SDK) works through the same IPC channel. The main process sends incremental events:

```typescript
// In the main process streaming handler
sdkAdapter.onStreamEvent((event) => {
  this.getWindow()?.webContents.send('rpc-response', {
    type: 'stream_event',
    payload: event,
  });
});
```

The renderer already handles these events through the `MessageRouterService`.

### Security Considerations

- **Context Isolation**: Enabled by default in modern Electron. The preload script is the only bridge.
- **No `nodeIntegration`**: Must remain `false`. All Node.js operations happen in main process.
- **Input validation**: The IPC bridge should validate incoming method names against the RPC method registry.
- **No `remote` module**: Deprecated and removed. All main process access is through IPC.

```typescript
// BrowserWindow creation
const mainWindow = new BrowserWindow({
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true, // Additional security
  },
});
```

---

## 6. Claude Agent SDK in Electron

### Authentication

The Claude Agent SDK uses the `ANTHROPIC_API_KEY` environment variable for authentication outside VS Code. This is the officially supported method. Anthropic explicitly states: "Third party developers cannot offer claude.ai login or rate limits for their products."

**Electron auth flow**:

1. User enters API key in settings UI (Angular renderer)
2. Key is sent to main process via RPC (`auth:setApiKey`)
3. Main process stores key using `ISecretStorage` (safeStorage)
4. On SDK initialization, key is loaded from secret storage and set as environment variable
5. Alternative auth: Bedrock (`CLAUDE_CODE_USE_BEDROCK=1`), Vertex (`CLAUDE_CODE_USE_VERTEX=1`), Azure Foundry (`CLAUDE_CODE_USE_FOUNDRY=1`)

### SDK Integration

The `agent-sdk` library's services (`SdkAgentAdapter`, `SdkSessionStorage`, etc.) already inject platform interfaces via `PLATFORM_TOKENS`. They will work in Electron without modification as long as:

1. `ANTHROPIC_API_KEY` is in `process.env`
2. `PLATFORM_TOKENS` are registered with Electron implementations
3. `reflect-metadata` is imported at the entry point

### Copilot/Codex Providers

The existing proxy-based providers (Copilot, Codex) that route through Claude's API will continue to work -- they use HTTP/SDK calls, not VS Code-specific APIs. The `copilot-auth.service.ts` and `codex-auth.service.ts` need API key-based auth (already supported).

### LLM Abstraction

The `llm-abstraction` library (Langchain-based) provides OpenAI, Anthropic, Google Gemini, and OpenRouter providers. These are all HTTP-based and work in any Node.js environment. The only VS Code-specific provider (`VS Code LM API`) would not be available in Electron -- this is expected and handled by the provider selection UI.

---

## 7. Build and Distribution

### Recommended: electron-builder

| Factor           | electron-builder                    | electron-forge          |
| ---------------- | ----------------------------------- | ----------------------- |
| Weekly downloads | 601K                                | 1.6K                    |
| Auto-updater     | Built-in (electron-updater)         | Requires Squirrel setup |
| Config format    | YAML/JSON declarative               | JS plugin system        |
| Code signing     | Built-in for macOS + Windows        | Manual setup            |
| Output formats   | dmg, nsis, appimage, snap, deb, msi | dmg, squirrel, zip      |
| Monorepo support | Good (configurable directories)     | Limited                 |

**electron-builder wins** for Ptah because:

- Declarative YAML config is simpler
- Built-in auto-updater (`electron-updater`) is production-proven
- Better monorepo support with configurable `directories`
- Used by VS Code, Slack, and other major Electron apps

### electron-builder.yml

```yaml
appId: com.ptah.desktop
productName: Ptah
copyright: Copyright 2026 Ptah

directories:
  output: ../../release # Relative to dist/apps/ptah-electron
  buildResources: assets

files:
  - '**/*'
  - '!**/*.map'

extraResources:
  - from: '../ptah-extension-webview/browser'
    to: 'renderer'

mac:
  category: public.app-category.developer-tools
  icon: assets/icon.icns
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: entitlements.mac.plist
  entitlementsInherit: entitlements.mac.plist
  target:
    - dmg
    - zip # Required for auto-update

win:
  icon: assets/icon.ico
  target:
    - nsis
  sign: true

linux:
  icon: assets/icons
  category: Development
  target:
    - AppImage
    - deb

publish:
  provider: github
  owner: your-org
  repo: ptah-desktop

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
```

### Auto-Update Strategy

```typescript
import { autoUpdater } from 'electron-updater';

export function setupAutoUpdater(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    // Notify renderer
  });

  autoUpdater.on('update-downloaded', (info) => {
    // Prompt user to restart
  });

  autoUpdater.checkForUpdatesAndNotify();
}
```

### Code Signing

- **macOS**: Requires Apple Developer ID certificate ($99/year). Use `electron-notarize` for notarization. CI/CD via GitHub Actions with secrets.
- **Windows**: EV code signing certificate required for SmartScreen reputation. Can use Azure SignTool or signtool.exe. Costs $200-400/year.
- **Linux**: No code signing required for AppImage/deb.

### Bundle Size Considerations

| Component                      | Estimated Size      |
| ------------------------------ | ------------------- |
| Electron runtime               | ~85 MB (compressed) |
| Angular renderer (production)  | ~2 MB               |
| Main process code              | ~5 MB               |
| Node modules (agent-sdk, etc.) | ~15 MB              |
| **Total installer**            | **~110-120 MB**     |

This is typical for Electron apps. Strategies to reduce:

- Tree-shake unused Langchain providers
- Use `asar` archive (default in electron-builder)
- Exclude development dependencies

---

## 8. Risk Assessment

### Critical Risks

| Risk                                                 | Probability | Impact | Mitigation                                                                                                                                 |
| ---------------------------------------------------- | ----------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| tsyringe decorator metadata issues in Electron       | 30%         | HIGH   | Ensure `reflect-metadata` import at top of `main.ts`. Webpack config must preserve decorator metadata. Test early with a minimal DI setup. |
| `safeStorage` not available on Linux (no keyring)    | 20%         | MEDIUM | Fallback to plaintext + warning. Check `safeStorage.isEncryptionAvailable()`.                                                              |
| electron-store ESM-only breaks CommonJS main process | 40%         | MEDIUM | Use custom JSON storage instead (simpler, no ESM issue).                                                                                   |
| Angular webview CSP issues in Electron               | 15%         | LOW    | Electron is more permissive than VS Code webviews. Likely easier, not harder.                                                              |
| Streaming performance over IPC                       | 10%         | MEDIUM | Electron IPC is fast for JSON messages. Batch rapid events if needed.                                                                      |
| Native module compatibility (chokidar, etc.)         | 25%         | MEDIUM | Use `electron-rebuild` to rebuild native modules. Pin versions.                                                                            |

### Low Risks

- **Angular SPA reuse**: Very low risk. The abstraction via `window.vscode`/`window.ptahConfig` globals is clean.
- **Backend service reuse**: Very low risk. Platform-core abstraction is well-designed.
- **RPC contract compatibility**: Very low risk. Same types, different transport.

---

## 9. Recommended Architecture Diagram

```
+================================================================+
|                    PTAH ELECTRON APPLICATION                     |
+================================================================+
|                                                                  |
|  RENDERER PROCESS (Chromium)                                    |
|  +----------------------------------------------------------+  |
|  |  Angular 20 SPA (ptah-extension-webview - UNCHANGED)      |  |
|  |  +------------------------------------------------------+ |  |
|  |  |  App Shell -> Chat / Dashboard / Settings / Wizard    | |  |
|  |  |  Uses: @ptah-extension/chat, dashboard, setup-wizard  | |  |
|  |  +------------------------------------------------------+ |  |
|  |  |  Frontend Core Services (@ptah-extension/core)        | |  |
|  |  |  VSCodeService -> postMessage() -> contextBridge      | |  |
|  |  |  ClaudeRpcService -> type-safe RPC calls              | |  |
|  |  +------------------------------------------------------+ |  |
|  +----------------------------------------------------------+  |
|       |  contextBridge (preload.ts)  |                          |
|       |  ipcRenderer.send/on         |                          |
|  =====[============IPC===============]===========================|
|       |  ipcMain.on/send             |                          |
|  MAIN PROCESS (Node.js)                                         |
|  +----------------------------------------------------------+  |
|  |  IPC Bridge (ipc-bridge.ts)                               |  |
|  |  Maps RPC methods to service handlers                     |  |
|  +----------------------------------------------------------+  |
|  |  DI Container (tsyringe)                                  |  |
|  |  +------------------------------------------------------+ |  |
|  |  |  PLATFORM LAYER (libs/backend/platform-electron)      | |  |
|  |  |  ElectronFileSystemProvider   (Node fs/promises)       | |  |
|  |  |  ElectronStateStorage         (JSON file)              | |  |
|  |  |  ElectronSecretStorage        (safeStorage)            | |  |
|  |  |  ElectronWorkspaceProvider    (dialog + recent)        | |  |
|  |  |  ElectronUserInteraction      (dialog API)             | |  |
|  |  |  ElectronOutputChannel        (log file)               | |  |
|  |  |  ElectronCommandRegistry      (menu + shortcuts)       | |  |
|  |  |  ElectronEditorProvider       (null / Monaco)          | |  |
|  |  +------------------------------------------------------+ |  |
|  |  |  BACKEND LIBRARIES (UNCHANGED)                         | |  |
|  |  |  agent-sdk          -> Claude SDK, streaming           | |  |
|  |  |  workspace-intel     -> project analysis               | |  |
|  |  |  agent-generation    -> agent templates                | |  |
|  |  |  llm-abstraction     -> multi-provider LLM            | |  |
|  |  |  template-generation -> template processing            | |  |
|  |  +------------------------------------------------------+ |  |
|  +----------------------------------------------------------+  |
|  |  BrowserWindow Management                                 |  |
|  |  Auto-Updater (electron-updater)                          |  |
|  |  System Tray / Menu Bar                                   |  |
|  +----------------------------------------------------------+  |
+================================================================+
```

---

## 10. Dependencies and Version Recommendations

### Core Dependencies

| Package            | Version   | Purpose                                             |
| ------------------ | --------- | --------------------------------------------------- |
| `electron`         | `^35.0.0` | Runtime (latest LTS line, safeStorage improvements) |
| `electron-builder` | `^25.0.0` | Packaging and distribution                          |
| `electron-updater` | `^6.0.0`  | Auto-update support                                 |
| `chokidar`         | `^4.0.0`  | File watching (for IFileWatcher)                    |
| `fast-glob`        | `^3.3.0`  | Glob pattern matching (for findFiles)               |

### Development Dependencies

| Package                       | Version  | Purpose                              |
| ----------------------------- | -------- | ------------------------------------ |
| `@electron/rebuild`           | `^3.6.0` | Rebuild native modules for Electron  |
| `electron-devtools-installer` | `^3.2.0` | Install Chrome DevTools extensions   |
| `wait-on`                     | `^7.2.0` | Wait for dev server before launching |

### Existing Dependencies (No Changes)

| Package                          | Purpose                                      |
| -------------------------------- | -------------------------------------------- |
| `tsyringe` + `reflect-metadata`  | DI container (works in Node.js main process) |
| `@anthropic-ai/claude-agent-sdk` | Claude SDK (API key auth)                    |
| `langchain/*`                    | Multi-provider LLM abstraction               |
| `eventemitter3`                  | Event bus                                    |
| `uuid`                           | ID generation                                |

### Not Needed

| Package          | Reason                                            |
| ---------------- | ------------------------------------------------- |
| `keytar`         | Deprecated. Use Electron's `safeStorage` instead. |
| `electron-store` | ESM-only. Custom JSON storage is simpler.         |
| `nx-electron`    | Custom Nx project gives more control.             |

---

## 11. Prototype Plan

### Phase 1: Skeleton (Week 1)

**Goal**: Electron window loads Angular SPA, IPC bridge works.

1. Create `apps/ptah-electron/` with `main.ts`, `preload.ts`, `webpack.config.js`
2. Create `libs/backend/platform-electron/` with stub implementations
3. BrowserWindow loads `dist/apps/ptah-extension-webview/browser/index.html`
4. Preload script exposes `window.vscode` and `window.ptahConfig`
5. Verify Angular SPA renders correctly
6. Verify one RPC round-trip (e.g., `config:get`)

**Success criteria**: Angular UI renders in Electron window, can send/receive one RPC message.

### Phase 2: Platform Implementations (Week 2)

**Goal**: All 8 platform interfaces implemented and registered.

1. Implement `ElectronFileSystemProvider` (fs/promises + chokidar)
2. Implement `ElectronStateStorage` (JSON file)
3. Implement `ElectronSecretStorage` (safeStorage)
4. Implement `ElectronWorkspaceProvider` (dialog + config file)
5. Implement `ElectronUserInteraction` (dialog API)
6. Implement `ElectronOutputChannel` (log file)
7. Implement `ElectronCommandRegistry` (in-memory registry)
8. Implement `ElectronEditorProvider` (null impl)
9. Create `registerPlatformElectronServices()` registration function

**Success criteria**: DI container resolves all services without errors.

### Phase 3: Full DI + Chat (Week 3)

**Goal**: Chat with Claude works end-to-end.

1. Wire up full DI container (mirror VS Code container.ts)
2. Implement API key entry flow in settings UI
3. Register all RPC handlers via `RpcMethodRegistrationService`
4. Test chat:start, chat:continue, streaming responses
5. Test session persistence (save/load/list/delete)
6. Test workspace intelligence (project detection)

**Success criteria**: Can have a full conversation with Claude in Electron app.

### Phase 4: Polish + Packaging (Week 4)

**Goal**: Distributable application.

1. Set up electron-builder configuration
2. Build installers for macOS (dmg), Windows (nsis), Linux (AppImage)
3. Implement auto-updater
4. Add system tray integration
5. Add application menu with keyboard shortcuts
6. Test on all three platforms

**Success criteria**: Installable application that auto-updates.

### Phase 5: Feature Parity (Weeks 5-8, optional)

**Goal**: Match VS Code extension feature set.

1. Setup wizard (workspace analysis + agent generation)
2. Dashboard (performance metrics)
3. Multiple provider support (OpenAI, Gemini, etc.)
4. Plugin system
5. Monaco editor integration (IEditorProvider)
6. Code signing and notarization

---

## Sources

- [nx-electron plugin (bennymeg)](https://github.com/bennymeg/nx-electron)
- [Electron contextBridge API](https://www.electronjs.org/docs/latest/api/context-bridge)
- [Electron Preload Scripts Tutorial](https://www.electronjs.org/docs/latest/tutorial/tutorial-preload)
- [Electron IPC Tutorial](https://www.electronjs.org/docs/latest/tutorial/ipc)
- [Electron safeStorage API](https://www.electronjs.org/docs/latest/api/safe-storage)
- [Replacing Keytar with safeStorage](https://freek.dev/2103-replacing-keytar-with-electrons-safestorage-in-ray)
- [electron-store on GitHub](https://github.com/sindresorhus/electron-store)
- [electron-builder Auto Update docs](https://www.electron.build/auto-update.html)
- [Electron Code Signing docs](https://www.electronjs.org/docs/latest/tutorial/code-signing)
- [Why Electron Forge](https://www.electronforge.io/core-concepts/why-electron-forge)
- [electron-builder vs electron-forge comparison](https://github.com/electron-userland/electron-builder/issues/1193)
- [Claude Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Claude Agent SDK Quickstart](https://platform.claude.com/docs/en/agent-sdk/quickstart)
- [tsyringe on GitHub](https://github.com/microsoft/tsyringe)
- [Electron Releases](https://releases.electronjs.org/)
- [Angular-Electron with Electron Forge](https://medium.com/@ahmed.loudghiri/bridging-the-gap-crafting-an-angular-electron-application-with-typescript-using-angular-cli-and-74cb359daa4a)
- [chokidar on GitHub](https://github.com/paulmillr/chokidar)
