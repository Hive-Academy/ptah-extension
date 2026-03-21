/**
 * LLM Abstraction Library - Main Entry Point
 *
 * @packageDocumentation
 *
 * This is the core entry point for the LLM abstraction library.
 * It exports interfaces, errors, base classes, services, and DI registration.
 *
 * TASK_2025_209: VsCodeLmProvider removed (platform unification).
 * LLM calls now go through Agent SDK's InternalQueryService or CLI adapters.
 *
 * @example
 * ```typescript
 * import {
 *   LlmService,
 *   ProviderRegistry,
 *   LlmSecretsService,
 *   LlmConfigurationService,
 *   registerLlmAbstractionServices
 * } from '@ptah-extension/llm-abstraction';
 * ```
 */

// ========================================
// Interfaces
// ========================================
export * from './lib/interfaces/llm-provider.interface';

// ========================================
// Errors
// ========================================
export * from './lib/errors/llm-provider.error';

// ========================================
// Base Provider (for extension only)
// ========================================
export { BaseLlmProvider } from './lib/providers/base-llm.provider';

// ========================================
// Registry
// ========================================
export { ProviderRegistry } from './lib/registry/provider-registry';

// ========================================
// Services
// ========================================
export { LlmService } from './lib/services/llm.service';
export {
  LlmSecretsService,
  type LlmProviderName,
  type ILlmSecretsService,
  API_KEY_PROVIDERS,
} from './lib/services/llm-secrets.service';
export {
  LlmConfigurationService,
  type LlmProviderConfig,
  type LlmConfiguration,
} from './lib/services/llm-configuration.service';
// ========================================
// DI Registration
// ========================================
export { registerLlmAbstractionServices } from './lib/di';

// ========================================
// Agent Orchestration (TASK_2025_157)
// ========================================
export { CliDetectionService } from './lib/services/cli-detection.service';
export { AgentProcessManager } from './lib/services/agent-process-manager.service';
export type {
  CliAdapter,
  CliCommand,
  CliCommandOptions,
  CliModelInfo,
  SdkHandle,
} from './lib/services/cli-adapters';

// ========================================
// Copilot SDK Permission Bridge (TASK_2025_162)
// ========================================
export { CopilotPermissionBridge } from './lib/services/cli-adapters';

// ========================================
// CLI Skill Sync (TASK_2025_160)
// ========================================
export { CliPluginSyncService } from './lib/services/cli-skill-sync';
export type { ICliSkillInstaller } from './lib/services/cli-skill-sync';

// ========================================
// PROVIDERS
// ========================================
// TASK_2025_209: VsCodeLmProvider removed (platform unification).
// LLM calls now go through Agent SDK (InternalQueryService) or CLI adapters.
