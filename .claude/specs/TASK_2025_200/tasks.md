# Development Tasks - TASK_2025_200: Electron Application for Ptah

**Total Tasks**: 28 | **Batches**: 7 | **Status**: 0/7 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- PlatformType.Electron already exists in enum: VERIFIED
- PLATFORM_TOKENS use Symbol.for() for cross-module resolution: VERIFIED
- Registration pattern matches platform-vscode (useValue instances): VERIFIED
- Angular SPA needs zero code changes (preload injects window.vscode/ptahConfig): VERIFIED
- vscode-core registerVsCodeCoreServices() imports vscode directly: VERIFIED (cannot call from Electron)

### Risks Identified

| Risk                                                                                  | Severity | Mitigation                                                                                        |
| ------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------- |
| vscode-core services import `vscode` directly (StatusBarManager, ConfigManager, etc.) | MEDIUM   | Batch 3 Task 3.1 -- manually register only platform-agnostic services, skip VS Code-specific ones |
| Some vscode-core classes depend on TOKENS.EXTENSION_CONTEXT (vscode.ExtensionContext) | LOW      | Batch 3 -- audit each service constructor, provide Electron-compatible stub if needed             |
| RPC handlers are in app-level code, need to be shared or duplicated for Electron      | LOW      | Batch 4 -- create Electron RPC service index that reuses handler classes                          |
| electron v35.x Node.js compatibility unverified                                       | LOW      | Batch 1 -- verify during npm install, downgrade if needed                                         |

### Edge Cases to Handle

- [ ] safeStorage unavailable (Linux without keyring) -> fallback to raw storage with warning
- [ ] No workspace folder provided at startup -> use default storage path
- [ ] Second instance launch -> focus existing window instead of opening new one
- [ ] macOS window-all-closed -> keep app running (dock behavior)
- [ ] File watcher on large directories -> use chokidar with sensible defaults

---

## Batch 1: Electron Skeleton + Project Scaffolding -- IN PROGRESS

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: None

### Task 1.1: Create platform-electron library scaffolding -- IMPLEMENTED

**Files**:

- `D:\projects\ptah-extension\libs\backend\platform-electron\project.json`
- `D:\projects\ptah-extension\libs\backend\platform-electron\tsconfig.json`
- `D:\projects\ptah-extension\libs\backend\platform-electron\tsconfig.lib.json`
- `D:\projects\ptah-extension\libs\backend\platform-electron\tsconfig.spec.json`
- `D:\projects\ptah-extension\libs\backend\platform-electron\jest.config.ts`
- `D:\projects\ptah-extension\libs\backend\platform-electron\src\index.ts` (stub exports)

**Spec Reference**: implementation-plan.md: Section 6.4 (project.json), Section 6.5 (tsconfig files)
**Pattern to Follow**: `libs/backend/platform-vscode/project.json`, `libs/backend/platform-vscode/tsconfig.json`

**Quality Requirements**:

- project.json must have build, test, typecheck, lint targets
- tsconfig.json references tsconfig.lib.json and tsconfig.spec.json
- tsconfig.lib.json uses node16 module/moduleResolution
- jest.config.ts follows platform-vscode pattern
- index.ts is a placeholder with comment (implementations added in Batch 2)

**Implementation Details**:

- Copy structure from platform-vscode, adapt names
- esbuild executor for build target with cjs format
- External: tsyringe, reflect-metadata, electron, chokidar, fast-glob
- Tags: scope:electron, type:feature

---

### Task 1.2: Create ptah-electron app scaffolding -- IMPLEMENTED

**Files**:

- `D:\projects\ptah-extension\apps\ptah-electron\project.json`
- `D:\projects\ptah-extension\apps\ptah-electron\tsconfig.app.json`
- `D:\projects\ptah-extension\apps\ptah-electron\tsconfig.preload.json`
- `D:\projects\ptah-extension\apps\ptah-electron\webpack.config.js`
- `D:\projects\ptah-extension\apps\ptah-electron\webpack.preload.config.js`
- `D:\projects\ptah-extension\apps\ptah-electron\electron-builder.yml`

