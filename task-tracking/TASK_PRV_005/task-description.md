# Task Description - TASK_PRV_005

## User Request

Week 6 Extract Workspace Intelligence - Project analysis, file indexing, context optimization

## Executive Summary

This task extracts workspace intelligence services from `apps/ptah-extension-vscode/src/services/workspace-manager.ts` (~460 lines) into a new library `libs/backend/workspace-intelligence/` following the MONSTER Extension Refactor Plan Week 6 specifications. The existing implementation provides basic project type detection and file system operations; this task will extract, enhance, and structure these capabilities into a proper domain library with advanced features for intelligent context management.

**Strategic Value**: Enables AI providers to select only relevant files for context, reducing token costs and improving response quality through intelligent workspace understanding.

---

## SMART Requirements

### Specific

Extract workspace management logic from the main extension and organize into three domain modules:

1. **Project Analysis Module** - Project type detection, framework detection, dependency analysis
2. **File Indexing Module** - Workspace indexing, ignore pattern resolution, file type classification  
3. **Context Optimization Module** - Token estimation, file relevance scoring, smart file selection

### Measurable

**Completion Criteria**:

- ✅ All workspace detection logic extracted from `workspace-manager.ts` (lines 1-460)
- ✅ Project type detection supports 5+ ecosystems: Node.js, Python, Go, Rust, Java (currently supports 8)
- ✅ Framework detection supports 3+ frameworks: React, Angular, Vue, Next.js (extend existing detection)
- ✅ Ignore pattern parser supports `.gitignore`, `.vscodeignore`, `.prettierignore` formats
- ✅ File type classifier groups files into 4+ categories: source, test, config, docs
- ✅ Context size optimizer estimates token count within ±10% accuracy
- ✅ File relevance scorer ranks files by relevance to query context
- ✅ Unit test coverage ≥80% across line/branch/function metrics
- ✅ Integration tests verify all modules work with real workspace scenarios
- ✅ Zero usage of `workspace-manager.ts` in extension after extraction

### Achievable

**Existing Foundation** (460 lines in `workspace-manager.ts`):

- ✅ Project type detection for 8+ ecosystems (Node.js, Python, Java, .NET, Rust, Go, PHP, Ruby)
- ✅ Framework detection (React, Vue, Angular, Next.js, Express, Django, Laravel, Rails)
- ✅ `package.json` parsing and dependency inspection
- ✅ Workspace folder management with VS Code API integration
- ✅ File system operations (read, write, watch)

**New Capabilities to Implement**:

- 🆕 Monorepo detection (Nx, Lerna, Rush, Turborepo)
- 🆕 Ignore pattern parser with glob matching
- 🆕 File type classification with intelligent heuristics
- 🆕 Token estimation based on file size and language
- 🆕 File relevance scoring with TF-IDF or similar algorithm
- 🆕 Context size optimization with configurable limits

**Timeline**: 3-4 days (realistic based on existing code extraction + enhancements)

### Relevant

**Business Impact**:

- **Token Cost Reduction**: Intelligent file selection reduces context size by 40-60%
- **Response Quality**: Relevant context improves AI accuracy and reduces hallucinations
- **Developer Experience**: Faster responses due to smaller context windows
- **Multi-Provider Support**: Context optimization benefits all providers (Claude CLI, VS Code LM, future providers)

**Architecture Impact**:

- **MONSTER Plan Compliance**: Completes Week 6 of backend library extraction
- **Separation of Concerns**: Removes workspace logic from extension host
- **Reusability**: Enables other extensions or tools to use workspace intelligence
- **Testability**: Domain logic in library is easier to unit test than extension code

### Time-bound

**Estimated Timeline**: **3-4 days** (72-96 hours)

**Daily Breakdown**:

- **Day 1 (8 hours)**: Extract existing workspace-manager logic + basic project type detection
  - Extract workspace folder detection, file system operations
  - Create library structure with 3 domain modules
  - Implement project type detector (leverage existing code)
  - Unit tests for project type detection

