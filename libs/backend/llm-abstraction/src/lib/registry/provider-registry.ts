import { injectable } from 'tsyringe';
import { Result } from '@ptah-extension/shared';
import {
  ILlmProvider,
  LlmProviderFactory,
} from '../interfaces/llm-provider.interface';
import { LlmProviderError } from '../errors/llm-provider.error';
import { AnthropicProvider } from '../providers/anthropic.provider';
import { OpenAIProvider } from '../providers/openai.provider';
import { GoogleGenAIProvider } from '../providers/google-genai.provider';
import { OpenRouterProvider } from '../providers/openrouter.provider';

/**
 * Registry to manage LLM provider factories.
 * Creates provider instances on-demand based on provider name.
 *
 * Supported providers:
 * - anthropic (Claude)
 * - openai (GPT-4, GPT-3.5-turbo)
 * - google-genai (Gemini)
 * - openrouter (Multi-provider access)
 */
@injectable()
export class ProviderRegistry {
  private readonly providerFactories: Map<string, LlmProviderFactory>;

  constructor() {
    this.providerFactories = new Map();

    // Register provider factories
    this.providerFactories.set('anthropic', this.createAnthropicProvider);
    this.providerFactories.set('openai', this.createOpenAIProvider);
    this.providerFactories.set('google-genai', this.createGoogleGenAIProvider);
    this.providerFactories.set('openrouter', this.createOpenRouterProvider);
  }

  /**
   * Create a provider instance for the given provider name.
   * @param providerName Name of the provider (anthropic, openai, google-genai, openrouter)
   * @param apiKey API key for the provider
   * @param model Model name to use
   * @returns Result containing provider instance or error
   */
  public createProvider(
    providerName: string,
    apiKey: string,
    model: string
  ): Result<ILlmProvider, LlmProviderError> {
    const factory = this.providerFactories.get(providerName.toLowerCase());
    if (!factory) {
      const message = `LLM provider '${providerName}' not found. Available: ${Array.from(
        this.providerFactories.keys()
      ).join(', ')}`;
      return Result.err(
        new LlmProviderError(message, 'PROVIDER_NOT_FOUND', 'ProviderRegistry')
      );
    }

    try {
      return factory(apiKey, model);
    } catch (error) {
      return Result.err(LlmProviderError.fromError(error, 'ProviderRegistry'));
    }
  }

  /**
   * Get the factory function for a specific provider.
   * @param providerName Name of the provider
   * @returns Result containing factory function or error
   */
  public getProviderFactory(
    providerName: string
  ): Result<LlmProviderFactory, LlmProviderError> {
    const factory = this.providerFactories.get(providerName.toLowerCase());
    if (!factory) {
      const message = `LLM provider factory '${providerName}' not found. Available: ${Array.from(
        this.providerFactories.keys()
      ).join(', ')}`;
      return Result.err(
        new LlmProviderError(message, 'PROVIDER_NOT_FOUND', 'ProviderRegistry')
      );
    }
    return Result.ok(factory);
  }

  /**
   * List all available provider names.
   * @returns Array of provider names
   */
  public getAvailableProviders(): string[] {
    return Array.from(this.providerFactories.keys());
  }

  /**
   * Factory function for Anthropic Claude provider.
   * @private
   */
  private createAnthropicProvider(
    apiKey: string,
    model: string
  ): Result<ILlmProvider, LlmProviderError> {
    try {
      if (!apiKey) {
        return Result.err(
          new LlmProviderError(
            'API key is required for Anthropic provider',
            'API_KEY_MISSING',
            'anthropic'
          )
        );
      }
      const provider = new AnthropicProvider(apiKey, model);
      return Result.ok(provider);
    } catch (error) {
      return Result.err(LlmProviderError.fromError(error, 'anthropic'));
    }
  }

  /**
   * Factory function for OpenAI GPT provider.
   * @private
   */
  private createOpenAIProvider(
    apiKey: string,
    model: string
  ): Result<ILlmProvider, LlmProviderError> {
    try {
      if (!apiKey) {
        return Result.err(
          new LlmProviderError(
            'API key is required for OpenAI provider',
            'API_KEY_MISSING',
            'openai'
          )
        );
      }
      const provider = new OpenAIProvider(apiKey, model);
      return Result.ok(provider);
    } catch (error) {
      return Result.err(LlmProviderError.fromError(error, 'openai'));
    }
  }

  /**
   * Factory function for Google Gemini provider.
   * @private
   */
  private createGoogleGenAIProvider(
    apiKey: string,
    model: string
  ): Result<ILlmProvider, LlmProviderError> {
    try {
      if (!apiKey) {
        return Result.err(
          new LlmProviderError(
            'API key is required for Google GenAI provider',
            'API_KEY_MISSING',
            'google-genai'
          )
        );
      }
      const provider = new GoogleGenAIProvider(apiKey, model);
      return Result.ok(provider);
    } catch (error) {
      return Result.err(LlmProviderError.fromError(error, 'google-genai'));
    }
  }

  /**
   * Factory function for OpenRouter provider.
   * @private
   */
  private createOpenRouterProvider(
    apiKey: string,
    model: string
  ): Result<ILlmProvider, LlmProviderError> {
    try {
      if (!apiKey) {
        return Result.err(
          new LlmProviderError(
            'API key is required for OpenRouter provider',
            'API_KEY_MISSING',
            'openrouter'
          )
        );
      }
      const provider = new OpenRouterProvider(apiKey, model);
      return Result.ok(provider);
    } catch (error) {
      return Result.err(LlmProviderError.fromError(error, 'openrouter'));
    }
  }
}