**Spec Reference**: implementation-plan.md: Sections 6.1-6.3, 6.5-6.7
**Pattern to Follow**: `apps/ptah-extension-vscode/webpack.config.js`, `apps/ptah-extension-vscode/project.json`

**Quality Requirements**:

- project.json has build-main, build-preload, build, copy-renderer, serve, package, typecheck, lint targets
- webpack.config.js targets electron-main, externalizes electron, bundles @ptah-extension/\* and tsyringe
- webpack.preload.config.js targets electron-preload, externalizes only electron
- tsconfig.app.json excludes preload.ts
- tsconfig.preload.json includes only preload.ts
- electron-builder.yml has mac/win/linux targets

**Implementation Details**:

- Webpack aliases for all @ptah-extension/\* packages (NOT platform-vscode or vscode-lm-tools)
- entry: ['reflect-metadata', './src/main.ts'] for main process
- output: commonjs2 to dist/apps/ptah-electron
- serve target chains: build -> copy-renderer -> electron launch

---

### Task 1.3: Create Electron main process entry point (main.ts) -- IMPLEMENTED

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\main.ts`
**Spec Reference**: implementation-plan.md: Section 5.1
**Pattern to Follow**: `apps/ptah-extension-vscode/src/main.ts`

**Quality Requirements**:

- import 'reflect-metadata' MUST be first import
- Single-instance lock with app.requestSingleInstanceLock()
- app.whenReady() -> create BrowserWindow -> load renderer
- macOS activate handler (re-create window)
- window-all-closed handler (quit except macOS)
- DevTools in development mode

**Implementation Details**:

- For Batch 1 (skeleton), DI container and IPC bridge are NOT wired yet
- Just create window and load renderer HTML
- Comment placeholders for DI + IPC (added in Batches 3-4)
- Parse command-line args for workspace path

---

### Task 1.4: Create BrowserWindow factory and preload script -- IMPLEMENTED

**Files**:

- `D:\projects\ptah-extension\apps\ptah-electron\src\windows\main-window.ts`
- `D:\projects\ptah-extension\apps\ptah-electron\src\preload.ts`

**Spec Reference**: implementation-plan.md: Sections 5.2, 5.3
**Pattern to Follow**: N/A (new patterns for Electron)

**Quality Requirements**:

- BrowserWindow: contextIsolation=true, nodeIntegration=false, sandbox=true
- Preload: contextBridge exposes window.vscode (postMessage, getState, setState)
- Preload: contextBridge exposes window.ptahConfig (isVSCode=false, isElectron=true)
- Preload: ipcRenderer.on('to-renderer') dispatches window MessageEvent
- macOS: hiddenInset title bar style
- Window dimensions: 1200x800 default, 800x600 minimum

**Validation Notes**:

- The preload script is the CRITICAL bridge that makes Angular work without changes
- window.vscode.postMessage maps to ipcRenderer.send('rpc')
- window message events are dispatched for MessageRouterService compatibility

---

### Task 1.5: Update root config files -- IMPLEMENTED

**Files**:

- `D:\projects\ptah-extension\tsconfig.base.json` (add platform-electron path alias)
- `D:\projects\ptah-extension\package.json` (add electron, electron-builder, fast-glob, chokidar deps)

**Spec Reference**: implementation-plan.md: Sections 6.6, 9
**Pattern to Follow**: Existing @ptah-extension/platform-core path in tsconfig.base.json

**Quality Requirements**:

- tsconfig.base.json: add "@ptah-extension/platform-electron": ["libs/backend/platform-electron/src/index.ts"]
- package.json devDependencies: electron ^35.0.0, electron-builder ^25.0.0, @electron/rebuild ^3.6.0
- package.json dependencies: chokidar ^4.0.0, fast-glob ^3.3.0, electron-updater ^6.0.0

**Implementation Details**:

- Do NOT run npm install (developer just modifies files, install happens separately)
- Verify electron version compatibility note

---

**Batch 1 Verification**:

- All files exist at listed paths
- TypeScript compiles: `npx tsc --noEmit --project apps/ptah-electron/tsconfig.app.json`
- code-logic-reviewer approved
- No stubs in production code (main.ts, preload.ts, main-window.ts must be real)

---

## Batch 2: Platform-Electron Implementations (All 8 Providers + Registration) -- PENDING

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 1

### Task 2.1: Implement file system, state storage, and secret storage providers -- PENDING

**Files**:

- `D:\projects\ptah-extension\libs\backend\platform-electron\src\implementations\electron-file-system-provider.ts`
- `D:\projects\ptah-extension\libs\backend\platform-electron\src\implementations\electron-state-storage.ts`
- `D:\projects\ptah-extension\libs\backend\platform-electron\src\implementations\electron-secret-storage.ts`

**Spec Reference**: implementation-plan.md: Sections 4.1, 4.2, 4.3
**Pattern to Follow**: `libs/backend/platform-vscode/src/implementations/vscode-file-system-provider.ts`

**Quality Requirements**:

- ElectronFileSystemProvider: all IFileSystemProvider methods using fs/promises
- findFiles uses dynamic import of fast-glob
- createFileWatcher uses chokidar with ignoreInitial=true
- ElectronStateStorage: JSON file with in-memory cache, atomic write (tmp+rename)
- ElectronSecretStorage: safeStorage injected via constructor (not top-level import)
- safeStorage fallback when encryption unavailable (Linux without keyring)
- All use createEvent() from platform-core for IEvent properties

**Edge Cases**:

- File not found -> throw appropriate error
- Directory not existing for write -> auto-create parent dirs
- Concurrent writes to state storage -> serialize via writePromise chain
- safeStorage decryption failure -> return undefined with error log

---

### Task 2.2: Implement workspace, user interaction, and output channel providers -- PENDING

**Files**:

- `D:\projects\ptah-extension\libs\backend\platform-electron\src\implementations\electron-workspace-provider.ts`
- `D:\projects\ptah-extension\libs\backend\platform-electron\src\implementations\electron-user-interaction.ts`
- `D:\projects\ptah-extension\libs\backend\platform-electron\src\implementations\electron-output-channel.ts`

**Spec Reference**: implementation-plan.md: Sections 4.4, 4.5, 4.6
**Pattern to Follow**: `libs/backend/platform-vscode/src/implementations/vscode-workspace-provider.ts`

**Quality Requirements**:

- ElectronWorkspaceProvider: config stored in JSON file, folders set via setWorkspaceFolders()
- Events fire via createEvent() for config and folder changes
- ElectronUserInteraction: dialog/getWindow injected via constructor (avoid top-level electron import)
- showQuickPick and showInputBox delegate to renderer via IPC (with response channel)
- withProgress creates cancellation token and forwards to renderer
- ElectronOutputChannel: WriteStream to log file with timestamp prefix

**Edge Cases**:

- No window available (getWindow returns null) -> QuickPick/InputBox return undefined
- Config file doesn't exist on first launch -> start with empty config

---

### Task 2.3: Implement command registry and editor provider -- PENDING

**Files**:

- `D:\projects\ptah-extension\libs\backend\platform-electron\src\implementations\electron-command-registry.ts`
- `D:\projects\ptah-extension\libs\backend\platform-electron\src\implementations\electron-editor-provider.ts`

**Spec Reference**: implementation-plan.md: Sections 4.7, 4.8
**Pattern to Follow**: `libs/backend/platform-vscode/src/implementations/vscode-command-registry.ts`

**Quality Requirements**:

- ElectronCommandRegistry: in-memory Map, registerCommand returns IDisposable
- executeCommand throws if command not found
- getRegisteredCommands() returns all registered IDs
- ElectronEditorProvider: tracks active file path, fires events via createEvent()
- notifyFileOpened() and notifyActiveEditorChanged() for IPC bridge integration

---

### Task 2.4: Create registration function and library index -- PENDING

**Files**:

- `D:\projects\ptah-extension\libs\backend\platform-electron\src\registration.ts`
- `D:\projects\ptah-extension\libs\backend\platform-electron\src\index.ts` (update from stub)

**Spec Reference**: implementation-plan.md: Sections 4.9, 4.10
**Pattern to Follow**: `libs/backend/platform-vscode/src/registration.ts`

**Quality Requirements**:

- registerPlatformElectronServices(container, options) signature
- ElectronPlatformOptions interface: appPath, userDataPath, logsPath, safeStorage, dialog, getWindow, initialFolders
- Registers all 10 tokens: PLATFORM_INFO + 8 providers + WORKSPACE_STATE_STORAGE
- workspace-scoped storage path derived from initialFolders[0] via base64url encoding
- index.ts exports registration function, options type, and all 8 implementation classes
- PlatformType.Electron used for PLATFORM_INFO

**Validation Notes**:

- Must call AFTER app.whenReady() (safeStorage requirement)
- Must call BEFORE any library registerXxxServices() functions

---

**Batch 2 Verification**:

- All 8 implementation files exist with real code (no stubs/TODOs)
- registration.ts follows exact same pattern as platform-vscode
- index.ts re-exports everything
- code-logic-reviewer approved
- Build passes: platform-electron library compiles

---

## Batch 3: DI Container Setup + vscode-core Audit -- PENDING

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batch 2

### Task 3.1: Audit vscode-core services and create Electron DI container -- PENDING

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\di\container.ts`
**Spec Reference**: implementation-plan.md: Section 5.6
**Pattern to Follow**: `apps/ptah-extension-vscode/src/di/container.ts`

