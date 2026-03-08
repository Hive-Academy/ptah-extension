# TASK_2025_139: Implementation Plan

## Architecture: Before & After

### Before (Current)

```
┌─────────────────────────────────────────────────────────────────────┐
│ Enhanced Prompts (agent-sdk)                                        │
│  @inject(TOKENS.WORKSPACE_ANALYZER_SERVICE)                        │
│  → calls analyzeWorkspace()                                         │
│  → buildDetectedStack() re-detects frameworks, build tools, testing │
│  → feeds PromptDesignerInput (string types)                         │
│  → PromptCacheService watches files independently                   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ Agent Generation (agent-generation)                                 │
│  @inject(TOKENS.WORKSPACE_ANALYZER_SERVICE)                        │
│  @inject(TOKENS.PROJECT_DETECTOR_SERVICE)      ← redundant         │
│  @inject(TOKENS.FRAMEWORK_DETECTOR_SERVICE)    ← redundant         │
│  @inject(TOKENS.MONOREPO_DETECTOR_SERVICE)     ← redundant         │
│  → calls 3 services independently + getProjectInfo()                │
│  → detectBuildTools(), detectTestingFrameworks(), etc. locally       │
│  → DeepProjectAnalysisService does architecture, key files, langs   │
│  → CodeHealthAnalysisService does diagnostics, conventions          │
└─────────────────────────────────────────────────────────────────────┘
```

### After (Target)

```
┌─────────────────────────────────────────────────────────────────────┐
│ workspace-intelligence                                              │
│                                                                     │
│  ProjectIntelligenceService (NEW - composite)                       │
│  ├── WorkspaceAnalyzerService (existing - core detection)           │
│  ├── BuildToolDetectorService (NEW)                                 │
│  ├── TestingFrameworkDetectorService (NEW)                          │
│  ├── PackageManagerDetectorService (NEW)                            │
│  ├── LanguageDetectorService (NEW)                                  │
│  ├── ArchitectureDetectorService (NEW - from agent-generation)      │
│  └── CodeHealthService (NEW - from agent-generation)                │
│                                                                     │
│  Returns: ProjectIntelligenceResult (comprehensive, enum-typed)     │
│  Caching: Per-workspace, 10-min TTL, manual invalidation           │
└─────────────────────────────────────────────────────────────────────┘
         │                                    │
         ▼                                    ▼
┌──────────────────────────┐     ┌──────────────────────────┐
│ Enhanced Prompts          │     │ Agent Generation          │
│ (agent-sdk)               │     │ (agent-generation)        │
│                           │     │                           │
│ @inject(PROJECT_INTEL)    │     │ @inject(PROJECT_INTEL)    │
│ → getProjectIntelligence()│     │ → getProjectIntelligence()│
│ → map to PromptDesigner   │     │ → map to AgentContext     │
│ → NO local detection      │     │ → NO local detection      │
│ → NO file watching        │     │ → thin DeepAnalysis layer │
└──────────────────────────┘     └──────────────────────────┘
```

## New DI Tokens

Add to `D:\projects\ptah-extension\libs\backend\vscode-core\src\di\tokens.ts`:

```typescript
// ========================================
// Project Intelligence Tokens (TASK_2025_139)
// ========================================
export const PROJECT_INTELLIGENCE_SERVICE = Symbol.for('ProjectIntelligenceService');
export const BUILD_TOOL_DETECTOR_SERVICE = Symbol.for('BuildToolDetectorService');
export const TESTING_FRAMEWORK_DETECTOR_SERVICE = Symbol.for('TestingFrameworkDetectorService');
export const PACKAGE_MANAGER_DETECTOR_SERVICE = Symbol.for('PackageManagerDetectorService');
export const LANGUAGE_DETECTOR_SERVICE = Symbol.for('LanguageDetectorService');
export const ARCHITECTURE_DETECTOR_SERVICE = Symbol.for('ArchitectureDetectorService');
export const CODE_HEALTH_SERVICE = Symbol.for('CodeHealthService');
```

All tokens MUST use `Symbol.for()` — never string literals (see TASK_2025_140).

## Registration Order

In `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\di\register.ts`:

```typescript
// 1. Register new detector services (no inter-dependencies)
container.registerSingleton(TOKENS.BUILD_TOOL_DETECTOR_SERVICE, BuildToolDetectorService);
container.registerSingleton(TOKENS.TESTING_FRAMEWORK_DETECTOR_SERVICE, TestingFrameworkDetectorService);
container.registerSingleton(TOKENS.PACKAGE_MANAGER_DETECTOR_SERVICE, PackageManagerDetectorService);
container.registerSingleton(TOKENS.LANGUAGE_DETECTOR_SERVICE, LanguageDetectorService);
container.registerSingleton(TOKENS.ARCHITECTURE_DETECTOR_SERVICE, ArchitectureDetectorService);
container.registerSingleton(TOKENS.CODE_HEALTH_SERVICE, CodeHealthService);

// 2. Register composite (depends on all detectors + existing WorkspaceAnalyzerService)
container.registerSingleton(TOKENS.PROJECT_INTELLIGENCE_SERVICE, ProjectIntelligenceService);
```

## Caching Strategy

```
ProjectIntelligenceService
├── In-memory Map<workspacePath, { result, timestamp }>
├── TTL: 10 minutes (configurable)
├── Invalidation: manual .invalidate(workspacePath)
└── Consumers trigger invalidation when:
    ├── User saves package.json / tsconfig.json / angular.json
    ├── User explicitly requests "Regenerate" in UI
    └── Extension reactivates (cache is in-memory only)
```

## Files Created (Batch 1)

| File                                                                                | Purpose                                       | Lines (est.) |
| ----------------------------------------------------------------------------------- | --------------------------------------------- | ------------ |
| `workspace-intelligence/src/project-analysis/build-tool-detector.service.ts`        | Detect build tools from deps + configs        | ~80          |
| `workspace-intelligence/src/project-analysis/testing-framework-detector.service.ts` | Detect testing frameworks from deps + configs | ~90          |
| `workspace-intelligence/src/project-analysis/package-manager-detector.service.ts`   | Detect package manager from lock files        | ~50          |
| `workspace-intelligence/src/project-analysis/language-detector.service.ts`          | Detect languages from project type + files    | ~80          |
| `workspace-intelligence/src/project-analysis/architecture-detector.service.ts`      | Detect architecture patterns (from agent-gen) | ~100         |
| `workspace-intelligence/src/project-analysis/code-health.service.ts`                | Code health summary (from agent-gen)          | ~80          |
| `workspace-intelligence/src/composite/project-intelligence.service.ts`              | Composite orchestrator with caching           | ~120         |

**Total new**: ~600 lines

## Files Modified (Batches 2-3)

| File                                                  | Change                                           | Lines Removed (est.) |
| ----------------------------------------------------- | ------------------------------------------------ | -------------------- |
| `agent-sdk/.../enhanced-prompts.service.ts`           | Delete `buildDetectedStack()`, local interfaces  | ~120                 |
| `agent-sdk/.../prompt-cache.service.ts`               | Remove file watcher setup                        | ~40                  |
| `agent-sdk/.../prompt-designer.types.ts`              | Update PromptDesignerInput to use enums          | ~10 (modify)         |
| `agent-generation/.../orchestrator.service.ts`        | Delete 4 detect methods, 4 injections → 1        | ~180                 |
| `agent-generation/.../deep-analysis.service.ts`       | Thin wrapper, architecture/lang/keyfiles removed | ~150                 |
| `agent-generation/.../context-mapper.service.ts`      | Simplify mapping (enum→enum, not string→enum)    | ~40                  |
| `vscode-core/src/di/tokens.ts`                        | Add 7 new tokens                                 | +14 (add)            |
| `workspace-intelligence/src/di/register.ts`           | Register 7 new services                          | +14 (add)            |
| `workspace-intelligence/src/types/workspace.types.ts` | Add enums + ProjectIntelligenceResult            | +80 (add)            |

**Total removed from consumers**: ~530 lines
**Net change**: ~600 new + 94 added - 530 removed = ~164 net lines (but vastly simpler architecture)

## Risk Assessment

| Risk                                    | Probability | Impact | Mitigation                                                                 |
| --------------------------------------- | ----------- | ------ | -------------------------------------------------------------------------- |
| Detection accuracy regression           | Medium      | Medium | Run both old and new detection in parallel during testing, compare results |
| Agent scoring changes                   | Low         | Medium | Snapshot current agent scores for test workspaces, verify after migration  |
| Performance regression (more detectors) | Low         | Low    | Parallelize detector calls, cache aggressively                             |
| workspace-intelligence grows too large  | Low         | Low    | Each detector is a small, focused service (~80 lines)                      |
