/**
 * LLM Abstraction Library - Main Entry Point
 *
 * @packageDocumentation
 *
 * This is the core entry point for the LLM abstraction library.
 * It exports interfaces, errors, base classes, services, and DI registration.
 *
 * **IMPORTANT**: Individual providers are NOT exported here to enable tree-shaking.
 * Use secondary entry points for specific providers:
 *
 * - `@ptah-extension/llm-abstraction/vscode-lm` - VS Code LM (no external deps)
 * - `@ptah-extension/llm-abstraction/openai` - OpenAI GPT (native SDK)
 * - `@ptah-extension/llm-abstraction/google` - Google Gemini (native SDK)
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
 * // Provider imports (only loads that provider's deps)
 * import { createOpenAIProvider } from '@ptah-extension/llm-abstraction/openai';
 * import { createGoogleProvider } from '@ptah-extension/llm-abstraction/google';
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
// PROVIDERS - Use secondary entry points instead!
// ========================================
// Providers are intentionally NOT exported here to enable tree-shaking.
// Import from secondary entry points:
//
// import { VsCodeLmProvider, createVsCodeLmProvider } from '@ptah-extension/llm-abstraction/vscode-lm';
// import { OpenAIProvider, createOpenAIProvider } from '@ptah-extension/llm-abstraction/openai';
// import { GoogleGenAIProvider, createGoogleProvider } from '@ptah-extension/llm-abstraction/google';
