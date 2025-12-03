# Development Tasks - TASK_2025_035

**Total Tasks**: 13 | **Batches**: 5 | **Status**: 5/5 complete

**Batches Summary**:

- Batch 1: Shared Type Definitions ✅ COMPLETE (Commit: 5ae8a8e)
- Batch 2: Frontend State Services ✅ COMPLETE (Commit: 1524c42)
- Batch 3: Backend RPC Handlers ✅ COMPLETE (Commit: 9f58021)
- Batch 4: ClaudeProcess Integration ✅ COMPLETE (Commit: b120a5a)
- Batch 5: ChatInputComponent Wiring ✅ COMPLETE (Commit: 6be86a6)

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- ClaudeProcessOptions interface already exists (claude-process.ts:21-30) ✅
- Model flag logic already partially implemented (buildArgs line 115-117) ✅
- RPC handler pattern established (chat:start handler line 153-256) ✅
- ConfigManager has required methods (get, getWithDefault, set) ✅

### Risks Identified

| Risk                                                              | Severity | Mitigation                                                     |
| ----------------------------------------------------------------- | -------- | -------------------------------------------------------------- |
| ClaudeProcessOptions missing autopilot fields                     | MEDIUM   | Add `autopilotEnabled` and `permissionLevel` fields in Batch 1 |
| RpcMethodRegistrationService may need ConfigManager injection     | LOW      | Verify constructor in Batch 3, add if missing                  |
| chat:start/continue handlers need to pass config to ClaudeProcess | MEDIUM   | Modify handlers to read config and pass via options in Batch 4 |

### Edge Cases to Handle

- [ ] Model value validation (must be 'opus' | 'sonnet' | 'haiku') → Handled in Task 3.1
- [ ] Permission level validation (must be 'ask' | 'auto-edit' | 'yolo') → Handled in Task 3.2
- [ ] Default values if config read fails (sonnet, ask) → Handled in Task 4.2
- [ ] State rollback if RPC call fails → Handled in Task 2.1, 2.2

---

## Batch 1: Shared Type Definitions ✅ COMPLETE

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: None (Foundation - MUST BE FIRST)
**Commit**: 5ae8a8e

### Task 1.1: Create model-autopilot.types.ts with type definitions ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\shared\src\lib\types\model-autopilot.types.ts
**Spec Reference**: implementation-plan.md:946-1027
**Pattern to Follow**: branded.types.ts (for reference, but these are NOT branded types)

**Quality Requirements**:

- MUST use TypeScript literal unions (NOT enums or strings)
- MUST provide display name mappings for UI
- MUST provide type guards for runtime validation
- MUST include JSDoc comments for all exports

**Validation Notes**:

- These types are foundation for all other batches
- Type guards enable runtime validation in RPC handlers

**Implementation Details**:

- Export: `ClaudeModel = 'opus' | 'sonnet' | 'haiku'`
- Export: `PermissionLevel = 'ask' | 'auto-edit' | 'yolo'`
- Export: `MODEL_DISPLAY_NAMES: Record<ClaudeModel, string>`
- Export: `PERMISSION_LEVEL_NAMES: Record<PermissionLevel, string>`
- Export: Type guards `isClaudeModel()`, `isPermissionLevel()`
- Do NOT create ClaudeProcessOptions interface here (it already exists in claude-process.ts)

---

### Task 1.2: Update shared library exports and extend ClaudeProcessOptions ✅ COMPLETE

**File 1**: D:\projects\ptah-extension\libs\shared\src\index.ts
**File 2**: D:\projects\ptah-extension\libs\backend\claude-domain\src\cli\claude-process.ts
**Dependencies**: Task 1.1

**Quality Requirements**:

- MUST export all new types from shared library barrel
- MUST extend existing ClaudeProcessOptions interface (NOT replace)
- MUST add JSDoc comments explaining new fields

**Validation Notes**:

- ClaudeProcessOptions already exists (lines 21-30)
- Add autopilotEnabled and permissionLevel fields WITHOUT modifying existing fields

**Implementation Details**:

**File 1 (libs/shared/src/index.ts)**:

```typescript
// Add to existing exports
export { ClaudeModel, PermissionLevel, MODEL_DISPLAY_NAMES, PERMISSION_LEVEL_NAMES, isClaudeModel, isPermissionLevel } from './lib/types/model-autopilot.types';
```

**File 2 (libs/backend/claude-domain/src/cli/claude-process.ts)**:

- Import types from @ptah-extension/shared
- Add to interface (lines 21-30):
  ```typescript
  /** TASK_2025_035: Autopilot enabled flag */
  autopilotEnabled?: boolean;
  /** TASK_2025_035: Permission level when autopilot enabled */
  permissionLevel?: PermissionLevel;
  ```

---

**Batch 1 Verification**:

- [x] All types compile without errors
- [x] Shared library exports all new types
- [x] ClaudeProcessOptions has 6 fields (model, resumeSessionId, verbose, allowedTools, autopilotEnabled, permissionLevel)
- [x] Type guards work correctly with valid/invalid inputs
- [x] Build passes: `npx nx build shared`
- [x] Build passes: `npx nx build claude-domain`
- [x] code-logic-reviewer approved: No stubs/placeholders detected

---

## Batch 2: Frontend State Services ✅ COMPLETE

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: Batch 1 complete
**Commit**: 1524c42

### Task 2.1: Create ModelStateService ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\model-state.service.ts
**Spec Reference**: implementation-plan.md:149-271
**Pattern to Follow**: app-state.service.ts (signal-based state service pattern)

**Quality Requirements**:

- MUST follow AppStateManager signal pattern (private \_signal, public asReadonly)
- MUST use ClaudeRpcService for backend communication
- MUST implement optimistic updates with rollback on RPC failure
- MUST load initial state from backend on construction
- MUST NOT use RxJS (pure Angular signals)

**Validation Notes**:

- Risk: RPC failure must rollback state (catch errors, reload from backend)
- Edge case: Backend returns invalid model → Use default 'sonnet'

**Implementation Details**:

- Imports: `Injectable, signal, computed, inject` from @angular/core
- Imports: `ClaudeRpcService` from './claude-rpc.service'
- Imports: `ClaudeModel, MODEL_DISPLAY_NAMES` from @ptah-extension/shared
- Injectable: `@Injectable({ providedIn: 'root' })`
- Private signals: `_currentModel`, `_availableModels`
- Public readonly: `currentModel`, `availableModels`, `currentModelDisplay` (computed)
- Methods: `switchModel(model)`, `private loadPersistedModel()`
- RPC calls: `model:switch` (with params), `model:get` (no params)

---

### Task 2.2: Create AutopilotStateService ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\autopilot-state.service.ts
**Spec Reference**: implementation-plan.md:274-428
**Pattern to Follow**: app-state.service.ts (same as Task 2.1)

**Quality Requirements**:

- MUST follow AppStateManager signal pattern
- MUST support three permission levels (ask, auto-edit, yolo)
- MUST implement optimistic updates with rollback on RPC failure
- MUST load initial state from backend on construction
- MUST NOT use RxJS (pure Angular signals)

**Validation Notes**:

- Risk: RPC failure must rollback enabled AND permissionLevel states
- Edge case: Backend returns invalid permission level → Use default 'ask'

**Implementation Details**:

- Imports: `Injectable, signal, computed, inject` from @angular/core
- Imports: `ClaudeRpcService` from './claude-rpc.service'
- Imports: `PermissionLevel, PERMISSION_LEVEL_NAMES` from @ptah-extension/shared
- Injectable: `@Injectable({ providedIn: 'root' })`
- Private signals: `_enabled`, `_permissionLevel`
- Public readonly: `enabled`, `permissionLevel`, `statusText` (computed)
- Methods: `toggleAutopilot()`, `setPermissionLevel(level)`, `private loadPersistedState()`
- RPC calls: `autopilot:toggle` (with params), `autopilot:get` (no params)

