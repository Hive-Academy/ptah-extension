/**
 * SessionAdmissionRefusedError — thrown when a message sent with
 * `admission: 'require-idle'` cannot be admitted onto its session.
 *
 * `SessionStreamPump.sendMessage` raises it instead of queueing: the session is
 * gone, displaced or aborted (`session-ended`), or a turn is in flight or a
 * message is already queued (`busy`). The refusal happens before anything is
 * pushed onto the session queue, so a caller that catches it knows no turn was
 * started or held on its behalf.
 *
 * Callers (RPC handlers) should `instanceof`-check this and read `reason`
 * rather than matching the message string.
 */
import { SdkError } from './sdk.error';

export class SessionAdmissionRefusedError extends SdkError {
  /** Why the message was not admitted. */
  readonly reason: 'busy' | 'session-ended';

  constructor(
    reason: 'busy' | 'session-ended',
    sessionId: string,
    options?: ErrorOptions,
  ) {
    super(
      reason === 'busy'
        ? `Session ${sessionId} is busy: a turn is in flight or a message is already queued.`
        : `Session ${sessionId} has ended.`,
      options,
    );
    this.name = 'SessionAdmissionRefusedError';
    this.reason = reason;
  }
}
