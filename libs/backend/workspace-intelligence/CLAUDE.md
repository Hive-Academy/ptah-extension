# @ptah-extension/workspace-intelligence

[Back to Main](../../../CLAUDE.md)

## Purpose

Workspace analysis, file indexing, context optimization, AST parsing (tree-sitter), and code symbol indexing for downstream AI consumers. The "what's in this workspace" service layer.

## Boundaries

**Belongs here**:

- Workspace analyzer + project/framework/dependency/monorepo detectors
- File indexer with pattern matching and ignore resolution
- Context services: search, orchestration, optimization, enrichment, relevance scoring
- AST: tree-sitter parser, dependency graph, symbol indexer
- Token counter and file system helpers

**Does NOT belong**:

- LLM calls (consumers pass context to `agent-sdk`)
- Persistence beyond what the symbol indexer needs (via `ISymbolSink` from `memory-contracts`)
- RPC handlers (in `rpc-handlers`: `ContextRpcHandlers`, `WorkspaceRpcHandlers`)

## Public API

Workspace: `WorkspaceService`, `WorkspaceAnalyzerService`, `ProjectDetectorService`, `FrameworkDetectorService`, `DependencyAnalyzerService`, `MonorepoDetectorService`.
Context: `ContextService`, `ContextOrchestrationService`, `FileTypeClassifierService`, `FileRelevanceScorerService`, `ContextSizeOptimizerService`, `ContextEnrichmentService`.
Indexing: `WorkspaceIndexerService`, `PatternMatcherService`, `IgnorePatternResolverService`.
Files: `FileSystemService` (+ `FileSystemError`), `TokenCounterService`.
AST: `TreeSitterParserService`, `AstAnalysisService`, `DependencyGraphService` (+ `DependencyGraph`, `FileNode`, `SymbolIndex`).
Plus rich typing (`WorkspaceAnalysisResult`, `WorkspaceInfo`, `ContextRecommendations`, `OptimizedContext`, `IndexingProgress`, `FileSearchOptions`, AST query types, etc.) and a code-symbol indexer (TASK_2026_THOTH_CODE_INDEX).

## Internal Structure

- `src/workspace/` — `WorkspaceService`
- `src/composite/` — `WorkspaceAnalyzerService` façade
- `src/project-analysis/` — project/framework/dependency/monorepo detectors
- `src/file-indexing/` — `WorkspaceIndexerService`, `PatternMatcherService`, `IgnorePatternResolverService`
- `src/context/` — `ContextService`, `ContextOrchestrationService`
- `src/context-analysis/` — classifier, relevance scorer, size optimizer, enrichment
- `src/ast/` — tree-sitter parser, dependency graph, types/config
- `src/services/` — `TokenCounterService`, `FileSystemService`
- `src/autocomplete/`, `src/quality/` — additional capability buckets
- `src/types/workspace.types.ts`
- `src/di/`

## Dependencies

**Internal**: `@ptah-extension/shared`, `@ptah-extension/platform-core`, `@ptah-extension/vscode-core`, `@ptah-extension/memory-contracts`
**External**: `web-tree-sitter` (^0.26.8), `picomatch`, `gray-matter`, `tsyringe`

## Guidelines

- File access via `IFileSystemProvider` (platform-core) — never `node:fs` directly.
- Tree-sitter WASM grammars load lazily; respect platform-info paths for asset resolution.
- The symbol indexer writes through `ISymbolSink` (memory-contracts) — concrete sink is registered by memory-curator.
- `IndexingProgress` events flow via `createEvent` (platform-core utility) — keep them disposable.
- Long-running operations must honor cancellation tokens.
- `catch (error: unknown)`.

## Cross-Lib Rules

Used by `agent-generation`, `vscode-lm-tools`, `rpc-handlers`. Imports `platform-core`/`vscode-core`/`memory-contracts` only. Frontend libs MUST NOT import this.
