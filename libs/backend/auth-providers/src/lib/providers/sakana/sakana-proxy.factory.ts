/**
 * Sakana Proxy Factory
 *
 * Creates a fresh, per-key SakanaTranslationProxy instance bound to a specific
 * Bearer key. The DI-registered SakanaTranslationProxy singleton reads its key
 * from SecretStorage under the bare `sakana` provider id (main-agent path).
 * The ptah-cli path, however, stores each agent's key under `ptah-cli.<id>` and
 * needs ONE proxy instance per running agent (distinct keys, concurrent
 * agents) — a shared singleton would leak the wrong key across agents.
 *
 * This factory satisfies that requirement without a new auth strategy: it wraps
 * the supplied key in a minimal ISakanaAuthService and constructs a standalone
 * SakanaTranslationProxy. The proxy class is identical to the singleton path.
 */

import { Logger } from '@ptah-extension/vscode-core';
import { SdkError } from '@ptah-extension/agent-sdk';
import { SakanaTranslationProxy } from './sakana-translation-proxy';
import type { ISakanaAuthService } from './sakana-provider.types';

/**
 * Build an ISakanaAuthService backed by a single in-memory Bearer key rather
 * than SecretStorage. Used for per-agent ptah-cli proxy instances.
 */
function createKeyBoundSakanaAuth(
  apiKey: string,
  logger: Logger,
): ISakanaAuthService {
  const trimmed = apiKey.trim();
  return {
    async isAuthenticated(): Promise<boolean> {
      return trimmed.length > 0;
    },
    async getApiKey(): Promise<string | null> {
      return trimmed.length > 0 ? trimmed : null;
    },
    async getHeaders(): Promise<Record<string, string>> {
      if (trimmed.length === 0) {
        throw new SdkError('Sakana API key is not configured.');
      }
      logger.debug(
        `[SakanaAuth] Building auth headers (key length: ${trimmed.length})`,
      );
      return {
        Authorization: `Bearer ${trimmed}`,
        'Content-Type': 'application/json',
      };
    },
  };
}

/**
 * Create a fresh SakanaTranslationProxy bound to the supplied Bearer key.
 * The caller owns the returned instance and MUST stop() it when the work that
 * uses it completes.
 */
export function createSakanaProxyForKey(
  apiKey: string,
  logger: Logger,
): SakanaTranslationProxy {
  const auth = createKeyBoundSakanaAuth(apiKey, logger);
  return new SakanaTranslationProxy(logger, auth);
}
