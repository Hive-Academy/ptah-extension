/**
 * Electron DI — Phase 2: Library registrations.
 *
 * TASK_2025_291 Wave C1 Step 2b: Split from the monolithic container.ts.
 *
 * Registers (in order):
 *   - Phase 2.1: workspace-intelligence
 *   - Phase 2.2: agent-sdk + TOKENS.AGENT_ADAPTER factory
 *   - Phase 2.2.5: WEBVIEW_MESSAGE_HANDLER / WEBVIEW_HTML_GENERATOR stubs
 *   - Phase 2.3: agent-generation
 *   - Phase 2.3.5: SETUP_WIZARD_SERVICE override (ElectronSetupWizardService)
 *   - Phase 2.5: llm-abstraction
 */

import type { DependencyContainer } from 'tsyringe';

import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { registerWorkspaceIntelligenceServices } from '@ptah-extension/workspace-intelligence';
import {
  registerSdkServices,
  SDK_TOKENS,
  SdkAgentAdapter,
} from '@ptah-extension/agent-sdk';
import {
  registerAgentGenerationServices,
  AGENT_GENERATION_TOKENS,
} from '@ptah-extension/agent-generation';
import { registerLlmAbstractionServices } from '@ptah-extension/llm-abstraction';

import { ElectronSetupWizardService } from '../services/electron-setup-wizard.service';

/**
 * Phase 2: Register library services in the order required by inter-library deps.
 *
 * Prerequisites: Phase 1 shims (FILE_SYSTEM_MANAGER, CONFIG_MANAGER,
 * EXTENSION_CONTEXT) must already be registered — workspace-intelligence,
 * agent-sdk, and llm-abstraction resolve them at registration time.
 */
export function registerPhase2Libraries(
  container: DependencyContainer,
  logger: Logger,
): void {
  // ========================================
  // PHASE 2.1: Workspace Intelligence
  // ========================================
  registerWorkspaceIntelligenceServices(container, logger);

  // ========================================
  // PHASE 2.2: Agent SDK (Claude Agent SDK integration)
  // ========================================
  // NOTE: registerVsCodeLmToolsServices is called in Phase 3 (TASK_2025_226 decoupled it from VS Code)
  registerSdkServices(container, logger);

  // TOKENS.AGENT_ADAPTER -> SdkAgentAdapter (direct binding, deep-agent removed TASK_2025_293)
  // NOTE: tsyringe rejects Lifecycle.Singleton with factory providers. The factory
  // delegates to SDK_TOKENS.SDK_AGENT_ADAPTER which is already registered as a
  // singleton (useClass + Lifecycle.Singleton in registerSdkServices), so every
  // call returns the same cached instance.
  container.register(TOKENS.AGENT_ADAPTER, {
    useFactory: (c) => c.resolve<SdkAgentAdapter>(SDK_TOKENS.SDK_AGENT_ADAPTER),
  });

  // ========================================
  // PHASE 2.2.5: WEBVIEW_MESSAGE_HANDLER and WEBVIEW_HTML_GENERATOR stubs (TASK_2025_214)
  // ========================================
  // These tokens are required by WizardWebviewLifecycleService which is registered
  // unconditionally inside registerAgentGenerationServices(). In Electron, the wizard
  // uses ElectronSetupWizardService instead, so these are no-op stubs to prevent
  // DI resolution failures.
  try {
    container.register(TOKENS.WEBVIEW_MESSAGE_HANDLER, { useValue: {} });
    container.register(TOKENS.WEBVIEW_HTML_GENERATOR, { useValue: {} });
    logger.info(
      '[Electron DI] WEBVIEW_MESSAGE_HANDLER and WEBVIEW_HTML_GENERATOR stubs registered (TASK_2025_214)',
    );
  } catch (error) {
    logger.error(
      '[Electron DI] Failed to register webview stubs for WizardWebviewLifecycleService',
      { error: error instanceof Error ? error.message : String(error) },
    );
  }

  // ========================================
  // PHASE 2.3: Agent Generation (template storage, setup wizard)
  // ========================================
  registerAgentGenerationServices(container, logger);

  // ========================================
  // PHASE 2.3.5: Override SETUP_WIZARD_SERVICE with Electron-specific implementation (TASK_2025_214)
  // ========================================
  // ElectronSetupWizardService uses IPC navigation (broadcastMessage) instead of
  // VS Code webview panels. Registered AFTER registerAgentGenerationServices() so
  // it overrides the default SetupWizardService at AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE.
  container.register(AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE, {
    useClass: ElectronSetupWizardService,
  });
  logger.info(
    '[Electron DI] ElectronSetupWizardService registered (overrides SetupWizardService) (TASK_2025_214)',
  );

  // Phase 2.4: Wire multi-phase analysis reader into EnhancedPromptsService
  // DEFERRED to main.ts Phase 4.6 (after WebviewManager registration).
  // Resolving EnhancedPromptsService here fails because the dependency chain
  // reaches SdkPermissionHandler which requires TOKENS.WEBVIEW_MANAGER,
  // and that is only registered in main.ts after IPC bridge initialization.

  // ========================================
  // PHASE 2.5: CLI Abstraction (TASK_2025_212: vestigial LLM services removed, CLI services only)
  // ========================================
  registerLlmAbstractionServices(container, logger);
}
