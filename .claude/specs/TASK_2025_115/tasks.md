# Development Tasks - TASK_2025_115

**Total Tasks**: 24 | **Batches**: 9 | **Status**: 9/9 complete

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- **Injectable pattern**: Verified at `setup-wizard.service.ts:78` - uses `@injectable()` decorator
- **DI token pattern**: Verified at `di/tokens.ts:10-163` - Symbol.for() tokens with documentation
- **Registration pattern**: Verified at `di/register.ts:37-135` - `Lifecycle.Singleton` registration
- **Types exist**: Verified `WizardSession`, `WizardStep`, `WizardState` at `wizard.types.ts`
- **Analysis types exist**: Verified `DeepProjectAnalysis`, `ArchitecturePattern`, etc. at `analysis.types.ts`

### Risks Identified

| Risk                                               | Severity | Mitigation                                                    |
| -------------------------------------------------- | -------- | ------------------------------------------------------------- |
| Large refactoring may break existing functionality | MEDIUM   | Batch 8 facade refactor verifies public API unchanged         |
| Circular dependency between child services         | LOW      | Child services only depend on external tokens, not each other |
| Type imports may need adjustment                   | LOW      | Each service task includes verification of imports            |

### Edge Cases to Handle

- [x] Null panel handling in webview lifecycle - Verified existing handling at line 2804
- [x] Session validation with Date deserialization - Verified fix at line 1737-1742
- [x] Empty workspace root validation - Verified at line 250-257

---

## Batch 1: Foundation (Directory, Index, Tokens) - COMPLETE

**Commit**: 1ae88ef

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: None
**Risk Level**: LOW

### Task 1.1: Create wizard services directory structure - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\` (CREATE directory)
**Spec Reference**: implementation-plan.md:559-575
**Pattern to Follow**: Existing `services/` flat structure pattern

**Quality Requirements**:

- Directory must be created at correct path
- Will contain 7 files (6 services + index.ts)

**Implementation Details**:

- Create empty directory at `libs/backend/agent-generation/src/lib/services/wizard/`

---

### Task 1.2: Create wizard/index.ts barrel export file - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\index.ts` (CREATE)
**Spec Reference**: implementation-plan.md:563-564
**Pattern to Follow**: Standard barrel export pattern

**Quality Requirements**:

- Export all 6 child services
- Use named exports only
- No re-exporting of types (types come from types/ directory)

**Implementation Details**:

```typescript
// Barrel exports for wizard child services
export { WizardWebviewLifecycleService } from './webview-lifecycle.service';
export { WizardSessionManagerService } from './session-manager.service';
export { WizardStepMachineService } from './step-machine.service';
export { DeepProjectAnalysisService } from './deep-analysis.service';
export { CodeHealthAnalysisService } from './code-health.service';
export { WizardContextMapperService } from './context-mapper.service';
```

---

### Task 1.3: Add 6 new DI tokens to tokens.ts - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\di\tokens.ts` (MODIFY)
**Spec Reference**: implementation-plan.md:587-642
**Pattern to Follow**: `tokens.ts:10-163` - existing token definitions

**Quality Requirements**:

- Each token uses `Symbol.for()` pattern
- Each token has JSDoc comment explaining responsibility
- Tokens added to `AGENT_GENERATION_TOKENS` registry
- Section header comment for organization

**Implementation Details**:

- Add after line 125 (after MIGRATION_SERVICE):
  - `WIZARD_WEBVIEW_LIFECYCLE`
  - `WIZARD_SESSION_MANAGER`
  - `WIZARD_STEP_MACHINE`
  - `DEEP_PROJECT_ANALYSIS`
  - `CODE_HEALTH_ANALYSIS`
  - `WIZARD_CONTEXT_MAPPER`
- Update `AGENT_GENERATION_TOKENS` object (after line 161)

---

**Batch 1 Verification**:

- [ ] Directory exists at `services/wizard/`
- [ ] `wizard/index.ts` exports 6 services
- [ ] 6 new tokens in `tokens.ts`
- [ ] Build passes: `npx nx build agent-generation`

