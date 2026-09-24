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

/**
 * Startup step shared by the VS Code, Electron and CLI composition roots: move
 * a legacy plain-text Cursor key into the secrets store (TASK_2026_538).
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
}
