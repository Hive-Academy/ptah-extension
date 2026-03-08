# Implementation Plan - TASK_2025_182

# Deep Tree-Sitter Integration for AI Context Pipeline

## Codebase Investigation Summary

### Libraries Discovered

- **workspace-intelligence** (`libs/backend/workspace-intelligence/`): Core library containing all services to be created/modified. Houses AST, context-analysis, context, composite, and services directories.

  - Documentation: `libs/backend/workspace-intelligence/CLAUDE.md`
  - DI registration: `libs/backend/workspace-intelligence/src/di/register.ts`
  - Public exports: `libs/backend/workspace-intelligence/src/index.ts`

- **vscode-core** (`libs/backend/vscode-core/`): Infrastructure layer providing DI tokens (`TOKENS` namespace), Logger, and ErrorHandler.

  - DI tokens: `libs/backend/vscode-core/src/di/tokens.ts`
  - Pattern: `Symbol.for('DescriptiveName')` for all tokens

- **shared** (`libs/shared/`): Foundation types including `Result<T, Error>`, `CorrelationId`, branded types.

### Patterns Identified

**DI Pattern** (verified across all workspace-intelligence services):

- Services use `@injectable()` decorator from tsyringe
- Constructor injection via `@inject(TOKENS.X)` for cross-library deps
- Direct class injection (no token) for intra-library deps (e.g., `ContextSizeOptimizerService` injects `FileRelevanceScorerService` directly)
- Tokens defined in `vscode-core/src/di/tokens.ts` as `Symbol.for('Name')`
- Registration in `workspace-intelligence/src/di/register.ts` via `container.registerSingleton()`
- Evidence: `di/register.ts:93-172`, `context-size-optimizer.service.ts:107-110`

**Result Pattern** (verified):

- Synchronous operations return `Result<T, Error>` (e.g., `TreeSitterParserService.parse()` at line 347)
- Async operations return `Promise<T>` or `Promise<T | null>` (e.g., `WorkspaceAnalyzerService.extractCodeInsights()` at line 358)
- Error handling: try/catch with `Result.err(new Error(...))` or null return
- Evidence: `tree-sitter-parser.service.ts:347-401`, `ast-analysis.service.ts:85-146`

**Service Documentation Pattern** (verified):

- JSDoc class-level documentation with `@module` or `@packageDocumentation`
- Method-level JSDoc with `@param`, `@returns`, `@example`
- Evidence: `file-relevance-scorer.service.ts:1-9`, `context-size-optimizer.service.ts:1-8`

**AST Analysis Pattern** (verified):

- `TreeSitterParserService` provides: `parse()`, `query()`, `queryFunctions()`, `queryClasses()`, `queryImports()`, `queryExports()`
- `AstAnalysisService.analyzeSource()` is the preferred entry point (query-based, line 85)
- `AstAnalysisService.analyzeAst()` is the fallback (traversal-based, line 156)
- Returns `CodeInsights { functions: FunctionInfo[], classes: ClassInfo[], imports: ImportInfo[], exports?: ExportInfo[] }`
- Evidence: `ast-analysis.service.ts:85-146`, `ast-analysis.interfaces.ts:1-125`

**Existing Interface Shapes** (verified):

- `FunctionInfo`: name, parameters, startLine, endLine, isExported?, isAsync? (line 4-29)
- `ClassInfo`: name, startLine, endLine, isExported?, methods? (line 34-55)
- `ImportInfo`: source, importedSymbols?, isDefault?, isNamespace? (line 60-77)
- `ExportInfo`: name, kind, isDefault?, isReExport?, source? (line 82-103)
- `IndexedFile`: path, relativePath, type, size, language?, estimatedTokens (workspace.types.ts)
- Evidence: `ast-analysis.interfaces.ts:1-125`

### Integration Points

- `ContextSizeOptimizerService` consumes `FileRelevanceScorerService` and `TokenCounterService` (line 107-110)
- `ContextOrchestrationService` consumes `ContextService` (line 216)
- `WorkspaceAnalyzerService` consumes `TreeSitterParserService` and `AstAnalysisService` via DI tokens (line 89-92)
- `FileRelevanceScorerService` is stateless, pure computation, takes `IndexedFile` and query string (line 48)

---

## Architecture Design

### Design Philosophy

**Chosen Approach**: Layered service composition following existing workspace-intelligence patterns. New services are standalone, injectable, and compose into the existing pipeline through constructor injection. No backward compatibility layers; direct enhancement of existing services.

**Rationale**: The codebase consistently uses this pattern across all 20+ services in workspace-intelligence. Every new service follows the same `@injectable()` + token + registration formula.

### Component Architecture Overview

```
Existing Services (enhanced)          New Services
================================      ================================
WorkspaceAnalyzerService              ContextEnrichmentService
  - extractCodeInsights() FIX           - generateStructuralSummary()
                                        - formatAsDeclaration()
FileRelevanceScorerService
  - scoreFile() ENHANCE               DependencyGraphService
  + scoreBySymbols() NEW                - buildGraph()
                                        - getDependencies()
ContextSizeOptimizerService             - getDependents()
  - optimizeContext() ENHANCE           - getSymbolIndex()
  + optimizeContextStructural() NEW
                                      (TreeSitterParserService ENHANCE)
ContextOrchestrationService             + parseIncremental()
  - wire new services                   + TreeCache with LRU

di/register.ts                        vscode-core/di/tokens.ts
  + register new services               + new token definitions

index.ts
  + export new services
```

### Dependency Flow