---

## Batch 2: Context Mapper Service - COMPLETE

**Commit**: 25fdbe6

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batch 1 (tokens)
**Risk Level**: LOW (pure transformation logic)

### Task 2.1: Create WizardContextMapperService - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\context-mapper.service.ts` (CREATE)
**Spec Reference**: implementation-plan.md:449-484
**Pattern to Follow**: `setup-wizard.service.ts:1833-1866`
**Estimated Lines**: ~80

**Quality Requirements**:

- Uses `@injectable()` decorator from tsyringe
- Injects `TOKENS.LOGGER` from vscode-core
- Pure transformation logic, no side effects
- Handles null/undefined properties gracefully
- Provides sensible defaults for missing optional fields

**Implementation Details**:

- Imports: `injectable`, `inject` from tsyringe
- Imports: `TOKENS`, `Logger` from `@ptah-extension/vscode-core`
- Imports: `FrontendProjectContext` from `../types/wizard.types`
- Imports: `AgentProjectContext` from `../types/core.types`
- Method: `mapToAgentProjectContext(frontendContext: FrontendProjectContext): AgentProjectContext`
- Extract logic from `setup-wizard.service.ts:1833-1866`

---

### Task 2.2: Register WizardContextMapperService in DI - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\di\register.ts` (MODIFY)
**Spec Reference**: implementation-plan.md:664-668
**Pattern to Follow**: `register.ts:48-52` - singleton registration pattern

**Quality Requirements**:

- Import service from `../services/wizard`
- Register with `Lifecycle.Singleton`
- Add to services list in logger.info call

**Implementation Details**:

- Add import: `import { WizardContextMapperService } from '../services/wizard';`
- Add registration after OUTPUT_VALIDATION_SERVICE (foundation services section)
- Use `AGENT_GENERATION_TOKENS.WIZARD_CONTEXT_MAPPER` token

---

**Batch 2 Verification**:

- [ ] Service file exists and compiles
- [ ] Service registered in DI container
- [ ] Export added to `wizard/index.ts`
- [ ] Build passes: `npx nx build agent-generation`

---

## Batch 3: Step Machine Service - COMPLETE

**Commit**: 4001d72

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batch 1 (tokens)
**Risk Level**: LOW (pure state machine logic)

### Task 3.1: Create WizardStepMachineService - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\step-machine.service.ts` (CREATE)
**Spec Reference**: implementation-plan.md:279-327
**Pattern to Follow**: `setup-wizard.service.ts:349-485`
**Estimated Lines**: ~100

**Quality Requirements**:

- Uses `@injectable()` decorator from tsyringe
- Injects `TOKENS.LOGGER` from vscode-core
- Step order is immutable (readonly array)
- Invalid transitions logged with context
- Unknown steps throw descriptive errors

**Implementation Details**:

- Imports: `injectable`, `inject` from tsyringe
- Imports: `TOKENS`, `Logger` from `@ptah-extension/vscode-core`
- Imports: `WizardStep` from `../../types/wizard.types`
- Private readonly `STEP_ORDER: WizardStep[]`
- Methods:
  - `getNextStep(currentStep: WizardStep): WizardStep`
  - `validateTransition(expectedStep: WizardStep, actualStep: WizardStep): boolean`
  - `extractStepData(step: WizardStep, rawData: Record<string, unknown>): StepDataResult`
- Extract logic from `setup-wizard.service.ts:389-464`

---

### Task 3.2: Register WizardStepMachineService in DI - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\di\register.ts` (MODIFY)
**Spec Reference**: implementation-plan.md:676-680
**Pattern to Follow**: `register.ts:48-52`

**Quality Requirements**:

- Import service from `../services/wizard`
- Register with `Lifecycle.Singleton`
- Add to services list in logger.info call

**Implementation Details**:

- Add to imports from `../services/wizard`
- Add registration in foundation services section
- Use `AGENT_GENERATION_TOKENS.WIZARD_STEP_MACHINE` token

---

**Batch 3 Verification**:

- [x] Service file exists and compiles
- [x] Step order matches original: welcome -> scan -> review -> select -> generate -> complete
- [x] Service registered in DI container
- [x] Build passes: `npx nx build agent-generation`

---

## Batch 4: Session Manager Service - COMPLETE

**Commit**: e5a7bc5

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batch 1 (tokens)
**Risk Level**: MEDIUM (persistence logic)

### Task 4.1: Create WizardSessionManagerService - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\session-manager.service.ts` (CREATE)
**Spec Reference**: implementation-plan.md:218-275
**Pattern to Follow**: `setup-wizard.service.ts:1591-1756`
**Estimated Lines**: ~150

**Quality Requirements**:

- Uses `@injectable()` decorator from tsyringe
- Injects `TOKENS.LOGGER` and `TOKENS.EXTENSION_CONTEXT`
- Session IDs use UUID v4
- Workspace root validation is case-sensitive
- Expired sessions rejected with clear error message
- Handles Date deserialization from JSON (lastActivity may be string)

**Implementation Details**:

- Imports: `injectable`, `inject` from tsyringe
- Imports: `TOKENS`, `Logger` from `@ptah-extension/vscode-core`
- Imports: `v4 as uuidv4` from uuid
- Imports: `WizardSession`, `WizardState`, `WizardStep` from `../../types/wizard.types`
- Private constants: `SESSION_STATE_KEY`, `MAX_SESSION_AGE_MS`
- Methods:
  - `createSession(workspaceRoot: string): WizardSession`
  - `saveSessionState(session: WizardSession): Promise<void>`
  - `loadSavedState(workspaceRoot: string): Promise<WizardState | undefined>`
  - `isSessionValid(state: WizardState): boolean`
- Extract logic from `setup-wizard.service.ts:1591-1756`
- Include Date deserialization fix from lines 1737-1742

---

### Task 4.2: Register WizardSessionManagerService in DI - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\di\register.ts` (MODIFY)
**Spec Reference**: implementation-plan.md:688-693
**Pattern to Follow**: `register.ts:48-52`

**Quality Requirements**:

- Import service from `../services/wizard`
- Register with `Lifecycle.Singleton`
- Add to services list in logger.info call

**Implementation Details**:

- Add to imports from `../services/wizard`
- Add registration in foundation services section
- Use `AGENT_GENERATION_TOKENS.WIZARD_SESSION_MANAGER` token

---

**Batch 4 Verification**:

- [x] Service file exists and compiles
- [x] Session creation generates valid UUID
- [x] Session validation handles Date deserialization
- [x] 24-hour expiry logic works correctly
- [x] Build passes: `npx nx build agent-generation`

---

## Batch 5: Code Health Analysis Service - COMPLETE

**Commit**: cf7c2b1

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batch 1 (tokens)
**Risk Level**: LOW (pure analysis logic)

### Task 5.1: Create CodeHealthAnalysisService - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\code-health.service.ts` (CREATE)
**Spec Reference**: implementation-plan.md:396-446
**Pattern to Follow**: `setup-wizard.service.ts:1252-1555`
**Estimated Lines**: ~300

**Quality Requirements**:

- Uses `@injectable()` decorator from tsyringe
- Injects `TOKENS.LOGGER` from vscode-core
- Skips node_modules in all file searches
- Diagnostic severity mapping matches VS Code enum values
- Test framework detection checks common config files

**Implementation Details**:

- Imports: `injectable`, `inject` from tsyringe
- Imports: `TOKENS`, `Logger` from `@ptah-extension/vscode-core`
- Imports: `DiagnosticSummary`, `CodeConventions`, `TestCoverageEstimate` from `../../types/analysis.types`
- Imports: `type * as vscode` from vscode (dynamic import inside methods)
- Methods:
  - `summarizeDiagnostics(diagnostics: [vscode.Uri, vscode.Diagnostic[]][]): DiagnosticSummary`
  - `detectCodeConventions(workspaceUri: vscode.Uri, vscode: typeof import('vscode')): Promise<CodeConventions>`
  - `estimateTestCoverage(workspaceUri: vscode.Uri, vscode: typeof import('vscode')): Promise<TestCoverageEstimate>`
