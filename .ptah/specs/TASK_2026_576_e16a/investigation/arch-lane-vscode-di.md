# Architecture Investigation: VS Code Command Registration, Git APIs, DI, and Electron Subsystems

This investigation answers eight specific architectural and implementation questions regarding `apps/ptah-extension-vscode`, `apps/ptah-electron`, `libs/backend`, and `libs/shared` with exact `file:line` citations.

---

## Q1. VS Code Extension Command Registration

- `apps/ptah-extension-vscode/src/core/ptah-extension.ts:108-160`: Registers core UI and webview commands directly using `vscode.commands.registerCommand`:
  - `apps/ptah-extension-vscode/src/core/ptah-extension.ts:108-122`: Registers `ptah.openFullPanel` to create the full editor panel.
  - `apps/ptah-extension-vscode/src/core/ptah-extension.ts:125-137`: Registers `ptah.openDashboard` to open the analytics dashboard panel.
  - `apps/ptah-extension-vscode/src/core/ptah-extension.ts:139-152`: Registers `ptah.openOrchestraCanvas` to open the canvas panel.
  - `apps/ptah-extension-vscode/src/core/ptah-extension.ts:154-160`: Registers `ptah.toggleChat` to focus the webview view (`ptah.main.focus`).
- `apps/ptah-extension-vscode/src/commands/license-commands.ts:210-227`: Registers license management commands directly using `vscode.commands.registerCommand`:
  - `apps/ptah-extension-vscode/src/commands/license-commands.ts:210-212`: Registers `ptah.enterLicenseKey`.
  - `apps/ptah-extension-vscode/src/commands/license-commands.ts:213-215`: Registers `ptah.removeLicenseKey`.
  - `apps/ptah-extension-vscode/src/commands/license-commands.ts:216-218`: Registers `ptah.checkLicenseStatus`.
  - `apps/ptah-extension-vscode/src/commands/license-commands.ts:219-221`: Registers `ptah.openPricing`.
  - `apps/ptah-extension-vscode/src/commands/license-commands.ts:222-226`: Registers `ptah.openSignup`.
- `apps/ptah-extension-vscode/src/commands/settings-commands.ts:55-64`: Registers `ptah.exportSettings` (line 57) and `ptah.importSettings` (line 60) via `vscode.commands.registerCommand`.
- `apps/ptah-extension-vscode/src/commands/setup-agents-command.ts:30-58`: Registers `ptah.setupAgents` via `commandManager.registerCommand` (which wraps `vscode.commands.registerCommand` in `libs/backend/vscode-core/src/api-wrappers/command-manager.ts:56`).
- `apps/ptah-extension-vscode/package.json:74-143`: Declares all contributed extension commands in `contributes.commands`, including:
  - `apps/ptah-extension-vscode/package.json:75-83`: Declares `ptah.toggleChat`.
  - `apps/ptah-extension-vscode/package.json:84-89`: Declares `ptah.openFullPanel`.
  - `apps/ptah-extension-vscode/package.json:90-95`: Declares `ptah.setupAgents`.
  - `apps/ptah-extension-vscode/package.json:96-101`: Declares `ptah.enterLicenseKey`.
  - `apps/ptah-extension-vscode/package.json:102-107`: Declares `ptah.removeLicenseKey`.
  - `apps/ptah-extension-vscode/package.json:108-113`: Declares `ptah.checkLicenseStatus`.
  - `apps/ptah-extension-vscode/package.json:114-119`: Declares `ptah.openDashboard`.
  - `apps/ptah-extension-vscode/package.json:120-124`: Declares `ptah.openOrchestraCanvas`.
  - `apps/ptah-extension-vscode/package.json:125-130`: Declares `ptah.exportSettings`.
  - `apps/ptah-extension-vscode/package.json:131-136`: Declares `ptah.importSettings`.
  - `apps/ptah-extension-vscode/package.json:137-142`: Declares `ptah.captureCpuProfile`.
- Activation wiring:
  - `apps/ptah-extension-vscode/src/main.ts:53-69`: Root `activate(context)` function orchestrates activation.
  - `apps/ptah-extension-vscode/src/main.ts:57`: Invokes `bootstrapVscode(context)` (`apps/ptah-extension-vscode/src/activation/bootstrap.ts:156-157`), which calls `registerSetupAgentsCommand` and `registerCaptureCpuProfileCommand`.
  - `apps/ptah-extension-vscode/src/main.ts:61-66`: Invokes `registerPostInit(context, ...)` (`apps/ptah-extension-vscode/src/activation/post-init.ts:31-34`), which instantiates `PtahExtension`, calls `ptahExtension.initialize()` (which executes `registerWebviews()`, registering `ptah.openFullPanel`, `ptah.openDashboard`, `ptah.openOrchestraCanvas`, and `ptah.toggleChat`), and calls `ptahExtension.registerAll()` (which resolves `LicenseCommands` and executes `licenseCommands.registerCommands(context)`).

