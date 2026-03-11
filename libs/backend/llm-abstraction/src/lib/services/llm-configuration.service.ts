/**
 * LLM Configuration Service
 *
 * Manages LLM provider configuration from VS Code settings.
 * Reads default provider and model settings, provides available provider info.
 *
 * SDK-only migration: Only VS Code Language Model provider is supported.
 *
 * @packageDocumentation
 */

import { injectable, inject } from 'tsyringe';
import { ConfigManager, TOKENS, Logger } from '@ptah-extension/vscode-core';
import type { ExtensionContext } from 'vscode';
import {
  LlmProviderName,
  SUPPORTED_PROVIDERS,
  PROVIDER_DISPLAY_NAMES,
  DEFAULT_MODELS,
  isValidProviderName,
} from '../types/provider-types';
import type { ILlmSecretsService } from './llm-secrets.service';

/**
 * Configuration for a specific LLM provider
 */
export interface LlmProviderConfig {
  /** Provider identifier */
  provider: LlmProviderName;
  /** Default model for this provider */
  model: string;
  /** Whether provider has API key configured */
  isConfigured: boolean;
  /** Display name for UI */
  displayName: string;
}

/**
 * Full LLM configuration state
 */
export interface LlmConfiguration {
  /** Default provider to use */
  defaultProvider: LlmProviderName;
  /** All providers with their configurations */
  providers: LlmProviderConfig[];
}

/**
 * LLM Configuration Service Implementation
 *
 * Reads configuration from VS Code settings namespace `ptah.llm.*`
 *
 * Error Handling Pattern (TASK_2025_073 Batch 3):
 * - All methods have sensible defaults (never throw)
 * - Invalid configurations fall back to safe defaults
 * - All errors are logged before falling back
 */
@injectable()
export class LlmConfigurationService {
  constructor(
    @inject(TOKENS.CONFIG_MANAGER)
    private readonly config: ConfigManager,
    @inject(TOKENS.LLM_SECRETS_SERVICE)
    private readonly secrets: ILlmSecretsService,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,
    @inject(TOKENS.EXTENSION_CONTEXT)
    private readonly context: ExtensionContext
  ) {
    this.logger.info(
      '[LlmConfigurationService.constructor] Service initialized'
    );
  }

  /**
   * Get the default LLM provider from VS Code settings.
   *
   * Reads `ptah.llm.defaultProvider` setting.
   * Falls back to 'vscode-lm' if not configured or invalid.
   *
   * @returns Default provider name from settings, or 'vscode-lm' if not set
   */
  getDefaultProvider(): LlmProviderName {
    const provider = this.config.get<string>('llm.defaultProvider');

    // Validate it's a known provider
    if (provider && this.isValidProvider(provider)) {
      return provider as LlmProviderName;
    }

    return 'vscode-lm';
  }

  /**
   * Get the default model for a specific provider.
   *
   * Reads provider-specific settings (e.g., `ptah.llm.vscode.model`).
   * Falls back to built-in defaults from DEFAULT_MODELS constant.
   *
   * @param provider - Provider name (vscode-lm)
   * @returns Default model identifier from settings, or built-in default
   */
  getDefaultModel(provider: LlmProviderName): string {
    const settingsKey = this.getProviderSettingsKey(provider);

    // Check globalState first (fallback storage when settings.json was dirty)
    const globalStateKey = `ptah.llm.${settingsKey}.model`;
    const globalStateModel =
      this.context.globalState.get<string>(globalStateKey);
    if (globalStateModel && globalStateModel.trim().length > 0) {
      return globalStateModel;
    }

    // Then check VS Code settings
    const model = this.config.get<string>(`llm.${settingsKey}.model`);
    if (model && model.trim().length > 0) {
      return model;
    }

    return DEFAULT_MODELS[provider];
  }

  /**
   * Get display name for a provider.
   *
   * Returns human-readable name for UI presentation.
   *
   * @param provider - Provider name (vscode-lm)
   * @returns Human-readable display name (e.g., "VS Code Language Model")
   */
  getProviderDisplayName(provider: LlmProviderName): string {
    return PROVIDER_DISPLAY_NAMES[provider] || provider;
  }

  /**
   * Get configuration for all available providers.
   *
   * Returns providers that are available for use.
   * vscode-lm is always available (no API key needed).
   *
   * @returns Array of provider configurations
   */
  async getAvailableProviders(): Promise<LlmProviderConfig[]> {
    const configuredProviders = await this.secrets.getConfiguredProviders();

    const configs = configuredProviders.map((provider) => ({
      provider,
      model: this.getDefaultModel(provider),
      isConfigured: true,
      displayName: this.getProviderDisplayName(provider),
    }));

    this.logger.debug('[LlmConfigurationService] getAvailableProviders', {
      count: configs.length,
      providers: configs.map((c) => c.provider),
    });

    return configs;
  }

  /**
   * Get configuration for ALL supported providers (configured or not).
   *
   * Unlike getAvailableProviders() which only returns providers with API keys,
   * this method returns every supported provider with an isConfigured flag.
   * Used by the settings UI to always show provider cards.
   *
   * @returns Array of all provider configurations with isConfigured status
   */
  async getAllProviders(): Promise<LlmProviderConfig[]> {
    const configs: LlmProviderConfig[] = [];

    for (const provider of SUPPORTED_PROVIDERS) {
      // vscode-lm is always configured (no API key needed)
      const isConfigured =
        provider === 'vscode-lm'
          ? true
          : await this.secrets.hasApiKey(provider);

      configs.push({
        provider,
        model: this.getDefaultModel(provider),
        isConfigured,
        displayName: this.getProviderDisplayName(provider),
      });
    }

    this.logger.debug('[LlmConfigurationService] getAllProviders', {
      count: configs.length,
      configured: configs.filter((c) => c.isConfigured).length,
    });

    return configs;
  }

  /**
   * Get full LLM configuration state.
   *
   * Returns complete configuration snapshot including default provider and all available providers.
   *
   * @returns Complete configuration including default provider and all available providers
   */
  async getConfiguration(): Promise<LlmConfiguration> {
    const defaultProvider = this.getDefaultProvider();
    const providers = await this.getAvailableProviders();

    return {
      defaultProvider,
      providers,
    };
  }

  /**
   * Check if a provider string is a valid LlmProviderName
   */
  private isValidProvider(provider: string): provider is LlmProviderName {
    return isValidProviderName(provider);
  }

  /**
   * Map provider name to settings key
   */
  private getProviderSettingsKey(provider: LlmProviderName): string {
    switch (provider) {
      case 'vscode-lm':
        return 'vscode';
      default:
        return provider;
    }
  }
}
