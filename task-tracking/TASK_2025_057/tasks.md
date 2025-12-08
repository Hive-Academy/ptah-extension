# Development Tasks - TASK_2025_057

**Total Tasks**: 12 | **Batches**: 3 | **Status**: 1/3 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- ✅ SdkAgentAdapter.initialize() method exists (verified sdk-agent-adapter.ts:200)
- ✅ ConfigManager.watch() method exists (verified config-manager.ts:175)
- ✅ AppStateManager.setCurrentView() method exists (verified app-state.service.ts:65-68)
- ✅ ViewType 'settings' already defined (verified app-state.service.ts:10-15)
- ✅ Settings button already exists in AppShellComponent (per revised plan)

### Risks Identified

| Risk                                  | Severity | Mitigation                                             |
| ------------------------------------- | -------- | ------------------------------------------------------ |
| ConfigManager watcher timing issues   | MEDIUM   | Graceful session termination before re-init (Task 2.2) |
| initialize() never called creates bug | HIGH     | Verify placement in main.ts activation flow (Task 1.1) |
| RPC methods missing type validation   | LOW      | Add Zod schema validation to RPC handlers (Task 2.3)   |
| Settings navigation flicker           | LOW      | Use Angular @if for conditional rendering (Task 3.2)   |
| process.env pollution on deactivation | MEDIUM   | Clear auth env vars in deactivate() (Task 1.1 note)    |

### Edge Cases to Handle

- [x] Extension activates with no auth configured → Onboarding UI (Task 1.3)
- [x] User changes auth while session active → Graceful abort (Task 2.2)
- [x] ConfigManager watcher fires before initialize() → Initialize first (Task 2.2)
- [x] Multiple rapid config changes → Debounce or state machine (Task 2.2)
- [x] Settings view unmounts before RPC completes → Handle promise cleanup (Task 3.1)

---

## Batch 1: Backend SDK Initialization Core ✅ COMPLETE

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: None
**Commit**: 14d264d

### Task 1.1: Add SDK Initialize Call to Extension Activation ✅ COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-extension-vscode\src\main.ts
**Spec Reference**: implementation-plan-revised.md:21-29 (Component 1)
**Pattern to Follow**: main.ts:30-49 (existing Step 3.6 RPC registration pattern)

**Quality Requirements**:

- Call SdkAgentAdapter.initialize() after DI Container setup (line 19) but before webview registration
- Handle initialization failure gracefully (no extension crash)
- Log initialization result (success/failure) with actionable error messages
- Return boolean from initialize() to indicate auth status

**Validation Notes**:

- RISK: Placement matters - must be after DIContainer.setup() but before ptahExtension.initialize()
- EDGE CASE: If initialize() fails, extension should still activate (graceful degradation)
- ASSUMPTION: SdkAgentAdapter is already registered in DI container (verify in di/container.ts)

**Implementation Details**:

- Imports: Add TOKENS.SDK_AGENT_ADAPTER from vscode-core
- Location: Insert after Step 3.7 (line 49), before Step 4 (line 52)
- Pattern:
  ```typescript
  // Step 3.8: Initialize SDK authentication
  console.log('[Activate] Step 3.8: Initializing SDK authentication...');
  const sdkAdapter = DIContainer.resolve(TOKENS.SDK_AGENT_ADAPTER);
  const authInitialized = await sdkAdapter.initialize();
  logger.info(authInitialized ? 'SDK authentication initialized' : 'SDK authentication not configured');
  console.log('[Activate] Step 3.8: SDK authentication initialization complete');
  ```
- Deactivation: Add process.env cleanup in deactivate() to prevent env pollution

---

### Task 1.2: Verify DI Token for SdkAgentAdapter ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\vscode-core\src\lib\di\tokens.ts
**Spec Reference**: implementation-plan-revised.md:21-29 (Component 1 prerequisite)
**Dependencies**: None

**Quality Requirements**:

- Verify TOKENS.SDK_AGENT_ADAPTER exists and is correctly typed
- If missing, add DI token following existing pattern
- Ensure token is exported from vscode-core library

**Validation Notes**:

- BLOCKER: If token doesn't exist, Task 1.1 will fail at compile time
- PATTERN: Follow existing token pattern (e.g., TOKENS.LOGGER, TOKENS.CONFIG_MANAGER)