---

## Q2. Command RPC Allowlist and Invocation

- Allowlist definition in `libs/backend/rpc-handlers/src/lib/handlers/command-rpc.handlers.ts:28-40`:
  - `libs/backend/rpc-handlers/src/lib/handlers/command-rpc.handlers.ts:28-29`:
    ```ts
    /** Every Ptah-owned command is addressable by the webview that ships with it. */
    const ALLOWED_COMMAND_PREFIXES = ['ptah.'];
    ```
  - `libs/backend/rpc-handlers/src/lib/handlers/command-rpc.handlers.ts:35-40`:
    ```ts
    const ALLOWED_EXACT_COMMANDS = [
      // Reload after an auth/config change that needs a fresh window.
      'workbench.action.reloadWindow',
      // Open-folder dialog behind the setup widget's no-workspace guard.
      'workbench.action.files.openFolder',
    ];
    ```
- Gate evaluation in `libs/backend/rpc-handlers/src/lib/handlers/command-rpc.handlers.ts:67-75, 122-127`:
  - `libs/backend/rpc-handlers/src/lib/handlers/command-rpc.handlers.ts:67-75`: Blocks unapproved commands with warning log and returns `{ success: false, error: 'Command not allowed from webview...' }`.
  - `libs/backend/rpc-handlers/src/lib/handlers/command-rpc.handlers.ts:122-127`:
    ```ts
    function isAllowed(command: string): boolean {
      return ALLOWED_COMMAND_PREFIXES.some((prefix) => command.startsWith(prefix)) || ALLOWED_EXACT_COMMANDS.includes(command);
    }
    ```
- Webview invocation:
  - RPC method name: `'command:execute'` (registered at `libs/backend/rpc-handlers/src/lib/handlers/command-rpc.handlers.ts:45, 61`).
  - Webview call sites: Injected `rpcService.call('command:execute', { command, args })` across Angular components (e.g. `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/setup-status-widget.component.ts:186`, `libs/frontend/chat/src/lib/settings/settings.component.ts:171, 191, 213`, `libs/frontend/chat/src/lib/settings/license/license-status-card.component.ts:330, 408`).
  - Params shape in `libs/shared/src/lib/types/rpc/rpc-misc.types.ts:311-316`:
    ```ts
    export interface CommandExecuteParams {
      /** VS Code command ID to execute (must match whitelist: ptah.* prefix or exact match) */
      command: string;
      /** Optional arguments for the command */
      args?: unknown[];
    }
    ```
  - Response shape in `libs/shared/src/lib/types/rpc/rpc-misc.types.ts:321-326`:
    ```ts
    export interface CommandExecuteResponse {
      /** Whether command executed successfully */
      success: boolean;
      /** Error message if failed */
      error?: string;
    }
    ```
  - Registry typing in `libs/shared/src/lib/types/rpc.types.ts:950-953`:
    ```ts
    'command:execute': {
      params: CommandExecuteParams;
      result: CommandExecuteResponse;
    };
    ```

---

## Q3. Git Extension API and TextDocumentContentProvider

- Built-in Git extension API: **NOT FOUND**.
  - Searched patterns across all files in `apps/` and `libs/`: `vscode.extensions.getExtension('vscode.git')`, `getExtension("vscode.git")`, `toGitUri`.
  - No backend or extension host code accesses the `vscode.git` extension API or creates Git URIs.
- `vscode.diff` / `vscode.changes` execution: **NOT FOUND**.
  - Searched patterns across `apps/` and `libs/`: `executeCommand('vscode.diff')`, `executeCommand('vscode.changes')`, and regex `executeCommand\(['"][^'"]*diff`.
  - No backend code executes these commands.
- `TextDocumentContentProvider` registration: **NOT FOUND**.
  - Searched patterns across `apps/` and `libs/`: `registerTextDocumentContentProvider`, `TextDocumentContentProvider`.
  - No `TextDocumentContentProvider` is implemented or registered anywhere in the repository (occurrences are strictly inside `.vscode-test/.../vscode.d.ts` type declarations).

---

## Q4. Workspace Containment Helpers

- `libs/backend/platform-core/src/utils/path-containment.ts:64-74`: `isPathWithinRoots(candidate: string, roots: readonly string[], platform: NodeJS.Platform = process.platform): boolean`
  - The authoritative, pure path containment predicate in `platform-core`. Canonicalizes paths via `normalize` (resolves relative components, replaces backslashes with forward slashes, folds case on win32 only, strips trailing slashes) and verifies candidate is equal to or starts with `root + '/'`.
