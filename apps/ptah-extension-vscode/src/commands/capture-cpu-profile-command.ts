/**
 * `ptah.captureCpuProfile` — the VS Code half of the hang diagnostics
 * (TASK_2026_323).
 *
 * The Electron host gets a direct IPC channel for this; the extension host gets
 * a command, because a command is the only user-reachable entry point VS Code
 * offers that does not require Ptah's own webview to be responsive. If the
 * extension host is wedged the palette will be sluggish, but VS Code's UI runs
 * in a different process and the command still queues.
 */

import * as vscode from 'vscode';
import type {
  CommandManager,
  DiagnosticsHandle,
  Logger,
} from '@ptah-extension/vscode-core';

/**
 * 10 s. Matches the auto-capture duration so a profile taken by hand and one
 * taken by the lag trigger are directly comparable side by side.
 */
const CAPTURE_DURATION_MS = 10_000;

export function registerCaptureCpuProfileCommand(
  commandManager: CommandManager,
  diagnostics: DiagnosticsHandle,
  logger: Logger,
): void {
  try {
    commandManager.registerCommand({
      id: 'ptah.captureCpuProfile',
      title: 'Capture CPU Profile',
      category: 'Ptah',
      handler: async () => {
        try {
          // Progress notification rather than a silent 10 s wait: the command
          // is most likely to be run while the window already feels broken, and
          // "nothing happened" is indistinguishable from "the command is also
          // hung" without it.
          const profilePath = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Capturing Ptah CPU profile (${
                CAPTURE_DURATION_MS / 1000
              }s)...`,
              cancellable: false,
            },
            () => diagnostics.captureCpuProfile(CAPTURE_DURATION_MS),
          );

          const openFolder = 'Reveal in Explorer';
          const choice = await vscode.window.showInformationMessage(
            `CPU profile written to ${profilePath}`,
            openFolder,
          );
          if (choice === openFolder) {
            await vscode.commands.executeCommand(
              'revealFileInOS',
              vscode.Uri.file(profilePath),
            );
          }
        } catch (error: unknown) {
          const reason = error instanceof Error ? error.message : String(error);
          logger.error(
            'CPU profile capture failed',
            error instanceof Error ? error : new Error(reason),
          );
          vscode.window.showErrorMessage(
            `Failed to capture CPU profile: ${reason}`,
          );
        }
      },
    });

    logger.info('Capture CPU profile command registered');
  } catch (error: unknown) {
    logger.warn(
      'Capture CPU profile command registration skipped (likely already registered)',
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}
