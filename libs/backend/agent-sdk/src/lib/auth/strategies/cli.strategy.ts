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
import { SDK_TOKENS } from '../../di/tokens';
import type { ProviderModelsService } from '../../provider-models.service';
import type { ClaudeCliDetector } from '../../detector/claude-cli-detector';

@injectable()
export class CliStrategy implements IAuthStrategy {
  readonly name = 'CliStrategy';

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_CLI_DETECTOR)
    private readonly cliDetector: ClaudeCliDetector,
    @inject(SDK_TOKENS.SDK_PROVIDER_MODELS)
    private readonly providerModels: ProviderModelsService,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
  ) {}

  async configure(
    _context: AuthConfigureContext,
  ): Promise<AuthConfigureResult> {
    this.logger.info(`[${this.name}] Configuring Claude CLI authentication`);

    // Verify CLI is installed
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

    // Don't set any API key env vars - the SDK will use the CLI's credential store.
    // Direct Anthropic (CLI auth): let the CLI resolve its own tiers natively.
    // Don't apply persisted tier overrides — those are for third-party providers
    // (OpenRouter/Moonshot/Z.AI) that need tier→provider-model mapping. Pinning
    // the CLI's opus/sonnet/haiku via ANTHROPIC_DEFAULT_*_MODEL env vars blocks
    // the CLI from returning its account-appropriate defaults.
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
    // CLI strategy has no resources to tear down
  }
}