- `libs/backend/rpc-handlers/src/lib/utils/workspace-authorization.ts:13-22`: `isAuthorizedWorkspace(workspacePath: string, workspaceProvider: IWorkspaceProvider): boolean`
  - RPC boundary helper that checks whether `workspacePath` is an authorized workspace root or descendant by delegating directly to `isPathWithinRoots(workspacePath, workspaceProvider.getWorkspaceFolders())`.
- Additional workspace containment helpers:
  - `libs/backend/workspace-intelligence/src/ast/import-resolution/manifest-reader.ts:238-243`: `isInside(filePath: string, dir: string): boolean` (case-folded prefix check with trailing slash enforcement).
  - `apps/ptah-electron/src/services/electron-ide-capabilities.ts:1553-1555`: `isInsideDirectory(filePath: string, dir: string): boolean` (case-normalized comparison ensuring `comparablePath(filePath).startsWith(`${comparablePath(dir)}/`)`).
  - `libs/backend/platform-core/src/utils/workspace-path-guards.ts:25-59`: `isUnsafeWorkspacePath(candidate, platformInfo)` (rejects candidate if empty, root filesystem, app install directory, or global storage directory).

---

## Q5. DI Registration of GitInfoService

- VS Code extension DI registration (`apps/ptah-extension-vscode/src/di/phase-3-handlers.ts:58-60`):
  ```ts
  container.register(TOKENS.GIT_INFO_SERVICE, {
    useFactory: (c) => new GitInfoService(c.resolve(TOKENS.LOGGER)),
  });
  ```
- CLI Engine DI registration (`libs/backend/cli-engine/src/lib/container.ts:445-447`):
  ```ts
  container.register(TOKENS.GIT_INFO_SERVICE, {
    useFactory: (c) => new GitInfoService(c.resolve(TOKENS.LOGGER)),
  });
  ```
- Electron app DI registration (`apps/ptah-electron/src/di/phase-4-handlers.ts:117-120`):
  ```ts
  const gitInfoService = new GitInfoService(logger, gitSpawner);
  container.register(TOKENS.GIT_INFO_SERVICE, {
    useValue: gitInfoService,
  });
  ```
  (Where `gitSpawner` is resolved from `SDK_TOKENS.SDK_PROCESS_SPAWNER` at lines 114-116 to keep `GitInfoService` off-thread).
- DI Token definition:
  - Token name: `TOKENS.GIT_INFO_SERVICE`
  - Definition in `libs/backend/vscode-core/src/di/tokens.ts:165`:
    ```ts
    export const GIT_INFO_SERVICE = Symbol.for('GitInfoService');
    ```
  - Exported as part of `TOKENS` object in `libs/backend/vscode-core/src/di/tokens.ts:282`:
    ```ts
    export const TOKENS = {
      ...
      GIT_INFO_SERVICE,
      ...
    } as const;
    ```
  - Cross-runtime notes in `apps/ptah-electron/src/di/electron-tokens.ts:5-7`:
    Explains that `GIT_INFO_SERVICE` lives in `@ptah-extension/vscode-core` `TOKENS` so all three hosts (VS Code, Electron, CLI) share the same `Symbol.for('GitInfoService')`.

---

## Q6. Electron Git Watcher Service

- File: `apps/ptah-electron/src/services/git-watcher.service.ts`
- Public methods:
  - `apps/ptah-electron/src/services/git-watcher.service.ts:266-344`: `start(workspacePath: string, broadcast: (type: string, payload: unknown) => void): void` — cleans up existing state and begins watching git and workspace roots.
  - `apps/ptah-electron/src/services/git-watcher.service.ts:383-404`: `switchWorkspace(workspacePath: string): void` — debounces rapid workspace switches and restarts watching on target.
  - `apps/ptah-electron/src/services/git-watcher.service.ts:409-451`: `stop(): void` — stops all timers, closes file system watchers, and disposes workspace subscriptions.
- Construction and starting:
  - Called in `apps/ptah-electron/src/activation/boot-heavy-services.ts:403-410` during background service bootstrap once `workspaceRoot` is known:
    ```ts
    const watcher = new GitWatcherService(gitInfoSvc, logger, workspaceWatcher);
    watcher.start(workspaceRoot, (type, payload) => {
      webviewManager.broadcastMessage(type, payload);
    });
    refs.gitWatcher = watcher;
    ```
- FS Watch API used:
  - Git repository files: Uses Node.js built-in `fs.watch` (non-recursive) via `watchFile` (line 520) and `watchDirectory` (line 550) on `.git/HEAD`, `.git/index`, `.git/refs/`, and `.git/worktrees/`.
  - Workspace root: Does not watch workspace directly on the main thread; delegates to `IWorkspaceWatcher` (`PLATFORM_TOKENS.WORKSPACE_WATCHER`) at lines 473-490 (`this.workspaceWatcher.watch(workspaceRoot, ...)`).
