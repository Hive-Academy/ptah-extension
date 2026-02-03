# Development Tasks - TASK_2025_135: Prompt Harness System

**Total Tasks**: 21 | **Batches**: 6 | **Status**: 1/6 complete

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- **TOKENS.EXTENSION_CONTEXT** exists in vscode-core (verified in license.service.ts pattern)
- **LicenseService** injection pattern established (verified in auth-rpc.handlers.ts:41-43)
- **PTAH_SYSTEM_PROMPT** export verified from vscode-lm-tools (imported in sdk-query-options-builder.ts:20)
- **RpcHandler registration pattern** verified (auth-rpc.handlers.ts demonstrates exact pattern)
- **Signal-based frontend state** pattern verified (settings.component.ts demonstrates pattern)
- **SDK_TOKENS structure** verified for adding new tokens (di/tokens.ts:10-54)
- **registerSdkServices pattern** verified for service registration (di/register.ts)

### Risks Identified

| Risk                                              | Severity | Mitigation                                               |
| ------------------------------------------------- | -------- | -------------------------------------------------------- |
| Token budget overflow with many power-ups enabled | MEDIUM   | Hard limit check in assemblePrompt() with warnings in UI |
| Power-up conflicts causing incoherent prompts     | LOW      | Conflict detection system with priority-based resolution |
| Map serialization in globalState                  | LOW      | Convert Map to/from Object for JSON storage              |

### Edge Cases to Handle

- [x] Empty power-up states on first use -> Default to empty Map
- [x] Premium user becomes free -> Filter out premium power-ups in assembly
- [x] Import config with unknown power-up IDs -> Skip unknown IDs gracefully
- [x] Custom section with sensitive content -> Store in SecretStorage

---

## Batch 1: Core Data Layer (Backend Foundation) - COMPLETE

**Developer Type**: backend-developer
**Dependencies**: None
**Tasks**: 4 | **Status**: COMPLETE
**Commit**: 0953314

### Task 1.1: Create Prompt Harness Type Definitions - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\types.ts`
**Action**: CREATE
**Spec Reference**: implementation-plan.md:149-303

**Requirements**:

1. Define `PowerUpDefinition` interface with all fields (id, name, description, category, sourceAgent, isPremium, version, content, defaultPriority, conflictsWith, tokenCount)
2. Define `PowerUpState` interface (powerUpId, enabled, priority?, lastModified)
3. Define `UserPromptSection` interface (id, name, content, enabled, priority, createdAt, updatedAt)
4. Define `PromptHarnessConfig` interface (version, powerUpStates as Map, customSections, showRecommendations, lastWorkspaceType?)
5. Define `AssembledPrompt` interface with layers array and warnings array
6. Define layer type union: `'base' | 'project' | 'agent' | 'user' | 'premium'`
7. Define warning type union: `'token_budget' | 'conflict' | 'deprecated'`
8. Define severity type union: `'info' | 'warning' | 'error'`
9. Define category type union: `'investigation' | 'code-quality' | 'workflow' | 'mcp' | 'custom'`

**Pattern to Follow**: `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts` for interface style

**Acceptance Criteria**:

- [ ] All interfaces match implementation-plan.md specifications exactly
- [ ] No use of `any` type - all fields typed
- [ ] JSDoc comments on all interfaces and complex fields
- [ ] Exported from index.ts barrel file

---

### Task 1.2: Create Power-Up Registry with Initial Power-Ups - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\power-up-registry.ts`
**Action**: CREATE
**Spec Reference**: implementation-plan.md:310-562

**Requirements**:

1. Create `POWER_UP_DEFINITIONS` as readonly array of PowerUpDefinition
2. Include 9 power-ups from implementation plan:
   - `investigation-first` (free, investigation category, priority 10)
   - `anti-hallucination` (free, investigation category, priority 15)
   - `code-quality-paranoid` (free, code-quality category, priority 20)
   - `escalation-protocol` (free, workflow category, priority 25)
   - `solid-principles` (free, code-quality category, priority 30)
   - `mcp-cost-optimization` (premium, mcp category, priority 40)
   - `mcp-token-intelligence` (premium, mcp category, priority 45)
   - `mcp-ide-powers` (premium, mcp category, priority 50)
