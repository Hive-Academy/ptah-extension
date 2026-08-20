/**
 * Waitlist conversion sink — decoupling seam between the Paddle provisioning
 * fan-out and the waitlist feature.
 *
 * The concrete implementation is the existing `WaitlistService`
 * (`src/waitlist/waitlist.service.ts`), whose `markConverted(email)` method is
 * being added in parallel by the invite-waves agent. To keep this build green
 * regardless of landing order, PaddleService depends ONLY on this local
 * structural interface and injects the implementation OPTIONALLY via the
 * {@link WAITLIST_CONVERSION_SINK} token.
 *
 * Coordination contract for the invite-waves agent (owner of `src/waitlist/**`
 * and the admin surface): bind this token to the real service, e.g.
 *
 *   { provide: WAITLIST_CONVERSION_SINK, useExisting: WaitlistService }
 *
 * in a module where `WaitlistService` is available (and export `WaitlistService`
 * from `WaitlistModule`). Until that binding exists the optional injection
 * resolves to `undefined` and the fan-out simply skips the conversion stamp.
 */
export interface WaitlistConversionSink {
  /**
   * Stamp `convertedAt` on the waitlist row for `email` (idempotent, best-effort).
   * Signature MUST match `WaitlistService.markConverted(email: string): Promise<void>`.
   */
  markConverted(email: string): Promise<void>;
}

/**
 * DI token for the optional {@link WaitlistConversionSink} implementation.
 */
export const WAITLIST_CONVERSION_SINK = 'WAITLIST_CONVERSION_SINK';
