/**
 * Workspace Intelligence DI Registration
 * TASK_2025_071 Batch 2C: Register all workspace-intelligence services in DI container
 *
 * Pattern: Follow agent-generation registration pattern for consistency.
 * Services use @injectable() decorators for auto-wiring.
 *
 * CRITICAL: Service registration order MUST follow dependency hierarchy.
 * Base services (no dependencies) registered first, higher-level services last.
 */

import { DependencyContainer } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';

// Import all workspace-intelligence services (20 total)
// Base services
import { PatternMatcherService } from '../file-indexing/pattern-matcher.service';
import { IgnorePatternResolverService } from '../file-indexing/ignore-pattern-resolver.service';
import { FileTypeClassifierService } from '../context-analysis/file-type-classifier.service';
import { FileSystemService } from '../services/file-system.service';
import { TokenCounterService } from '../services/token-counter.service';

// Project detection services
import { MonorepoDetectorService } from '../project-analysis/monorepo-detector.service';
import { DependencyAnalyzerService } from '../project-analysis/dependency-analyzer.service';
import { FrameworkDetectorService } from '../project-analysis/framework-detector.service';
import { ProjectDetectorService } from '../project-analysis/project-detector.service';

// Indexing services
import { WorkspaceIndexerService } from '../file-indexing/workspace-indexer.service';

// Analysis services
import { WorkspaceAnalyzerService } from '../composite/workspace-analyzer.service';
import { WorkspaceService } from '../workspace/workspace.service';

// Context services
import { ContextService } from '../context/context.service';
import { FileRelevanceScorerService } from '../context-analysis/file-relevance-scorer.service';
import { ContextSizeOptimizerService } from '../context-analysis/context-size-optimizer.service';
import { ContextOrchestrationService } from '../context/context-orchestration.service';

// AST services
import { TreeSitterParserService } from '../ast/tree-sitter-parser.service';
import { AstAnalysisService } from '../ast/ast-analysis.service';
import { DependencyGraphService } from '../ast/dependency-graph.service';

// Context enrichment services
import { ContextEnrichmentService } from '../context-analysis/context-enrichment.service';

// Autocomplete discovery services
import { AgentDiscoveryService } from '../autocomplete/agent-discovery.service';
import { CommandDiscoveryService } from '../autocomplete/command-discovery.service';

// Quality assessment services registration (TASK_2025_141)
import { registerQualityServices } from '../quality/di';

// Code symbol indexer (TASK_2026_THOTH_CODE_INDEX)
import { CodeSymbolIndexer } from '../services/code-symbol-indexer.service';

// TASK_2025_291 Wave B (B2): AST-backed architecture rules need the
// TreeSitterParserService. `configureArchitectureRules` is a module-level
// setter called once during bootstrap (see Tier 6 below) to wire the
// already-registered singleton into the rule module.
import { configureArchitectureRules } from '../quality/rules/architecture-rules';

/**
 * Register workspace-intelligence services in DI container
 *
 * DEPENDENCY ORDER (CRITICAL):
 * Tier 1: Base services (no dependencies) - 5 services
 * Tier 2: Project detection services - 4 services
 * Tier 3: Indexing services (depend on base) - 1 service
 * Tier 4: Analysis services (depend on indexing) - 2 services
 * Tier 5: Context services - 4 services
 * Tier 6: AST Analysis Services - 2 services
 * Tier 7: Autocomplete discovery services - 2 services
 * Tier 8: Quality assessment services (TASK_2025_141) - 4 services
 *
 * @param container - TSyringe DI container
 * @param logger - Logger instance
 */