**Implementation Details**:

- Check: libs/backend/vscode-core/src/lib/di/tokens.ts for SDK_AGENT_ADAPTER
- If missing, add:
  ```typescript
  SDK_AGENT_ADAPTER: Symbol.for('SdkAgentAdapter');
  ```
- Verify: Token is registered in di/container.ts (DIContainer.setup)

---

### Task 1.3: Add Onboarding UI for Missing Authentication ✅ COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-extension-vscode\src\core\ptah-extension.ts
**Spec Reference**: implementation-plan-revised.md:21-29 (Component 3)
**Pattern to Follow**: main.ts:122-126 (existing welcome message pattern)

**Quality Requirements**:

- Add showAuthenticationOnboarding() method to PtahExtension class
- Use vscode.window.showInformationMessage() with action buttons
- Action 1: "Open Settings" → opens VS Code settings to ptah section
- Action 2: "Get OAuth Token" → opens external URL (Claude Code setup docs)
- Only show if SdkAgentAdapter.initialize() returns false
- Don't block extension activation

**Validation Notes**:

- EDGE CASE: User dismisses notification → extension remains active, SDK in error state
- UX: Message should be clear and actionable, not alarming
- TIMING: Only trigger if authInitialized === false from Task 1.1

**Implementation Details**:

- Imports: vscode.window, vscode.env (for openExternal)
- Method signature:
  ```typescript
  async showAuthenticationOnboarding(): Promise<void> {
    const action = await vscode.window.showInformationMessage(
      'Ptah requires authentication to use Claude Code. Configure your OAuth token or API key to get started.',
      'Open Settings',
      'Get OAuth Token'
    );
    if (action === 'Open Settings') {
      vscode.commands.executeCommand('workbench.action.openSettings', 'ptah');
    } else if (action === 'Get OAuth Token') {
      vscode.env.openExternal(vscode.Uri.parse('https://docs.anthropic.com/en/docs/agents/quickstart'));
    }
  }
  ```
- Call from main.ts after Task 1.1 if authInitialized === false

---

**Batch 1 Verification**:

- All files exist at paths
- SDK initializes successfully with valid auth
- Onboarding UI appears when no auth configured
- Build passes: `npx nx build ptah-extension-vscode`
- No TypeScript errors
- Extension activates without crashes

---

## Batch 2: Backend Config Watchers & RPC Methods 🔄 IMPLEMENTED

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 1 (SDK initialization must work first)

### Task 2.1: Add ConfigManager Import to SdkAgentAdapter 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts
**Spec Reference**: implementation-plan-revised.md:21-29 (Component 2 prerequisite)
**Dependencies**: Task 1.1 (verifies ConfigManager available)

**Quality Requirements**:

- ConfigManager already injected in constructor (line 20)
- No new imports needed (already exists)
- Verify ConfigManager.watch() method available (verified config-manager.ts:175)

**Validation Notes**:

- ✅ VERIFIED: ConfigManager already injected as this.config
- ✅ VERIFIED: watch() method exists with correct signature
- This is a verification task, no code changes expected

**Implementation Details**:

- Review: sdk-agent-adapter.ts constructor (line 187-194)
- Confirm: this.config is injected ConfigManager instance
- Confirm: watch() method signature: watch(key: string, callback: (value: unknown) => void): vscode.Disposable

---

### Task 2.2: Implement ConfigManager Watcher for Re-initialization 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts
**Spec Reference**: implementation-plan-revised.md:21-29 (Component 2)
**Pattern to Follow**: config-manager.ts:175-194 (watch method usage)
**Dependencies**: Task 2.1

**Quality Requirements**:

- Register ConfigManager watchers in initialize() method (after line 268)
- Watch keys: 'claudeOAuthToken', 'anthropicApiKey', 'authMethod'
- On change: Gracefully terminate active sessions, call this.initialize() to re-init
- Store disposables for cleanup (add to class property: private configWatchers: vscode.Disposable[] = [])
- Unregister watchers in dispose() method if it exists, or create one

**Validation Notes**:

- RISK: Race condition if watcher fires during active session → abort sessions first
- EDGE CASE: Multiple rapid changes → debounce or state machine to prevent concurrent re-init
- TIMING: Watcher fires AFTER config.set() completes (VS Code guarantees this)