- **Day 2 (8 hours)**: Framework detection + dependency analysis
  - Extract and enhance framework detection logic
  - Implement dependency analyzer (package.json, requirements.txt, go.mod, Cargo.toml)
  - Add monorepo detection (Nx, Lerna, Rush)
  - Unit tests for framework and dependency detection

- **Day 3 (8 hours)**: File indexing with ignore patterns + file type classification
  - Implement workspace indexer with glob pattern matching
  - Create ignore pattern resolver (.gitignore, .vscodeignore, .prettierignore)
  - Build file type classifier with heuristics
  - Integration tests with real workspace scenarios

- **Day 4 (8 hours)**: Context optimization + testing + integration
  - Implement context size optimizer with token estimation
  - Build file relevance scorer (TF-IDF or keyword matching)
  - Complete test suite (≥80% coverage)
  - Integration with `ai-providers-core` for context optimization
  - Documentation for each module

**Hard Deadline**: Must complete within 2 weeks per universal constraint (buffer for unexpected issues)

---

## Acceptance Criteria (BDD Format)

### Scenario 1: Extract Workspace Manager Logic

**Given** the existing `workspace-manager.ts` contains 460 lines of workspace intelligence code  
**When** the extraction is complete  
**Then** all workspace detection logic is moved to `libs/backend/workspace-intelligence/`  
**And** the original `workspace-manager.ts` is deprecated with forwarding wrapper (if needed)  
**And** no regression in extension functionality

### Scenario 2: Project Type Detection

**Given** a workspace containing project indicator files (e.g., `package.json`, `go.mod`, `Cargo.toml`)  
**When** project type detection is invoked  
**Then** the correct project type is returned (Node.js, Python, Go, Rust, Java, etc.)  
**And** framework detection identifies specific frameworks (React, Angular, Vue, Next.js)  
**And** monorepo detection identifies Nx, Lerna, or Rush workspaces

### Scenario 3: Ignore Pattern Resolution

**Given** a workspace with `.gitignore`, `.vscodeignore`, and `.prettierignore` files  
**When** file indexing is performed  
**Then** all files matching ignore patterns are excluded from the index  
**And** nested ignore files are respected (e.g., subdirectory `.gitignore`)  
**And** glob patterns are correctly interpreted (e.g., `*.log`, `node_modules/`, `**/*.test.ts`)

### Scenario 4: File Type Classification

**Given** a workspace with mixed file types (source code, tests, configs, docs)  
**When** file type classification is performed  
**Then** files are grouped into correct categories: source, test, config, docs  
**And** language-specific heuristics are applied (e.g., `.spec.ts` is test, `tsconfig.json` is config)  
**And** ambiguous files default to "source" category

### Scenario 5: Context Size Optimization

**Given** a user query and a list of workspace files  
**When** context optimization is requested with a token budget (e.g., 100,000 tokens)  
**Then** a subset of most relevant files is selected  
**And** total estimated token count is within the budget  
**And** token estimation accuracy is within ±10% of actual token count  
**And** file relevance scores prioritize files related to the query

### Scenario 6: Integration with AI Providers

**Given** the workspace intelligence library is complete  
**When** `ai-providers-core` requests optimized context for a provider  
**Then** relevant files are returned based on provider's context window limit  
**And** file content is ready for inclusion in AI prompts  
**And** performance is acceptable (<500ms for typical workspace of 1000+ files)

### Scenario 7: Error Handling and Edge Cases

**Given** various workspace scenarios (empty workspace, permission errors, corrupted files)  
**When** workspace intelligence operations are performed  
**Then** graceful error handling occurs with meaningful error messages  
**And** partial results are returned when possible (e.g., ignore unreadable files)  
**And** no crashes or unhandled exceptions occur

---

## Risk Assessment

