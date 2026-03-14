/**
 * Copilot Translation Proxy - TASK_2025_193 Batch 2
 *
 * Thin subclass of TranslationProxyBase that provides Copilot-specific
 * configuration: auth headers, API endpoint, model prefix, and completions path.
 *
 * All HTTP server logic, request/response translation, retry, and streaming
 * are handled by the base class in openai-translation/translation-proxy-base.ts.
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { TranslationProxyBase } from '../openai-translation';
import type { CopilotAuthService } from './copilot-auth.service';
import { COPILOT_PROVIDER_ENTRY } from './copilot-provider-entry';
import { SDK_TOKENS } from '../di/tokens';

/** Default Copilot API endpoint (used when auth state has no override) */
const DEFAULT_COPILOT_API_ENDPOINT = 'https://api.githubcopilot.com';

@injectable()
export class CopilotTranslationProxy extends TranslationProxyBase {
  constructor(
    @inject(TOKENS.LOGGER) logger: Logger,
    @inject(SDK_TOKENS.SDK_COPILOT_AUTH)
    private readonly copilotAuth: CopilotAuthService
  ) {
    super(logger, { name: 'Copilot', modelPrefix: 'capi:' });
  }

  /**
   * Get the Copilot API base URL from the current auth state.
   * Falls back to the default endpoint if no auth state or no override.
   */
  protected async getApiEndpoint(): Promise<string> {
    const authState = await this.copilotAuth.getAuthState();
    return authState?.apiEndpoint ?? DEFAULT_COPILOT_API_ENDPOINT;
  }

  /**
   * Get Copilot-specific auth and request headers from the auth service.
   */
  protected async getHeaders(): Promise<Record<string, string>> {
    return this.copilotAuth.getHeaders();
  }

  /**
   * On 401, attempt to re-login via GitHub OAuth to refresh the Copilot token.
   */
  protected async onAuthFailure(): Promise<boolean> {
    return this.copilotAuth.login();
  }

  /**
   * Return the static model list from the Copilot provider entry.
   */
  protected getStaticModels(): Array<{ id: string }> {
    return COPILOT_PROVIDER_ENTRY.staticModels ?? [];
  }

  /**
   * Copilot uses `/chat/completions` (no /v1 prefix).
   */
  protected getCompletionsPath(): string {
    return '/chat/completions';
  }
}