```
ContextOrchestrationService
    |
    +---> ContextSizeOptimizerService (enhanced)
    |         |
    |         +---> FileRelevanceScorerService (enhanced)
    |         |         |
    |         |         +---> SymbolIndex (from DependencyGraphService)
    |         |
    |         +---> ContextEnrichmentService (NEW)
    |         |         |
    |         |         +---> AstAnalysisService (existing)
    |         |         +---> TokenCounterService (existing)
    |         |         +---> FileSystemService (existing)
    |         |
    |         +---> DependencyGraphService (NEW)
    |                   |
    |                   +---> TreeSitterParserService (enhanced)
    |                   +---> FileSystemService (existing)
    |
    +---> ContextService (existing, unchanged)
```

---

## Phase 0: Stub & Dead Code Cleanup (Requirement 0)

### Component: WorkspaceAnalyzerService Cleanup

**Purpose**: Remove misleading stubs and switch to the correct analysis path.

**Pattern**: Direct code modification following existing service patterns.
**Evidence**: Stale comments at `workspace-analyzer.service.ts:342,386,407`; wrong method call at line 393.

**Changes**:

1. **Replace `analyzeAst()` with `analyzeSource()`** in `extractCodeInsights()` (line 358-417):

   - Remove the `parse()` + `analyzeAst()` two-step path
   - Call `this.astAnalyzer.analyzeSource(content, language, filePath)` directly
   - This eliminates the intermediate AST conversion step and uses the faster query-based path
   - `analyzeSource()` is synchronous (returns `Result<CodeInsights, Error>`), so `extractCodeInsights()` can be simplified

2. **Remove/replace stale comments**:
   - Line 342: Remove "Phase 2 Implementation: Returns empty insights (stub)"
   - Line 386: Remove "Phase 2: stub returns empty insights"
   - Line 407: Replace "Phase 2 stub (empty insights)" log with accurate description: "Code insights extracted successfully"
   - JSDoc: Update to describe actual behavior (query-based AST analysis)

**Files Affected**:

- `libs/backend/workspace-intelligence/src/composite/workspace-analyzer.service.ts` (MODIFY)

### Component: DI Registration Cleanup

**Purpose**: Remove outdated phase labels from DI registration.

**Changes**:

1. Line 63: Replace "Tier 6: AST services (Phase 2: RooCode migration)" with "Tier 6: AST Analysis Services"
2. Line 166: Same replacement in the section comment

**Files Affected**:

- `libs/backend/workspace-intelligence/src/di/register.ts` (MODIFY)

### Component: Index.ts Cleanup

**Purpose**: Remove outdated phase labels from public exports.

**Changes**:

1. Line 100: Replace "AST services (Phase 2: RooCode migration)" with "AST Analysis Services"

**Files Affected**:

- `libs/backend/workspace-intelligence/src/index.ts` (MODIFY)

---

## Phase 1: Context Enrichment + Pipeline Integration (Requirements 1 + 5)

### Component 1: ContextEnrichmentService (NEW)

**Purpose**: Generates `.d.ts`-style structural summaries of source files, reducing token usage by 40-60% while preserving semantic understanding for LLMs.

**Pattern**: Injectable service following `AstAnalysisService` pattern (same directory, same dependencies).
**Evidence**: Service pattern at `ast-analysis.service.ts:69-74`, Result pattern at line 85-146.

**File**: `libs/backend/workspace-intelligence/src/context-analysis/context-enrichment.service.ts` (CREATE)

**Constructor Dependencies**:

- `AstAnalysisService` (direct injection, intra-library)
- `TokenCounterService` (direct injection, intra-library)
- `FileSystemService` (direct injection, intra-library)
- `Logger` via `@inject(TOKENS.LOGGER)`

**Public API**:

```typescript
/**
 * Context Enrichment Service
 *
 * Generates structural file summaries (.d.ts-style) from tree-sitter AST analysis.
 * Produces function signatures, class outlines, import/export lists as compact
 * representations that reduce token usage by 40-60% while preserving semantic
 * understanding for LLMs.
 *
 * @module workspace-intelligence/context-analysis
 */
@injectable()
export class ContextEnrichmentService {
  constructor(private readonly astAnalysis: AstAnalysisService, private readonly tokenCounter: TokenCounterService, private readonly fileSystem: FileSystemService, @inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /**
   * Generate a structural summary for a file.
   * Returns the .d.ts-style summary string, or the full file content
   * if the language is unsupported or parsing fails.
   *
   * @param filePath - Absolute file path
   * @param language - Language identifier (from SupportedLanguage or undefined)
   * @param fullContent - Optional pre-read file content (avoids re-reading)
   * @returns StructuralSummaryResult with summary text and metadata
   */
  async generateStructuralSummary(filePath: string, language: SupportedLanguage | undefined, fullContent?: string): Promise<StructuralSummaryResult>;

  /**
   * Format CodeInsights as a .d.ts-style declaration string.
   * Pure function, no I/O.
   *
   * @param insights - Extracted code insights
   * @param filePath - File path (used in header comment)
   * @returns Formatted declaration string
   */
  formatAsDeclaration(insights: CodeInsights, filePath: string): string;
}
```

**Key Data Structures**:

```typescript
/** Result of structural summary generation */
export interface StructuralSummaryResult {
  /** The summary text (either structural or full content) */
  content: string;
  /** Whether this is a structural summary or full content fallback */
  mode: 'structural' | 'full';
  /** Estimated token count of the summary */
  tokenCount: number;
  /** Token count of the original full content (for comparison) */
  originalTokenCount: number;
  /** Reduction percentage (0-100) */
  reductionPercentage: number;
}
```

