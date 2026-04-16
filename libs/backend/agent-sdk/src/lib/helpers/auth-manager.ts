/**
 * Authentication Manager - Thin Orchestrator (TASK_AUTH_REFACTOR Phase 2)
 *
 * Replaced the ~1000-line god class with a strategy-based orchestrator.
 * All authentication logic lives in 5 strategy classes under auth/strategies/.
 *
 * This class is responsible ONLY for:
 * 1. Concurrency guard (one configuration at a time)
 * 2. Clean slate (clear env vars before each reconfiguration)
 * 3. Strategy selection via resolveStrategy()
 * 4. Delegating to the selected strategy's configure() method
 * 5. Tracking the active strategy for teardown
 * 6. Environment summary logging
 *
 * Public API is UNCHANGED:
 * - configureAuthentication(rawAuthMethod: string): Promise<AuthResult>
 * - clearAuthentication(): void
 */

import { injectable, inject } from 'tsyringe';
import { Logger, ConfigManager, TOKENS } from '@ptah-extension/vscode-core';
import type { AuthEnv, AuthStrategyType } from '@ptah-extension/shared';
import { resolveStrategy, type LegacyAuthMethod } from '@ptah-extension/shared';
import type { IAuthStrategy } from '../auth/auth-strategy.types';
import { SDK_TOKENS } from '../di/tokens';
import type { ProviderModelsService } from '../provider-models.service';
import {
  getAnthropicProvider,
  DEFAULT_PROVIDER_ID,
  ANTHROPIC_DIRECT_PROVIDER_ID,
} from './anthropic-provider-registry';

export interface AuthResult {
  configured: boolean;
  details: string[];
  errorMessage?: string;
}

export interface AuthConfig {
  method: 'apiKey' | 'claudeCli' | 'thirdParty';
}

/** All auth-related environment variable names (single source of truth) */
const AUTH_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
] as const;

/**
 * Manages SDK authentication setup and validation.
 *
 * Delegates all provider-specific logic to IAuthStrategy implementations.
 */
@injectable()
export class AuthManager {
  private configInProgress: Promise<AuthResult> | null = null;
  private activeStrategy: IAuthStrategy | null = null;