---

### Task 2.3: Update frontend core library exports ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\core\src\index.ts
**Dependencies**: Task 2.1, Task 2.2

**Quality Requirements**:

- MUST export both new services from barrel file
- MUST maintain alphabetical order of exports

**Implementation Details**:

```typescript
// Add to existing exports
export * from './lib/services/model-state.service';
export * from './lib/services/autopilot-state.service';
```

---

**Batch 2 Verification**:

- [x] Both services compile without errors
- [x] Services follow signal-based pattern (private \_signal, public asReadonly)
- [x] Services inject ClaudeRpcService correctly
- [x] Computed signals work (currentModelDisplay, statusText)
- [x] Frontend core library exports services
- [x] code-logic-reviewer approved: No stubs/placeholders detected
- [x] Git commit created: 1524c42

---

## Batch 3: Backend RPC Handlers ✅ COMPLETE

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batch 1 complete, Batch 2 complete
**Commit**: 9f58021

### Task 3.1: Add model:switch and model:get RPC handlers ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\vscode-core\src\messaging\rpc-method-registration.service.ts
**Spec Reference**: implementation-plan.md:431-613
**Pattern to Follow**: rpc-method-registration.service.ts:153-256 (chat:start handler)

**Quality Requirements**:

- MUST validate model against whitelist ['opus', 'sonnet', 'haiku']
- MUST persist to workspace configuration (ConfigurationTarget.Workspace)
- MUST return structured { success, data?, error? } response
- MUST log all operations with this.logger
- MUST follow try-catch error handling pattern

**Validation Notes**:

- Risk: ConfigManager may not be injected → Check constructor, add if missing
- Edge case: Invalid model value → Return error response (do NOT throw)
- Edge case: Config write fails → Catch error, return structured error response

**Implementation Details**:

- Location: Create new private method `registerModelAndAutopilotMethods()`
- Call from: `registerAll()` method (add to existing registrations)
- Imports: Add `ClaudeModel` from '@ptah-extension/shared'
- model:switch handler:
  - Params: `{ model: ClaudeModel }`
  - Validate: `if (!validModels.includes(model)) throw new Error(...)`
  - Persist: `await this.configManager.set('model.selected', model, { target: vscode.ConfigurationTarget.Workspace })`
  - Return: `{ success: true }`
- model:get handler:
  - Params: None
  - Read: `this.configManager.getWithDefault<ClaudeModel>('model.selected', 'sonnet')`
  - Return: `{ success: true, data: { model } }`

---

### Task 3.2: Add autopilot:toggle and autopilot:get RPC handlers ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\vscode-core\src\messaging\rpc-method-registration.service.ts
**Spec Reference**: implementation-plan.md:526-584
**Pattern to Follow**: Same as Task 3.1
**Dependencies**: Task 3.1 (same method)

**Quality Requirements**:

- MUST validate permission level against whitelist ['ask', 'auto-edit', 'yolo']
- MUST persist to workspace configuration (ConfigurationTarget.Workspace)
- MUST log YOLO mode as dangerous operation
- MUST return structured responses

**Validation Notes**:

- Risk: Both enabled and permissionLevel must be validated
- Edge case: Invalid permission level → Return error response
- Security: YOLO mode must be clearly logged with WARNING level

**Implementation Details**:

- Location: Same method as Task 3.1 (`registerModelAndAutopilotMethods()`)
- Imports: Add `PermissionLevel` from '@ptah-extension/shared'
- autopilot:toggle handler:
  - Params: `{ enabled: boolean, permissionLevel: PermissionLevel }`
  - Validate: `if (!validLevels.includes(permissionLevel)) throw new Error(...)`
  - Warn: `if (enabled && permissionLevel === 'yolo') this.logger.warn('YOLO mode enabled - DANGEROUS')`
  - Persist: `await this.configManager.set('autopilot.enabled', enabled, ...)` AND `set('autopilot.permissionLevel', permissionLevel, ...)`
  - Return: `{ success: true }`
