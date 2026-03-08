# Development Tasks - TASK_2025_064_1

**Project**: Agent Generation System - Backend Review Fixes
**Parent Task**: TASK_2025_064 (Backend Track - Complete)
**Blocking**: TASK_2025_065 (Frontend Track)
**Total Batches**: 4 | **Status**: 4/4 complete
**Current**: All Development Complete - Ready for Final Summary
**Execution Strategy**: Sequential (A → B → C)

---

## Task Overview

This task fixes all findings from code-style-reviewer and code-logic-reviewer before proceeding with frontend development. Organized by severity into 3 batches.

**Review Scores** (from TASK_2025_064):

- Code Style: 6.5/10 (8 blocking, 12 serious)
- Code Logic: 6.5/10 (5 critical, 8 serious)

---

## Batch A: Critical Style Fixes (BLOCKING)

**Type**: REFACTORING
**Developer**: backend-developer
**Tasks**: 8 | **Dependencies**: None
**Estimated Complexity**: Medium (1-2 days)

### Task A.1: Fix DI Pattern Violation in OrchestratorService

**File**: `orchestrator.service.ts:134`
**Issue**: `VsCodeLmService` is directly instantiated instead of injected via DI
**Impact**: Breaks testability, creates hidden dependency

**Fix**:

```typescript
// Add to constructor
@inject(AGENT_GENERATION_TOKENS.VSCODE_LM_SERVICE)
private readonly llmService: VsCodeLmService,
```

**Also Required**:

- Add `VSCODE_LM_SERVICE` to DI tokens
- Register VsCodeLmService in container

### Task A.2: Move SectionCustomizationRequest Interface

**File**: `vscode-lm.service.ts:26-35`
**Issue**: Interface exported from service file instead of `/interfaces`

**Fix**:

- Create `libs/backend/agent-generation/src/lib/interfaces/vscode-lm.interface.ts`
- Move `SectionCustomizationRequest` interface
- Add `IVsCodeLmService` interface
- Update imports in service and tests

### Task A.3: Move CustomizationRequest Interface

**File**: `agent-customization.service.ts:30-42`
**Issue**: Same pattern violation as A.2

**Fix**:

- Create `libs/backend/agent-generation/src/lib/interfaces/agent-customization.interface.ts`
- Move `CustomizationRequest` interface
- Add `IAgentCustomizationService` interface
- Update imports

### Task A.4: Fix Result Type Error Swallowing

**File**: `orchestrator.service.ts:258`
**Issue**: `customizationsResult.value ?? new Map()` swallows errors silently

**Fix**:

```typescript
if (customizationsResult.isErr()) {
  this.logger.warn('LLM customization failed, using generic content', customizationsResult.error!);
  warnings.push(`LLM customization failed: ${customizationsResult.error!.message}`);
}
const customizations = customizationsResult.value ?? new Map();
```

### Task A.5: Fix Hardcoded Type Assertion

**File**: `orchestrator.service.ts:362`
**Issue**: `projectType: 'Node' as any` bypasses type safety

**Fix**:

```typescript
// TODO: Replace with WorkspaceAnalyzerService in Integration Batch
projectType: ProjectType.Node, // Temporary placeholder
```

### Task A.6: Add Typed Step Data for SetupWizardService

**File**: `setup-wizard.service.ts:234, 251, 262`
**Issue**: String-based `stepData['projectContext']` bypasses type safety

**Fix**: Create discriminated union type:

```typescript
type StepData = { step: 'scan'; projectContext: AgentProjectContext } | { step: 'select'; selectedAgentIds: string[] } | { step: 'generate'; generationSummary: GenerationSummary };
```

### Task A.7: Fix Temporal Coupling in VsCodeLmService

**File**: `vscode-lm.service.ts:62, 81-100`
**Issue**: Provider instantiated in constructor but requires `initialize()` call

**Fix**: Check initialization state or defer construction:

```typescript
private provider?: VsCodeLmProvider;

async initialize() {
  if (this.provider) return Result.ok(undefined);
  this.provider = new VsCodeLmProvider({ family: 'gpt-4o' });
  return this.provider.initialize();
}
```

### Task A.8: Remove Dead Code Null Check

**File**: `setup-wizard.service.ts:414-418`
**Issue**: Null check after guaranteed assignment is dead code

**Fix**: Remove the null check or add clarifying comment

**Batch A Commit Format**:

```
fix(vscode): batch A - critical style fixes for agent-generation

- Fix DI pattern violation in OrchestratorService
- Move interfaces to /interfaces directory
- Fix error swallowing in customization result
- Add typed step data for wizard
- Fix temporal coupling in VsCodeLmService
```

---

## Batch B: Critical Logic Fixes

**Type**: BUG FIX
**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batch A
**Estimated Complexity**: Medium (1-2 days)

### Task B.1: Add State Transition Lock to SetupWizardService

**File**: `setup-wizard.service.ts:195-296`
**Issue**: No concurrency lock, rapid clicks cause state corruption

**Fix**: Add mutex/semaphore for step transitions:

```typescript
private transitionLock = false;

async handleStepTransition(...) {
  if (this.transitionLock) {
    return Result.err(new Error('Step transition in progress'));
  }
  this.transitionLock = true;
  try {
    // existing logic
  } finally {
    this.transitionLock = false;
  }
}
```

### Task B.2: Fix Silent Fallback to Empty String

**File**: `vscode-lm.service.ts:171`, `agent-customization.service.ts:258`
**Issue**: Returns `Result.ok('')` masking LLM failures

**Fix**: Return discriminated result:

```typescript
type CustomizationResult = { type: 'success'; content: string } | { type: 'fallback'; reason: string; content: string };

// Or add isFallback flag to result metadata
```

### Task B.3: Distinguish Validation Service Error from Content Error

**File**: `vscode-lm.service.ts:143-173`
**Issue**: Infrastructure failure treated as validation failure

**Fix**:

```typescript
try {
  const validationResult = await this.validation.validate(...);
  if (validationResult.isErr()) {
    // Infrastructure error - don't retry
    this.logger.error('Validation service unavailable', validationResult.error!);
    return Result.err(validationResult.error!);
  }
  // Content validation failure - retry
  if (!validationResult.value!.isValid) {
    // existing retry logic
  }
} catch (error) {
  // Unexpected error - don't retry
  return Result.err(error as Error);
}
```

### Task B.4: Verify Webview Panel Creation

**File**: `setup-wizard.service.ts:147-158`
**Issue**: `createWebviewPanel()` result ignored (fire-and-forget)

**Fix**:

```typescript
const panel = await this.webviewManager.createWebviewPanel({...});
if (!panel) {
  this.currentSession = null;
  return Result.err(new Error('Failed to create wizard webview panel'));
}
```

### Task B.5: Add Phase Timeout to OrchestratorService

**File**: `orchestrator.service.ts:241-557`
**Issue**: Phase 3 has no overall timeout, can run for 10+ minutes

**Fix**: Add phase-level timeout:

```typescript
private readonly PHASE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

async customizeAgents(...) {
  const timeout = setTimeout(() => {
    throw new Error('Phase 3 timeout exceeded');
  }, this.PHASE_TIMEOUT_MS);

  try {
    // existing logic
  } finally {
    clearTimeout(timeout);
  }
}
```

**Batch B Commit Format**:

```
fix(vscode): batch B - critical logic fixes for agent-generation

- Add state transition lock to prevent race conditions
- Fix silent fallback masking LLM failures
- Distinguish validation service vs content errors
- Verify webview panel creation
- Add phase timeout for long operations
```

---

## Batch C: RPC Handler Registration & Integration Prep

**Type**: FEATURE
**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch B
**Estimated Complexity**: Medium (1-2 days)

### Task C.1: Register RPC Message Handlers