  /** Strategy registry: maps AuthStrategyType to the injected strategy instance */
  private readonly strategyRegistry: ReadonlyMap<
    AuthStrategyType,
    IAuthStrategy
  >;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.CONFIG_MANAGER) private readonly config: ConfigManager,
    @inject(SDK_TOKENS.SDK_PROVIDER_MODELS)
    private readonly providerModels: ProviderModelsService,
    @inject(SDK_TOKENS.SDK_AUTH_ENV) private readonly authEnv: AuthEnv,
    @inject(SDK_TOKENS.SDK_API_KEY_STRATEGY)
    apiKeyStrategy: IAuthStrategy,
    @inject(SDK_TOKENS.SDK_OAUTH_PROXY_STRATEGY)
    oauthProxyStrategy: IAuthStrategy,
    @inject(SDK_TOKENS.SDK_LOCAL_NATIVE_STRATEGY)
    localNativeStrategy: IAuthStrategy,
    @inject(SDK_TOKENS.SDK_LOCAL_PROXY_STRATEGY)
    localProxyStrategy: IAuthStrategy,
    @inject(SDK_TOKENS.SDK_CLI_STRATEGY)
    cliStrategy: IAuthStrategy,
  ) {
    this.strategyRegistry = new Map<AuthStrategyType, IAuthStrategy>([
      ['api-key', apiKeyStrategy],
      ['oauth-proxy', oauthProxyStrategy],
      ['local-native', localNativeStrategy],
      ['local-proxy', localProxyStrategy],
      ['cli', cliStrategy],
    ]);
  }

  /**
   * Configure authentication for SDK
   * Returns auth status and details for logging
   *
   * Uses the "Clean Slate" pattern:
   * 1. Clear ALL auth + tier env vars (single source of truth)
   * 2. Teardown previous active strategy
   * 3. Resolve strategy from legacy auth method + provider metadata
   * 4. Delegate to strategy.configure()
   * 5. Log env summary (boolean presence, no secrets)
   */
  async configureAuthentication(rawAuthMethod: string): Promise<AuthResult> {
    // Concurrency guard: if a configuration is already in progress, await it
    if (this.configInProgress) {
      this.logger.debug(
        '[AuthManager] configureAuthentication already in progress, awaiting existing call',
      );
      return this.configInProgress;
    }

    this.configInProgress = this.doConfigureAuthentication(rawAuthMethod);
    try {
      return await this.configInProgress;
    } finally {
      this.configInProgress = null;
    }
  }

  /**
   * Internal implementation of configureAuthentication (guarded by concurrency mutex above)
   */
  private async doConfigureAuthentication(
    rawAuthMethod: string,
  ): Promise<AuthResult> {
    // Step 1: Normalize legacy method (migrate 'openrouter' → 'thirdParty')
    const normalized =
      rawAuthMethod === 'openrouter' ? 'thirdParty' : rawAuthMethod;
    const validMethods = new Set<string>(['apiKey', 'claudeCli', 'thirdParty']);
    const authMethod = (
      validMethods.has(normalized) ? normalized : 'apiKey'
    ) as LegacyAuthMethod;

    if (rawAuthMethod !== authMethod) {
      this.logger.warn(
        `[AuthManager] Normalized auth method '${rawAuthMethod}' → '${authMethod}'`,
      );
    }

    this.logger.debug(`[AuthManager] Configuring auth method: ${authMethod}`);

    // Capture env snapshot before clean slate wipe (strategies may need fallback values)
    const envSnapshot = {
      ANTHROPIC_API_KEY: process.env['ANTHROPIC_API_KEY'],
    };

    // Step 2: Clean slate - clear ALL auth and tier env vars
    this.clearAllAuthEnvVars();
    this.providerModels.clearAllTierEnvVars();

    // Step 3: Teardown previous active strategy
    if (this.activeStrategy) {
      try {
        await this.activeStrategy.teardown();
      } catch (e) {
        this.logger.warn(
          `[AuthManager] Failed to teardown previous strategy: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
      this.activeStrategy = null;
    }

    // Step 4: Resolve provider ID and strategy type
    const { providerId, strategyType } =
      this.resolveProviderAndStrategy(authMethod);

    this.logger.debug(
      `[AuthManager] Resolved strategy: ${strategyType} (provider: ${providerId})`,
    );

    // Step 5: Get strategy from registry
    const strategy = this.strategyRegistry.get(strategyType);
    if (!strategy) {
      this.logger.error(
        `[AuthManager] No strategy registered for type: ${strategyType}`,
      );
      this.logEnvSummary();
      return {
        configured: false,
        details: [],
        errorMessage: `Internal error: no strategy for auth type '${strategyType}'`,
      };
    }

    // Step 6: Delegate to strategy
    const result = await strategy.configure({
      providerId,
      authEnv: this.authEnv,
      envSnapshot,
    });

    // Track active strategy for future teardown
    if (result.configured) {
      this.activeStrategy = strategy;
    }

    // Step 7: Log result
    if (result.configured) {
      this.logger.info(
        `[AuthManager] Authentication configured: ${result.details.join(', ')}`,
      );
    } else if (result.errorMessage) {
      this.logger.info(`[AuthManager] ${result.errorMessage}`);
    } else {
      const infoMsg =
        'No authentication configured yet. Configure in Ptah Settings > Authentication tab.';
      this.logger.info(`[AuthManager] ${infoMsg}`);
      this.logger.debug(
        '[AuthManager] Option 1 (Provider): Configure in Settings > Authentication > Provider tab',
      );
      this.logger.debug(
        '[AuthManager] Option 2 (Claude CLI): Run "claude login" to authenticate',
      );
      this.logger.debug(
        '[AuthManager] Option 3 (API Key): Get from https://console.anthropic.com/settings/keys',
      );
      result.errorMessage = infoMsg;
    }

    this.logEnvSummary();
    return result;
  }

  /**
   * Clear all authentication environment variables and tear down active strategy.
   */
  clearAuthentication(): void {
    this.clearAllAuthEnvVars();
    this.providerModels.clearAllTierEnvVars();

    // Teardown active strategy (fire-and-forget with proper error logging)
    if (this.activeStrategy) {
      const strategyName = this.activeStrategy.name;
      this.activeStrategy.teardown().catch((err) => {
        this.logger.warn(
          `[AuthManager] Failed to teardown ${strategyName} during cleanup: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
      this.activeStrategy = null;
    }

    this.logger.debug(
      '[AuthManager] Cleared authentication environment variables',
    );
  }

  /**
   * Resolve the provider ID and strategy type from a legacy auth method.
   *
   * For 'apiKey' and 'claudeCli', the mapping is straightforward.
   * For 'thirdParty' (which means "use configured provider"), we look up the
   * provider entry from the registry to determine the correct strategy.
   */
  private resolveProviderAndStrategy(authMethod: LegacyAuthMethod): {
    providerId: string;
    strategyType: AuthStrategyType;
  } {
    if (authMethod === 'claudeCli') {
      return {
        providerId: ANTHROPIC_DIRECT_PROVIDER_ID,
        strategyType: resolveStrategy('claudeCli'),
      };
    }

    if (authMethod === 'apiKey') {
      return {
        providerId: ANTHROPIC_DIRECT_PROVIDER_ID,
        strategyType: resolveStrategy('apiKey'),
      };
    }

    // authMethod === 'thirdParty' — determine from configured provider
    const providerId = this.config.getWithDefault<string>(
      'anthropicProviderId',
      DEFAULT_PROVIDER_ID,
    );

    const provider = getAnthropicProvider(providerId);
    const strategyType = resolveStrategy('thirdParty', provider);

    return { providerId, strategyType };
  }

  /**
   * Delete ALL auth env vars from the AuthEnv singleton - single source of truth for cleanup.
   */
  private clearAllAuthEnvVars(): void {
    for (const varName of AUTH_ENV_VARS) {
      delete this.authEnv[varName as keyof AuthEnv];
      delete process.env[varName];
    }
  }

  /**
   * Log boolean presence of all auth + tier env vars (no secrets).
   */
  private logEnvSummary(): void {
    const authSummary = AUTH_ENV_VARS.map(
      (v) => `${v}=${this.authEnv[v as keyof AuthEnv] ? 'set' : 'unset'}`,
    ).join(', ');

    this.logger.debug(`[AuthManager] Env summary: ${authSummary}`);
  }
}
