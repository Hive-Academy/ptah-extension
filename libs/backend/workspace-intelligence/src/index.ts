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

// Project analysis exports
export { ProjectDetectorService } from './project-analysis/project-detector.service';
export { FrameworkDetectorService } from './project-analysis/framework-detector.service';
export { DependencyAnalyzerService } from './project-analysis/dependency-analyzer.service';
export { MonorepoDetectorService } from './project-analysis/monorepo-detector.service';

// File indexing exports
export { PatternMatcherService } from './file-indexing/pattern-matcher.service';
export { IgnorePatternResolverService } from './file-indexing/ignore-pattern-resolver.service';

// DI tokens
export * from './di/tokens';