- Extract logic from `setup-wizard.service.ts:1259-1555`

---

### Task 5.2: Register CodeHealthAnalysisService in DI - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\di\register.ts` (MODIFY)
**Spec Reference**: implementation-plan.md:700-705
**Pattern to Follow**: `register.ts:48-52`

**Quality Requirements**:

- Import service from `../services/wizard`
- Register with `Lifecycle.Singleton`
- Add to services list in logger.info call

**Implementation Details**:

- Add to imports from `../services/wizard`
- Add registration in foundation services section
- Use `AGENT_GENERATION_TOKENS.CODE_HEALTH_ANALYSIS` token

---

**Batch 5 Verification**:

- [x] Service file exists and compiles
- [x] Diagnostic severity enum values correct (Error=0, Warning=1, Information=2, Hint=3)
- [x] node_modules excluded from all file searches
- [x] Service registered in DI container
- [x] Build passes: `npx nx build agent-generation`

---

## Batch 6: Deep Project Analysis Service - COMPLETE

**Commit**: d37cbe1

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batch 1 (tokens), Batch 5 (CodeHealthAnalysisService)
**Risk Level**: MEDIUM (VS Code API interactions)

### Task 6.1: Create DeepProjectAnalysisService - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\deep-analysis.service.ts` (CREATE)
**Spec Reference**: implementation-plan.md:330-393
**Pattern to Follow**: `setup-wizard.service.ts:696-1250`
**Estimated Lines**: ~400

**Quality Requirements**:

- Uses `@injectable()` decorator from tsyringe
- Injects `TOKENS.LOGGER` and `AGENT_GENERATION_TOKENS.AGENT_GENERATION_ORCHESTRATOR`
- Handles missing directories gracefully (skip, don't throw)
- Pattern confidence scores are 0-100 range
- File searches exclude node_modules

**Implementation Details**:

- Imports: `injectable`, `inject` from tsyringe
- Imports: `TOKENS`, `Logger` from `@ptah-extension/vscode-core`
- Imports: `Result` from `@ptah-extension/shared`
- Imports: `AGENT_GENERATION_TOKENS` from `../../di/tokens`
- Imports: `AgentGenerationOrchestratorService` from `../orchestrator.service`
- Imports: `DeepProjectAnalysis`, `ArchitecturePattern`, etc. from `../../types/analysis.types`
- Imports: `ProjectType`, `Framework`, `MonorepoType` from `@ptah-extension/workspace-intelligence`
- Methods:
  - `performDeepAnalysis(workspaceUri: vscode.Uri): Promise<Result<DeepProjectAnalysis, Error>>`
  - `detectArchitecturePatterns(workspaceUri: vscode.Uri, vscode: typeof import('vscode')): Promise<ArchitecturePattern[]>`
  - `extractKeyLocations(workspaceUri: vscode.Uri, configFiles: vscode.Uri[], symbols: vscode.SymbolInformation[], vscode: typeof import('vscode')): Promise<KeyFileLocations>`
  - `calculateLanguageDistribution(workspaceUri: vscode.Uri, vscode: typeof import('vscode')): Promise<LanguageStats[]>`
- Extract logic from `setup-wizard.service.ts:696-1250`
- Inject CodeHealthAnalysisService for diagnostics/conventions/coverage

---

### Task 6.2: Register DeepProjectAnalysisService in DI - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\di\register.ts` (MODIFY)
**Spec Reference**: implementation-plan.md:712-717
**Pattern to Follow**: `register.ts:48-52`

**Quality Requirements**:

- Import service from `../services/wizard`
- Register with `Lifecycle.Singleton`
- Add to services list in logger.info call
- Must be registered AFTER CodeHealthAnalysisService

**Implementation Details**:

- Add to imports from `../services/wizard`
- Add registration in mid-level services section (after CodeHealthAnalysisService)
- Use `AGENT_GENERATION_TOKENS.DEEP_PROJECT_ANALYSIS` token

---

**Batch 6 Verification**:

- [x] Service file exists and compiles
- [x] Architecture patterns detected: DDD, Layered, Microservices, Hexagonal, Clean-Architecture, Component-Based
- [x] Confidence scores within 0-100 range
- [x] Service registered in DI container
- [x] Build passes: `npx nx build agent-generation`

---

## Batch 7: Webview Lifecycle Service - COMPLETE

**Commit**: 5c6bfa1

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batch 1 (tokens)
**Risk Level**: MEDIUM (webview panel management)

### Task 7.1: Create WizardWebviewLifecycleService - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\webview-lifecycle.service.ts` (CREATE)
**Spec Reference**: implementation-plan.md:151-215
**Pattern to Follow**: `setup-wizard.service.ts:141-221, 1757-1820`
**Estimated Lines**: ~120

**Quality Requirements**:

- Uses `@injectable()` decorator from tsyringe
- Injects `TOKENS.LOGGER`, `TOKENS.WEBVIEW_MANAGER`, `TOKENS.WEBVIEW_MESSAGE_HANDLER`, `TOKENS.WEBVIEW_HTML_GENERATOR`
- Handles null panel gracefully
- Logs all webview operations
- Does not throw on message send failures

**Implementation Details**:

- Imports: `injectable`, `inject` from tsyringe
- Imports: `TOKENS`, `Logger`, `WebviewManager`, `WebviewMessageHandlerService`, `IWebviewHtmlGenerator` from `@ptah-extension/vscode-core`
- Imports: `MESSAGE_TYPES` from `@ptah-extension/shared`
- Imports: `type * as vscode` from vscode
- Methods:
  - `createWizardPanel(title: string, viewType: string, customHandlers: ((message: unknown) => Promise<boolean>)[], initialData?: Record<string, unknown>): Promise<vscode.WebviewPanel | null>`
  - `sendResponse(panel: vscode.WebviewPanel, messageId: string, payload?: unknown, error?: string): Promise<void>`
  - `emitProgress(panel: vscode.WebviewPanel | null, eventType: string, data: unknown): Promise<void>`
  - `disposeWebview(viewType: string): void`
- Extract logic from `setup-wizard.service.ts:141-221, 1768-1820, 1563-1589`

---

### Task 7.2: Register WizardWebviewLifecycleService in DI - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\di\register.ts` (MODIFY)
**Spec Reference**: implementation-plan.md:724-729
**Pattern to Follow**: `register.ts:48-52`

**Quality Requirements**:

- Import service from `../services/wizard`
- Register with `Lifecycle.Singleton`
- Add to services list in logger.info call

**Implementation Details**:

- Add to imports from `../services/wizard`
- Add registration in mid-level services section
- Use `AGENT_GENERATION_TOKENS.WIZARD_WEBVIEW_LIFECYCLE` token

---

**Batch 7 Verification**:

- [x] Service file exists and compiles
- [x] Null panel handling verified
- [x] Message send errors caught and logged
- [x] Service registered in DI container
- [x] Build passes: `npx nx build agent-generation`

---

## Batch 8: Refactor SetupWizardService to Facade - COMPLETE

**Commit**: b2c5e59

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batches 2-7 (all child services)
**Risk Level**: HIGH (critical path, public API)

### Task 8.1: Refactor SetupWizardService to use child services - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\setup-wizard.service.ts` (REWRITE)
**Spec Reference**: implementation-plan.md:488-555
**Pattern to Follow**: implementation-plan.md:503-545
**Estimated Lines**: ~350 (down from 2,118)

**Quality Requirements**:

- PUBLIC API METHOD SIGNATURES MUST NOT CHANGE
- PUBLIC API RETURN TYPES MUST NOT CHANGE
- Behavior must be IDENTICAL to current implementation
- Inject all 6 child services via constructor
- Remove duplicated code that was extracted to child services
- Keep RPC message handler registration logic in facade
- Keep session state coordination in facade

**Implementation Details**:

- Update imports to include child services from `./wizard`
- Update constructor to inject 6 child services:
  - `WizardWebviewLifecycleService` via `AGENT_GENERATION_TOKENS.WIZARD_WEBVIEW_LIFECYCLE`
  - `WizardSessionManagerService` via `AGENT_GENERATION_TOKENS.WIZARD_SESSION_MANAGER`
  - `WizardStepMachineService` via `AGENT_GENERATION_TOKENS.WIZARD_STEP_MACHINE`
  - `DeepProjectAnalysisService` via `AGENT_GENERATION_TOKENS.DEEP_PROJECT_ANALYSIS`
  - `CodeHealthAnalysisService` via `AGENT_GENERATION_TOKENS.CODE_HEALTH_ANALYSIS`
  - `WizardContextMapperService` via `AGENT_GENERATION_TOKENS.WIZARD_CONTEXT_MAPPER`
- Delegate to child services:
  - `launchWizard()`: Use sessionManager.createSession(), webviewLifecycle.createWizardPanel()
  - `handleStepTransition()`: Use stepMachine.getNextStep(), stepMachine.extractStepData()
  - `cancelWizard()`: Use sessionManager.saveSessionState(), webviewLifecycle.disposeWebview()
  - `resumeWizard()`: Use sessionManager.loadSavedState(), sessionManager.isSessionValid()
  - `performDeepAnalysis()`: Delegate to deepAnalysis.performDeepAnalysis()
  - `mapToAgentProjectContext()`: Delegate to contextMapper.mapToAgentProjectContext()
- Keep handleStartMessage, handleSelectionMessage, handleCancelMessage in facade (RPC coordination)
- Keep private `currentSession`, `transitionLock`, `isLaunching` fields (state management)

**Critical Verification Points**:

- [ ] `launchWizard(workspaceUri: vscode.Uri): Promise<Result<void, Error>>` - signature unchanged
- [ ] `handleStepTransition(sessionId: string, currentStep: WizardStep, stepData: Record<string, unknown>): Promise<Result<WizardStep, Error>>` - signature unchanged
- [ ] `cancelWizard(sessionId: string, saveProgress: boolean): Promise<Result<void, Error>>` - signature unchanged
- [ ] `resumeWizard(request: ResumeWizardRequest): Promise<Result<WizardSession, Error>>` - signature unchanged
- [ ] `handleAgentSelectionUpdate(update: AgentSelectionUpdate): Promise<Result<void, Error>>` - signature unchanged
- [ ] `performDeepAnalysis(workspaceUri: vscode.Uri): Promise<Result<DeepProjectAnalysis, Error>>` - signature unchanged
- [ ] `getCurrentSession(): WizardSession | null` - signature unchanged

---

### Task 8.2: Update SetupWizardService registration to ensure child services resolve - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\di\register.ts` (MODIFY)
**Spec Reference**: implementation-plan.md:115-119
**Pattern to Follow**: `register.ts:115-120`

**Quality Requirements**:

- SetupWizardService registration must be AFTER all child service registrations
- Child services must be registered in correct dependency order
- Update services list in logger.info to include all 6 new services

**Implementation Details**:

- Ensure registration order:
  1. WizardContextMapperService (no deps)
  2. WizardStepMachineService (no deps)
  3. WizardSessionManagerService (no deps)
  4. CodeHealthAnalysisService (no deps)
  5. DeepProjectAnalysisService (depends on CodeHealthAnalysisService, orchestrator)
  6. WizardWebviewLifecycleService (depends on vscode-core services)
  7. SetupWizardService (depends on all 6 above)
- Update logger.info services list

---

**Batch 8 Verification**:

- [x] All 7 public API methods have identical signatures
- [x] All return types unchanged
- [x] SetupWizardService compiles without errors
- [x] Build passes: `npx nx build agent-generation`
- [x] Lint passes: `npx nx lint agent-generation`

---

## Batch 9: Final Integration, Exports & Documentation - COMPLETE

**Commit**: 3d2c040

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batch 8 (facade refactor)
**Risk Level**: LOW (documentation and verification)

### Task 9.1: Update library exports in src/index.ts - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\index.ts` (MODIFY)
**Spec Reference**: implementation-plan.md:749-752
**Pattern to Follow**: Current exports at `index.ts:34-45`

**Quality Requirements**:

- Export all 6 child services
- Use named exports
- Add after existing service exports

**Implementation Details**:

- Add exports for child services from `./lib/services/wizard`:
  - `WizardWebviewLifecycleService`
  - `WizardSessionManagerService`
  - `WizardStepMachineService`
  - `DeepProjectAnalysisService`
  - `CodeHealthAnalysisService`
  - `WizardContextMapperService`

---

### Task 9.2: Update CLAUDE.md with new file structure - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\CLAUDE.md` (MODIFY)
**Spec Reference**: implementation-plan.md:749
**Pattern to Follow**: Existing CLAUDE.md structure

**Quality Requirements**:

- Document new `services/wizard/` directory
- List all 6 new services with brief descriptions
- Update any outdated references

**Implementation Details**:

- Add section for "Wizard Child Services"
- Document each service's responsibility
- Update file structure diagram if present

---

### Task 9.3: Run full verification suite - COMPLETE

**File**: N/A (verification task)
**Spec Reference**: implementation-plan.md:751-754

**Quality Requirements**:

- Build passes: `npx nx build agent-generation`
- Lint passes: `npx nx lint agent-generation`
- TypeScript types pass: `npx tsc --noEmit -p libs/backend/agent-generation/tsconfig.lib.json`
- No circular dependencies

**Implementation Details**:

- Run: `npx nx build agent-generation`
- Run: `npx nx lint agent-generation`
- Run: `npx tsc --noEmit -p libs/backend/agent-generation/tsconfig.lib.json`
- Verify no new warnings or errors

---

**Batch 9 Verification**:

- [x] All 6 child services exported from library
- [x] CLAUDE.md updated with new structure
- [x] Build, lint, and typecheck all pass
- [x] No circular dependencies detected

---

## Status Icons Reference

| Status      | Meaning                         | Who Sets              |
| ----------- | ------------------------------- | --------------------- |
| PENDING     | Not started                     | team-leader (initial) |
| IN PROGRESS | Assigned to developer           | team-leader           |
| IMPLEMENTED | Developer done, awaiting verify | developer             |
| COMPLETE    | Verified and committed          | team-leader           |
| FAILED      | Verification failed             | team-leader           |

---

## Files Summary

### CREATE (7 files)

- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\index.ts`
- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\webview-lifecycle.service.ts`
- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\session-manager.service.ts`
- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\step-machine.service.ts`
- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\deep-analysis.service.ts`
- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\code-health.service.ts`
- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\context-mapper.service.ts`

### MODIFY (4 files)

- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\di\tokens.ts`
- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\di\register.ts`
- `D:\projects\ptah-extension\libs\backend\agent-generation\src\index.ts`
- `D:\projects\ptah-extension\libs\backend\agent-generation\CLAUDE.md`

### REWRITE (1 file)

- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\setup-wizard.service.ts`

---

## Definition of Done

- [x] All 6 child services created and exported
- [x] All 6 tokens added to tokens.ts with documentation
- [x] All 6 services registered in register.ts
- [x] SetupWizardService refactored to facade pattern
- [x] Public API unchanged (method signatures identical)
- [x] Build passes: `npx nx build agent-generation`
- [x] Lint passes: `npx nx lint agent-generation`
- [x] CLAUDE.md updated with new file structure