**Implementation Details**:

- Add class property:
  ```typescript
  private configWatchers: vscode.Disposable[] = [];
  private isReinitializing = false; // State machine flag
  ```
- In initialize() after line 268, add:

  ```typescript
  // Register config watchers for automatic re-initialization
  const watchKeys = ['claudeOAuthToken', 'anthropicApiKey', 'authMethod'];
  for (const key of watchKeys) {
    const watcher = this.config.watch(key, async (value) => {
      // Prevent concurrent re-initialization
      if (this.isReinitializing) {
        this.logger.debug(`[SdkAgentAdapter] Skipping re-init, already in progress (${key} changed)`);
        return;
      }

      this.logger.info(`[SdkAgentAdapter] Auth config changed (${key}), re-initializing...`);
      this.isReinitializing = true;

      try {
        // Gracefully abort active sessions before re-init
        for (const [sessionId, session] of this.activeSessions.entries()) {
          this.logger.debug(`[SdkAgentAdapter] Aborting session ${sessionId} for re-init`);
          await session.interrupt();
        }
        this.activeSessions.clear();

        // Re-initialize with new auth settings
        await this.initialize();
      } finally {
        this.isReinitializing = false;
      }
    });
    this.configWatchers.push(watcher);
  }
  ```

- Add dispose() method if missing:
  ```typescript
  dispose(): void {
    this.logger.info('[SdkAgentAdapter] Disposing watchers...');
    for (const watcher of this.configWatchers) {
      watcher.dispose();
    }
    this.configWatchers = [];
  }
  ```

---

### Task 2.3: Add Authentication RPC Method Handlers 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc-method-registration.service.ts
**Spec Reference**: implementation-plan-revised.md:21-29 (Component 4)
**Pattern to Follow**: Existing RPC method registration in same file
**Dependencies**: Task 2.2 (re-initialization must work)

**Quality Requirements**:

- Add RPC method: auth:getHealth → returns SdkAgentAdapter.getHealth()
- Add RPC method: auth:saveSettings → accepts params (authMethod, claudeOAuthToken, anthropicApiKey), saves via ConfigManager.set()
- Add RPC method: auth:testConnection → calls getHealth() after brief delay (allow watcher to trigger)
- All methods return structured responses (success/error objects)
- Add Zod schema validation for auth:saveSettings params

**Validation Notes**:

- RISK: RPC params not validated → add Zod schema for type safety
- EDGE CASE: testConnection called before re-init completes → add 500ms delay or poll health status
- SECURITY: Don't return raw credentials in health response

**Implementation Details**:

- Imports: Add Zod for validation, ConfigManager, SdkAgentAdapter
- Add to registerAll() method:

  ```typescript
  // Auth health status
  this.rpcHandler.register('auth:getHealth', async () => {
    const sdkAdapter = DIContainer.resolve(TOKENS.SDK_AGENT_ADAPTER);
    const health = sdkAdapter.getHealth();
    return { success: true, health };
  });

  // Save auth settings
  const AuthSettingsSchema = z.object({
    authMethod: z.enum(['oauth', 'apiKey', 'auto']),
    claudeOAuthToken: z.string().optional(),
    anthropicApiKey: z.string().optional(),
  });

  this.rpcHandler.register('auth:saveSettings', async (params: unknown) => {
    try {
      const validated = AuthSettingsSchema.parse(params);
      const config = DIContainer.resolve(TOKENS.CONFIG_MANAGER);

      await config.set('authMethod', validated.authMethod);
      if (validated.claudeOAuthToken) {
        await config.set('claudeOAuthToken', validated.claudeOAuthToken);
      }
      if (validated.anthropicApiKey) {
        await config.set('anthropicApiKey', validated.anthropicApiKey);
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Validation failed',
      };
    }
  });

  // Test connection (wait for re-init)
  this.rpcHandler.register('auth:testConnection', async () => {
    // Brief delay to allow ConfigManager watcher to trigger re-init
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const sdkAdapter = DIContainer.resolve(TOKENS.SDK_AGENT_ADAPTER);
    const health = sdkAdapter.getHealth();

    return {
      success: health.status === 'available',
      health,
      errorMessage: health.errorMessage,
    };
  });
  ```

