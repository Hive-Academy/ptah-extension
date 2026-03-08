# Development Tasks - TASK_2025_182

**Total Tasks**: 17 | **Batches**: 6 | **Status**: 6/6 complete

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- `AstAnalysisService.analyzeSource(content, language, filePath)` exists at line 85 of ast-analysis.service.ts, returns `Result<CodeInsights, Error>` (synchronous)
- `TreeSitterParserService.parse()` at line 347, `queryImports()` at line 536, `queryExports()` at line 548 -- all verified
- All interfaces (`CodeInsights`, `FunctionInfo`, `ClassInfo`, `ImportInfo`, `ExportInfo`) verified in ast-analysis.interfaces.ts
- DI pattern: `@injectable()` + `@inject(TOKENS.X)` for cross-library, direct class injection for intra-library -- verified across all services
- Token pattern: `Symbol.for('Name')` in vscode-core tokens.ts -- verified
- Registration pattern: `container.registerSingleton(TOKEN, Class)` in register.ts -- verified
- `ContextSizeOptimizerService` injects `FileRelevanceScorerService` directly (no token) -- verified at line 108
- Stale "Phase 2 stub" comments confirmed at workspace-analyzer.service.ts lines 342, 386, 407

### Risks Identified

| Risk                                                             | Severity | Mitigation                                                                   |
| ---------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------- |
| Import path resolution incomplete (tsconfig paths, barrel files) | MED      | Accept partial graph; log unresolved at debug level; track `unresolvedCount` |
| tree-sitter `Tree.edit()` API not typed in local interfaces      | LOW      | Extend internal interface; verify at runtime; fallback to full parse         |
| ContextSizeOptimizer structural mode regression                  | MED      | Keep `full` mode path identical; structural is new code path only            |
| DependencyGraphService optional injection in optimizer           | LOW      | Use `@inject()` + `@optional()` pattern; null-check before use               |

### Edge Cases to Handle

- [ ] Empty files in ContextEnrichmentService -> Task 1.1
- [ ] Files with only imports (no exports/functions/classes) -> Task 1.1
- [ ] Circular imports in DependencyGraphService -> Task 3.1
- [ ] Unsupported language fallback in all AST consumers -> Tasks 1.1, 2.1
- [ ] Parse failures graceful degradation -> Tasks 1.1, 2.1, 3.1

---

## Batch 0: Foundation Cleanup (Phase 0) -- COMPLETE

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: None
**Commit**: 4eeec977

### Task 0.1: Fix extractCodeInsights() in WorkspaceAnalyzerService -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\composite\workspace-analyzer.service.ts`
**Spec Reference**: implementation-plan.md: Phase 0, Component "WorkspaceAnalyzerService Cleanup"
**Pattern to Follow**: `AstAnalysisService.analyzeSource()` at ast-analysis.service.ts:85-146

**Quality Requirements**:

- Replace the `parse()` + `analyzeAst()` two-step path with direct `analyzeSource(content, language, filePath)` call
- Remove all stale "Phase 2" comments (lines 342, 386, 407 area)
- Replace misleading log "Phase 2 stub (empty insights)" with accurate log "Code insights extracted successfully"
- Update JSDoc on `extractCodeInsights()` to describe actual behavior (query-based AST analysis via AstAnalysisService)
- Method still returns `Promise<CodeInsights | null>` with same error handling pattern

**Implementation Details**:

- Remove `this.treeSitterParser.parse(content, language)` call -- no longer needed
- Remove `this.astAnalyzer.analyzeAst(astValue, filePath)` call
- Replace with: `const insightsResult = this.astAnalyzer.analyzeSource(content, language, filePath);`
- Note: `analyzeSource()` is synchronous (returns `Result<CodeInsights, Error>`), but the method can remain async for the `readFile` call
- The `treeSitterParser` field can remain in the constructor since other code may reference it

---

### Task 0.2: Clean DI Registration Labels -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\di\register.ts`
**Spec Reference**: implementation-plan.md: Phase 0, Component "DI Registration Cleanup"

**Quality Requirements**:

- Replace "Tier 6: AST services (Phase 2: RooCode migration)" with "Tier 6: AST Analysis Services" (appears at line 63 comment and line 166 section header)
- No functional changes to registration code

**Implementation Details**:

- Line 63: Update tier comment in the header documentation
- Line 166: Update section comment before AST service registrations

