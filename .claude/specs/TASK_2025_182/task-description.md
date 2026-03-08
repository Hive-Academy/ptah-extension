# Requirements Document - TASK_2025_182

# Deep Tree-Sitter Integration for AI Context Pipeline

## Introduction

Ptah's workspace-intelligence library contains a mature tree-sitter foundation (parser service, AST analysis service, S-expression queries for JS/TS) that is currently isolated from the core AI context pipeline. The tree-sitter capabilities are exposed only through the MCP `ptah.ast.*` namespace and are never invoked during the critical path of context building, file relevance scoring, or token optimization.

This creates a significant gap: when Ptah selects files for AI context, it relies exclusively on path-based heuristics and raw token counting. It has no awareness of what symbols a file exports, what dependencies it imports, or how its code is structured. The result is suboptimal context selection -- files are included or excluded based on filename patterns rather than semantic content, and full file contents are sent to LLMs even when only function signatures would suffice.

This task weaves tree-sitter into the core context pipeline to achieve:

- **40-60% token reduction** by sending structural outlines instead of full file contents for peripheral context files
- **Semantic file ranking** that understands which files export the symbols a query references
- **Dependency-aware context** that automatically includes files a target file depends on
- **Real-time code understanding** through incremental parsing on file edits

### Business Value

- Reduced API costs through smaller, smarter context windows
- Higher quality AI responses from better-targeted context selection
- Faster response times from reduced token processing
- Foundation for future features (refactoring support, symbol search, intelligent navigation)

## Scope

### In Scope

1. **Context Enrichment Service** - New service that generates structural file summaries (function signatures, class outlines, import lists) as an alternative to full file content
2. **Symbol-Aware Relevance Scoring** - Enhancement to `FileRelevanceScorerService` to incorporate export/import symbol matching
3. **File Dependency Graph** - New service that builds and caches import-based dependency graphs from tree-sitter import queries
4. **Incremental Parsing** - Enhancement to `TreeSitterParserService` to support tree-sitter's `edit()` + incremental `parse()` API
5. **Integration Points** - Wiring tree-sitter data into `ContextSizeOptimizerService` and `ContextOrchestrationService`

### Out of Scope

- Adding support for languages beyond JavaScript/TypeScript (can be done as a follow-up)
- Changes to the frontend/webview UI
- Changes to the MCP tool interface in vscode-lm-tools (existing `ptah.ast.*` remains as-is)
- Cross-workspace or multi-root dependency resolution
- Type-level analysis (only structural AST, not TypeScript type checking)
- Backward compatibility layers or versioned APIs -- all changes are direct replacements

## Requirements

### Requirement 0: Stub & Dead Code Cleanup (Prerequisite)

**User Story:** As a developer building on top of tree-sitter services, I want all stale stubs, misleading comments, and dead code paths removed so that the foundation is trustworthy and functional before new features are layered on top.

#### Issues Found (Audit)

1. **Stale "Phase 2 stub" comments in `WorkspaceAnalyzerService.extractCodeInsights()`** — The method at `workspace-analyzer.service.ts:358` has 3 comments claiming it returns "empty insights (stub)" (lines 342, 386, 407), but `AstAnalysisService.analyzeAst()` does REAL traversal and returns actual `CodeInsights`. The comments are lies from the original stub era.

2. **`extractCodeInsights()` is never called** — No app code, no RPC handler, no other service invokes this method. It exists only in its definition and its test file. Tree-sitter analysis works but nobody uses it at runtime.

3. **`extractCodeInsights()` uses the weaker `analyzeAst()` path** — Line 393 calls `this.astAnalyzer.analyzeAst(astValue, filePath)` (traversal-based fallback) instead of `analyzeSource(content, language, filePath)` (query-based preferred method). The method first parses to AST, then traverses it — but `analyzeSource()` goes directly through tree-sitter queries, which is faster and more accurate.

4. **Stale "Phase 2: RooCode migration" labels** — `di/register.ts:63,166` and `index.ts:100` have outdated phase labels from the original code migration that should be cleaned up.

#### Acceptance Criteria

