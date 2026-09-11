import type { StateStorageRecoveryReason } from './interfaces/state-storage-readiness.interface';

export class StateStorageNotReadyError extends Error {
  override readonly name = 'StateStorageNotReadyError';
  readonly code = 'STATE_STORAGE_NOT_READY';

  constructor(message = 'State storage is not ready') {
    super(message);
  }
}

export class StateStorageRecoveryRequiredError extends Error {
  override readonly name = 'StateStorageRecoveryRequiredError';
  readonly code = 'STATE_STORAGE_RECOVERY_REQUIRED';

  constructor(readonly reason: StateStorageRecoveryReason) {
    super(`State storage recovery is required: ${reason}`);
  }
}
