/** Fresh, key-bound OpenCode proxies for workspace and per-agent lifetimes. */
import type { Logger } from '@ptah-extension/vscode-core';
import { SdkError } from '@ptah-extension/agent-sdk';
import {
  getAnthropicProvider,
  type OpenCodeProviderId,
} from '@ptah-extension/shared';
import { OpenCodeTranslationProxy } from './opencode-translation-proxy';
import type { IOpenCodeAuthService } from './opencode-provider.types';

/** Caller owns the returned instance and must stop it when its work finishes. */
export function createOpenCodeProxyForKey(
  providerId: OpenCodeProviderId,
  apiKey: string,
  logger: Logger,
): OpenCodeTranslationProxy {
  const key = apiKey.trim();
  const auth: IOpenCodeAuthService = {
    async isAuthenticated() {
      return key.length > 0;
    },
    async getApiKey() {
      return key || null;
    },
    async getHeaders() {
      if (!key) {
        throw new SdkError(
          `No ${getAnthropicProvider(providerId)?.name} API key configured. Add one in Settings.`,
        );
      }
      return {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      };
    },
  };
  return new OpenCodeTranslationProxy(logger, providerId, auth);
}
