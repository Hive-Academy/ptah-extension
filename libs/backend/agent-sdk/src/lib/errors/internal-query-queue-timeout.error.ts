/**
 * InternalQueryQueueTimeoutError — thrown when a one-shot internal query
 * waits longer than the configured ceiling for a concurrency slot.
 *
 * The internal-query gate serializes one-shot `claude` subprocesses host-wide
 * (default limit 1, `ptah.internalQuery.maxConcurrent`). Without a wait
 * ceiling, a caller queued behind a long query would block indefinitely.
 * `InternalQueryService.execute` rejects with this error once
 * `ptah.internalQuery.queueTimeoutMs` (default 60 000) elapses without a slot.
 *
 * The waiter is removed from the queue before this error is raised, so the gate
 * stays consistent and the next waiter is woken — no slot leaks.
 */
import { SdkError } from './sdk.error';

export class InternalQueryQueueTimeoutError extends SdkError {
  /** The wait ceiling that elapsed, in milliseconds. */
  readonly queueTimeoutMs: number;

  constructor(queueTimeoutMs: number, options?: ErrorOptions) {
    super(
      `Internal query waited longer than ${queueTimeoutMs}ms for a concurrency slot.`,
      options,
    );
    this.name = 'InternalQueryQueueTimeoutError';
    this.queueTimeoutMs = queueTimeoutMs;
  }
}
