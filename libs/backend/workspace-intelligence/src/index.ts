/**
 * Workspace Intelligence Library
 *
 * Provides intelligent workspace analysis, file indexing, and context optimization
 * for AI provider integrations.
 */
export * from './types/workspace.types';
export { TokenCounterService } from './services/token-counter.service';
export {
  FileSystemService,
  FileSystemError,
} from './services/file-system.service';
export {
  ContextService,
  WorkspaceRootMismatchError,
  type FileSearchResult,
  type FileSearchOptions,
} from './context/context.service';
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
export {
  WorkspaceService,
  type WorkspaceAnalysisResult,
  type ProjectInfo,
  type DirectoryStructure,
  type WorkspaceStructureAnalysis,
} from './workspace/workspace.service';
export { ProjectDetectorService } from './project-analysis/project-detector.service';
export { FrameworkDetectorService } from './project-analysis/framework-detector.service';
export { DependencyAnalyzerService } from './project-analysis/dependency-analyzer.service';
export { MonorepoDetectorService } from './project-analysis/monorepo-detector.service';
export {
  probeStackToolchain,
  parseProbeVersion,
  compareVersions,
} from './project-analysis/toolchain-probe';
export type { ToolchainProbeOptions } from './project-analysis/toolchain-probe';
export { PatternMatcherService } from './file-indexing/pattern-matcher.service';
export { IgnorePatternResolverService } from './file-indexing/ignore-pattern-resolver.service';
export { DEFAULT_WORKSPACE_EXCLUDES } from './file-indexing/workspace-default-excludes';
export {
  WorkspaceIndexerService,
  type WorkspaceIndexOptions,
  type IndexingProgress,
} from './file-indexing/workspace-indexer.service';
export { WorkspaceFileIndexService } from './file-indexing/workspace-file-index.service';
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
export {
  ContextEnrichmentService,
  type StructuralSummaryResult,
} from './context-analysis/context-enrichment.service';
export {
  resolveEnrichLanguage,
  type EnrichLanguage,
} from './context-analysis/enrich-language';
export {
  WorkspaceAnalyzerService,
  type WorkspaceInfo,
  type ContextRecommendations,
} from './composite/workspace-analyzer.service';
export {
  TreeSitterParserService,
  type QueryCapture,
  type QueryMatch,
  type EditDelta,
} from './ast/tree-sitter-parser.service';
export { AstAnalysisService } from './ast/ast-analysis.service';
export { formatAstAnalysisResult } from './ast/ast-result-format';
export {
  extractExportsFromMatches,
  exportSymbolNames,
  type ExportExtraction,
} from './ast/export-extraction';
export {
  DependencyGraphService,
  type DependencyGraph,
  type FileNode,
  type GraphBuildState,
  type GraphCoverage,
  type SymbolIndex,
} from './ast/dependency-graph.service';
export * from './ast/ast.types';
export * from './ast/ast-analysis.interfaces';
export * from './ast/tree-sitter.config';
export {
  CODE_FILE_NAMES,
  LANGUAGE_REGISTRY,
  NON_SOURCE_EXTENSIONS,
  NON_SOURCE_FILE_NAMES,
  classifyFileForCoverage,
  extensionHasCapability,
  hasCapability,
  languageForExtension,
  recognisedSourceExtensions,
  supportedLanguagesFor,
  type CoverageFileClass,
  type GraphEdgesCapability,
  type LanguageCapabilities,
  type LanguageCapability,
  type LanguageRegistryEntry,
} from './ast/language-registry';
export {
  CodeSymbolIndexer,
  type CodeSymbolIndexerOptions,
  type IndexingStats,
} from './services/code-symbol-indexer.service';

export * from './autocomplete/agent-discovery.service';
export * from './autocomplete/command-discovery.service';
export * from './quality';
export {
  registerWorkspaceIntelligenceServices,
  registerTypeScriptDiagnosticsProvider,
  CODE_SYMBOL_INDEXER,
} from './di';
export { TypeScriptDiagnosticsProvider } from './diagnostics/type-script-diagnostics-provider';
// Batch 25b's end-to-end spec drives the real provider over a fake inner one.
export {
  LanguageAwareDiagnosticsProvider,
  type SyntaxParser,
} from './diagnostics/language-aware-diagnostics-provider';
// Batch 37a: the opt-in `go vet` checker; 37b wires it and the consent RPC.
export {
  GoVetChecker,
  GO_VET_COVERAGE,
  GO_VET_TIMEOUT_MS,
  goVetReasonText,
  type GoVetCheckRequest,
  type GoVetCheckResult,
  type GoVetCheckerDependencies,
  type GoVetOutcome,
  type GoVetReason,
  type GoVetSkippedFile,
} from './diagnostics/external-checkers/go-vet-checker';
export {
  GoVetConsentStore,
  GO_VET_CONSENT_KEY,
  type GoVetConsentRecord,
  type GoVetConsentStaleReason,
  type GoVetConsentState,
} from './diagnostics/external-checkers/go-vet-consent-store';
export {
  resolveGoBinary,
  type GoBinaryIdentity,
  type ResolvedGoBinary,
} from './diagnostics/external-checkers/go-binary-resolver';