1. WHEN the cleanup is complete THEN all "Phase 2 stub", "Phase 2: RooCode migration", and "Phase 3 Integration" comments SHALL be removed or replaced with accurate descriptions of what the code actually does
2. WHEN `extractCodeInsights()` is updated THEN it SHALL use `analyzeSource(content, language, filePath)` instead of the `parse()` + `analyzeAst()` two-step path
3. WHEN the cleanup is complete THEN the misleading log message `"Phase 2 stub (empty insights)"` SHALL be replaced with an accurate log reflecting the real operation
4. WHEN DI registration comments are updated THEN they SHALL use a neutral label like "AST Analysis Services" instead of "Phase 2: RooCode migration"

#### Technical Notes

- Files to modify: `workspace-analyzer.service.ts`, `di/register.ts`, `index.ts`
- This is a prerequisite for all other requirements — must be completed first in Batch 1
- No new services, no new files — purely cleanup of existing code

### Requirement 1: Context Enrichment Service

**User Story:** As an AI context pipeline, I want to generate structural file summaries (function signatures, class outlines, imports/exports) instead of sending full file contents, so that token usage is reduced by 40-60% while preserving semantic understanding for the LLM.

#### Acceptance Criteria

1. WHEN a file is selected for context AND the file language is supported (JS/TS) THEN the system SHALL be able to produce a structural summary containing: exported function signatures (name, parameters, return type annotation if present), class outlines (name, method signatures, heritage), import list, and export list
2. WHEN a structural summary is generated THEN the summary token count SHALL be at most 60% of the full file token count for files over 100 lines, verified by `TokenCounterService`
3. WHEN a file is not in a supported language THEN the system SHALL fall back to returning the full file content unchanged
4. WHEN tree-sitter parsing fails for a supported file THEN the system SHALL log the error, fall back to full file content, and not interrupt the context pipeline
5. WHEN the enrichment service is called THEN it SHALL use `AstAnalysisService.analyzeSource()` (which already extracts `CodeInsights` via tree-sitter queries) to obtain function, class, import, and export data
6. WHEN generating a summary THEN the service SHALL format the output as a human-readable code skeleton (preserving original formatting of signatures where possible) that an LLM can understand as file structure

#### Technical Notes

- Create `ContextEnrichmentService` in `libs/backend/workspace-intelligence/src/context-analysis/`
- Depends on: `AstAnalysisService`, `TreeSitterParserService`, `TokenCounterService`, `FileSystemService`
- The `CodeInsights` interface already provides `FunctionInfo[]`, `ClassInfo[]`, `ImportInfo[]`, `ExportInfo[]` -- this service consumes those
- Summary format should resemble a TypeScript declaration file (`.d.ts` style) for maximum LLM comprehension
- Must handle edge cases: empty files, files with only imports, files with only type exports

### Requirement 2: Symbol-Aware File Relevance Scoring

**User Story:** As the file relevance scoring system, I want to match user query terms against actual exported symbols in files (not just file paths), so that files exporting symbols matching the query are ranked significantly higher than files that merely have matching path names.

#### Acceptance Criteria

1. WHEN a user query contains terms that match exported symbol names in a file THEN the file's relevance score SHALL receive a bonus of +15 per matched export symbol (compared to +5 for path match and +10 for filename match in the current system)
2. WHEN a user query mentions a class name THEN files that export that class SHALL be ranked in the top 3 results, regardless of file path
3. WHEN symbol data is not available for a file (unsupported language, parse failure) THEN the scorer SHALL fall back to existing path-based heuristics with no degradation in current behavior
4. WHEN scoring files THEN the symbol lookup SHALL complete within 50ms per file on average (using cached AST data), so that scoring 500 files completes in under 25 seconds total
5. WHEN the scorer is initialized THEN it SHALL accept an optional symbol index (pre-computed map of file path to exported symbols) to avoid re-parsing files during scoring
6. WHEN a file exports a symbol that is imported by the file currently being edited THEN that file SHALL receive an additional relevance bonus of +10

#### Technical Notes

- Enhance `FileRelevanceScorerService` to accept an optional `SymbolIndex` (Map<string, ExportInfo[]>)
- Add new scoring method `scoreBySymbols()` alongside existing `scoreByLanguagePattern()`, `scoreByFrameworkPattern()`, `scoreByTaskPattern()`
- The `SymbolIndex` will be built by the Dependency Graph service (Requirement 3) and passed in
- `ExportInfo` already captures: name, kind (function/class/variable/type/interface), isDefault, isReExport, source