- Usage of `@parcel/watcher` in `apps/ptah-electron`:
  - `apps/ptah-electron` configures options via `apps/ptah-electron/src/services/platform/electron-workspace-watch-host-factory.ts:109` and binds `ElectronWorkspaceWatcher` at `apps/ptah-electron/src/di/phase-0-platform.ts:50`.
  - The actual `@parcel/watcher` module load resides in `libs/backend/platform-electron/src/workspace-watch/parcel-watcher-engine.ts:28` (`return toWorkspaceWatchEngine(require('@parcel/watcher'));`) and `libs/backend/platform-cli/src/workspace-watch/workspace-watch-host.entry.ts:43`.
- Push events and payload types:
  - Emits `git:status-update` (`MESSAGE_TYPES.GIT_STATUS_UPDATE`) at lines 85, 941.
    - Payload type: `GitStatusUpdatePayload` (`libs/shared/src/lib/types/messages/git-status.ts:38-50`).
  - Emits `file:content-changed` (`MESSAGE_TYPES.FILE_CONTENT_CHANGED`) at lines 88, 800.
    - Payload type: `FileContentChangedPayload` (`libs/shared/src/lib/types/messages/payload-map.ts:129, 384`).
  - Note on `git:worktreeChanged`: `GitWatcherService` does **NOT** emit `git:worktreeChanged`. `git:worktreeChanged` is emitted only when the agent/SDK adds or removes a worktree in `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/git-namespace.builder.ts:130-166` with payload `GitWorktreeChangedNotification` (`libs/shared/src/lib/types/rpc/rpc-git.types.ts:200-220`).

---

## Q7. Electron External Editor Launcher

- RPC backend registration:
  - `libs/backend/rpc-handlers/src/lib/handlers/editor-rpc.handlers.ts:50-54, 70-79`: Registers `editor:detectTargets`, `editor:openFile`, and `editor:openWorkspace`.
  - Delegates execution to injected `IEditorLauncher` (`PLATFORM_TOKENS.EDITOR_LAUNCHER`).
  - In Electron DI (`apps/ptah-electron/src/di/phase-2-libraries.ts:195-199`), `PLATFORM_TOKENS.EDITOR_LAUNCHER` is registered with `ElectronEditorLauncher` (`libs/backend/platform-electron/src/implementations/electron-editor-launcher.ts`).
- Spawning mechanism:
  - `ElectronEditorLauncher.openFile` (`libs/backend/platform-electron/src/implementations/electron-editor-launcher.ts:41-48`): Builds launch arguments with `prepareEditorFileLaunch` and calls `spawnEditorProcess(this.spawner, target, launch.args, launch.cwd)`.
  - `spawnEditorProcess` (`libs/backend/platform-core/src/utils/editor-launcher-detection.ts:550-568`): Calls `spawner.spawnProcess` with `command: normalizeAbsolute(target.executablePath, 'Editor executable')`, `args`, `cwd`, `detached: process.platform !== 'win32'`, and `needsConsole: false`. It explicitly does **NOT** use `shell: true` (documented: _"Launch a detected editor executable using argv, never a shell command"_).
  - Concrete Spawner: `OffThreadProcessSpawner` (`libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.ts:715-740`), bound via `SDK_TOKENS.SDK_PROCESS_SPAWNER`.
- Windows `.cmd` shim handling (e.g. `code.cmd`):
  - In Target Detection: `libs/backend/platform-core/src/utils/editor-launcher-detection.ts:218-228, 342-356` uses `pathExtensions` to parse `PATHEXT` (default `.COM;.EXE;.BAT;.CMD`), resolves candidate combinations (`${definition.command}${extension}`), and finds the `.cmd` shim on disk.
  - In Process Spawning: `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.ts:160-177, 715-720` routes through `parseCommand` (invoking `cross-spawn`'s `_parse` export), which resolves the command against `PATH` and converts Windows `.cmd`/`.bat` wrappers into `cmd.exe /d /s /c "..."` with `windowsVerbatimArguments: true`, safely executing the batch shim without needing `shell: true`.

---

## Q8. `gh` CLI Usage

- `gh` CLI usage in `libs/backend` or `apps`: **NOT FOUND**.
  - Searched across all production code in `libs/backend` and `apps/` for spawns or executions of the `gh` binary (`spawn.*\bgh\b`, `execFile.*\bgh\b`, `command:\s*['"]gh['"]`, `\bgh\s+auth`, `\bgh\s+pr`, `\bgh\s+issue`).
  - No production code invokes or references `gh`.
  - Only mock appearance: `libs/backend/harness-sync/src/lib/targets/mcp/codex-toml-mcp-facet.spec.ts:196, 202` (test case testing command formatting for `npx -y gh`).

---

## Uncertain

- None. All eight questions yielded definitive code citations or exhaustive negative findings with cited search patterns across the codebase.