**Implementation Pattern** (derived from `AstAnalysisService.analyzeSource()` at line 85):

The `generateStructuralSummary` method:

1. If `language` is undefined (unsupported), return full content with `mode: 'full'`
2. Read file content if not provided via `FileSystemService.readFile()`
3. Call `AstAnalysisService.analyzeSource(content, language, filePath)`
4. If analysis fails, log error and return full content with `mode: 'full'`
5. Call `formatAsDeclaration(insights, filePath)` to produce the summary
6. Count tokens for both summary and original via `TokenCounterService`
7. Return `StructuralSummaryResult`

The `formatAsDeclaration` method produces output like:

```typescript
// Structural summary: src/services/auth.service.ts
// Functions: 5 | Classes: 1 | Imports: 8 | Exports: 4

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
// ... (all imports listed)

export class AuthService {
  login(username, password): void;
  logout(): void;
  getToken(): string;
  // ... (method signatures only)
}

export function validateToken(token): boolean;
export function refreshToken(): Promise<string>;
```

Format rules:

- Imports: listed verbatim (already compact)
- Functions: `[export] [async] function name(params): returnType;` (signature only, no body)
- Classes: class declaration with method signatures (no method bodies)
- Exports: re-exports listed verbatim
- Type annotations preserved from parameter text where available
- If `FunctionInfo.isAsync` is true, prefix with `async`
- If `FunctionInfo.isExported` is true, prefix with `export`

**Quality Requirements**:

- Structural summary token count must be at most 60% of full content for files over 100 lines
- Unsupported languages fall back to full content with no error
- Parse failures fall back to full content with error logged
- Empty files return minimal summary header

### Component 2: OptimizedContext Extension

**Purpose**: Add `contextMode` field to track how each file was included in optimized context.

**Pattern**: Interface extension following existing `OptimizedContext` at `context-size-optimizer.service.ts:43-68`.

**File**: `libs/backend/workspace-intelligence/src/context-analysis/context-size-optimizer.service.ts` (MODIFY)

**Changes to existing interfaces**:

```typescript
/** How a file was included in the optimized context */
export type FileContextMode = 'full' | 'structural' | 'dependency';

/** Extended optimization request supporting structural mode */
export interface ContextOptimizationRequest {
  // ... existing fields unchanged ...

  /**
   * Optimization mode: 'full' (default, existing behavior) or 'structural'
   * (uses ContextEnrichmentService for lower-ranked files)
   */
  readonly mode?: 'full' | 'structural';
}

/** Extended optimized context result */
export interface OptimizedContext {
  // ... existing fields unchanged ...

  /**
   * How each file was included in context.
   * Only populated when mode is 'structural'.
   */
  readonly fileContextModes?: Map<string, FileContextMode>;
}
```

### Component 3: ContextSizeOptimizerService Enhancement

**Purpose**: Add `structural` optimization mode that uses `ContextEnrichmentService` for lower-ranked files.

**Pattern**: Enhancement of existing `optimizeContext()` method at `context-size-optimizer.service.ts:118-187`.

**File**: `libs/backend/workspace-intelligence/src/context-analysis/context-size-optimizer.service.ts` (MODIFY)

**Changes**:

1. **Add constructor dependency**: `ContextEnrichmentService` (direct injection)
2. **Add optional constructor dependency**: `DependencyGraphService` (injected via token, optional -- available after Phase 2)
3. **Enhance `optimizeContext()`**: When `request.mode === 'structural'`:
   - Rank files as before
   - Top 20% by rank: include as full content (`mode: 'full'`)
   - Remaining 80%: call `ContextEnrichmentService.generateStructuralSummary()` and include summary (`mode: 'structural'`)
   - If `DependencyGraphService` is available: for each selected file, include direct dependencies within remaining token budget as structural summaries (`mode: 'dependency'`)
   - Populate `fileContextModes` map in result
   - When `request.mode` is undefined or `'full'`: existing behavior unchanged

**Algorithm for structural mode**:

```
1. Rank files by relevance (existing)
2. Split: top20 = first 20%, rest = remaining 80%
3. For each file in top20:
   - Add full content if within budget
   - Record mode='full'
4. For each file in rest (by relevance descending):
   - Generate structural summary
   - Add summary if within budget
   - Record mode='structural'
5. (Optional, if DependencyGraphService available):
   For each file in top20:
     - Get direct dependencies from graph
     - For each dependency not already included:
       - Generate structural summary
       - Add if within budget
       - Record mode='dependency'
6. Return OptimizedContext with fileContextModes
```

**Quality Requirements**:

- `structural` mode must produce at least 30% fewer total tokens than `full` mode for same file set
- When `mode` is `'full'` or undefined, behavior is identical to current (no regression)
- `DependencyGraphService` is optional; if not registered, dependency inclusion is skipped

### Component 4: ContextOrchestrationService Wiring

**Purpose**: Wire the enhanced optimization into the orchestration layer so callers can use structural mode.

**File**: `libs/backend/workspace-intelligence/src/context/context-orchestration.service.ts` (MODIFY)

**Changes**: Minimal -- the orchestration service delegates to `ContextService` which does not currently use `ContextSizeOptimizerService`. The wiring point is that `ContextSizeOptimizerService` is already independently injectable and used directly by consumers. No changes needed to `ContextOrchestrationService` in this phase; consumers call `ContextSizeOptimizerService.optimizeContext({ mode: 'structural' })` directly.

If future integration is needed, a convenience method can be added:

```typescript
async optimizeContextForQuery(
  files: IndexedFile[],
  query: string,
  mode: 'full' | 'structural'
): Promise<OptimizedContext>;
```

This is deferred to avoid unnecessary coupling.

---

## Phase 2: File Dependency Graph (Requirement 3)

### Component: DependencyGraphService (NEW)

**Purpose**: Builds and caches an import-based dependency graph for workspace files, enabling dependency-aware context selection and providing a `SymbolIndex` for symbol-aware scoring.

**Pattern**: Injectable service following existing workspace-intelligence service patterns.
**Evidence**: Service pattern at `file-relevance-scorer.service.ts:39-40`, token pattern at `tokens.ts:108-109`.

**File**: `libs/backend/workspace-intelligence/src/ast/dependency-graph.service.ts` (CREATE)

**Constructor Dependencies**:

- `TreeSitterParserService` via `@inject(TOKENS.TREE_SITTER_PARSER_SERVICE)`
- `FileSystemService` (direct injection)
- `Logger` via `@inject(TOKENS.LOGGER)`

**Public API**:

```typescript
/**
 * Dependency Graph Service
 *
 * Builds and caches import-based dependency graphs for workspace files using
 * tree-sitter import queries. Provides forward dependency maps (what does this
 * file import?), reverse dependency maps (what imports this file?), and a
 * symbol index (what does each file export?) for use by relevance scoring.
 *
 * @module workspace-intelligence/ast
 */
@injectable()
export class DependencyGraphService {
  constructor(
    @inject(TOKENS.TREE_SITTER_PARSER_SERVICE)
    private readonly parser: TreeSitterParserService,
    private readonly fileSystem: FileSystemService,
    @inject(TOKENS.LOGGER) private readonly logger: Logger
  ) {}

  /**
   * Build the dependency graph for a set of workspace files.
   * Parses each file's imports/exports and resolves relative paths.
   *
   * @param filePaths - Absolute paths of files to include
   * @param workspaceRoot - Workspace root for relative path resolution
   * @param tsconfigPaths - Optional tsconfig compilerOptions.paths for alias resolution
   * @returns The built dependency graph
   */
  async buildGraph(filePaths: string[], workspaceRoot: string, tsconfigPaths?: Record<string, string[]>): Promise<DependencyGraph>;

  /**
   * Get direct dependencies of a file (what it imports).
   * @param filePath - Absolute file path
   * @param depth - Max traversal depth (default: 1, max: 3)
   * @returns Array of resolved dependency file paths
   */
  getDependencies(filePath: string, depth?: number): string[];

  /**
   * Get reverse dependencies (what files import this file).
   * @param filePath - Absolute file path
   * @returns Array of dependent file paths
   */
  getDependents(filePath: string): string[];

  /**
   * Get the symbol index (map of file path to exported symbols).
   * Used by FileRelevanceScorerService for symbol-aware scoring.
   * @returns SymbolIndex map
   */
  getSymbolIndex(): SymbolIndex;

  /**
   * Invalidate cached graph data for a specific file.
   * Called when a file is modified; graph is lazily rebuilt on next access.
   * @param filePath - Absolute file path to invalidate
   */
  invalidateFile(filePath: string): void;

  /**
   * Check if the graph has been built.
   */
  isBuilt(): boolean;
}
```

**Key Data Structures**:

```typescript
/** A node in the dependency graph representing a single file */
export interface FileNode {
  /** Absolute file path */
  path: string;
  /** Workspace-relative path */
  relativePath: string;
  /** Parsed import information */
  imports: ImportInfo[];
  /** Parsed export information */
  exports: ExportInfo[];
  /** Language of the file */
  language: SupportedLanguage;
}

/** The complete dependency graph for a workspace */
export interface DependencyGraph {
  /** All file nodes indexed by absolute path */
  nodes: Map<string, FileNode>;
  /** Forward edges: file -> set of files it imports (resolved paths) */
  edges: Map<string, Set<string>>;
  /** Reverse edges: file -> set of files that import it */
  reverseEdges: Map<string, Set<string>>;
  /** Build timestamp */
  builtAt: number;
  /** Number of unresolved imports (external packages, missing files) */
  unresolvedCount: number;
}

/** Map of file path to its exported symbols, used by relevance scorer */
export type SymbolIndex = Map<string, ExportInfo[]>;
```

**Import Resolution Strategy**:

1. **Relative imports** (`./utils`, `../shared/types`): Resolve against the importing file's directory. Check extensions in order: `.ts`, `.tsx`, `.js`, `.jsx`, then `/index.ts`, `/index.js`.
2. **tsconfig path aliases** (`@ptah-extension/shared`): If `tsconfigPaths` is provided, match against path patterns and resolve to workspace files.
3. **External packages** (`tsyringe`, `vscode`): Record in `ImportInfo` but do not resolve to a file path. Increment `unresolvedCount`.
4. **Barrel files** (`index.ts` re-exports): Resolved through the extension check strategy above.

**Cycle Detection**: During transitive dependency traversal (`getDependencies` with depth > 1), maintain a visited set. If a file is encountered again, stop traversal for that branch and return the non-circular portion.

**Caching Strategy**:

- Graph stored in memory as class property
- `invalidateFile()` removes the file's node and all edges to/from it, marks graph as dirty
- Next call to `getDependencies()`/`getDependents()` on invalidated file triggers lazy rebuild of that file's node only
- Full rebuild via `buildGraph()` replaces entire graph

**Quality Requirements**:

- Full workspace graph for 500 files built in under 10 seconds
- File-level invalidation (not full rebuild) on modification
- Cycle detection terminates traversal without error
- Unresolved imports logged at debug level, not error

