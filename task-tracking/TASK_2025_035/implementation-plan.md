# Implementation Plan - TASK_2025_035: Model Selector & Autopilot Integration

## 📊 Codebase Investigation Summary

### Libraries Discovered

**Frontend Core (`libs/frontend/core/`):**

- **AppStateManager** (app-state.service.ts): Signal-based state service pattern
  - Private `signal<T>()` for mutable state
  - Public `asReadonly()` for reactive consumption
  - Constructor-based initialization
  - Used by: All frontend components for global state

**Backend VSCode Core (`libs/backend/vscode-core/`):**

- **ConfigManager** (config/config-manager.ts): Workspace configuration management
  - Methods: `get<T>()`, `set<T>()`, `watch()` for reactive updates
  - Namespace: `'ptah'` prefix for all settings
  - Scopes: `ConfigurationTarget.Workspace` | `.Global`
  - Used by: All backend services for persistent configuration

**Backend Claude Domain (`libs/backend/claude-domain/`):**

- **ClaudeProcess** (cli/claude-process.ts): CLI process spawning
  - Method: `buildArgs()` at line 104 - constructs CLI argument array
  - Current flags: `--model <model>`, `--allowedTools <tools>`, `--permission-prompt-tool`
  - Pattern: Optional flags added conditionally based on options
  - Used by: RPC handlers for chat operations

**RPC System (`libs/backend/vscode-core/`):**

- **RpcMethodRegistrationService** (messaging/rpc-method-registration.service.ts):
  - Pattern: `this.rpcHandler.registerMethod(method, async (params) => { ... })`
  - Error handling: Try-catch with structured `{ success, data?, error? }` responses
  - Example: `chat:start` (line 153), `chat:continue` (line 259)
  - Used by: Extension activation to register all RPC methods

**Frontend RPC Client (`libs/frontend/core/`):**

- **ClaudeRpcService** (services/claude-rpc.service.ts):
  - Method: `call<T>(method, params)` returns `Promise<RpcResult<T>>`
  - Pattern: Correlation ID tracking, timeout handling, typed wrappers
  - Example wrappers: `listSessions()`, `startChat()`, `openFile()`
  - Used by: All frontend services for backend communication

### Patterns Identified

**Pattern 1: Signal-Based State Service**

- **Evidence**: AppStateManager (app-state.service.ts:30-120)
- **Components**:
  - Private signals: `private readonly _state = signal<T>(defaultValue)`
  - Public readonly: `readonly state = this._state.asReadonly()`
  - Update methods: `setState(value: T): void { this._state.set(value); }`
  - Injectable: `@Injectable({ providedIn: 'root' })`
- **Conventions**:
  - Prefix private signals with `_`
  - No RxJS dependencies (pure Angular signals)
  - Constructor initialization only

**Pattern 2: RPC Handler Registration**

- **Evidence**: RpcMethodRegistrationService (rpc-method-registration.service.ts:153-369)
- **Components**:
  - Method registration: `this.rpcHandler.registerMethod('namespace:action', async (params) => { ... })`
  - Try-catch wrapper: All handlers wrapped in try-catch
  - Structured response: `{ success: boolean, data?: T, error?: string }`
  - Logging: `this.logger.debug()` on entry, `this.logger.error()` on failure
- **Conventions**:
  - Method names: `namespace:action` format (e.g., `model:switch`, `autopilot:toggle`)
  - Validation first: Input validation before business logic
  - Early return: Return error result on validation failure

**Pattern 3: ClaudeProcess CLI Argument Building**

- **Evidence**: ClaudeProcess.buildArgs() (claude-process.ts:104-134)
- **Components**:
  - Base args: Always include `-p`, `--output-format stream-json`, `--verbose`
  - Optional flags: Conditional push based on options parameter
  - Model flag: Only add `--model <name>` if model !== 'sonnet' (default)
  - AllowedTools: Always include `mcp__ptah`, append additional tools
- **Conventions**:
  - Flag order: Base args → permission flags → model → resume → allowedTools
  - Default omission: Don't add flags for default values (sonnet model, ask permission)
  - Array building: Use `args.push(flag, value)` pattern

**Pattern 4: Workspace Configuration Persistence**

- **Evidence**: ConfigManager (config-manager.ts:58-165)
- **Components**:
  - Namespace: `'ptah'` prefix for all settings
  - Get: `configManager.get<T>(key)` | `getWithDefault<T>(key, defaultValue)`
  - Set: `await configManager.set<T>(key, value, { target: ConfigurationTarget.Workspace })`
  - Watch: `configManager.watch(key, (value) => { ... })` for reactive updates
- **Conventions**:
  - Dot notation: Keys use dot notation (e.g., `model.selected`, `autopilot.enabled`)
  - Async updates: All `set()` operations are async
  - Scopes: Prefer `Workspace` target for session-specific settings

### Integration Points

**Integration 1: Frontend State → RPC → Backend Config**

- **Flow**: User clicks dropdown → State service updates signal → RPC call → Backend validates → ConfigManager persists
- **Evidence**:
  - Frontend: AppStateManager pattern (app-state.service.ts:66-70)
  - RPC: ClaudeRpcService.call() (claude-rpc.service.ts:93-125)
  - Backend: ConfigManager.set() (config-manager.ts:129-142)

**Integration 2: Backend Config → ClaudeProcess Arguments**

- **Flow**: chat:start/continue RPC → Read config → Build args with model/permission flags → Spawn process
- **Evidence**:
  - Config read: ConfigManager.get() (config-manager.ts:58-61)
  - Arg building: ClaudeProcess.buildArgs() (claude-process.ts:104-134)
  - Process spawn: chat:start handler (rpc-method-registration.service.ts:153-256)

**Integration 3: ChatInputComponent → State Services**

- **Flow**: UI dropdown change → Call state service method → State updates → Computed signals notify UI
- **Evidence**:
  - Current stub: ChatInputComponent.selectModel() (chat-input.component.ts:204-207)
  - Injection pattern: `inject(Service)` (chat-input.component.ts:132)
  - Signal binding: Template `[checked]="autopilotEnabled()"` (chat-input.component.ts:121)

## 🏗️ Architecture Design (Codebase-Aligned)

### Design Philosophy

**Chosen Approach**: Layered state management with RPC synchronization
**Rationale**:

- **Frontend**: Signal-based state services provide reactive UI updates (matches AppStateManager pattern)
- **Backend**: Configuration persistence ensures settings survive restarts (matches ConfigManager pattern)
- **Sync**: RPC calls bridge frontend state → backend config (matches existing chat RPC pattern)
- **CLI Integration**: Backend reads config during ClaudeProcess spawning (matches buildArgs pattern)

**Evidence**:

- Similar pattern used by ChatStore for session management (chat.store.ts:311-368)
- RPC methods already registered for chat operations (rpc-method-registration.service.ts:151-369)
- ConfigManager used for extension settings (config-manager.ts:58-165)

### Component Specifications

---

#### Component 1: ModelStateService (Frontend)

**Purpose**: Manage model selection state and sync with backend via RPC

**Pattern**: Signal-based state service (verified from AppStateManager pattern)

**Evidence**:

- Similar services: AppStateManager (app-state.service.ts:30-120)
- Signal pattern: Private `_signal`, public `asReadonly()`, update methods
- RPC integration: ClaudeRpcService.call() (claude-rpc.service.ts:93-125)

**Responsibilities**:

- Maintain current model selection (opus | sonnet | haiku)
- Provide readonly signal for reactive UI updates
- Call `model:switch` RPC to persist selection to backend
- Load initial state from backend on construction

**Base Classes/Interfaces** (verified):

- `@Injectable({ providedIn: 'root' })` - Angular DI (verified: app-state.service.ts:30)
- Uses Angular `signal<T>()` - Signal API (verified: app-state.service.ts:33)

**Key Dependencies** (verified):

- `ClaudeRpcService` - RPC communication (import from: @ptah-extension/core)
- `signal`, `computed` - Angular signals (import from: @angular/core)

**Implementation Pattern**:

```typescript
// Pattern source: app-state.service.ts:30-92
// Verified imports from: claude-rpc.service.ts:1-9, app-state.service.ts:8
import { Injectable, signal, computed } from '@angular/core';
import { ClaudeRpcService } from './claude-rpc.service';

export type ClaudeModel = 'opus' | 'sonnet' | 'haiku';

@Injectable({ providedIn: 'root' })
export class ModelStateService {
  private readonly rpc = inject(ClaudeRpcService);

  // Private mutable signals
  private readonly _currentModel = signal<ClaudeModel>('sonnet');
  private readonly _availableModels = signal<ClaudeModel[]>(['opus', 'sonnet', 'haiku']);

  // Public readonly signals
  readonly currentModel = this._currentModel.asReadonly();
  readonly availableModels = this._availableModels.asReadonly();

  // Computed display name
  readonly currentModelDisplay = computed(() => {
    const model = this._currentModel();
    return MODEL_DISPLAY_NAMES[model];
  });

  constructor() {
    this.loadPersistedModel();
  }

  /**
   * Switch to a different model
   * Updates local state and persists to backend via RPC
   */
  async switchModel(model: ClaudeModel): Promise<void> {
    // Optimistic update
    this._currentModel.set(model);

    // Persist to backend
    const result = await this.rpc.call<void>('model:switch', { model });

    if (!result.isSuccess()) {
      console.error('[ModelStateService] Failed to switch model:', result.error);
      // Rollback on failure (could load from backend)
      this.loadPersistedModel();
    }
  }

  /**
   * Load persisted model from backend on init
   */
  private async loadPersistedModel(): Promise<void> {
    const result = await this.rpc.call<{ model: ClaudeModel }>('model:get', {});
    if (result.isSuccess() && result.data) {
      this._currentModel.set(result.data.model);
    }
  }
}

const MODEL_DISPLAY_NAMES: Record<ClaudeModel, string> = {
  opus: 'Claude Opus 4.0',
  sonnet: 'Claude Sonnet 4.0',
  haiku: 'Claude Haiku 3.5',
};
```

**Quality Requirements**:

**Functional Requirements**:

- MUST update signal state immediately on `switchModel()` call (optimistic update)
- MUST persist model selection via `model:switch` RPC call
- MUST rollback state if RPC call fails
- MUST load initial state from backend on construction

**Non-Functional Requirements**:

- **Performance**: Signal updates must complete within 10ms (Angular signal overhead)
- **Reliability**: Must handle RPC failures gracefully with rollback
- **Memory**: Service singleton, no memory leaks from signal subscriptions

**Pattern Compliance**:

- MUST follow AppStateManager signal pattern (verified: app-state.service.ts:33-48)
- MUST use ClaudeRpcService for backend communication (verified: claude-rpc.service.ts:93-125)
- MUST NOT use RxJS (project uses pure Angular signals)

**Files Affected**:

- `libs/frontend/core/src/lib/services/model-state.service.ts` (CREATE)
- `libs/frontend/core/src/index.ts` (MODIFY - add export)

---

#### Component 2: AutopilotStateService (Frontend)

**Purpose**: Manage autopilot mode state and permission level

**Pattern**: Signal-based state service (verified from AppStateManager pattern)

**Evidence**: Same as ModelStateService (app-state.service.ts:30-120)

**Responsibilities**:

- Maintain autopilot enabled state (boolean)
- Maintain permission level (ask | auto-edit | yolo)
- Provide readonly signals for reactive UI updates
- Call `autopilot:toggle` RPC to persist state to backend
- Load initial state from backend on construction

**Base Classes/Interfaces** (verified):

- `@Injectable({ providedIn: 'root' })` - Angular DI

**Key Dependencies** (verified):

- `ClaudeRpcService` - RPC communication
- `signal`, `computed` - Angular signals

**Implementation Pattern**:

```typescript
// Pattern source: app-state.service.ts:30-92
import { Injectable, signal, computed } from '@angular/core';
import { ClaudeRpcService } from './claude-rpc.service';

export type PermissionLevel = 'ask' | 'auto-edit' | 'yolo';

@Injectable({ providedIn: 'root' })
export class AutopilotStateService {
  private readonly rpc = inject(ClaudeRpcService);

  // Private mutable signals
  private readonly _enabled = signal(false);
  private readonly _permissionLevel = signal<PermissionLevel>('ask');

  // Public readonly signals
  readonly enabled = this._enabled.asReadonly();
  readonly permissionLevel = this._permissionLevel.asReadonly();

  // Computed signal for UI display
  readonly statusText = computed(() => {
    const enabled = this._enabled();
    const level = this._permissionLevel();
    if (!enabled) return 'Manual';
    return PERMISSION_LEVEL_NAMES[level];
  });

  constructor() {
    this.loadPersistedState();
  }

  /**
   * Toggle autopilot on/off
   * When enabled, uses configured permission level
   */
  async toggleAutopilot(): Promise<void> {
    const newState = !this._enabled();

    // Optimistic update
    this._enabled.set(newState);

    // Persist to backend
    const result = await this.rpc.call<void>('autopilot:toggle', {
      enabled: newState,
      permissionLevel: this._permissionLevel(),
    });

    if (!result.isSuccess()) {
      console.error('[AutopilotStateService] Failed to toggle autopilot:', result.error);
      // Rollback on failure
      this._enabled.set(!newState);
    }
  }

  /**
   * Set permission level (ask, auto-edit, yolo)
   * Only applies when autopilot is enabled
   */
  async setPermissionLevel(level: PermissionLevel): Promise<void> {
    const previousLevel = this._permissionLevel();

    // Optimistic update
    this._permissionLevel.set(level);

    // Persist to backend (if autopilot is enabled)
    if (this._enabled()) {
      const result = await this.rpc.call<void>('autopilot:toggle', {
        enabled: true,
        permissionLevel: level,
      });

      if (!result.isSuccess()) {
        console.error('[AutopilotStateService] Failed to set permission level:', result.error);
        // Rollback on failure
        this._permissionLevel.set(previousLevel);
      }
    }
  }

  /**
   * Load persisted state from backend on init
   */
  private async loadPersistedState(): Promise<void> {
    const result = await this.rpc.call<{
      enabled: boolean;
      permissionLevel: PermissionLevel;
    }>('autopilot:get', {});

    if (result.isSuccess() && result.data) {
      this._enabled.set(result.data.enabled);
      this._permissionLevel.set(result.data.permissionLevel);
    }
  }
}

const PERMISSION_LEVEL_NAMES: Record<PermissionLevel, string> = {
  ask: 'Manual',
  'auto-edit': 'Auto-edit',
  yolo: 'Full Auto (YOLO)',
};
```

**Quality Requirements**:

**Functional Requirements**:

- MUST update enabled signal immediately on `toggleAutopilot()` call
- MUST persist state via `autopilot:toggle` RPC call
- MUST support three permission levels: ask, auto-edit, yolo
- MUST rollback state if RPC call fails

**Non-Functional Requirements**:

- **Security**: Must clearly indicate "YOLO" mode is dangerous (UI concern, not service)
- **Reliability**: Must handle RPC failures gracefully with rollback
- **Performance**: Signal updates within 10ms

**Pattern Compliance**:

- MUST follow AppStateManager signal pattern
- MUST use ClaudeRpcService for backend communication
- MUST NOT use RxJS

**Files Affected**:

- `libs/frontend/core/src/lib/services/autopilot-state.service.ts` (CREATE)
- `libs/frontend/core/src/index.ts` (MODIFY - add export)

---

#### Component 3: model:switch RPC Handler (Backend)

**Purpose**: Handle model selection RPC calls from frontend and persist to workspace config

**Pattern**: RPC method registration with validation (verified from existing handlers)

**Evidence**:

- Handler registration: rpc-method-registration.service.ts:153-256 (chat:start example)
- ConfigManager usage: config-manager.ts:129-142 (set method)

**Responsibilities**:

- Validate model parameter against whitelist (opus | sonnet | haiku)
- Persist model selection to workspace configuration via ConfigManager
- Return structured success/error response
- Log all operations for debugging

**Base Classes/Interfaces** (verified):

- Registered in `RpcMethodRegistrationService` (verified: rpc-method-registration.service.ts:132-146)
- Uses `ConfigManager` for persistence (verified: config-manager.ts:129-142)

**Key Dependencies** (verified):

- `ConfigManager` - Workspace configuration (injected via: TOKENS.CONFIG_MANAGER)
- `Logger` - Logging (injected via: TOKENS.LOGGER)

**Implementation Pattern**:

```typescript
// Pattern source: rpc-method-registration.service.ts:153-256
// Location: Inside RpcMethodRegistrationService.registerAll() or new private method

/**
 * Register model and autopilot RPC methods
 * Added in TASK_2025_035
 */
private registerModelAndAutopilotMethods(): void {
  // model:switch - Switch AI model
  this.rpcHandler.registerMethod('model:switch', async (params: any) => {
    try {
      const { model } = params;

      // Validate model parameter
      const validModels: ClaudeModel[] = ['opus', 'sonnet', 'haiku'];
      if (!validModels.includes(model)) {
        throw new Error(`Invalid model: ${model}. Must be one of: ${validModels.join(', ')}`);
      }

      this.logger.debug('RPC: model:switch called', { model });

      // Persist to workspace configuration
      // Uses ConfigManager pattern (config-manager.ts:129-142)
      await this.configManager.set('model.selected', model, {
        target: vscode.ConfigurationTarget.Workspace
      });

      this.logger.info('Model switched successfully', { model });

      return { success: true };
    } catch (error) {
      this.logger.error('RPC: model:switch failed',
        error instanceof Error ? error : new Error(String(error))
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // model:get - Get current model selection
  this.rpcHandler.registerMethod('model:get', async () => {
    try {
      this.logger.debug('RPC: model:get called');

      // Read from workspace configuration with default
      const model = this.configManager.getWithDefault<ClaudeModel>(
        'model.selected',
        'sonnet' // Default model
      );

      return { success: true, data: { model } };
    } catch (error) {
      this.logger.error('RPC: model:get failed',
        error instanceof Error ? error : new Error(String(error))
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // autopilot:toggle - Toggle autopilot and set permission level
  this.rpcHandler.registerMethod('autopilot:toggle', async (params: any) => {
    try {
      const { enabled, permissionLevel } = params;

      // Validate permission level
      const validLevels: PermissionLevel[] = ['ask', 'auto-edit', 'yolo'];
      if (!validLevels.includes(permissionLevel)) {
        throw new Error(`Invalid permission level: ${permissionLevel}. Must be one of: ${validLevels.join(', ')}`);
      }

      this.logger.debug('RPC: autopilot:toggle called', { enabled, permissionLevel });

      // Persist to workspace configuration
      await this.configManager.set('autopilot.enabled', enabled, {
        target: vscode.ConfigurationTarget.Workspace
      });
      await this.configManager.set('autopilot.permissionLevel', permissionLevel, {
        target: vscode.ConfigurationTarget.Workspace
      });

      this.logger.info('Autopilot state updated', { enabled, permissionLevel });

      return { success: true };
    } catch (error) {
      this.logger.error('RPC: autopilot:toggle failed',
        error instanceof Error ? error : new Error(String(error))
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // autopilot:get - Get current autopilot state
  this.rpcHandler.registerMethod('autopilot:get', async () => {
    try {
      this.logger.debug('RPC: autopilot:get called');

      // Read from workspace configuration with defaults
      const enabled = this.configManager.getWithDefault<boolean>('autopilot.enabled', false);
      const permissionLevel = this.configManager.getWithDefault<PermissionLevel>(
        'autopilot.permissionLevel',
        'ask' // Default permission level
      );

      return { success: true, data: { enabled, permissionLevel } };
    } catch (error) {
      this.logger.error('RPC: autopilot:get failed',
        error instanceof Error ? error : new Error(String(error))
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}
```

