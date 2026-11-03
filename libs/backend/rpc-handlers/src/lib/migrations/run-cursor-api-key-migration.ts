import type { DependencyContainer } from 'tsyringe';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  TOKENS,
  type IAuthSecretsService,
  type Logger,
} from '@ptah-extension/vscode-core';
import { migrateCursorApiKeyToSecrets } from './cursor-api-key-migration';
import { migrateKeylessApiKeyAuthMethod } from './keyless-api-key-auth-migration';

/**
 * Startup step shared by the VS Code, Electron and CLI composition roots: move
 * a legacy plain-text Cursor key into the secrets store (TASK_2026_538), then
 * repair a key-less global `'apiKey'` auth method.
 *
 * Runs on every boot rather than through the sentinel-based settings
 * `MigrationRunner`, so a plain value written later (older build, hand edit) is
 * still moved. Never throws: a failure is logged without the key, the plain
 * setting stays, and the next boot retries.
 */
export async function runCursorApiKeyMigration(
  container: DependencyContainer,
): Promise<void> {
  let logger: Logger | undefined;
  try {
    logger = container.resolve<Logger>(TOKENS.LOGGER);
    const outcome = await migrateCursorApiKeyToSecrets(
      container.resolve<IWorkspaceProvider>(PLATFORM_TOKENS.WORKSPACE_PROVIDER),
      container.resolve<IAuthSecretsService>(TOKENS.AUTH_SECRETS_SERVICE),
      logger,
    );
    if (outcome !== 'none') {
      logger.info(`[CursorApiKeyMigration] plain setting ${outcome}`);
    }
  } catch (error: unknown) {
    // The error text of a secrets-store failure can carry the value; log none of it.
    logger?.warn(
      '[CursorApiKeyMigration] failed; the plain setting is kept and retried next start',
      { errorType: error instanceof Error ? error.name : typeof error },
    );
  }
  await runKeylessApiKeyAuthMigration(container, logger);
}

/**
 * Same startup step, same every-boot rule: a key-less global `'apiKey'` auth
 * method becomes the Claude CLI default. Never throws; a failure keeps the
 * stored value and the next boot retries.
 */
async function runKeylessApiKeyAuthMigration(
  container: DependencyContainer,
  logger: Logger | undefined,
): Promise<void> {
  try {
    const outcome = await migrateKeylessApiKeyAuthMethod(
      container.resolve<IWorkspaceProvider>(PLATFORM_TOKENS.WORKSPACE_PROVIDER),
      container.resolve<IAuthSecretsService>(TOKENS.AUTH_SECRETS_SERVICE),
    );
    if (outcome === 'migrated') {
      logger?.info(
        '[AuthMethodMigration] key-less global apiKey auth method set to claudeCli',
      );
    }
  } catch (error: unknown) {
    logger?.warn(
      '[AuthMethodMigration] failed; the stored auth method is kept and retried next start',
      { errorType: error instanceof Error ? error.name : typeof error },
    );
  }
}
