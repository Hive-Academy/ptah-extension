import { inject, injectable } from 'tsyringe';
import {
  Logger,
  ConfigManager,
  TOKENS,
  type IAuthSecretsService,
} from '@ptah-extension/vscode-core';
import type { OneShotAuthOverride } from '@ptah-extension/agent-sdk';
import type { ICuratorAuthResolver } from '@ptah-extension/agent-sdk';
import type { AuthEnv } from '@ptah-extension/shared';
import {
  ANTHROPIC_DIRECT_PROVIDER_ID,
  getAnthropicProvider,
  getProviderAuthEnvVar,
  getProviderBaseUrl,
  resolveStrategy,
} from '@ptah-extension/shared';
import { AUTH_PROVIDERS_TOKENS } from '../di/tokens';
import type { ProviderModelsService } from '../provider-models.service';
import { CuratorProxyManager } from './curator-proxy-manager';
import { CuratorAuthError } from './curator-auth.error';
import type { ICopilotAuthService } from '../providers/copilot/copilot-provider.types';
import type { ICodexAuthService } from '../providers/codex/codex-provider.types';
import type { IOpenRouterAuthService } from '../providers/openrouter/openrouter-provider.types';

const CHAT_AUTH_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
] as const;

@injectable()
export class CuratorAuthResolver implements ICuratorAuthResolver {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.CONFIG_MANAGER) private readonly config: ConfigManager,
    @inject(TOKENS.AUTH_SECRETS_SERVICE)
    private readonly authSecrets: IAuthSecretsService,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_MODELS)
    private readonly providerModels: ProviderModelsService,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_CURATOR_PROXY_MANAGER)
    private readonly curatorProxyManager: CuratorProxyManager,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_COPILOT_AUTH)
    private readonly copilotAuth: ICopilotAuthService,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_CODEX_AUTH)
    private readonly codexAuth: ICodexAuthService,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_OPENROUTER_AUTH)
    private readonly openRouterAuth: IOpenRouterAuthService,
  ) {}

  async resolve(
    curatorProviderId: string,
  ): Promise<OneShotAuthOverride | null> {
    const providerId = (curatorProviderId ?? '').trim();
    if (providerId.length === 0) {
      return null;
    }
    if (providerId === this.providerModels.resolveActiveProviderId()) {
      return null;
    }

    const provider = getAnthropicProvider(providerId);
    const isDirectAnthropic =
      providerId === ANTHROPIC_DIRECT_PROVIDER_ID || providerId === 'apiKey';
    if (isDirectAnthropic) {
      return this.resolveDirectAnthropic();
    }
    if (providerId === 'claudeCli') {
      return this.resolveCli();
    }

    const strategy = resolveStrategy('thirdParty', provider);
    if (strategy === 'cli') {
      return this.resolveCli();
    }
    if (strategy === 'oauth-proxy' || strategy === 'local-proxy') {
      return this.resolveProxyProvider(providerId);
    }
    if (providerId === 'openrouter') {
      return this.resolveProxyProvider(providerId);
    }
    if (strategy === 'local-native') {
      return this.resolveLocalNative(providerId);
    }
    return this.resolveThirdPartyApiKey(providerId);
  }

  private async resolveDirectAnthropic(): Promise<OneShotAuthOverride> {
    const apiKey = await this.authSecrets.getCredential('apiKey');
    if (!apiKey?.trim()) {
      throw new CuratorAuthError(
        ANTHROPIC_DIRECT_PROVIDER_ID,
        'Anthropic API key is not configured for the curator provider.',
      );
    }
    const env = this.buildCuratorEnv({ ANTHROPIC_API_KEY: apiKey.trim() });
    return { env };
  }

  private resolveCli(): OneShotAuthOverride {
    return { env: this.buildCuratorEnv({}) };
  }

  private async resolveThirdPartyApiKey(
    providerId: string,
  ): Promise<OneShotAuthOverride> {
    const providerKey = await this.authSecrets.getProviderKey(providerId);
    if (!providerKey?.trim()) {
      throw new CuratorAuthError(
        providerId,
        `API key is not configured for curator provider: ${providerId}`,
      );
    }
    const baseUrl = this.resolveProviderBaseUrl(providerId);
    const authEnvVar = getProviderAuthEnvVar(providerId);
    const curatorValues: AuthEnv = {
      ANTHROPIC_BASE_URL: baseUrl,
      [authEnvVar]: providerKey.trim(),
      ...this.buildTierValues(providerId),
    };
    return { env: this.buildCuratorEnv(curatorValues), baseUrl };
  }

  private resolveLocalNative(providerId: string): OneShotAuthOverride {
    const baseUrl = this.resolveProviderBaseUrl(providerId);
    const curatorValues: AuthEnv = {
      ANTHROPIC_BASE_URL: baseUrl,
      ...this.buildTierValues(providerId),
    };
    return { env: this.buildCuratorEnv(curatorValues), baseUrl };
  }

  private async resolveProxyProvider(
    providerId: string,
  ): Promise<OneShotAuthOverride> {
    await this.assertProxyAuthenticated(providerId);
    let handle: { url: string; token: string };
    try {
      handle = await this.curatorProxyManager.ensureProxy(providerId);
    } catch (error: unknown) {
      throw new CuratorAuthError(
        providerId,
        `Failed to start curator proxy for ${providerId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const curatorValues: AuthEnv = {
      ANTHROPIC_BASE_URL: handle.url,
      ANTHROPIC_AUTH_TOKEN: handle.token,
      ...this.buildTierValues(providerId),
    };
    return { env: this.buildCuratorEnv(curatorValues), baseUrl: handle.url };
  }

  private async assertProxyAuthenticated(providerId: string): Promise<void> {
    if (providerId === 'github-copilot') {
      const ok =
        (await this.copilotAuth.isAuthenticated()) ||
        (await this.copilotAuth.tryRestoreAuth());
      if (!ok) {
        throw new CuratorAuthError(
          providerId,
          'GitHub Copilot is not authenticated for the curator provider.',
        );
      }
      return;
    }
    if (providerId === 'openai-codex') {
      const authed = await this.codexAuth.isAuthenticated();
      const fresh = authed ? await this.codexAuth.ensureTokensFresh() : false;
      if (!authed || !fresh) {
        throw new CuratorAuthError(
          providerId,
          'OpenAI Codex is not authenticated for the curator provider.',
        );
      }
      return;
    }
    if (providerId === 'openrouter') {
      if (!(await this.openRouterAuth.isAuthenticated())) {
        throw new CuratorAuthError(
          providerId,
          'OpenRouter is not authenticated for the curator provider.',
        );
      }
      return;
    }
  }

  private buildTierValues(providerId: string): AuthEnv {
    const tiers = getAnthropicProvider(providerId)?.defaultTiers;
    if (!tiers) {
      return {};
    }
    return {
      ANTHROPIC_DEFAULT_SONNET_MODEL: tiers.sonnet,
      ANTHROPIC_DEFAULT_OPUS_MODEL: tiers.opus,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: tiers.haiku,
    };
  }

  private resolveProviderBaseUrl(providerId: string): string {
    const override = this.config.get<string>(`provider.${providerId}.baseUrl`);
    if (typeof override === 'string' && override.trim().length > 0) {
      return override.trim();
    }
    return getProviderBaseUrl(providerId);
  }

  buildCuratorEnv(curatorValues: AuthEnv): AuthEnv {
    const base: Record<string, string | undefined> = { ...process.env };
    for (const key of CHAT_AUTH_KEYS) {
      base[key] = undefined;
    }
    return { ...base, ...curatorValues } as AuthEnv;
  }
}