---

## Phase 3: Symbol-Aware Relevance Scoring (Requirement 2)

### Component: FileRelevanceScorerService Enhancement

**Purpose**: Add export symbol matching to file relevance scoring so files exporting symbols that match query terms are ranked higher.

**Pattern**: Enhancement of existing scoring methods pattern at `file-relevance-scorer.service.ts:133-139`.
**Evidence**: Existing scoring methods: `scoreByLanguagePattern()` (line 247), `scoreByFrameworkPattern()` (line 293), `scoreByTaskPattern()` (line 339).

**File**: `libs/backend/workspace-intelligence/src/context-analysis/file-relevance-scorer.service.ts` (MODIFY)

**Changes**:

1. **Add `scoreFile` overload** that accepts an optional `SymbolIndex`:

```typescript
/**
 * Score a single file's relevance to a query, optionally using symbol data.
 *
 * @param file - The indexed file to score
 * @param query - User query string (optional)
 * @param symbolIndex - Optional pre-computed symbol index for export matching
 * @param activeFileImports - Optional imports of the currently edited file
 * @returns Relevance score result
 */
scoreFile(
  file: IndexedFile,
  query?: string,
  symbolIndex?: SymbolIndex,
  activeFileImports?: ImportInfo[]
): FileRelevanceResult;
```

2. **Add `scoreBySymbols()` private method** (follows pattern of existing `scoreByLanguagePattern`):

```typescript
/**
 * Score based on exported symbol name matching against query terms.
 * +15 per matched export symbol (vs +5 path match, +10 filename match).
 * +10 if file exports a symbol imported by the active file.
 */
private scoreBySymbols(
  file: IndexedFile,
  keywords: string[],
  reasons: string[],
  symbolIndex?: SymbolIndex,
  activeFileImports?: ImportInfo[]
): number;
```

3. **Integrate into `scoreFile()`**: Add call to `scoreBySymbols()` after existing scoring steps (step 5 position), passing through the optional parameters.

4. **Update `rankFiles()` and `getTopFiles()`** to accept optional `SymbolIndex` and `activeFileImports` and pass through to `scoreFile()`.

**Scoring Logic for `scoreBySymbols()`**:

- For each keyword in the query, check if any export in `symbolIndex.get(file.path)` has a name that matches (case-insensitive contains)
- Each matched export: +15 score, add reason "Export symbol '{name}' matches query"
- If `activeFileImports` is provided and the file exports a symbol that appears in `activeFileImports`, add +10 bonus per matched import
- If `symbolIndex` is undefined or has no entry for the file, return 0 (graceful degradation)
- Performance: Map lookup is O(1) per file, symbol comparison is O(exports \* keywords) which is bounded

**Quality Requirements**:

- Symbol scoring must complete within 50ms per file average
- When `symbolIndex` is undefined, zero overhead (early return)
- Existing scoring behavior unchanged when no symbol data provided
- Files exporting query-matching symbols rank in top 3

---

## Phase 4: Incremental Parsing (Requirement 4)

### Component: TreeSitterParserService Enhancement

**Purpose**: Support tree-sitter's `Tree.edit()` + incremental `parse(newContent, oldTree)` API for real-time code understanding during active editing.

**Pattern**: Enhancement of existing parser service at `tree-sitter-parser.service.ts:75-581`.
**Evidence**: Parser caching pattern at line 76-81, parse method at line 347-401.

**File**: `libs/backend/workspace-intelligence/src/ast/tree-sitter-parser.service.ts` (MODIFY)

**Changes**:

1. **Add tree-sitter interface extensions** for `Tree.edit()`:

```typescript
/** Extension to TreeSitterTree for edit support */
interface TreeSitterTree {
  rootNode: TreeSitterSyntaxNode;
  edit(delta: TreeSitterEditDelta): void;
}

/** tree-sitter edit delta (matches tree-sitter's Tree.edit() API) */
interface TreeSitterEditDelta {
  startIndex: number;
  oldEndIndex: number;
  newEndIndex: number;
  startPosition: { row: number; column: number };
  oldEndPosition: { row: number; column: number };
  newEndPosition: { row: number; column: number };
}
```

2. **Add `TreeCache`** (LRU cache for parsed trees):

```typescript
/** Cached tree entry */
interface TreeCacheEntry {
  tree: TreeSitterTree;
  language: SupportedLanguage;
  lastAccessed: number;
  filePath: string;
}

// Class property:
private readonly treeCache: Map<string, TreeCacheEntry> = new Map();
private readonly treeCacheMaxSize = 100;
```

3. **Add `EditDelta` public type** (exported for consumers):

```typescript
/**
 * Edit delta for incremental parsing.
 * Matches tree-sitter's Tree.edit() API parameters.
 * Consumers convert VS Code TextDocumentChangeEvent to this format.
 */
export interface EditDelta {
  startIndex: number;
  oldEndIndex: number;
  newEndIndex: number;
  startPosition: { row: number; column: number };
  oldEndPosition: { row: number; column: number };
  newEndPosition: { row: number; column: number };
}
```

4. **Add `parseIncremental()` method**:

```typescript
/**
 * Incrementally re-parse a file after an edit.
 * Uses tree-sitter's Tree.edit() + Parser.parse(newContent, oldTree) for
 * O(log n) re-parsing of single-line edits.
 *
 * Falls back to full parse if no cached tree exists.
 *
 * @param filePath - File path (used as cache key)
 * @param content - New file content after edit
 * @param language - Language of the file
 * @param editDelta - The edit delta describing the change
 * @returns Result containing the updated GenericAstNode
 */
parseIncremental(
  filePath: string,
  content: string,
  language: SupportedLanguage,
  editDelta: EditDelta
): Result<GenericAstNode, Error>;
```

