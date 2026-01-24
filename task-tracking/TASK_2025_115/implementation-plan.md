# Implementation Plan - TASK_2025_115

## Setup Wizard Service Decomposition (Backend)

**Objective**: Refactor the `SetupWizardService` (2,118 lines) by extracting responsibilities into focused child services while **maintaining the existing public API**.

---

## Build Issues Analysis

### Build Status: PASS

**Investigation Results**:

```bash
# Build command executed
npx nx build agent-generation
# Result: SUCCESS - no compilation errors

# Lint command executed
npx nx run agent-generation:lint
# Result: SUCCESS - no linting errors

# TypeScript type check
npx tsc --noEmit -p libs/backend/agent-generation/tsconfig.lib.json
# Result: SUCCESS - no type errors
```

**Conclusion**: The agent-generation library builds successfully without errors. The user's context mentioned "build errors" but current investigation shows the codebase compiles cleanly. This task will focus on the architectural refactoring of the "god service."

---

## Codebase Investigation Summary

### God Service Identified

**File**: `libs/backend/agent-generation/src/lib/services/setup-wizard.service.ts`
**Line Count**: 2,118 lines
**Violation**: Massively violates Single Responsibility Principle

### Current Responsibilities Analysis

After detailed analysis, the SetupWizardService handles **7 distinct responsibilities**:

| Responsibility               | Lines | Description                                                    |
| ---------------------------- | ----- | -------------------------------------------------------------- |
| **1. Webview Lifecycle**     | ~150  | Panel creation, message handler setup, HTML generation         |
| **2. Session Management**    | ~200  | Session CRUD, persistence, validation, expiry                  |
| **3. Step Transitions**      | ~100  | Wizard step state machine logic                                |
| **4. RPC Message Handling**  | ~200  | Handle start, selection, cancel messages                       |
| **5. Deep Project Analysis** | ~500  | Architecture detection, key file discovery, language stats     |
| **6. Code Health Analysis**  | ~200  | Diagnostics summarization, convention detection, test coverage |
| **7. Context Mapping**       | ~100  | Frontend/backend context transformation                        |

### Pattern Evidence Sources

**DI Registration Pattern**:

- Source: `libs/backend/agent-generation/src/lib/di/register.ts:37-135`
- Pattern: `registerAgentGenerationServices(container, logger)`
- Token style: Symbol-based tokens in `AGENT_GENERATION_TOKENS`

**Injectable Service Pattern**:

- Source: `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:158`
- Pattern: `@injectable()` decorator with `@inject()` dependencies

**Similar Decomposition**:

- Reference: `task-tracking/TASK_2025_106/implementation-plan.md` (Session History Reader refactoring)
- Pattern: Child services with facade pattern

---

## Architecture Design (Codebase-Aligned)

### Design Philosophy

**Chosen Approach**: Child Services with Facade Pattern
**Rationale**:

- Maintains public API (`launchWizard()`, `handleStepTransition()`, `cancelWizard()`, etc.)
- Each child service has single responsibility
- Follows existing agent-generation service patterns
- Injectable services enable testing and composition

**Evidence**:

- Pattern matches existing services in agent-generation library
- DI registration follows established `register.ts` patterns (verified at `register.ts:37-135`)

### Architecture Diagram