---

### Task 0.3: Clean Index.ts Labels -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\index.ts`
**Spec Reference**: implementation-plan.md: Phase 0, Component "Index.ts Cleanup"

**Quality Requirements**:

- Replace "AST services (Phase 2: RooCode migration)" with "AST Analysis Services" (line 100)
- No functional changes to exports

**Implementation Details**:

- Line 100: Update section comment before AST service exports

---

**Batch 0 Verification**:

- All files exist at paths
- Build passes: `npx nx build workspace-intelligence`
- code-logic-reviewer approved
- No stale "Phase 2 stub" or "Phase 2: RooCode migration" strings remain in modified files

---

## Batch 1: Context Enrichment Service (Phase 1a) -- COMPLETE

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batch 0
**Commit**: 53e11af8

### Task 1.1: Create ContextEnrichmentService -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\context-analysis\context-enrichment.service.ts` (CREATE)
**Spec Reference**: implementation-plan.md: Phase 1, Component 1 "ContextEnrichmentService (NEW)"
**Pattern to Follow**: `AstAnalysisService` at ast-analysis.service.ts:69-74 (injectable pattern); `ContextSizeOptimizerService` at context-size-optimizer.service.ts:105-110 (constructor injection pattern)

**Quality Requirements**:

- Export `StructuralSummaryResult` interface with fields: content, mode ('structural'|'full'), tokenCount, originalTokenCount, reductionPercentage
- `generateStructuralSummary(filePath, language, fullContent?)` returns `Promise<StructuralSummaryResult>`
- `formatAsDeclaration(insights, filePath)` returns `string` -- pure function, no I/O
- Unsupported language (undefined) returns full content with mode='full'
- Parse failure falls back to full content with error logged
- Empty files return minimal summary header
- Files with only imports handled gracefully
- Summary token count must be at most 60% of full content for files over 100 lines
- Output format resembles .d.ts style declaration

**Implementation Details**:

- Imports: `injectable`, `inject` from tsyringe; `TOKENS`, `Logger` from vscode-core; `AstAnalysisService`, `CodeInsights`, `FunctionInfo`, `ClassInfo`, `ImportInfo`, `ExportInfo` from ast interfaces; `TokenCounterService`, `FileSystemService`; `SupportedLanguage` from ast.types
- Constructor: `AstAnalysisService` (direct), `TokenCounterService` (direct), `FileSystemService` (direct), `@inject(TOKENS.LOGGER) Logger`
- `generateStructuralSummary`: read file if content not provided, call `astAnalysis.analyzeSource()`, handle Result, call `formatAsDeclaration`, count tokens for both, return StructuralSummaryResult
- `formatAsDeclaration`: produce header comment with stats, list all imports verbatim, format class outlines with method signatures only (no bodies), format exported functions as signatures, list re-exports
- Format rules: `[export] [async] function name(params): returnType;`, class with method signatures, imports listed verbatim

**Validation Notes**:

- `AstAnalysisService.analyzeSource()` returns `Result<CodeInsights, Error>` (synchronous)
- `TokenCounterService.countTokens(text)` is async (returns Promise<number>)
- `FileSystemService.readFile(uri)` is async, takes vscode.Uri
- Edge cases: empty file, only-imports file, only-type-exports file, parse failure

---

### Task 1.2: Add DI Tokens for New Services -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\di\tokens.ts`
**Spec Reference**: implementation-plan.md: DI Registration section
**Pattern to Follow**: Existing tokens like `TREE_SITTER_PARSER_SERVICE` at tokens.ts:108-109

**Quality Requirements**:

- Add `CONTEXT_ENRICHMENT_SERVICE = Symbol.for('ContextEnrichmentService')` in "Workspace Intelligence Service Tokens" section
- Add `DEPENDENCY_GRAPH_SERVICE = Symbol.for('DependencyGraphService')` in same section
- Add both to the `TOKENS` export object in the Workspace Intelligence section

**Implementation Details**:

- Add standalone const exports after `COMMAND_DISCOVERY_SERVICE` line 111
- Add to TOKENS object in Workspace Intelligence section after `COMMAND_DISCOVERY_SERVICE` line 354

---