### Requirement 3: File Dependency Graph

**User Story:** As the context selection system, I want to build an import-based dependency graph for workspace files, so that when a file is selected for context, its direct dependencies (and optionally transitive dependencies) are automatically included for complete understanding.

#### Acceptance Criteria

1. WHEN the dependency graph is built THEN it SHALL map each parsed file to its list of import sources (resolved to workspace-relative paths where possible), using `TreeSitterParserService.queryImports()`
2. WHEN a file's dependencies are requested THEN the system SHALL return direct dependencies (depth 1) by default, with an option to request transitive dependencies up to a configurable depth (default max: 3)
3. WHEN an import source is a relative path (e.g., `./utils`, `../shared/types`) THEN the resolver SHALL resolve it to an actual workspace file path, checking for `.ts`, `.tsx`, `.js`, `.jsx`, and `/index.ts` variants
4. WHEN an import source is a package name (e.g., `@ptah-extension/shared`, `tsyringe`) THEN it SHALL be recorded but not resolved to a file path (external dependency)
5. WHEN the dependency graph is built for a workspace THEN it SHALL also produce a reverse dependency map (dependents: "which files import this file"), enabling "find all usages" scenarios
6. WHEN a file is modified THEN the dependency graph for that file SHALL be invalidated and lazily rebuilt on next access, not eagerly (to avoid performance overhead)
7. WHEN building the full workspace graph THEN the build time SHALL be under 10 seconds for 500 TS/JS files, leveraging parser caching in `TreeSitterParserService`
8. WHEN a file has circular imports THEN the graph traversal SHALL detect cycles and terminate, returning the non-circular portion of the dependency chain

#### Technical Notes

- Create `DependencyGraphService` in `libs/backend/workspace-intelligence/src/ast/`
- Data structures: `FileNode { path, imports: ImportInfo[], exports: ExportInfo[] }`, `DependencyGraph { nodes: Map<string, FileNode>, edges: Map<string, Set<string>>, reverseEdges: Map<string, Set<string>> }`
- Import resolution must handle TypeScript path aliases from `tsconfig.json` paths (read `compilerOptions.paths` from workspace tsconfig)
- The graph doubles as the `SymbolIndex` needed by Requirement 2 (export data is captured per file)
- Cache the graph in memory with file-level invalidation via VS Code `FileSystemWatcher`

### Requirement 4: Incremental Parsing

**User Story:** As the tree-sitter parser service, I want to support incremental re-parsing when a file is edited, so that only the changed portion of the AST is re-parsed (O(log n) instead of O(n)), enabling real-time code understanding during active editing.

#### Acceptance Criteria

