import {
  CAPTURED_EVENT_TYPES,
  type CapturedEventType,
} from '@ptah-extension/worker-protocol';

export interface CapturedEvent {
  type: CapturedEventType;
  payload: unknown;
}

const CAPTURED = new Set<string>(CAPTURED_EVENT_TYPES);

/** Synchronous, I/O-free tap. Routing is supplied by the session driver. */
export class WorkerEventCapture {
  dropped = 0;
  constructor(
    private readonly resolveSession: (payload: unknown) => string | null,
    private readonly enqueue: (sessionId: string, event: CapturedEvent) => void,
  ) {}

  capture(type: string, payload: unknown): void {
    if (!CAPTURED.has(type)) return;
    const sessionId = this.resolveSession(payload);
    if (!sessionId) {
      this.dropped += 1;
      return;
    }
    this.enqueue(sessionId, { type: type as CapturedEventType, payload });
  }
}