5. **Add `parseAndCache()` method** (full parse that stores tree in cache):

```typescript
/**
 * Parse content and cache the resulting tree for future incremental updates.
 *
 * @param filePath - File path (used as cache key)
 * @param content - File content
 * @param language - Language of the file
 * @returns Result containing GenericAstNode
 */
parseAndCache(
  filePath: string,
  content: string,
  language: SupportedLanguage
): Result<GenericAstNode, Error>;
```

6. **Add LRU eviction** in tree cache management:

```typescript
private evictLRUTreeCache(): void {
  if (this.treeCache.size < this.treeCacheMaxSize) return;
  // Find and remove least recently accessed entry
  let oldestKey: string | undefined;
  let oldestTime = Infinity;
  for (const [key, entry] of this.treeCache) {
    if (entry.lastAccessed < oldestTime) {
      oldestTime = entry.lastAccessed;
      oldestKey = key;
    }
  }
  if (oldestKey) this.treeCache.delete(oldestKey);
}
```

**Integration Point** (VS Code app layer):

- The `onDidChangeTextDocument` event listener belongs in `apps/ptah-extension-vscode`, NOT in the library
- The app layer converts `TextDocumentChangeEvent.contentChanges` to `EditDelta` format
- Conversion: `range.start` -> `startPosition`, `rangeOffset` -> `startIndex`, `rangeOffset + rangeLength` -> `oldEndIndex`, `rangeOffset + text.length` -> `newEndIndex`

**Quality Requirements**:

- Incremental re-parse under 5ms for single-line edits on files up to 10,000 lines
- LRU eviction at 100 entries
- Cache miss falls back to full parse transparently
- No impact on existing `parse()` method behavior

---

## DI Registration

### New Tokens (vscode-core/src/di/tokens.ts)

```typescript
// Add to "Workspace Intelligence Service Tokens" section:
export const CONTEXT_ENRICHMENT_SERVICE = Symbol.for('ContextEnrichmentService');
export const DEPENDENCY_GRAPH_SERVICE = Symbol.for('DependencyGraphService');
```

Also add to the `TOKENS` export object at the bottom of the file.

**File**: `libs/backend/vscode-core/src/di/tokens.ts` (MODIFY)

### Registration (workspace-intelligence/src/di/register.ts)

Add imports and registrations:

```typescript
// New imports
import { ContextEnrichmentService } from '../context-analysis/context-enrichment.service';
import { DependencyGraphService } from '../ast/dependency-graph.service';

// In registerWorkspaceIntelligenceServices():

// After Tier 6 (AST services), add to same tier since they depend on AST:
container.registerSingleton(TOKENS.DEPENDENCY_GRAPH_SERVICE, DependencyGraphService);

// After Tier 5 (Context services), add since it depends on AST + Token services:
container.registerSingleton(TOKENS.CONTEXT_ENRICHMENT_SERVICE, ContextEnrichmentService);
```

Update the service list in the log statement to include new services.

**File**: `libs/backend/workspace-intelligence/src/di/register.ts` (MODIFY)

### Public Exports (index.ts)

```typescript
// Context enrichment
export { ContextEnrichmentService, type StructuralSummaryResult } from './context-analysis/context-enrichment.service';

// Dependency graph
export { DependencyGraphService, type DependencyGraph, type FileNode, type SymbolIndex } from './ast/dependency-graph.service';

// EditDelta type (from enhanced parser)
export type { EditDelta } from './ast/tree-sitter-parser.service';

// FileContextMode type (from enhanced optimizer)
export type { FileContextMode } from './context-analysis/context-size-optimizer.service';
```

**File**: `libs/backend/workspace-intelligence/src/index.ts` (MODIFY)

---

## Files Affected Summary

### CREATE (2 files)

| File                                                                                     | Component                |
| ---------------------------------------------------------------------------------------- | ------------------------ |
| `libs/backend/workspace-intelligence/src/context-analysis/context-enrichment.service.ts` | ContextEnrichmentService |
| `libs/backend/workspace-intelligence/src/ast/dependency-graph.service.ts`                | DependencyGraphService   |

### MODIFY (6 files)

| File                                                                                         | Changes                                                                          |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `libs/backend/workspace-intelligence/src/composite/workspace-analyzer.service.ts`            | Fix `extractCodeInsights()`: use `analyzeSource()`, remove stale comments        |
| `libs/backend/workspace-intelligence/src/context-analysis/file-relevance-scorer.service.ts`  | Add `scoreBySymbols()`, extend `scoreFile()` signature with optional SymbolIndex |
| `libs/backend/workspace-intelligence/src/context-analysis/context-size-optimizer.service.ts` | Add structural mode, FileContextMode type, ContextEnrichmentService dependency   |
| `libs/backend/workspace-intelligence/src/ast/tree-sitter-parser.service.ts`                  | Add `parseIncremental()`, `parseAndCache()`, TreeCache, EditDelta                |
| `libs/backend/workspace-intelligence/src/di/register.ts`                                     | Register new services, clean labels                                              |
| `libs/backend/workspace-intelligence/src/index.ts`                                           | Export new services/types, clean labels                                          |
| `libs/backend/vscode-core/src/di/tokens.ts`                                                  | Add CONTEXT_ENRICHMENT_SERVICE, DEPENDENCY_GRAPH_SERVICE tokens                  |

