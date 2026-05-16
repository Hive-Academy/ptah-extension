/**
 * Shared RPC handler DI registrations.
 *
 * Each app (VS Code extension, Electron, CLI) used to inline these four
 * `container.register(..., { useFactory })` blocks in its phase file. After
 * `PLATFORM_TOKENS.DI_CONTAINER` was introduced, every constructor argument is
 * `@inject`-decorated, so the factories collapse to plain
 * `registerSingleton` calls. Consolidating them here eliminates the drift
 * window that caused the Sentry NODE-NESTJS-3X bug (SetupRpcHandlers wired
 * with the wrong slot-3 token across three apps).
 */

import type { DependencyContainer } from 'tsyringe';

import {
  SetupRpcHandlers,
  WizardGenerationRpcHandlers,
  EnhancedPromptsRpcHandlers,
  LlmRpcHandlers,
} from './handlers';

/**
 * Register the four shared RPC handler classes that previously required
 * per-app factory wirings. All four are now constructor-only, so a single
 * registration site keeps every app in lockstep.
 *
 * Call exactly once per container, after the dependencies these handlers
 * inject (LOGGER, RPC_HANDLER, MODEL_SETTINGS, SDK_PLUGIN_LOADER,
 * WORKSPACE_PROVIDER, SENTRY_SERVICE, PLATFORM_COMMANDS,
 * SDK_ENHANCED_PROMPTS_SERVICE, LICENSE_SERVICE, SAVE_DIALOG_PROVIDER,
 * and PLATFORM_TOKENS.DI_CONTAINER) have been registered.
 */
export function registerSharedRpcHandlers(
  container: DependencyContainer,
): void {
  container.registerSingleton(SetupRpcHandlers);
  container.registerSingleton(WizardGenerationRpcHandlers);
  container.registerSingleton(EnhancedPromptsRpcHandlers);
  container.registerSingleton(LlmRpcHandlers);
}
