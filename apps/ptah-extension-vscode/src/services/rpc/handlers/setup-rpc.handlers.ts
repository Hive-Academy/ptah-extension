/**
 * Setup RPC Handlers
 *
 * Handles setup-related RPC methods: setup-status:get-status, setup-wizard:launch
 * Manages agent setup status and wizard launching.
 *
 * TASK_2025_074: Extracted from monolithic RpcMethodRegistrationService
 * TASK_2025_069: Setup wizard integration
 */

import { injectable, inject, DependencyContainer } from 'tsyringe';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
import * as vscode from 'vscode';

/**
 * SetupStatus response type for setup-status:get-status RPC method
 */
interface SetupStatusResponse {
  isConfigured: boolean;
  agentCount: number;
  lastModified: string | null;
  projectAgents: string[];
  userAgents: string[];
}

/**
 * RPC handlers for setup operations
 */
@injectable()
export class SetupRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    private readonly container: DependencyContainer
  ) {}

  /**
   * Register all setup RPC methods
   */
  register(): void {
    this.registerGetStatus();
    this.registerLaunchWizard();

    this.logger.debug('Setup RPC handlers registered', {
      methods: ['setup-status:get-status', 'setup-wizard:launch'],
    });
  }

  /**
   * setup-status:get-status - Get agent configuration status
   */
  private registerGetStatus(): void {
    this.rpcHandler.registerMethod<void, SetupStatusResponse>(
      'setup-status:get-status',
      async () => {
        this.logger.debug('RPC: setup-status:get-status called');

        // Get workspace folder
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          throw new Error(
            'No workspace folder open. Please open a folder to configure agents.'
          );
        }

        // Dynamically import agent-generation library (lazy loading)
        const { AGENT_GENERATION_TOKENS } = await import(
          '@ptah-extension/agent-generation'
        );

        // Resolve SetupStatusService from DI container
        const setupStatusService = this.container.resolve(
          AGENT_GENERATION_TOKENS.SETUP_STATUS_SERVICE
        ) as {
          getStatus: (uri: vscode.Uri) => Promise<{
            isErr: () => boolean;
            value?: SetupStatusResponse;
            error?: Error;
          }>;
        };

        // Get status
        const result = await setupStatusService.getStatus(workspaceFolder.uri);

        // Handle error result
        if (result.isErr()) {
          this.logger.error('Failed to get setup status', result.error);
          throw new Error(
            result.error?.message || 'Failed to retrieve agent setup status'
          );
        }

        // Return the status data
        return result.value as SetupStatusResponse;
      }
    );
  }

  /**
   * setup-wizard:launch - Launch setup wizard webview
   */
  private registerLaunchWizard(): void {
    this.rpcHandler.registerMethod<void, { success: boolean }>(
      'setup-wizard:launch',
      async () => {
        this.logger.debug('RPC: setup-wizard:launch called');

        // Get workspace folder
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          throw new Error(
            'No workspace folder open. Please open a folder first.'
          );
        }

        // Dynamically import agent-generation library (lazy loading)
        const { AGENT_GENERATION_TOKENS } = await import(
          '@ptah-extension/agent-generation'
        );

        // Resolve SetupWizardService from DI container
        const setupWizardService = this.container.resolve(
          AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE
        ) as {
          launchWizard: (uri: vscode.Uri) => Promise<{
            isErr: () => boolean;
            error?: Error;
          }>;
        };

        // Launch wizard
        const result = await setupWizardService.launchWizard(
          workspaceFolder.uri
        );

        // Handle error result
        if (result.isErr()) {
          this.logger.error('Failed to launch setup wizard', result.error);
          throw new Error(
            result.error?.message || 'Failed to launch setup wizard'
          );
        }

        // Return success
        return { success: true };
      }
    );
  }
}
