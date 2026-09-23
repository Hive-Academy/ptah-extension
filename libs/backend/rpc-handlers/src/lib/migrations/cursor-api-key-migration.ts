import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { IAuthSecretsService, Logger } from '@ptah-extension/vscode-core';

/** Move the legacy Cursor key after secrets storage is available at startup. */
export async function migrateCursorApiKeyToSecrets(
  workspace: IWorkspaceProvider,
  secrets: IAuthSecretsService,
  logger: Logger,
): Promise<'migrated' | 'cleared' | 'none'> {
  const legacyValue = workspace.getConfiguration<unknown>(
    'ptah',
    'provider.cursor.apiKey',
  );
  if (legacyValue === undefined || legacyValue === '') {
    return 'none';
  }

  let outcome: 'migrated' | 'cleared' = 'cleared';
  if (typeof legacyValue === 'string' && legacyValue.trim()) {
    const exists = await secrets.hasProviderKey('cursor');
    if (!exists) {
      // Keep the plain value available for a retry if secret storage fails.
      await secrets.setProviderKey('cursor', legacyValue.trim());
      outcome = 'migrated';
    }
  }
  // File-based settings omit undefined values when serializing settings.json.
  await workspace.setConfiguration('ptah', 'provider.cursor.apiKey', undefined);
  logger.info(outcome);
  return outcome;
}
