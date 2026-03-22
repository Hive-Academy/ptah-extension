# Development Tasks - TASK_2025_214: Electron Plugin & Setup Wizard Integration

**Total Tasks**: 8 | **Batches**: 3 | **Status**: 3/3 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- PluginLoaderService.initialize(extensionPath, workspaceState) signature: Verified at plugin-loader.service.ts:138
- SkillJunctionService.initialize(extensionPath) signature: Verified at skill-junction.service.ts:91
- SkillJunctionService.activate(pluginPaths, getPluginPaths) signature: Verified at skill-junction.service.ts:109
- SkillJunctionService.deactivateSync() exists: Verified at skill-junction.service.ts:297
- SDK_TOKENS.SDK_PLUGIN_LOADER and SDK_TOKENS.SDK_SKILL_JUNCTION tokens: Verified registered via registerSdkServices() in container.ts:488
- AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE registered by registerAgentGenerationServices(): Verified at register.ts:169
- AGENT_GENERATION_TOKENS.WIZARD_WEBVIEW_LIFECYCLE registered: Verified at register.ts:109
- MESSAGE_TYPES.SWITCH_VIEW equals 'switchView': Verified at message.types.ts:297
- AppStateManager handles switchView with payload.view: Verified at app-state.service.ts:38-62
- ElectronWebviewManagerAdapter.broadcastMessage(type, payload) is the correct API: Verified at webview-manager-adapter.ts:64
- VS Code post-build-copy copies plugins at project.json:71-77: Verified
- VS Code post-build-copy copies templates at project.json:67-69: Verified

### Risks Identified

| Risk | Severity | Mitigation |
|------|----------|------------|
| COMMAND_DISCOVERY_SERVICE token not registered in Electron DI container (container.ts has no registration) | MEDIUM | Task 2.1 must add a no-op stub for this token before calling setPluginPaths(). Alternatively, guard with try/catch and skip if not registered. |
| Implementation plan uses `webviewManager.postMessage({type, payload})` but actual API is `broadcastMessage(type: string, payload: unknown)` | HIGH | Task 2.3 must use `broadcastMessage('switchView', { view: 'setup-wizard' })` instead of postMessage. Corrected in task specs below. |
| ISetupWizardService not exported from @ptah-extension/agent-generation barrel (interfaces/index.ts does not list it) | MEDIUM | Task 2.3 must import directly from the interface file path or add it to barrel. Using direct relative path import from the lib is preferred. |
| cancelWizard interface signature is `cancelWizard(sessionId: string, saveProgress: boolean)` but plan shows no-args version | LOW | Task 2.3 must match the interface exactly with both params (sessionId, saveProgress). |
| No existing `will-quit` or `app.on('quit')` handler in Electron main.ts for cleanup | LOW | Task 2.2 must add `app.on('will-quit')` handler for SkillJunctionService.deactivateSync(). |

### Edge Cases to Handle

- [ ] Plugin assets directory doesn't exist at build time (VS Code assets not yet built) -> Task 1.1 must handle gracefully
- [ ] PluginLoaderService.initialize() fails because assets dir missing -> Task 2.1 wraps in try/catch (non-fatal)
- [ ] SkillJunctionService.activate() fails because no workspace is open -> Task 2.2 wraps in try/catch (non-fatal)
- [ ] WizardWebviewLifecycleService resolution fails because WEBVIEW_MESSAGE_HANDLER/WEBVIEW_HTML_GENERATOR not registered -> Task 2.3 must register stubs BEFORE registerAgentGenerationServices()
- [ ] Wizard launched with no workspace open -> Task 2.3 ElectronSetupWizardService must check workspace path

---

## Batch 1: Build-Time Asset Copy [IMPLEMENTED]

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: None

### Task 1.1: Extend copy-assets.js to Copy Plugins and Templates [IMPLEMENTED]

**File**: `D:\projects\ptah-extension\apps\ptah-electron\scripts\copy-assets.js`
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: Component 1 (lines 69-98)
**Pattern to Follow**: Current copy-assets.js structure (copy-assets.js:1-37), VS Code project.json:67-77 for source paths

**Quality Requirements**:
- Copy `apps/ptah-extension-vscode/assets/plugins/` to `dist/apps/ptah-electron/assets/plugins/`
- Copy `libs/backend/agent-generation/templates/` to `dist/apps/ptah-electron/templates/`
- Clean old plugin/template directories before copying (same pattern as line 19-22 in current script)
- Handle missing source directories gracefully with warning (not exit(1)) since plugin source may not exist during initial dev builds
- Keep existing `src/assets` copy logic intact

