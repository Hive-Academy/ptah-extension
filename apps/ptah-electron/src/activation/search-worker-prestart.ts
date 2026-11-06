/**
 * Fork the SQLite search worker as soon as the database is migrated.
 *
 * `SearchWorkerClient` used to fork its utility process on the first search,
 * list or chunk request, which can come a minute or more into a session; the
 * searches of that minute then also paid the worker boot. Forking right after
 * migrations means the worker is ready (read-only open + sqlite-vec load) long
 * before the first request. The embedder warm-up is not started here: the
 * client defers it to the first request, and the app's own embedder warm-up
 * keeps its background-learning pause policy.
 */
import type { DependencyContainer } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { MEMORY_TOKENS } from '@ptah-extension/memory-curator';

/** The part of `SearchWorkerClient` this step uses. */
interface StartableSearchWorker {
  start(): void;
}

export function startSearchWorkerAfterMigrations(container: DependencyContainer): void {
  if (!container.isRegistered(MEMORY_TOKENS.SQLITE_SEARCH_WORKER)) return;
  const logger = container.resolve<Logger>(TOKENS.LOGGER);
  try {
    container.resolve<StartableSearchWorker>(MEMORY_TOKENS.SQLITE_SEARCH_WORKER).start();
  } catch (error: unknown) {
    // degradation-audit: reported - logged at warn; the client forks on the
    // first search instead, as before.
    logger.warn('[Ptah Electron] SQLite search worker prestart failed (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