### Technical Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **Existing code dependencies on `workspace-manager.ts`** | HIGH | MEDIUM | Create forwarding wrapper during transition; comprehensive integration tests |
| **Ignore pattern parser complexity** | MEDIUM | MEDIUM | Use battle-tested glob library (e.g., `minimatch`, `picomatch`); reference `.gitignore` spec |
| **Token estimation accuracy** | MEDIUM | LOW | Use conservative estimates; validate against real provider token counts |
| **Performance with large workspaces** | MEDIUM | MEDIUM | Implement caching; lazy loading; debouncing for file watchers |
| **Cross-platform file system differences** | LOW | LOW | Leverage VS Code's platform-agnostic APIs; test on Windows/macOS/Linux |

### Scope Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Scope creep beyond 2-week timeline** | HIGH | Defer advanced features (e.g., machine learning relevance scoring) to future work; focus on core extraction + basic enhancements |
| **Over-engineering context optimization** | MEDIUM | Start with simple TF-IDF or keyword matching; document advanced algorithms for future iterations |
| **Integration complexity with providers** | MEDIUM | Define clear interface contracts early; use dependency injection for loose coupling |

### Dependency Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **VS Code API changes** | LOW | Use stable VS Code APIs (not proposed); abstract API calls behind interfaces |
| **Third-party library vulnerabilities** | LOW | Use well-maintained libraries (e.g., `minimatch`, `picomatch`); regular dependency audits |
| **Nx workspace configuration issues** | LOW | Follow Nx best practices; leverage existing library setup patterns |

---

## Implementation Strategy

### Phase 1: Extract (Day 1)

**Goal**: Move existing code from extension to library foundation

1. **Create library structure** with Nx generator
2. **Extract workspace folder detection** from `workspace-manager.ts`
3. **Extract file system operations** (read, write, watch)
4. **Extract project type detection** (leverage lines 18-115 of workspace-manager.ts)
5. **Create forwarding wrapper** in extension (if needed for compatibility)
6. **Unit tests** for extracted code

### Phase 2: Enhance (Days 2)

**Goal**: Add intelligent features on top of extracted foundation

1. **Framework detection** - extend existing logic (lines 23-60 of workspace-manager.ts)
2. **Dependency analyzer** - parse `package.json`, `requirements.txt`, `go.mod`, `Cargo.toml`
3. **Monorepo detection** - identify Nx, Lerna, Rush, Turborepo workspaces
4. **Ignore pattern parser** - implement `.gitignore` spec with glob matching
5. **Unit tests** for new features

### Phase 3: Optimize (Days 3-4)

**Goal**: Implement context optimization features

1. **File type classifier** - heuristics for source/test/config/docs
2. **Token estimator** - conservative estimate based on file size + language
3. **File relevance scorer** - TF-IDF or keyword matching algorithm
4. **Context size optimizer** - select files within token budget
5. **Integration tests** - real workspace scenarios
6. **Performance optimization** - caching, lazy loading
7. **Documentation** - API docs, usage examples

---

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| **Code Extraction** | 100% of workspace-manager.ts logic | Lines moved from `apps/` to `libs/` |
| **Project Type Coverage** | 5+ ecosystems | Unit tests verify detection |
| **Framework Detection** | 3+ frameworks | Integration tests with real projects |
| **Ignore Pattern Support** | 3+ ignore file types | Parser validates against spec |
| **File Classification Accuracy** | ≥90% correct categorization | Manual review of 100 sample files |
| **Token Estimation Accuracy** | ±10% of actual count | Validation against Claude API token counts |
| **Test Coverage** | ≥80% line/branch/function | Jest coverage report |
| **Performance** | <500ms for 1000+ file workspace | Benchmark tests |
| **Zero Regressions** | All existing tests pass | CI pipeline validation |

---

## Dependencies & Blockers

### Dependencies