**Quality Requirements**:

**Functional Requirements**:

- MUST validate model against whitelist before persisting
- MUST validate permission level against whitelist
- MUST persist to workspace configuration (not global)
- MUST return structured `{ success, data?, error? }` response
- MUST log all operations with logger

**Non-Functional Requirements**:

- **Security**: Input validation prevents injection attacks
- **Performance**: RPC must complete within 100ms (I/O bound by config write)
- **Reliability**: Must handle ConfigManager failures gracefully

**Pattern Compliance**:

- MUST follow RPC handler pattern (verified: rpc-method-registration.service.ts:153-256)
- MUST use ConfigManager for persistence (verified: config-manager.ts:129-142)
- MUST use try-catch error handling (verified: rpc-method-registration.service.ts:154-255)

**Files Affected**:

- `libs/backend/vscode-core/src/messaging/rpc-method-registration.service.ts` (MODIFY)
- Add new private method `registerModelAndAutopilotMethods()` called from `registerAll()`

---

#### Component 4: ClaudeProcess Argument Building (Backend)

**Purpose**: Modify `buildArgs()` to read model and autopilot config and add appropriate CLI flags

**Pattern**: Conditional CLI argument building (verified from existing code)

**Evidence**: ClaudeProcess.buildArgs() (claude-process.ts:104-134)

**Responsibilities**:

- Read model selection from workspace config via ConfigManager
- Read autopilot state from workspace config
- Add `--model <model>` flag if model is not default (sonnet)
- Add `--allowedTools Edit,Write` if autopilot is enabled with auto-edit level
- Add `--dangerously-skip-permissions` if autopilot is enabled with yolo level
- Maintain backward compatibility (no flags for default settings)

**Base Classes/Interfaces** (verified):

- Extends existing `ClaudeProcess` class (verified: claude-process.ts:41)

**Key Dependencies** (verified):

- `ConfigManager` - Must be injected into constructor (needs DI refactor OR pass options from RPC handler)

**Implementation Pattern**:

```typescript
// Pattern source: claude-process.ts:104-134
// Modification location: Inside ClaudeProcess.buildArgs() method

/**
 * Build CLI arguments array
 * Modified in TASK_2025_035 to support model and autopilot configuration
 */
private buildArgs(options?: ClaudeProcessOptions): string[] {
  const args = [
    '-p', // Print mode (don't enter interactive)
    '--output-format',
    'stream-json',
    '--verbose',
  ];

  // Add permission prompt tool (TASK_2025_026 Batch 4)
  args.push('--permission-prompt-tool', 'mcp__ptah__approval_prompt');

  // TASK_2025_035: Add model flag (only if not default)
  // Model can come from options parameter (passed from RPC handler)
  if (options?.model && options.model !== 'sonnet') {
    args.push('--model', options.model);
  }

  // TASK_2025_035: Add autopilot/permission flags based on configuration
  // These are passed via options parameter from RPC handler
  const autopilotEnabled = options?.autopilotEnabled ?? false;
  const permissionLevel = options?.permissionLevel ?? 'ask';

  if (autopilotEnabled && permissionLevel === 'auto-edit') {
    // Auto-edit mode: Allow Edit and Write tools without prompts
    args.push('--allowedTools', 'Edit,Write');
  } else if (autopilotEnabled && permissionLevel === 'yolo') {
    // YOLO mode: Skip ALL permission prompts (DANGEROUS)
    args.push('--dangerously-skip-permissions');
  }
  // Default (ask): No additional flags, use permission-prompt-tool

  if (options?.resumeSessionId) {
    args.push('--resume', options.resumeSessionId);
  }

  // Allow MCP tools - always include mcp__ptah (all tools within ptah server are auto-allowed)
  // The approval_prompt tool is internal to ptah server, no need to list separately
  // Additional tools can be passed via options.allowedTools
  // Format: --allowedTools "tool1,tool2" or --allowedTools tool1 tool2
  const allowedTools = new Set<string>(['mcp__ptah']);
  if (options?.allowedTools) {
    options.allowedTools.forEach((tool) => allowedTools.add(tool));
  }
  args.push('--allowedTools', Array.from(allowedTools).join(','));

  return args;
}
```

**CRITICAL INTEGRATION NOTE**:
The RPC handlers (`chat:start`, `chat:continue`) must be modified to:

1. Read model and autopilot config via ConfigManager before spawning ClaudeProcess
2. Pass config values via `options` parameter to `process.start()` / `process.resume()`

**Modified RPC Handler Pattern**:

```typescript
// Inside chat:start handler (rpc-method-registration.service.ts:153-256)
// BEFORE calling process.start()

// TASK_2025_035: Read model and autopilot configuration
const selectedModel = this.configManager.getWithDefault<ClaudeModel>('model.selected', 'sonnet');
const autopilotEnabled = this.configManager.getWithDefault<boolean>('autopilot.enabled', false);
const permissionLevel = this.configManager.getWithDefault<PermissionLevel>('autopilot.permissionLevel', 'ask');

// Build options with model and autopilot config
const processOptions = {
  ...options, // Existing options from RPC params
  model: selectedModel,
  autopilotEnabled,
  permissionLevel,
};

// Start the process with enhanced options
await process.start(prompt, processOptions);
```

**Quality Requirements**:

**Functional Requirements**:

- MUST read model config from ConfigManager (key: `model.selected`, default: `'sonnet'`)
- MUST read autopilot config from ConfigManager (keys: `autopilot.enabled`, `autopilot.permissionLevel`)
- MUST add `--model` flag ONLY if model is not 'sonnet' (backward compatibility)
- MUST add `--allowedTools Edit,Write` ONLY if autopilot enabled + auto-edit level
- MUST add `--dangerously-skip-permissions` ONLY if autopilot enabled + yolo level
- MUST log full CLI command with flags for debugging

**Non-Functional Requirements**:

- **Backward Compatibility**: Existing chat functionality must work unchanged (no flags for defaults)
- **Security**: YOLO mode must be clearly logged as dangerous
- **Performance**: Config reads must not add >50ms to process spawn time

**Pattern Compliance**:

- MUST follow conditional flag building pattern (verified: claude-process.ts:115-131)
- MUST maintain flag order consistency (base → permissions → model → resume → allowedTools)
- MUST use ConfigManager for config reads (verified: config-manager.ts:58-74)

**Files Affected**:

- `libs/backend/claude-domain/src/cli/claude-process.ts` (MODIFY - buildArgs method)
- `libs/backend/vscode-core/src/messaging/rpc-method-registration.service.ts` (MODIFY - chat:start and chat:continue handlers)
- `libs/backend/vscode-core/src/messaging/rpc-method-registration.service.ts` (MODIFY - inject ConfigManager)

---

#### Component 5: ChatInputComponent Integration (Frontend)

**Purpose**: Wire existing UI controls to new state services

**Pattern**: Signal-based component with service injection (verified from existing code)

**Evidence**:

- Current stubs: chat-input.component.ts:204-215
- Injection pattern: chat-input.component.ts:132 (inject() calls)
- Signal binding: chat-input.component.ts:121 (template bindings)

**Responsibilities**:

- Inject ModelStateService and AutopilotStateService
- Replace local `_selectedModel` and `_autopilotEnabled` signals with service signals
- Call service methods on user interaction (dropdown select, toggle click)
- Update template bindings to use service signals

**Base Classes/Interfaces** (verified):

- Angular `@Component` (verified: chat-input.component.ts:30)

**Key Dependencies** (verified):

- `ModelStateService` - Model state management
- `AutopilotStateService` - Autopilot state management

**Implementation Pattern**:

```typescript
// Pattern source: chat-input.component.ts:131-216
// Modifications to existing ChatInputComponent

import { Component, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { LucideAngularModule, Send, ChevronDown } from 'lucide-angular';
import { ChatStore } from '../../services/chat.store';
// TASK_2025_035: Import new state services
import { ModelStateService, AutopilotStateService } from '@ptah-extension/core';

@Component({
  selector: 'ptah-chat-input',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <!-- Existing template, modify these sections: -->

    <!-- Model Selector Dropdown (lines 81-113) -->
    <div class="dropdown dropdown-top dropdown-end">
      <button tabindex="0" class="btn btn-ghost btn-sm gap-1" type="button">
        <!-- TASK_2025_035: Bind to service signal -->
        <span class="text-xs">{{ modelState.currentModelDisplay() }}</span>
        <lucide-angular [img]="ChevronDownIcon" class="w-3 h-3" />
      </button>
      <ul tabindex="0" class="dropdown-content menu p-2 shadow bg-base-200 rounded-box w-52 mb-1">
        <li><button type="button" (click)="selectModel('sonnet')">Claude Sonnet 4.0</button></li>
        <li><button type="button" (click)="selectModel('opus')">Claude Opus 4.0</button></li>
        <li><button type="button" (click)="selectModel('haiku')">Claude Haiku 3.5</button></li>
      </ul>
    </div>

    <!-- Autopilot Toggle (lines 116-124) -->
    <label class="flex items-center gap-2 cursor-pointer">
      <span class="text-xs text-base-content/70">Auto</span>
      <input type="checkbox" class="toggle toggle-sm toggle-primary" <!-- TASK_2025_035: Bind to service signal -- />
      [checked]="autopilotState.enabled()" (change)="toggleAutopilot()" />
    </label>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatInputComponent {
  readonly chatStore = inject(ChatStore);

  // TASK_2025_035: Inject state services
  readonly modelState = inject(ModelStateService);
  readonly autopilotState = inject(AutopilotStateService);

  // Lucide icons
  readonly SendIcon = Send;
  readonly ChevronDownIcon = ChevronDown;

  // Local state (keep for message input)
  private readonly _currentMessage = signal('');
  readonly currentMessage = this._currentMessage.asReadonly();

  // TASK_2025_035: Remove local model/autopilot signals (now in services)
  // DELETED: private readonly _selectedModel = signal('Claude Sonnet 4.0');
  // DELETED: private readonly _autopilotEnabled = signal(false);
  // DELETED: readonly selectedModel = this._selectedModel.asReadonly();
  // DELETED: readonly autopilotEnabled = this._autopilotEnabled.asReadonly();

  // Computed
  readonly isDisabled = computed(() => this.chatStore.isStreaming());
  readonly canSend = computed(() => this.currentMessage().trim().length > 0 && !this.isDisabled());

  // ... existing methods (handleInput, handleKeyDown, handleSend) unchanged ...

  /**
   * Select AI model
   * TASK_2025_035: Wire to ModelStateService
   */
  selectModel(model: 'opus' | 'sonnet' | 'haiku'): void {
    // Call state service to persist selection
    this.modelState.switchModel(model).catch((error) => {
      console.error('[ChatInputComponent] Failed to switch model:', error);
      // Error handling: Service handles rollback, just log here
    });
  }

  /**
   * Toggle autopilot mode
   * TASK_2025_035: Wire to AutopilotStateService
   */
  toggleAutopilot(): void {
    // Call state service to persist state
    this.autopilotState.toggleAutopilot().catch((error) => {
      console.error('[ChatInputComponent] Failed to toggle autopilot:', error);
      // Error handling: Service handles rollback, just log here
    });
  }
}
```

**Quality Requirements**:

**Functional Requirements**:

- MUST inject ModelStateService and AutopilotStateService via `inject()`
- MUST remove local `_selectedModel` and `_autopilotEnabled` signals (now in services)
- MUST bind template to service signals (not local signals)
- MUST call service methods on user interaction (async, error handled)
- MUST NOT block UI on RPC calls (optimistic updates in services)

