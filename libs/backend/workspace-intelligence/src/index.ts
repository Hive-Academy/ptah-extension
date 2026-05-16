/**
 * Workspace Intelligence Library
 *
 * Provides intelligent workspace analysis, file indexing, and context optimization
 * for AI provider integrations.
 */

// Type exports
export * from './types/workspace.types';

// Service exports (gradual implementation - uncomment as services are implemented)
export { TokenCounterService } from './services/token-counter.service';
export {
  FileSystemService,
  FileSystemError,
} from './services/file-system.service';

// Context service - Main application business logic
export {
  ContextService,
  type FileSearchResult,
  type FileSearchOptions,
} from './context/context.service';

// Context Orchestration
export { ContextOrchestrationService } from './context/context-orchestration.service';
export type {
  VsCodeUri,
  GetContextFilesRequest,
  GetContextFilesResult,
  IncludeFileRequest,
  IncludeFileResult,
  ExcludeFileRequest,
  ExcludeFileResult,
  SearchFilesRequest,
  SearchFilesResult,
  GetAllFilesRequest,
  GetAllFilesResult,
  GetFileSuggestionsRequest,
  GetFileSuggestionsResult,
  SearchImagesRequest,
  SearchImagesResult,
} from './context/context-orchestration.service';

// Workspace service - Workspace management and analysis
export {
  WorkspaceService,
  type WorkspaceAnalysisResult,
  type ProjectInfo,
  type DirectoryStructure,
  type WorkspaceStructureAnalysis,
} from './workspace/workspace.service';

// Project analysis exports
export { ProjectDetectorService } from './project-analysis/project-detector.service';
export { FrameworkDetectorService } from './project-analysis/framework-detector.service';
export { DependencyAnalyzerService } from './project-analysis/dependency-analyzer.service';
export { MonorepoDetectorService } from './project-analysis/monorepo-detector.service';

// File indexing exports
export { PatternMatcherService } from './file-indexing/pattern-matcher.service';
export { IgnorePatternResolverService } from './file-indexing/ignore-pattern-resolver.service';
export {
  WorkspaceIndexerService,
  type WorkspaceIndexOptions,
  type IndexingProgress,
} from './file-indexing/workspace-indexer.service';

// Context analysis exports
export {
  FileTypeClassifierService,
  type FileClassificationResult,
} from './context-analysis/file-type-classifier.service';
export {
  FileRelevanceScorerService,
  type FileRelevanceResult,
} from './context-analysis/file-relevance-scorer.service';
export {
  ContextSizeOptimizerService,
  type ContextOptimizationRequest,
  type OptimizedContext,
  type ContextOptimizationStats,
  type FileContextMode,
} from './context-analysis/context-size-optimizer.service';

// Context enrichment
export {
  ContextEnrichmentService,
  type StructuralSummaryResult,
} from './context-analysis/context-enrichment.service';

// Composite services - Unified facades
export {
  WorkspaceAnalyzerService,
  type WorkspaceInfo,
  type ContextRecommendations,
} from './composite/workspace-analyzer.service';

// AST Analysis Services
export {
  TreeSitterParserService,
  type QueryCapture,
  type QueryMatch,
  type EditDelta,
} from './ast/tree-sitter-parser.service';
export { AstAnalysisService } from './ast/ast-analysis.service';
export {
  DependencyGraphService,
  type DependencyGraph,
  type FileNode,
  type SymbolIndex,
} from './ast/dependency-graph.service';

// AST types and interfaces
export * from './ast/ast.types';
export * from './ast/ast-analysis.interfaces';
export * from './ast/tree-sitter.config';

// Code Symbol Indexer
export {
  CodeSymbolIndexer,
  type CodeSymbolIndexerOptions,
  type IndexingStats,
} from './services/code-symbol-indexer.service';

export * from './autocomplete/agent-discovery.service';
export * from './autocomplete/command-discovery.service';

// Quality Assessment
export * from './quality';

// DI registration function + tokens
export {
  registerWorkspaceIntelligenceServices,
  CODE_SYMBOL_INDEXER,
} from './di';
