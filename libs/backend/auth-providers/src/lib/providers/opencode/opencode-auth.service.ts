/** OpenCode authentication reads only the immutable subscription's secret slot. */
import type { IAuthSecretsService } from '@ptah-extension/vscode-core';
import { SdkError } from '@ptah-extension/agent-sdk';
import {
  getAnthropicProvider,
  type OpenCodeProviderId,
} from '@ptah-extension/shared';
import type { IOpenCodeAuthService } from './opencode-provider.types';

export class OpenCodeAuthService implements IOpenCodeAuthService {
  constructor(
    private readonly providerId: OpenCodeProviderId,
    private readonly authSecrets: IAuthSecretsService,
  ) {}

  async isAuthenticated(): Promise<boolean> {
    return (await this.getApiKey()) !== null;
  }

  async getApiKey(): Promise<string | null> {
    return (
      (await this.authSecrets.getProviderKey(this.providerId))?.trim() || null
    );
  }

  async getHeaders(): Promise<Record<string, string>> {
    const key = await this.getApiKey();
    if (!key) {
      throw new SdkError(
        `No ${getAnthropicProvider(this.providerId)?.name} API key configured. Add one in Settings.`,
      );
    }
    return {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    };
  }
}
