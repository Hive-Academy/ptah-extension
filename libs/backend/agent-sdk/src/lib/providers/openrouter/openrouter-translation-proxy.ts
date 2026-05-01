/**
 * OpenRouter Translation Proxy
 *
 * Thin subclass of TranslationProxyBase that provides OpenRouter-specific
 * configuration. OpenRouter's /v1/chat/completions endpoint speaks the
 * OpenAI Chat Completions protocol, so the SDK → proxy → OpenRouter flow is:
 *
 *   Claude Agent SDK (Anthropic Messages)
 *     → local proxy on 127.0.0.1:ephemeral-port
 *     → translate to OpenAI Chat Completions
 *     → https://openrouter.ai/api/v1/chat/completions
 *     → translate streaming response back to Anthropic SSE
 *     → SDK
 *
 * This enables ALL OpenRouter models (Anthropic, OpenAI, Google, Meta, etc.)
 * to work with the Claude Agent SDK, not just Anthropic-family models as with
 * OpenRouter's /v1/messages passthrough.
 *
 * All HTTP server logic, request/response translation, retry, and streaming
 * are handled by the base class in openai-translation/translation-proxy-base.ts.
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { TranslationProxyBase } from '../_shared/translation';
import { SDK_TOKENS } from '../../di/tokens';
import type { IOpenRouterAuthService } from './openrouter-provider.types';

/** OpenRouter Chat Completions API endpoint base URL */
const OPENROUTER_API_ENDPOINT = 'https://openrouter.ai/api/v1';

@injectable()
export class OpenRouterTranslationProxy extends TranslationProxyBase {
  constructor(
    @inject(TOKENS.LOGGER) logger: Logger,
    @inject(SDK_TOKENS.SDK_OPENROUTER_AUTH)
    private readonly openRouterAuth: IOpenRouterAuthService,
  ) {
    super(logger, {
      name: 'OpenRouter',
      // OpenRouter expects full provider-prefixed model IDs
      // (e.g., 'anthropic/claude-sonnet-4.5'), no additional prefix needed
      modelPrefix: '',
      // OpenRouter speaks standard OpenAI Chat Completions
      completionsPath: '/chat/completions',
    });
  }

  /**
   * OpenRouter's API endpoint is static — no auth-state-driven overrides.
   */
  protected async getApiEndpoint(): Promise<string> {
    return OPENROUTER_API_ENDPOINT;
  }

  /**
   * Delegate header construction to the auth service, which reads the API key
   * from SecretStorage and adds Ptah's ranking headers.
   */
  protected async getHeaders(): Promise<Record<string, string>> {
    return this.openRouterAuth.getHeaders();
  }

  /**
   * On 401, OpenRouter keys cannot be refreshed — they're user-provided and
   * either valid or revoked. Log an actionable error for the user to rotate
   * their key via Settings and fail the retry.
   */
  protected async onAuthFailure(): Promise<boolean> {
    this.logger.error(
      '[OpenRouterProxy] Got 401 from OpenRouter — the API key is invalid, ' +
        'expired, or revoked. Update your key via Settings > Authentication. ' +
        'Get a new key at https://openrouter.ai/keys',
    );
    return false;
  }

  /**
   * OpenRouter expects full provider-prefixed model IDs
   * (e.g., 'anthropic/claude-sonnet-4.5', 'openai/gpt-5', 'google/gemini-2.0-flash').
   * No normalization/mapping needed — the model ID is passed through as-is.
   */
  protected override normalizeModelId(modelId: string): string {
    return modelId;
  }

  /**
   * OpenRouter uses the standard OpenAI /v1/chat/completions endpoint for ALL
   * models. It does not expose the newer /responses (Responses API) surface,
   * so every request routes through Chat Completions.
   */
  protected override shouldUseResponsesApi(_modelId: string): boolean {
    return false;
  }

  /**
   * OpenRouter has no static model list — the full catalog (200+ models) is
   * fetched dynamically via ProviderModelsService using the
   * https://openrouter.ai/api/v1/models endpoint. Return empty so the base
   * class's /v1/models proxy route reports no pre-baked models (consumers
   * should query ProviderModelsService directly).
   */
  protected getStaticModels(): Array<{ id: string }> {
    return [];
  }
}
