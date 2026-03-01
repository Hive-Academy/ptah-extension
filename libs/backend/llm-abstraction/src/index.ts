/**
 * LLM Abstraction Library - Main Entry Point
 *
 * @packageDocumentation
 *
 * This is the core entry point for the LLM abstraction library.
 * It exports interfaces, errors, base classes, services, and DI registration.
 *
 * Only the VS Code Language Model provider is supported.
 * The vscode-lm provider is loaded via its secondary entry point for tree-shaking.
 *
 * @example
 * ```typescript
 * // Core imports (always safe, no heavy deps)
 * import {
 *   LlmService,
 *   ProviderRegistry,
 *   LlmSecretsService,
 *   LlmConfigurationService,
 *   registerLlmAbstractionServices
 * } from '@ptah-extension/llm-abstraction';
 *
 * // Provider import (only loads vscode-lm deps)
 * import { createVsCodeLmProvider } from '@ptah-extension/llm-abstraction/vscode-lm';
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
// PROVIDERS - Use secondary entry point
// ========================================
// The vscode-lm provider is intentionally NOT exported here to enable tree-shaking.
// Import from the secondary entry point:
//
// import { VsCodeLmProvider, createVsCodeLmProvider } from '@ptah-extension/llm-abstraction/vscode-lm';
