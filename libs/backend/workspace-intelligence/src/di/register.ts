/**
 * Workspace Intelligence DI Registration
 *
 * Services use @injectable() decorators for auto-wiring.
 *
 * CRITICAL: Service registration order MUST follow dependency hierarchy.
 * Base services (no dependencies) registered first, higher-level services last.
 */

import { DependencyContainer } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import { PatternMatcherService } from '../file-indexing/pattern-matcher.service';
import { IgnorePatternResolverService } from '../file-indexing/ignore-pattern-resolver.service';
import { FileTypeClassifierService } from '../context-analysis/file-type-classifier.service';
import { FileSystemService } from '../services/file-system.service';
import { TokenCounterService } from '../services/token-counter.service';
import { MonorepoDetectorService } from '../project-analysis/monorepo-detector.service';
import { DependencyAnalyzerService } from '../project-analysis/dependency-analyzer.service';
import { FrameworkDetectorService } from '../project-analysis/framework-detector.service';
import { ProjectDetectorService } from '../project-analysis/project-detector.service';
import { WorkspaceIndexerService } from '../file-indexing/workspace-indexer.service';
import { WorkspaceAnalyzerService } from '../composite/workspace-analyzer.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { ContextService } from '../context/context.service';
import { FileRelevanceScorerService } from '../context-analysis/file-relevance-scorer.service';
import { ContextSizeOptimizerService } from '../context-analysis/context-size-optimizer.service';
import { ContextOrchestrationService } from '../context/context-orchestration.service';
import { TreeSitterParserService } from '../ast/tree-sitter-parser.service';
import { AstAnalysisService } from '../ast/ast-analysis.service';
import { DependencyGraphService } from '../ast/dependency-graph.service';
import { ContextEnrichmentService } from '../context-analysis/context-enrichment.service';
import { AgentDiscoveryService } from '../autocomplete/agent-discovery.service';
import { CommandDiscoveryService } from '../autocomplete/command-discovery.service';
import { registerQualityServices } from '../quality/di';
import { CodeSymbolIndexer } from '../services/code-symbol-indexer.service';

/**
 * DI token for the CodeSymbolIndexer singleton.
 * Exported so all host apps and consumers can import one canonical value
 * instead of duplicating the Symbol.for() string literal.
 */
export const CODE_SYMBOL_INDEXER = Symbol.for('PtahCodeSymbolIndexer');
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
 * Tier 8: Quality assessment services - 4 services
 *
 * @param container - TSyringe DI container
 * @param logger - Logger instance
 */
export function registerWorkspaceIntelligenceServices(
  container: DependencyContainer,
  logger: Logger,
): void {
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
  container.registerSingleton(
    TOKENS.WORKSPACE_INDEXER_SERVICE,
    WorkspaceIndexerService,
  );
  container.registerSingleton(
    TOKENS.WORKSPACE_ANALYZER_SERVICE,
    WorkspaceAnalyzerService,
  );
  container.registerSingleton(TOKENS.WORKSPACE_SERVICE, WorkspaceService);
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
  container.registerSingleton(
    TOKENS.TREE_SITTER_PARSER_SERVICE,
    TreeSitterParserService,
  );
  container.registerSingleton(TOKENS.AST_ANALYSIS_SERVICE, AstAnalysisService);
  container.registerSingleton(
    TOKENS.DEPENDENCY_GRAPH_SERVICE,
    DependencyGraphService,
  );
  configureArchitectureRules(
    container.resolve<TreeSitterParserService>(
      TOKENS.TREE_SITTER_PARSER_SERVICE,
    ),
  );
  container.registerSingleton(
    TOKENS.CONTEXT_ENRICHMENT_SERVICE,
    ContextEnrichmentService,
  );
  container.registerSingleton(
    TOKENS.AGENT_DISCOVERY_SERVICE,
    AgentDiscoveryService,
  );
  container.registerSingleton(
    TOKENS.COMMAND_DISCOVERY_SERVICE,
    CommandDiscoveryService,
  );
  registerQualityServices(container, logger);
  container.registerSingleton(CODE_SYMBOL_INDEXER, CodeSymbolIndexer);

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