3. Create helper functions:
   - `getPowerUp(id: string): PowerUpDefinition | undefined`
   - `getPowerUpsByCategory(category): PowerUpDefinition[]`
   - `getFreePowerUps(): PowerUpDefinition[]`
   - `getPremiumPowerUps(): PowerUpDefinition[]`
4. Include proper token count estimates for each power-up

**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\anthropic-provider-registry.ts` for registry pattern

**Acceptance Criteria**:

- [ ] All 9 power-ups defined with complete content
- [ ] Helper functions work correctly
- [ ] Token counts are reasonable estimates (based on ~4 chars per token)
- [ ] Content matches implementation-plan.md exactly

---

### Task 1.3: Create Barrel Export for prompt-harness Module - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\index.ts`
**Action**: CREATE

**Requirements**:

1. Export all types from `./types`
2. Export registry and helper functions from `./power-up-registry`
3. Will export UserPromptStore in Batch 2
4. Will export PromptHarnessService in Batch 3

**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\index.ts`

**Acceptance Criteria**:

- [ ] Clean barrel file with organized exports
- [ ] No circular dependency issues

---

### Task 1.4: Add prompt-harness Module Export to Library Index - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\index.ts`
**Action**: MODIFY

**Requirements**:

1. Add export for prompt-harness module types
2. Add export for power-up registry and helper functions
3. Follow existing export pattern in file

**Pattern to Follow**: Lines 50-62 showing existing helper exports

**Acceptance Criteria**:

- [ ] Module exports accessible via `@ptah-extension/agent-sdk`
- [ ] No breaking changes to existing exports
- [ ] Build succeeds: `nx build agent-sdk`

---

**Batch 1 Verification**:

- [x] All files exist at specified paths
- [x] Build passes: `npx nx build agent-sdk`
- [x] Types are correctly exported and accessible
- [x] No TypeScript errors

---

## Batch 2: Storage Layer (UserPromptStore) - IN PROGRESS

**Developer Type**: backend-developer
**Dependencies**: Batch 1
**Tasks**: 3 | **Status**: IN PROGRESS

### Task 2.1: Create UserPromptStore Service - IN PROGRESS

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\user-prompt-store.ts`
**Action**: CREATE
**Spec Reference**: implementation-plan.md:571-709

**Requirements**:

1. Injectable class with `@injectable()` decorator
2. Inject `TOKENS.EXTENSION_CONTEXT` for VS Code context
3. Inject `TOKENS.LOGGER` for logging
4. Define storage keys as static readonly:
   - `ptah.promptHarness.powerUpStates` (globalState)
   - `ptah.promptHarness.customSections` (SecretStorage)
   - `ptah.promptHarness.version`
5. Implement methods:
   - `getPowerUpStates(): Promise<Map<string, PowerUpState>>`
   - `setPowerUpState(powerUpId: string, state: PowerUpState): Promise<void>`
   - `getCustomSections(): Promise<UserPromptSection[]>`
   - `setCustomSections(sections: UserPromptSection[]): Promise<void>`
   - `getConfig(): Promise<PromptHarnessConfig>`
   - `exportConfig(): Promise<string>` (JSON stringified)
   - `importConfig(jsonString: string): Promise<{ success: boolean; error?: string }>`
6. Handle Map<->Object conversion for globalState serialization
7. Parse/stringify JSON for SecretStorage

**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\license.service.ts:119-165`

**Acceptance Criteria**:

- [ ] All methods implemented per specification
- [ ] Proper error handling with try/catch
- [ ] Logger used for debug/info/error messages
- [ ] Map serialization works correctly
- [ ] SecretStorage used for custom sections (sensitive)

---

### Task 2.2: Add DI Token for UserPromptStore - IN PROGRESS

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\tokens.ts`
**Action**: MODIFY

**Requirements**:

1. Add `SDK_USER_PROMPT_STORE: 'SdkUserPromptStore'` to SDK_TOKENS object
2. Place in logical grouping with other service tokens

**Pattern to Follow**: Lines 10-54 showing existing token pattern

**Acceptance Criteria**:

- [ ] Token added to SDK_TOKENS object
- [ ] Follows naming convention (SDK\_ prefix, camelCase value)

---

### Task 2.3: Register UserPromptStore in DI Container - IN PROGRESS

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\register.ts`
**Action**: MODIFY

