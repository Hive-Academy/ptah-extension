# TASK_2025_139: Implementation Tasks

## Batch 1: Extended Type System & New Detectors in workspace-intelligence

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: None

### Task 1.1: Define Extended Type System

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\types\workspace.types.ts`
**Dependencies**: None

Add new enums and the unified result type:

```typescript
// New enums
export enum BuildTool {
  Webpack = 'webpack',
  Vite = 'vite',
  Esbuild = 'esbuild',
  Rollup = 'rollup',
  Parcel = 'parcel',
  Turbopack = 'turbopack',
  Nx = 'nx',
  Gradle = 'gradle',
  Maven = 'maven',
  Cargo = 'cargo',
  GoBuild = 'go-build',
  Setuptools = 'setuptools',
}

export enum TestingFramework {
  Jest = 'jest',
  Vitest = 'vitest',
  Mocha = 'mocha',
  Jasmine = 'jasmine',
  Karma = 'karma',
  Cypress = 'cypress',
  Playwright = 'playwright',
  Pytest = 'pytest',
  Unittest = 'unittest',
  GoTest = 'go-test',
  CargoTest = 'cargo-test',
  JUnit = 'junit',
  PHPUnit = 'phpunit',
  RSpec = 'rspec',
}

export enum PackageManager {
  Npm = 'npm',
  Yarn = 'yarn',
  Pnpm = 'pnpm',
  Bun = 'bun',
}

export enum Language {
  TypeScript = 'typescript',
  JavaScript = 'javascript',
  Python = 'python',
  Java = 'java',
  Kotlin = 'kotlin',
  Rust = 'rust',
  Go = 'go',
  CSharp = 'csharp',
  PHP = 'php',
  Ruby = 'ruby',
  Swift = 'swift',
  Dart = 'dart',
  HTML = 'html',
  CSS = 'css',
  SCSS = 'scss',
}

export enum ArchitecturePattern {
  DDD = 'ddd',
  Layered = 'layered',
  Microservices = 'microservices',
  Hexagonal = 'hexagonal',
  Clean = 'clean',
  ComponentBased = 'component-based',
  Monolithic = 'monolithic',
}

export interface KeyFileLocations {
  entryPoints: string[];
  configs: string[];
  tests: string[];
  ci: string[];
}

export interface CodeHealthSummary {
  diagnosticsCount: { error: number; warning: number; info: number };
  hasLinter: boolean;
  hasFormatter: boolean;
  hasTestConfig: boolean;
  estimatedTestCoverage: 'none' | 'low' | 'medium' | 'high';
}

export interface ProjectIntelligenceResult {
  // Core (from existing WorkspaceAnalyzerService)
  projectType: ProjectType;
  framework: Framework | null;
  isMonorepo: boolean;
  monorepoType: MonorepoType | null;
  dependencies: string[];
  devDependencies: string[];
  configFiles: string[];

  // Extended detection
  buildTools: BuildTool[];
  testingFrameworks: TestingFramework[];
  packageManager: PackageManager | null;
  languages: Language[];

  // Deep analysis
  architecturePattern: ArchitecturePattern | null;
  keyFiles: KeyFileLocations;
  languageDistribution: Record<string, number>;
  codeHealth: CodeHealthSummary;

  // Metadata
  analyzedAt: number;
  workspacePath: string;
}
```

**Verification**:

- [ ] All enums exported from `workspace-intelligence` barrel
- [ ] `ProjectIntelligenceResult` is exported from `@ptah-extension/workspace-intelligence`
- [ ] No circular dependencies introduced
- [ ] Typecheck passes: `nx run workspace-intelligence:typecheck`

---

### Task 1.2: Create BuildToolDetectorService

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\project-analysis\build-tool-detector.service.ts`
**Dependencies**: Task 1.1
**Pattern**: Follow `framework-detector.service.ts` structure

Consolidate build tool detection from:

- `EnhancedPromptsService.buildDetectedStack()` (5 patterns)
- `AgentGenerationOrchestratorService.detectBuildTools()` (12 patterns)

Detection logic:

- Check `devDependencies` for tool packages
- Check `configFiles` for tool-specific config files (webpack.config._, vite.config._, rollup.config.\*, etc.)
- Return `BuildTool[]`

**Verification**:

- [ ] Detects all 12 build tools from the union of both systems
- [ ] Unit tests cover each detection path
- [ ] Registered via `TOKENS.BUILD_TOOL_DETECTOR_SERVICE` (add to tokens.ts)

---

