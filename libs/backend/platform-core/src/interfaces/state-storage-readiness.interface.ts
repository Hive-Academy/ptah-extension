/** Optional readiness contract for state stores that initialize asynchronously. */

import type { IStateStorage } from './state-storage.interface';

/**
 * Why a store cannot be read without explicit recovery.
 *
 * The first six are verdicts a store reaches by INSPECTING durable state, so
 * they can travel over a worker protocol. `worker-unresponsive` is different in
 * kind: it is reached by a host that gave up waiting, so it is always minted
 * locally and never parsed off the wire (the worker protocol's own reason enum
 * in `platform-electron` deliberately does not list it).
 */
export type StateStorageRecoveryReason =
  | 'current-pointer-invalid'
  | 'manifest-invalid'
  | 'blob-missing'
  | 'blob-length-mismatch'
  | 'blob-hash-mismatch'
  | 'migration-failed'
  | 'worker-unresponsive';

export type StateStorageReadinessState =
  | { readonly status: 'not-ready' }
  | { readonly status: 'ready' }
  | {
      readonly status: 'recovery-required';
      readonly reason: StateStorageRecoveryReason;
    };

export interface IStateStorageReadiness extends IStateStorage {
  /** Current state for diagnostics and non-blocking host coordination. */
  getReadinessState(): StateStorageReadinessState;

  /**
   * Resolve only when synchronous reads are safe. Reject with a typed storage
   * error when explicit recovery is required.
   */
  whenReady(): Promise<void>;
}

export function hasStateStorageReadiness(
  storage: IStateStorage,
): storage is IStateStorageReadiness {
  const candidate = storage as Partial<IStateStorageReadiness>;
  return (
    typeof candidate.getReadinessState === 'function' &&
    typeof candidate.whenReady === 'function'
  );
}
