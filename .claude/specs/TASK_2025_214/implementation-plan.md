# Implementation Plan - TASK_2025_214: Electron Plugin & Setup Wizard Integration

## Codebase Investigation Summary

### Libraries Discovered

- **agent-sdk** (`libs/backend/agent-sdk/src/`): Contains `PluginLoaderService`, `SkillJunctionService`, `plugin-skill-discovery.ts`

  - Key exports: `PluginLoaderService`, `SkillJunctionService`, `SDK_TOKENS.SDK_PLUGIN_LOADER`, `SDK_TOKENS.SDK_SKILL_JUNCTION`
  - Documentation: `libs/backend/agent-sdk/CLAUDE.md`

- **agent-generation** (`libs/backend/agent-generation/src/`): Contains `SetupWizardService`, `WizardWebviewLifecycleService`

  - Key exports: `SetupWizardService`, `WizardWebviewLifecycleService`, `AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE`
  - Documentation: `libs/backend/agent-generation/CLAUDE.md`

- **platform-core** (`libs/backend/platform-core/src/`): Contains `IWorkspaceProvider`, `IEvent<T>`, `IPlatformInfo`

  - Key exports: `IWorkspaceProvider.onDidChangeWorkspaceFolders`, `PLATFORM_TOKENS`, `createEvent`

- **platform-electron** (`libs/backend/platform-electron/src/`): Contains `ElectronWorkspaceProvider`

  - Key exports: `ElectronWorkspaceProvider`, `registerPlatformElectronServices`

- **rpc-handlers** (`libs/backend/rpc-handlers/src/`): Contains `PluginRpcHandlers`, `SetupRpcHandlers`, `WizardGenerationRpcHandlers`
  - All 3 handler classes already registered in Electron DI container (container.ts:621-681)

### Patterns Identified

1. **Late-Initialization Pattern**: Services like `PluginLoaderService` and `SkillJunctionService` use `initialize()` after DI setup because they need runtime values (`extensionPath`, `workspaceState`). Evidence: `plugin-loader.service.ts:138`, `skill-junction.service.ts:91`, VS Code `main.ts:427-510`.

2. **Build-Time Asset Copy Pattern**: VS Code uses `post-build-copy` target in `project.json` to copy assets from source to dist. Evidence: `apps/ptah-extension-vscode/project.json:39-85` (copies `assets/plugins/` at lines 71-77). Electron uses similar `copy-renderer.js` and `copy-assets.js` scripts. Evidence: `apps/ptah-electron/scripts/copy-assets.js`.

3. **Platform Shim Pattern**: Electron DI container registers shims for VS Code-specific tokens (CONFIG_MANAGER, EXTENSION_CONTEXT, FILE_SYSTEM_MANAGER, CODE_EXECUTION_MCP). Evidence: `container.ts:256-614`.

4. **Electron RPC Handler Registration**: All 16 shared handlers + 7 Electron-specific handlers registered in container.ts and orchestrated by `ElectronRpcMethodRegistrationService`. Evidence: `container.ts:621-755`, `rpc-method-registration.service.ts:100-196`.

### Critical Findings

1. **Plugin assets only exist under VS Code app**: `apps/ptah-extension-vscode/assets/plugins/` (4 plugins, 200 files, 1.9MB). Electron has no copy step for these. Evidence: `apps/ptah-electron/project.json` has no reference to plugins.

2. **PluginLoaderService is registered but never initialized in Electron**: `registerSdkServices(container, logger)` registers it (container.ts:488), but `main.ts` never calls `pluginLoader.initialize()`. Evidence: Grep of `apps/ptah-electron/src/main.ts` shows no plugin/skill initialization.

3. **SkillJunctionService is registered but never initialized/activated in Electron**: Same as above - registered via `registerSdkServices()` but never called. Evidence: Grep of `apps/ptah-electron/src/main.ts` shows no `SkillJunction` references.