```
+------------------------------------------------------------------------------+
|                    SetupWizardService (Facade)                                |
|                                                                               |
|  Public API (UNCHANGED):                                                      |
|  - launchWizard(workspaceUri)                                                 |
|  - handleStepTransition(sessionId, currentStep, stepData)                     |
|  - cancelWizard(sessionId, saveProgress)                                      |
|  - resumeWizard(request)                                                      |
|  - handleAgentSelectionUpdate(update)                                         |
|  - performDeepAnalysis(workspaceUri)                                          |
|  - getCurrentSession()                                                        |
|                                                                               |
|  Internal Orchestration:                                                      |
|  - Delegates to child services                                                |
|  - Maintains session state                                                    |
+---------------+--------+--------+--------+--------+--------+-----------------+
                |        |        |        |        |        |
                v        v        v        v        v        v
+---------------+  +-----+----+  +----+----+  +-----+---+  +-+------+  +-------+
| WizardWebview |  | Session  |  | Step    |  | Deep    |  | Code   |  |Context|
| LifecycleServ.|  | Manager  |  | Machine |  | Analysis|  | Health |  |Mapper |
+---------------+  +----------+  +---------+  +---------+  +--------+  +-------+
| createPanel   |  |create    |  |transition|  |detect   |  |diagnos-|  |mapTo  |
| setupHandlers |  |load      |  |validate  |  |Patterns |  |tics    |  |Backend|
| sendResponse  |  |save      |  |getNext   |  |extract  |  |convent.|  |Context|
| emitProgress  |  |validate  |  |           |  |KeyLocs  |  |testCov |  |       |
| cleanup       |  |isValid   |  |           |  |langDist |  |        |  |       |
+---------------+  +----------+  +---------+  +---------+  +--------+  +-------+
```

### Dependency Flow

```
SetupWizardService (Facade)
+-- WizardWebviewLifecycleService (injected)
|   +-- Logger (TOKENS.LOGGER)
|   +-- WebviewManager (TOKENS.WEBVIEW_MANAGER)
|   +-- WebviewMessageHandlerService (TOKENS.WEBVIEW_MESSAGE_HANDLER)
|   +-- IWebviewHtmlGenerator (TOKENS.WEBVIEW_HTML_GENERATOR)
|
+-- WizardSessionManagerService (injected)
|   +-- Logger (TOKENS.LOGGER)
|   +-- ExtensionContext (TOKENS.EXTENSION_CONTEXT)
|
+-- WizardStepMachineService (injected)
|   +-- Logger (TOKENS.LOGGER)
|
+-- DeepProjectAnalysisService (injected)
|   +-- Logger (TOKENS.LOGGER)
|   +-- AgentGenerationOrchestratorService (AGENT_GENERATION_TOKENS.AGENT_GENERATION_ORCHESTRATOR)
|
+-- CodeHealthAnalysisService (injected)
|   +-- Logger (TOKENS.LOGGER)
|
+-- WizardContextMapperService (injected)
    +-- Logger (TOKENS.LOGGER)
```

---

## Component Specifications

### Component 1: WizardWebviewLifecycleService

**Purpose**: Manage webview panel creation, message handling, and cleanup.

**Pattern**: Injectable service with WebviewManager dependency
**Evidence**: Current methods at lines 141-221, 1757-1820

**Responsibilities**:

- Create webview panel with message handlers
- Send RPC responses to webview
- Emit progress events to webview
- Dispose webview on cleanup

**Implementation Pattern**:

```typescript
// Pattern source: setup-wizard.service.ts:141-221
@injectable()
export class WizardWebviewLifecycleService {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger, @inject(TOKENS.WEBVIEW_MANAGER) private readonly webviewManager: WebviewManager, @inject(TOKENS.WEBVIEW_MESSAGE_HANDLER) private readonly messageHandler: WebviewMessageHandlerService, @inject(TOKENS.WEBVIEW_HTML_GENERATOR) private readonly htmlGenerator: IWebviewHtmlGenerator) {}

  async createWizardPanel(title: string, viewType: string, customHandlers: ((message: unknown) => Promise<boolean>)[], initialData?: Record<string, unknown>): Promise<vscode.WebviewPanel | null> {
    // Panel creation logic (lines 141-221)
  }

  async sendResponse(panel: vscode.WebviewPanel, messageId: string, payload?: unknown, error?: string): Promise<void> {
    // Response sending logic (lines 1768-1788)
  }

  async emitProgress(panel: vscode.WebviewPanel | null, eventType: string, data: unknown): Promise<void> {
    // Progress emission logic (lines 1799-1820)
  }

  disposeWebview(viewType: string): void {
    // Cleanup logic (extracted from cleanup() lines 1563-1589)
  }
}
```

**Quality Requirements**:

- Must handle null panel gracefully
- Must log all webview operations
- Must not throw on message send failures

**Files Affected**:

- `libs/backend/agent-generation/src/lib/services/wizard/webview-lifecycle.service.ts` (CREATE)

---