**Requirements**:

1. Import `UserPromptStore` from `../prompt-harness`
2. Register with singleton lifecycle:
   ```typescript
   container.register(SDK_TOKENS.SDK_USER_PROMPT_STORE, { useClass: UserPromptStore }, { lifecycle: Lifecycle.Singleton });
   ```
3. Add after existing service registrations

**Pattern to Follow**: Lines 128-133 showing SdkPermissionHandler registration

**Acceptance Criteria**:

- [ ] Service registered as singleton
- [ ] Follows existing registration pattern
- [ ] No import errors

---

**Batch 2 Verification**:

- [ ] All files exist at specified paths
- [ ] Build passes: `npx nx build agent-sdk`
- [ ] UserPromptStore can be resolved from DI container
- [ ] Storage operations work with VS Code context

---

## Batch 3: Assembly Service (PromptHarnessService) - PENDING

**Developer Type**: backend-developer
**Dependencies**: Batch 1, Batch 2
**Tasks**: 3 | **Status**: PENDING

### Task 3.1: Create PromptHarnessService - PENDING

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\prompt-harness.service.ts`
**Action**: CREATE
**Spec Reference**: implementation-plan.md:719-912

**Requirements**:

1. Injectable class with `@injectable()` decorator
2. Inject `TOKENS.LOGGER` and `SDK_TOKENS.SDK_USER_PROMPT_STORE`
3. Define constants:
   - `MAX_PROMPT_TOKENS = 8000`
   - `TOKEN_WARNING_THRESHOLD = 6000`
4. Implement `assemblePrompt(isPremium: boolean): Promise<AssembledPrompt>`:
   - Get config from UserPromptStore
   - Filter enabled power-ups (respect isPremium)
   - Sort by priority
   - Check for conflicts
   - Add custom sections
   - Add PTAH_SYSTEM_PROMPT for premium users
   - Calculate total tokens
   - Generate warnings if over threshold/budget
   - Return AssembledPrompt with layers and warnings
5. Implement `getAppendPrompt(isPremium: boolean): Promise<string>`:
   - Call assemblePrompt
   - Return just the text + PTAH_BEHAVIORAL_PROMPT
6. Implement private helpers:
   - `getEnabledPowerUps(config, isPremium): PowerUpDefinition[]`
   - `checkConflicts(powerUp, allEnabled): string[]`
   - `estimateTokens(text: string): number` (simple: text.length / 4)

**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts` for injectable service pattern

**Acceptance Criteria**:

- [ ] All methods implemented per specification
- [ ] Premium filtering works correctly
- [ ] Conflict detection identifies conflicting power-ups
- [ ] Token counting provides reasonable estimates
- [ ] Warnings generated for budget exceedance
- [ ] PTAH_BEHAVIORAL_PROMPT always included

---

### Task 3.2: Add DI Token for PromptHarnessService - PENDING

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\tokens.ts`
**Action**: MODIFY

**Requirements**:

1. Add `SDK_PROMPT_HARNESS_SERVICE: 'SdkPromptHarnessService'` to SDK_TOKENS object

**Acceptance Criteria**:

- [ ] Token added following naming convention

---

### Task 3.3: Register PromptHarnessService in DI Container - PENDING

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\register.ts`
**Action**: MODIFY

**Requirements**:

1. Import `PromptHarnessService` from `../prompt-harness`
2. Register with singleton lifecycle after UserPromptStore registration

**Acceptance Criteria**:

- [ ] Service registered as singleton
- [ ] Registered after UserPromptStore (dependency order)

---

**Batch 3 Verification**:

- [ ] All files exist at specified paths
- [ ] Build passes: `npx nx build agent-sdk`
- [ ] PromptHarnessService can be resolved from DI container
- [ ] assemblePrompt returns correct structure

---

## Batch 4: RPC Handlers - PENDING

**Developer Type**: backend-developer
**Dependencies**: Batch 3
**Tasks**: 4 | **Status**: PENDING

