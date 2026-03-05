/**
 * LLM Namespace Builder
 *
 * Builds the LLM namespace providing access to the VS Code Language Model API.
 * Enables Claude CLI to delegate tasks to VS Code LM models.
 *
 * Provider namespaces:
 * - ptah.llm.vscodeLm.chat() - VS Code Language Model API (always available)
 *
 * Utility methods:
 * - ptah.llm.getConfiguredProviders() - List providers with API keys
 * - ptah.llm.getDefaultProvider() - Get configured default provider
 * - ptah.llm.chat() - Chat with default provider
 */

import type {
  LLMNamespace,
  LLMProviderNamespace,
  LLMChatOptions,
  LLMConfiguredProvider,
} from '../types';
import type { LlmService } from '@ptah-extension/llm-abstraction';
import type { LlmConfigurationService } from '@ptah-extension/llm-abstraction';
import type {
  ILlmSecretsService,
  LlmProviderName,
} from '@ptah-extension/llm-abstraction';

/**
 * Dependencies for LLM namespace builders
 */
export interface LlmNamespaceDependencies {
  llmService: LlmService;
  configService: LlmConfigurationService;
  secretsService: ILlmSecretsService;
}

/**
 * Build a provider-specific namespace (e.g., ptah.llm.anthropic)
 */
function buildProviderNamespace(
  deps: LlmNamespaceDependencies,
  providerName: LlmProviderName
): LLMProviderNamespace {
  return {
    /**
     * Send a chat message to this provider
     * @param message - User message to send
     * @param options - Optional chat configuration
     * @returns Complete model response text
     */
    chat: async (
      message: string,
      options?: LLMChatOptions
    ): Promise<string> => {
      const model =
        options?.model ?? deps.configService.getDefaultModel(providerName);

      // Set provider and model
      const setResult = await deps.llmService.setProvider(providerName, model);
      if (setResult.isErr()) {
        throw new Error(
          `Failed to initialize ${providerName} provider: ${
            setResult.error?.message ?? 'Unknown error'
          }`
        );
      }

      // Get completion
      const systemPrompt =
        options?.systemPrompt ?? 'You are a helpful assistant.';
      const completionResult = await deps.llmService.getCompletion(
        systemPrompt,
        message
      );

      if (completionResult.isErr()) {
        throw new Error(
          `${providerName} chat failed: ${completionResult.error?.message ?? 'Unknown error'}`
        );
      }

      return completionResult.value ?? '';
    },

    /**
     * Check if this provider is available (has API key configured)
     * @returns true if provider can be used
     */
    isAvailable: async (): Promise<boolean> => {
      return deps.secretsService.hasApiKey(providerName);
    },

    /**
     * Get the default model for this provider
     * @returns Default model identifier
     */
    getDefaultModel: (): string => {
      return deps.configService.getDefaultModel(providerName);
    },

    /**
     * Get display name for this provider
     * @returns Human-readable provider name
     */
    getDisplayName: (): string => {
      return deps.configService.getProviderDisplayName(providerName);
    },
  };
}

/**
 * Build the complete LLM namespace with all provider sub-namespaces
 */
export function buildLLMNamespace(
  deps: LlmNamespaceDependencies
): LLMNamespace {
  return {
    // VS Code LM provider only (SDK-only migration)
    vscodeLm: buildProviderNamespace(deps, 'vscode-lm'),

    /**
     * Chat with the default configured provider
     * @param message - User message to send
     * @param options - Optional chat configuration
     * @returns Complete model response text
     */
    chat: async (
      message: string,
      options?: LLMChatOptions
    ): Promise<string> => {
      const providerName = deps.configService.getDefaultProvider();
      const model =
        options?.model ?? deps.configService.getDefaultModel(providerName);

      // Set provider and model
      const setResult = await deps.llmService.setProvider(providerName, model);
      if (setResult.isErr()) {
        throw new Error(
          `Failed to initialize default provider (${providerName}): ${
            setResult.error?.message ?? 'Unknown error'
          }`
        );
      }

      // Get completion
      const systemPrompt =
        options?.systemPrompt ?? 'You are a helpful assistant.';
      const completionResult = await deps.llmService.getCompletion(
        systemPrompt,
        message
      );

      if (completionResult.isErr()) {
        throw new Error(`Chat failed: ${completionResult.error?.message ?? 'Unknown error'}`);
      }

      return completionResult.value ?? '';
    },

    /**
     * Get list of configured providers (those with API keys)
     * @returns Array of configured provider info
     */
    getConfiguredProviders: async (): Promise<LLMConfiguredProvider[]> => {
      const configs = await deps.configService.getAvailableProviders();
      return configs.map((config) => ({
        name: config.provider,
        displayName: config.displayName,
        defaultModel: config.model,
        isConfigured: config.isConfigured,
      }));
    },

    /**
     * Get the default provider name from settings
     * @returns Default provider identifier
     */
    getDefaultProvider: (): LlmProviderName => {
      return deps.configService.getDefaultProvider();
    },

    /**
     * Get configuration summary for all providers
     * @returns Full configuration state
     */
    getConfiguration: async () => {
      const config = await deps.configService.getConfiguration();
      return {
        defaultProvider: config.defaultProvider,
        providers: config.providers.map((p) => ({
          name: p.provider,
          displayName: p.displayName,
          defaultModel: p.model,
          isConfigured: p.isConfigured,
        })),
      };
    },
  };
}
