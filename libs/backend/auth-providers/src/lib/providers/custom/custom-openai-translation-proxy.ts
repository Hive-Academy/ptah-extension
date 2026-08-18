/**
 * Custom OpenAI-Compatible Translation Proxy
 *
 * The generic, base-URL-driven sibling of OpenRouterTranslationProxy and
 * SakanaTranslationProxy. Where those hardcode their endpoint as a module
 * constant and delegate headers to a bespoke auth service, this one takes the
 * endpoint at construction and reads its Bearer key straight from
 * SecretStorage under the entry's own provider id.
 *
 * It backs user-defined provider entries declared with `lane: 'openai'` in
 * `provider.custom.entries` (LiteLLM, vLLM, a self-hosted gateway, any
 * OpenAI-compatible router), which the registry surfaces as
 * `requiresProxy: true`:
 *
 *   Claude Agent SDK (Anthropic Messages)
 *     -> local proxy on 127.0.0.1:ephemeral-port
 *     -> translate to OpenAI Chat Completions
 *     -> <the user's base URL>/chat/completions
 *     -> translate streaming response back to Anthropic SSE
 *     -> SDK
 *
 * NOT a DI singleton. There is one instance per custom provider id, built at
 * runtime by `createCustomOpenAiProxy` once the entry is known. All HTTP
 * server logic, request/response translation, retry, and streaming are handled
 * by the base class in translation/translation-proxy-base.ts.
 *
 * `normalizeModelId` and `shouldUseResponsesApi` are deliberately NOT
 * overridden: the base defaults (pass the model id through untouched, always
 * route via Chat Completions) are exactly right for an arbitrary
 * OpenAI-compatible endpoint. We cannot know a custom gateway's model aliases,
 * and the Responses API is not part of the OpenAI-compatible baseline that
 * LiteLLM/vLLM implement.
 */

import { Logger, type IAuthSecretsService } from '@ptah-extension/vscode-core';
import { SdkError } from '@ptah-extension/agent-sdk';
import { TranslationProxyBase } from '../../translation';
import type { CustomOpenAiProxyConfig } from './custom-provider.types';

/**
 * Reduce a configured base URL to the OpenAI API root that
 * `completionsPath` (`/chat/completions`) is appended to.
 *
 * Custom entries store the URL the vendor documents, which may or may not
 * already carry the version segment:
 *
 *   `http://192.168.1.50:8000`      -> `http://192.168.1.50:8000/v1`
 *   `https://router.requesty.ai/v1` -> `https://router.requesty.ai/v1`
 *   `https://openrouter.ai/api`     -> `https://openrouter.ai/api/v1`
 *
 * The last line is the load-bearing check on this heuristic: the registry
 * stores OpenRouter's base URL as `https://openrouter.ai/api`, and
 * `OpenRouterTranslationProxy` hardcodes its endpoint as
 * `https://openrouter.ai/api/v1` — so normalizing the registry value produces
 * exactly the constant the built-in proxy uses.
 *
 * Any existing `/vN` suffix is preserved rather than forced to `/v1`, because
 * some gateways version past v1.
 *
 * @throws Error when the URL is unparseable or is not http/https. Failing here
 *   (at construction) produces an actionable message; failing later inside
 *   `buildUpstreamUrl` would surface as an opaque 500 on the first turn.
 */
export function normalizeOpenAiApiRoot(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (trimmed.length === 0) {
    throw new Error('Custom provider base URL is empty.');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(
      `Custom provider base URL is not a valid URL: "${baseUrl}". ` +
        'Expected something like https://gateway.example.com or http://192.168.1.50:8000.',
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `Custom provider base URL must use http or https, got "${parsed.protocol}".`,
    );
  }

  return /\/v\d+$/i.test(parsed.pathname) ? trimmed : `${trimmed}/v1`;
}

export class CustomOpenAiTranslationProxy extends TranslationProxyBase {
  /** OpenAI API root, `/chat/completions` is appended to this. */
  private readonly apiRoot: string;

  constructor(
    logger: Logger,
    private readonly authSecrets: IAuthSecretsService,
    private readonly customConfig: CustomOpenAiProxyConfig,
  ) {
    super(logger, {
      name: customConfig.name,
      modelPrefix: '',
      completionsPath: '/chat/completions',
    });
    this.apiRoot = normalizeOpenAiApiRoot(customConfig.baseUrl);
  }

  /** The provider id this instance is bound to (its SecretStorage key). */
  get providerId(): string {
    return this.customConfig.providerId;
  }

  /** The normalized upstream API root this instance forwards to. */
  get apiEndpoint(): string {
    return this.apiRoot;
  }

  /**
   * Fixed for the lifetime of the instance. A base-URL change means a new
   * instance — callers detect the change and rebuild rather than mutating a
   * live proxy out from under an in-flight request.
   */
  protected async getApiEndpoint(): Promise<string> {
    return this.apiRoot;
  }

  /**
   * Build the Bearer header from the key stored under this entry's provider
   * id. Read fresh on every request (never cached) so rotating the key in
   * Settings takes effect without restarting the proxy — the same contract
   * OpenRouterAuthService/SakanaAuthService provide for the built-ins.
   *
   * Security: the key itself is never logged, only its length.
   */
  protected async getHeaders(): Promise<Record<string, string>> {
    const key = (
      await this.authSecrets.getProviderKey(this.customConfig.providerId)
    )?.trim();

    if (!key) {
      throw new SdkError(
        `${this.customConfig.name} API key is not configured. ` +
          'Set it via Settings > Authentication.',
      );
    }

    this.logger.debug(
      `[CustomProviderAuth] Building auth headers for ${this.customConfig.providerId} ` +
        `(key length: ${key.length})`,
    );

    return {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * On 401 there is nothing to refresh — a custom entry's key is user-provided
   * and either valid or revoked. Log an actionable error naming the endpoint
   * (the user may have several custom entries) and fail the retry.
   */
  protected async onAuthFailure(): Promise<boolean> {
    const helpUrl = this.customConfig.helpUrl?.trim();
    const keyHint = helpUrl ? ` Get a new key at ${helpUrl}` : '';

    this.logger.error(
      `[${this.customConfig.name}Proxy] Got 401 from ${this.customConfig.name} ` +
        `(${this.apiRoot}) — the API key is invalid, expired, or revoked. ` +
        `Update your key via Settings > Authentication.${keyHint}`,
    );
    return false;
  }

  /**
   * Custom entries normally advertise no static catalog — models come from the
   * entry's `defaultTiers` or whatever slug the user types. Returns whatever
   * the entry declared, else an empty list.
   */
  protected getStaticModels(): Array<{ id: string }> {
    return [...(this.customConfig.staticModels ?? [])];
  }
}
