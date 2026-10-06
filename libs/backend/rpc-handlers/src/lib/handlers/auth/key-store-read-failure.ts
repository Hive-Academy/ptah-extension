import { RpcUserError } from '@ptah-extension/vscode-core';
import type { Logger, SentryService } from '@ptah-extension/vscode-core';

/**
 * A key-store read failed. Store errors can carry key material, so only the
 * error's type is logged and the caller gets fixed text (Batch 7 / 12b rule).
 */
export function keyStoreReadFailure(
  logger: Logger,
  sentryService: SentryService,
  method: string,
  error: unknown,
): RpcUserError {
  const errorType = error instanceof Error ? error.name : 'unknown';
  logger.error(`RPC: ${method} could not read the key store`, {
    errorType,
  });
  sentryService.captureException(
    new Error(`${method}: key store read failed (${errorType})`),
    { errorSource: `AuthRpcHandlers.${method}` },
  );
  return new RpcUserError(
    'Could not read the stored keys.',
    'PERSISTENCE_UNAVAILABLE',
  );
}