- ✅ **TASK_PRV_001 Complete** - AI Providers Core exists and ready for integration
- ✅ **Nx Workspace Setup** - Library generation infrastructure in place
- ✅ **VS Code APIs Available** - `vscode.workspace.workspaceFolders` and file system APIs

### Blockers

- ❌ **No blockers identified** - Can proceed immediately

### Related Tasks

- **TASK_PRV_004** (Claude Domain) - Parallel extraction, no dependencies
- **TASK_PRV_002** (Provider Angular UI) - Enhanced by workspace intelligence context features
- **Future Work** - Machine learning relevance scoring, advanced optimization algorithms

---

## Technical Design Notes

### Library Structure

```typescript
libs/backend/workspace-intelligence/
├── src/
│   ├── project-analysis/
│   │   ├── project-type-detector.ts       // Extract from workspace-manager.ts
│   │   ├── framework-detector.ts          // Extract + enhance from workspace-manager.ts
│   │   ├── dependency-analyzer.ts         // NEW: Parse package managers
│   │   ├── monorepo-detector.ts           // NEW: Nx/Lerna/Rush detection
│   │   └── index.ts
│   ├── file-indexing/
│   │   ├── workspace-indexer.ts           // Extract + enhance from workspace-manager.ts
│   │   ├── ignore-pattern-resolver.ts     // NEW: .gitignore parser
│   │   ├── file-type-classifier.ts        // NEW: Intelligent classification
│   │   ├── glob-matcher.ts                // NEW: Glob pattern matching
│   │   └── index.ts
│   ├── optimization/
│   │   ├── context-size-optimizer.ts      // NEW: Token budget management
│   │   ├── token-estimator.ts             // NEW: Conservative token estimation
│   │   ├── file-relevance-scorer.ts       // NEW: TF-IDF or keyword matching
│   │   └── index.ts
│   ├── types/
│   │   ├── workspace.types.ts             // Domain types
│   │   └── index.ts
│   └── index.ts                           // Export all modules
├── project.json                           // Nx project configuration
├── tsconfig.json                          // TypeScript configuration
├── tsconfig.lib.json                      // Library-specific config
├── tsconfig.spec.json                     // Test configuration
└── README.md                              // Documentation
```

### Key Interfaces

```typescript
// Project Analysis
export interface ProjectInfo {
  type: ProjectType;
  framework?: Framework;
  dependencies: DependencyInfo[];
  isMonorepo: boolean;
  monorepoType?: MonorepoType;
}

// File Indexing
export interface FileIndex {
  files: IndexedFile[];
  ignoredPatterns: string[];
  totalFiles: number;
  totalSize: number;
}

export interface IndexedFile {
  path: string;
  relativePath: string;
  type: FileType;
  size: number;
  language?: string;
  estimatedTokens: number;
}

// Context Optimization
export interface ContextOptimizationRequest {
  query: string;
  tokenBudget: number;
  files?: string[];  // Specific files to consider
  excludePatterns?: string[];
}

export interface ContextOptimizationResult {
  selectedFiles: IndexedFile[];
  totalTokens: number;
  relevanceScores: Map<string, number>;
}
```

---

## Next Phase Recommendation

**Recommended Next Phase**: ✅ **software-architect**

**Rationale**:

1. **Requirements are clear** - Detailed extraction scope from existing code
2. **No research needed** - Working implementation exists; standard patterns apply
3. **Well-defined architecture** - Library structure and interfaces outlined above
4. **Ready for design** - Software architect can proceed with detailed implementation plan

**Skip Research Phase** - The workspace intelligence domain is well-understood:
- File system operations are standard
- Glob pattern matching has established libraries
- Token estimation can use simple heuristics
- No unknown technologies or approaches

**Architect's Focus Areas**:
- Type system design (extend existing `@ptah-extension/shared` types)
- Integration points with `ai-providers-core`
- Migration strategy from `workspace-manager.ts` to new library
- Testing strategy (unit, integration, performance)
- Error handling and graceful degradation
