/**
 * AuthRequiredError — thrown when a session operation is attempted but the
 * adapter is not usable because authentication is missing or expired.
 *
 * Replaces the generic "SdkAgentAdapter not initialized" SdkError so the RPC
 * boundary and chat UI can distinguish an auth problem (recoverable by the user
 * re-authenticating) from an unexpected internal failure.
 *
 * Carries the provider whose auth is required and a human-readable recovery
 * hint (typically the adapter's last health `errorMessage`) so the UI can render
 * an actionable banner instead of a cryptic message.
 */
import { SdkError } from './sdk.error';

export class AuthRequiredError extends SdkError {
  /** Provider whose authentication is required, when known (e.g. 'openai-codex'). */
  readonly providerId: string | null;
  /** Human-readable guidance on how to recover (re-authenticate). */
  readonly recoveryHint: string | null;

  constructor(
    message: string,
    details?: {
      providerId?: string | null;
      recoveryHint?: string | null;
      cause?: unknown;
    },
  ) {
    super(message, details?.cause ? { cause: details.cause } : undefined);
    this.name = 'AuthRequiredError';
    this.providerId = details?.providerId ?? null;
    this.recoveryHint = details?.recoveryHint ?? null;
  }
}
