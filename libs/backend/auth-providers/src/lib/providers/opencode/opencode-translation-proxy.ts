/**
 * OpenCode translation proxy.
 *
 * One immutable subscription selects the endpoint and credential source. Each
 * request resolves its own protocol from the reviewed shared catalog. The base
 * owns transport, native relay, translation, quota, cancellation and teardown.
 */
import type { Logger } from '@ptah-extension/vscode-core';
import {
  getOpenCodeModelProtocol,
  OPENCODE_ZEN_PROVIDER_ENTRY,
  OPENCODE_GO_PROVIDER_ENTRY,
  type OpenCodeProviderId,
  type AnthropicProvider,
  type OpenCodeProtocol,
} from '@ptah-extension/shared';
import { TranslationProxyBase } from '../../translation';
import type { IOpenCodeAuthService } from './opencode-provider.types';

export class OpenCodeTranslationProxy extends TranslationProxyBase {
  private readonly entry: Readonly<AnthropicProvider>;

  constructor(
    logger: Logger,
    private readonly providerId: OpenCodeProviderId,
    private readonly auth: IOpenCodeAuthService,
  ) {
    const entry =
      providerId === 'opencode-zen'
        ? OPENCODE_ZEN_PROVIDER_ENTRY
        : OPENCODE_GO_PROVIDER_ENTRY;
    super(logger, {
      name: entry.name,
      modelPrefix: '',
      completionsPath: '/chat/completions',
      responsesPath: '/responses',
      messagesPath: '/messages',
    });
    this.entry = entry;
  }

  protected getProviderId(): string {
    return this.providerId;
  }

  protected async getApiEndpoint(): Promise<string> {
    return this.entry.baseUrl;
  }

  protected async getHeaders(): Promise<Record<string, string>> {
    return this.auth.getHeaders();
  }

  /** API keys cannot refresh; never retry against another subscription. */
  protected async onAuthFailure(): Promise<boolean> {
    return false;
  }

  protected override normalizeModelId(modelId: string): string {
    const tiers = this.entry.defaultTiers;
    if (modelId === 'default' || modelId === 'sonnet')
      return tiers?.sonnet ?? modelId;
    if (modelId === 'opus') return tiers?.opus ?? modelId;
    if (modelId === 'haiku') return tiers?.haiku ?? modelId;
    return modelId;
  }

  protected override resolveUpstreamProtocol(
    modelId: string,
  ): OpenCodeProtocol | undefined {
    return getOpenCodeModelProtocol(this.providerId, modelId);
  }

  protected getStaticModels(): Array<{ id: string }> {
    return this.entry.staticModels ?? [];
  }

  protected override getAuthFailureMessage(): string {
    return `${this.entry.name} rejected the API key. Update that subscription's key in Settings > Authentication.`;
  }

  /** Never expose raw upstream payloads in either client errors or logs. */
  protected override getUpstreamErrorMessage(
    status: number,
    _body: string,
  ): string {
    if (status === 403) {
      return `${this.entry.name} denied this request (403). Check access for this subscription and model.`;
    }
    if (status >= 500) {
      return `${this.entry.name} API error (${status}). The provider could not complete the request. Try again later.`;
    }
    return `${this.entry.name} API error (${status}). Check your subscription/balance, model selection and request.`;
  }
}