export function registerWorkspaceIntelligenceServices(
  container: DependencyContainer,
  logger: Logger,
): void {
  // TASK_2025_071 Batch 7: Dependency validation - fail fast if prerequisites missing
  if (!container.isRegistered(TOKENS.LOGGER)) {
    throw new Error(
      '[Workspace Intelligence] DEPENDENCY ERROR: TOKENS.LOGGER must be registered first.',
    );
  }

  if (!container.isRegistered(TOKENS.FILE_SYSTEM_MANAGER)) {
    throw new Error(
      '[Workspace Intelligence] DEPENDENCY ERROR: vscode-core services must be registered before workspace-intelligence. ' +
        'Ensure registerVsCodeCoreServices is called BEFORE registerWorkspaceIntelligenceServices in container.ts.',
    );
  }

  logger.info('[Workspace Intelligence] Registering services...');

  // ============================================================
  // Tier 1: Base services (no dependencies)
  // ============================================================
  container.registerSingleton(
    TOKENS.PATTERN_MATCHER_SERVICE,
    PatternMatcherService,
  );
  container.registerSingleton(
    TOKENS.IGNORE_PATTERN_RESOLVER_SERVICE,
    IgnorePatternResolverService,
  );
  container.registerSingleton(
    TOKENS.FILE_TYPE_CLASSIFIER_SERVICE,
    FileTypeClassifierService,
  );
  container.registerSingleton(TOKENS.FILE_SYSTEM_SERVICE, FileSystemService);
  container.registerSingleton(
    TOKENS.TOKEN_COUNTER_SERVICE,
    TokenCounterService,
  );

  // ============================================================
  // Tier 2: Project detection services
  // ============================================================
  container.registerSingleton(
    TOKENS.MONOREPO_DETECTOR_SERVICE,
    MonorepoDetectorService,
  );
  container.registerSingleton(
    TOKENS.DEPENDENCY_ANALYZER_SERVICE,
    DependencyAnalyzerService,
  );
  container.registerSingleton(
    TOKENS.FRAMEWORK_DETECTOR_SERVICE,
    FrameworkDetectorService,
  );
  container.registerSingleton(
    TOKENS.PROJECT_DETECTOR_SERVICE,
    ProjectDetectorService,
  );

  // ============================================================
  // Tier 3: Indexing services (depend on base services)
  // ============================================================
  container.registerSingleton(
    TOKENS.WORKSPACE_INDEXER_SERVICE,
    WorkspaceIndexerService,
  );

  // ============================================================
  // Tier 4: Analysis services (depend on indexing)
  // ============================================================
  container.registerSingleton(
    TOKENS.WORKSPACE_ANALYZER_SERVICE,
    WorkspaceAnalyzerService,
  );
  container.registerSingleton(TOKENS.WORKSPACE_SERVICE, WorkspaceService);

  // ============================================================
  // Tier 5: Context services
  // ============================================================
  container.registerSingleton(TOKENS.CONTEXT_SERVICE, ContextService);
  container.registerSingleton(
    TOKENS.FILE_RELEVANCE_SCORER,
    FileRelevanceScorerService,
  );
  container.registerSingleton(
    TOKENS.CONTEXT_SIZE_OPTIMIZER,
    ContextSizeOptimizerService,
  );
  container.registerSingleton(
    TOKENS.CONTEXT_ORCHESTRATION_SERVICE,
    ContextOrchestrationService,
  );

  // ============================================================
  // Tier 6: AST Analysis Services
  // ============================================================
  container.registerSingleton(
    TOKENS.TREE_SITTER_PARSER_SERVICE,
    TreeSitterParserService,
  );
  container.registerSingleton(TOKENS.AST_ANALYSIS_SERVICE, AstAnalysisService);
  container.registerSingleton(
    TOKENS.DEPENDENCY_GRAPH_SERVICE,
    DependencyGraphService,
  );

  // TASK_2025_291 B2: wire the tree-sitter parser into the module-level
  // architecture-rules shim so `functionTooLargeRule` can perform AST-backed
  // function-size analysis. Done here because the parser singleton is
  // registered immediately above and the rule module needs it before
  // `registerQualityServices` wires the detection pipeline.
  configureArchitectureRules(
    container.resolve<TreeSitterParserService>(
      TOKENS.TREE_SITTER_PARSER_SERVICE,
    ),
  );

  // ============================================================
  // Tier 6b: Context Enrichment (depends on AST + Token services)
  // Registered after Tier 6 because it depends on AstAnalysisService
  // ============================================================
  container.registerSingleton(
    TOKENS.CONTEXT_ENRICHMENT_SERVICE,
    ContextEnrichmentService,
  );

  // ============================================================
  // Tier 7: Autocomplete discovery services
  // ============================================================
  container.registerSingleton(
    TOKENS.AGENT_DISCOVERY_SERVICE,
    AgentDiscoveryService,
  );
  container.registerSingleton(
    TOKENS.COMMAND_DISCOVERY_SERVICE,
    CommandDiscoveryService,
  );

  // ============================================================
  // Tier 8: Quality assessment services (TASK_2025_141)
  // Depends on: Tier 1-5 services (file system, indexing, relevance scoring)
  // ============================================================
  registerQualityServices(container, logger);

  // ============================================================
  // Tier 9: Code Symbol Indexer (TASK_2026_THOTH_CODE_INDEX)
  // Depends on: AstAnalysisService (Tier 6), WorkspaceIndexerService (Tier 3),
  // IFileSystemProvider (platform), SYMBOL_SINK (memory-contracts token — wired
  // by memory-curator registration, which runs before this in the host app)
  // ============================================================
  container.registerSingleton(
    Symbol.for('PtahCodeSymbolIndexer'),
    CodeSymbolIndexer,
  );

  logger.info('[Workspace Intelligence] Services registered', {
    services: [
      'PATTERN_MATCHER_SERVICE',
      'IGNORE_PATTERN_RESOLVER_SERVICE',
      'FILE_TYPE_CLASSIFIER_SERVICE',
      'FILE_SYSTEM_SERVICE',
      'TOKEN_COUNTER_SERVICE',
      'MONOREPO_DETECTOR_SERVICE',
      'DEPENDENCY_ANALYZER_SERVICE',
      'FRAMEWORK_DETECTOR_SERVICE',
      'PROJECT_DETECTOR_SERVICE',
      'WORKSPACE_INDEXER_SERVICE',
      'WORKSPACE_ANALYZER_SERVICE',
      'WORKSPACE_SERVICE',
      'CONTEXT_SERVICE',
      'FILE_RELEVANCE_SCORER',
      'CONTEXT_SIZE_OPTIMIZER',
      'CONTEXT_ORCHESTRATION_SERVICE',
      'CONTEXT_ENRICHMENT_SERVICE',
      'TREE_SITTER_PARSER_SERVICE',
      'AST_ANALYSIS_SERVICE',
      'DEPENDENCY_GRAPH_SERVICE',
      'AGENT_DISCOVERY_SERVICE',
      'COMMAND_DISCOVERY_SERVICE',
      'CODE_SYMBOL_INDEXER',
      'ANTI_PATTERN_DETECTION_SERVICE',
      'CODE_QUALITY_ASSESSMENT_SERVICE',
      'PRESCRIPTIVE_GUIDANCE_SERVICE',
      'PROJECT_INTELLIGENCE_SERVICE',
    ],
  });
}
