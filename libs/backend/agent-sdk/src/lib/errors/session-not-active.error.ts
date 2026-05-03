/**
 * SessionNotActiveError — thrown when a session-scoped operation requires a
 * live SDK Query handle but the session has been disposed/ended.
 *
 * Specifically used by `SdkAgentAdapter.rewindFiles()` — file checkpointing
 * data only lives on the in-memory Query object, so rewinding requires the
 * session to still be active in `SessionLifecycleManager`.
 *
 * Callers (RPC handlers) should `instanceof`-check this rather than
 * regex-matching the message string. The regex fallback is preserved at the
 * RPC boundary in case a non-Error value bubbles up through legacy paths.
 */
import { SdkError } from './sdk.error';

export class SessionNotActiveError extends SdkError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SessionNotActiveError';
  }
}