### Component 2: WizardSessionManagerService

**Purpose**: Handle wizard session CRUD, persistence, and validation.

**Pattern**: Injectable service with ExtensionContext for persistence
**Evidence**: Current methods at lines 1591-1756

**Responsibilities**:

- Create new wizard sessions
- Save session state to workspace storage
- Load saved session state
- Validate session expiry (24-hour limit)
- Clear expired sessions

**Implementation Pattern**:

```typescript
// Pattern source: setup-wizard.service.ts:1591-1756
@injectable()
export class WizardSessionManagerService {
  private readonly SESSION_STATE_KEY = 'wizard-session-state';
  private readonly MAX_SESSION_AGE_MS = 24 * 60 * 60 * 1000;

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger, @inject(TOKENS.EXTENSION_CONTEXT) private readonly context: vscode.ExtensionContext) {}

  createSession(workspaceRoot: string): WizardSession {
    return {
      id: uuidv4(),
      workspaceRoot,
      currentStep: 'welcome',
      startedAt: new Date(),
    };
  }

  async saveSessionState(session: WizardSession): Promise<void> {
    // Save logic (lines 1632-1649)
  }

  async loadSavedState(workspaceRoot: string): Promise<WizardState | undefined> {
    // Load logic (lines 1680-1703)
  }

  isSessionValid(state: WizardState): boolean {
    // Validation logic (lines 1736-1756)
  }
}
```

**Quality Requirements**:

- Session IDs must be unique (UUID v4)
- Workspace root validation must be case-sensitive
- Expired sessions must be rejected with clear error message

**Files Affected**:

- `libs/backend/agent-generation/src/lib/services/wizard/session-manager.service.ts` (CREATE)

---

### Component 3: WizardStepMachineService

**Purpose**: Manage wizard step state machine and transitions.

**Pattern**: Injectable service (pure logic, no external dependencies)
**Evidence**: Current method at lines 349-485

**Responsibilities**:

- Define step order (welcome -> scan -> review -> select -> generate -> complete)
- Validate step transitions
- Determine next step based on current step
- Extract step-specific data during transitions

**Implementation Pattern**:

```typescript
// Pattern source: setup-wizard.service.ts:349-485
@injectable()
export class WizardStepMachineService {
  private readonly STEP_ORDER: WizardStep[] = ['welcome', 'scan', 'review', 'select', 'generate', 'complete'];

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  getNextStep(currentStep: WizardStep): WizardStep {
    // Step progression logic (lines 389-464)
  }

  validateTransition(expectedStep: WizardStep, actualStep: WizardStep): boolean {
    return expectedStep === actualStep;
  }

  extractStepData(step: WizardStep, rawData: Record<string, unknown>): { projectContext?: SimplifiedProjectContext; selectedAgentIds?: string[]; generationSummary?: SimplifiedGenerationSummary } {
    // Data extraction logic (lines 400-452)
  }
}
```

**Quality Requirements**:

- Step order must be immutable
- Invalid transitions must be logged with context
- Unknown steps must throw descriptive errors

**Files Affected**:

- `libs/backend/agent-generation/src/lib/services/wizard/step-machine.service.ts` (CREATE)

---

### Component 4: DeepProjectAnalysisService

**Purpose**: Perform comprehensive project analysis using VS Code APIs.

**Pattern**: Injectable service with orchestrator dependency
**Evidence**: Current method at lines 696-1026

**Responsibilities**:

- Detect architecture patterns (DDD, Layered, Microservices, Hexagonal, etc.)
- Extract key file locations (entry points, configs, tests, APIs, components)
- Calculate language distribution
- Coordinate with orchestrator for basic analysis

**Implementation Pattern**:

```typescript
// Pattern source: setup-wizard.service.ts:696-1026
@injectable()
export class DeepProjectAnalysisService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(AGENT_GENERATION_TOKENS.AGENT_GENERATION_ORCHESTRATOR)
    private readonly orchestrator: AgentGenerationOrchestratorService
  ) {}

  async performDeepAnalysis(workspaceUri: vscode.Uri): Promise<Result<DeepProjectAnalysis, Error>> {
    // Deep analysis orchestration (lines 696-815)
  }

  async detectArchitecturePatterns(workspaceUri: vscode.Uri, vscode: typeof import('vscode')): Promise<ArchitecturePattern[]> {
    // Pattern detection logic (lines 834-1026)
  }

  async extractKeyLocations(workspaceUri: vscode.Uri, configFiles: vscode.Uri[], symbols: vscode.SymbolInformation[], vscode: typeof import('vscode')): Promise<KeyFileLocations> {
    // Key location extraction (lines 1038-1142)
  }

  async calculateLanguageDistribution(workspaceUri: vscode.Uri, vscode: typeof import('vscode')): Promise<LanguageStats[]> {
    // Language distribution calculation (lines 1152-1250)
  }
}
```

**Quality Requirements**:

- Must handle missing directories gracefully (skip, don't throw)
- Pattern confidence scores must be 0-100 range
- File searches must exclude node_modules

**Files Affected**:

- `libs/backend/agent-generation/src/lib/services/wizard/deep-analysis.service.ts` (CREATE)

---

### Component 5: CodeHealthAnalysisService

**Purpose**: Analyze code health including diagnostics, conventions, and test coverage.

**Pattern**: Injectable service (pure logic, VS Code API interactions)
**Evidence**: Current methods at lines 1252-1555

**Responsibilities**:

- Summarize VS Code diagnostics (errors, warnings, info counts)
- Detect code conventions from config files (Prettier, ESLint, etc.)
- Estimate test coverage from file patterns

**Implementation Pattern**:

```typescript
// Pattern source: setup-wizard.service.ts:1252-1555
@injectable()
export class CodeHealthAnalysisService {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  summarizeDiagnostics(diagnostics: [vscode.Uri, vscode.Diagnostic[]][]): DiagnosticSummary {
    // Diagnostic summarization (lines 1259-1326)
  }

  async detectCodeConventions(workspaceUri: vscode.Uri, vscode: typeof import('vscode')): Promise<CodeConventions> {
    // Convention detection (lines 1336-1426)
  }

  async estimateTestCoverage(workspaceUri: vscode.Uri, vscode: typeof import('vscode')): Promise<TestCoverageEstimate> {
    // Test coverage estimation (lines 1436-1555)
  }
}
```

**Quality Requirements**:

- Must skip node_modules in all file searches
- Diagnostic severity mapping must match VS Code enum values
- Test framework detection must check common config files

**Files Affected**:

- `libs/backend/agent-generation/src/lib/services/wizard/code-health.service.ts` (CREATE)

---

### Component 6: WizardContextMapperService

**Purpose**: Transform between frontend and backend context representations.

**Pattern**: Injectable service (pure transformation logic)
**Evidence**: Current method at lines 1833-1866

**Responsibilities**:

- Map frontend ProjectContext to backend AgentProjectContext
- Handle enum string-to-enum conversions
- Provide default values for optional fields

**Implementation Pattern**:

```typescript
// Pattern source: setup-wizard.service.ts:1833-1866
@injectable()
export class WizardContextMapperService {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  mapToAgentProjectContext(frontendContext: FrontendProjectContext): AgentProjectContext {
    // Context mapping logic (lines 1833-1866)
  }
}
```

**Quality Requirements**:

- Must handle null/undefined properties gracefully
- Must provide sensible defaults for missing optional fields
- Type assertions must be documented for frontend/backend type mismatches

**Files Affected**:

- `libs/backend/agent-generation/src/lib/services/wizard/context-mapper.service.ts` (CREATE)

---

### Component 7: Refactored SetupWizardService (Facade)

**Purpose**: Maintain public API while delegating to child services.

**Pattern**: Facade with injected child services
**Evidence**: Current public methods (lines 236-330, 349-615, 625-668)

**Responsibilities**:

- Public API: `launchWizard()`, `handleStepTransition()`, `cancelWizard()`, `resumeWizard()`, `handleAgentSelectionUpdate()`, `performDeepAnalysis()`, `getCurrentSession()`
- Orchestration of child services
- RPC message handler registration
- Session state coordination

**Implementation Pattern**:

```typescript
// Pattern source: Current file with child service injection
@injectable()
export class SetupWizardService implements ISetupWizardService {
  private currentSession: WizardSession | null = null;
  private transitionLock = false;
  private isLaunching = false;
  private readonly WIZARD_VIEW_TYPE = 'ptah.setupWizard';

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(AGENT_GENERATION_TOKENS.WIZARD_WEBVIEW_LIFECYCLE)
    private readonly webviewLifecycle: WizardWebviewLifecycleService,
    @inject(AGENT_GENERATION_TOKENS.WIZARD_SESSION_MANAGER)
    private readonly sessionManager: WizardSessionManagerService,
    @inject(AGENT_GENERATION_TOKENS.WIZARD_STEP_MACHINE)
    private readonly stepMachine: WizardStepMachineService,
    @inject(AGENT_GENERATION_TOKENS.DEEP_PROJECT_ANALYSIS)
    private readonly deepAnalysis: DeepProjectAnalysisService,
    @inject(AGENT_GENERATION_TOKENS.CODE_HEALTH_ANALYSIS)
    private readonly codeHealth: CodeHealthAnalysisService,
    @inject(AGENT_GENERATION_TOKENS.WIZARD_CONTEXT_MAPPER)
    private readonly contextMapper: WizardContextMapperService,
    @inject(AGENT_GENERATION_TOKENS.AGENT_GENERATION_ORCHESTRATOR)
    private readonly orchestrator: AgentGenerationOrchestratorService,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManager
  ) {}

  // PUBLIC API - UNCHANGED SIGNATURES
  async launchWizard(workspaceUri: vscode.Uri): Promise<Result<void, Error>> {
    // Delegate to child services
  }

  async handleStepTransition(sessionId: string, currentStep: WizardStep, stepData: Record<string, unknown>): Promise<Result<WizardStep, Error>> {
    // Use stepMachine for transition logic
  }

  // ... other public methods
}
```

**Quality Requirements**:

- Public method signatures must NOT change
- Return types must NOT change
- Behavior must be identical to current implementation

**Files Affected**:

- `libs/backend/agent-generation/src/lib/services/setup-wizard.service.ts` (REWRITE)

---

## File Structure

```
libs/backend/agent-generation/src/lib/
+-- services/
|   +-- wizard/                                    (CREATE directory)
|   |   +-- index.ts                               (CREATE - ~20 lines)
|   |   +-- webview-lifecycle.service.ts           (CREATE - ~120 lines)
|   |   +-- session-manager.service.ts             (CREATE - ~150 lines)
|   |   +-- step-machine.service.ts                (CREATE - ~100 lines)
|   |   +-- deep-analysis.service.ts               (CREATE - ~400 lines)
|   |   +-- code-health.service.ts                 (CREATE - ~300 lines)
|   |   +-- context-mapper.service.ts              (CREATE - ~80 lines)
|   +-- setup-wizard.service.ts                    (REWRITE - ~350 lines facade)
+-- di/
|   +-- tokens.ts                                  (MODIFY - add 6 new tokens)
|   +-- register.ts                                (MODIFY - register 6 services)
```

**Line Count Summary**:

- New child services: ~1,170 lines total
- Refactored facade: ~350 lines
- Total after refactoring: ~1,520 lines (vs 2,118 before)
- Net reduction: ~600 lines (better separation, eliminates internal method overhead)

---

## DI Token Additions

```typescript
// Add to libs/backend/agent-generation/src/lib/di/tokens.ts

// ========================================
// Wizard Child Services (TASK_2025_115)
// ========================================

/**
 * WizardWebviewLifecycleService - Webview panel management
 * Responsibilities: Create panels, send responses, emit progress, cleanup
 */
export const WIZARD_WEBVIEW_LIFECYCLE = Symbol.for('WizardWebviewLifecycleService');

/**
 * WizardSessionManagerService - Session CRUD and persistence
 * Responsibilities: Create, save, load, validate sessions
 */
export const WIZARD_SESSION_MANAGER = Symbol.for('WizardSessionManagerService');

/**
 * WizardStepMachineService - Step state machine
 * Responsibilities: Validate transitions, determine next step
 */
export const WIZARD_STEP_MACHINE = Symbol.for('WizardStepMachineService');

/**
 * DeepProjectAnalysisService - Comprehensive project analysis
 * Responsibilities: Architecture detection, key file discovery, language stats
 */
export const DEEP_PROJECT_ANALYSIS = Symbol.for('DeepProjectAnalysisService');

/**
 * CodeHealthAnalysisService - Code health metrics
 * Responsibilities: Diagnostics, conventions, test coverage
 */
export const CODE_HEALTH_ANALYSIS = Symbol.for('CodeHealthAnalysisService');

/**
 * WizardContextMapperService - Context transformation
 * Responsibilities: Frontend to backend context mapping
 */
export const WIZARD_CONTEXT_MAPPER = Symbol.for('WizardContextMapperService');

// Update AGENT_GENERATION_TOKENS registry
export const AGENT_GENERATION_TOKENS = {
  // ... existing tokens

  // Wizard Child Services (TASK_2025_115)
  WIZARD_WEBVIEW_LIFECYCLE,
  WIZARD_SESSION_MANAGER,
  WIZARD_STEP_MACHINE,
  DEEP_PROJECT_ANALYSIS,
  CODE_HEALTH_ANALYSIS,
  WIZARD_CONTEXT_MAPPER,
} as const;
```

---

## Implementation Batches

### Batch 1: Foundation (Types & Index)

**Tasks**:

1. Create `services/wizard/` directory
2. Create `services/wizard/index.ts` with exports
3. Add 6 new tokens to `di/tokens.ts`

**Risk**: Low (no behavior change, pure additions)
**Verification**: TypeScript compilation

---

### Batch 2: Context Mapper Service

**Tasks**:

1. Create `wizard/context-mapper.service.ts`
2. Add `WIZARD_CONTEXT_MAPPER` registration to `di/register.ts`
3. Export from `wizard/index.ts`

**Risk**: Low (pure transformation logic, easy to test)
**Verification**: Unit tests for context mapping

---

### Batch 3: Step Machine Service

**Tasks**:

1. Create `wizard/step-machine.service.ts`
2. Add `WIZARD_STEP_MACHINE` registration to `di/register.ts`
3. Export from `wizard/index.ts`

**Risk**: Low (pure state machine logic, well-defined transitions)
**Verification**: Unit tests for step transitions

---

### Batch 4: Session Manager Service

**Tasks**:

1. Create `wizard/session-manager.service.ts`
2. Add `WIZARD_SESSION_MANAGER` registration to `di/register.ts`
3. Export from `wizard/index.ts`

**Risk**: Medium (persistence logic, workspace state interaction)
**Verification**: Unit tests + manual verification of session persistence

---

### Batch 5: Code Health Analysis Service

**Tasks**:

1. Create `wizard/code-health.service.ts`
2. Add `CODE_HEALTH_ANALYSIS` registration to `di/register.ts`
3. Export from `wizard/index.ts`

**Risk**: Low (pure analysis logic, no side effects)
**Verification**: Unit tests for diagnostic/convention/coverage analysis

---

### Batch 6: Deep Project Analysis Service

**Tasks**:

1. Create `wizard/deep-analysis.service.ts`
2. Add `DEEP_PROJECT_ANALYSIS` registration to `di/register.ts`
3. Export from `wizard/index.ts`

**Risk**: Medium (VS Code API interactions, complex file searches)
**Verification**: Integration test with real workspace

---

### Batch 7: Webview Lifecycle Service

**Tasks**:

1. Create `wizard/webview-lifecycle.service.ts`
2. Add `WIZARD_WEBVIEW_LIFECYCLE` registration to `di/register.ts`
3. Export from `wizard/index.ts`

**Risk**: Medium (webview panel management, message handling)
**Verification**: Manual test of wizard launch/close

---

### Batch 8: Refactor Main Service

**Tasks**:

1. Update `setup-wizard.service.ts` to use child services
2. Inject child services via constructor
3. Remove duplicated code
4. Verify public API unchanged

**Risk**: High (critical path, public API)
**Verification**: End-to-end test of wizard flow

---

### Batch 9: Final Integration & Documentation

**Tasks**:

1. Update `CLAUDE.md` with new file structure
2. Verify all exports in `src/index.ts`
3. Run full test suite
4. Manual QA test in VS Code extension

**Risk**: Low (documentation and verification)
**Verification**: Full extension test

---

## Risk Assessment

### Low Risk

- **Token additions** - Additive change, no existing code affected
- **Context mapper extraction** - Pure functions, no side effects
- **Step machine extraction** - Pure state machine, well-defined logic

### Medium Risk

- **Session manager extraction** - Persistence logic needs careful handling
- **Deep analysis extraction** - VS Code API interactions, complex async flows
- **Webview lifecycle extraction** - Panel management, message routing

### High Risk

- **Facade refactoring** - Must preserve exact public API behavior

### Mitigations

1. **Incremental batches** - Each batch independently verifiable
2. **Type safety** - TypeScript ensures interface compatibility
3. **Existing tests** - Run after each batch
4. **Manual QA** - Test wizard flow between batches

---

## Quality Requirements

### Functional Requirements

- All public API methods (`launchWizard()`, `handleStepTransition()`, etc.) must behave identically
- Session persistence must work across VS Code restarts
- Deep analysis must detect all current architecture patterns
- Wizard step transitions must follow established order

### Non-Functional Requirements

- **Performance**: No degradation in wizard launch time
- **Memory**: No increase in memory usage
- **Maintainability**: Each service <400 lines
- **Testability**: Each service independently testable

### Pattern Compliance

- All services use `@injectable()` decorator (verified pattern)
- All services registered with Symbol tokens (verified pattern)
- All services use `Lifecycle.Singleton` (verified pattern)

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**:

- Pure TypeScript/Node.js refactoring
- DI container configuration (tsyringe)
- VS Code API interactions
- No frontend/Angular involvement

### Complexity Assessment

**Complexity**: HIGH
**Estimated Effort**: 8-12 hours

**Breakdown**:

- Batch 1 (Foundation): 30 min
- Batch 2 (Context Mapper): 45 min
- Batch 3 (Step Machine): 45 min
- Batch 4 (Session Manager): 60 min
- Batch 5 (Code Health): 60 min
- Batch 6 (Deep Analysis): 90 min
- Batch 7 (Webview Lifecycle): 60 min
- Batch 8 (Facade Refactor): 120 min
- Batch 9 (Integration): 60 min

### Files Affected Summary

**CREATE** (8 files):

- `libs/backend/agent-generation/src/lib/services/wizard/index.ts`
- `libs/backend/agent-generation/src/lib/services/wizard/webview-lifecycle.service.ts`
- `libs/backend/agent-generation/src/lib/services/wizard/session-manager.service.ts`
- `libs/backend/agent-generation/src/lib/services/wizard/step-machine.service.ts`
- `libs/backend/agent-generation/src/lib/services/wizard/deep-analysis.service.ts`
- `libs/backend/agent-generation/src/lib/services/wizard/code-health.service.ts`
- `libs/backend/agent-generation/src/lib/services/wizard/context-mapper.service.ts`

**MODIFY** (2 files):

- `libs/backend/agent-generation/src/lib/di/tokens.ts` - Add 6 tokens
- `libs/backend/agent-generation/src/lib/di/register.ts` - Register 6 services

**REWRITE** (1 file):

- `libs/backend/agent-generation/src/lib/services/setup-wizard.service.ts` - Facade pattern

### Critical Verification Points

**Before Implementation, Team-Leader Must Ensure Developer Verifies**:

1. **All imports exist in codebase**:

   - `@injectable()` from `tsyringe` (verified at multiple files)
   - `@inject(TOKENS.LOGGER)` from `@ptah-extension/vscode-core`
   - `AGENT_GENERATION_TOKENS` from `./di/tokens`
   - Types from `@ptah-extension/shared` and `../types/`

2. **All patterns verified from examples**:

   - Service pattern: `services/setup-wizard.service.ts:78-129`
   - Token pattern: `di/tokens.ts:10-163`
   - Registration pattern: `di/register.ts:37-135`

3. **Library documentation consulted**:

   - `libs/backend/agent-generation/CLAUDE.md`
   - `task-tracking/TASK_2025_106/implementation-plan.md` (similar refactoring)

4. **No hallucinated APIs**:
   - All decorators verified: `@injectable()`, `@inject()`
   - All DI patterns verified from existing services
   - All VS Code APIs verified from current implementation

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended
- [x] Complexity assessed
- [x] No step-by-step implementation (team-leader's job)

---

## Testing Strategy

### Unit Tests (Each Child Service)

**Test Template** (apply to all 6 child services):

```typescript
describe('WizardContextMapperService', () => {
  let service: WizardContextMapperService;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    mockLogger = createMockLogger();
    service = new WizardContextMapperService(mockLogger);
  });

  it('should map frontend context to backend context', () => {
    const frontendContext: FrontendProjectContext = {
      rootPath: '/workspace',
      projectType: 'NodeJS',
      frameworks: ['NestJS'],
    };

    const result = service.mapToAgentProjectContext(frontendContext);

    expect(result.rootPath).toBe('/workspace');
    expect(result.projectType).toBe('NodeJS');
  });

  it('should provide defaults for missing optional fields', () => {
    const frontendContext: FrontendProjectContext = {
      rootPath: '/workspace',
      projectType: 'NodeJS',
    };

    const result = service.mapToAgentProjectContext(frontendContext);

    expect(result.techStack.packageManager).toBe('npm');
    expect(result.codeConventions.indentSize).toBe(2);
  });
});
```

### Integration Tests (Facade)

```typescript
describe('SetupWizardService (Facade)', () => {
  let service: SetupWizardService;
  let mockWebviewLifecycle: jest.Mocked<WizardWebviewLifecycleService>;
  let mockSessionManager: jest.Mocked<WizardSessionManagerService>;
  // ... other mocks

  beforeEach(() => {
    // Setup mocks
    service = new SetupWizardService(/* inject mocks */);
  });

  it('should launch wizard successfully', async () => {
    mockSessionManager.createSession.mockReturnValue(mockSession);
    mockWebviewLifecycle.createWizardPanel.mockResolvedValue(mockPanel);

    const result = await service.launchWizard(workspaceUri);

    expect(result.isOk()).toBe(true);
    expect(mockSessionManager.createSession).toHaveBeenCalled();
  });

  it('should handle step transitions correctly', async () => {
    mockStepMachine.getNextStep.mockReturnValue('scan');

    const result = await service.handleStepTransition(sessionId, 'welcome', {});

    expect(result.isOk()).toBe(true);
    expect(result.value).toBe('scan');
  });
});
```

---

## Success Metrics

### Quantitative Metrics

1. **Code Reduction**:

   - setup-wizard.service.ts: 2,118 lines -> ~350 lines (-83%)
   - Total code: 2,118 lines -> ~1,520 lines (services + facade)

2. **Service Count**:

   - Before: 1 god service
   - After: 6 focused services + 1 facade

3. **Test Coverage**:
   - 6 new unit test suites (one per child service)
   - Integration tests for facade

### Qualitative Metrics

1. **Maintainability**:

   - Each service has single responsibility
   - Clear separation of concerns
   - Easy to locate specific functionality

2. **Testability**:

   - Child services independently testable
   - Mock injection simplified
   - Isolated unit tests possible

3. **Developer Experience**:
   - Clear file structure in `wizard/` directory
   - Consistent naming pattern (`*-service.ts`)
   - Token documentation in tokens.ts

---

## Definition of Done

- [ ] All 6 child services created and exported
- [ ] All 6 tokens added to tokens.ts with documentation
- [ ] All 6 services registered in register.ts
- [ ] SetupWizardService refactored to facade pattern
- [ ] Public API unchanged (method signatures identical)
- [ ] Build passes: `nx build agent-generation`
- [ ] Lint passes: `nx lint agent-generation`
- [ ] Unit tests pass for each child service
- [ ] Integration tests pass for facade
- [ ] Manual QA: Wizard launches and completes successfully
- [ ] CLAUDE.md updated with new file structure