---

### Task 2.4: Update RPC Message Types in Shared Library 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\shared\src\lib\types\messages\rpc-messages.ts
**Spec Reference**: implementation-plan-revised.md:21-29 (Component 4 contract)
**Dependencies**: Task 2.3

**Quality Requirements**:

- Add message type definitions for auth:getHealth, auth:saveSettings, auth:testConnection
- Follow existing RPC message pattern in shared library
- Include request and response types

**Validation Notes**:

- TYPE SAFETY: Frontend will use these types for RPC calls
- PATTERN: Follow existing RPC message structure (check file for examples)

**Implementation Details**:

- Add to rpc-messages.ts (if file exists, otherwise check structure):

  ```typescript
  export interface AuthGetHealthRequest {
    type: 'auth:getHealth';
  }

  export interface AuthGetHealthResponse {
    success: boolean;
    health: ProviderHealth;
  }

  export interface AuthSaveSettingsRequest {
    type: 'auth:saveSettings';
    params: {
      authMethod: 'oauth' | 'apiKey' | 'auto';
      claudeOAuthToken?: string;
      anthropicApiKey?: string;
    };
  }

  export interface AuthSaveSettingsResponse {
    success: boolean;
    error?: string;
  }

  export interface AuthTestConnectionRequest {
    type: 'auth:testConnection';
  }

  export interface AuthTestConnectionResponse {
    success: boolean;
    health: ProviderHealth;
    errorMessage?: string;
  }
  ```

---

**Batch 2 Verification**:

- All files exist at paths
- ConfigManager watchers registered successfully
- Changing auth in VS Code settings triggers re-initialization
- RPC methods respond correctly (test via webview console)
- Build passes: `npx nx build agent-sdk && npx nx build ptah-extension-vscode`
- code-logic-reviewer approved
- No memory leaks from watchers

---

## Batch 3: Frontend Settings UI & Navigation ⏸️ PENDING

**Developer**: frontend-developer
**Tasks**: 5 | **Dependencies**: Batch 2 (RPC methods must exist before frontend can call them)

### Task 3.1: Create Settings Components in Chat Library ⏸️ PENDING

**Files**:

- D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\settings.component.ts (CREATE)
- D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\settings.component.html (CREATE)
- D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\auth-config.component.ts (CREATE)
- D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\auth-config.component.html (CREATE)
- D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\index.ts (CREATE - barrel export)

**Spec Reference**: implementation-plan-revised.md:36-153 (Component 5)
**Pattern to Follow**: libs/frontend/chat/src/lib/components/organisms/chat-view.component.ts (signal-based component pattern)

**Quality Requirements**:

- SettingsComponent: Container with sections layout, includes back button
- AuthConfigComponent: Form with auth method radio buttons, masked inputs, connection test button
- Signal-based state: authMethod, oauthToken, apiKey, connectionStatus, errorMessage
- RPC integration: Call auth:saveSettings and auth:testConnection
- Handle promise cleanup on component destroy (avoid memory leaks)

**Validation Notes**:

- EDGE CASE: Component unmounts before RPC completes → store AbortController, abort on destroy
- UX: Show loading spinner during connection test
- PATTERN: Use Angular signals (NOT RxJS BehaviorSubject)

**Implementation Details**:

- Follow implementation-plan-revised.md:52-138 exactly (code provided)
- SettingsComponent:
  - Standalone component
  - Imports: AuthConfigComponent, LucideAngularModule
  - Template: Card layout with authentication section
  - Back button: Calls appState.setCurrentView('chat')
- AuthConfigComponent:
  - Standalone component
  - Imports: FormsModule, LucideAngularModule
  - Inject: VSCodeService (for RPC), AppStateManager
  - Signals: authMethod, oauthToken, apiKey, connectionStatus, errorMessage
  - Methods: saveAndTest() (async, handles RPC calls and errors)
  - Template: Radio buttons, password inputs, save button, status display

---

### Task 3.2: Wire Settings Navigation in AppShellComponent ⏸️ PENDING

**Files**:

- D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.ts (MODIFY)
- D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.html (MODIFY)

