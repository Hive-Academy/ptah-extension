import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { IAuthSecretsService } from '@ptah-extension/vscode-core';

/**
 * Repair a global `authMethod` of `'apiKey'` that has no API key behind it.
 *
 * Older builds wrote `'apiKey'` as the base value. Every workspace without
 * its own override (for example each new git worktree) then resolved to the
 * direct API key route even though the user signs in with the Claude CLI. The
 * Claude CLI login is the default, so a key-less `'apiKey'` base becomes
 * `'claudeCli'`. A stored or environment key keeps the value as it is, and so
 * does a non-Anthropic `llm.defaultProvider`: the CLI's `auth use openrouter`
 * and `auth use z-ai` write `'apiKey'` with the key in that provider's slot.
 */
export async function migrateKeylessApiKeyAuthMethod(
  workspace: IWorkspaceProvider,
  secrets: Pick<IAuthSecretsService, 'hasCredential'>,
): Promise<'migrated' | 'none'> {
  if (workspace.getConfiguration<unknown>('ptah', 'authMethod') !== 'apiKey') {
    return 'none';
  }
  const defaultProvider = workspace.getConfiguration<unknown>(
    'ptah',
    'llm.defaultProvider',
  );
  if (
    typeof defaultProvider === 'string' &&
    defaultProvider.trim() !== '' &&
    defaultProvider.trim() !== 'anthropic'
  ) {
    return 'none';
  }
  if (process.env['ANTHROPIC_API_KEY']?.trim()) return 'none';
  if (await secrets.hasCredential('apiKey')) return 'none';
  await workspace.setConfiguration('ptah', 'authMethod', 'claudeCli');
  return 'migrated';
}
