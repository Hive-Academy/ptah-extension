/**
 * CLI Strategy - TASK_AUTH_REFACTOR Phase 2
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
import type {
  IAuthStrategy,
  AuthConfigureResult,
  AuthConfigureContext,
} from '../auth-strategy.types';
import { SDK_TOKENS } from '../../di/tokens';
import type { ProviderModelsService } from '../../provider-models.service';
import type { ClaudeCliDetector } from '../../detector/claude-cli-detector';
import { ANTHROPIC_DIRECT_PROVIDER_ID } from '../../helpers/anthropic-provider-registry';

@injectable()
export class CliStrategy implements IAuthStrategy {
  readonly name = 'CliStrategy';

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_CLI_DETECTOR)
    private readonly cliDetector: ClaudeCliDetector,
    @inject(SDK_TOKENS.SDK_PROVIDER_MODELS)
    private readonly providerModels: ProviderModelsService,
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
    // Apply direct provider tier mappings (same as API key mode).
    try {
      this.providerModels.applyPersistedTiers(ANTHROPIC_DIRECT_PROVIDER_ID);
    } catch (e) {
      this.logger.warn(
        `[${this.name}] Failed to apply tier mappings for CLI auth`,
        e instanceof Error ? e : new Error(String(e)),
      );
    }

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
