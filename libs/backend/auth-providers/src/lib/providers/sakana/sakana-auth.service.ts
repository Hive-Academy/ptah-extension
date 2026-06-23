/**
 * Sakana Authentication Service
 *
 * Thin injectable service that reads the Sakana API key from SecretStorage
 * via IAuthSecretsService.getProviderKey('sakana').
 *
 * Like OpenRouterAuthService — no OAuth, no device code flow, no token refresh,
 * no caching beyond what SecretStorage provides. Sakana uses a single
 * user-provided API key which is passed directly in the Authorization header
 * as a Bearer token.
 *
 * Security: NEVER logs the key itself — only length and presence.
 */

import { injectable, inject } from 'tsyringe';
import {
  Logger,
  TOKENS,
  type IAuthSecretsService,
} from '@ptah-extension/vscode-core';
import { SdkError } from '@ptah-extension/agent-sdk';
import type { ISakanaAuthService } from './sakana-provider.types';

/**
 * Provider ID used when reading the Sakana API key from SecretStorage.
 * Must match the id field in ANTHROPIC_PROVIDERS registry.
 */
const SAKANA_PROVIDER_ID = 'sakana';

@injectable()
export class SakanaAuthService implements ISakanaAuthService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.AUTH_SECRETS_SERVICE)
    private readonly authSecrets: IAuthSecretsService,
  ) {}

  async isAuthenticated(): Promise<boolean> {
    const key = await this.authSecrets.getProviderKey(SAKANA_PROVIDER_ID);
    return !!key && key.trim().length > 0;
  }

  async getApiKey(): Promise<string | null> {
    const key = await this.authSecrets.getProviderKey(SAKANA_PROVIDER_ID);
    if (!key || !key.trim()) {
      return null;
    }
    return key.trim();
  }

  async getHeaders(): Promise<Record<string, string>> {
    const key = await this.getApiKey();
    if (!key) {
      throw new SdkError(
        'Sakana API key is not configured. Set it via Settings > Authentication.',
      );
    }

    this.logger.debug(
      `[SakanaAuth] Building auth headers (key length: ${key.length})`,
    );

    return {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    };
  }
}