**Quality Requirements**:

- ElectronDIContainer.setup(options) static method
- Phase 0: registerPlatformElectronServices(container, options)
- Phase 1: Register OutputManager, Logger, then MANUALLY register needed vscode-core services
- DO NOT call registerVsCodeCoreServices() -- it imports vscode module
- Register selectively: RpcHandler (platform-agnostic), ErrorHandler, ConfigManager (if platform-agnostic), MessageValidatorService, AgentSessionWatcherService, AuthSecretsService
- SKIP: StatusBarManager, WebviewManager (VS Code-specific), FileSystemManager (use platform-core), LicenseService (API key auth), FeatureGateService
- Phase 2: registerWorkspaceIntelligenceServices, registerSdkServices, registerAgentGenerationServices, registerLlmAbstractionServices, registerTemplateGenerationServices
- Phase 3: Wire storage adapters (TOKENS.STORAGE_SERVICE -> WORKSPACE_STATE_STORAGE, TOKENS.GLOBAL_STATE -> STATE_STORAGE)
- Phase 4: Wire EnhancedPromptsService -> analysisReader (same as VS Code container)
- Return container (TOKENS.WEBVIEW_MANAGER registered later in main.ts after IpcBridge)

**Validation Notes**:

- RISK: Each vscode-core service class must be checked for vscode imports in constructor
- CommandManager imports vscode directly -> may need ElectronCommandManagerAdapter or skip
- ConfigManager uses vscode.workspace.getConfiguration -> needs Electron adapter or skip
- RpcHandler, ErrorHandler, MessageValidatorService are likely platform-agnostic
- If a service has vscode constructor deps, either skip it or create minimal adapter

