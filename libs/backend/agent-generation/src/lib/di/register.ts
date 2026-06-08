/**
 * Agent Generation DI Registration
 *
 * Pattern: Follow agent-sdk registration pattern for consistency.
 * Services use @injectable() decorators for auto-wiring.
 *
 * NOTE: This is a minimal registration for setup-status and setup-wizard functionality.
 * Full agent generation features (orchestrator, file writer, etc.) are registered
 * but may require additional dependencies to be fully functional.
 */

import { DependencyContainer, Lifecycle } from 'tsyringe';
import {
  TOKENS,
  type Logger,
  type SentryService,
} from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  ContentDownloadService,
} from '@ptah-extension/platform-core';
import { AGENT_GENERATION_TOKENS } from '../di/tokens';
import { SetupStatusService } from '../services/setup-status.service';
import { SetupWizardService } from '../services/setup-wizard.service';
import { AgentGenerationOrchestratorService } from '../services/orchestrator.service';
import { AgentSelectionService } from '../services/agent-selection.service';
import { AgentRecommendationService } from '../services/agent-recommendation.service';
import { TemplateStorageService } from '../services/template-storage.service';
import { ContentGenerationService } from '../services/content-generation.service';
import { AgentFileWriterService } from '../services/file-writer.service';
import { MultiCliAgentWriterService } from '../services/cli-agent-transforms/multi-cli-agent-writer.service';
import { OutputValidationService } from '../services/output-validation.service';
import {
  WizardWebviewLifecycleService,
  AgenticAnalysisService,
  MultiPhaseAnalysisService,
} from '../services/wizard';
import { AnalysisStorageService } from '../services/analysis-storage.service';
import {
  PromptDesignerAgent,
  PromptCacheService,
} from '../services/prompt-designer';
import { EnhancedPromptsService } from '../services/enhanced-prompts/enhanced-prompts.service';
import { UserLayerMirrorService } from '../services/user-layer/user-layer-mirror.service';

/**
 * Register all agent-generation services in DI container
 *
 * IMPORTANT: This must be called AFTER workspace-intelligence and vscode-core services
 * are registered, as agent-generation services depend on them.
 *
 * @param container - TSyringe DI container
 * @param logger - Logger instance for debugging
 */
export function registerAgentGenerationServices(
  container: DependencyContainer,
  logger: Logger,
): void {
  logger.info('[AgentGeneration] Registering agent-generation services...');
  container.register(
    AGENT_GENERATION_TOKENS.OUTPUT_VALIDATION_SERVICE,
    { useClass: OutputValidationService },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(AGENT_GENERATION_TOKENS.TEMPLATE_STORAGE_SERVICE, {
    useFactory: (c) => {
      const loggerInstance = c.resolve<Logger>(TOKENS.LOGGER);
      const contentDownload = c.resolve<ContentDownloadService>(
        PLATFORM_TOKENS.CONTENT_DOWNLOAD,
      );
      const templatesPath = contentDownload.getTemplatesPath();
      const sentryService = c.resolve<SentryService>(TOKENS.SENTRY_SERVICE);
      return new TemplateStorageService(
        loggerInstance,
        sentryService,
        templatesPath,
      );
    },
  });
  container.register(
    AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE,
    { useClass: AnalysisStorageService },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    AGENT_GENERATION_TOKENS.AGENTIC_ANALYSIS_SERVICE,
    { useClass: AgenticAnalysisService },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    AGENT_GENERATION_TOKENS.MULTI_PHASE_ANALYSIS_SERVICE,
    { useClass: MultiPhaseAnalysisService },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    AGENT_GENERATION_TOKENS.WIZARD_WEBVIEW_LIFECYCLE,
    { useClass: WizardWebviewLifecycleService },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    AGENT_GENERATION_TOKENS.AGENT_SELECTION_SERVICE,
    { useClass: AgentSelectionService },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    AGENT_GENERATION_TOKENS.AGENT_RECOMMENDATION_SERVICE,
    { useClass: AgentRecommendationService },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    AGENT_GENERATION_TOKENS.CONTENT_GENERATION_SERVICE,
    { useClass: ContentGenerationService },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    AGENT_GENERATION_TOKENS.AGENT_FILE_WRITER_SERVICE,
    { useClass: AgentFileWriterService },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    AGENT_GENERATION_TOKENS.MULTI_CLI_AGENT_WRITER_SERVICE,
    { useClass: MultiCliAgentWriterService },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    AGENT_GENERATION_TOKENS.AGENT_GENERATION_ORCHESTRATOR,
    { useClass: AgentGenerationOrchestratorService },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    AGENT_GENERATION_TOKENS.SETUP_STATUS_SERVICE,
    { useClass: SetupStatusService },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE,
    { useClass: SetupWizardService },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    AGENT_GENERATION_TOKENS.PROMPT_DESIGNER_AGENT,
    { useClass: PromptDesignerAgent },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    AGENT_GENERATION_TOKENS.PROMPT_CACHE_SERVICE,
    { useClass: PromptCacheService },
    { lifecycle: Lifecycle.Singleton },
  );
  container.register(
    AGENT_GENERATION_TOKENS.ENHANCED_PROMPTS_SERVICE,
    { useClass: EnhancedPromptsService },
    { lifecycle: Lifecycle.Singleton },
  );
  container.registerSingleton(UserLayerMirrorService);
  container.register(AGENT_GENERATION_TOKENS.USER_LAYER_MIRROR_SERVICE, {
    useToken: UserLayerMirrorService,
  });

  logger.info('[AgentGeneration] Agent-generation services registered', {
    services: [
      'OUTPUT_VALIDATION_SERVICE',
      'TEMPLATE_STORAGE_SERVICE',
      'ANALYSIS_STORAGE_SERVICE',
      'AGENTIC_ANALYSIS_SERVICE',
      'MULTI_PHASE_ANALYSIS_SERVICE',
      'WIZARD_WEBVIEW_LIFECYCLE',
      'AGENT_SELECTION_SERVICE',
      'AGENT_RECOMMENDATION_SERVICE',
      'CONTENT_GENERATION_SERVICE',
      'AGENT_FILE_WRITER_SERVICE',
      'MULTI_CLI_AGENT_WRITER_SERVICE',
      'AGENT_GENERATION_ORCHESTRATOR',
      'SETUP_STATUS_SERVICE',
      'SETUP_WIZARD_SERVICE',
      'PROMPT_DESIGNER_AGENT',
      'PROMPT_CACHE_SERVICE',
      'ENHANCED_PROMPTS_SERVICE',
      'USER_LAYER_MIRROR_SERVICE',
    ],
  });
}