- autopilot:get handler:
  - Params: None
  - Read: `getWithDefault<boolean>('autopilot.enabled', false)` AND `getWithDefault<PermissionLevel>('autopilot.permissionLevel', 'ask')`
  - Return: `{ success: true, data: { enabled, permissionLevel } }`

---

### Task 3.3: Verify ConfigManager injection in RpcMethodRegistrationService ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\vscode-core\src\messaging\rpc-method-registration.service.ts
**Dependencies**: Task 3.1, Task 3.2

**Quality Requirements**:

- MUST verify ConfigManager is injected via constructor
- IF NOT injected, MUST add to constructor with @inject(TOKENS.CONFIG_MANAGER)
- MUST NOT break existing functionality

**Validation Notes**:

- Risk: ConfigManager may already be injected (check constructor first)
- If missing: Add to constructor, update all usages

**Implementation Details**:

1. Read constructor (around line 132-146)
2. Check if `this.configManager` is declared
3. If missing:
   - Add to constructor params: `@inject(TOKENS.CONFIG_MANAGER) private readonly configManager: ConfigManager`
   - Import: Add `ConfigManager` from '../config/config-manager'
   - Import: Ensure `TOKENS` import includes `CONFIG_MANAGER`
4. If present: No changes needed (verify this.configManager is accessible)

---

**Batch 3 Verification**:

- [x] All four RPC handlers registered (model:switch, model:get, autopilot:toggle, autopilot:get)
- [x] Handlers follow try-catch pattern with structured responses
- [x] ConfigManager injected correctly
- [x] Input validation throws errors for invalid values
- [x] Workspace configuration persisted correctly
- [x] YOLO mode logged with WARNING level
- [x] Build passes: `npx nx build vscode-core`
- [x] code-logic-reviewer approved: No stubs/placeholders detected
- [x] Git commit created: 9f58021

---

## Batch 4: ClaudeProcess Integration ✅ COMPLETE

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batch 1 complete, Batch 3 complete
**Commit**: b120a5a

### Task 4.1: Modify ClaudeProcess.buildArgs() to support autopilot flags ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\claude-domain\src\cli\claude-process.ts
**Spec Reference**: implementation-plan.md:616-698
**Pattern to Follow**: claude-process.ts:104-134 (existing buildArgs method)

**Quality Requirements**:

- MUST maintain backward compatibility (no flags for default settings)
- MUST add flags conditionally based on options parameter
- MUST maintain flag order (base → permissions → model → resume → allowedTools)
- MUST log full CLI command with flags for debugging

**Validation Notes**:

- Risk: Model flag already exists (line 115-117) - DO NOT duplicate
- Edge case: If autopilotEnabled is undefined, treat as false (default)
- Edge case: If permissionLevel is undefined with autopilot enabled, treat as 'ask' (no flags)

**Implementation Details**:

- Location: Inside buildArgs() method (line 104-134)
- After line 113 (permission-prompt-tool), add:

  ```typescript
  // TASK_2025_035: Add autopilot/permission flags
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
  ```

- NOTE: Model flag (line 115-117) stays unchanged - already correct!

---

### Task 4.2: Modify chat:start RPC handler to read config and pass to ClaudeProcess ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\vscode-core\src\messaging\rpc-method-registration.service.ts
**Spec Reference**: implementation-plan.md:706-727
**Pattern to Follow**: rpc-method-registration.service.ts:153-256 (existing chat:start handler)
**Dependencies**: Task 4.1

**Quality Requirements**:

- MUST read model and autopilot config BEFORE spawning ClaudeProcess
- MUST pass config values via options parameter to process.start()
- MUST use safe defaults if config read fails (sonnet, false, ask)
- MUST NOT break existing chat functionality

