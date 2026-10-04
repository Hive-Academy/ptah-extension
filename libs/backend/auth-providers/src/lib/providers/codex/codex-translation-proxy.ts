/**
 * Codex Translation Proxy
 *
 * Subclass of TranslationProxyBase that provides Codex-specific
 * configuration: auth headers, API endpoint, and Responses API routing.
 *
 * Key difference from Copilot:
 * - Codex uses the Responses API (/responses) exclusively — no Chat Completions
 * - Endpoint depends on auth mode: api.openai.com (API key) vs user-configured (OAuth)
 * - completionsPath is unused because resolveUpstreamProtocol always selects Responses
 *
 * All HTTP server logic, request/response translation, retry, and streaming
 * are handled by the base class in openai-translation/translation-proxy-base.ts.
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { TranslationProxyBase } from '../../translation';
import { AUTH_PROVIDERS_TOKENS } from '../../di/tokens';
import type {
  ICodexAuthService,
  ICodexOwnerKeySource,
} from './codex-provider.types';
import {
  CODEX_PROVIDER_ENTRY,
  CODEX_DEFAULT_TIERS,
} from '@ptah-extension/shared';

@injectable()
export class CodexTranslationProxy extends TranslationProxyBase {
  /**
   * @param codexOwnerKeys the account owner of the shared `CODEX_HOME`. The
   *   container always supplies it; a proxy built by hand without it has no
   *   Codex identity, so its quota evidence is unattributed (owner `null`).
   */
  constructor(
    @inject(TOKENS.LOGGER) logger: Logger,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_CODEX_AUTH)
    private readonly codexAuth: ICodexAuthService,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_CODEX_ACCOUNT_USAGE)
    private readonly codexOwnerKeys?: ICodexOwnerKeySource,
  ) {
    super(logger, {
      name: 'Codex',
      modelPrefix: '',
      completionsPath: '/chat/completions',
      responsesPath: '/responses',
    });
  }

  /**
   * The registry id, taken from the provider entry rather than re-typed, so the
   * quota gate keys on the same string `ProviderAuthResolver` resolves. The
   * config's `name` above is a log label and would key nothing.
   */
  protected getProviderId(): string {
    return CODEX_PROVIDER_ENTRY.id;
  }

  /**
   * The Codex account owner, not the request's bearer: the OAuth token rotates
   * on refresh and identifies nobody. `null` until the account has been read
   * (identity unavailable), so a 429 then is recorded unattributed.
   */
  protected override async resolveQuotaOwnerKey(
    _headers: Record<string, string>,
  ): Promise<string | null> {
    return this.codexOwnerKeys?.currentOwnerKey() ?? null;
  }

  /**
   * Get the Codex API base URL from the auth service.
   * Returns auth-mode-appropriate endpoint:
   *   API key → https://api.openai.com/v1
   *   OAuth  → user-configured endpoint from settings
   */
  protected async getApiEndpoint(): Promise<string> {
    return this.codexAuth.getApiEndpoint();
  }

  /**
   * Get Codex auth headers (Bearer token + Content-Type).
   */
  protected async getHeaders(): Promise<Record<string, string>> {
    return this.codexAuth.getHeaders();
  }

  /**
   * On 401, check if credentials are still valid.
   * For API key mode, returns false (key cannot be refreshed).
   * For OAuth mode, returns false if token is stale (user must run `codex login`).
   */
  protected async onAuthFailure(): Promise<boolean> {
    return this.codexAuth.ensureTokensFresh();
  }

  /**
   * Return the static model list from the Codex provider entry.
   */
  protected getStaticModels(): Array<{ id: string }> {
    return CODEX_PROVIDER_ENTRY.staticModels ?? [];
  }

  /**
   * Map Claude model names to Codex-compatible GPT equivalents.
   *
   * The Codex API does NOT support Claude model names at all — unlike Copilot
   * which natively supports Claude models. When the SDK sends 'claude-sonnet-4-6',
   * we must map it to the Codex-equivalent (e.g., 'gpt-5.3-codex').
   *
   * Mapping uses CODEX_DEFAULT_TIERS for tier-based resolution, with the
   * static model list as a final validation.
   */
  protected override normalizeModelId(modelId: string): string {
    if (modelId === 'default' || modelId === 'sonnet') {
      return CODEX_DEFAULT_TIERS.sonnet;
    }
    if (modelId === 'opus') {
      return CODEX_DEFAULT_TIERS.opus;
    }
    if (modelId === 'haiku') {
      return CODEX_DEFAULT_TIERS.haiku;
    }
    if (!modelId.startsWith('claude-')) {
      return modelId;
    }
    const tier = this.detectClaudeTier(modelId);
    const mapped = CODEX_DEFAULT_TIERS[tier];

    this.logger.debug(
      `[CodexProxy] Mapped Claude model '${modelId}' (tier: ${tier}) → '${mapped}'`,
    );
    return mapped;
  }

  /**
   * Detect the tier (sonnet/opus/haiku) from a Claude model ID.
   * Falls back to 'sonnet' for unrecognized patterns.
   */
  private detectClaudeTier(modelId: string): 'sonnet' | 'opus' | 'haiku' {
    if (modelId.includes('opus')) return 'opus';
    if (modelId.includes('haiku')) return 'haiku';
    return 'sonnet';
  }

  /**
   * Codex uses the Responses API exclusively for ALL models.
   * The subscription endpoint requires Responses even when a model also
   * exists on another provider that uses Chat Completions.
   */
  protected override resolveUpstreamProtocol(_modelId: string): 'responses' {
    return 'responses';
  }

  /** The subscription Responses route requires SSE, independently of caller intent. */
  protected override requiresResponsesStream(target: URL): boolean {
    return target.protocol === 'https:' &&
      target.hostname === 'chatgpt.com' &&
      target.pathname.replace(/\/$/, '') === '/backend-api/codex/responses';
  }

  /**
   * Codex keeps tool-result images as `input_image` parts. Evidence: the
   * pinned Codex 0.155.1 client serializes `FunctionCallOutputContentItem` as
   * an internally tagged enum whose `FunctionCallOutputContentItem::InputImage`
   * variant is sent in `function_call_output.output`. Rollback (risk R2):
   * delete this override and the base placeholder path takes over.
   */
  protected override supportsResponsesToolOutputImages(): boolean {
    return true;
  }
}
