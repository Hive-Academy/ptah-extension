/**
 * Sakana Translation Proxy
 *
 * Thin subclass of TranslationProxyBase that provides Sakana-specific
 * configuration. Sakana's /v1/chat/completions endpoint speaks the OpenAI
 * Chat Completions protocol, so the SDK -> proxy -> Sakana flow is:
 *
 *   Claude Agent SDK (Anthropic Messages)
 *     -> local proxy on 127.0.0.1:ephemeral-port
 *     -> translate to OpenAI Chat Completions
 *     -> https://api.sakana.ai/v1/chat/completions
 *     -> translate streaming response back to Anthropic SSE
 *     -> SDK
 *
 * Mirrors OpenRouterTranslationProxy (Chat Completions variant). All HTTP
 * server logic, request/response translation, retry, and streaming are handled
 * by the base class in translation/translation-proxy-base.ts.
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import {
  SAKANA_DEFAULT_TIERS,
  SAKANA_PROVIDER_ENTRY,
} from '@ptah-extension/shared';
import { TranslationProxyBase } from '../../translation';
import { AUTH_PROVIDERS_TOKENS } from '../../di/tokens';
import type { ISakanaAuthService } from './sakana-provider.types';

/** Sakana Chat Completions API endpoint base URL */
const SAKANA_API_ENDPOINT = 'https://api.sakana.ai/v1';

@injectable()
export class SakanaTranslationProxy extends TranslationProxyBase {
  constructor(
    @inject(TOKENS.LOGGER) logger: Logger,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_SAKANA_AUTH)
    private readonly sakanaAuth: ISakanaAuthService,
  ) {
    super(logger, {
      name: 'Sakana',
      modelPrefix: '',
      completionsPath: '/chat/completions',
    });
  }

  /**
   * Sakana's API endpoint is static — no auth-state-driven overrides.
   */
  protected async getApiEndpoint(): Promise<string> {
    return SAKANA_API_ENDPOINT;
  }

  /**
   * Delegate header construction to the auth service, which reads the API key
   * from SecretStorage and builds the Bearer header.
   */
  protected async getHeaders(): Promise<Record<string, string>> {
    return this.sakanaAuth.getHeaders();
  }

  /**
   * On 401, Sakana keys cannot be refreshed — they're user-provided and either
   * valid or revoked. Log an actionable error for the user to rotate their key
   * via Settings and fail the retry.
   */
  protected async onAuthFailure(): Promise<boolean> {
    this.logger.error(
      '[SakanaProxy] Got 401 from Sakana — the API key is invalid, ' +
        'expired, or revoked. Update your key via Settings > Authentication. ' +
        'Get a new key at https://console.sakana.ai/api-keys',
    );
    return false;
  }

  /**
   * Map bare tier aliases (opus/sonnet/haiku/default) to Sakana model IDs via
   * SAKANA_DEFAULT_TIERS; Sakana takes 'fugu'/'fugu-ultra' literally, so any
   * other model ID is passed through as-is.
   */
  protected override normalizeModelId(modelId: string): string {
    if (modelId === 'opus') {
      return SAKANA_DEFAULT_TIERS.opus;
    }
    if (modelId === 'default' || modelId === 'sonnet') {
      return SAKANA_DEFAULT_TIERS.sonnet;
    }
    if (modelId === 'haiku') {
      return SAKANA_DEFAULT_TIERS.haiku;
    }
    return modelId;
  }

  /**
   * Sakana v1 routes through Chat Completions (the lower-risk, fully-exercised
   * path); the Responses API is a fast-follow if needed.
   */
  protected override shouldUseResponsesApi(_modelId: string): boolean {
    return false;
  }

  /**
   * Return the static model list from the Sakana provider entry — the
   * always-available fallback shown when no key is configured / offline.
   */
  protected getStaticModels(): Array<{ id: string }> {
    return SAKANA_PROVIDER_ENTRY.staticModels ?? [];
  }
}