4. **WizardWebviewLifecycleService has unresolvable dependencies in Electron**: It injects `TOKENS.WEBVIEW_MESSAGE_HANDLER` and `TOKENS.WEBVIEW_HTML_GENERATOR` which are NOT registered in Electron. Evidence: Grep of `apps/ptah-electron/` for these tokens returns no matches. Service definition: `webview-lifecycle.service.ts:72-79`.

5. **SetupWizardService depends on WizardWebviewLifecycleService for VS Code panel creation**: The service calls `createWizardPanel()` which creates a `vscode.WebviewPanel` - this is fundamentally VS Code-specific. Evidence: `setup-wizard.service.ts:80`.

6. **ElectronWorkspaceProvider.onDidChangeWorkspaceFolders already fires properly**: The `createEvent<void>()` utility creates a working event system, and `fireFoldersChange()` is called from `setWorkspaceFolders()`, `addFolder()`, `removeFolder()`, `setActiveFolder()`. Evidence: `electron-workspace-provider.ts:38-44, 82-169`.

7. **Frontend wizard works via in-app navigation, NOT webview panels**: The `WizardViewComponent` is rendered inside the Angular SPA via signal-based view switching (`AppStateManager.currentView() === 'setup-wizard'`). Evidence: `app-shell.component.ts:38,72,93`, `app-state.service.ts:12-19`.

8. **`IPlatformInfo.extensionPath` maps to `app.getAppPath()` in Electron**: This is the Electron app's root directory where `main.js` lives in dist. Evidence: `platform-electron/src/registration.ts:87`.

---

## Architecture Design

### Design Philosophy

**Chosen Approach**: Minimal-touch integration following existing patterns

**Rationale**: The core services (`PluginLoaderService`, `SkillJunctionService`, plugin-skill-discovery) are already platform-agnostic. They use `IStateStorage` and `IWorkspaceProvider` abstractions, and pure Node.js `fs` operations. The only gaps are:

1. Plugin asset files aren't available at `extensionPath/assets/plugins/` in Electron
2. Service initialization calls are missing from Electron `main.ts`
3. SetupWizardService uses VS Code webview panel API (needs Electron alternative)

**Evidence**: Context.md confirms "Already Portable (no changes needed)" for `plugin-loader.service.ts`, `plugin-skill-discovery.ts`, `plugin-rpc.handlers.ts`, `wizard-generation-rpc.handlers.ts`, `setup-rpc.handlers.ts`, and all wizard Angular components.

---

### Component 1: Shared Plugin Assets via Build-Time Copy

**Purpose**: Make plugin assets available in the Electron dist directory at `assets/plugins/` so `PluginLoaderService.resolvePluginPaths()` can find them.

**Pattern**: Build-time copy (matching VS Code `post-build-copy` pattern)
**Evidence**: VS Code `project.json:71-77` copies plugins during build. Electron `copy-assets.js` copies `src/assets/` to dist. Both apps already have build-time copy infrastructure.

**Decision Against Alternatives**:

- **Shared workspace lib**: Over-engineered for static markdown/JSON files (200 files, 1.9MB). Nx libs are for TypeScript code, not raw assets. No precedent in this codebase.
- **Symlink**: Fragile across platforms, breaks in packaged Electron apps (asar), no precedent.
- **Move to shared location**: Would break VS Code's `extensionPath + '/assets/plugins/'` path resolution without touching PluginLoaderService.

**Chosen Approach**: Add a build-time copy command to the Electron `project.json` that copies `apps/ptah-extension-vscode/assets/plugins/` to `dist/apps/ptah-electron/assets/plugins/`. This keeps the source of truth in one place (VS Code app) and mirrors it at build time.

**Additionally**: Copy `libs/backend/agent-generation/templates/` to `dist/apps/ptah-electron/templates/` for `TemplateStorageService` (already needed; VS Code does this at project.json:67-69).

**Responsibilities**:

- Copy `assets/plugins/` from VS Code source to Electron dist at build time
- Copy `templates/` from agent-generation to Electron dist at build time
- Include both in `electron-builder.yml` via `files` glob (already covers `**/*`)

**Quality Requirements**:

- Functional: `fs.existsSync(path.join(extensionPath, 'assets', 'plugins', 'ptah-core'))` returns true after build
- Functional: Plugin path resolution produces valid paths at runtime
- Non-functional: Build-time copy adds < 2s to build (1.9MB copy)

**Files Affected**:

- `D:\projects\ptah-extension\apps\ptah-electron\project.json` (MODIFY) - Add copy commands to `build` target and create a `post-build-copy` target
- `D:\projects\ptah-extension\apps\ptah-electron\scripts\copy-assets.js` (MODIFY) - Extend to also copy plugins and templates directories

---

### Component 2: Electron Plugin Initialization in main.ts

**Purpose**: Initialize `PluginLoaderService` and `SkillJunctionService` in the Electron bootstrap, mirroring VS Code's `main.ts` Steps 7.1.5 and 7.1.5.1.

**Pattern**: Late-initialization after DI setup, fire-and-forget non-fatal
**Evidence**: VS Code `main.ts:427-510` shows the exact initialization sequence. Services use `initialize()` method pattern (plugin-loader.service.ts:138, skill-junction.service.ts:91).

**Responsibilities**:

1. **PluginLoaderService initialization** (after Phase 4.5 in main.ts):

   - Resolve `SDK_TOKENS.SDK_PLUGIN_LOADER` from container
   - Call `pluginLoader.initialize(app.getAppPath(), workspaceStateStorage)`
   - Wire plugin paths into `CommandDiscoveryService.setPluginPaths()`

2. **SkillJunctionService activation** (after PluginLoader init):

   - Resolve `SDK_TOKENS.SDK_SKILL_JUNCTION` from container
   - Call `skillJunction.initialize(app.getAppPath())`
   - Call `skillJunction.activate(pluginPaths, getPluginPathsCallback)`
   - This enables workspace `.claude/skills/` junctions for third-party CLI providers

3. **Deactivation**: Add `skillJunction.deactivateSync()` to `app.on('will-quit')` handler

**Implementation Pattern** (verified from VS Code main.ts:427-510):

```typescript
// After Phase 4.5 (RPC registration complete)
// Phase 4.55: Plugin initialization
try {
  const pluginLoader = container.resolve<PluginLoaderService>(SDK_TOKENS.SDK_PLUGIN_LOADER);
  const workspaceStateStorage = container.resolve<IStateStorage>(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE);
  pluginLoader.initialize(app.getAppPath(), workspaceStateStorage);

  const pluginConfig = pluginLoader.getWorkspacePluginConfig();
  const pluginPaths = pluginLoader.resolvePluginPaths(pluginConfig.enabledPluginIds);

  // Wire into command discovery for slash command autocomplete
  const cmdDiscovery = container.resolve(TOKENS.COMMAND_DISCOVERY_SERVICE) as {
    setPluginPaths: (paths: string[]) => void;
  };
  cmdDiscovery.setPluginPaths(pluginPaths);
  console.log(`[Ptah Electron] Plugin loader initialized (${pluginPaths.length} plugin paths)`);
} catch (error) {
  console.warn('[Ptah Electron] Plugin loader initialization failed (non-fatal):', error instanceof Error ? error.message : String(error));
}

// Phase 4.56: Skill junction activation
try {
  const skillJunction = container.resolve<SkillJunctionService>(SDK_TOKENS.SDK_SKILL_JUNCTION);
  skillJunction.initialize(app.getAppPath());

  const pluginLoader = container.resolve<PluginLoaderService>(SDK_TOKENS.SDK_PLUGIN_LOADER);
  const config = pluginLoader.getWorkspacePluginConfig();
  const paths = pluginLoader.resolvePluginPaths(config.enabledPluginIds);

  skillJunction.activate(paths, () => {
    const c = pluginLoader.getWorkspacePluginConfig();
    return pluginLoader.resolvePluginPaths(c.enabledPluginIds);
  });
  console.log('[Ptah Electron] Skill junctions activated');
} catch (error) {
  console.warn('[Ptah Electron] Skill junction activation failed (non-fatal):', error instanceof Error ? error.message : String(error));
}
```

**Quality Requirements**:

