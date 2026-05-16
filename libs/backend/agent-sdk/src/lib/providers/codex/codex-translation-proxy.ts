/**
 * Codex Translation Proxy
 *
 * Subclass of TranslationProxyBase that provides Codex-specific
 * configuration: auth headers, API endpoint, and Responses API routing.
 *
 * Key difference from Copilot:
 * - Codex uses the Responses API (/responses) exclusively — no Chat Completions
 * - Endpoint depends on auth mode: api.openai.com (API key) vs user-configured (OAuth)
 * - completionsPath is unused because shouldUseResponsesApi always returns true
 *
 * All HTTP server logic, request/response translation, retry, and streaming
 * are handled by the base class in openai-translation/translation-proxy-base.ts.
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { TranslationProxyBase } from '../_shared/translation';
import { SDK_TOKENS } from '../../di/tokens';
import type { ICodexAuthService } from './codex-provider.types';
import {
  CODEX_PROVIDER_ENTRY,
  CODEX_DEFAULT_TIERS,
} from './codex-provider-entry';

@injectable()
export class CodexTranslationProxy extends TranslationProxyBase {
  constructor(
    @inject(TOKENS.LOGGER) logger: Logger,
    @inject(SDK_TOKENS.SDK_CODEX_AUTH)
    private readonly codexAuth: ICodexAuthService,
  ) {
    super(logger, {
      name: 'Codex',
      modelPrefix: '',
      // Required by base class config; Codex exclusively uses Responses API
      // so this path is only reached if shouldUseResponsesApi() is overridden
      completionsPath: '/chat/completions',
      // Codex uses /responses at the path level (appended to base URL)
      responsesPath: '/responses',
    });
  }

  /**
   * Get the Codex API base URL from the auth service.
   * Returns auth-mode-appropriate endpoint:
   *   API key → https://api.openai.com/v1
   *   OAuth  → user-configured endpoint from settings
   */
  protected async getApiEndpoint(): Promise<string> {
    return this.codexAuth.getApiEndpoint();
  }

  /**
   * Get Codex auth headers (Bearer token + Content-Type).
   */
  protected async getHeaders(): Promise<Record<string, string>> {
    return this.codexAuth.getHeaders();
  }

  /**
   * On 401, check if credentials are still valid.
   * For API key mode, returns false (key cannot be refreshed).
   * For OAuth mode, returns false if token is stale (user must run `codex login`).
   */
  protected async onAuthFailure(): Promise<boolean> {
    return this.codexAuth.ensureTokensFresh();
  }

  /**
   * Return the static model list from the Codex provider entry.
   */
  protected getStaticModels(): Array<{ id: string }> {
    return CODEX_PROVIDER_ENTRY.staticModels ?? [];
  }

  // ---------------------------------------------------------------------------
  // Codex-specific routing overrides
  // ---------------------------------------------------------------------------

  /**
   * Map Claude model names to Codex-compatible GPT equivalents.
   *
   * The Codex API does NOT support Claude model names at all — unlike Copilot
   * which natively supports Claude models. When the SDK sends 'claude-sonnet-4-6',
   * we must map it to the Codex-equivalent (e.g., 'gpt-5.3-codex').
   *
   * Mapping uses CODEX_DEFAULT_TIERS for tier-based resolution, with the
   * static model list as a final validation.
   */
  protected override normalizeModelId(modelId: string): string {
    if (!modelId.startsWith('claude-')) {
      return modelId;
    }

    // Determine which tier this Claude model represents
    const tier = this.detectClaudeTier(modelId);
    const mapped = CODEX_DEFAULT_TIERS[tier];

    this.logger.debug(
      `[CodexProxy] Mapped Claude model '${modelId}' (tier: ${tier}) → '${mapped}'`,
    );
    return mapped;
  }

  /**
   * Detect the tier (sonnet/opus/haiku) from a Claude model ID.
   * Falls back to 'sonnet' for unrecognized patterns.
   */
  private detectClaudeTier(modelId: string): 'sonnet' | 'opus' | 'haiku' {
    if (modelId.includes('opus')) return 'opus';
    if (modelId.includes('haiku')) return 'haiku';
    return 'sonnet';
  }

  /**
   * Codex uses the Responses API exclusively for ALL models.
   * Unlike Copilot which splits between /chat/completions and /responses,
   * the Codex API only exposes the /responses endpoint.
   */
  protected override shouldUseResponsesApi(_modelId: string): boolean {
    return true;
  }
}