**Validation Notes**:

- Risk: options parameter may already exist with other fields (merge, do NOT replace)
- Edge case: Config read fails → Use defaults (getWithDefault handles this)

**Implementation Details**:

- Location: Inside chat:start handler (line 153-256)
- AFTER line 171 (process created), BEFORE process.start() call:

  ```typescript
  // TASK_2025_035: Read model and autopilot configuration
  const selectedModel = this.configManager.getWithDefault<ClaudeModel>('model.selected', 'sonnet');
  const autopilotEnabled = this.configManager.getWithDefault<boolean>('autopilot.enabled', false);
  const permissionLevel = this.configManager.getWithDefault<PermissionLevel>('autopilot.permissionLevel', 'ask');

  // Build enhanced options
  const processOptions: ClaudeProcessOptions = {
    model: selectedModel,
    autopilotEnabled,
    permissionLevel,
    // Merge with any existing options from params
    ...(options || {}),
  };

  // Start the process with enhanced options
  await process.start(prompt, processOptions);
  ```

- Import: Add `ClaudeModel, PermissionLevel` from '@ptah-extension/shared'
- Import: Add `ClaudeProcessOptions` from '@ptah-extension/claude-domain'

---

### Task 4.3: Modify chat:continue RPC handler to read config and pass to ClaudeProcess ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\vscode-core\src\messaging\rpc-method-registration.service.ts
**Spec Reference**: implementation-plan.md:706-727 (same pattern as chat:start)
**Pattern to Follow**: Same as Task 4.2
**Dependencies**: Task 4.1, Task 4.2

**Quality Requirements**:

- MUST follow same pattern as Task 4.2
- MUST read config before process.resume()
- MUST pass options to resume() method

**Implementation Details**:

- Location: Inside chat:continue handler (line 259-369)
- Find process.resume() call
- BEFORE resume() call, add same config reading logic as Task 4.2
- Pass processOptions to resume() method

---

**Batch 4 Verification**:

- [x] buildArgs() adds autopilot flags conditionally
- [x] Model flag still works (unchanged from existing code)
- [x] chat:start handler reads config and passes to ClaudeProcess
- [x] chat:continue handler reads config and passes to ClaudeProcess
- [x] No flags added for default settings (backward compatible)
- [x] YOLO mode adds --dangerously-skip-permissions flag
- [x] Auto-edit mode adds --allowedTools Edit,Write flag
- [x] Build passes: `npx nx build claude-domain`
- [x] Build passes: `npx nx build vscode-core`
- [x] code-logic-reviewer approved: No stubs/placeholders detected
- [x] Git commit created: b120a5a

---

## Batch 5: ChatInputComponent Wiring ✅ COMPLETE

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: Batch 2 complete, Batch 3 complete
**Commit**: 6be86a6

### Task 5.1: Wire ChatInputComponent to state services ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\chat-input.component.ts
**Spec Reference**: implementation-plan.md:760-915
**Pattern to Follow**: chat-input.component.ts:131-216 (existing component)

**Quality Requirements**:

- MUST inject ModelStateService and AutopilotStateService via inject()
- MUST remove local \_selectedModel and \_autopilotEnabled signals
- MUST bind template to service signals (not local signals)
- MUST call service methods on user interaction (async, error handled)
- MUST NOT block UI on RPC calls (optimistic updates in services)

**Validation Notes**:

- Risk: Local signals removed → Template bindings MUST update to service signals
- Edge case: RPC errors → Log to console, service handles rollback

**Implementation Details**:

- Imports: Add `ModelStateService, AutopilotStateService` from '@ptah-extension/core'
- Imports: Add `ClaudeModel` from '@ptah-extension/shared' (for method signature)
- Inject: `readonly modelState = inject(ModelStateService);`
- Inject: `readonly autopilotState = inject(AutopilotStateService);`
- DELETE lines:
  - `private readonly _selectedModel = signal('Claude Sonnet 4.0');`
  - `private readonly _autopilotEnabled = signal(false);`
  - `readonly selectedModel = this._selectedModel.asReadonly();`
  - `readonly autopilotEnabled = this._autopilotEnabled.asReadonly();`