### Task 4.1: Add RPC Type Definitions for Prompt Harness - PENDING

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts`
**Action**: MODIFY
**Spec Reference**: implementation-plan.md:36-43

**Requirements**:

1. Add type definitions after line ~600 (after Provider types):

   ```typescript
   // ============================================================
   // Prompt Harness RPC Types (TASK_2025_135)
   // ============================================================

   /** Power-up definition for frontend display */
   export interface PowerUpInfo {
     id: string;
     name: string;
     description: string;
     category: 'investigation' | 'code-quality' | 'workflow' | 'mcp' | 'custom';
     isPremium: boolean;
     version: string;
     tokenCount: number;
     isAvailable: boolean;
     conflictsWith?: string[];
   }

   /** Power-up state */
   export interface PowerUpStateInfo {
     powerUpId: string;
     enabled: boolean;
     priority?: number;
     lastModified: number;
   }

   /** Custom prompt section */
   export interface UserPromptSectionInfo {
     id: string;
     name: string;
     content: string;
     enabled: boolean;
     priority: number;
     createdAt: number;
     updatedAt: number;
   }

   /** Parameters for promptHarness:getConfig */
   export type PromptHarnessGetConfigParams = Record<string, never>;

   /** Response from promptHarness:getConfig */
   export interface PromptHarnessGetConfigResponse {
     powerUpStates: Record<string, PowerUpStateInfo>;
     customSections: UserPromptSectionInfo[];
     isPremium: boolean;
     availablePowerUps: PowerUpInfo[];
   }

   /** Parameters for promptHarness:saveConfig */
   export interface PromptHarnessSaveConfigParams {
     powerUpStates?: Record<string, PowerUpStateInfo>;
     customSections?: UserPromptSectionInfo[];
   }

   /** Response from promptHarness:saveConfig */
   export interface PromptHarnessSaveConfigResponse {
     success: boolean;
     error?: string;
   }

   /** Assembled prompt layer for preview */
   export interface PromptLayerInfo {
     name: string;
     type: 'base' | 'project' | 'agent' | 'user' | 'premium';
     content: string;
     tokenCount: number;
     source?: string;
   }

   /** Prompt warning */
   export interface PromptWarningInfo {
     type: 'token_budget' | 'conflict' | 'deprecated';
     message: string;
     severity: 'info' | 'warning' | 'error';
   }

   /** Parameters for promptHarness:getPreview */
   export type PromptHarnessGetPreviewParams = Record<string, never>;

   /** Response from promptHarness:getPreview */
   export interface PromptHarnessGetPreviewResponse {
     text: string;
     totalTokens: number;
     layers: PromptLayerInfo[];
     warnings: PromptWarningInfo[];
   }

   /** Parameters for promptHarness:exportConfig */
   export type PromptHarnessExportConfigParams = Record<string, never>;

   /** Response from promptHarness:exportConfig */
   export interface PromptHarnessExportConfigResponse {
     json: string;
   }

   /** Parameters for promptHarness:importConfig */
   export interface PromptHarnessImportConfigParams {
     json: string;
   }

   /** Response from promptHarness:importConfig */
   export interface PromptHarnessImportConfigResponse {
     success: boolean;
     error?: string;
   }
   ```

2. Add to RpcMethodRegistry (around line 824):

   ```typescript
   // ---- Prompt Harness Methods (TASK_2025_135) ----
   'promptHarness:getConfig': {
     params: PromptHarnessGetConfigParams;
     result: PromptHarnessGetConfigResponse;
   };
   'promptHarness:saveConfig': {
     params: PromptHarnessSaveConfigParams;
     result: PromptHarnessSaveConfigResponse;
   };
   'promptHarness:getPreview': {
     params: PromptHarnessGetPreviewParams;
     result: PromptHarnessGetPreviewResponse;
   };
   'promptHarness:exportConfig': {
     params: PromptHarnessExportConfigParams;
     result: PromptHarnessExportConfigResponse;
   };
   'promptHarness:importConfig': {
     params: PromptHarnessImportConfigParams;
     result: PromptHarnessImportConfigResponse;
   };
   ```

3. Add to RPC_METHOD_NAMES array (around line 1000):
   ```typescript
   // Prompt Harness Methods (TASK_2025_135)
   'promptHarness:getConfig',
   'promptHarness:saveConfig',
   'promptHarness:getPreview',
   'promptHarness:exportConfig',
   'promptHarness:importConfig',
   ```

**Acceptance Criteria**:

- [ ] All types defined
- [ ] RpcMethodRegistry updated
- [ ] RPC_METHOD_NAMES array updated
- [ ] Build passes: `npx nx build shared`

---

### Task 4.2: Create PromptHarnessRpcHandlers - PENDING

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\prompt-harness-rpc.handlers.ts`
**Action**: CREATE
**Spec Reference**: implementation-plan.md:921-1065

