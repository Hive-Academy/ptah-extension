/**
 * OpenRouter Authentication Service
 *
 * Thin injectable service that reads the OpenRouter API key from SecretStorage
 * via IAuthSecretsService.getProviderKey('openrouter').
 *
 * Much simpler than CopilotAuthService — no OAuth, no device code flow, no
 * token refresh, no caching beyond what SecretStorage provides. OpenRouter
 * uses a single user-provided API key (sk-or-v1-...) which is passed directly
 * in the Authorization header.
 *
 * Security: NEVER logs the key itself — only length and presence.
 */

import { injectable, inject } from 'tsyringe';
import {
  Logger,
  TOKENS,
  type IAuthSecretsService,
} from '@ptah-extension/vscode-core';
import { SdkError } from '../../errors';
import type { IOpenRouterAuthService } from './openrouter-provider.types';

/**
 * Provider ID used when reading the OpenRouter API key from SecretStorage.
 * Must match the id field in ANTHROPIC_PROVIDERS registry.
 */
const OPENROUTER_PROVIDER_ID = 'openrouter';

/**
 * OpenRouter-recommended ranking headers.
 * When present, OpenRouter attributes API usage to this app, which lets Ptah
 * appear in the OpenRouter app leaderboard. Safe to hardcode — these are
 * public attribution headers, not secrets.
 *
 * @see https://openrouter.ai/docs/api-reference/overview#headers
 */
const OPENROUTER_RANKING_HEADERS = {
  'HTTP-Referer': 'https://ptah-extension.com',
  'X-Title': 'Ptah Extension',
} as const;

@injectable()
export class OpenRouterAuthService implements IOpenRouterAuthService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.AUTH_SECRETS_SERVICE)
    private readonly authSecrets: IAuthSecretsService,
  ) {}

  async isAuthenticated(): Promise<boolean> {
    const key = await this.authSecrets.getProviderKey(OPENROUTER_PROVIDER_ID);
    return !!key && key.trim().length > 0;
  }

  async getApiKey(): Promise<string | null> {
    const key = await this.authSecrets.getProviderKey(OPENROUTER_PROVIDER_ID);
    if (!key || !key.trim()) {
      return null;
    }
    return key.trim();
  }

  async getHeaders(): Promise<Record<string, string>> {
    const key = await this.getApiKey();
    if (!key) {
      throw new SdkError(
        'OpenRouter API key is not configured. Set it via Settings > Authentication.',
      );
    }

    this.logger.debug(
      `[OpenRouterAuth] Building auth headers (key length: ${key.length})`,
    );

    return {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...OPENROUTER_RANKING_HEADERS,
    };
  }
}
