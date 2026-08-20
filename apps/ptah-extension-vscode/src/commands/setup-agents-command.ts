/**
 * Setup Agents Command
 *
 * Registers `ptah.setupAgents` (Command Palette: "Ptah: Setup Ptah Agents"),
 * which launches the agent setup wizard for the first workspace folder.
 *
 * VS Code-only: it couples to the `vscode` namespace, so it cannot live in a
 * platform-agnostic library. It previously rode along inside the RPC
 * registration service, which had nothing to do with RPC.
 */

import * as vscode from 'vscode';
import type { DependencyContainer } from 'tsyringe';
import type { CommandManager, Logger } from '@ptah-extension/vscode-core';
import { AGENT_GENERATION_TOKENS } from '@ptah-extension/agent-generation';

interface SetupWizardServiceLike {
  launchWizard(workspacePath: string): Promise<{
    isErr?: () => boolean;
    error?: { message: string };
  }>;
}

export function registerSetupAgentsCommand(
  container: DependencyContainer,
  commandManager: CommandManager,
  logger: Logger,
): void {
  try {
    commandManager.registerCommand({
      id: 'ptah.setupAgents',
      title: 'Setup Ptah Agents',
      category: 'Ptah',
      handler: async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

        if (!workspaceFolder) {
          vscode.window.showErrorMessage(
            'No workspace open. Please open a folder first.',
          );
          return;
        }

        try {
          const setupWizardService = container.resolve<SetupWizardServiceLike>(
            AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE,
          );

          const result = await setupWizardService.launchWizard(
            workspaceFolder.uri.fsPath,
          );

          if (result.isErr && result.isErr()) {
            vscode.window.showErrorMessage(
              `Failed to launch setup wizard: ${result.error?.message}`,
            );
          }
        } catch (error: unknown) {
          logger.error(
            'Failed to launch setup wizard',
            error instanceof Error ? error : new Error(String(error)),
          );
          vscode.window.showErrorMessage(
            `Failed to launch setup wizard: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
          );
        }
      },
    });

    logger.info('Setup agents command registered');
  } catch (error: unknown) {
    logger.warn(
      'Setup agents command registration skipped (likely already registered)',
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}
