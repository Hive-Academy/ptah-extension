/**
 * SdkError — root error class for @ptah-extension/agent-sdk.
 *
 * All library-boundary errors thrown by agent-sdk production code
 * extend this class, per Convention #6 in CONVENTIONS.md.
 *
 * Behavior: identical to Error (no added fields, no added methods).
 * Purpose: let upstream consumers distinguish agent-sdk errors from
 *          third-party / platform errors via `instanceof SdkError`.
 *
 * Sub-hierarchies may be added later (e.g., `SdkSessionError`,
 * `SdkAuthError`, `SdkModelError`) without breaking this root — any
 * subclass remains `instanceof SdkError` and `instanceof Error`.
 */
export class SdkError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SdkError';
    // Preserve stack trace if V8 supports it.
    const captureStackTrace = (
      Error as unknown as {
        captureStackTrace?: (
          target: object,
          ctor: new (...args: never[]) => unknown,
        ) => void;
      }
    ).captureStackTrace;
    if (typeof captureStackTrace === 'function') {
      captureStackTrace(this, SdkError);
    }
  }
}
