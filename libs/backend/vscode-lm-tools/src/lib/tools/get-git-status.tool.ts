/**
 * Get Git Status Tool
 *
 * Gets current git repository status with modified/staged/untracked files
 */

import * as vscode from 'vscode';
import { injectable } from 'tsyringe';
import { IGetGitStatusParameters } from '../types/tool-parameters';

@injectable()
export class GetGitStatusTool
  implements vscode.LanguageModelTool<IGetGitStatusParameters>
{
  async prepareInvocation(
    _options: vscode.LanguageModelToolInvocationPrepareOptions<IGetGitStatusParameters>
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: 'Getting git repository status...',
      confirmationMessages: {
        title: 'Get Git Status',
        message: new vscode.MarkdownString(
          'Get current git repository status including modified, staged, and untracked files?'
        ),
      },
    };
  }

  async invoke(
    _options: vscode.LanguageModelToolInvocationOptions<IGetGitStatusParameters>
  ): Promise<vscode.LanguageModelToolResult> {
    try {
      // Get git extension
      const gitExtension =
        vscode.extensions.getExtension('vscode.git')?.exports;
      if (!gitExtension) {
        throw new Error('Git extension not available');
      }

      const git = gitExtension.getAPI(1);
      if (git.repositories.length === 0) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            'No git repository found in the workspace. Initialize a git repository with `git init`.'
          ),
        ]);
      }

      const repo = git.repositories[0]; // Use first repository
      const state = repo.state;

      const formatChanges = (
        changes: Array<{ uri: vscode.Uri }>,
        icon: string,
        label: string
      ) => {
        if (changes.length === 0) return '';

        const fileList = changes
          .map((c) => `  ${icon} ${vscode.workspace.asRelativePath(c.uri)}`)
          .join('\n');

        return `**${label}** (${changes.length}):\n${fileList}\n\n`;
      };

      const staged = formatChanges(state.indexChanges, '✅', 'Staged Changes');

      const modified = formatChanges(
        state.workingTreeChanges,
        '📝',
        'Modified Files'
      );

      const untracked = formatChanges(
        state.untrackedChanges || [],
        '❓',
        'Untracked Files'
      );

      const branch = state.HEAD?.name || 'detached HEAD';
      const ahead = state.HEAD?.ahead || 0;
      const behind = state.HEAD?.behind || 0;

      let status = `**Branch**: ${branch}\n`;
      if (ahead > 0) status += `**Ahead**: ${ahead} commit(s)\n`;
      if (behind > 0) status += `**Behind**: ${behind} commit(s)\n`;
      status += '\n';

      if (!staged && !modified && !untracked) {
        status += 'Working tree clean - no changes to commit.';
      } else {
        status += staged + modified + untracked;
      }

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`Git Repository Status:\n\n${status}`),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get git status: ${message}`);
    }
  }
}
