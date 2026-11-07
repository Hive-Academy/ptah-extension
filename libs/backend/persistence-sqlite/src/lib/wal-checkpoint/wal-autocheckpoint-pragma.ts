/**
 * Set `wal_autocheckpoint` and prove it took: SQLite is asked for the value
 * back, and anything but the requested page count is a failure. Never throws.
 */
import { z } from 'zod';
import type { SqliteDatabase } from '../sqlite-connection.service';
import type { WalAutoCheckpointOutcome } from './wal-checkpoint-state';

const pageCountSchema = z.number().int().nonnegative();

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * @param pages a page count already proved by `assertWalAutoCheckpointPages`;
 *   it is interpolated because a pragma argument cannot be bound.
 */
export function applyWalAutoCheckpointPragma(
  db: SqliteDatabase,
  pages: number,
): WalAutoCheckpointOutcome {
  try {
    db.pragma(`wal_autocheckpoint = ${pages}`);
    const readBack = pageCountSchema.safeParse(
      db.pragma('wal_autocheckpoint', { simple: true }),
    );
    if (!readBack.success) {
      return {
        status: 'failed',
        error: new Error(
          `wal_autocheckpoint read back an unexpected value: ${readBack.error.message}`,
        ),
      };
    }
    if (readBack.data !== pages) {
      return {
        status: 'failed',
        error: new Error(
          `wal_autocheckpoint read back ${readBack.data}, expected ${pages}`,
        ),
      };
    }
    return { status: 'applied', pages };
  } catch (error: unknown) {
    return { status: 'failed', error: toError(error) };
  }
}
