/**
 * LLM Configuration Service
 *
 * Manages LLM provider configuration from VS Code settings.
 * Reads default provider and model settings, provides available provider info.
 *
 * @packageDocumentation
 */

import { injectable, inject } from 'tsyringe';
import { ConfigManager, TOKENS, Logger } from '@ptah-extension/vscode-core';
import {
  LlmProviderName,
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
    private readonly logger: Logger
  ) {
    this.logger.info('[LlmConfigurationService] Initialized');
  }

  /**
   * Get the default LLM provider
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
   * Get the default model for a specific provider
   * @param provider - Provider name
   * @returns Default model from settings, or built-in default
   */
  getDefaultModel(provider: LlmProviderName): string {
    // Map provider name to settings key
    const settingsKey = this.getProviderSettingsKey(provider);
    const model = this.config.get<string>(`llm.${settingsKey}.model`);

    if (model && model.trim().length > 0) {
      return model;
    }

    return DEFAULT_MODELS[provider];
  }

  /**
   * Get display name for a provider
   * @param provider - Provider name
   * @returns Human-readable display name
   */
  getProviderDisplayName(provider: LlmProviderName): string {
    return PROVIDER_DISPLAY_NAMES[provider] || provider;
  }

  /**
   * Get configuration for all available providers
   * @returns Array of provider configurations (only those with API keys)
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
   * Get full LLM configuration state
   * @returns Complete configuration including default provider and all providers
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
   * Handles cases where provider name differs from settings key (e.g., google-genai -> google)
   */
  private getProviderSettingsKey(provider: LlmProviderName): string {
    switch (provider) {
      case 'google-genai':
        return 'google';
      case 'vscode-lm':
        return 'vscode';
      default:
        return provider;
    }
  }
}
