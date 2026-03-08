# TASK_2025_139: Unified ProjectIntelligenceService for Enhanced Prompts & Agent Generation

## Executive Summary

**Priority**: P1 (High) | **Effort**: Medium-Large (3 batches) | **Type**: REFACTORING + FEATURE

Both the Enhanced Prompts system (`agent-sdk/prompt-harness/`) and the Agent Generation system (`agent-generation/`) independently analyze workspaces using `workspace-intelligence`, then **re-detect** the same information (frameworks, build tools, testing frameworks, languages) with their own duplicate logic. This task unifies all project analysis into a single `ProjectIntelligenceService` inside `workspace-intelligence`, eliminating duplication and providing a richer, consistent data model for all consumers.

---

## Problem Statement

### Current State: Triple Detection

```
┌─────────────────────────┐     ┌──────────────────────────┐     ┌──────────────────────────┐
│  workspace-intelligence │     │  Enhanced Prompts        │     │  Agent Generation         │
│  (canonical)            │     │  (agent-sdk)             │     │  (agent-generation)       │
├─────────────────────────┤     ├──────────────────────────┤     ├──────────────────────────┤
│ ✅ ProjectType (enum)   │     │ ❌ projectType (string)  │     │ ✅ ProjectType (enum)    │
│ ✅ Framework (enum)     │     │ ❌ framework (string)    │     │ ✅ Framework (enum)      │
│ ✅ MonorepoType (enum)  │     │ ❌ monorepoType (string) │     │ ✅ MonorepoType (enum)   │
│ ❌ Build tools          │     │ ✅ Build tools (5)       │     │ ✅ Build tools (12)      │
│ ❌ Testing frameworks   │     │ ✅ Testing fwks (5)      │     │ ✅ Testing fwks (14)     │
│ ❌ Package manager      │     │ ❌ Package manager       │     │ ✅ Package manager       │
│ ❌ Architecture pattern │     │ ❌ Architecture pattern  │     │ ✅ Architecture pattern  │
│ ❌ Code health          │     │ ❌ Code health           │     │ ✅ Code health           │
│ ❌ Language distribution │     │ ❌ Language distribution  │     │ ✅ Language distribution  │
│ ❌ Key file locations   │     │ ❌ Key file locations    │     │ ✅ Key file locations    │
└─────────────────────────┘     └──────────────────────────┘     └──────────────────────────┘
```

### Specific Duplications

| Detection          | workspace-intelligence     | Enhanced Prompts                                      | Agent Generation                                                                                |
| ------------------ | -------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Framework          | `FrameworkDetectorService` | `buildDetectedStack()` regex on deps                  | Calls `FrameworkDetectorService` + `getProjectInfo()` (redundant)                               |
| Build tools        | Not provided               | 5 patterns (Webpack, Vite, esbuild, Rollup, Turbo)    | 12 patterns (adds Parcel, Turbopack, Nx, Gradle, Maven, Cargo, Go Build, setuptools)            |
| Testing frameworks | Not provided               | 5 patterns (Jest, Mocha, Vitest, Cypress, Playwright) | 14 patterns (adds Jasmine, Karma, pytest, unittest, go test, cargo test, JUnit, PHPUnit, RSpec) |
| Languages          | Not provided               | Passthrough from analysis                             | `detectLanguagesFromProjectType()` local mapping                                                |
| Package manager    | Not provided               | Not provided                                          | `detectPackageManager()` from lock files                                                        |

### Type System Fragmentation

- **Enhanced Prompts** defines a local `IWorkspaceIntelligence` interface with `string` types instead of importing proper enums
- **Agent Generation** imports proper enums from workspace-intelligence but injects **4 separate services** instead of using the composite facade
- Both systems then add their own detection on top

---

## Requirements

### Requirement 1: Unified ProjectIntelligenceResult Type

**SHALL** create a comprehensive `ProjectIntelligenceResult` in `workspace-intelligence/types/` that includes:

```typescript
interface ProjectIntelligenceResult {
  // Core (already exists in WorkspaceAnalyzerService)
  projectType: ProjectType;
  framework: Framework | null;
  isMonorepo: boolean;
  monorepoType: MonorepoType | null;
  dependencies: string[];
  devDependencies: string[];
  configFiles: string[];

  // New: Extended detection (currently duplicated)
  buildTools: BuildTool[];
  testingFrameworks: TestingFramework[];
  packageManager: PackageManager | null;
  languages: Language[];

  // New: Absorbed from Agent Generation deep analysis
  architecturePattern: ArchitecturePattern | null;
  keyFiles: KeyFileLocations;
  languageDistribution: Record<string, number>;
  codeHealth: CodeHealthSummary;

  // Metadata
  analyzedAt: number;
  workspacePath: string;
}
```

