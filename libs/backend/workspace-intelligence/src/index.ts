/**
 * Workspace Intelligence Library
 *
 * Provides intelligent workspace analysis, file indexing, and context optimization
 * for AI provider integrations.
 */

// Type exports
export * from './types/workspace.types';

/**
 * Workspace Intelligence Library
 * Public API exports
 */

// Type exports
export * from './types/workspace.types';

// Service exports (gradual implementation - uncomment as services are implemented)
export { TokenCounterService } from './services/token-counter.service';
export {
  FileSystemService,
  FileSystemError,
} from './services/file-system.service';
// TODO: Uncomment as services are implemented
// export { ProjectDetectorService } from './services/project-detector.service';
// export { PatternMatcherService } from './services/pattern-matcher.service';
// export { FileIndexerService } from './services/file-indexer.service';
// export { WorkspaceAnalyzerService } from './services/workspace-analyzer.service';

// Project analysis will be exported as implemented
// export * from './project-analysis/project-type-detector';
// export * from './project-analysis/framework-detector';
// export * from './project-analysis/dependency-analyzer';
// export * from './project-analysis/monorepo-detector';

// File indexing will be exported as implemented
// export * from './file-indexing/pattern-matcher.service';
// export * from './file-indexing/ignore-pattern-resolver';
// export * from './file-indexing/workspace-indexer';
// export * from './file-indexing/file-type-classifier';

// Context optimization will be exported as implemented
// export * from './optimization/context-size-optimizer';
// export * from './optimization/file-relevance-scorer';
// export * from './optimization/semantic-context-extractor';
