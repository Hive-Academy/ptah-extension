# Phase 1, 3, 4 Execution Plan

**Date**: January 11, 2025  
**Context**: Critical fixes + deletion + workspace-intelligence integration  
**Status**: Phase 1 ✅ COMPLETE | Phase 3 ⏸️ BLOCKED | Phase 4 📋 PLANNED

---

## ✅ Phase 1: Critical Fixes (COMPLETE)

### Fix 1: Tool Filtering in JSONLStreamParser ✅

**File**: `libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts`

**Changes Made**:

1. ✅ Added `ToolFilterConfig` interface for configuration
2. ✅ Added `DEFAULT_HIDDEN_TOOLS` constant: `['Read', 'Edit', 'MultiEdit', 'TodoWrite']`
3. ✅ Implemented `shouldHideTool()` method to filter verbose tool results
4. ✅ Added `formatToolOutput()` for special tool formatting
5. ✅ Implemented `formatTodoWriteOutput()` with checkmarks (✅ 🔄 ⏳)

**Code Snippet**:

```typescript
export class JSONLStreamParser {
  private static readonly DEFAULT_HIDDEN_TOOLS = [
    'Read', // Verbose file reading results
    'Edit', // File edit confirmations
    'MultiEdit', // Multi-file edit results
    'TodoWrite', // Todo list updates (formatted separately)
  ];

  private shouldHideTool(toolName: string, subtype: string): boolean {
    // Only hide result messages (keep start/error for transparency)
    if (subtype !== 'result') {
      return false;
    }
    return this.config.hiddenTools?.includes(toolName) ?? false;
  }

  private formatTodoWriteOutput(output: { todos: Array<{ content: string; status: string }> }): string {
    let formatted = '📝 Todo List Update:\n';
    for (const todo of output.todos) {
      const status = todo.status === 'completed' ? '✅' : todo.status === 'in_progress' ? '🔄' : '⏳';
      formatted += `${status} ${todo.content}\n`;
    }
    return formatted.trim();
  }
}
```

**Verification**:

- ✅ Build successful: `npx nx build claude-domain`
- ✅ No TypeScript errors
- ✅ Lint passing

**Production Impact**:

- ✅ Reduces UI clutter by hiding verbose tool results
- ✅ Provides user-friendly TodoWrite formatting
- ✅ Maintains transparency (still shows tool start/error events)

---

## ⏸️ Phase 3: Delete Old AI Providers (BLOCKED)

### Current Blockers

**Files Still Using OLD ai-providers**:

1. `apps/ptah-extension-vscode/src/core/ptah-extension.ts`

   - Lines 18-23: Imports `ProviderFactory`, `ProviderManager`, configs
   - Lines 40-41: ServiceDependencies interface

2. `apps/ptah-extension-vscode/src/providers/angular-webview.provider.ts`
   - Line 7: Imports `ProviderManager`

**Why Blocked**:

- Cannot delete old ai-providers until main extension migrated to NEW ai-providers-core library
- Need to update DI setup in main.ts and ptah-extension.ts first

**Decision**: DEFER Phase 3 until after Phase 4 (workspace-intelligence integration)

---

## 📋 Phase 4: Workspace Intelligence Integration (NEW PHASE)

### Objective

Replace OLD workspace-manager.ts (460 lines) with NEW workspace-intelligence library (10 specialized services).

### Architecture Overview

**OLD (Monolithic)**:

```
apps/ptah-extension-vscode/src/services/
└── workspace-manager.ts (460 lines)
    ├── detectProjectType()
    ├── detectFramework()
    ├── getFileStructure()
    ├── analyzeCodebase()
    ├── optimizeContext()
    └── ... 10+ mixed responsibilities
```

**NEW (Modular)**:

```
libs/backend/workspace-intelligence/
├── project-analysis/
│   ├── project-detector.service.ts (Project type detection)
│   ├── framework-detector.service.ts (Framework detection)
│   └── dependency-analyzer.service.ts (Dependencies)
├── workspace-indexing/
│   └── workspace-indexer.service.ts (File indexing)
├── context/
│   └── context.service.ts (Context optimization)
├── project-structure/
│   └── workspace.service.ts (File structure analysis)
└── composite/
    └── workspace-analyzer.service.ts (Orchestration) 🆕 NEED TO CREATE
```

### Step-by-Step Execution Plan

#### Step 4.1: Create WorkspaceAnalyzerService Composite (2 hours)

**File**: `libs/backend/workspace-intelligence/src/composite/workspace-analyzer.service.ts`

**Purpose**: Single facade service that orchestrates all 10 workspace intelligence services.

**Interface** (mirrors old WorkspaceManager):

```typescript
@injectable()
export class WorkspaceAnalyzerService {
  constructor(@inject(TOKENS.PROJECT_DETECTOR) private projectDetector: ProjectDetectorService, @inject(TOKENS.FRAMEWORK_DETECTOR) private frameworkDetector: FrameworkDetectorService, @inject(TOKENS.WORKSPACE_INDEXER) private indexer: WorkspaceIndexerService, @inject(TOKENS.CONTEXT_SERVICE) private contextService: ContextService, @inject(TOKENS.WORKSPACE_SERVICE) private workspaceService: WorkspaceService, @inject(TOKENS.DEPENDENCY_ANALYZER) private dependencyAnalyzer: DependencyAnalyzerService) {}

  // Facade methods (delegates to specialized services)
  async detectProjectType(path: string): Promise<ProjectType> {
    return this.projectDetector.detectProjectType(path);
  }

  async detectFramework(path: string): Promise<string[]> {
    return this.frameworkDetector.detectFrameworks(path);
  }

  async getFileStructure(rootPath: string): Promise<FileNode[]> {
    return this.workspaceService.getFileTree(rootPath);
  }

  async optimizeContext(files: string[]): Promise<OptimizedContext> {
    return this.contextService.optimizeForContext(files, {
      maxTokens: 100000,
      priorityPatterns: ['*.ts', '*.tsx', '*.js', '*.jsx'],
    });
  }

  // ... more facade methods
}
```

#### Step 4.2: Create DI Registration Function (30 minutes)

**File**: `libs/backend/workspace-intelligence/src/di/register.ts`

**Purpose**: Register all workspace-intelligence services with DI container.

```typescript
import { DependencyContainer } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';

export function registerWorkspaceIntelligenceServices(container: DependencyContainer): void {
  // Register all detectors
  container.registerSingleton(TOKENS.PROJECT_DETECTOR, ProjectDetectorService);
  container.registerSingleton(TOKENS.FRAMEWORK_DETECTOR, FrameworkDetectorService);
  container.registerSingleton(TOKENS.DEPENDENCY_ANALYZER, DependencyAnalyzerService);

  // Register indexing
  container.registerSingleton(TOKENS.WORKSPACE_INDEXER, WorkspaceIndexerService);

  // Register context optimization
  container.registerSingleton(TOKENS.CONTEXT_SERVICE, ContextService);
  container.registerSingleton(TOKENS.TOKEN_COUNTER, TokenCounterService);

  // Register workspace analysis
  container.registerSingleton(TOKENS.WORKSPACE_SERVICE, WorkspaceService);

  // Register composite orchestrator
  container.registerSingleton(TOKENS.WORKSPACE_ANALYZER, WorkspaceAnalyzerService);

  console.info('✅ Workspace Intelligence services registered');
}
```

#### Step 4.3: Add TOKENS to vscode-core (30 minutes)

**File**: `libs/backend/vscode-core/src/di/tokens.ts`

**Changes**:

```typescript
export const TOKENS = {
  // ... existing tokens

  // Workspace Intelligence
  PROJECT_DETECTOR: Symbol.for('ProjectDetectorService'),
  FRAMEWORK_DETECTOR: Symbol.for('FrameworkDetectorService'),
  DEPENDENCY_ANALYZER: Symbol.for('DependencyAnalyzerService'),
  WORKSPACE_INDEXER: Symbol.for('WorkspaceIndexerService'),
  CONTEXT_SERVICE: Symbol.for('ContextService'),
  TOKEN_COUNTER: Symbol.for('TokenCounterService'),
  WORKSPACE_SERVICE: Symbol.for('WorkspaceService'),
  WORKSPACE_ANALYZER: Symbol.for('WorkspaceAnalyzerService'),
} as const;
```

#### Step 4.4: Update main.ts to Use New Library (1 hour)

**File**: `apps/ptah-extension-vscode/src/main.ts`

**Changes**:

```typescript
import { registerWorkspaceIntelligenceServices } from '@ptah-extension/workspace-intelligence';

export async function activate(context: vscode.ExtensionContext) {
  // Step 1: Setup infrastructure
  const container = DIContainer.setup(context);

  // Step 2: Register workspace intelligence
  registerWorkspaceIntelligenceServices(container);

  // Step 3: Register other services (claude-domain, ai-providers-core)
  // ... (future work)

  // Step 4: Resolve main extension
  const extension = container.resolve<PtahExtension>(PtahExtension);
  await extension.activate();
}
```

#### Step 4.5: Update ptah-extension.ts to Use WorkspaceAnalyzerService (1 hour)

**File**: `apps/ptah-extension-vscode/src/core/ptah-extension.ts`

**Changes**:

```typescript
import type { WorkspaceAnalyzerService } from '@ptah-extension/workspace-intelligence';

@injectable()
export class PtahExtension implements vscode.Disposable {
  constructor(
    @inject(TOKENS.WORKSPACE_ANALYZER) private workspaceAnalyzer: WorkspaceAnalyzerService // ... other dependencies
  ) {}

  // Update all references
  async someMethod() {
    const projectType = await this.workspaceAnalyzer.detectProjectType(path);
    // OLD: this.workspaceManager.detectProjectType(path)
  }
}
```

#### Step 4.6: Delete workspace-manager.ts (10 minutes)

**Command**:

```bash
git rm apps/ptah-extension-vscode/src/services/workspace-manager.ts
git commit -m "feat(TASK_PRV_005): delete old workspace-manager.ts - replaced by workspace-intelligence library"
```

#### Step 4.7: Update All References (1 hour)

**Files to Update**:

- `apps/ptah-extension-vscode/src/providers/angular-webview.provider.ts`
- `apps/ptah-extension-vscode/src/handlers/**/*.ts`
- Any other files importing WorkspaceManager

**Search Command**:

```bash
grep -r "WorkspaceManager" apps/ptah-extension-vscode/src/
grep -r "workspace-manager" apps/ptah-extension-vscode/src/
```

#### Step 4.8: Build & Test (30 minutes)

**Commands**:

```bash
# Build all affected projects
npx nx affected:build

# Run linting
npx nx affected:lint

# Type check
npx nx affected:typecheck

# Test extension (F5 in VS Code)
```

---

## 📋 Phase 5: Complete AI Providers Migration (DEFERRED AFTER PHASE 4)

### After Phase 4, Continue With

#### Step 5.1: Create AI Providers DI Registration

**File**: `libs/backend/ai-providers-core/src/di/register.ts`

```typescript
export function registerAIProvidersServices(container: DependencyContainer): void {
  // Register strategy
  container.registerSingleton(TOKENS.PROVIDER_STRATEGY, IntelligentProviderStrategy);

  // Register adapters
  container.registerSingleton(TOKENS.CLAUDE_CLI_ADAPTER, ClaudeCliAdapter);
  container.registerSingleton(TOKENS.VSCODE_LM_ADAPTER, VsCodeLmAdapter);

  // Register manager
  container.registerSingleton(TOKENS.PROVIDER_MANAGER, ProviderManager);

  console.info('✅ AI Providers services registered');
}
```