- Functional: `pluginLoader.resolvePluginPaths(['ptah-core'])` returns a valid path after initialization
- Functional: `SkillJunctionService` creates junctions in workspace `.claude/skills/` when plugins are enabled
- Non-functional: Initialization failures MUST NOT crash the app (non-fatal, logged as warnings)
- Non-functional: Skill junction operations are synchronous and non-blocking

**Files Affected**:

- `D:\projects\ptah-extension\apps\ptah-electron\src\main.ts` (MODIFY) - Add Phases 4.55-4.56 and will-quit cleanup

---

### Component 3: Electron Setup Wizard Lifecycle

**Purpose**: Make the setup wizard functional in Electron by replacing the VS Code webview panel approach with in-app Angular navigation.

**Pattern**: RPC-based navigation (no webview panel needed)
**Evidence**: The frontend wizard already renders inside the Angular SPA via `AppStateManager.currentView() === 'setup-wizard'` (app-shell.component.ts:72). In VS Code, the wizard is launched in a separate webview panel. In Electron, the Angular SPA is already the main window - the wizard should simply navigate to the `setup-wizard` view.

**Key Insight**: The `setup-wizard:launch` RPC method (setup-rpc.handlers.ts:186-218) calls `SetupWizardService.launchWizard()` which calls `WizardWebviewLifecycleService.createWizardPanel()` to create a VS Code webview panel. In Electron, we need an alternative that navigates the existing Angular SPA to the wizard view instead.

**Approach: Create ElectronSetupWizardService**

Rather than trying to shim all the VS Code webview APIs, create an Electron-specific `ISetupWizardService` implementation that:

1. Sends a `switchView` message via `WebviewBroadcaster` (already registered as `TOKENS.WEBVIEW_MANAGER` in main.ts:321) to navigate the frontend to `setup-wizard`
2. Signals completion by broadcasting a reload/close message

This replaces `WizardWebviewLifecycleService` (VS Code-specific) without modifying it.

**Responsibilities**:

- Create `ElectronSetupWizardService` implementing `ISetupWizardService`
- Register it in Electron DI container, overriding the default `SetupWizardService` registration from `registerAgentGenerationServices()`
- Use `TOKENS.WEBVIEW_MANAGER` (the `ElectronWebviewManagerAdapter`) to push `switchView` message to renderer
- Handle wizard completion by sending a view-switch back to `chat`

**Implementation Pattern**:

```typescript
// ElectronSetupWizardService - replaces SetupWizardService in Electron
// Uses IPC to navigate the Angular SPA to wizard view instead of creating a webview panel
@injectable()
export class ElectronSetupWizardService implements ISetupWizardService {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger, @inject(TOKENS.WEBVIEW_MANAGER) private readonly webviewManager: WebviewBroadcaster) {}

  async launchWizard(workspacePath: string): Promise<Result<void, Error>> {
    if (!workspacePath) {
      return Result.err(new Error('No workspace folder open'));
    }
    // Send view switch to frontend via IPC
    this.webviewManager.postMessage({
      type: 'switchView',
      payload: { view: 'setup-wizard' },
    });
    return Result.ok(undefined);
  }

  async cancelWizard(): Promise<Result<void, Error>> {
    this.webviewManager.postMessage({
      type: 'switchView',
      payload: { view: 'chat' },
    });
    return Result.ok(undefined);
  }

  getCurrentSession(): null {
    return null;
  }
}
```

**Also needed**: Register a no-op stub for `AGENT_GENERATION_TOKENS.WIZARD_WEBVIEW_LIFECYCLE` in Electron DI container so that `registerAgentGenerationServices()` doesn't fail. The `WizardWebviewLifecycleService` itself needs `WEBVIEW_MESSAGE_HANDLER` and `WEBVIEW_HTML_GENERATOR` which don't exist in Electron. Since `ElectronSetupWizardService` replaces the wizard flow entirely, the lifecycle service is unused, but it must still resolve from DI because `registerAgentGenerationServices()` registers it unconditionally.

**Quality Requirements**:

- Functional: `setup-wizard:launch` RPC method works in Electron (navigates to wizard view)
- Functional: Wizard steps (scan, analyze, recommend, generate) work via existing RPC handlers
- Functional: Wizard completion navigates back to chat view
- Non-functional: No VS Code API dependencies in the Electron wizard path

**Files Affected**:

- `D:\projects\ptah-extension\apps\ptah-electron\src\services\electron-setup-wizard.service.ts` (CREATE) - Electron-specific ISetupWizardService
- `D:\projects\ptah-extension\apps\ptah-electron\src\di\container.ts` (MODIFY) - Override wizard service registration, add stubs for WEBVIEW_MESSAGE_HANDLER and WEBVIEW_HTML_GENERATOR
- `D:\projects\ptah-extension\apps\ptah-electron\src\main.ts` (MODIFY) - Wire wizard completion handler if needed

---

### Component 4: Workspace Change Events for Skill Junctions

**Purpose**: Ensure `SkillJunctionService` properly responds to workspace folder changes in Electron.

**Pattern**: Event subscription via `IWorkspaceProvider.onDidChangeWorkspaceFolders`
**Evidence**: `SkillJunctionService.subscribeToWorkspaceChanges()` (skill-junction.service.ts:259-291) calls `this.workspaceProvider.onDidChangeWorkspaceFolders()`. `ElectronWorkspaceProvider` fires this event from `setWorkspaceFolders()`, `addFolder()`, `removeFolder()`, `setActiveFolder()` (electron-workspace-provider.ts:82-169). The `createEvent<void>()` utility provides working event emitter semantics (platform-core/src/utils/event-emitter.ts:18-28).

**Assessment: NO CHANGES NEEDED**

The `ElectronWorkspaceProvider` already fires `onDidChangeWorkspaceFolders` correctly via `fireFoldersChange()` on all folder mutation methods. The `SkillJunctionService.activate()` method already calls `subscribeToWorkspaceChanges()` which subscribes to this event. Additionally, `main.ts` Phase 2.5 (lines 258-267) subscribes to folder changes for workspace list persistence and already demonstrates the events work.

The only requirement is that `SkillJunctionService.activate()` is called during initialization (Component 2 above), which sets up the subscription.

**Evidence chain**:

1. `ElectronWorkspaceProvider.addFolder()` calls `this.fireFoldersChange()` (electron-workspace-provider.ts:120)
2. `fireFoldersChange` was created by `createEvent<void>()` (electron-workspace-provider.ts:42-44)
3. `SkillJunctionService.subscribeToWorkspaceChanges()` subscribes via `this.workspaceProvider.onDidChangeWorkspaceFolders()` (skill-junction.service.ts:263)
4. Callback re-resolves workspace root and re-creates junctions (skill-junction.service.ts:264-288)
5. `main.ts` already subscribes to the same event for persistence (main.ts:258)

**Quality Requirements**:

- Verified: Events fire when folders are added/removed/changed
- Verified: SkillJunctionService subscribes via platform abstraction, not VS Code API
- Verified: No changes needed to ElectronWorkspaceProvider

---

## Integration Architecture

### Integration Points

1. **PluginLoaderService + Electron DI Container**: Already registered via `registerSdkServices()`. Needs `initialize()` call in `main.ts` with `app.getAppPath()` and `PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE`.

2. **SkillJunctionService + Electron DI Container**: Already registered via `registerSdkServices()`. Needs `initialize()` and `activate()` calls in `main.ts`.

3. **ElectronSetupWizardService + DI Override**: Must be registered AFTER `registerAgentGenerationServices()` to override the default `SetupWizardService` at `AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE`.

4. **Plugin assets + build system**: Build-time copy from VS Code source to Electron dist must happen before Electron launches (part of `build` target dependency chain).

### Data Flow