**Implementation Details**:
- Add two new copy sections after the existing assets copy (line 34)
- Plugin source: `path.resolve(__dirname, '../../../apps/ptah-extension-vscode/assets/plugins')`
- Plugin dest: `path.resolve(__dirname, '../../../dist/apps/ptah-electron/assets/plugins')`
- Template source: `path.resolve(__dirname, '../../../libs/backend/agent-generation/templates')`
- Template dest: `path.resolve(__dirname, '../../../dist/apps/ptah-electron/templates')`
- Use `fs.cpSync(source, dest, { recursive: true })` matching existing pattern at line 34
- Use `fs.rmSync(dest, { recursive: true, force: true })` for clean copy matching existing pattern at line 20
- For missing sources: log warning with `console.warn` and continue (do NOT `process.exit(1)`) since plugins may not be present during partial builds

**Acceptance Criteria**:
- After `nx build ptah-electron`, `dist/apps/ptah-electron/assets/plugins/ptah-core/` exists
- After `nx build ptah-electron`, `dist/apps/ptah-electron/templates/` exists
- Existing `src/assets` copy still works (icons, images not broken)
- Script handles missing plugin source directory without crashing

---

### Task 1.2: Add copy-assets Target to Electron project.json Build Pipeline [IMPLEMENTED]

**File**: `D:\projects\ptah-extension\apps\ptah-electron\project.json`
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: Component 1 (lines 96-97)
**Pattern to Follow**: VS Code `post-build-copy` target at apps/ptah-extension-vscode/project.json:39-85; Electron's existing `copy-renderer` target at project.json:65-74

**Quality Requirements**:
- Asset copy runs as part of the build pipeline so plugins are available at runtime
- Both `serve` and `package` commands pick up the copied assets
- Does not break existing build targets

**Implementation Details**:
- Add a new `"copy-assets"` target to project.json that runs `node apps/ptah-electron/scripts/copy-assets.js`
- Pattern: Same as existing `"copy-renderer"` target (project.json:65-74) which runs a node script
- Wire it into the `"serve"` target: add `"nx copy-assets ptah-electron"` command AFTER `"nx copy-renderer ptah-electron"` (line 80, before the launch.js command at line 81)
- Wire it into `"package"` target: add `"copy-assets"` to the `dependsOn` array alongside existing `["build", "copy-renderer"]` at line 99

**Target definition to add (after line 74, before "serve")**:
```json
"copy-assets": {
  "executor": "nx:run-commands",
  "options": {
    "commands": [
      {
        "command": "node apps/ptah-electron/scripts/copy-assets.js"
      }
    ]
  }
}
```

**Acceptance Criteria**:
- `nx copy-assets ptah-electron` runs successfully and copies plugin + template files
- `nx serve ptah-electron` includes the copy-assets step
- `nx package ptah-electron` includes the copy-assets step via dependsOn
- Existing `build`, `build-dev`, `copy-renderer`, `serve`, `package` targets still work

---

**Batch 1 Verification**:
- Both files modified correctly
- `nx copy-assets ptah-electron` succeeds
- `dist/apps/ptah-electron/assets/plugins/ptah-core/` exists after copy
- `dist/apps/ptah-electron/templates/` exists after copy
- Build passes: `nx build ptah-electron`
- code-logic-reviewer approved

---

## Batch 2: Plugin Initialization, Skill Junction Activation, and Wizard Service [IMPLEMENTED]

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 1 (assets must be available at runtime paths)