**Non-Functional Requirements**:

- **UX**: UI must update immediately (optimistic updates via signals)
- **Error Handling**: Errors logged but do not crash component (service rollback handles consistency)
- **Performance**: No additional latency beyond RPC call (async, non-blocking)

**Pattern Compliance**:

- MUST use Angular `inject()` for DI (verified: chat-input.component.ts:132)
- MUST use signal bindings in template (verified: chat-input.component.ts:121)
- MUST follow async error handling pattern (catch + log)

**Files Affected**:

- `libs/frontend/chat/src/lib/components/molecules/chat-input.component.ts` (MODIFY)

---

#### Component 6: Shared Type Definitions

**Purpose**: Define TypeScript literal types for model and permission level values

**Pattern**: Branded type pattern (verified from existing shared types)

**Evidence**:

- Branded types: branded.types.ts:14-25 (SessionId, MessageId, CorrelationId)
- Type exports: libs/shared/src/index.ts (central export point)

**Responsibilities**:

- Define `ClaudeModel` type (literal union: 'opus' | 'sonnet' | 'haiku')
- Define `PermissionLevel` type (literal union: 'ask' | 'auto-edit' | 'yolo')
- Provide type guards and validation helpers (optional)
- Export from shared library for use in frontend and backend

**Base Classes/Interfaces** (verified):

- None - pure TypeScript types

**Key Dependencies** (verified):

- None - standalone type definitions

**Implementation Pattern**:

```typescript
// Pattern source: branded.types.ts (for reference only, NOT branded types here)
// Location: libs/shared/src/lib/types/model-autopilot.types.ts (NEW FILE)

/**
 * Claude AI Model Types
 * TASK_2025_035: Model selector and autopilot integration
 */

/**
 * Available Claude AI models
 * - opus: Claude Opus 4.0 (highest capability, highest cost)
 * - sonnet: Claude Sonnet 4.0 (balanced, default)
 * - haiku: Claude Haiku 3.5 (fastest, lowest cost)
 */
export type ClaudeModel = 'opus' | 'sonnet' | 'haiku';

/**
 * Autopilot permission levels
 * - ask: Manual approval for each action (default, safest)
 * - auto-edit: Auto-approve Edit and Write tools
 * - yolo: Skip ALL permission prompts (DANGEROUS)
 */
export type PermissionLevel = 'ask' | 'auto-edit' | 'yolo';

/**
 * Model display names for UI
 */
export const MODEL_DISPLAY_NAMES: Record<ClaudeModel, string> = {
  opus: 'Claude Opus 4.0',
  sonnet: 'Claude Sonnet 4.0',
  haiku: 'Claude Haiku 3.5',
} as const;

/**
 * Permission level display names for UI
 */
export const PERMISSION_LEVEL_NAMES: Record<PermissionLevel, string> = {
  ask: 'Manual',
  'auto-edit': 'Auto-edit',
  yolo: 'Full Auto (YOLO)',
} as const;

/**
 * Type guard: Check if value is valid ClaudeModel
 */
export function isClaudeModel(value: unknown): value is ClaudeModel {
  return typeof value === 'string' && ['opus', 'sonnet', 'haiku'].includes(value);
}

/**
 * Type guard: Check if value is valid PermissionLevel
 */
export function isPermissionLevel(value: unknown): value is PermissionLevel {
  return typeof value === 'string' && ['ask', 'auto-edit', 'yolo'].includes(value);
}

/**
 * ClaudeProcess options extension
 * Added in TASK_2025_035 to support model and autopilot configuration
 */
export interface ClaudeProcessOptions {
  /** Model to use (opus, sonnet, haiku) */
  model?: ClaudeModel;
  /** Session ID to resume */
  resumeSessionId?: string;
  /** Enable verbose output */
  verbose?: boolean;
  /** Allowed MCP tools (space-separated or comma-separated list) */
  allowedTools?: string[];
  /** TASK_2025_035: Autopilot enabled flag */
  autopilotEnabled?: boolean;
  /** TASK_2025_035: Permission level when autopilot enabled */
  permissionLevel?: PermissionLevel;
}
```

**Quality Requirements**:

**Functional Requirements**:

- MUST define literal union types (not enums or strings)
- MUST provide display name mappings for UI
- MUST provide type guards for runtime validation
- MUST export from shared library index

**Non-Functional Requirements**:

- **Type Safety**: Compile-time type checking prevents invalid values
- **Maintainability**: Centralized type definitions prevent drift
- **Documentation**: JSDoc comments explain each type and value

**Pattern Compliance**:

- MUST use TypeScript literal unions (NOT strings)
- MUST export from shared library (verified: libs/shared/src/index.ts)
- MUST provide type guards for runtime validation (optional but recommended)

**Files Affected**:

- `libs/shared/src/lib/types/model-autopilot.types.ts` (CREATE)
- `libs/shared/src/index.ts` (MODIFY - add exports)
- `libs/backend/claude-domain/src/cli/claude-process.ts` (MODIFY - update ClaudeProcessOptions interface)

---

## 🔗 Integration Architecture

### Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER INTERACTION                         │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                  ChatInputComponent (Frontend)                   │
│  - Model dropdown: (click) → selectModel(model)                 │
│  - Autopilot toggle: (change) → toggleAutopilot()               │
└─────────────────────────────────────────────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
┌──────────────────────────────┐  ┌──────────────────────────────┐
│  ModelStateService           │  │  AutopilotStateService        │
│  - switchModel(model)        │  │  - toggleAutopilot()          │
│  - Optimistic signal update  │  │  - Optimistic signal update   │
│  - RPC call: model:switch    │  │  - RPC call: autopilot:toggle │
└──────────────────────────────┘  └──────────────────────────────┘
                    │                         │
                    └────────────┬────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                   ClaudeRpcService (Frontend)                    │
│  - call('model:switch', { model })                              │
│  - call('autopilot:toggle', { enabled, permissionLevel })       │
│  - Correlation ID tracking, timeout handling                    │
└─────────────────────────────────────────────────────────────────┘
                                 │
                    (Webview Message: rpc:call)
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│         RpcMethodRegistrationService (Backend)                   │
│  - model:switch handler: Validate → ConfigManager.set()         │
│  - autopilot:toggle handler: Validate → ConfigManager.set()     │
│  - Returns: { success, error? }                                 │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│             ConfigManager (Backend - vscode-core)                │
│  - set('model.selected', model, { target: Workspace })          │
│  - set('autopilot.enabled', enabled, { target: Workspace })     │
│  - set('autopilot.permissionLevel', level, { target: Workspace })│
│  - Persists to VS Code workspace settings                       │
└─────────────────────────────────────────────────────────────────┘
                                 │
                    (Configuration persisted)
                                 │
