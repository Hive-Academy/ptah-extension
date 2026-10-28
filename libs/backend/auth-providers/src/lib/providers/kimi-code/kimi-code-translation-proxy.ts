/**
 * Kimi Code proxy: a localhost Anthropic Messages relay (no translation) that
 * attaches a fresh Kimi Code credential to every request.
 *
 * The SDK subprocess gets its env once at spawn, but the Kimi Code CLI access
 * token lives 15 minutes. Reading the credential per request here is what
 * keeps a session of any length authenticated. The SDK only ever sees
 * `KIMI_CODE_PROXY_TOKEN_PLACEHOLDER`; the base relay drops the client's own
 * auth headers and sends only the ones returned by `getHeaders()`.
 *
 * Endpoint: `provider.kimi-code.baseUrl` override, else the registry
 * `baseUrl`, joined with `v1` -> `https://api.kimi.ai/coding/v1/messages`.
 */
import { createHash } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import {
  TOKENS,
  type ConfigManager,
  type Logger,
} from '@ptah-extension/vscode-core';
import { KIMI_CODE_PROVIDER_ENTRY } from '@ptah-extension/shared';
import { TranslationProxyBase } from '../../translation';
import { AUTH_PROVIDERS_TOKENS } from '../../di/tokens';
import type {
  IKimiCodeAuthService,
  KimiCodeRequestCredential,
} from './kimi-code-provider.types';

@injectable()
export class KimiCodeTranslationProxy extends TranslationProxyBase {
  constructor(
    @inject(TOKENS.LOGGER) logger: Logger,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_KIMI_CODE_AUTH)
    private readonly kimiAuth: IKimiCodeAuthService,
    @inject(TOKENS.CONFIG_MANAGER)
    private readonly configManager: Pick<ConfigManager, 'get'>,
  ) {
    super(logger, {
      name: KIMI_CODE_PROVIDER_ENTRY.name,
      modelPrefix: '',
      completionsPath: '/chat/completions',
      messagesPath: '/messages',
    });
  }

  protected getProviderId(): string {
    return KIMI_CODE_PROVIDER_ENTRY.id;
  }

  protected async getApiEndpoint(): Promise<string> {
    const override = this.configManager.get<string>(
      `provider.${KIMI_CODE_PROVIDER_ENTRY.id}.baseUrl`,
    );
    const base =
      typeof override === 'string' && override.trim().length > 0
        ? override.trim()
        : KIMI_CODE_PROVIDER_ENTRY.baseUrl;
    return `${base.replace(/\/+$/, '')}/v1`;
  }

  /**
   * OAuth: `Authorization: Bearer` AND `x-api-key` (the live-tested shape).
   * Stored key: `x-api-key` only, the header the direct path always sent.
   * Throws `KimiCodeAuthUnavailableError` (fixed copy) when neither exists.
   */
  protected async getHeaders(): Promise<Record<string, string>> {
    return headersFor(await this.kimiAuth.resolveRequestCredential());
  }

  /** Retry once only when the refresh produced a DIFFERENT credential. */
  protected async onAuthFailure(): Promise<boolean> {
    const before = await this.credentialFingerprint();
    await this.kimiAuth.forceRefresh();
    const after = await this.credentialFingerprint();
    return after !== null && after !== before;
  }

  /**
   * A rotating OAuth bearer identifies nobody, so OAuth requests are not
   * attributed to an owner (Codex does the same). A stored key keeps the
   * default per-credential owner.
   */
  protected override resolveQuotaOwnerKey(
    headers: Record<string, string>,
  ): Promise<string | null> {
    if (headers['Authorization'] !== undefined) return Promise.resolve(null);
    return super.resolveQuotaOwnerKey(headers);
  }

  protected override resolveUpstreamProtocol(_modelId: string): 'messages' {
    return 'messages';
  }

  protected override normalizeModelId(modelId: string): string {
    const tiers = KIMI_CODE_PROVIDER_ENTRY.defaultTiers;
    if (modelId === 'default' || modelId === 'sonnet')
      return tiers?.sonnet ?? modelId;
    if (modelId === 'opus') return tiers?.opus ?? modelId;
    if (modelId === 'haiku') return tiers?.haiku ?? modelId;
    return modelId;
  }

  protected getStaticModels(): Array<{ id: string }> {
    return KIMI_CODE_PROVIDER_ENTRY.staticModels ?? [];
  }

  protected override getAuthFailureMessage(): string {
    return 'Kimi Code rejected the credential. Run `kimi login` again, or update the Kimi Code API key in Settings.';
  }

  /** Fixed copy: never relay the upstream body. */
  protected override getUpstreamErrorMessage(
    status: number,
    _body: string,
  ): string {
    if (status === 403) {
      return 'Kimi Code denied this request (403). Check that your plan includes the selected model.';
    }
    if (status >= 500) {
      return `Kimi Code API error (${status}). The provider could not complete the request. Try again later.`;
    }
    return `Kimi Code API error (${status}). Check your plan, model selection and request.`;
  }

  /** Hash of the credential the next request would carry; null when none. */
  private async credentialFingerprint(): Promise<string | null> {
    try {
      const credential = await this.kimiAuth.resolveRequestCredential();
      const raw =
        credential.kind === 'oauth' ? credential.accessToken : credential.apiKey;
      return createHash('sha256').update(`${credential.kind}:${raw}`).digest('hex');
    } catch {
      // degradation-audit: reported - no credential means no retry; the base
      // then answers the client 401 with getAuthFailureMessage().
      return null;
    }
  }
}

function headersFor(
  credential: KimiCodeRequestCredential,
): Record<string, string> {
  if (credential.kind === 'oauth') {
    return {
      Authorization: `Bearer ${credential.accessToken}`,
      'x-api-key': credential.accessToken,
      'Content-Type': 'application/json',
    };
  }
  return {
    'x-api-key': credential.apiKey,
    'Content-Type': 'application/json',
  };
}