**Requirements**:

1. Injectable class with `@injectable()` decorator
2. Inject dependencies:
   - `TOKENS.LOGGER`
   - `TOKENS.RPC_HANDLER`
   - `TOKENS.LICENSE_SERVICE`
   - `SDK_TOKENS.SDK_PROMPT_HARNESS_SERVICE`
   - `SDK_TOKENS.SDK_USER_PROMPT_STORE`
3. Import POWER_UP_DEFINITIONS from agent-sdk
4. Implement `register()` method that registers:
   - `promptHarness:getConfig`
   - `promptHarness:saveConfig`
   - `promptHarness:getPreview`
   - `promptHarness:exportConfig`
   - `promptHarness:importConfig`
5. Each handler should:
   - Use Zod validation where needed (saveConfig, importConfig)
   - Check isPremium from LicenseService for getConfig/getPreview
   - Log operations
   - Return proper response types

**Pattern to Follow**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\auth-rpc.handlers.ts`

**Acceptance Criteria**:

- [ ] All 5 RPC methods registered
- [ ] Zod validation for input parameters
- [ ] Premium status checked from LicenseService
- [ ] Proper error handling
- [ ] Logging for all operations

---

### Task 4.3: Register PromptHarnessRpcHandlers in Registration Service - PENDING

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\rpc-method-registration.service.ts`
**Action**: MODIFY

**Requirements**:

1. Import `PromptHarnessRpcHandlers` from handlers
2. Add to constructor injection (around line 87):
   ```typescript
   private readonly promptHarnessHandlers: PromptHarnessRpcHandlers,
   ```
3. Add registration call in `registerAll()` method (around line 114):
   ```typescript
   this.promptHarnessHandlers.register();
   ```

**Pattern to Follow**: Lines 42-48 showing AuthRpcHandlers import and usage

**Acceptance Criteria**:

- [ ] Handler imported
- [ ] Injected in constructor
- [ ] register() called in registerAll()

---

### Task 4.4: Update Barrel Export in prompt-harness Module - PENDING

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\index.ts`
**Action**: MODIFY

**Requirements**:

1. Export UserPromptStore
2. Export PromptHarnessService
3. Ensure all types are exported

**Acceptance Criteria**:

- [ ] All services and types exported
- [ ] No circular dependencies

---

**Batch 4 Verification**:

- [ ] All files exist at specified paths
- [ ] Build passes: `npx nx build shared` and `npx nx build ptah-extension-vscode`
- [ ] RPC methods respond correctly when called
- [ ] verifyRpcRegistration passes (no missing handlers)

---

## Batch 5: SDK Integration - PENDING

**Developer Type**: backend-developer
**Dependencies**: Batch 3
**Tasks**: 2 | **Status**: PENDING

### Task 5.1: Integrate PromptHarnessService into SdkQueryOptionsBuilder - PENDING

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts`
**Action**: MODIFY
**Spec Reference**: implementation-plan.md:1074-1145

**Requirements**:

1. Import `PromptHarnessService` from `../prompt-harness`
2. Import `SDK_TOKENS` if not already
3. Add `PromptHarnessService` to constructor injection
4. Modify `buildSystemPrompt()` method to be async:
   - Keep model identity prompt logic (lines 142-175)
   - Keep user's custom system prompt (if sessionConfig.systemPrompt)
   - Replace static PTAH_BEHAVIORAL_PROMPT/PTAH_SYSTEM_PROMPT with:
     ```typescript
     const harnessPrompt = await this.promptHarnessService.getAppendPrompt(isPremium);
     appendParts.push(harnessPrompt);
     ```
5. Update method signature from `private buildSystemPrompt(...)` to `private async buildSystemPrompt(...)`
6. Update callers of buildSystemPrompt to await the result

**Pattern to Follow**: Current implementation lines 199-250

**Acceptance Criteria**:

- [ ] PromptHarnessService injected
- [ ] buildSystemPrompt is now async
- [ ] getAppendPrompt called with isPremium flag
- [ ] Callers updated to await
- [ ] Build passes: `npx nx build agent-sdk`

---

### Task 5.2: Update SdkQueryOptionsBuilder Build Method to Handle Async - PENDING

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts`
**Action**: MODIFY

**Requirements**:

1. Find the `build()` method that calls `buildSystemPrompt()`
2. Make the build method async if not already
3. Await the buildSystemPrompt call
4. Ensure all callers of build() handle the Promise

**Acceptance Criteria**:

- [ ] build() method properly awaits buildSystemPrompt
- [ ] No runtime errors from unawaited promises
- [ ] SDK queries include assembled prompt

---

**Batch 5 Verification**:

- [ ] All files exist at specified paths
- [ ] Build passes: `npx nx build agent-sdk`
- [ ] SDK queries include power-up content when enabled
- [ ] Premium users get PTAH_SYSTEM_PROMPT via harness

---

## Batch 6: Frontend Components - PENDING

**Developer Type**: frontend-developer
**Dependencies**: Batch 4
**Tasks**: 5 | **Status**: PENDING

### Task 6.1: Create PromptPowerUpsComponent - PENDING

**Files**:

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\prompt-power-ups.component.ts`
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\prompt-power-ups.component.html`
  **Action**: CREATE
  **Spec Reference**: implementation-plan.md:1161-1237

**Requirements**:

1. Standalone Angular component with OnPush change detection
2. Import LucideAngularModule, ClaudeRpcService from core
3. State signals:
   - `isLoading = signal(true)`
   - `isPremium = signal(false)`
   - `powerUps = signal<PowerUpWithState[]>([])`
   - `customSections = signal<UserPromptSectionInfo[]>([])`
4. Computed signals for filtering by category:
   - `investigationPowerUps`
   - `codeQualityPowerUps`
   - `workflowPowerUps`
   - `mcpPowerUps`
5. Methods:
   - `ngOnInit()` - call loadConfig()
   - `loadConfig()` - RPC call to `promptHarness:getConfig`
   - `togglePowerUp(powerUpId, enabled)` - optimistic update + RPC call to `promptHarness:saveConfig`
6. Template:
   - Loading skeleton when isLoading
   - Category sections with headers
   - Toggle switches for each power-up
   - Lock icon for premium power-ups when not premium
   - Description and token count display

**Pattern to Follow**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\settings.component.ts`

**Acceptance Criteria**:

- [ ] Component loads power-ups from RPC
- [ ] Toggle switches work with optimistic updates
- [ ] Premium power-ups show locked state for free users
- [ ] Categories organized correctly
- [ ] OnPush change detection used

---

### Task 6.2: Create CustomPromptEditorComponent - PENDING

**Files**:

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\custom-prompt-editor.component.ts`
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\custom-prompt-editor.component.html`
  **Action**: CREATE
  **Spec Reference**: implementation-plan.md:1242-1244

**Requirements**:

1. Standalone Angular component with OnPush change detection
2. State signals:
   - `sections = signal<UserPromptSectionInfo[]>([])`
   - `editingSection = signal<UserPromptSectionInfo | null>(null)`
   - `isEditorOpen = signal(false)`
3. Methods:
   - `addSection()` - create new section with generated ID
   - `editSection(section)` - open editor with existing section
   - `saveSection(section)` - validate (max 2000 tokens) and save via RPC
   - `deleteSection(sectionId)` - remove section
   - `reorderSections(newOrder)` - update priorities
4. Template:
   - List of custom sections with edit/delete buttons
   - Add new section button
   - Modal/slide-out editor with:
     - Name input
     - Content textarea (markdown)
     - Token count display (live estimate)
     - Priority input
     - Save/Cancel buttons
5. Input binding for sections (from parent PromptPowerUpsComponent)
6. Output event for section changes

**Pattern to Follow**: Existing component patterns in settings folder

**Acceptance Criteria**:

- [ ] Can create, edit, delete custom sections
- [ ] Token count validates max 2000 tokens
- [ ] Priority ordering works
- [ ] Markdown content preserved

---

### Task 6.3: Create PromptPreviewComponent - PENDING

