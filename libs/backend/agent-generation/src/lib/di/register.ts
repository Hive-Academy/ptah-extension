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
import { OutputValidationService } from '../services/output-validation.service';
import { VsCodeLmService } from '../services/vscode-lm.service';
import {
  WizardContextMapperService,
  WizardStepMachineService,
  WizardSessionManagerService,
  CodeHealthAnalysisService,
  DeepProjectAnalysisService,
  WizardWebviewLifecycleService,
  AgenticAnalysisService,
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
  logger: Logger,
  extensionPath?: string
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
  // Uses factory registration to handle optional templatesPath parameter
  // (tsyringe cannot inject primitive types without explicit tokens)
  container.register(AGENT_GENERATION_TOKENS.TEMPLATE_STORAGE_SERVICE, {
    useFactory: (c) => {
      const loggerInstance = c.resolve<Logger>(TOKENS.LOGGER);
      const templatesPath = extensionPath
        ? join(extensionPath, 'templates', 'agents')
        : undefined;
      return new TemplateStorageService(loggerInstance, templatesPath);
    },
  });

  // Wizard context mapper service - frontend-to-backend context transformation
  container.register(
    AGENT_GENERATION_TOKENS.WIZARD_CONTEXT_MAPPER,
    { useClass: WizardContextMapperService },
    { lifecycle: Lifecycle.Singleton }
  );

  // Wizard step machine service - step state machine and transition logic
  container.register(
    AGENT_GENERATION_TOKENS.WIZARD_STEP_MACHINE,
    { useClass: WizardStepMachineService },
    { lifecycle: Lifecycle.Singleton }
  );

  // Wizard session manager service - session CRUD and persistence
  container.register(
    AGENT_GENERATION_TOKENS.WIZARD_SESSION_MANAGER,
    { useClass: WizardSessionManagerService },
    { lifecycle: Lifecycle.Singleton }
  );

  // Code health analysis service - diagnostics, conventions, test coverage
  container.register(
    AGENT_GENERATION_TOKENS.CODE_HEALTH_ANALYSIS,
    { useClass: CodeHealthAnalysisService },
    { lifecycle: Lifecycle.Singleton }
  );

  // Analysis storage service - persistent analysis file I/O
  container.register(
    AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE,
    { useClass: AnalysisStorageService },
    { lifecycle: Lifecycle.Singleton }
  );

  // ============================================================
  // Mid-level Services (depend on foundation services)
  // ============================================================

  // Deep project analysis service - architecture detection, key locations, language stats
  // Note: Depends on AGENT_GENERATION_ORCHESTRATOR and CODE_HEALTH_ANALYSIS
  container.register(
    AGENT_GENERATION_TOKENS.DEEP_PROJECT_ANALYSIS,
    { useClass: DeepProjectAnalysisService },
    { lifecycle: Lifecycle.Singleton }
  );

  // Agentic analysis service - Claude Agent SDK-powered workspace analysis
  // Note: Depends on SDK_AGENT_ADAPTER, SDK_MODULE_LOADER (registered in Phase 2.7), WEBVIEW_MANAGER
  container.register(
    AGENT_GENERATION_TOKENS.AGENTIC_ANALYSIS_SERVICE,
    { useClass: AgenticAnalysisService },
    { lifecycle: Lifecycle.Singleton }
  );

  // Wizard webview lifecycle service - panel creation, message handling, progress emission
  // Note: Depends on WEBVIEW_MANAGER, WEBVIEW_MESSAGE_HANDLER, WEBVIEW_HTML_GENERATOR from vscode-core
  container.register(
    AGENT_GENERATION_TOKENS.WIZARD_WEBVIEW_LIFECYCLE,
    { useClass: WizardWebviewLifecycleService },
    { lifecycle: Lifecycle.Singleton }
  );

  // VS Code LM service - LLM integration with retry logic
  container.register(
    AGENT_GENERATION_TOKENS.VSCODE_LM_SERVICE,
    { useClass: VsCodeLmService },
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
      'WIZARD_CONTEXT_MAPPER',
      'WIZARD_STEP_MACHINE',
      'WIZARD_SESSION_MANAGER',
      'CODE_HEALTH_ANALYSIS',
      'ANALYSIS_STORAGE_SERVICE',
      'DEEP_PROJECT_ANALYSIS',
      'AGENTIC_ANALYSIS_SERVICE',
      'WIZARD_WEBVIEW_LIFECYCLE',
      'VSCODE_LM_SERVICE',
      'AGENT_SELECTION_SERVICE',
      'AGENT_RECOMMENDATION_SERVICE',
      'CONTENT_GENERATION_SERVICE',
      'AGENT_FILE_WRITER_SERVICE',
      'AGENT_GENERATION_ORCHESTRATOR',
      'SETUP_STATUS_SERVICE',
      'SETUP_WIZARD_SERVICE',
    ],
  });
}