**Spec Reference**: implementation-plan-revised.md:156-250 (Component 6)
**Pattern to Follow**: implementation-plan-revised.md:173-239 (code provided)
**Dependencies**: Task 3.1

**Quality Requirements**:

- Add openSettings() and backToChat() methods to AppShellComponent
- Inject AppStateManager and expose currentView signal
- Add click handler to existing Settings button: (click)="openSettings()"
- Conditionally render SettingsComponent or ChatViewComponent based on currentView()
- Use Angular @if syntax (not \*ngIf) for conditional rendering
- No flicker during navigation

**Validation Notes**:

- RISK: Navigation flicker → use @if (synchronous rendering)
- PATTERN: AppStateManager.setCurrentView() already used elsewhere (verified)

**Implementation Details**:

- Modify app-shell.component.ts:

  - Add import: SettingsComponent
  - Inject: AppStateManager (if not already)
  - Add property: readonly currentView = this.appState.currentView;
  - Add methods:

    ```typescript
    openSettings(): void {
      this.appState.setCurrentView('settings');
    }

    backToChat(): void {
      this.appState.setCurrentView('chat');
    }
    ```

- Modify app-shell.component.html:
  - Find Settings button (aria-label="Settings")
  - Add: (click)="openSettings()"
  - Find main content area (class="flex-1 overflow-hidden")
  - Replace with:
    ```html
    <div class="flex-1 overflow-hidden">
      @if (currentView() === 'settings') {
      <ptah-settings />
      } @else {
      <ptah-tab-bar />
      <div class="flex-1 overflow-hidden">
        <ptah-chat-view />
      </div>
      }
    </div>
    ```

---

### Task 3.3: Export Settings Components from Chat Library ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\index.ts (MODIFY)
**Spec Reference**: implementation-plan-revised.md:136-137 (Component 5 exports)
**Dependencies**: Task 3.1

**Quality Requirements**:

- Export SettingsComponent from chat library public API
- Export AuthConfigComponent from chat library public API
- Follow existing export pattern in index.ts

**Validation Notes**:

- PATTERN: Other components already exported from this file
- BUILD: Ensure no circular dependencies

**Implementation Details**:

- Add to libs/frontend/chat/src/index.ts:
  ```typescript
  export { SettingsComponent } from './lib/settings/settings.component';
  export { AuthConfigComponent } from './lib/settings/auth-config.component';
  ```

---

### Task 3.4: Create Settings Component Templates ⏸️ PENDING

**Files**:

- D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\settings.component.html (CREATE)
- D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\auth-config.component.html (CREATE)

**Spec Reference**: implementation-plan-revised.md:262-283 (Component 7 template)
**Dependencies**: Task 3.1

**Quality Requirements**:

- Settings template: Header with back button, authentication card section
- AuthConfig template: Radio buttons, password inputs, save button, status indicators
- Use DaisyUI classes for styling (existing pattern in chat library)
- Accessibility: Proper ARIA labels, keyboard navigation, form labels

**Validation Notes**:

- UX: Back button clearly visible
- UX: Connection status uses icons + text (not just color)
- ACCESSIBILITY: Form labels use 'for' attribute

**Implementation Details**:

- settings.component.html:

  ```html
  <div class="p-4 space-y-6">
    <!-- Header with back button -->
    <div class="flex items-center gap-4">
      <button class="btn btn-ghost btn-sm" (click)="backToChat()" aria-label="Back to Chat">← Back to Chat</button>
      <h1 class="text-2xl font-bold">Settings</h1>
    </div>

    <!-- Authentication Section -->
    <div class="card bg-base-200">
      <div class="card-body">
        <h2 class="card-title">🔐 Authentication</h2>
        <ptah-auth-config />
      </div>
    </div>
  </div>
  ```