**Edge Cases**:

- Services that fail to resolve should be caught and logged, not crash the app
- Multi-phase analysis reader wiring failure should warn, not throw

---

### Task 3.2: Create RPC handler index for Electron -- PENDING

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\index.ts`
**Spec Reference**: implementation-plan.md: Section 5.6 (Phase 4 comment)
**Pattern to Follow**: `apps/ptah-extension-vscode/src/services/rpc/index.ts`

**Quality Requirements**:

- Re-export RPC handler classes that are platform-agnostic
- Import from the VS Code app's handler files OR create shared references
- Include: ChatRpcHandlers, SessionRpcHandlers, ContextRpcHandlers, ConfigRpcHandlers, AuthRpcHandlers, SetupRpcHandlers, AutocompleteRpcHandlers, FileRpcHandlers, SubagentRpcHandlers, EnhancedPromptsRpcHandlers, AgentRpcHandlers
- SKIP: LicenseRpcHandlers (Electron uses API key, no license), CommandRpcHandlers (VS Code-specific), PtahCliRpcHandlers (VS Code terminal-specific)
- Create RpcMethodRegistrationService or equivalent that registers all handlers

**Validation Notes**:

- RPC handler classes in apps/ptah-extension-vscode/src/services/rpc/handlers/ may import vscode
- Each handler file must be audited for vscode imports
- If a handler imports vscode, it cannot be directly reused -- need to either refactor or skip

---

### Task 3.3: Update main.ts to wire DI container -- PENDING

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\main.ts` (modify from Batch 1)
**Spec Reference**: implementation-plan.md: Section 5.1
**Dependencies**: Task 3.1