---

## Batching Strategy (for Team-Leader)

### Batch 0: Foundation Cleanup (Phase 0)

**Files**: workspace-analyzer.service.ts, di/register.ts, index.ts
**Scope**: Remove stale comments, fix `extractCodeInsights()` to use `analyzeSource()`, clean DI labels
**Risk**: Low -- pure cleanup, no new functionality
**Estimated effort**: 1-2 hours
**Developer type**: backend-developer

### Batch 1: Context Enrichment Service (Phase 1a)

**Files**: context-enrichment.service.ts (CREATE), tokens.ts, di/register.ts, index.ts
**Scope**: New ContextEnrichmentService with `generateStructuralSummary()` and `formatAsDeclaration()`
**Dependencies**: Batch 0 (clean foundation)
**Risk**: Medium -- formatting logic needs to handle edge cases (empty files, type-only files)
**Estimated effort**: 3-4 hours
**Developer type**: backend-developer

### Batch 2: Pipeline Integration (Phase 1b)

**Files**: context-size-optimizer.service.ts
**Scope**: Add structural mode to optimizer, FileContextMode type, wire ContextEnrichmentService
**Dependencies**: Batch 1 (ContextEnrichmentService exists)
**Risk**: Medium -- must not regress existing `full` mode behavior
**Estimated effort**: 2-3 hours
**Developer type**: backend-developer

### Batch 3: Dependency Graph (Phase 2)

**Files**: dependency-graph.service.ts (CREATE), tokens.ts, di/register.ts, index.ts
**Scope**: New DependencyGraphService with graph building, resolution, caching, cycle detection
**Dependencies**: Batch 0 (clean foundation)
**Risk**: High -- import resolution complexity (tsconfig paths, barrel files, extension guessing)
**Estimated effort**: 4-6 hours
**Developer type**: backend-developer

### Batch 4: Symbol-Aware Scoring (Phase 3)

**Files**: file-relevance-scorer.service.ts
**Scope**: Add `scoreBySymbols()`, extend `scoreFile()` signature
**Dependencies**: Batch 3 (SymbolIndex from DependencyGraphService)
**Risk**: Low -- additive enhancement, no breaking changes to existing API
**Estimated effort**: 2-3 hours
**Developer type**: backend-developer

### Batch 5: Incremental Parsing (Phase 4)

**Files**: tree-sitter-parser.service.ts
**Scope**: Add `parseIncremental()`, `parseAndCache()`, TreeCache with LRU eviction, EditDelta type
**Dependencies**: Batch 0 (clean foundation)
**Risk**: Medium -- tree-sitter `Tree.edit()` API must be verified at runtime; LRU cache correctness
**Estimated effort**: 3-4 hours
**Developer type**: backend-developer

### Batch Dependency Graph

```
Batch 0 (cleanup)
   |
   +---> Batch 1 (enrichment service)
   |        |
   |        +---> Batch 2 (pipeline integration)
   |
   +---> Batch 3 (dependency graph)
   |        |
   |        +---> Batch 4 (symbol scoring)
   |
   +---> Batch 5 (incremental parsing)
```

Batches 1, 3, and 5 can run in parallel after Batch 0.

---

## Testing Strategy

### Batch 0 Tests

- Verify `extractCodeInsights()` returns actual insights (not empty) for a sample TS file
- Verify stale comments are gone (string search in modified files)
- Existing tests in workspace-intelligence must continue to pass

### Batch 1 Tests

- `generateStructuralSummary()` for a TS file: verify summary contains function names, class names, imports
- `generateStructuralSummary()` for unsupported language: verify returns full content with `mode: 'full'`
- `generateStructuralSummary()` when parsing fails: verify fallback to full content
- `formatAsDeclaration()`: verify output format matches .d.ts style
- Token reduction: verify summary is <= 60% of original for files over 100 lines
- Edge cases: empty file, file with only imports, file with only type exports

### Batch 2 Tests

- `optimizeContext({ mode: 'full' })`: verify identical behavior to current (regression test)
- `optimizeContext({ mode: 'structural' })`: verify top 20% get full, rest get structural
- `optimizeContext({ mode: 'structural' })`: verify total tokens at least 30% less than full mode
- Verify `fileContextModes` map is populated correctly
- Verify dependency inclusion works when DependencyGraphService is available
- Verify graceful behavior when DependencyGraphService is not available

### Batch 3 Tests

- `buildGraph()`: verify forward edges match file imports
- `buildGraph()`: verify reverse edges are inverse of forward edges
- `getDependencies()` depth 1: verify returns direct imports only
- `getDependencies()` depth 2: verify returns transitive dependencies
- Cycle detection: create circular import and verify traversal terminates
- Relative import resolution: `./foo` resolves to `foo.ts` or `foo/index.ts`
- tsconfig path alias resolution: `@ptah-extension/shared` resolves correctly
- External package: `tsyringe` recorded but not resolved
- `invalidateFile()`: verify file node removed and lazily rebuilt
- `getSymbolIndex()`: verify map contains expected exports

### Batch 4 Tests

- `scoreBySymbols()` with matching export: verify +15 per match
- `scoreBySymbols()` with no symbol index: verify 0 additional score
- `scoreBySymbols()` with active file import match: verify +10 bonus
- `scoreFile()` without symbol index: verify existing behavior unchanged
- `rankFiles()` with symbol index: verify symbol-matching files rank higher

### Batch 5 Tests