**File**: `setup-wizard.service.ts`
**Issue**: Frontend sends `setup-wizard:start` but backend has no handler

**Fix**: Add RPC handler registration in `launchWizard()`:

```typescript
// Register message handlers
panel.webview.onDidReceiveMessage(async (message) => {
  switch (message.type) {
    case 'setup-wizard:start':
      await this.handleStartMessage(message);
      break;
    case 'setup-wizard:submit-selection':
      await this.handleSelectionMessage(message);
      break;
    case 'setup-wizard:cancel':
      await this.handleCancelMessage(message);
      break;
  }
});
```

### Task C.2: Implement RPC Response Protocol

**File**: `setup-wizard.service.ts`
**Issue**: Frontend expects `{ type: 'rpc:response', messageId, payload/error }`

**Fix**: Add response sending:

```typescript
private async sendResponse(panel: vscode.WebviewPanel, messageId: string, payload?: unknown, error?: string) {
  await panel.webview.postMessage({
    type: 'rpc:response',
    messageId,
    payload,
    error
  });
}
```

### Task C.3: Add Progress Event Emission

**File**: `setup-wizard.service.ts`, `orchestrator.service.ts`
**Issue**: Backend has progress callbacks but doesn't emit webview messages

**Fix**: Emit progress events to webview:

```typescript
// During Phase 1
this.emitProgress(panel, 'setup-wizard:scan-progress', {
  filesScanned: count,
  totalFiles: total,
  detections: [],
});

// During Phase 3-5
this.emitProgress(panel, 'setup-wizard:generation-progress', {
  phase: 'customization',
  percent: 45,
  currentAgent: 'backend-developer',
});
```

### Task C.4: Align Frontend/Backend Types

**Issue**: Frontend `ProjectContext` vs Backend `AgentProjectContext`

**Fix**:

- Create shared type mapping
- Add type adapter in SetupWizardService
- Document type differences

**Batch C Commit Format**:

```
feat(vscode): batch C - RPC integration for agent-generation wizard

- Register RPC message handlers for wizard actions
- Implement response protocol (messageId correlation)
- Add progress event emission to webview
- Align frontend/backend type contracts
```

---

## Batch D: Workspace Intelligence Integration (CRITICAL FIX)

**Type**: BUG FIX + FEATURE ENHANCEMENT
**Developer**: backend-developer
**Tasks**: 6 | **Dependencies**: Batches A, B, C
**Estimated Complexity**: Medium (2-3 hours)

### Context

**CRITICAL PRODUCTION BLOCKER**: Phase 1 workspace analysis in OrchestratorService is currently a non-functional stub that returns hardcoded context (all projects detected as "Node.js with TypeScript"). This breaks intelligent agent selection for all non-Node.js projects.

**Solution**: Integrate existing `workspace-intelligence` library services that are already production-ready and proven in the `template-generation` library.

### Available Services (Already Built)

From `@ptah-extension/workspace-intelligence`:

1. **WorkspaceAnalyzerService** - Main orchestrator for workspace analysis
2. **ProjectDetectorService** - 13 project types (Node, React, Angular, Python, Java, Rust, Go, .NET, PHP, Ruby, Vue, Next.js, General)
3. **FrameworkDetectorService** - Framework identification (React, Vue, Angular, Express, Django, etc.)
4. **MonorepoDetectorService** - 6 monorepo types (Nx, Lerna, Turborepo, Rush, pnpm, Yarn)
5. **DependencyAnalyzerService** - Package.json/requirements.txt analysis
6. **FileRelevanceScorerService** - Query-based file ranking for agent selection

### Task D.1: Inject WorkspaceAnalyzerService via DI

**File**: `libs/backend/agent-generation/src/lib/services/orchestrator.service.ts`
**Current**: No workspace-intelligence services injected

**Fix**:

```typescript
// Add to imports
import {
  WorkspaceAnalyzerService,
  ProjectDetectorService,
  FrameworkDetectorService,
  MonorepoDetectorService,
  ProjectInfo,
  WorkspaceStructureAnalysis
} from '@ptah-extension/workspace-intelligence';

// Add to constructor (lines ~130-135)
constructor(
  // ... existing dependencies
  @inject(WORKSPACE_INTELLIGENCE_TOKENS.WORKSPACE_ANALYZER)
  private readonly workspaceAnalyzer: WorkspaceAnalyzerService,

  @inject(WORKSPACE_INTELLIGENCE_TOKENS.PROJECT_DETECTOR)
  private readonly projectDetector: ProjectDetectorService,

  @inject(WORKSPACE_INTELLIGENCE_TOKENS.FRAMEWORK_DETECTOR)
  private readonly frameworkDetector: FrameworkDetectorService,

  @inject(WORKSPACE_INTELLIGENCE_TOKENS.MONOREPO_DETECTOR)
  private readonly monorepoDetector: MonorepoDetectorService,
) {}
```

**Also Required**:

- Add WORKSPACE_INTELLIGENCE_TOKENS to imports (check if already exists in agent-generation DI tokens)
- If not, import from `@ptah-extension/workspace-intelligence` directly

### Task D.2: Replace analyzeWorkspace Stub with Real Implementation

**File**: `libs/backend/agent-generation/src/lib/services/orchestrator.service.ts:367-397`
**Current**: Hardcoded stub returns fake context

**Fix**: Replace entire method with real workspace analysis:

```typescript
private async analyzeWorkspace(
  workspaceUri: vscode.Uri,
  progressCallback?: ProgressCallback
): Promise<Result<AgentProjectContext, Error>> {
  try {
    this.logger.debug('Starting workspace analysis', { workspace: workspaceUri.fsPath });

    // Get comprehensive project info from workspace-intelligence
    const projectInfo = await this.workspaceAnalyzer.getProjectInfo();

    if (!projectInfo) {
      return Result.err(new Error('Could not analyze workspace - no project info available'));
    }

    // Get monorepo detection
    const monorepoResult = await this.monorepoDetector.detectMonorepo(workspaceUri);

    // Get framework detection (from project type)
    const frameworks = await this.frameworkDetector.detectFrameworks(workspaceUri);

    // Report progress
    progressCallback?.({
      phase: 'analysis',
      percentComplete: 50,
      totalAgents: 0,
      agentsProcessed: 0,
      currentOperation: 'Detecting project type and frameworks',
      detectedCharacteristics: [
        `Project Type: ${projectInfo.type}`,
        `Frameworks: ${frameworks.join(', ') || 'None'}`,
        monorepoResult.isMonorepo ? `Monorepo: ${monorepoResult.type}` : 'Single package'
      ]
    });

    // Map ProjectInfo to AgentProjectContext
    const context: AgentProjectContext = {
      rootPath: projectInfo.path,
      projectType: projectInfo.type, // Already correct ProjectType enum
      frameworks: frameworks,
      monorepoType: monorepoResult.isMonorepo ? monorepoResult.type : undefined,
      relevantFiles: [], // Can be populated by FileRelevanceScorerService if needed
      techStack: {
        languages: this.detectLanguagesFromProjectType(projectInfo.type),
        frameworks: frameworks,
        buildTools: this.detectBuildTools(projectInfo),
        testingFrameworks: this.detectTestingFrameworks(projectInfo.devDependencies),
        packageManager: this.detectPackageManager(projectInfo.path),
      },
      codeConventions: {
        style: 'standard',
        naming: 'camelCase',
        fileStructure: monorepoResult.isMonorepo ? 'monorepo' : 'standard',
      },
    };

    this.logger.info('Workspace analysis complete', {
      projectType: context.projectType,
      frameworks: context.frameworks,
      isMonorepo: !!context.monorepoType,
    });

    return Result.ok(context);
  } catch (error) {
    this.logger.error('Workspace analysis failed', error as Error);
    return Result.err(new Error(`Workspace analysis failed: ${(error as Error).message}`));
  }
}
```

