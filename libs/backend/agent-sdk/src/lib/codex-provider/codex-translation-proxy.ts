/**
 * Codex Translation Proxy - TASK_2025_193 Batch 3
 *
 * Subclass of TranslationProxyBase that provides Codex-specific
 * configuration: auth headers, API endpoint, and Responses API routing.
 *
 * Key difference from Copilot:
 * - Codex uses the Responses API (/responses) exclusively — no Chat Completions
 * - Endpoint depends on auth mode: api.openai.com (API key) vs chatgpt.com (OAuth)
 * - completionsPath is unused because shouldUseResponsesApi always returns true
 *
 * All HTTP server logic, request/response translation, retry, and streaming
 * are handled by the base class in openai-translation/translation-proxy-base.ts.
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { TranslationProxyBase } from '../openai-translation';
import { SDK_TOKENS } from '../di/tokens';
import type { ICodexAuthService } from './codex-provider.types';
import { CODEX_PROVIDER_ENTRY } from './codex-provider-entry';

@injectable()
export class CodexTranslationProxy extends TranslationProxyBase {
  constructor(
    @inject(TOKENS.LOGGER) logger: Logger,
    @inject(SDK_TOKENS.SDK_CODEX_AUTH)
    private readonly codexAuth: ICodexAuthService
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
   *   OAuth  → https://chatgpt.com/backend-api/codex
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
   * On 401, attempt to refresh the OAuth token via the auth service.
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
   * Codex uses the Responses API exclusively for ALL models.
   * Unlike Copilot which splits between /chat/completions and /responses,
   * the Codex API only exposes the /responses endpoint.
   */
  protected override shouldUseResponsesApi(_modelId: string): boolean {
    return true;
  }
}