**Acceptance Criteria**:

- WHEN any consumer calls `getProjectIntelligence()` THEN it SHALL receive a complete `ProjectIntelligenceResult`
- All detection categories SHALL use enums, not strings
- Result SHALL be computed once and cached, not re-detected per consumer

### Requirement 2: ProjectIntelligenceService

**SHALL** create `ProjectIntelligenceService` in `workspace-intelligence` that:

1. Orchestrates all existing + new detectors into a single `getProjectIntelligence()` call
2. Caches results per workspace path with configurable TTL
3. Provides an invalidation mechanism on file changes
4. Registers via `TOKENS.PROJECT_INTELLIGENCE_SERVICE` (Symbol.for)

**Acceptance Criteria**:

- WHEN `getProjectIntelligence(workspacePath)` is called THEN it SHALL return a complete result in a single call
- WHEN called a second time within TTL THEN it SHALL return the cached result
- WHEN an invalidation trigger file changes THEN cache SHALL be cleared

### Requirement 3: Migrate Enhanced Prompts to Unified Service

**SHALL** refactor `EnhancedPromptsService` to:

1. Replace local `IWorkspaceIntelligence` interface with `TOKENS.PROJECT_INTELLIGENCE_SERVICE`
2. Delete `buildDetectedStack()` method (lines 519-609) -- replaced by unified result
3. Map `ProjectIntelligenceResult` directly to `PromptDesignerInput`
4. Remove `PromptCacheService`'s file watching (now handled by `ProjectIntelligenceService`)

**Acceptance Criteria**:

- WHEN Enhanced Prompts runs THEN it SHALL NOT perform any framework/build-tool/testing detection of its own
- `PromptDesignerInput` SHALL accept `ProjectIntelligenceResult` directly or a clean mapping from it

### Requirement 4: Migrate Agent Generation to Unified Service

**SHALL** refactor `AgentGenerationOrchestratorService` to:

1. Replace 4 separate service injections with single `TOKENS.PROJECT_INTELLIGENCE_SERVICE`
2. Delete `detectBuildTools()`, `detectTestingFrameworks()`, `detectLanguagesFromProjectType()`, `detectPackageManager()` methods
3. Migrate `DeepProjectAnalysisService` architecture detection into workspace-intelligence
4. Migrate `CodeHealthAnalysisService` into workspace-intelligence

**Acceptance Criteria**:

- WHEN agent generation analyzes a workspace THEN it SHALL call `getProjectIntelligence()` once
- Orchestrator SHALL NOT inject `PROJECT_DETECTOR_SERVICE`, `FRAMEWORK_DETECTOR_SERVICE`, or `MONOREPO_DETECTOR_SERVICE` directly

---

## Non-Functional Requirements

- **Performance**: Single `getProjectIntelligence()` call SHALL complete within 3 seconds for typical workspaces
- **Caching**: Results cached per workspace with 10-minute default TTL (configurable)
- **Backward Compatibility**: Existing `WorkspaceAnalyzerService` API SHALL remain unchanged for any other consumers
- **Testing**: Each new detector service SHALL have isolated unit tests

---

## Dependencies

- `libs/backend/workspace-intelligence` -- primary modification target
- `libs/backend/agent-sdk/src/lib/prompt-harness/` -- consumer migration
- `libs/backend/agent-generation/src/lib/services/` -- consumer migration
- `libs/backend/vscode-core/src/di/tokens.ts` -- new DI token
- TASK_2025_137 (Intelligent Prompt Generation System) -- establishes the Enhanced Prompts system

---

## Out of Scope

- Changing the `PromptDesignerAgent` LLM generation logic (only its input changes)
- Modifying agent template scoring algorithms (only their data source changes)
- Frontend wizard UI changes (only the backend data provider changes)
- Real-time file watching push notifications (invalidation is pull-based via TTL + manual trigger)

---

## Success Metrics

1. **Zero duplicate detection**: No framework/build-tool/testing regex in Enhanced Prompts or Agent Generation
2. **Single workspace analysis call**: Both consumers call `getProjectIntelligence()` once each
3. **Consistent types**: All consumers use enum-based types from workspace-intelligence
4. **Net line reduction**: ~300+ lines removed across Enhanced Prompts and Agent Generation
5. **All existing tests pass**: No regression in workspace analysis accuracy