- Modify selectModel() method (line 204-207):
  ```typescript
  selectModel(model: ClaudeModel): void {
    this.modelState.switchModel(model).catch((error) => {
      console.error('[ChatInputComponent] Failed to switch model:', error);
    });
  }
  ```
- Modify toggleAutopilot() method (line 212-215):
  ```typescript
  toggleAutopilot(): void {
    this.autopilotState.toggleAutopilot().catch((error) => {
      console.error('[ChatInputComponent] Failed to toggle autopilot:', error);
    });
  }
  ```

---

### Task 5.2: Update ChatInputComponent template bindings ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\chat-input.component.ts
**Dependencies**: Task 5.1

**Quality Requirements**:

- MUST update template to bind to service signals
- MUST update model dropdown to show service.currentModelDisplay()
- MUST update autopilot toggle to bind to service.enabled()
- MUST update dropdown click handlers to pass correct ClaudeModel values

**Validation Notes**:

- Risk: Template bindings MUST match service signal names
- Edge case: Model display name computed signal must be used (not raw model value)

**Implementation Details**:

- Template location: Lines 81-113 (model dropdown), 116-124 (autopilot toggle)
- Update model dropdown button:
  - Change: `{{ selectedModel() }}` → `{{ modelState.currentModelDisplay() }}`
- Update model dropdown items:
  - Change: `(click)="selectModel('Claude Sonnet 4.0')"` → `(click)="selectModel('sonnet')"`
  - Change: `(click)="selectModel('Claude Opus 4.0')"` → `(click)="selectModel('opus')"`
  - Change: `(click)="selectModel('Claude Haiku 3.5')"` → `(click)="selectModel('haiku')"`
- Update autopilot toggle:
  - Change: `[checked]="autopilotEnabled()"` → `[checked]="autopilotState.enabled()"`

---

**Batch 5 Verification**:

- [x] Component injects both state services
- [x] Local signals removed (no \_selectedModel, \_autopilotEnabled)
- [x] Template bindings updated to use service signals
- [x] Model dropdown shows correct display names
- [x] Dropdown click handlers pass ClaudeModel literal values
- [x] Autopilot toggle binds to service.enabled()
- [x] Error handling catches RPC failures and logs
- [x] Build passes: `npx nx build chat`
- [x] code-logic-reviewer approved: No stubs/placeholders detected
- [x] Git commit created: 6be86a6

---

## Summary

**Total Batches**: 5
**Total Tasks**: 13
**Estimated Effort**: 4-6 hours

**Batch Breakdown**:

- Batch 1 (Backend): Shared types (2 tasks) - Foundation
- Batch 2 (Frontend): State services (3 tasks) - Reactive state management
- Batch 3 (Backend): RPC handlers (3 tasks) - Backend persistence
- Batch 4 (Backend): ClaudeProcess integration (3 tasks) - CLI flag application
- Batch 5 (Frontend): UI wiring (2 tasks) - Connect UI to services

**Critical Path**: Batch 1 → Batch 2 & 3 (parallel) → Batch 4 → Batch 5

**Files Created**: 2

- libs/shared/src/lib/types/model-autopilot.types.ts
- libs/frontend/core/src/lib/services/model-state.service.ts
- libs/frontend/core/src/lib/services/autopilot-state.service.ts

**Files Modified**: 5

- libs/shared/src/index.ts
- libs/backend/claude-domain/src/cli/claude-process.ts
- libs/frontend/core/src/index.ts
- libs/backend/vscode-core/src/messaging/rpc-method-registration.service.ts
- libs/frontend/chat/src/lib/components/molecules/chat-input.component.ts
