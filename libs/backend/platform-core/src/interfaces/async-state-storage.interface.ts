/**
 * Optional asynchronous operations for state stores whose values are not
 * necessarily resident in the host process.
 *
 * This is structural rather than a separate DI token: the object registered as
 * `IStateStorage` owns the same logical state. Callers must probe the capability
 * and retain the synchronous compatibility path for adapters that do not need
 * it.
 */

import type { IStateStorage } from './state-storage.interface';

export interface StateStorageSequenceReadOptions {
  /** Opaque cursor returned by the preceding page. */
  readonly cursor?: string;
  /** Requested page budget. An adapter may enforce a lower hard maximum. */
  readonly maxBytes?: number;
}

export interface StateStorageSequencePage<T> {
  readonly items: readonly T[];
  /** Opaque continuation cursor, or `null` when the sequence is complete. */
  readonly nextCursor: string | null;
  readonly done: boolean;
  /** Conservative encoded/transport size reported by the adapter. */
  readonly approximateBytes: number;
}

export interface StateStorageSequenceWriteChunk<T> {
  /**
   * A bounded group of complete values. Adapters must reject a chunk that
   * exceeds their transport budget before scheduling it across a process or
   * worker boundary.
   */
  readonly items: readonly T[];
}

export interface IAsyncStateStorage extends IStateStorage {
  /** Read and decode a scalar value without requiring a synchronous cache. */
  getAsync<T>(key: string, defaultValue?: T): Promise<T | undefined>;

  /**
   * Read a large JSON sequence in bounded pages. Implementations must not
   * assemble the complete sequence merely to return the first page.
   */
  readJsonSequence<T>(
    key: string,
    options?: StateStorageSequenceReadOptions,
  ): AsyncIterable<StateStorageSequencePage<T>>;

  /**
   * Atomically replace a JSON sequence from bounded chunks. The destination
   * becomes visible only after the iterable completes successfully.
   */
  replaceJsonSequence<T>(
    key: string,
    chunks: AsyncIterable<StateStorageSequenceWriteChunk<T>>,
  ): Promise<void>;
}

export function isAsyncStateStorage(
  storage: IStateStorage,
): storage is IAsyncStateStorage {
  const candidate = storage as Partial<IAsyncStateStorage>;
  return (
    typeof candidate.getAsync === 'function' &&
    typeof candidate.readJsonSequence === 'function' &&
    typeof candidate.replaceJsonSequence === 'function'
  );
}
