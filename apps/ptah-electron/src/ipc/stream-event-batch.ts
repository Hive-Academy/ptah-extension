export interface QueuedStreamEvent {
  readonly type: string;
  readonly payload?: unknown;
}

/** Keep each structured-clone payload small enough to avoid a long main-loop stall. */
export const STREAM_BATCH_MAX_EVENTS = 64;
export const STREAM_BATCH_MAX_APPROX_BYTES = 256 * 1024;

function approximateEventBytes(event: QueuedStreamEvent): number {
  try {
    return JSON.stringify(event)?.length ?? 0;
  } catch {
    // Electron cannot clone a cyclic event either. Isolate it in one batch so
    // the existing send path reports the failure without blocking other events.
    return STREAM_BATCH_MAX_APPROX_BYTES;
  }
}

/**
 * Remove one bounded batch from the queue. An oversized event is sent alone;
 * it is never dropped and never prevents later events from making progress.
 */
export function takeStreamEventBatch(
  queue: QueuedStreamEvent[],
): QueuedStreamEvent[] {
  let count = 0;
  let bytes = 0;
  while (
    count < queue.length &&
    count < STREAM_BATCH_MAX_EVENTS
  ) {
    const eventBytes = approximateEventBytes(queue[count]);
    if (
      count > 0 &&
      bytes + eventBytes > STREAM_BATCH_MAX_APPROX_BYTES
    ) {
      break;
    }
    bytes += eventBytes;
    count++;
  }
  return queue.splice(0, count);
}
