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
   *
   * @example
   * ```typescript
   * const defaultProvider = configService.getDefaultProvider();
   * console.log(`Default: ${defaultProvider}`); // "anthropic" or "vscode-lm"
   * ```
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
   * Reads provider-specific settings (e.g., `ptah.llm.anthropic.model`).
   * Falls back to built-in defaults from DEFAULT_MODELS constant.
   *
   * @param provider - Provider name (anthropic, openai, etc.)
   * @returns Default model identifier from settings, or built-in default
   *
   * @example
   * ```typescript
   * const model = configService.getDefaultModel('anthropic');
   * console.log(model); // "claude-sonnet-4-20250514" (from settings or default)
   * ```
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
   * Get display name for a provider.
   *
   * Returns human-readable name for UI presentation.
   * Uses PROVIDER_DISPLAY_NAMES constant, falls back to provider name.
   *
   * @param provider - Provider name (anthropic, openai, etc.)
   * @returns Human-readable display name (e.g., "Anthropic (Claude)", "OpenAI (GPT)")
   *
   * @example
   * ```typescript
   * const displayName = configService.getProviderDisplayName('anthropic');
   * console.log(displayName); // "Anthropic (Claude)"
   * ```
   */
  getProviderDisplayName(provider: LlmProviderName): string {
    return PROVIDER_DISPLAY_NAMES[provider] || provider;
  }

  /**
   * Get configuration for all available providers.
   *
   * Returns only providers with configured API keys (from SecretStorage).
   * Each provider includes display name, default model, and availability status.
   *
   * @returns Array of provider configurations (only those with API keys)
   *
   * @example
   * ```typescript
   * const providers = await configService.getAvailableProviders();
   * providers.forEach(p => {
   *   console.log(`${p.displayName}: ${p.model} (configured: ${p.isConfigured})`);
   * });
   * ```
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
   * Get full LLM configuration state.
   *
   * Returns complete configuration snapshot including default provider and all available providers.
   * Useful for UI rendering or configuration validation.
   *
   * @returns Complete configuration including default provider and all available providers
   *
   * @example
   * ```typescript
   * const config = await configService.getConfiguration();
   * console.log(`Default: ${config.defaultProvider}`);
   * console.log(`Available: ${config.providers.length} providers`);
   * ```
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