**Quality Requirements**:

- Wire ElectronDIContainer.setup(options) in app.whenReady()
- Pass all required ElectronPlatformOptions from Electron APIs
- Load API key from SecretStorage and set process.env.ANTHROPIC_API_KEY
- Comment placeholder for IPC bridge (Batch 4)

---

**Batch 3 Verification**:

- DI container resolves without errors
- All platform-agnostic services registered
- VS Code-specific services correctly skipped
- code-logic-reviewer approved
- No vscode imports in Electron app code

---

## Batch 4: IPC Bridge + RPC Integration -- PENDING

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 3

### Task 4.1: Create IPC Bridge -- PENDING

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\ipc\ipc-bridge.ts`
**Spec Reference**: implementation-plan.md: Section 5.4
**Pattern to Follow**: N/A (new Electron-specific pattern)

**Quality Requirements**:

- IpcBridge class with constructor(container, getWindow)
- initialize() sets up RPC and state handlers
- setupRpcHandler(): ipcMain.on('rpc') -> rpcHandler.handleMessage() -> event.sender.send('to-renderer')
- setupStateHandlers(): synchronous get-state, async set-state via WORKSPACE_STATE_STORAGE
- sendToRenderer(message) method for pushing events to renderer
- Error handling: invalid messages logged with warning, errors sent as rpc_response with success=false

**Edge Cases**:

- RPC message without method field -> log warning and skip
- RpcHandler throws -> send error response with correlationId
- State storage not available -> return empty object, log error

---

### Task 4.2: Create WebviewManager adapter -- PENDING

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\ipc\webview-manager-adapter.ts`
**Spec Reference**: implementation-plan.md: Section 5.5

**Quality Requirements**:

- ElectronWebviewManagerAdapter class with constructor(ipcBridge)
- sendMessage(viewType, type, payload) -> ipcBridge.sendToRenderer({ type, payload })
- broadcastMessage(type, payload) -> ipcBridge.sendToRenderer({ type, payload })
- Must satisfy the interface expected by TOKENS.WEBVIEW_MANAGER consumers

---

### Task 4.3: Wire IPC Bridge and WebviewManager in main.ts -- PENDING

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\main.ts` (modify)
**Dependencies**: Task 4.1, Task 4.2, Task 3.3

**Quality Requirements**:

- Create IpcBridge after DI container setup
- Call ipcBridge.initialize()
- Create ElectronWebviewManagerAdapter(ipcBridge)
- Register adapter as TOKENS.WEBVIEW_MANAGER in container
- Load renderer AFTER all setup is complete

---

### Task 4.4: Create RpcMethodRegistrationService for Electron -- PENDING

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\rpc-method-registration.service.ts`
**Spec Reference**: implementation-plan.md: Section 5.6 Phase 4
**Pattern to Follow**: `apps/ptah-extension-vscode/src/services/rpc/rpc-method-registration.service.ts`

**Quality Requirements**:

- Mirrors VS Code RpcMethodRegistrationService but only registers platform-agnostic handlers
- Each handler class has a register() method that calls rpcHandler.registerMethod()
- Constructor resolves handler instances from DI container
- registerAll() orchestrates registration of all handlers
- Handlers registered in DI container via Task 3.1

---

**Batch 4 Verification**:

- IPC round-trip works: renderer postMessage -> main process RPC -> response back
- State get/set works via IPC
- WebviewManager adapter broadcasts events to renderer
- code-logic-reviewer approved
- End-to-end: Angular SPA can make RPC calls and receive responses

---

## Batch 5: Application Polish + Packaging -- PENDING

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 4

### Task 5.1: Create application menu -- PENDING

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\menu\application-menu.ts`
**Spec Reference**: implementation-plan.md: Phase 4 (referenced in architecture)

**Quality Requirements**:

- Standard Electron Menu with File, Edit, View, Window, Help
- File: New Chat, Open Folder, Settings, Quit
- Edit: standard Cut/Copy/Paste/SelectAll
- View: Toggle DevTools, Reload, Zoom
- macOS: app name menu with About, Preferences, Quit
- Keyboard accelerators for all menu items
- Open Folder triggers Electron dialog -> sets workspace folders

---

### Task 5.2: Implement API key settings IPC flow -- PENDING

**Files**:

- Additional IPC handlers in `D:\projects\ptah-extension\apps\ptah-electron\src\ipc\ipc-bridge.ts` (modify)

**Spec Reference**: implementation-plan.md: Section 8

**Quality Requirements**:

- auth:setApiKey RPC handler stores key via ISecretStorage
- Sets process.env.ANTHROPIC_API_KEY for Claude Agent SDK
- On app launch, loads saved API key from SecretStorage
- Supports multiple providers (anthropic, openrouter)

**Validation Notes**:

- AuthRpcHandlers from the shared handlers should already handle this
- This task verifies the flow works end-to-end in Electron

---

### Task 5.3: Create app icon placeholders -- PENDING

**Files**:

- `D:\projects\ptah-extension\apps\ptah-electron\src\assets\icons\icon.png`

**Quality Requirements**:

- Create a simple placeholder PNG (can be copied from existing extension icon)
- 512x512 PNG for source icon
- electron-builder generates platform-specific icons from source

---

### Task 5.4: Add npm scripts for Electron development -- PENDING

**File**: `D:\projects\ptah-extension\package.json` (modify)

**Quality Requirements**:

- Add script: "electron:serve": "nx serve ptah-electron"
- Add script: "electron:build": "nx build ptah-electron"
- Add script: "electron:package": "nx package ptah-electron"

---

**Batch 5 Verification**:

- Application menu renders with all items
- Menu keyboard shortcuts work
- API key entry flow works end-to-end
- npm scripts work as expected
- code-logic-reviewer approved

---

## Batch 6: Monaco Editor + File Explorer -- PENDING

**Developer**: frontend-developer
**Tasks**: 4 | **Dependencies**: Batch 4

### Task 6.1: Install Monaco Editor dependencies -- PENDING

**File**: `D:\projects\ptah-extension\package.json` (modify)

**Quality Requirements**:

- Add: ngx-monaco-editor-v2@20 (Angular 20 compatible)
- Add: monaco-editor@^0.55
- Update Angular app config to provide Monaco Editor
- Copy Monaco assets config for Electron build

---

### Task 6.2: Create File Tree component -- PENDING

**Files**:

- `D:\projects\ptah-extension\libs\frontend\editor\src\lib\components\file-tree\file-tree.component.ts`
- `D:\projects\ptah-extension\libs\frontend\editor\src\lib\components\file-tree\file-tree-node.component.ts`
- `D:\projects\ptah-extension\libs\frontend\editor\src\lib\models\file-tree.model.ts`

**Spec Reference**: implementation-plan.md: Section 4.8.1 (File Tree Component)

**Quality Requirements**:

- FileTreeNode interface: name, path, type, children?, expanded?
- FileTreeComponent: displays tree with EXPLORER header
- FileTreeNodeComponent: recursive component for nested directories
- Click on file emits fileSelected event
- Click on directory toggles expansion
- Styling with DaisyUI/TailwindCSS (bg-base-200, border-base-300)
- 64px wide sidebar

---

### Task 6.3: Create Code Editor component -- PENDING

**Files**:

- `D:\projects\ptah-extension\libs\frontend\editor\src\lib\components\code-editor\code-editor.component.ts`
- `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\editor.service.ts`

**Spec Reference**: implementation-plan.md: Section 4.8.1 (Editor Component)

**Quality Requirements**:

- CodeEditorComponent: Monaco editor with file tree sidebar
- Language detection from file extension (ts, js, json, html, css, py, md, yaml, etc.)
- File selection triggers IPC call: editor:openFile -> receives file content
- Editor options: vs-dark theme, automaticLayout, wordWrap
- EditorService: manages file content state, communicates with backend via RPC

---

### Task 6.4: Create editor library scaffolding and exports -- PENDING

**Files**:

- `D:\projects\ptah-extension\libs\frontend\editor\src\index.ts`
- `D:\projects\ptah-extension\libs\frontend\editor\project.json`
- `D:\projects\ptah-extension\libs\frontend\editor\tsconfig.json`
- `D:\projects\ptah-extension\libs\frontend\editor\tsconfig.lib.json`

**Quality Requirements**:

- New frontend library: @ptah-extension/editor
- project.json with build and lint targets
- Angular library setup (ng-packagr or similar)
- Export CodeEditorComponent, FileTreeComponent, FileTreeNode
- Add path alias to tsconfig.base.json

---

**Batch 6 Verification**:

- Monaco editor renders in Electron app
- File tree displays workspace files
- Clicking a file opens it in Monaco
- Language detection works for common file types
- code-logic-reviewer approved

---

## Batch 7: Auto-Update + CLAUDE.md -- PENDING

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 5

### Task 7.1: Create auto-updater module -- PENDING

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\updater\auto-updater.ts`

