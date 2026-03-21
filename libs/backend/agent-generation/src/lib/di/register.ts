/**
 * Agent Generation DI Registration
 * TASK_2025_069: Register all agent-generation services in DI container
 *
 * Pattern: Follow agent-sdk registration pattern for consistency.
 * Services use @injectable() decorators for auto-wiring.
 *
 * NOTE: This is a minimal registration for setup-status and setup-wizard functionality.
 * Full agent generation features (orchestrator, file writer, etc.) are registered
 * but may require additional dependencies to be fully functional.
 */

import { join } from 'path';
import { DependencyContainer, Lifecycle } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IPlatformInfo } from '@ptah-extension/platform-core';
import { AGENT_GENERATION_TOKENS } from '../di/tokens';

// Import services
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
  logger: Logger
): void {
  logger.info('[AgentGeneration] Registering agent-generation services...');

  // ============================================================
  // Foundation Services (no internal dependencies)
  // ============================================================

  // Output validation service - validates LLM outputs
  container.register(
    AGENT_GENERATION_TOKENS.OUTPUT_VALIDATION_SERVICE,
    { useClass: OutputValidationService },
    { lifecycle: Lifecycle.Singleton }
  );

  // Template storage service - loads and caches templates
  // Uses factory registration to resolve extensionPath from IPlatformInfo
  // (tsyringe cannot inject primitive types without explicit tokens)
  container.register(AGENT_GENERATION_TOKENS.TEMPLATE_STORAGE_SERVICE, {
    useFactory: (c) => {
      const loggerInstance = c.resolve<Logger>(TOKENS.LOGGER);
      const platformInfo = c.resolve<IPlatformInfo>(
        PLATFORM_TOKENS.PLATFORM_INFO
      );
      const templatesPath = platformInfo.extensionPath
        ? join(platformInfo.extensionPath, 'templates', 'agents')
        : undefined;
      return new TemplateStorageService(loggerInstance, templatesPath);
    },
  });

  // Analysis storage service - persistent analysis file I/O
  container.register(
    AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE,
    { useClass: AnalysisStorageService },
    { lifecycle: Lifecycle.Singleton }
  );

  // ============================================================
  // Mid-level Services (depend on foundation services)
  // ============================================================

  // Agentic analysis service - Claude Agent SDK-powered workspace analysis
  // Note: Depends on SDK_AGENT_ADAPTER, SDK_MODULE_LOADER (registered in Phase 2.7), WEBVIEW_MANAGER
  container.register(
    AGENT_GENERATION_TOKENS.AGENTIC_ANALYSIS_SERVICE,
    { useClass: AgenticAnalysisService },
    { lifecycle: Lifecycle.Singleton }
  );

  // Multi-phase analysis service - 4 LLM phases + deterministic synthesis
  container.register(
    AGENT_GENERATION_TOKENS.MULTI_PHASE_ANALYSIS_SERVICE,
    { useClass: MultiPhaseAnalysisService },
    { lifecycle: Lifecycle.Singleton }
  );

  // Wizard webview lifecycle service - panel creation, message handling, progress emission
  // Note: Depends on WEBVIEW_MANAGER, WEBVIEW_MESSAGE_HANDLER, WEBVIEW_HTML_GENERATOR from vscode-core
  container.register(
    AGENT_GENERATION_TOKENS.WIZARD_WEBVIEW_LIFECYCLE,
    { useClass: WizardWebviewLifecycleService },
    { lifecycle: Lifecycle.Singleton }
  );

  // Agent selection service - scores and selects agents
  container.register(
    AGENT_GENERATION_TOKENS.AGENT_SELECTION_SERVICE,
    { useClass: AgentSelectionService },
    { lifecycle: Lifecycle.Singleton }
  );

  // Agent recommendation service - deep analysis-based agent recommendations
  container.register(
    AGENT_GENERATION_TOKENS.AGENT_RECOMMENDATION_SERVICE,
    { useClass: AgentRecommendationService },
    { lifecycle: Lifecycle.Singleton }
  );

  // Content generation service - renders templates with variables
  container.register(
    AGENT_GENERATION_TOKENS.CONTENT_GENERATION_SERVICE,
    { useClass: ContentGenerationService },
    { lifecycle: Lifecycle.Singleton }
  );

  // Agent file writer service - atomic file writing with rollback
  container.register(
    AGENT_GENERATION_TOKENS.AGENT_FILE_WRITER_SERVICE,
    { useClass: AgentFileWriterService },
    { lifecycle: Lifecycle.Singleton }
  );

  // Multi-CLI agent writer service - transforms and writes for Copilot/Gemini (TASK_2025_160)
  container.register(
    AGENT_GENERATION_TOKENS.MULTI_CLI_AGENT_WRITER_SERVICE,
    { useClass: MultiCliAgentWriterService },
    { lifecycle: Lifecycle.Singleton }
  );

  // ============================================================
  // High-level Services (orchestration layer)
  // ============================================================

  // Agent generation orchestrator - coordinates 5-phase workflow
  container.register(
    AGENT_GENERATION_TOKENS.AGENT_GENERATION_ORCHESTRATOR,
    { useClass: AgentGenerationOrchestratorService },
    { lifecycle: Lifecycle.Singleton }
  );

  // Setup status service - detects agent configuration status
  container.register(
    AGENT_GENERATION_TOKENS.SETUP_STATUS_SERVICE,
    { useClass: SetupStatusService },
    { lifecycle: Lifecycle.Singleton }
  );

  // Setup wizard service - orchestrates wizard UI flow
  container.register(
    AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE,
    { useClass: SetupWizardService },
    { lifecycle: Lifecycle.Singleton }
  );

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
    ],
  });
}