### Task D.3: Implement Helper Methods for Tech Stack Detection

**File**: Same orchestrator.service.ts
**Location**: Add as private methods after analyzeWorkspace

**Implement**:

```typescript
/**
 * Detect primary languages from project type
 */
private detectLanguagesFromProjectType(projectType: ProjectType): string[] {
  const languageMap: Record<ProjectType, string[]> = {
    [ProjectType.Node]: ['JavaScript', 'TypeScript'],
    [ProjectType.React]: ['JavaScript', 'TypeScript', 'JSX', 'TSX'],
    [ProjectType.Angular]: ['TypeScript'],
    [ProjectType.Vue]: ['JavaScript', 'TypeScript', 'Vue'],
    [ProjectType.NextJS]: ['JavaScript', 'TypeScript', 'JSX', 'TSX'],
    [ProjectType.Python]: ['Python'],
    [ProjectType.Java]: ['Java'],
    [ProjectType.Rust]: ['Rust'],
    [ProjectType.Go]: ['Go'],
    [ProjectType.DotNet]: ['C#', 'F#'],
    [ProjectType.PHP]: ['PHP'],
    [ProjectType.Ruby]: ['Ruby'],
    [ProjectType.General]: ['Unknown'],
  };

  return languageMap[projectType] || ['Unknown'];
}

/**
 * Detect build tools from project info
 */
private detectBuildTools(projectInfo: ProjectInfo): string[] {
  const buildTools: string[] = [];
  const deps = [...projectInfo.dependencies, ...projectInfo.devDependencies];

  if (deps.includes('webpack')) buildTools.push('Webpack');
  if (deps.includes('vite')) buildTools.push('Vite');
  if (deps.includes('esbuild')) buildTools.push('esbuild');
  if (deps.includes('rollup')) buildTools.push('Rollup');
  if (deps.includes('parcel')) buildTools.push('Parcel');
  if (deps.includes('turbopack')) buildTools.push('Turbopack');
  if (deps.includes('@nx/devkit')) buildTools.push('Nx');
  if (deps.includes('gradle')) buildTools.push('Gradle');
  if (deps.includes('maven')) buildTools.push('Maven');
  if (deps.includes('cargo')) buildTools.push('Cargo');
  if (deps.includes('go')) buildTools.push('Go Build');
  if (deps.includes('setuptools')) buildTools.push('setuptools');

  // Fallback based on project type
  if (buildTools.length === 0) {
    if (projectInfo.type === ProjectType.Node) buildTools.push('npm/tsc');
    if (projectInfo.type === ProjectType.Python) buildTools.push('pip');
    if (projectInfo.type === ProjectType.Java) buildTools.push('Maven/Gradle');
    if (projectInfo.type === ProjectType.Rust) buildTools.push('Cargo');
    if (projectInfo.type === ProjectType.Go) buildTools.push('Go Build');
  }

  return buildTools;
}

/**
 * Detect testing frameworks from dependencies
 */
private detectTestingFrameworks(devDependencies: string[]): string[] {
  const frameworks: string[] = [];

  if (devDependencies.includes('jest')) frameworks.push('Jest');
  if (devDependencies.includes('vitest')) frameworks.push('Vitest');
  if (devDependencies.includes('mocha')) frameworks.push('Mocha');
  if (devDependencies.includes('jasmine')) frameworks.push('Jasmine');
  if (devDependencies.includes('karma')) frameworks.push('Karma');
  if (devDependencies.includes('cypress')) frameworks.push('Cypress');
  if (devDependencies.includes('playwright')) frameworks.push('Playwright');
  if (devDependencies.includes('@testing-library/react')) frameworks.push('React Testing Library');
  if (devDependencies.includes('@testing-library/angular')) frameworks.push('Angular Testing Library');
  if (devDependencies.includes('pytest')) frameworks.push('pytest');
  if (devDependencies.includes('unittest')) frameworks.push('unittest');
  if (devDependencies.includes('junit')) frameworks.push('JUnit');
  if (devDependencies.includes('cargo-test')) frameworks.push('Cargo Test');

  return frameworks;
}

/**
 * Detect package manager from workspace
 */
private detectPackageManager(workspacePath: string): string {
  const fs = require('fs');
  const path = require('path');

  // Check for lock files
  if (fs.existsSync(path.join(workspacePath, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(workspacePath, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(workspacePath, 'package-lock.json'))) return 'npm';
  if (fs.existsSync(path.join(workspacePath, 'bun.lockb'))) return 'bun';

  // Fallbacks based on project type
  if (fs.existsSync(path.join(workspacePath, 'requirements.txt'))) return 'pip';
  if (fs.existsSync(path.join(workspacePath, 'Cargo.toml'))) return 'cargo';
  if (fs.existsSync(path.join(workspacePath, 'go.mod'))) return 'go mod';
  if (fs.existsSync(path.join(workspacePath, 'pom.xml'))) return 'maven';
  if (fs.existsSync(path.join(workspacePath, 'build.gradle'))) return 'gradle';
  if (fs.existsSync(path.join(workspacePath, 'Gemfile'))) return 'bundler';
  if (fs.existsSync(path.join(workspacePath, 'composer.json'))) return 'composer';

  return 'npm'; // Default fallback
}
```