#### Step 5.2: Update main.ts with AI Providers

```typescript
import { registerAIProvidersServices } from '@ptah-extension/ai-providers-core';
import { registerClaudeDomainServices } from '@ptah-extension/claude-domain';

export async function activate(context: vscode.ExtensionContext) {
  const container = DIContainer.setup(context);

  registerWorkspaceIntelligenceServices(container);
  registerClaudeDomainServices(container); // Sessions, permissions, CLI
  registerAIProvidersServices(container); // Provider management

  const extension = container.resolve<PtahExtension>(PtahExtension);
  await extension.activate();
}
```

#### Step 5.3: Delete Old AI Providers

```bash
git rm -r apps/ptah-extension-vscode/src/services/ai-providers/
git commit -m "feat(TASK_PRV_005): delete old ai-providers - replaced by ai-providers-core library"
```

---

## 📊 Timeline Estimates

| Phase       | Task                                  | Estimate     | Status           |
| ----------- | ------------------------------------- | ------------ | ---------------- |
| **Phase 1** | Tool filtering + TodoWrite formatting | 2 hours      | ✅ COMPLETE      |
| **Phase 4** | Create WorkspaceAnalyzerService       | 2 hours      | 📋 TODO          |
| **Phase 4** | DI registration function              | 30 min       | 📋 TODO          |
| **Phase 4** | Add TOKENS                            | 30 min       | 📋 TODO          |
| **Phase 4** | Update main.ts                        | 1 hour       | 📋 TODO          |
| **Phase 4** | Update ptah-extension.ts              | 1 hour       | 📋 TODO          |
| **Phase 4** | Update references                     | 1 hour       | 📋 TODO          |
| **Phase 4** | Build & test                          | 30 min       | 📋 TODO          |
| **Phase 5** | AI providers registration             | 1 hour       | 📋 DEFERRED      |
| **Phase 5** | Update main.ts with AI                | 30 min       | 📋 DEFERRED      |
| **Phase 5** | Delete old AI providers               | 10 min       | 📋 DEFERRED      |
| **Total**   | **Phase 1 + 4**                       | **~9 hours** | **11% COMPLETE** |

---

## 🎯 Immediate Next Steps

1. ✅ **DONE**: Tool filtering + TodoWrite formatting
2. 📋 **NEXT**: Create `WorkspaceAnalyzerService` composite
3. 📋 **THEN**: DI registration for workspace-intelligence
4. 📋 **THEN**: Update main.ts and ptah-extension.ts
5. 📋 **THEN**: Delete workspace-manager.ts
6. 📋 **FINALLY**: Delete old ai-providers (Phase 5)

---

## 🚨 Critical Dependencies

**Phase 4 depends on**:

- ✅ workspace-intelligence library fully implemented
- ✅ All 10 services working and tested
- ✅ vscode-core DI container setup

**Phase 5 depends on**:

- ✅ Phase 4 complete (workspace-intelligence integrated)
- ✅ claude-domain library fully implemented
- ✅ ai-providers-core library fully implemented

---

## ✅ Success Criteria

**Phase 1** (COMPLETE):

- ✅ Tool filtering implemented and tested
- ✅ TodoWrite formatting working
- ✅ Build passing

**Phase 4** (IN PROGRESS):

- [ ] WorkspaceAnalyzerService created and working
- [ ] All workspace-intelligence services registered in DI
- [ ] workspace-manager.ts deleted
- [ ] All references updated
- [ ] Extension builds and runs
- [ ] No regression in workspace detection features

**Phase 5** (DEFERRED):

- [ ] ai-providers-core integrated
- [ ] Old ai-providers deleted
- [ ] Provider failover working
- [ ] Extension builds and runs