### Task 2.1: Add Plugin Loader Initialization to Electron main.ts [IMPLEMENTED]

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\main.ts`
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: Component 2 (lines 101-173), specifically PluginLoaderService initialization
**Pattern to Follow**: VS Code main.ts:427-460 (Step 7.1.5 plugin loader init)

**Quality Requirements**:
- PluginLoaderService.initialize() called with app.getAppPath() and workspace state storage
- Plugin paths wired into CommandDiscoveryService (if registered)
- Failure is non-fatal (logged as warning, never crashes app)
- Runs AFTER Phase 4.5 (RPC registration) and BEFORE Phase 4.6 (session auto-discovery)

**Implementation Details**:
- Add Phase 4.55 between existing Phase 4.5 (line 354) and Phase 4.6 (line 360)
- Import `PluginLoaderService` type from `@ptah-extension/agent-sdk` (already has SDK_TOKENS imported at line 21)
- Import `IStateStorage` from `@ptah-extension/platform-core` (already imported at line 17-19)
- Resolve `SDK_TOKENS.SDK_PLUGIN_LOADER` from container
- Call `pluginLoader.initialize(app.getAppPath(), workspaceStateStorage)` where workspaceStateStorage is resolved from `PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE`
- Call `pluginLoader.getWorkspacePluginConfig()` and `pluginLoader.resolvePluginPaths(config.enabledPluginIds)`
- RISK MITIGATION: `COMMAND_DISCOVERY_SERVICE` is NOT registered in Electron container. Use `container.isRegistered(TOKENS.COMMAND_DISCOVERY_SERVICE)` guard before resolving. If not registered, log info and skip. Example pattern from the codebase: `container.isRegistered()` is used at enhanced-prompts-rpc.handlers.ts:693
- Entire block wrapped in try/catch with `console.warn('[Ptah Electron] Plugin loader initialization failed (non-fatal):')` matching existing error handling patterns (main.ts:338-343)

**Key Imports Already Present**:
- `SDK_TOKENS` at line 21
- `PLATFORM_TOKENS` at line 15
- `TOKENS` at line 20
- `IStateStorage` at line 17-19

**Key Import Needed**:
- `import type { PluginLoaderService } from '@ptah-extension/agent-sdk';` (add to existing agent-sdk import at line 21-22)

**Acceptance Criteria**:
- Plugin loader initialized after RPC registration
- Console shows `[Ptah Electron] Plugin loader initialized (N plugin paths)` on success
- Console shows warning on failure, app does NOT crash
- If COMMAND_DISCOVERY_SERVICE not registered, skips silently with info log

---

### Task 2.2: Add Skill Junction Activation and Cleanup to Electron main.ts [IMPLEMENTED]

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\main.ts`
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: Component 2 (lines 115-122, 146-163)
**Pattern to Follow**: VS Code main.ts:463-510 (Step 7.1.5.1 skill junctions)

**Quality Requirements**:
- SkillJunctionService initialized and activated after PluginLoaderService init
- Junctions created in workspace `.claude/skills/` when plugins are enabled
- `deactivateSync()` called on app quit for cleanup
- Failure is non-fatal (logged as warning, never crashes app)

**Implementation Details**:
- Add Phase 4.56 immediately after Phase 4.55 (plugin loader init from Task 2.1)
- Import `SkillJunctionService` type from `@ptah-extension/agent-sdk` (add to existing import at line 21-22)
- Resolve `SDK_TOKENS.SDK_SKILL_JUNCTION` from container
- Call `skillJunction.initialize(app.getAppPath())`
- Re-resolve plugin loader (singleton) and get paths
- Call `skillJunction.activate(paths, getPluginPathsCallback)` where callback re-resolves config each time (same as VS Code main.ts:487-490)
- Entire block wrapped in try/catch with `console.warn('[Ptah Electron] Skill junction activation failed (non-fatal):')`
- ALSO: Store the skillJunction reference in a variable accessible to the quit handler (declare `let skillJunction: { deactivateSync: () => void } | null = null;` at the top of the `app.whenReady()` callback, alongside `mainWindow`)
- Add `app.on('will-quit', ...)` handler AFTER the existing `app.on('window-all-closed', ...)` handler at line 467-471. The handler calls `skillJunction?.deactivateSync()` in a try/catch
- NOTE: There is currently NO `will-quit` handler in main.ts. This is a new addition.

**Key Import Needed**:
- `import type { SkillJunctionService } from '@ptah-extension/agent-sdk';` (add to existing agent-sdk import)

**Acceptance Criteria**:
- Skill junctions created after plugin loader init
- Console shows `[Ptah Electron] Skill junctions activated` on success
- Console shows warning on failure, app does NOT crash
- `app.on('will-quit')` handler added that calls `deactivateSync()`
- Junction re-creation works on workspace folder changes (verified via existing event subscription in activate())

---