- `parseAndCache()`: verify tree is cached and returned
- `parseIncremental()`: verify edit delta applied and re-parsed
- `parseIncremental()` with no cached tree: verify falls back to full parse
- LRU eviction: fill cache to 100, add one more, verify oldest evicted
- Performance: single-line edit on large file completes under 5ms (benchmark test)

---

## Risk Mitigations

| Risk                                           | Probability | Impact | Mitigation                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------- | ----------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **tree-sitter native module crash**            | Medium      | High   | Every AST call path wrapped in try/catch with fallback to non-AST behavior. `ContextEnrichmentService` falls back to full content. `FileRelevanceScorerService` falls back to path-only scoring.                                                                                                  |
| **Import path resolution incomplete**          | High        | Medium | Start with relative paths + tsconfig `paths`. Log unresolved imports at debug level. Accept partial graph as better than no graph. Track `unresolvedCount` in graph metadata for monitoring.                                                                                                      |
| **Performance regression in context pipeline** | Medium      | High   | Structural mode is opt-in via `mode` parameter. Existing `full` mode unchanged. All AST operations use cached parser instances. Token counting uses `TokenCounterService` cache.                                                                                                                  |
| **Tree cache memory pressure**                 | Medium      | Medium | LRU eviction at 100 entries (configurable). Each tree is ~50-200KB for typical files. 100 trees = ~5-20MB, well within 50MB budget.                                                                                                                                                               |
| **Incremental parsing edge cases**             | Medium      | Medium | `parseIncremental()` falls back to full parse on any error. Tree cache miss also triggers full parse. Incremental parsing is lowest priority (Phase 4) and can be deferred.                                                                                                                       |
| **ContextSizeOptimizer regression**            | Low         | High   | When `mode` is undefined or `'full'`, code path is identical to current. Structural mode is entirely new code path. Regression test required for `full` mode.                                                                                                                                     |
| **DI circular dependency**                     | Low         | Medium | `ContextEnrichmentService` depends on `AstAnalysisService` (lower tier). `DependencyGraphService` depends on `TreeSitterParserService` (same tier). No circular paths. `ContextSizeOptimizerService` optionally depends on `DependencyGraphService` via `@inject()` with `@optional()` decorator. |

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**:

- All work is in backend library (`workspace-intelligence`)
- No UI/frontend changes
- Pure TypeScript service development
- DI registration, token management
- Tree-sitter native module integration

### Complexity Assessment

**Complexity**: XL (Extra Large)
**Estimated Effort**: 15-22 hours across 6 batches

**Breakdown**:

- Batch 0 (cleanup): 1-2 hours
- Batch 1 (enrichment): 3-4 hours
- Batch 2 (pipeline): 2-3 hours
- Batch 3 (dependency graph): 4-6 hours
- Batch 4 (symbol scoring): 2-3 hours
- Batch 5 (incremental parsing): 3-4 hours

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **All imports exist in codebase**:

   - `AstAnalysisService` from `../ast/ast-analysis.service` (verified: line 69)
   - `TreeSitterParserService` from `../ast/tree-sitter-parser.service` (verified: line 75)
   - `TokenCounterService` from `../services/token-counter.service` (verified: line 28)
   - `FileSystemService` from `../services/file-system.service` (verified: line 18)
   - `Result` from `@ptah-extension/shared` (verified: used across all services)
   - `TOKENS, Logger` from `@ptah-extension/vscode-core` (verified: tokens.ts)
   - `CodeInsights, FunctionInfo, ClassInfo, ImportInfo, ExportInfo` from `../ast/ast-analysis.interfaces` (verified: lines 1-125)
   - `SupportedLanguage` from `../ast/ast.types` (verified: line 25)

2. **All patterns verified from examples**:

   - Injectable service: `@injectable()` + constructor injection (every service in workspace-intelligence)
   - Token-based injection: `@inject(TOKENS.LOGGER)` (workspace-analyzer.service.ts:93)
   - Result return type: `Result<T, Error>` (tree-sitter-parser.service.ts:347)
   - DI registration: `container.registerSingleton(TOKEN, Class)` (di/register.ts:93-172)

3. **Library documentation consulted**:

   - `libs/backend/workspace-intelligence/CLAUDE.md`
   - `libs/backend/vscode-core/CLAUDE.md`

4. **No hallucinated APIs**:
   - `AstAnalysisService.analyzeSource()` verified: ast-analysis.service.ts:85
   - `TreeSitterParserService.parse()` verified: tree-sitter-parser.service.ts:347
   - `TreeSitterParserService.queryImports()` verified: tree-sitter-parser.service.ts:536
   - `TreeSitterParserService.queryExports()` verified: tree-sitter-parser.service.ts:548
   - `TokenCounterService.countTokens()` verified: token-counter.service.ts:40
   - `FileSystemService.readFile()` verified: file-system.service.ts:25
   - `TOKENS.TREE_SITTER_PARSER_SERVICE` verified: tokens.ts:108
   - `TOKENS.AST_ANALYSIS_SERVICE` verified: tokens.ts:109
   - `TOKENS.LOGGER` verified: tokens.ts:58

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined per component
- [x] Integration points documented with dependency flow diagram
- [x] Files affected list complete (2 CREATE, 7 MODIFY)
- [x] Developer type recommended (backend-developer)
- [x] Complexity assessed (XL, 15-22 hours)
- [x] Batching strategy with dependency graph for parallel execution
- [x] Testing strategy per batch
- [x] Risk mitigations with specific fallback strategies
- [x] No step-by-step implementation instructions (team-leader decomposes)
- [x] No backward compatibility layers (direct replacement per mandate)