- auth-config.component.html:

  ```html
  <form class="space-y-4">
    <!-- Auth Method Selection -->
    <div class="form-control">
      <label class="label">
        <span class="label-text">Authentication Method</span>
      </label>
      <div class="flex gap-4">
        <label class="label cursor-pointer gap-2">
          <input type="radio" name="authMethod" value="oauth" [(ngModel)]="authMethod" class="radio" />
          <span>OAuth Token</span>
        </label>
        <label class="label cursor-pointer gap-2">
          <input type="radio" name="authMethod" value="apiKey" [(ngModel)]="authMethod" class="radio" />
          <span>API Key</span>
        </label>
        <label class="label cursor-pointer gap-2">
          <input type="radio" name="authMethod" value="auto" [(ngModel)]="authMethod" class="radio" />
          <span>Auto-detect</span>
        </label>
      </div>
    </div>

    <!-- OAuth Token Input -->
    @if (authMethod() === 'oauth' || authMethod() === 'auto') {
    <div class="form-control">
      <label class="label" for="oauthToken">
        <span class="label-text">Claude OAuth Token</span>
      </label>
      <input id="oauthToken" type="password" [(ngModel)]="oauthToken" class="input input-bordered" placeholder="Enter your OAuth token" />
    </div>
    }

    <!-- API Key Input -->
    @if (authMethod() === 'apiKey' || authMethod() === 'auto') {
    <div class="form-control">
      <label class="label" for="apiKey">
        <span class="label-text">Anthropic API Key</span>
      </label>
      <input id="apiKey" type="password" [(ngModel)]="apiKey" class="input input-bordered" placeholder="Enter your API key" />
    </div>
    }

    <!-- Save & Test Button -->
    <div class="form-control">
      <button type="button" class="btn btn-primary" (click)="saveAndTest()" [disabled]="connectionStatus() === 'testing'">
        @if (connectionStatus() === 'testing') {
        <span class="loading loading-spinner"></span> Testing... } @else { Save & Test Connection }
      </button>
    </div>

    <!-- Connection Status -->
    @if (connectionStatus() === 'success') {
    <div class="alert alert-success">
      <span>✓ Connected successfully</span>
    </div>
    } @if (connectionStatus() === 'error') {
    <div class="alert alert-error">
      <span>✗ {{ errorMessage() }}</span>
    </div>
    }
  </form>
  ```

---

### Task 3.5: Add Settings Barrel Export ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\index.ts (CREATE)
**Spec Reference**: implementation-plan-revised.md:151 (Component 5 barrel export)
**Dependencies**: Task 3.1

**Quality Requirements**:

- Create barrel export for settings folder
- Export SettingsComponent and AuthConfigComponent

**Implementation Details**:

- Create libs/frontend/chat/src/lib/settings/index.ts:
  ```typescript
  export { SettingsComponent } from './settings.component';
  export { AuthConfigComponent } from './auth-config.component';
  ```

---

**Batch 3 Verification**:

- All files exist at paths
- Settings button navigates to settings view
- Back button returns to chat view
- AuthConfig form renders with all fields
- Save & Test Connection calls RPC methods
- Connection status displays correctly (success/error)
- Build passes: `npx nx build chat && npx nx build ptah-extension-webview`
- No console errors in webview
- Navigation is smooth without flicker

---

## Status Icons Reference

| Status         | Meaning                         | Who Sets              |
| -------------- | ------------------------------- | --------------------- |
| ⏸️ PENDING     | Not started                     | team-leader (initial) |
| 🔄 IN PROGRESS | Assigned to developer           | team-leader           |
| 🔄 IMPLEMENTED | Developer done, awaiting verify | developer             |
| ✅ COMPLETE    | Verified and committed          | team-leader           |
| ❌ FAILED      | Verification failed             | team-leader           |

---

## Git Commit Requirements

**Commitlint Rules**:

- Type: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
- Scope: webview, vscode, vscode-lm-tools, deps, release, ci, docs, hooks, scripts
- Subject: lowercase, 3-72 chars, no period, imperative mood
- Header: max 100 chars

**Batch 1 Commit**:

```bash
feat(vscode): add sdk authentication initialization flow
```

**Batch 2 Commit**:

```bash
feat(vscode): add config watchers and auth rpc methods
```

**Batch 3 Commit**:

```bash
feat(webview): add settings ui with authentication config
```

---

## Notes

- **Critical Path**: Backend (Batch 1 → Batch 2) must complete before Frontend (Batch 3)
- **Parallel Work**: Batch 1 and Batch 2 can be worked sequentially by same developer
- **Integration Point**: Batch 3 depends on RPC methods from Batch 2
- **Testing**: Each batch should be manually tested before marking complete
- **Edge Cases**: All validation risks documented in task descriptions