### Task D.4: Enhance Agent Selection with FileRelevanceScorerService (Optional Enhancement)

**File**: `libs/backend/agent-generation/src/lib/services/agent-selection.service.ts`
**Current**: Basic project type matching
**Enhancement**: Use file relevance scoring for smarter agent recommendations

**Add to selectAgents method**:

```typescript
// After basic project type matching, use relevance scoring to prioritize agents
// based on actual workspace files (e.g., prioritize backend-developer if more
// backend code than frontend code)

// This can be added in a future iteration if needed
```

### Task D.5: Update DI Registration

**File**: `libs/backend/agent-generation/src/lib/di/registration.ts`
**Task**: Ensure workspace-intelligence services are registered if not already

**Check**:

```typescript
// If workspace-intelligence services aren't already registered, add:
import { WORKSPACE_INTELLIGENCE_TOKENS, WorkspaceAnalyzerService, ProjectDetectorService, FrameworkDetectorService, MonorepoDetectorService } from '@ptah-extension/workspace-intelligence';

export function registerAgentGeneration(container: Container): void {
  // ... existing registrations

  // Register workspace-intelligence services (if not already registered globally)
  // Note: Check if these are already registered in vscode-core or extension activation
  if (!container.isRegistered(WORKSPACE_INTELLIGENCE_TOKENS.WORKSPACE_ANALYZER)) {
    container.register(WORKSPACE_INTELLIGENCE_TOKENS.WORKSPACE_ANALYZER, WorkspaceAnalyzerService);
    container.register(WORKSPACE_INTELLIGENCE_TOKENS.PROJECT_DETECTOR, ProjectDetectorService);
    container.register(WORKSPACE_INTELLIGENCE_TOKENS.FRAMEWORK_DETECTOR, FrameworkDetectorService);
    container.register(WORKSPACE_INTELLIGENCE_TOKENS.MONOREPO_DETECTOR, MonorepoDetectorService);
  }
}
```

### Task D.6: Add Import for ProjectType Enum

**File**: `libs/backend/agent-generation/src/lib/types/agent-generation.types.ts`
**Current**: May be using local enum
**Fix**: Import from workspace-intelligence for consistency

**Update**:

```typescript
// Replace local ProjectType enum with import from workspace-intelligence
export { ProjectType } from '@ptah-extension/workspace-intelligence';

// Or if already imported, ensure it's from workspace-intelligence, not local definition
```

### Success Criteria

