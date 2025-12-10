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
import { VsCodeLmProvider } from '../providers/vscode-lm.provider';

/**
 * Registry to manage LLM provider factories.
 * Creates provider instances on-demand based on provider name.
 *
 * Supported providers:
 * - anthropic (Claude)
 * - openai (GPT-4, GPT-3.5-turbo)
 * - google-genai (Gemini)
 * - openrouter (Multi-provider access)
 * - vscode-lm (VS Code Language Model API)
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
    this.providerFactories.set('vscode-lm', this.createVsCodeLmProvider);
  }

  /**
   * Create a provider instance for the given provider name.
   * Can return Promise for async factories (e.g., vscode-lm).
   * @param providerName Name of the provider (anthropic, openai, google-genai, openrouter, vscode-lm)
   * @param apiKey API key for the provider (may be empty for vscode-lm)
   * @param model Model name to use
   * @returns Result containing provider instance or error (or Promise for async factories)
   */
  public createProvider(
    providerName: string,
    apiKey: string,
    model: string
  ):
    | Result<ILlmProvider, LlmProviderError>
    | Promise<Result<ILlmProvider, LlmProviderError>> {
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

  /**
   * Factory function for VS Code LM provider.
   * Note: VS Code LM provider doesn't require API key, uses VS Code's native LM API.
   * @private
   */
  private async createVsCodeLmProvider(
    apiKey: string,
    model: string
  ): Promise<Result<ILlmProvider, LlmProviderError>> {
    try {
      // Parse model string as vendor/family format (e.g., "copilot/gpt-4o")
      let vendor: string | undefined;
      let family: string | undefined;

      if (model && model.includes('/')) {
        const parts = model.split('/');
        vendor = parts[0];
        family = parts[1];
      } else if (model) {
        // Assume model is just the family
        family = model;
      }

      const provider = new VsCodeLmProvider({ vendor, family });

      // Initialize provider (select model)
      const initResult = await provider.initialize();
      if (initResult.isErr()) {
        return Result.err(initResult.error!);
      }

      return Result.ok(provider);
    } catch (error) {
      return Result.err(LlmProviderError.fromError(error, 'vscode-lm'));
    }
  }
}
