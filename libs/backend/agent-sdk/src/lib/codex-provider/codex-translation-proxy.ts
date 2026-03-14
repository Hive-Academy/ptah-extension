/**
 * Codex Translation Proxy - TASK_2025_193 Batch 3
 *
 * Thin subclass of TranslationProxyBase that provides Codex-specific
 * configuration: auth headers, API endpoint, model prefix, and completions path.
 *
 * All HTTP server logic, request/response translation, retry, and streaming
 * are handled by the base class in openai-translation/translation-proxy-base.ts.
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { TranslationProxyBase } from '../openai-translation';
import type { CodexAuthService } from './codex-auth.service';
import { CODEX_PROVIDER_ENTRY } from './codex-provider-entry';

/**
 * DI token for the Codex auth service.
 * Uses Symbol.for() directly since Batch 4 will add the proper SDK_TOKENS entry.
 */
const SDK_CODEX_AUTH_TOKEN = Symbol.for('SdkCodexAuth');

@injectable()
export class CodexTranslationProxy extends TranslationProxyBase {
  constructor(
    @inject(TOKENS.LOGGER) logger: Logger,
    @inject(SDK_CODEX_AUTH_TOKEN)
    private readonly codexAuth: CodexAuthService
  ) {
    super(logger, { name: 'Codex', modelPrefix: '' });
  }

  /**
   * Get the Codex API base URL from the auth service.
   * Defaults to https://api.chatgpt.com if not configured.
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

  /**
   * Codex uses the standard OpenAI completions path `/v1/chat/completions`.
   */
  protected getCompletionsPath(): string {
    return '/v1/chat/completions';
  }
}