### Task 1.3: Create TestingFrameworkDetectorService

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\project-analysis\testing-framework-detector.service.ts`
**Dependencies**: Task 1.1
**Pattern**: Follow `framework-detector.service.ts` structure

Consolidate testing framework detection from:

- `EnhancedPromptsService.buildDetectedStack()` (5 patterns)
- `AgentGenerationOrchestratorService.detectTestingFrameworks()` (14 patterns)

Detection logic:

- Check `devDependencies` for test framework packages
- Check `configFiles` for test config files (jest.config._, vitest.config._, cypress.config.\*, etc.)
- Check `scripts` in package.json for test runner commands
- Return `TestingFramework[]`

**Verification**:

- [ ] Detects all 14 testing frameworks from the union of both systems
- [ ] Unit tests cover each detection path

---

### Task 1.4: Create PackageManagerDetectorService & LanguageDetectorService

**File (PM)**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\project-analysis\package-manager-detector.service.ts`
**File (Lang)**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\project-analysis\language-detector.service.ts`
**Dependencies**: Task 1.1

**Package Manager**: Detect from lock files (package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb). Absorb logic from `AgentGenerationOrchestratorService.detectPackageManager()`.

**Language**: Detect from project type + file extensions. Merge logic from `AgentGenerationOrchestratorService.detectLanguagesFromProjectType()` and file extension counting from `DeepProjectAnalysisService`.

**Verification**:

- [ ] Package manager detected correctly for npm, yarn, pnpm, bun
- [ ] Language list matches or exceeds current detection in both systems

---

### Task 1.5: Create ProjectIntelligenceService (Composite)

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\composite\project-intelligence.service.ts`
**Dependencies**: Tasks 1.1-1.4

Orchestrates all detectors into a single `getProjectIntelligence(workspacePath)` call:

```typescript
@injectable()
export class ProjectIntelligenceService {
  private cache: Map<string, { result: ProjectIntelligenceResult; timestamp: number }> = new Map();
  private ttlMs = 10 * 60 * 1000; // 10 minutes

  constructor(@inject(TOKENS.WORKSPACE_ANALYZER_SERVICE) private workspaceAnalyzer: WorkspaceAnalyzerService, @inject(TOKENS.BUILD_TOOL_DETECTOR_SERVICE) private buildToolDetector: BuildToolDetectorService, @inject(TOKENS.TESTING_FRAMEWORK_DETECTOR_SERVICE) private testingDetector: TestingFrameworkDetectorService, @inject(TOKENS.PACKAGE_MANAGER_DETECTOR_SERVICE) private packageManagerDetector: PackageManagerDetectorService, @inject(TOKENS.LANGUAGE_DETECTOR_SERVICE) private languageDetector: LanguageDetectorService, @inject(TOKENS.LOGGER) private logger: Logger) {}

  async getProjectIntelligence(workspacePath: string): Promise<ProjectIntelligenceResult> {
    // Check cache
    // Run all detectors (parallelize where possible)
    // Build unified result
    // Cache and return
  }

  invalidate(workspacePath: string): void {
    /* clear cache entry */
  }
  invalidateAll(): void {
    /* clear all cache */
  }
}
```

**DI Token**: Add `PROJECT_INTELLIGENCE_SERVICE = Symbol.for('ProjectIntelligenceService')` to `vscode-core/src/di/tokens.ts`
**Registration**: Add to `workspace-intelligence/src/di/register.ts`

**Verification**:

- [ ] Single call returns complete `ProjectIntelligenceResult`
- [ ] Cache hit on second call within TTL
- [ ] `invalidate()` clears cache for workspace
- [ ] Registered and resolvable from main DI container
- [ ] Typecheck passes for entire workspace: `nx run-many --target=typecheck`

---

## Batch 2: Migrate Enhanced Prompts (agent-sdk)

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batch 1

### Task 2.1: Replace Local Interface with Unified Service

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\enhanced-prompts\enhanced-prompts.service.ts`
**Dependencies**: Batch 1

- Delete local `IWorkspaceIntelligence` interface and `WorkspaceAnalysisResult` interface
- Replace `@inject(TOKENS.WORKSPACE_ANALYZER_SERVICE)` with `@inject(TOKENS.PROJECT_INTELLIGENCE_SERVICE)`
- Update `runWizard()` to call `getProjectIntelligence()` instead of `analyzeWorkspace()`

**Verification**:

- [ ] No local workspace intelligence interfaces remain
- [ ] Uses enum types from workspace-intelligence, not strings

### Task 2.2: Delete buildDetectedStack() and Wire Unified Data

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\enhanced-prompts\enhanced-prompts.service.ts`
**Dependencies**: Task 2.1