### Task 2.3: Create ElectronSetupWizardService [IMPLEMENTED]

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\services\electron-setup-wizard.service.ts`
**Action**: CREATE
**Spec Reference**: implementation-plan.md: Component 3 (lines 177-247)
**Pattern to Follow**: SetupWizardService at libs/backend/agent-generation/src/lib/services/setup-wizard.service.ts:22-43 for interface, ElectronWebviewManagerAdapter at apps/ptah-electron/src/ipc/webview-manager-adapter.ts:32-82 for message API

**Quality Requirements**:
- Implements ISetupWizardService interface exactly (3 methods: launchWizard, cancelWizard, getCurrentSession)
- Uses broadcastMessage to send switchView message to frontend
- No VS Code API dependencies
- launchWizard validates workspace path before sending

**Implementation Details**:
- Create new file at `apps/ptah-electron/src/services/electron-setup-wizard.service.ts`
- Import `injectable`, `inject` from `tsyringe`
- Import `TOKENS` and `Logger` type from `@ptah-extension/vscode-core`
- Import `ISetupWizardService` directly from `@ptah-extension/agent-generation` path: `libs/backend/agent-generation/src/lib/interfaces/setup-wizard.interface` -- BUT since this is compiled code using path aliases, import from `@ptah-extension/agent-generation` and reference the interface file. CHECK: The barrel file exports `* from './lib/interfaces'` but interfaces/index.ts does NOT export ISetupWizardService. SOLUTION: Either (a) add the export to the barrel, or (b) define the interface inline matching the contract. Option (b) is safer as it doesn't modify library code. Define a local interface matching `ISetupWizardService` from setup-wizard.interface.ts:12-32.
- Import `Result` from `@ptah-extension/shared`
- Import `MESSAGE_TYPES` from `@ptah-extension/shared`
- The class gets `TOKENS.WEBVIEW_MANAGER` injected (the ElectronWebviewManagerAdapter)
- CRITICAL: The correct API is `broadcastMessage(type: string, payload: unknown)` NOT `postMessage`. The implementation plan's code sample is wrong on this.
- `launchWizard(workspacePath: string)`: Validate workspacePath not empty, call `this.webviewManager.broadcastMessage(MESSAGE_TYPES.SWITCH_VIEW, { view: 'setup-wizard' })`, return `Result.ok(undefined)`
- `cancelWizard(sessionId: string, saveProgress: boolean)`: call `this.webviewManager.broadcastMessage(MESSAGE_TYPES.SWITCH_VIEW, { view: 'chat' })`, return `Result.ok(undefined)`. MUST match interface signature with both params even though they are unused in Electron.
- `getCurrentSession()`: return `null`

**WebviewManager Interface for Typing** (from webview-manager-adapter.ts):
```typescript
interface WebviewBroadcaster {
  broadcastMessage(type: string, payload: unknown): Promise<void>;
}
```

**Acceptance Criteria**:
- File compiles without errors
- Implements all 3 methods of ISetupWizardService
- Uses broadcastMessage (not postMessage)
- launchWizard returns Result.err for empty workspace path
- cancelWizard matches interface signature (sessionId, saveProgress params)
- No VS Code imports

---

### Task 2.4: Register ElectronSetupWizardService and DI Stubs in Container [IMPLEMENTED]

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\di\container.ts`
**Action**: MODIFY
**Spec Reference**: implementation-plan.md: Component 3 (lines 235-245)
**Pattern to Follow**: Existing DI override patterns in container.ts (e.g., Phase 1.6 WORKSPACE_STATE_STORAGE override at line 417), shim pattern at Phase 1.4 CONFIG_MANAGER (line 279-335), Phase 4 CODE_EXECUTION_MCP stub (line 598-614)

**Quality Requirements**:
- ElectronSetupWizardService overrides default SetupWizardService registration
- WEBVIEW_MESSAGE_HANDLER and WEBVIEW_HTML_GENERATOR stubs prevent DI resolution failures
- Stubs registered BEFORE registerAgentGenerationServices() call
- Override registered AFTER registerAgentGenerationServices() call
- Does not break existing container setup

**Implementation Details**:

**Part A: Register WEBVIEW_MESSAGE_HANDLER and WEBVIEW_HTML_GENERATOR stubs**
- Add BEFORE Phase 2.3 (registerAgentGenerationServices at line 491)
- These tokens are required by `WizardWebviewLifecycleService` (registered unconditionally inside `registerAgentGenerationServices`)
- Pattern: Same as CODE_EXECUTION_MCP stub at line 598-614
- Register `TOKENS.WEBVIEW_MESSAGE_HANDLER` with `useValue: {}` (empty no-op object)
- Register `TOKENS.WEBVIEW_HTML_GENERATOR` with `useValue: {}` (empty no-op object)
- TOKENS already imported at line 67
- Add comment: `// TASK_2025_214: Stubs for WizardWebviewLifecycleService (unused in Electron, replaced by ElectronSetupWizardService)`
- Wrap in try/catch matching existing pattern

