/**
 * Setup Wizard Service (Facade)
 *
 * Orchestrates the setup wizard UI flow for intelligent agent generation.
 * Manages webview lifecycle and provides cancellation capabilities.
 *
 * Note: Old postMessage handlers and session management removed.
 * The Angular SPA now communicates via RPC handlers registered in setup-rpc.handlers.ts.
 *
 * Pattern: Facade
 *
 * @module @ptah-extension/agent-generation/services
 */

import { injectable, inject } from 'tsyringe';
import {
  Logger,
  TOKENS,
  type WebviewManager,
} from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import { MESSAGE_TYPES, Result } from '@ptah-extension/shared';
import type { SetupGenerationOpenPayload } from '@ptah-extension/shared';
import { ISetupWizardService } from '../interfaces/setup-wizard.interface';
import { AGENT_GENERATION_TOKENS } from '../di/tokens';
import { WizardWebviewLifecycleService } from './wizard';

@injectable()
export class SetupWizardService implements ISetupWizardService {
  /**
   * Launch lock to prevent concurrent wizard launch attempts.
   */
  private isLaunching = false;

  /**
   * Webview panel view type identifier.
   */
  private readonly WIZARD_VIEW_TYPE = 'ptah.setupWizard';

  constructor(
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,
    @inject(AGENT_GENERATION_TOKENS.WIZARD_WEBVIEW_LIFECYCLE)
    private readonly webviewLifecycle: WizardWebviewLifecycleService,
    @inject(TOKENS.PLATFORM_COMMANDS)
    private readonly platformCommands: {
      reloadWindow(): Promise<void>;
      focusChat(): Promise<void>;
    },
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManager,
  ) {
    this.logger.debug('SetupWizardService initialized');
  }

  /**
   * Launch the setup wizard webview.
   *
   * @param workspacePath - Absolute path to the workspace root
   */
  async launchWizard(workspacePath: string): Promise<Result<void, Error>> {
    if (this.isLaunching) {
      this.logger.warn(
        'Wizard launch already in progress, ignoring duplicate request',
      );
      return Result.ok(undefined);
    }

    try {
      this.isLaunching = true;

      if (!workspacePath || workspacePath.trim() === '') {
        this.logger.error('Cannot launch wizard: No workspace folder open');
        return Result.err(new Error('No workspace folder open'));
      }

      this.logger.info('Launching setup wizard', {
        workspace: workspacePath,
      });
      const existingPanel = this.webviewLifecycle.getPanel(
        this.WIZARD_VIEW_TYPE,
      );
      if (existingPanel) {
        existingPanel.reveal();
        return Result.ok(undefined);
      }
      const panel = await this.webviewLifecycle.createWizardPanel(
        'Ptah Setup Wizard',
        this.WIZARD_VIEW_TYPE,
        [
          async (message: unknown) => {
            if (!message || typeof message !== 'object') return false;
            const msg = message as { type?: string; payload?: unknown };
            if (msg.type === MESSAGE_TYPES.SETUP_GENERATION_OPEN) {
              if (!this.isGenerationOpenPayload(msg.payload, workspacePath))
                return false;
              const result = await this.openGeneration(msg.payload);
              return result.isOk();
            }
            if (msg.type === MESSAGE_TYPES.SETUP_WIZARD_COMPLETE) {
              this.logger.info(
                'Wizard complete - closing panel and reloading window',
              );
              this.webviewLifecycle.disposeWebview(this.WIZARD_VIEW_TYPE);
              await this.platformCommands.reloadWindow();
              return true;
            }
            return false;
          },
        ],
      );

      if (!panel) {
        return Result.err(
          new Error('Failed to create wizard webview panel. Please try again.'),
        );
      }

      this.logger.info('Wizard launched successfully');

      return Result.ok(undefined);
    } catch (error) {
      this.sentryService.captureException(
        error instanceof Error ? error : new Error(String(error)),
        { errorSource: 'SetupWizardService.launchWizard' },
      );
      this.logger.error('Failed to launch wizard', error as Error);
      return Result.err(
        new Error(`Wizard launch failed: ${(error as Error).message}`),
      );
    } finally {
      this.isLaunching = false;
    }
  }

  async openGeneration(
    payload: SetupGenerationOpenPayload,
  ): Promise<Result<void, Error>> {
    try {
      await this.platformCommands.focusChat();
      const delivered = await this.webviewManager.sendMessage(
        'ptah.main',
        MESSAGE_TYPES.SETUP_GENERATION_OPEN,
        payload,
      );
      if (!delivered)
        return Result.err(new Error('Main chat is not ready. Try again.'));
      return Result.ok(undefined);
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Failed to open generation in main chat', cause);
      return Result.err(new Error('Main chat is not ready. Try again.'));
    }
  }

  private isGenerationOpenPayload(
    value: unknown,
    workspacePath: string,
  ): value is SetupGenerationOpenPayload {
    if (!value || typeof value !== 'object') return false;
    const payload = value as Record<string, unknown>;
    return (
      payload['workspacePath'] === workspacePath &&
      (payload['workflow'] === 'setup-agent-generation' ||
        payload['workflow'] === 'setup-project-prompt') &&
      (payload['origin'] === 'analysis-result-continue' ||
        payload['origin'] === 'independent-start')
    );
  }

  /**
   * Cancel and clean up the wizard.
   */
  async cancelWizard(
    _sessionId: string,
    _saveProgress: boolean,
  ): Promise<Result<void, Error>> {
    try {
      this.logger.info('Cancelling wizard');
      this.webviewLifecycle.disposeWebview(this.WIZARD_VIEW_TYPE);
      this.logger.info('Wizard cancelled successfully');
      return Result.ok(undefined);
    } catch (error) {
      this.sentryService.captureException(
        error instanceof Error ? error : new Error(String(error)),
        { errorSource: 'SetupWizardService.cancelWizard' },
      );
      this.logger.error('Failed to cancel wizard', error as Error);
      return Result.err(
        new Error(`Wizard cancellation failed: ${(error as Error).message}`),
      );
    }
  }

  /**
   * Get current wizard session (stub for interface compatibility).
   */
  getCurrentSession(): null {
    return null;
  }
}