- Delete `buildDetectedStack()` method (~90 lines)
- Delete `DetectedStack` local type
- Map `ProjectIntelligenceResult` fields directly to `PromptDesignerInput` (update type if needed)
- Update `PromptDesignerInput` in `prompt-designer.types.ts` to accept proper enum types

**Verification**:

- [ ] No regex-based detection in Enhanced Prompts service
- [ ] `PromptDesignerInput` uses `BuildTool[]`, `TestingFramework[]`, etc. (not strings)
- [ ] Net deletion: ~90+ lines

### Task 2.3: Simplify PromptCacheService File Watching

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\prompt-designer\prompt-cache.service.ts`
**Dependencies**: Task 2.1

- Remove `INVALIDATION_TRIGGER_FILES` file watcher setup (handled by ProjectIntelligenceService cache)
- `PromptCacheService` still caches the LLM output (separate concern from workspace analysis cache)
- Listen to `ProjectIntelligenceService.invalidate` events to clear prompt cache when workspace data changes

**Verification**:

- [ ] No file watcher created in PromptCacheService
- [ ] Prompt cache still works for LLM output caching
- [ ] Workspace analysis cache handled by ProjectIntelligenceService

---

## Batch 3: Migrate Agent Generation

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batch 1

### Task 3.1: Refactor Orchestrator to Use Unified Service

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\orchestrator.service.ts`
**Dependencies**: Batch 1

- Replace 4 injections (`WORKSPACE_ANALYZER_SERVICE`, `PROJECT_DETECTOR_SERVICE`, `FRAMEWORK_DETECTOR_SERVICE`, `MONOREPO_DETECTOR_SERVICE`) with single `TOKENS.PROJECT_INTELLIGENCE_SERVICE`
- Refactor `analyzeWorkspace()` to call `getProjectIntelligence()` once
- Delete local detection methods:
  - `detectLanguagesFromProjectType()` (~40 lines)
  - `detectBuildTools()` (~50 lines)
  - `detectTestingFrameworks()` (~50 lines)
  - `detectPackageManager()` (~20 lines)

**Verification**:

- [ ] Only 1 workspace-intelligence injection (ProjectIntelligenceService)
- [ ] ~160+ lines deleted
- [ ] Agent selection receives same data quality

### Task 3.2: Migrate DeepProjectAnalysisService

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\deep-analysis.service.ts`
**Dependencies**: Task 3.1

- Architecture detection logic moves to workspace-intelligence (new `ArchitectureDetectorService`)
- Key file location logic moves to workspace-intelligence (part of `ProjectIntelligenceService`)
- Language distribution calculation moves to `LanguageDetectorService`
- `DeepProjectAnalysisService` becomes a thin wrapper that adds agent-generation-specific scoring on top of `ProjectIntelligenceResult`

**Verification**:

- [ ] Architecture detection available via `ProjectIntelligenceResult.architecturePattern`
- [ ] Key files available via `ProjectIntelligenceResult.keyFiles`
- [ ] Language distribution available via `ProjectIntelligenceResult.languageDistribution`

### Task 3.3: Update Context Mapper & Agent Scoring

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\context-mapper.service.ts`
**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\agent-selection.service.ts`
**Dependencies**: Task 3.1

- `ProjectContextMapperService` maps from `ProjectIntelligenceResult` instead of string-based `ProjectContext`
- Agent scoring services receive `ProjectIntelligenceResult` directly (no intermediate mapping needed)
- Simplify `AgentProjectContext` to align with `ProjectIntelligenceResult` fields

**Verification**:

- [ ] No string-to-enum mapping code in context mapper
- [ ] Agent selection scores match or improve vs. current implementation
- [ ] All agent-generation tests pass

---

## Integration Testing Checklist

- [ ] Extension activates without DI errors
- [ ] Enhanced Prompts wizard completes successfully and caches result
- [ ] Agent Generation wizard completes successfully with correct recommendations
- [ ] Both systems return equivalent or better results compared to pre-refactor
- [ ] Cache invalidation propagates to both consumers
- [ ] `nx run-many --target=typecheck` passes for all projects
- [ ] `nx run-many --target=test` passes for workspace-intelligence, agent-sdk, agent-generation

---

## Git Commit Strategy

- **Batch 1**: `feat(workspace-intelligence): add ProjectIntelligenceService with unified detection (TASK_2025_139)`
- **Batch 2**: `refactor(agent-sdk): migrate Enhanced Prompts to ProjectIntelligenceService (TASK_2025_139)`
- **Batch 3**: `refactor(agent-generation): migrate Agent Generation to ProjectIntelligenceService (TASK_2025_139)`