**Files**:

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\prompt-preview.component.ts`
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\prompt-preview.component.html`
  **Action**: CREATE
  **Spec Reference**: implementation-plan.md:1245-1246

**Requirements**:

1. Standalone Angular component with OnPush change detection
2. State signals:
   - `isLoading = signal(false)`
   - `previewData = signal<PromptHarnessGetPreviewResponse | null>(null)`
   - `isExpanded = signal(false)`
3. Methods:
   - `loadPreview()` - RPC call to `promptHarness:getPreview`
   - `copyToClipboard()` - copy assembled text to clipboard
4. Template:
   - Refresh button to reload preview
   - Total token count display
   - Warnings section (if any)
   - Collapsible layer sections showing:
     - Layer name and type (with color coding)
     - Token count badge
     - Content preview (truncated, expandable)
   - Copy to clipboard button

**Pattern to Follow**: Existing component patterns

**Acceptance Criteria**:

- [ ] Loads preview from RPC
- [ ] Shows all layers with annotations
- [ ] Displays warnings visually
- [ ] Copy to clipboard works
- [ ] Refresh updates preview

---

### Task 6.4: Integrate Power-Ups into SettingsComponent - PENDING

**Files**:

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\settings.component.ts`
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\settings.component.html`
  **Action**: MODIFY
  **Spec Reference**: implementation-plan.md:1247-1248

**Requirements**:

1. Import new components:
   - `PromptPowerUpsComponent`
   - `CustomPromptEditorComponent`
   - `PromptPreviewComponent`
2. Add to imports array in @Component decorator
3. Add new section in template after existing sections:

   ```html
   <!-- Prompt Power-Ups Section -->
   @if (isAuthenticated()) {
   <section class="settings-section">
     <h2>Prompt Power-Ups</h2>
     <p class="text-base-content/70">Customize Claude's behavior with toggleable enhancements</p>

     <ptah-prompt-power-ups />

     @if (showPremiumSections()) {
     <ptah-custom-prompt-editor />
     }

     <ptah-prompt-preview />
   </section>
   }
   ```

4. Ensure section only visible when authenticated

**Acceptance Criteria**:

- [ ] New section appears in settings
- [ ] Visible only when authenticated
- [ ] All child components render
- [ ] Premium-only sections gated correctly

---

### Task 6.5: Add Import/Export Buttons to PromptPowerUpsComponent - PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\prompt-power-ups.component.ts`
**Action**: MODIFY

**Requirements**:

1. Add methods:
   - `exportConfig()` - RPC call to `promptHarness:exportConfig`, download as JSON file
   - `importConfig()` - file picker, read JSON, RPC call to `promptHarness:importConfig`
2. Add buttons in template:
   - Export button (downloads JSON)
   - Import button (opens file picker)
3. Handle import validation errors with toast/alert

**Acceptance Criteria**:

- [ ] Export downloads valid JSON file
- [ ] Import reads and applies configuration
- [ ] Errors shown to user
- [ ] UI updates after import

---

**Batch 6 Verification**:

- [ ] All files exist at specified paths
- [ ] Build passes: `npx nx build chat`
- [ ] Components render correctly in settings
- [ ] Power-up toggles persist and apply
- [ ] Preview shows correct assembled prompt
- [ ] Import/export functionality works

---

## Summary

| Batch | Name                | Developer          | Tasks | Dependencies |
| ----- | ------------------- | ------------------ | ----- | ------------ |
| 1     | Core Data Layer     | backend-developer  | 4     | None         |
| 2     | Storage Layer       | backend-developer  | 3     | Batch 1      |
| 3     | Assembly Service    | backend-developer  | 3     | Batch 1, 2   |
| 4     | RPC Handlers        | backend-developer  | 4     | Batch 3      |
| 5     | SDK Integration     | backend-developer  | 2     | Batch 3      |
| 6     | Frontend Components | frontend-developer | 5     | Batch 4      |

**Total Tasks**: 21
**Estimated Effort**: 12-16 hours

---

## Verification Commands

```bash
# After each batch, run:
npx nx build agent-sdk
npx nx build shared
npx nx build ptah-extension-vscode
npx nx build chat

# Full typecheck:
npx nx run-many --target=typecheck --all

# Run tests:
npx nx test agent-sdk
npx nx test shared
npx nx test chat
```
