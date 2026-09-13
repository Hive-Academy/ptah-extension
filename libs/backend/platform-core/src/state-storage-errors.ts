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

export class StateStorageValueTooLargeError extends Error {
  override readonly name = 'StateStorageValueTooLargeError';
  readonly code = 'STATE_STORAGE_VALUE_TOO_LARGE';

  constructor(
    readonly key: string,
    readonly bytes: number,
  ) {
    super(`State storage value is too large: ${bytes} bytes`);
  }
}

export class StateStorageCursorStaleError extends Error {
  override readonly name = 'StateStorageCursorStaleError';
  readonly code = 'STATE_STORAGE_CURSOR_STALE';

  constructor(readonly key: string) {
    super('State storage cursor is stale');
  }
}