### Task 1.3: Register ContextEnrichmentService and Update Exports -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\di\register.ts` (MODIFY)
**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\index.ts` (MODIFY)
**Spec Reference**: implementation-plan.md: DI Registration and Public Exports sections

**Quality Requirements**:

- Import ContextEnrichmentService in register.ts
- Register after Tier 5 (Context services) since it depends on AST + Token services: `container.registerSingleton(TOKENS.CONTEXT_ENRICHMENT_SERVICE, ContextEnrichmentService)`
- Add to service list in log statement
- Export ContextEnrichmentService and StructuralSummaryResult type from index.ts

**Implementation Details**:

- register.ts: Add import for ContextEnrichmentService from '../context-analysis/context-enrichment.service'
- register.ts: Add registration after context services section (new subsection comment)
- index.ts: Add export block for context enrichment service and type
- Note: DependencyGraphService registration deferred to Batch 3

---

**Batch 1 Verification**:

- context-enrichment.service.ts exists with real implementation
- New tokens exist in tokens.ts
- DI registration added in register.ts
- Public exports added in index.ts
- Build passes: `npx nx build workspace-intelligence`
- code-logic-reviewer approved

---

## Batch 2: Pipeline Integration (Phase 1b) -- COMPLETE

**Developer**: backend-developer
**Tasks**: 1 | **Dependencies**: Batch 1
**Commit**: 624870e1

### Task 2.1: Add Structural Mode to ContextSizeOptimizerService -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\context-analysis\context-size-optimizer.service.ts`
**Spec Reference**: implementation-plan.md: Phase 1, Components 2-3 "OptimizedContext Extension" + "ContextSizeOptimizerService Enhancement"
**Pattern to Follow**: Existing `optimizeContext()` at context-size-optimizer.service.ts:118-187

**Quality Requirements**:

- Add `FileContextMode` type: `'full' | 'structural' | 'dependency'`
- Extend `ContextOptimizationRequest` with optional `mode?: 'full' | 'structural'`
- Extend `OptimizedContext` with optional `fileContextModes?: Map<string, FileContextMode>`
- Add `ContextEnrichmentService` as constructor dependency (direct injection)
- Add optional `DependencyGraphService` via `@inject(TOKENS.DEPENDENCY_GRAPH_SERVICE) @optional()` -- null-safe usage
- When `mode` is 'full' or undefined: identical behavior to current (no regression)
- When `mode` is 'structural': top 20% by relevance get full content, remaining 80% get structural summaries, dependencies optionally included
- Structural mode must produce at least 30% fewer total tokens than full mode
- Populate `fileContextModes` map in structural mode results
- Export `FileContextMode` type from index.ts

**Implementation Details**:

- Add imports for ContextEnrichmentService, DependencyGraphService (optional)
- Constructor: add `ContextEnrichmentService` (direct), add `@inject(TOKENS.DEPENDENCY_GRAPH_SERVICE) @optional() DependencyGraphService | null`
- In `optimizeContext()`: check `request.mode`, if 'structural' run new algorithm, else existing path
- Structural algorithm: rank files, split top 20%, iterate remaining with `generateStructuralSummary()`, fill budget, optionally add dependencies
- Need to resolve language from file path for `generateStructuralSummary()` calls -- use file extension mapping
- Update index.ts to export FileContextMode

**Validation Notes**:

- `ContextEnrichmentService.generateStructuralSummary()` is async
- `DependencyGraphService` may not be registered yet (Batch 3) -- must handle null
- Must not break existing `optimizeContext()` behavior when mode is unset

---

**Batch 2 Verification**:

- context-size-optimizer.service.ts updated with structural mode
- `optimizeContext({ mode: 'full' })` produces identical results to before
- `optimizeContext({ mode: 'structural' })` produces fileContextModes map
- Build passes: `npx nx build workspace-intelligence`
- code-logic-reviewer approved

---

## Batch 3: Dependency Graph (Phase 2) -- COMPLETE

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batch 0
**Commit**: 9e85d135

### Task 3.1: Create DependencyGraphService -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\ast\dependency-graph.service.ts` (CREATE)
**Spec Reference**: implementation-plan.md: Phase 2, Component "DependencyGraphService (NEW)"
**Pattern to Follow**: `FileRelevanceScorerService` at file-relevance-scorer.service.ts:39-40 (injectable pattern)

**Quality Requirements**:

- Export interfaces: `FileNode`, `DependencyGraph`, `SymbolIndex` type
- `buildGraph(filePaths, workspaceRoot, tsconfigPaths?)` returns `Promise<DependencyGraph>`
- `getDependencies(filePath, depth?)` returns `string[]` -- depth default 1, max 3
- `getDependents(filePath)` returns `string[]`
- `getSymbolIndex()` returns `SymbolIndex` (Map<string, ExportInfo[]>)
- `invalidateFile(filePath)` removes file node and edges, marks dirty
- `isBuilt()` returns boolean
- Cycle detection during transitive traversal (visited set)
- Import resolution: relative paths with extension guessing (.ts, .tsx, .js, .jsx, /index.ts, /index.js), tsconfig paths optional, external packages recorded but not resolved
- Graph stored in memory with file-level invalidation
- Full workspace graph for 500 files under 10 seconds
- Unresolved imports logged at debug level

**Implementation Details**:

- Imports: `injectable`, `inject` from tsyringe; `TOKENS`, `Logger` from vscode-core; `TreeSitterParserService` from tree-sitter-parser.service; `FileSystemService` from services; `SupportedLanguage`, `EXTENSION_LANGUAGE_MAP` from ast types/config; `ImportInfo`, `ExportInfo` from ast-analysis.interfaces; `Result` from shared
- Constructor: `@inject(TOKENS.TREE_SITTER_PARSER_SERVICE) TreeSitterParserService`, `FileSystemService` (direct), `@inject(TOKENS.LOGGER) Logger`
- `buildGraph()`: iterate files, detect language from extension, read content, call `parserService.queryImports()` and `parserService.queryExports()`, resolve imports, build edges/reverseEdges
- Import resolution helper: `resolveImportPath(importSource, importingFilePath, workspaceRoot, tsconfigPaths?)`
- Cycle detection: `getDependencies()` with depth > 1 uses visited `Set<string>`
- `invalidateFile()`: delete from nodes, edges, reverseEdges maps; lazy rebuild not triggered until next access

**Validation Notes**:

- `TreeSitterParserService.queryImports()` returns `Result<QueryMatch[], Error>` -- need to extract ImportInfo from matches
- `TreeSitterParserService.queryExports()` returns `Result<QueryMatch[], Error>` -- need to extract ExportInfo from matches
- Alternative: use `AstAnalysisService.analyzeSource()` which already extracts ImportInfo[] and ExportInfo[] from query results -- this is simpler and avoids duplicating extraction logic
- Risk: import path resolution is inherently incomplete; accept partial graph

---

### Task 3.2: Register DependencyGraphService in DI -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\di\register.ts`
**Spec Reference**: implementation-plan.md: DI Registration section
**Dependencies**: Task 3.1, Task 1.2 (tokens already added in Batch 1)

**Quality Requirements**:

- Import DependencyGraphService
- Register after AST services (Tier 6): `container.registerSingleton(TOKENS.DEPENDENCY_GRAPH_SERVICE, DependencyGraphService)`
- Add to service list in log statement

**Implementation Details**:

- Add import for DependencyGraphService from '../ast/dependency-graph.service'
- Add registration in Tier 6 section after AstAnalysisService

---

### Task 3.3: Export DependencyGraphService from Index -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\index.ts`
**Spec Reference**: implementation-plan.md: Public Exports section

**Quality Requirements**:

- Export DependencyGraphService class
- Export types: DependencyGraph, FileNode, SymbolIndex

**Implementation Details**:

- Add export block in AST Analysis Services section

---

**Batch 3 Verification**:

- dependency-graph.service.ts exists with real implementation
- DI registration added
- Public exports added
- Build passes: `npx nx build workspace-intelligence`
- code-logic-reviewer approved
- Cycle detection works (no infinite loops)

---

## Batch 4: Symbol-Aware Scoring (Phase 3) -- COMPLETE

**Developer**: backend-developer
**Tasks**: 1 | **Dependencies**: Batch 3
**Commit**: 8d9b6038

### Task 4.1: Add Symbol Scoring to FileRelevanceScorerService -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\context-analysis\file-relevance-scorer.service.ts`
**Spec Reference**: implementation-plan.md: Phase 3, Component "FileRelevanceScorerService Enhancement"
**Pattern to Follow**: Existing `scoreByLanguagePattern()` at file-relevance-scorer.service.ts:247, `scoreByFrameworkPattern()` at line 293

