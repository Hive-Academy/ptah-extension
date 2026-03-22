/**
 * LLM Abstraction Library - Main Entry Point
 *
 * @packageDocumentation
 *
 * TASK_2025_209: VsCodeLmProvider removed (platform unification).
 * TASK_2025_212: Vestigial LLM provider services removed (LlmService,
 * ProviderRegistry, LlmSecretsService, LlmConfigurationService).
 * These had no working providers and produced startup errors.
 *
 * Remaining exports: CLI agent detection/management, interfaces, errors,
 * and DI registration for CLI services only.
 *
 * @example
 * ```typescript
 * import {
 *   CliDetectionService,
 *   AgentProcessManager,
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
// Vestigial Service Types (DELETED in TASK_2025_212)
// ========================================
// LlmService, ILlmSecretsService, LlmConfigurationService — all removed.
// LLM abstraction layer is fully vestigial. All AI queries go through Agent SDK.
// LlmProviderName kept as it's used by CliDetectionService adapters.
export type { LlmProviderName } from './lib/services/llm-secrets.service';

// ========================================
// DI Registration (CLI services only - TASK_2025_212)
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