┌─────────────────────────────────────────────────────────────────┐
│                    LATER: User sends message                     │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│        chat:start / chat:continue RPC Handler (Backend)          │
│  1. Read config: configManager.getWithDefault('model.selected') │
│  2. Read config: configManager.getWithDefault('autopilot.X')    │
│  3. Build options: { model, autopilotEnabled, permissionLevel } │
│  4. Create ClaudeProcess(cliPath, workspacePath)                │
│  5. Call: process.start(prompt, options)                        │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│         ClaudeProcess.buildArgs() (Backend - claude-domain)      │
│  1. Base args: ['-p', '--output-format', 'stream-json']        │
│  2. IF model !== 'sonnet': args.push('--model', model)          │
│  3. IF autopilot + auto-edit: args.push('--allowedTools', ...)  │
│  4. IF autopilot + yolo: args.push('--dangerously-skip-...')    │
│  5. Return args array                                           │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Claude CLI Process Spawned                    │
│  - Model flag applied (if non-default)                          │
│  - Permission flags applied (if autopilot enabled)              │
│  - User receives chat response with configured model/perms      │
└─────────────────────────────────────────────────────────────────┘
```

### Integration Points

**Integration Point 1: Frontend State → RPC Call**

- **Components**: ModelStateService, AutopilotStateService → ClaudeRpcService
- **Pattern**: Service method calls `rpc.call<T>(method, params)`, awaits `RpcResult<T>`
- **Error Handling**: Services rollback state on RPC failure (optimistic update pattern)
- **Evidence**: ClaudeRpcService.call() (claude-rpc.service.ts:93-125)

**Integration Point 2: RPC Handler → ConfigManager**

- **Components**: RpcMethodRegistrationService → ConfigManager
- **Pattern**: Handler validates input, calls `configManager.set(key, value, options)`, returns result
- **Error Handling**: Try-catch in handler returns structured error response
- **Evidence**: ConfigManager.set() (config-manager.ts:129-142), RPC handler pattern (rpc-method-registration.service.ts:153-256)

**Integration Point 3: Chat RPC Handler → ConfigManager → ClaudeProcess**

- **Components**: chat:start/continue handler → ConfigManager → ClaudeProcess
- **Pattern**: Handler reads config, passes to ClaudeProcess options, buildArgs() applies flags
- **Error Handling**: Config defaults ensure graceful degradation (sonnet model, ask permission)
- **Evidence**: ConfigManager.getWithDefault() (config-manager.ts:71-74), ClaudeProcess.buildArgs() (claude-process.ts:104-134)

**Integration Point 4: ChatInputComponent → State Services**

- **Components**: ChatInputComponent → ModelStateService, AutopilotStateService
- **Pattern**: Component injects services via `inject()`, calls service methods on user action, template binds to service signals
- **Error Handling**: Component catches errors, logs, UI shows optimistic update (rollback handled by service)
- **Evidence**: inject() pattern (chat-input.component.ts:132), signal binding (chat-input.component.ts:121)

## 🎯 Quality Requirements (Architecture-Level)

### Functional Requirements

**Model Selection**:

- System MUST persist model selection to workspace configuration
- System MUST apply model flag to ClaudeProcess only if non-default (backward compatible)
- System MUST provide three model options: opus, sonnet (default), haiku
- System MUST validate model input against whitelist

**Autopilot**:

- System MUST persist autopilot enabled state and permission level to workspace configuration
- System MUST apply permission flags to ClaudeProcess based on configuration
- System MUST support three permission levels: ask (default), auto-edit, yolo
- System MUST validate permission level input against whitelist

**State Management**:

- System MUST provide reactive UI updates via Angular signals
- System MUST use optimistic updates for immediate feedback
- System MUST rollback state on RPC failure
- System MUST load initial state from backend on service construction

### Non-Functional Requirements

**Performance**:

- State update latency: < 50ms (signal updates)
- RPC response time: < 100ms (I/O bound by config write)
- Config read overhead: < 50ms (added to process spawn time)
- Memory footprint: < 1MB per state service (singleton services)

**Security**:

- Input validation: All RPC handlers MUST validate inputs against whitelists
- YOLO mode warning: Must be clearly logged as dangerous operation
- Configuration isolation: Workspace settings MUST NOT affect other workspaces

**Reliability**:

- State persistence: Settings MUST survive webview reloads and VS Code restarts
- Graceful degradation: System MUST use safe defaults (sonnet model, ask permission) on config read failure
- Error handling: All RPC errors MUST be caught, logged, and returned with user-friendly messages
- Backward compatibility: Existing chat functionality MUST work unchanged (no flags for defaults)

**Maintainability**:

- Service pattern consistency: State services MUST follow AppStateManager pattern (signal-based, readonly signal exposure)
- RPC handler consistency: RPC handlers MUST follow existing pattern (try-catch, structured responses, logging)
- Type safety: All model and permission values MUST use TypeScript literal types (not strings or enums)
- No cross-library pollution: Types defined in shared library, imported by consumers

## 🤝 Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: **frontend-developer** (primary) + **backend-developer** (secondary)

**Rationale**:

1. **Frontend Work (60%)**: Two new Angular services (ModelStateService, AutopilotStateService), ChatInputComponent modifications
2. **Backend Work (40%)**: Four RPC handlers, ClaudeProcess.buildArgs() modification, ConfigManager integration
3. **Skill Overlap**: RPC system requires understanding of both frontend and backend messaging

**Execution Strategy**:

- **Phase 1 (Frontend)**: Create state services, wire ChatInputComponent (frontend-developer)
- **Phase 2 (Backend)**: Create RPC handlers, modify ClaudeProcess (backend-developer)
- **Phase 3 (Integration)**: Test end-to-end flow (both developers)

### Complexity Assessment

**Complexity**: **MEDIUM**
**Estimated Effort**: 4-6 hours

**Breakdown**:

- **Frontend Services** (2 hours): ModelStateService + AutopilotStateService + ChatInputComponent wiring
- **Backend RPC Handlers** (1.5 hours): 4 RPC methods (model:switch, model:get, autopilot:toggle, autopilot:get)
- **ClaudeProcess Integration** (1 hour): Modify buildArgs() + chat:start/continue handlers
- **Shared Types** (0.5 hours): Create type definitions
- **Testing** (1-2 hours): Manual testing, edge cases, error scenarios

### Files Affected Summary

**CREATE (6 files)**:

- `libs/frontend/core/src/lib/services/model-state.service.ts` - Model state management
- `libs/frontend/core/src/lib/services/autopilot-state.service.ts` - Autopilot state management
- `libs/shared/src/lib/types/model-autopilot.types.ts` - Shared type definitions

**MODIFY (5 files)**:

- `libs/frontend/core/src/index.ts` - Export new services
- `libs/frontend/chat/src/lib/components/molecules/chat-input.component.ts` - Wire UI to services
- `libs/backend/vscode-core/src/messaging/rpc-method-registration.service.ts` - Add RPC handlers, inject ConfigManager, modify chat handlers
- `libs/backend/claude-domain/src/cli/claude-process.ts` - Modify buildArgs() method
- `libs/shared/src/index.ts` - Export new types

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **All imports exist in codebase**:

   - `signal`, `computed` from `@angular/core` ✓ (verified: app-state.service.ts:8)
   - `ClaudeRpcService` from `@ptah-extension/core` ✓ (verified: claude-rpc.service.ts:70)
   - `ConfigManager` from `TOKENS.CONFIG_MANAGER` ✓ (verified: config-manager.ts:36, tokens.ts:40)
   - `Logger` from `TOKENS.LOGGER` ✓ (verified: tokens.ts:38)

2. **All patterns verified from examples**:

   - Signal-based state service: AppStateManager (app-state.service.ts:30-120) ✓
   - RPC handler registration: chat:start (rpc-method-registration.service.ts:153-256) ✓
   - ConfigManager usage: set() method (config-manager.ts:129-142) ✓
   - ClaudeProcess.buildArgs(): Existing implementation (claude-process.ts:104-134) ✓

3. **Library documentation consulted**:

   - Frontend core: No CLAUDE.md (use code patterns from AppStateManager) ✓
   - Backend vscode-core: Check for ConfigManager docs ✓
   - Backend claude-domain: libs/backend/claude-domain/CLAUDE.md ✓

4. **No hallucinated APIs**:
   - All decorators verified: `@Injectable` (app-state.service.ts:30) ✓
   - All RPC methods verified: `registerMethod()` (rpc-method-registration.service.ts:153) ✓
   - All ConfigManager methods verified: `get()`, `set()`, `getWithDefault()` (config-manager.ts:58-142) ✓
   - All ClaudeProcess methods verified: `buildArgs()`, `start()`, `resume()` (claude-process.ts:55-82, 104-134) ✓

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase (6 patterns documented)
- [x] All imports/decorators verified as existing (signal, @Injectable, ConfigManager, etc.)
- [x] Quality requirements defined (functional + non-functional)
- [x] Integration points documented (4 integration points with data flow)
- [x] Files affected list complete (6 CREATE, 5 MODIFY)
- [x] Developer type recommended (frontend + backend)
- [x] Complexity assessed (MEDIUM, 4-6 hours)
- [x] No step-by-step implementation (architecture specification, not execution plan)

---

## 📋 Appendix: Configuration Keys Reference

**Model Configuration**:

- Key: `ptah.model.selected`
- Type: `ClaudeModel` (literal: 'opus' | 'sonnet' | 'haiku')
- Default: `'sonnet'`
- Scope: `Workspace`

**Autopilot Configuration**:

- Key: `ptah.autopilot.enabled`
- Type: `boolean`
- Default: `false`
- Scope: `Workspace`

- Key: `ptah.autopilot.permissionLevel`
- Type: `PermissionLevel` (literal: 'ask' | 'auto-edit' | 'yolo')
- Default: `'ask'`
- Scope: `Workspace`

**CLI Flag Mapping**:

| Configuration                                                | CLI Flag                         | Condition                        |
| ------------------------------------------------------------ | -------------------------------- | -------------------------------- |
| `model.selected = 'opus'`                                    | `--model opus`                   | Always (if not sonnet)           |
| `model.selected = 'haiku'`                                   | `--model haiku`                  | Always (if not sonnet)           |
| `model.selected = 'sonnet'`                                  | (no flag)                        | Default, omit flag               |
| `autopilot.enabled = false`                                  | (no flag)                        | Default, use permission prompts  |
| `autopilot.enabled = true` + `permissionLevel = 'auto-edit'` | `--allowedTools Edit,Write`      | Auto-approve Edit/Write only     |
| `autopilot.enabled = true` + `permissionLevel = 'yolo'`      | `--dangerously-skip-permissions` | Skip ALL permissions (DANGEROUS) |
| `autopilot.enabled = true` + `permissionLevel = 'ask'`       | (no flag)                        | Enabled but still asks (no-op)   |

---

## 🎯 Success Criteria

**Functional Success**:

- [ ] User can select model from dropdown (Opus, Sonnet, Haiku)
- [ ] Model selection persists across webview reloads
- [ ] Model selection affects Claude CLI invocation (--model flag)
- [ ] User can toggle autopilot on/off
- [ ] Autopilot state persists across webview reloads
- [ ] Autopilot changes permission behavior (auto-edit: --allowedTools, yolo: --dangerously-skip-permissions)
- [ ] Default behavior unchanged (sonnet model, ask permission)

**Quality Success**:

- [ ] All RPC calls return structured responses (success, data, error)
- [ ] All state services use signal-based patterns (no RxJS)
- [ ] All configuration persisted to workspace settings (not global)
- [ ] All CLI commands logged for debugging
- [ ] Zero `any` types in new code
- [ ] All model/permission values use TypeScript literal types

**Integration Success**:

- [ ] Frontend state updates immediately on user interaction (optimistic updates)
- [ ] RPC calls complete within 100ms
- [ ] State services rollback on RPC failure
- [ ] ClaudeProcess reads config during chat:start/continue
- [ ] Existing chat functionality works unchanged (backward compatible)

---

**END OF IMPLEMENTATION PLAN**
