/**
 * Custom Provider Proxy Factory
 *
 * Maps a resolved registry entry to a running-capable
 * CustomOpenAiTranslationProxy. Mirrors `createSakanaProxyForKey`: a plain
 * function rather than a DI registration, because these proxies are explicitly
 * NOT singletons — there is one per custom provider id, created on demand once
 * the user's entry is known, and the set of ids is not knowable at container
 * build time.
 *
 * Both construction sites (ApiKeyStrategy for the global auth path, and any
 * future per-workspace path) already inject `Logger` and `IAuthSecretsService`,
 * so no new DI token is needed to reach this.
 */

import { Logger, type IAuthSecretsService } from '@ptah-extension/vscode-core';
import type { AnthropicProvider } from '@ptah-extension/shared';
import { CustomOpenAiTranslationProxy } from './custom-openai-translation-proxy';

/**
 * Create a translation proxy for a user-defined OpenAI-compatible provider.
 *
 * `baseUrl` is passed separately rather than read from `provider.baseUrl` so
 * the caller can apply the `provider.<id>.baseUrl` settings override (the same
 * override the direct-passthrough path honours) without this factory needing
 * to know about ConfigManager.
 *
 * The caller owns the returned instance and MUST `stop()` it when switching
 * away from the provider.
 *
 * @throws Error when `baseUrl` is unparseable or not http/https — see
 *   `normalizeOpenAiApiRoot`.
 */
export function createCustomOpenAiProxy(params: {
  provider: AnthropicProvider;
  baseUrl: string;
  logger: Logger;
  authSecrets: IAuthSecretsService;
}): CustomOpenAiTranslationProxy {
  const { provider, baseUrl, logger, authSecrets } = params;

  return new CustomOpenAiTranslationProxy(logger, authSecrets, {
    providerId: provider.id,
    name: provider.name,
    baseUrl,
    helpUrl: provider.helpUrl,
    staticModels: provider.staticModels,
  });
}