```
Build Time:
  apps/ptah-extension-vscode/assets/plugins/ --copy--> dist/apps/ptah-electron/assets/plugins/
  libs/backend/agent-generation/templates/   --copy--> dist/apps/ptah-electron/templates/

Runtime (Plugin Init):
  main.ts --> PluginLoaderService.initialize(app.getAppPath(), workspaceStateStorage)
          --> PluginLoaderService.resolvePluginPaths() --> path.join(extensionPath, 'assets', 'plugins', id)
          --> CommandDiscoveryService.setPluginPaths()

Runtime (Skill Junctions):
  main.ts --> SkillJunctionService.initialize(app.getAppPath())
          --> SkillJunctionService.activate(paths, callback)
          --> Creates {workspace}/.claude/skills/{name}/ --> {extensionPath}/assets/plugins/{plugin}/skills/{name}/

Runtime (Wizard Launch):
  Frontend: User clicks "Setup" --> RPC 'setup-wizard:launch'
  Backend:  SetupRpcHandlers --> ElectronSetupWizardService.launchWizard()
            --> WebviewManager.postMessage({ type: 'switchView', payload: { view: 'setup-wizard' } })
  Frontend: AppStateManager handles switchView --> renders WizardViewComponent

Runtime (Wizard Steps):
  Frontend: WizardViewComponent --> RPC 'wizard:deep-analyze', 'wizard:recommend-agents', etc.
  Backend:  SetupRpcHandlers, WizardGenerationRpcHandlers handle all wizard RPCs (already registered)
```

### Dependencies

- **Build dependency**: Electron build depends on plugin source files existing at VS Code path
- **Runtime dependency**: `PluginLoaderService.initialize()` must be called AFTER DI container setup
- **Runtime dependency**: `SkillJunctionService.initialize()` must be called AFTER `PluginLoaderService` init
- **Runtime dependency**: `ElectronSetupWizardService` requires `TOKENS.WEBVIEW_MANAGER` (registered in main.ts:321)
- **DI override dependency**: Wizard service override must happen AFTER `registerAgentGenerationServices()` but BEFORE RPC handler registration (or lazily resolved)

---

## Quality Requirements (Architecture-Level)

### Functional Requirements

- Plugin browser modal works in Electron (list, enable/disable plugins)
- Plugin paths resolve correctly to local filesystem in Electron
- Skill junctions are created in workspace `.claude/skills/` when plugins are enabled
- Skill junctions are cleaned up on workspace change and app quit
- Setup wizard can be launched from Electron UI
- All wizard steps (scan, analyze, recommend, generate) function correctly
- Wizard completion returns user to chat view

### Non-Functional Requirements

- **Performance**: Plugin initialization < 500ms (200 static files, mostly path resolution)
- **Reliability**: All plugin/wizard initialization failures are non-fatal (logged, never crash app)
- **Maintainability**: Reuses existing `PluginLoaderService` and `SkillJunctionService` without modification
- **Build**: Asset copy adds < 2s to build time (1.9MB of markdown files)

### Pattern Compliance

- Must use `PLATFORM_TOKENS` for workspace/state access (verified: PluginLoaderService uses `IStateStorage`, SkillJunctionService uses `IWorkspaceProvider`)
- Must follow Electron DI container phase ordering
- Must not introduce circular dependencies between libs
- Must use `ElectronWebviewManagerAdapter` for renderer communication (not direct IPC)
- Frontend signals/navigation must use `AppStateManager.setCurrentView()` pattern

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**:

- Primary work is in Electron main process (Node.js, DI container, build scripts)
- Plugin loader and skill junction are backend services with filesystem operations
- Wizard service replacement is a backend DI registration override
- Build system modifications (project.json, copy scripts) are infrastructure work
- No Angular component changes needed (frontend wizard already works)

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 4-6 hours

**Breakdown**:

- Component 1 (Build-time copy): ~30min - Straightforward script/config changes
- Component 2 (Plugin init in main.ts): ~1.5hr - Follow VS Code pattern, handle edge cases
- Component 3 (Wizard lifecycle): ~2hr - Create new service, DI overrides, test wizard flow
- Component 4 (Workspace events): ~0min - No changes needed (verified working)
- Integration testing: ~1.5hr - End-to-end verification in Electron

### Files Affected Summary

**CREATE**:

