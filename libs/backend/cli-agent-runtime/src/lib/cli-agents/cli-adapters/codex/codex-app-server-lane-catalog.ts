import type { CodexContext, CodexModelInfo } from '@ptah-extension/codex-runtime';
import type { Logger } from '@ptah-extension/vscode-core';

const CATALOG_TIMEOUT_MS = 8_000;

/** Bounds both catalog startup and listing, including a context opened after timeout. */
export async function readCodexLaneCatalog(
  open: () => Promise<CodexContext>,
  logger: Logger,
): Promise<readonly CodexModelInfo[]> {
  let timedOut = false;
  let context: CodexContext | undefined;
  let closing: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const closeOnce = (opened: CodexContext): Promise<void> => {
    closing ??= opened.close();
    return closing;
  };
  const operation = (async (): Promise<readonly CodexModelInfo[]> => {
    const opened = await open();
    context = opened;
    if (timedOut) {
      await closeOnce(opened);
      throw new Error('Codex model catalog timed out');
    }
    try {
      return await opened.listModels();
    } finally {
      await closeOnce(opened);
    }
  })();
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          if (context) {
            void closeOnce(context).catch((error: unknown) => {
              logger.warn('[CodexAppServerLaneAdapter] Timed-out catalog context close failed', {
                errorClass: error instanceof Error ? error.constructor.name : typeof error,
              });
            });
          }
          reject(new Error('Codex model catalog timed out'));
        }, CATALOG_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
