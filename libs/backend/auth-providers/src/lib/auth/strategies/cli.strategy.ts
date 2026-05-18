/**
 * CLI Strategy
 *
 * Handles authentication via Claude CLI's own credential store (~/.claude/).
 * When selected, NO API key env vars are set - the SDK reads credentials
 * from the CLI automatically.
 *
 * Supports users with Claude Max/Pro subscriptions who don't have
 * a separate API key.
 *
 * Extracted from AuthManager.configureClaudeCli().
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import type {
  IAuthStrategy,
  AuthConfigureResult,
  AuthConfigureContext,
} from '../auth-strategy.types';
import { AUTH_PROVIDERS_TOKENS } from '../../di/tokens';
import { SDK_TOKENS, type ClaudeCliDetector } from '@ptah-extension/agent-sdk';
import type { ProviderModelsService } from '../../provider-models.service';

@injectable()
export class CliStrategy implements IAuthStrategy {
  readonly name = 'CliStrategy';

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_CLI_DETECTOR)
    private readonly cliDetector: ClaudeCliDetector,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_MODELS)
    private readonly providerModels: ProviderModelsService,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
  ) {}

  async configure(
    _context: AuthConfigureContext,
  ): Promise<AuthConfigureResult> {
    this.logger.info(`[${this.name}] Configuring Claude CLI authentication`);
    const health = await this.cliDetector.performHealthCheck();

    if (!health.available) {
      this.logger.warn(
        `[${this.name}] Claude CLI not found: ${health.error ?? 'not installed'}`,
      );
      return {
        configured: false,
        details: [],
        errorMessage:
          'Claude CLI is not installed. Install it with: npm install -g @anthropic-ai/claude-code',
      };
    }

    this.logger.info(
      `[${this.name}] Claude CLI found at ${health.path} (v${health.version ?? 'unknown'})`,
    );
    this.providerModels.clearAllTierEnvVars();

    this.logger.info(
      `[${this.name}] Using Claude CLI authentication (credentials managed by CLI)`,
    );

    return {
      configured: true,
      details: [
        `Claude CLI v${health.version ?? 'unknown'} (credentials managed by CLI at ${health.path})`,
      ],
    };
  }

  async teardown(): Promise<void> {
  }
}