**Quality Requirements**:

- Extend `scoreFile()` signature with optional `symbolIndex?: SymbolIndex` and `activeFileImports?: ImportInfo[]` parameters
- Add private `scoreBySymbols()` method following same pattern as other scoring methods
- +15 per matched export symbol (case-insensitive name contains keyword)
- +10 bonus if file exports a symbol imported by active file
- When `symbolIndex` is undefined: zero overhead (early return 0)
- Existing scoring behavior unchanged when no symbol data provided
- Update `rankFiles()` and `getTopFiles()` to accept and pass through optional parameters
- Import `SymbolIndex` type from DependencyGraphService and `ImportInfo` from ast-analysis.interfaces

**Implementation Details**:

- Add import for `SymbolIndex` from dependency-graph.service (or define inline type alias `Map<string, ExportInfo[]>`)
- Add import for `ImportInfo`, `ExportInfo` from ast-analysis.interfaces
- `scoreBySymbols()`: get exports from symbolIndex for file path, iterate keywords against export names, iterate activeFileImports against exports
- Integrate call in `scoreFile()` after step 5 (task patterns), before normalization
- `rankFiles(files, query?, symbolIndex?, activeFileImports?)` -- pass through
- `getTopFiles(files, query, limit?, symbolIndex?, activeFileImports?)` -- pass through

---

**Batch 4 Verification**:

- file-relevance-scorer.service.ts updated with symbol scoring
- Existing tests still pass (no regression when symbolIndex not provided)
- Build passes: `npx nx build workspace-intelligence`
- code-logic-reviewer approved

---

## Batch 5: Incremental Parsing (Phase 4) -- COMPLETE

**Developer**: backend-developer
**Tasks**: 1 | **Dependencies**: Batch 0
**Commit**: ebacdff2

### Task 5.1: Add Incremental Parsing to TreeSitterParserService -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\ast\tree-sitter-parser.service.ts`
**Spec Reference**: implementation-plan.md: Phase 4, Component "TreeSitterParserService Enhancement"
**Pattern to Follow**: Existing `parse()` method at tree-sitter-parser.service.ts:347-401

**Quality Requirements**:

- Extend `TreeSitterTree` interface with `edit(delta)` method
- Add `TreeSitterEditDelta` internal interface matching tree-sitter API
- Export `EditDelta` public interface for consumers
- Add `TreeCacheEntry` interface and `treeCache: Map<string, TreeCacheEntry>` property with max 100 entries
- Add `parseAndCache(filePath, content, language)` -- full parse that stores tree in cache
- Add `parseIncremental(filePath, content, language, editDelta)` -- incremental re-parse using cached tree
- Add `evictLRUTreeCache()` private method -- LRU eviction when cache exceeds 100
- Cache miss in `parseIncremental()` falls back to full parse transparently
- No impact on existing `parse()` method behavior
- Incremental re-parse under 5ms for single-line edits
- Export `EditDelta` type from index.ts

**Implementation Details**:

- Extend `TreeSitterTree` interface: add `edit(delta: TreeSitterEditDelta): void`
- Extend `TreeSitterParser` interface: add `parse(input: string, oldTree?: TreeSitterTree): TreeSitterTree` (overload with optional second arg)
- `parseAndCache()`: call existing parse logic, store raw `TreeSitterTree` in treeCache before converting to GenericAstNode, return GenericAstNode
- `parseIncremental()`: look up cached tree, if found call `tree.edit(editDelta)` then `parser.parse(content, editedTree)`, convert to GenericAstNode, update cache; if not found, fall back to `parseAndCache()`
- LRU eviction: before adding to cache, check size, evict oldest by `lastAccessed` timestamp
- Update index.ts to export EditDelta type

**Validation Notes**:

- tree-sitter npm `Tree` object has `.edit()` method -- verified in tree-sitter documentation
- `Parser.parse(content, oldTree)` accepts optional second argument for incremental parsing
- The existing `parse()` method returns `GenericAstNode` (converted from tree-sitter tree), but incremental parsing needs the raw `TreeSitterTree` -- hence separate cache

---

**Batch 5 Verification**:

- tree-sitter-parser.service.ts updated with incremental parsing support
- Existing `parse()` method behavior unchanged
- EditDelta type exported from index.ts
- Build passes: `npx nx build workspace-intelligence`
- code-logic-reviewer approved