1. All workspace-intelligence services properly injected via DI
2. analyzeWorkspace method uses real workspace analysis (no hardcoded values)
3. ProjectInfo correctly mapped to AgentProjectContext
4. All project types detected correctly (Node, React, Angular, Python, etc.)
5. Framework detection working (React, Express, Django, etc.)
6. Monorepo detection working (Nx, Lerna, Turborepo, etc.)
7. Tech stack fields populated with real data
8. TypeScript compilation passes: `npx nx build agent-generation`
9. No type errors, all enums consistent with workspace-intelligence

### Testing Verification

After implementation, test with different project types:

```bash
# Test Node.js project
cd /path/to/node-project
# Verify: projectType = ProjectType.Node

# Test Angular project
cd /path/to/angular-project
# Verify: projectType = ProjectType.Angular, frameworks = ['Angular']

# Test Python project
cd /path/to/python-project
# Verify: projectType = ProjectType.Python, languages = ['Python']

# Test Nx monorepo
cd D:\projects\ptah-extension
# Verify: projectType = ProjectType.Node, monorepoType = MonorepoType.Nx
```

### Deliverables

Return a report with:

1. ✅ Confirmation that workspace-intelligence services are injected
2. ✅ analyzeWorkspace implementation using real services
3. ✅ Helper methods for tech stack detection
4. ✅ Build verification passes
5. ✅ Example output showing real project detection (not hardcoded)

**DO NOT create a git commit** - the orchestrator will handle that after verification.

**Batch D Commit Format** (after verification):

```
fix(vscode): batch D - integrate workspace-intelligence for real project detection

- inject WorkspaceAnalyzerService, ProjectDetectorService, FrameworkDetectorService, MonorepoDetectorService
- replace analyzeWorkspace stub with real workspace analysis
- implement tech stack detection helpers (languages, build tools, testing frameworks, package manager)
- map ProjectInfo to AgentProjectContext with real data
- fix critical production blocker: all projects now detected correctly (not hardcoded as Node.js)
```

---

## Progress Tracking

| Batch | Description                            | Status   | Commit SHA | Completed  |
| ----- | -------------------------------------- | -------- | ---------- | ---------- |
| A     | Critical Style Fixes (8 tasks)         | COMPLETE | 56e5ec8    | 2025-12-11 |
| B     | Critical Logic Fixes (5 tasks)         | COMPLETE | 96012f4    | 2025-12-11 |
| C     | RPC Integration (4 tasks)              | COMPLETE | c4c0668    | 2025-12-11 |
| D     | Workspace Intelligence Integration (6) | COMPLETE | 21a5d83    | 2025-12-11 |

---

## Success Criteria

### Quality Gates

- All 8 blocking style issues fixed
- All 5 critical logic issues addressed
- RPC handlers registered and tested
- All existing tests pass (fix broken ones)
- Type safety restored (no `as any` without TODO)

### Integration Readiness

- Frontend can send `setup-wizard:start` and receive response
- Progress events flow to webview
- Error messages propagate correctly
- State transitions are atomic

---

## Dependencies

**This Task Blocks**:

- TASK_2025_065 Batch 2C (Wizard Components)
- TASK_2025_065 Batch 2D (Wizard Components 4-6)
- Integration Batch 4 (Backend Integration)
- Integration Batch 5 (Frontend-Backend Wiring)

**This Task Depends On**:

- TASK_2025_064 (Backend Track) - Complete

---

## Development Notes

### Testing After Fixes

```bash
# Run all agent-generation tests
npx nx test agent-generation

# Run specific service test
npx nx test agent-generation --testPathPattern=orchestrator.service.spec.ts

# Verify no TypeScript errors
npx nx build agent-generation
```

### Git Workflow

```bash
# One commit per batch
git add libs/backend/agent-generation/src/lib/
git commit -m "fix(vscode): batch {A|B|C} - {description}"
```

---

**Review Reports**: See `task-tracking/TASK_2025_064_1/code-style-review.md` and `code-logic-review.md`
