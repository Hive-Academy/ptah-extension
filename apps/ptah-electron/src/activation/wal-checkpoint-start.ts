/**
 * Start off-main WAL checkpoints once the database is migrated.
 *
 * Migrations keep SQLite's own auto-checkpoint: they run before this, and the
 * scheduler only turns auto-checkpoint off after its worker has completed one
 * checkpoint. Returns the scheduler so `will-quit` can stop it (killing the
 * worker) before the connection's own TRUNCATE checkpoint at close, or `null`
 * when nothing was started.
 */
import type { DependencyContainer } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';

/** The part of `WalCheckpointScheduler` this step uses. */
interface StartableWalCheckpointScheduler {
  start(): boolean;
  dispose(): void;
}

export function startWalCheckpointsAfterMigrations(
  container: DependencyContainer,
): { dispose: () => void } | null {
  if (!container.isRegistered(PERSISTENCE_TOKENS.WAL_CHECKPOINT_SCHEDULER)) {
    return null;
  }
  const logger = container.resolve<Logger>(TOKENS.LOGGER);
  try {
    const scheduler = container.resolve<StartableWalCheckpointScheduler>(
      PERSISTENCE_TOKENS.WAL_CHECKPOINT_SCHEDULER,
    );
    return scheduler.start() ? scheduler : null;
  } catch (error: unknown) {
    // degradation-audit: reported - logged at warn; commits keep SQLite's
    // auto-checkpoint, which is the behaviour before fix 11.
    logger.warn('[Ptah Electron] WAL checkpoint scheduler start failed (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