1. WHEN a file that was previously parsed is edited THEN the parser SHALL use tree-sitter's `Tree.edit()` API to apply the edit delta, followed by `Parser.parse(newContent, oldTree)` for incremental parsing
2. WHEN incremental parsing is used THEN the re-parse time SHALL be under 5ms for single-line edits on files up to 10,000 lines (verified by benchmarking)
3. WHEN a previously parsed tree is not available (first parse, cache eviction) THEN the parser SHALL perform a full parse and cache the resulting tree for future incremental updates
4. WHEN the tree cache exceeds 100 entries THEN the least recently used trees SHALL be evicted using LRU policy
5. WHEN the `TreeSitterParserService` receives an edit event THEN it SHALL accept an `EditDelta` containing: startIndex, oldEndIndex, newEndIndex, startPosition, oldEndPosition, newEndPosition (matching tree-sitter's `edit()` API)
6. WHEN a VS Code `onDidChangeTextDocument` event fires THEN the integration layer SHALL convert the VS Code change event into the `EditDelta` format and call the incremental parse method

#### Technical Notes

- Enhance `TreeSitterParserService` with: `parseIncremental(content, language, editDelta)` method, `TreeCache` (Map<string, { tree: TreeSitterTree, language: SupportedLanguage, lastAccessed: number }>)
- The tree-sitter npm package's `Tree` object has an `.edit()` method that takes `{ startIndex, oldEndIndex, newEndIndex, startPosition, oldEndPosition, newEndPosition }`
- After `tree.edit(delta)`, calling `parser.parse(newContent, editedTree)` produces an incrementally updated tree
- The VS Code `TextDocumentChangeEvent` provides `contentChanges[]` with `range`, `rangeOffset`, `rangeLength`, and `text` -- these must be converted to tree-sitter's edit format
- The integration point (event listener) belongs in `apps/ptah-extension-vscode`, not in the library

### Requirement 5: Context Pipeline Integration

**User Story:** As the context optimization pipeline, I want to leverage structural summaries and dependency data when building AI context, so that the selected context is both smaller (fewer tokens) and more complete (includes dependencies).

#### Acceptance Criteria

1. WHEN `ContextSizeOptimizerService.optimizeContext()` is called THEN it SHALL support a new optimization mode `structural` (alongside the existing `full` mode) that uses `ContextEnrichmentService` to include structural summaries for lower-relevance files while keeping full content for high-relevance files
2. WHEN the `structural` mode is active THEN files ranked in the top 20% by relevance score SHALL include full content, while files ranked 20-100% SHALL include structural summaries only
3. WHEN the `structural` mode produces a context THEN the total token count SHALL be at least 30% lower than the `full` mode for the same file set, on a workspace with 100+ TS/JS files
4. WHEN a file is selected for context THEN the optimizer SHALL optionally include that file's direct dependencies (from `DependencyGraphService`) within the remaining token budget, prioritized by relevance score
5. WHEN dependency inclusion would exceed the token budget THEN dependencies SHALL be included as structural summaries rather than full content, and SHALL be omitted entirely if even summaries exceed the budget
6. WHEN the `OptimizedContext` result is returned THEN it SHALL include a new `contextMode` field indicating whether each file was included as `full`, `structural`, or `dependency`

#### Technical Notes

- Extend `ContextSizeOptimizerService` with a new method `optimizeContextWithStructure()` or add an options parameter to the existing `optimizeContext()` method
- Extend `OptimizedContext` interface: add `fileContextModes: Map<string, 'full' | 'structural' | 'dependency'>`
- The greedy algorithm currently iterates ranked files and adds them if they fit the budget -- enhance to: (1) add top files as full content, (2) add remaining files as structural summaries, (3) add dependency files as structural summaries
- Wire into `ContextOrchestrationService` so the enhanced optimization is used when available

## Non-Functional Requirements

### Performance Requirements

- **Structural Summary Generation**: 95% of files summarized in under 20ms each (leveraging cached parser instances)
- **Symbol Scoring**: 500 files scored against a query in under 25 seconds total (50ms average per file)
- **Dependency Graph Build**: Full workspace graph for 500 files built in under 10 seconds
- **Incremental Parse**: Single-line edit re-parsed in under 5ms for files up to 10,000 lines
- **Memory**: Dependency graph + tree cache for 500-file workspace SHALL use under 50MB additional memory

### Reliability Requirements

- **Graceful Degradation**: Every tree-sitter operation must have a fallback path. If parsing fails, the system continues with path-based heuristics and full file content. No tree-sitter failure should block the context pipeline.
- **Error Isolation**: Parse errors for individual files must not propagate to other files or crash the service
- **Cache Consistency**: File modifications must invalidate relevant caches (tree cache, dependency graph node, symbol index entry)

### Scalability Requirements

- **File Count**: All services must handle workspaces with up to 2,000 JS/TS files without degradation
- **Monorepo Support**: Dependency graph must handle Nx monorepo structure (12+ libraries with cross-library imports via path aliases)

### Maintainability Requirements

- **DI Registration**: All new services registered in workspace-intelligence DI container
- **Public API**: All new services exported from `libs/backend/workspace-intelligence/src/index.ts`
- **Testing**: Minimum 80% code coverage for all new services, with unit tests for each acceptance criterion
- **Documentation**: Each new service file includes JSDoc class-level documentation matching existing codebase patterns

## Stakeholder Analysis

### Primary Stakeholders

| Stakeholder                    | Impact Level | Involvement          | Success Criteria                                                             |
| ------------------------------ | ------------ | -------------------- | ---------------------------------------------------------------------------- |
| AI Context Pipeline (internal) | High         | Consumer             | 30%+ token reduction with structural mode; no degradation in context quality |
| End Users (extension users)    | High         | Indirect beneficiary | Faster, cheaper AI responses with better understanding of their code         |
| Development Team               | Medium       | Implementation       | Clean service boundaries, testable code, follows existing DI patterns        |

### Secondary Stakeholders

| Stakeholder           | Impact Level | Involvement     | Success Criteria                               |
| --------------------- | ------------ | --------------- | ---------------------------------------------- |
| MCP Tool Consumers    | Low          | Future consumer | New services available for future MCP exposure |
| Agent SDK Integration | Low          | Future consumer | Structural summaries usable as agent context   |

## Risk Assessment

| Risk                                                                                   | Probability | Impact | Score | Mitigation Strategy                                                                                                                               |
| -------------------------------------------------------------------------------------- | ----------- | ------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| tree-sitter native module crashes on some platforms                                    | Medium      | High   | 6     | Every call path has a try/catch with fallback to non-AST behavior; parser is already proven working in production                                 |
| Import path resolution is incomplete (path aliases, barrel files, conditional exports) | High        | Medium | 6     | Start with relative path resolution + explicit tsconfig paths; log unresolved imports for iteration; accept partial graph as better than no graph |
| Performance regression in context pipeline from added AST processing                   | Medium      | High   | 6     | All AST operations are opt-in (new optimization mode); existing `full` mode unchanged; benchmarks required before merge                           |
| Tree cache memory pressure in large workspaces                                         | Medium      | Medium | 4     | LRU eviction with configurable max size (default 100 trees); monitor memory usage in telemetry                                                    |
| Incremental parsing complexity introduces bugs                                         | Medium      | Medium | 4     | Incremental parsing is lowest priority; can ship other features without it; comprehensive test suite for edit delta conversion                    |

## Priority and Phasing

### Phase 0 (Prerequisite, Ship First)

**Requirement 0 (Stub & Dead Code Cleanup)**

- Remove misleading stubs/comments that could confuse developers building on top
- Fix `extractCodeInsights()` to use the correct query-based analysis path
- Clean foundation before layering new features

### Phase 1 (Highest Value)

**Requirements 1 + 5 (Context Enrichment + Pipeline Integration)**

- Immediate token savings (40-60% for structural summaries)
- Directly improves user experience (smaller, faster AI context)
- Builds on existing `AstAnalysisService` with minimal new infrastructure

### Phase 2 (High Value)

**Requirement 3 (Dependency Graph)**

- Enables smarter context selection (include what a file depends on)
- Produces the `SymbolIndex` needed by Requirement 2
- Most complex new infrastructure but high long-term value

### Phase 3 (Medium Value)

**Requirement 2 (Symbol-Aware Scoring)**

- Depends on Phase 2's `SymbolIndex`
- Improves ranking accuracy for symbol-specific queries
- Enhancement to existing service (lower risk)

### Phase 4 (Lower Priority, Can Defer)

**Requirement 4 (Incremental Parsing)**

- Performance optimization for real-time editing scenarios
- Not needed for batch context building (the primary use case)
- Can be added later without affecting other features
- Requires integration work in the VS Code app layer

## Dependencies

### Internal Dependencies

- `TreeSitterParserService` (existing, stable) -- core parser for all new services
- `AstAnalysisService` (existing, stable) -- provides `CodeInsights` extraction
- `TokenCounterService` (existing, stable) -- validates token reduction claims
- `FileSystemService` (existing, stable) -- reads file contents for parsing
- `FileRelevanceScorerService` (existing, to be enhanced) -- target for symbol scoring
- `ContextSizeOptimizerService` (existing, to be enhanced) -- target for structural mode
- `ContextOrchestrationService` (existing, to be enhanced) -- wiring point for new capabilities

### External Dependencies

- `tree-sitter` npm package (^0.21.1) -- already in dependencies
- `tree-sitter-javascript` (^0.21.4) -- already in dependencies
- `tree-sitter-typescript` (^0.21.2) -- already in dependencies
- No new external dependencies required

## Task Classification

- **Domain**: FEATURE
- **Priority**: P1-High (directly reduces API costs and improves AI response quality)
- **Complexity**: XL (4 requirements, multiple service enhancements, new infrastructure)
- **Estimated Effort**: 4-6 developer phases across architect + developers + QA