**Quality Requirements**:

- Uses electron-updater (autoUpdater)
- Checks for updates on app launch
- Shows dialog when update available
- Downloads and installs update on user confirmation
- Configurable update feed URL (from electron-builder.yml publish config)

---

### Task 7.2: Wire auto-updater in main.ts -- PENDING

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\main.ts` (modify)

**Quality Requirements**:

- Import and initialize auto-updater after window creation
- Only check for updates in production mode
- Handle update events (checking, available, downloaded, error)

---

### Task 7.3: Create CLAUDE.md for platform-electron library -- PENDING

**File**: `D:\projects\ptah-extension\libs\backend\platform-electron\CLAUDE.md`

**Quality Requirements**:

- Purpose and responsibility
- Architecture diagram
- File listing with descriptions
- Dependencies (platform-core, electron, chokidar, fast-glob)
- Usage examples for registration
- Testing approach

---

### Task 7.4: Create CLAUDE.md for ptah-electron app -- PENDING

**File**: `D:\projects\ptah-extension\apps\ptah-electron\CLAUDE.md`

**Quality Requirements**:

- Purpose: standalone Electron desktop app for Ptah
- Architecture: main process, preload, renderer, IPC bridge
- Build and run commands
- Directory structure
- Dependencies
- Development workflow

---

**Batch 7 Verification**:

- Auto-updater module compiles
- CLAUDE.md files follow project convention
- code-logic-reviewer approved
- All documentation accurate

---

## Status Legend

| Status      | Meaning                         | Who Sets              |
| ----------- | ------------------------------- | --------------------- |
| PENDING     | Not started                     | team-leader (initial) |
| IN PROGRESS | Assigned to developer           | team-leader           |
| IMPLEMENTED | Developer done, awaiting verify | developer             |
| COMPLETE    | Verified and committed          | team-leader           |
| FAILED      | Verification failed             | team-leader           |