**Part B: Override SETUP_WIZARD_SERVICE with ElectronSetupWizardService**
- Add AFTER registerAgentGenerationServices() (line 491) so it overrides the default SetupWizardService
- Import `ElectronSetupWizardService` from `'../services/electron-setup-wizard.service'`
- Register: `container.register(AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE, { useClass: ElectronSetupWizardService })`
- This overrides the `SetupWizardService` registered inside `registerAgentGenerationServices()` at register.ts:169
- AGENT_GENERATION_TOKENS already imported at line 23
- Add comment: `// TASK_2025_214: Override with Electron-specific wizard that uses IPC navigation instead of VS Code webview panels`

**Location in container.ts**:
- Part A: Insert new Phase 2.2.5 between Phase 2.2 (registerSdkServices at line 488) and Phase 2.3 (registerAgentGenerationServices at line 491)
- Part B: Insert after Phase 2.3 (line 491), before Phase 2.4 comment (line 493)

**Acceptance Criteria**:
- `TOKENS.WEBVIEW_MESSAGE_HANDLER` resolves from container (even though it's a no-op)
- `TOKENS.WEBVIEW_HTML_GENERATOR` resolves from container (even though it's a no-op)
- `AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE` resolves to `ElectronSetupWizardService` (not `SetupWizardService`)
- Container setup does not throw
- Build passes: `tsc --noEmit --project apps/ptah-electron/tsconfig.app.json`

---

**Batch 2 Verification**:
- All 4 files created/modified correctly
- Build passes: `tsc --noEmit --project apps/ptah-electron/tsconfig.app.json`
- No VS Code API imports in any Electron file
- code-logic-reviewer approved all files
- Validation risks addressed:
  - COMMAND_DISCOVERY_SERVICE guard implemented (Task 2.1)
  - broadcastMessage used instead of postMessage (Task 2.3)
  - cancelWizard signature matches interface (Task 2.3)
  - DI stubs registered before registerAgentGenerationServices (Task 2.4)

---

## Batch 3: Integration Verification [PENDING]

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batch 1 + Batch 2

### Task 3.1: Verify Build Pipeline End-to-End [PENDING]

**File**: N/A (verification task)
**Action**: VERIFY
**Spec Reference**: implementation-plan.md: Quality Requirements (lines 327-353)

**Quality Requirements**:
- Full build succeeds without errors
- All copied assets present in dist directory
- TypeScript compilation passes

**Verification Steps**:
1. Run `nx build ptah-electron` - must succeed
2. Verify `dist/apps/ptah-electron/assets/plugins/ptah-core/` exists
3. Verify `dist/apps/ptah-electron/assets/plugins/ptah-angular/` exists
4. Verify `dist/apps/ptah-electron/assets/plugins/ptah-nx-saas/` exists
5. Verify `dist/apps/ptah-electron/assets/plugins/ptah-react/` exists
6. Verify `dist/apps/ptah-electron/templates/` exists and contains template files
7. Run `tsc --noEmit --project apps/ptah-electron/tsconfig.app.json` - must pass
8. Run `nx lint ptah-electron` - must pass (or only pre-existing warnings)

**Acceptance Criteria**:
- All 8 verification steps pass
- No regressions in existing functionality

---

### Task 3.2: Verify DI Container Resolution [PENDING]

**File**: N/A (verification task)
**Action**: VERIFY
**Spec Reference**: implementation-plan.md: Integration Architecture (lines 277-325)

**Quality Requirements**:
- All new registrations resolve correctly
- DI override takes effect (wizard service is Electron version)
- Stubs prevent resolution failures

**Verification Steps**:
1. Review that `TOKENS.WEBVIEW_MESSAGE_HANDLER` is registered before `registerAgentGenerationServices()` in container.ts
2. Review that `TOKENS.WEBVIEW_HTML_GENERATOR` is registered before `registerAgentGenerationServices()` in container.ts
3. Review that `AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE` override is registered AFTER `registerAgentGenerationServices()` in container.ts
4. Review that Phase 4.55 (plugin init) is after Phase 4.5 (RPC registration) and before Phase 4.6 (session discovery) in main.ts
5. Review that Phase 4.56 (skill junction) is after Phase 4.55 (plugin init) in main.ts
6. Review that `app.on('will-quit')` handler exists and calls `deactivateSync()`
7. Review that ElectronSetupWizardService uses `broadcastMessage` (not `postMessage`)
8. Verify all imports resolve correctly (no missing modules)

**Acceptance Criteria**:
- All ordering constraints satisfied
- All DI registrations are in correct phases
- No circular dependencies introduced

---

**Batch 3 Verification**:
- Build pipeline verified end-to-end
- DI container resolution order verified
- code-logic-reviewer approved
- All validation risks confirmed as addressed