- `D:\projects\ptah-extension\apps\ptah-electron\src\services\electron-setup-wizard.service.ts`

**MODIFY**:

- `D:\projects\ptah-extension\apps\ptah-electron\src\main.ts` (add Plugin/SkillJunction init phases, will-quit cleanup)
- `D:\projects\ptah-extension\apps\ptah-electron\src\di\container.ts` (override wizard service, add stubs for WEBVIEW_MESSAGE_HANDLER and WEBVIEW_HTML_GENERATOR)
- `D:\projects\ptah-extension\apps\ptah-electron\project.json` (add post-build-copy target for plugins and templates)
- `D:\projects\ptah-extension\apps\ptah-electron\scripts\copy-assets.js` (extend to copy plugins/ and templates/ directories)

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **All imports exist in codebase**:

   - `PluginLoaderService` from `@ptah-extension/agent-sdk` (agent-sdk/src/lib/helpers/plugin-loader.service.ts)
   - `SkillJunctionService` from `@ptah-extension/agent-sdk` (agent-sdk/src/lib/helpers/skill-junction.service.ts)
   - `SDK_TOKENS.SDK_PLUGIN_LOADER` from `@ptah-extension/agent-sdk` (agent-sdk/src/lib/di/tokens.ts:85)
   - `SDK_TOKENS.SDK_SKILL_JUNCTION` from `@ptah-extension/agent-sdk` (agent-sdk/src/lib/di/tokens.ts:111)
   - `AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE` from `@ptah-extension/agent-generation` (agent-generation/src/lib/di/tokens.ts)
   - `AGENT_GENERATION_TOKENS.WIZARD_WEBVIEW_LIFECYCLE` from `@ptah-extension/agent-generation` (agent-generation/src/lib/di/tokens.ts)
   - `ISetupWizardService` from `@ptah-extension/agent-generation` (agent-generation/src/lib/interfaces/setup-wizard.interface.ts)
   - `TOKENS.COMMAND_DISCOVERY_SERVICE` from `@ptah-extension/vscode-core` (vscode-core/src/di/tokens.ts:111)
   - `Result` from `@ptah-extension/shared`

2. **All patterns verified from examples**:

   - VS Code plugin init: `apps/ptah-extension-vscode/src/main.ts:427-510`
   - VS Code skill junction init: `apps/ptah-extension-vscode/src/main.ts:463-510`
   - DI container phase pattern: `apps/ptah-electron/src/di/container.ts`
   - Build-time copy pattern: `apps/ptah-extension-vscode/project.json:71-77`
   - Electron asset copy pattern: `apps/ptah-electron/scripts/copy-assets.js`

3. **Library documentation consulted**:

   - `libs/backend/agent-sdk/CLAUDE.md`
   - `libs/backend/agent-generation/CLAUDE.md`
   - `libs/frontend/core/CLAUDE.md`
   - `libs/frontend/setup-wizard/CLAUDE.md`

4. **No hallucinated APIs**:
   - `PluginLoaderService.initialize()`: verified at plugin-loader.service.ts:138
   - `PluginLoaderService.getWorkspacePluginConfig()`: verified at plugin-loader.service.ts:168
   - `PluginLoaderService.resolvePluginPaths()`: verified at plugin-loader.service.ts:228
   - `SkillJunctionService.initialize()`: verified at skill-junction.service.ts:91
   - `SkillJunctionService.activate()`: verified at skill-junction.service.ts:109
   - `SkillJunctionService.deactivateSync()`: verified at skill-junction.service.ts:297
   - `ElectronWorkspaceProvider.onDidChangeWorkspaceFolders`: verified at electron-workspace-provider.ts:27
   - `ISetupWizardService.launchWizard()`: verified at setup-wizard.interface.ts:18
   - `AppStateManager.handleMessage()` with `switchView` type: verified at app-state.service.ts:40-60
   - `MESSAGE_TYPES.SWITCH_VIEW`: verified at app-state.service.ts:38

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended
- [x] Complexity assessed
- [x] No step-by-step implementation (that's team-leader's job)
